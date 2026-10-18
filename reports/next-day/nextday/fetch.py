"""HTTP GET with dated snapshots. Every response is saved under cache/snapshots/<stamp>/ so a report
can be rebuilt later with --offline <stamp>. A source that fails raises SourceUnavailable; the caller
turns that into a 'missing' section with the reason instead of failing the whole report."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

from . import paths

UA = "controlward-next-day-report/0.1 (SwampHacks 2026 hazard report; research use)"


class SourceUnavailable(RuntimeError):
    """The source did not answer, or no saved response exists for this snapshot."""


def new_stamp(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")


def _safe(key: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", key)


class Fetcher:
    def __init__(self, stamp: str | None = None, *, offline: bool = False, root: Path = paths.SNAPSHOTS,
                 client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep,
                 timeout: float = 30.0):
        if offline and not stamp:
            raise ValueError("offline mode needs the snapshot stamp to read")
        self.stamp = stamp or new_stamp()
        self.offline = offline
        self.dir = Path(root) / self.stamp
        self._client = client
        self._sleep = sleep
        self._timeout = timeout
        # key -> {url, fetched_at}: copied into the report's meta.sources
        self.sources: dict[str, dict[str, str]] = {}

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=self._timeout, headers={"User-Agent": UA, "Accept": "application/json"},
                                        follow_redirects=True)
        return self._client

    def cached(self, key: str, producer: Callable[[], Any], url: str = "") -> Any:
        """Like get_json for data that does not come from one HTTP GET (for example a paged query): `producer`
        is called online, and its result is saved in the snapshot so --offline can replay it."""
        path = self.dir / f"{_safe(key)}.json"
        if self.offline:
            if not path.is_file():
                raise SourceUnavailable(f"no saved response for '{key}' in snapshot {self.stamp}")
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.sources[key] = {"url": saved["url"], "fetched_at": saved["fetched_at"]}
            return saved["data"]
        data = producer()
        fetched = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"url": url, "fetched_at": fetched, "data": data}), encoding="utf-8")
        self.sources[key] = {"url": url, "fetched_at": fetched}
        return data

    def get_json(self, key: str, url: str, params: dict[str, Any] | None = None, *, retries: int = 3, timeout: float | None = None) -> Any:
        path = self.dir / f"{_safe(key)}.json"
        if self.offline:
            if not path.is_file():
                raise SourceUnavailable(f"no saved response for '{key}' in snapshot {self.stamp}")
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.sources[key] = {"url": saved["url"], "fetched_at": saved["fetched_at"]}
            return saved["data"]

        last = "no attempt made"
        for attempt in range(retries):
            try:
                r = self._http().get(url, params=params, timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT)
            except httpx.HTTPError as e:
                last = f"{type(e).__name__}: {e}"
            else:
                if r.status_code == 429 or r.status_code >= 500:
                    last = f"HTTP {r.status_code}"
                elif r.status_code >= 400:
                    raise SourceUnavailable(f"{key}: HTTP {r.status_code} from {r.url}")
                else:
                    try:
                        data = r.json()
                    except ValueError as e:
                        raise SourceUnavailable(f"{key}: response was not JSON ({e})") from e
                    fetched = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    self.dir.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps({"url": str(r.url), "fetched_at": fetched, "data": data}),
                                    encoding="utf-8")
                    self.sources[key] = {"url": str(r.url), "fetched_at": fetched}
                    return data
            if attempt < retries - 1:
                self._sleep(2 ** attempt)
        raise SourceUnavailable(f"{key}: {last} after {retries} tries")
