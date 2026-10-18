"""python -m nextday build|refresh|stations|calibrate-mud  (use reports/next-day/run.sh)"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from hazidx.sites import load_sites

from . import air, hazard_index, paths, report, river, stations
from .fetch import Fetcher, SourceUnavailable

SAMPLE_SITES = ["621", "6113", "6008", "1403", "6163"]   # Turkey Point, Gibson, Palo Verde, Nine Mile Point, Grand Coulee


def parse_stamp(stamp: str) -> datetime:
    return datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def cmd_build(args) -> int:
    offline = args.offline is not None
    fetcher = Fetcher(args.offline, offline=offline)
    as_of = parse_stamp(args.offline) if offline else datetime.now(timezone.utc)
    all_sites = load_sites()
    wanted = [s.eia_plant_id for s in all_sites] if args.all else (args.site or SAMPLE_SITES)
    by = {s.eia_plant_id: s for s in all_sites}
    unknown = [w for w in wanted if w not in by]
    if unknown:
        print(f"unknown site id(s): {', '.join(unknown)}", file=sys.stderr)
        return 1
    try:
        fires = air.fetch_fires(fetcher)
    except SourceUnavailable as e:
        print(f"warning: wildfire list unavailable ({e})", file=sys.stderr)
        fires = None
    gauges = river.load_gauges()
    ctx = report.Context(fetcher=fetcher, as_of=as_of, when=args.when, hazard_rows=hazard_index.load_rows(),
                         fires=fires, gauges=gauges, stations=stations.load(),
                         out_dir=Path(args.out) if args.out else paths.PUBLIC_REPORTS,
                         wildlife=not args.no_wildlife, routing=not args.no_routing)
    try:
        import nld_fetch
        ctx.nld_client = None if offline else nld_fetch.NLDClient()
    except ImportError:
        print("warning: nld_fetch is not importable; levees will be missing", file=sys.stderr)
    out = Path(args.out) if args.out else paths.PUBLIC_REPORTS
    for eia in wanted:
        rep, geo = report.build_site(by[eia], ctx)
        path = report.write(rep, geo, out)
        v = rep["verdict"]
        print(f"{eia:>6} {rep['meta']['site']['name'][:30]:<30} {rep['meta']['for_date']}  {v['label']:<15} "
              f"gaps={len(rep['gaps'])}  -> {path.relative_to(out.parent) if out.parent in path.parents else path}")
        if args.cmd == "refresh":
            ch = rep["changes"]
            if ch["status"] != "ok":
                print(f"         changes: {ch['reason']}")
            else:
                print(f"         changes since {ch['since']} ({ch['since_kind']}): " + ("none" if not ch["items"] else ""))
                for item in ch["items"]:
                    print(f"           - {item['text']}")
    print(f"snapshot {fetcher.stamp} (rebuild with: run.sh build --offline {fetcher.stamp})")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="nextday", description="Next-day safety report generator")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("build", "refresh"):
        b = sub.add_parser(name, help="write one JSON report per site")
        b.add_argument("--site", nargs="+", metavar="EIA", help=f"plant ids (default: {' '.join(SAMPLE_SITES)})")
        b.add_argument("--all", action="store_true", help="all plants")
        b.add_argument("--for", dest="when", choices=("tomorrow", "today"), default="tomorrow")
        b.add_argument("--offline", metavar="STAMP", help="rebuild from cache/snapshots/STAMP; no network")
        b.add_argument("--out", help="output folder (default: public/reports)")
        b.add_argument("--no-routing", action="store_true", help="skip the Overpass road request used for detours")
        b.add_argument("--no-wildlife", action="store_true", help="skip the iNaturalist requests (about 5 per site)")
    sub.add_parser("stations", help="propose a NOAA tide station for each plant")
    cm = sub.add_parser("calibrate-mud", help="compare crew mud reports with flagged routes")
    cm.add_argument("csv", help="CSV export with columns: latitude, longitude, created_at")
    args = ap.parse_args(argv)
    if args.cmd in ("build", "refresh"):
        return cmd_build(args)
    if args.cmd == "stations":
        return stations.run()
    if args.cmd == "calibrate-mud":
        from . import mud_validation
        return mud_validation.run(args.csv)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
