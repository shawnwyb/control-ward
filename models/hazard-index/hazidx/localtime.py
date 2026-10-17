"""Python copy of supabase/functions/_shared/time.ts (zonedToUtc, localDate, addDays,
overnightWindow), checked against it by tests/test_parity.py. Times are UTC epoch milliseconds,
as in the TypeScript. The two-pass zonedToUtc is copied step by step instead of using zoneinfo's
fold rules, so nonexistent and repeated wall times at DST changes resolve the same way."""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo


@lru_cache(maxsize=None)
def _zone(tz: str) -> ZoneInfo:
    return ZoneInfo(tz)


def _parts(utc_ms: int, tz: str) -> tuple[int, int, int, int, int, int]:
    d = datetime.fromtimestamp(utc_ms // 1000, tz=timezone.utc).astimezone(_zone(tz))
    return d.year, d.month, d.day, d.hour, d.minute, d.second


def _utc_ms(y, m, d, h=0, mi=0, s=0) -> int:
    return calendar.timegm((y, m, d, h, mi, s, 0, 0, 0)) * 1000


def local_date(utc_ms: int, tz: str) -> str:
    y, m, d, *_ = _parts(utc_ms, tz)
    return f"{y:04d}-{m:02d}-{d:02d}"


def local_hour(utc_ms: int, tz: str) -> int:
    return _parts(utc_ms, tz)[3]


def add_days(day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def zoned_to_utc(day: str, hour: int, tz: str) -> int:
    y, m, d = (int(x) for x in day.split("-"))
    wall = _utc_ms(y, m, d) + hour * 3_600_000
    guess = wall
    for _ in range(2):
        p = _parts(guess, tz)
        as_utc = _utc_ms(*p)
        guess = wall - (as_utc - (guess // 1000) * 1000)
    return guess


def overnight_window(now_ms: int, tz: str) -> tuple[int, int]:
    """The most recent 18:00 -> 06:00 local window that has started, clipped to now."""
    today = local_date(now_ms, tz)
    if local_hour(now_ms, tz) >= 18:
        return zoned_to_utc(today, 18, tz), now_ms
    return zoned_to_utc(add_days(today, -1), 18, tz), min(now_ms, zoned_to_utc(today, 6, tz))


def day_bounds(day: str, tz: str) -> tuple[int, int]:
    """[local midnight, next local midnight) in UTC ms; 23 or 25 hours long at DST changes."""
    return zoned_to_utc(day, 0, tz), zoned_to_utc(add_days(day, 1), 0, tz)
