"""HTTP with retries and backoff (copied from data/tide-prediction/tide_fetch.py), plus Open-Meteo
quota detection, a weighted-call ledger and output manifests.

Exit codes used by every script: 0 ok, 1 error, 2 blocked by network policy (403/407, never
retried), 3 API quota used up (partial output kept; running the script again continues it).
"""
from __future__ import annotations

import hashlib
import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

UA = "hazidx/0.1 (research script)"


class BlockedError(RuntimeError):
    """403/407 or a proxy CONNECT refusal. A policy denial: never retried."""


class FetchError(RuntimeError):
    pass


class QuotaError(RuntimeError):
    """Open-Meteo answered 429 with a request-limit reason. `kind` is minutely, hourly or daily."""

    def __init__(self, kind: str, reason: str):
        super().__init__(f"{kind} API request limit exceeded: {reason}")
        self.kind, self.reason = kind, reason


def quota_kind(reason: str) -> str | None:
    r = reason.lower()
    if "limit" not in r:
        return None
    for kind in ("minutely", "hourly", "daily", "monthly"):
        if kind in r:
            return kind
    return "unknown"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Client:
    def __init__(self, timeout: float = 60.0, client: httpx.Client | None = None, sleep: Callable = time.sleep,
                 max_tries: int = 6, user_agent: str = UA):
        self.http = client or httpx.Client(timeout=timeout, follow_redirects=True,
                                           headers={"User-Agent": user_agent})
        self.sleep, self.max_tries = sleep, max_tries
        self.log: list[dict] = []  # every successful request, for the manifest

    def get(self, url: str, params: dict | None = None) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(1, self.max_tries + 1):
            try:
                r = self.http.get(url, params=params)
            except httpx.ProxyError as exc:
                if "403" in str(exc) or "407" in str(exc):
                    raise BlockedError(f"proxy refused {url}: {exc}") from exc
                last = exc
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = exc
            else:
                if r.status_code in (403, 407):
                    raise BlockedError(f"{r.status_code} from {url}")
                if r.status_code == 429:
                    reason = _reason(r)
                    kind = quota_kind(reason)
                    if kind and kind != "minutely":
                        raise QuotaError(kind, reason)
                    last = FetchError(f"HTTP 429 from {url}: {reason}")
                    self.sleep(61 if kind == "minutely" else min(60.0, 2 ** attempt))
                    continue
                if r.status_code >= 500:
                    last = FetchError(f"HTTP {r.status_code} from {url}")
                elif r.status_code >= 400:
                    raise FetchError(f"HTTP {r.status_code} from {url}: {_reason(r)[:300]}")
                else:
                    self.log.append({"method": "GET", "url": str(r.request.url).split("?")[0],
                                     "params": params, "at": utc_now_iso()})
                    return r
            if attempt < self.max_tries:
                self.sleep(min(60.0, 2 ** (attempt - 1)) * (0.5 + random.random()))
        raise FetchError(f"giving up after {self.max_tries} tries: {url}: {last}")

    def get_json(self, url: str, params: dict | None = None) -> Any:
        r = self.get(url, params)
        try:
            body = r.json()
        except ValueError as exc:
            raise FetchError(f"non-JSON response from {url}: {r.text[:200]!r}") from exc
        if isinstance(body, dict) and body.get("error") is True:
            raise FetchError(f"API error from {url}: {body.get('reason')}")
        return body


def _reason(r: httpx.Response) -> str:
    try:
        body = r.json()
        if isinstance(body, dict):
            return str(body.get("reason") or body.get("detail") or body)
    except ValueError:
        pass
    return r.text[:300]


# ------------------------------------------------------------------ Open-Meteo weighted calls

def openmeteo_weight(n_locations: int, n_vars: int, n_days: float) -> float:
    """Open-Meteo counts one call per location for up to 10 variables and 2 weeks of data, and a
    fraction more beyond either limit (15 variables for 4 weeks = 3.0 calls)."""
    return n_locations * max(1.0, n_vars / 10.0) * max(1.0, n_days / 14.0)


class Ledger:
    """Append-only log of weighted calls, so pacing and `status` see calls from earlier runs too."""

    def __init__(self, path: Path, clock: Callable[[], float] = time.time):
        self.path, self.clock = path, clock

    def add(self, weight: float, what: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": self.clock(), "weight": round(weight, 4), "what": what}) + "\n")

    def entries(self) -> list[dict]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
        return out

    def used_since(self, seconds: float) -> float:
        cutoff = self.clock() - seconds
        return sum(e["weight"] for e in self.entries() if e["t"] >= cutoff)


# ------------------------------------------------------------------ manifests

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(out: Path, count: int, query: dict, service_base: str, requests: list[dict],
                   note: str = "") -> Path:
    m = {
        "retrieved_at": utc_now_iso(), "file": out.name, "sha256": sha256_file(out),
        "bytes": out.stat().st_size, "row_count": count, "service_base": service_base,
        "query": query, "requests": requests, "note": note,
    }
    mp = out.with_name(out.name + ".manifest.json")
    mp.write_text(json.dumps(m, indent=2, default=str))
    return mp
