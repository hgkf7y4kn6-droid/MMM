"""In-process cache for provider responses (pattern adapted from
DFS-Riches app/cache.py).

- TTL per key, LRU-capped so browsing many tickers can't grow memory unbounded.
- Concurrent callers for the same uncached key share one in-flight fetch.
- When a refresh fails, the last good value is served (marked stale) instead
  of an error, so a provider outage degrades to old data, not a broken screen.
"""
from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable

MAX_ENTRIES = 512

_store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_in_flight: dict[str, asyncio.Future] = {}
stats = {"hit": 0, "fetch": 0, "stale": 0, "error": 0}


class Cached:
    """A value plus how fresh it is."""

    __slots__ = ("value", "fetched_at", "stale")

    def __init__(self, value: Any, fetched_at: float, stale: bool = False):
        self.value, self.fetched_at, self.stale = value, fetched_at, stale


async def cached(key: str, ttl_seconds: float, fetch: Callable[[], Awaitable[Any]]) -> Cached:
    hit = _store.get(key)
    if hit and time.time() - hit[0] < ttl_seconds:
        _store.move_to_end(key)
        stats["hit"] += 1
        return Cached(hit[1], hit[0])
    if key in _in_flight:
        return await asyncio.shield(_in_flight[key])
    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    _in_flight[key] = future
    try:
        try:
            value = await fetch()
        except Exception:
            if hit is not None:
                stats["stale"] += 1
                result = Cached(hit[1], hit[0], stale=True)
                future.set_result(result)
                return result
            stats["error"] += 1
            raise
        now = time.time()
        _store[key] = (now, value)
        _store.move_to_end(key)
        while len(_store) > MAX_ENTRIES:
            _store.popitem(last=False)
        stats["fetch"] += 1
        result = Cached(value, now)
        future.set_result(result)
        return result
    except BaseException as exc:
        if not future.done():
            future.set_exception(exc)
            future.exception()      # mark retrieved: waiters re-raise it, the loop doesn't log it
        raise
    finally:
        _in_flight.pop(key, None)


def invalidate(prefix: str = "") -> int:
    keys = [k for k in _store if k.startswith(prefix)]
    for k in keys:
        del _store[k]
    return len(keys)
