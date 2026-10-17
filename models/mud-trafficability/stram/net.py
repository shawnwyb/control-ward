"""HTTP helpers shared by the fetchers: one polite client and retries with backoff on 429 and 5xx."""
from __future__ import annotations

import random
import time

import httpx

UA = "planit-stram/0.1 (SwampHacks 2026 research prototype)"


def client(timeout: float = 120.0) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": UA})


def _retry(send, url: str, tries: int) -> httpx.Response:
    last: Exception | None = None
    for attempt in range(1, tries + 1):
        try:
            r = send()
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last = exc
        else:
            if r.status_code in (403, 407):
                raise RuntimeError(f"{r.status_code} from {url}: blocked by network policy")
            if r.status_code == 429 or r.status_code >= 500:
                last = RuntimeError(f"HTTP {r.status_code} from {url}")
            else:
                r.raise_for_status()
                return r
        if attempt < tries:
            time.sleep(min(60.0, 2.0 ** attempt) * (0.5 + random.random()))
    raise RuntimeError(f"giving up on {url} after {tries} tries: {last}")


def get_with_retry(c: httpx.Client, url: str, params=None, tries: int = 5) -> httpx.Response:
    return _retry(lambda: c.get(url, params=params), url, tries)


def post_with_retry(c: httpx.Client, url: str, data=None, tries: int = 5) -> httpx.Response:
    return _retry(lambda: c.post(url, data=data), url, tries)
