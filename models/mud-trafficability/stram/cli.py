"""python -m stram {prepare,forecast,map,push,all}. Run from models/mud-trafficability/.

prepare   fetch and cache the static inputs per site: SSURGO (plant rows + tile raster), 3DEP terrain/DTW, OSM routes
forecast  fetch Open-Meteo once, compute every site, write output/run_<stamp>/ and point output/LATEST at it
map       build output/run_<stamp>/map.html from a run
push      write output/run_<stamp>/ml_scores_push.sql (or --clear). Applying it to hosted is a separate, manual step.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import config as C, net, routes, soils, terrain, weather
from .forecast import run_site
from .sites import Site, load_sites

POLYGON_HORIZONS = ("now", "d1")


def _sites(args) -> list[Site]:
    return load_sites(eia=args.eia.split(",") if args.eia else None, limit=args.limit)


def cmd_prepare(args) -> int:
    sites = _sites(args)
    print(f"preparing {len(sites)} sites", file=sys.stderr)
    soils.plant_rows(sites, force=args.force)
    failed = []
    with net.client() as client:
        for n, s in enumerate(sites, 1):
            t0 = time.monotonic()
            try:
                grid = terrain.site_grid(s)
                terrain.prepare_terrain(s, client, force=args.force)
                soils.prepare_tile_soils(s, grid, force=args.force)
                routes.fetch_ways(s, client, force=args.force)
                print(f"[{n}/{len(sites)}] {s.name} ({s.eia}) ok in {time.monotonic() - t0:.0f}s", file=sys.stderr)
            except Exception as exc:
                failed.append(s.eia)
                print(f"[{n}/{len(sites)}] {s.name} ({s.eia}) FAILED: {exc}", file=sys.stderr)
                if args.verbose:
                    traceback.print_exc()
    if failed:
        print(f"{len(failed)} sites failed: {','.join(failed)} (rerun prepare --eia ... to retry)", file=sys.stderr)
    return 1 if failed and len(failed) == len(sites) else 0


def _round_coords(obj, nd=5):
    if isinstance(obj, (list, tuple)):
        return [_round_coords(o, nd) for o in obj]
    if isinstance(obj, float):
        return round(obj, nd)
    return obj


def _geom(g: dict) -> dict:
    return {"type": g["type"], "coordinates": _round_coords(g["coordinates"])}


def cmd_forecast(args) -> int:
    sites = _sites(args)
    ready = [s for s in sites if (C.CACHE / f"terrain_{s.eia}.npz").exists() and (C.CACHE / f"soils_{s.eia}.npz").exists()
             and (C.CACHE / f"osm_{s.eia}.json").exists()]
    skipped = sorted({s.eia for s in sites} - {s.eia for s in ready})
    if skipped:
        print(f"skipping {len(skipped)} sites with no prepared inputs: {','.join(skipped)}", file=sys.stderr)
    if not ready:
        print("nothing to forecast; run `python -m stram prepare` first", file=sys.stderr)
        return 1
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H%MZ")
    out = C.OUTPUT / f"run_{stamp}"
    (out / "segments").mkdir(parents=True, exist_ok=True)
    (out / "polygons").mkdir(parents=True, exist_ok=True)
    plant = soils.plant_rows(ready)
    with net.client() as client:
        wx = weather.fetch(ready, client, now)
    run = {"generated_at": now.isoformat(timespec="seconds"), "model_version": C.MODEL_VERSION, "label": C.LABEL,
           "units": C.UNITS, "flags": list(C.FLAGS), "sources": list(_sources()),
           "equipment": [{"key": e.key, "label": e.label, "kind": e.kind, "mil_type": e.mil_type} for e in C.EQUIPMENT.values()],
           "passes": list(C.PASSES_SHOWN), "default_passes": C.DEFAULT_PASSES, "passes_note": C.PASSES_NOTE,
           "thresholds_in": {"inspect": C.INSPECT_IN, "hold": C.HOLD_IN}, "ground_band_in": round(C.GROUND_BAND_IN, 2),
           "polygon_horizons": list(POLYGON_HORIZONS), "corridor_ft": C.CORRIDOR_FT, "sites": [], "failed": skipped}
    summaries, agreement = [], []
    for n, (s, loc) in enumerate(zip(ready, wx), 1):
        t0 = time.monotonic()
        try:
            tr = terrain.load_terrain(s)
            grid = tr["grid"]
            tile = soils.load_tile_soils(s)
            segs = routes.segments(routes.fetch_ways(s, None), grid)
            hz = weather.horizons(loc, now)
            res = run_site(s, grid, tr, tile, plant.get(s.eia), segs, routes.route_mask(segs, grid),
                           routes.route_mask(segs, grid, C.CORRIDOR_FT / C.M_TO_FT).astype(bool), hz, POLYGON_HORIZONS)
        except Exception as exc:
            run["failed"].append(s.eia)
            print(f"[{n}/{len(ready)}] {s.name} FAILED: {exc}", file=sys.stderr)
            if args.verbose:
                traceback.print_exc()
            continue
        for f in res["segments"]:
            f["geometry"] = _geom(f["geometry"])
        (out / "segments" / f"{s.eia}.geojson").write_text(json.dumps(
            {"type": "FeatureCollection", "properties": {"label": C.LABEL, "model_version": C.MODEL_VERSION, "units": C.UNITS,
                                                         "r": "key equipment|passes|horizon -> [flag, source, score, z, z_lo, z_hi, flagged_ft]",
                                                         "d": "horizon -> [mc_ps, ci, nci_adj, dtw] at the worst cell"},
             "features": res["segments"]}, separators=(",", ":")))
        (out / "polygons" / f"{s.eia}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": _geom(p["geometry"]),
             "properties": {k: v for k, v in p.items() if k != "geometry"} | {"site": s.eia, "locally_validated": False}}
            for p in res["polygons"]]}, separators=(",", ":")))
        summaries += res["summaries"]
        agreement.append(res["agreement"])
        run["sites"].append({"eia": s.eia, "name": s.name, "lat": s.lat, "lon": s.lon, "timezone": loc.get("timezone"),
                             "horizons": hz, "soil": res["soil"], "segments": len(segs),
                             "flood_gauge": routes.nearest_flood_gauge(s)})
        print(f"[{n}/{len(ready)}] {s.name}: {len(segs)} segments in {time.monotonic() - t0:.1f}s", file=sys.stderr)

    _write_csv(out / "sites.csv", [{**{k: v for k, v in r.items() if k != "plant_cell"},
                                     "plant_cell_flag": (r["plant_cell"] or {}).get("flag"),
                                     "plant_cell_score": (r["plant_cell"] or {}).get("score")} for r in summaries])
    run["agreement"] = _write_agreement(out / "agreement.csv", agreement)
    (out / "run.json").write_text(json.dumps(run, indent=1))
    (C.OUTPUT / "LATEST").write_text(out.name)
    print(f"wrote {out} ({len(run['sites'])} sites, {len(run['failed'])} failed or skipped)")
    return 0 if run["sites"] else 1


def _sources():
    from .rules import SOURCES
    return SOURCES


def _write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("")
        return
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def _write_agreement(path: Path, rows: list[dict]) -> dict:
    _write_csv(path, rows)
    pairs = [(r["stram_wet_median_in"], float(r["nrcs_rutting_hazard"])) for r in rows
             if r["stram_wet_median_in"] is not None and r.get("nrcs_rutting_hazard") not in (None, "")]
    result = {"n": len(pairs), "spearman_rho": None, "p_value": None,
              "note": "STRAM wet-case ground index vs NRCS FOR rutting hazard. Informational; neither is ground truth."}
    if len(pairs) >= 3:
        from scipy.stats import spearmanr
        rho, p = spearmanr(*zip(*pairs))
        if rho == rho:  # not NaN
            result.update(spearman_rho=round(float(rho), 3), p_value=round(float(p), 4))
    return result


def latest_run(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    marker = C.OUTPUT / "LATEST"
    if not marker.exists():
        raise SystemExit("no run yet; run `python -m stram forecast` first")
    return C.OUTPUT / marker.read_text().strip()


def cmd_map(args) -> int:
    from .map import build_map
    run_dir = latest_run(args.run)
    path = build_map(run_dir)
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")
    return 0


def cmd_push(args) -> int:
    from .push import ApplyError, apply, write_push_sql
    run_dir = latest_run(args.run)
    if args.apply:
        try:
            apply(run_dir, metric=args.metric, clear=args.clear, confirm=args.confirm, allow_stale=args.allow_stale)
        except ApplyError as exc:
            print(f"NOT APPLIED: {exc}" if "Applied," not in str(exc) else f"WARNING: {exc}", file=sys.stderr)
            return 1
        return 0
    path, rows = write_push_sql(run_dir, clear=args.clear, metric=args.metric)
    print(f"wrote {path} ({rows} scores, metric {args.metric})" if not args.clear else f"wrote {path} (clears {C.MODEL_VERSION})")
    print("Not applied. To preview, confirm and apply to the production project:\n"
          f"  python -m stram push{' --clear' if args.clear else ''} --apply")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m stram", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("prepare", "forecast", "all"):
        p = sub.add_parser(name)
        p.add_argument("--eia", help="comma-separated EIA plant ids (default: all 60 hosted sites)")
        p.add_argument("--limit", type=int)
        p.add_argument("--verbose", action="store_true")
        if name in ("prepare", "all"):
            p.add_argument("--force", action="store_true", help="refetch cached inputs")
    for name in ("map", "push"):
        p = sub.add_parser(name)
        p.add_argument("--run", help="run directory (default: output/LATEST)")
        if name == "push":
            p.add_argument("--clear", action="store_true", help=f"write SQL that deletes the {C.MODEL_VERSION} scores")
            p.add_argument("--metric", choices=("max", "p90"), default="p90",
                           help="site score: the score exceeded by 10%% of route length (default, chosen for production) "
                                "or the worst segment")
            p.add_argument("--apply", action="store_true",
                           help="preview, confirm with the project ref, apply to the linked production project, read back")
            p.add_argument("--confirm", metavar="PROJECT_REF",
                           help="non-interactive confirmation; must equal the linked project ref")
            p.add_argument("--allow-stale", action="store_true", dest="allow_stale",
                           help="allow applying a run older than 24 h")
    args = ap.parse_args(argv)
    if args.cmd == "all":
        rc = cmd_prepare(args)
        rc = rc or cmd_forecast(args)
        return rc or cmd_map(argparse.Namespace(run=None))
    return {"prepare": cmd_prepare, "forecast": cmd_forecast, "map": cmd_map, "push": cmd_push}[args.cmd](args)
