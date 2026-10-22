"""Abuse protection: per-client sliding-window rate limits and request-body
caps on /api/ (adapted from DFS-Riches app/guard.py).

Buckets, requests per client per minute (override with RATE_LIMIT_<NAME>):
    write   POST / PUT / PATCH / DELETE        30
    heavy   portfolio analytics, market data   60
    api     any other /api/ call               300
Webhooks are exempt (providers retry on 429, and they're verified anyway).

The client is CF-Connecting-IP / True-Client-IP when behind Cloudflare, else
the first X-Forwarded-For hop, else the socket peer. Limits are per process;
run behind one instance or move the counters to Redis when scaling out.
"""
from __future__ import annotations

import json
import os
import time
from collections import deque

LIMITS = {"write": 30, "heavy": 60, "api": 300}
WINDOW_SECONDS = 60
MAX_CLIENTS = 20_000
MAX_BODY_BYTES = 1024 * 1024
EXEMPT_PREFIXES = ("/api/billing/webhook", "/api/plaid/webhook")
HEAVY_PREFIXES = ("/api/portfolio/", "/api/market/", "/api/stocks/")


def _limit(name: str) -> int:
    try:
        return int(os.environ.get(f"RATE_LIMIT_{name.upper()}", LIMITS[name]))
    except ValueError:
        return LIMITS[name]


def bucket(method: str, path: str) -> str | None:
    if not path.startswith("/api/") or path.startswith(EXEMPT_PREFIXES):
        return None
    if method in ("POST", "PUT", "PATCH", "DELETE") and not path.startswith("/api/portfolio/"):
        return "write"
    if path.startswith(HEAVY_PREFIXES):
        return "heavy"
    return "api"


def client_ip(headers: dict[str, str], peer: str | None) -> str:
    for name in ("cf-connecting-ip", "true-client-ip"):
        if headers.get(name):
            return headers[name].strip()
    xff = headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return peer or "unknown"


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque] = {}

    def check(self, client: str, name: str, now: float | None = None) -> float:
        """0 if allowed (and counted), else seconds until the next request is allowed."""
        now = time.monotonic() if now is None else now
        key = (client, name)
        hits = self._hits.pop(key, None) or deque()
        while hits and now - hits[0] >= WINDOW_SECONDS:
            hits.popleft()
        self._hits[key] = hits
        if len(hits) >= _limit(name):
            return max(1.0, WINDOW_SECONDS - (now - hits[0]))
        hits.append(now)
        while len(self._hits) > MAX_CLIENTS:
            self._hits.pop(next(iter(self._hits)))
        return 0.0


class GuardMiddleware:
    def __init__(self, app) -> None:
        self.app = app
        self.limiter = RateLimiter()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            return await self.app(scope, receive, send)
        path, method = scope["path"], scope["method"]
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        name = bucket(method, path)
        if name is not None:
            retry = self.limiter.check(client_ip(headers, (scope.get("client") or (None,))[0]), name)
            if retry:
                return await _reject(send, 429, "Too many requests. Please slow down and try again shortly.",
                                     {"retry-after": str(int(retry))})
        if not path.startswith("/api/"):
            return await self.app(scope, receive, send)
        try:
            declared = int(headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        if declared > MAX_BODY_BYTES:
            return await _reject(send, 413, "Request body too large.")
        received = 0

        async def capped_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_BODY_BYTES:
                    raise _TooLarge()
            return message

        try:
            return await self.app(scope, capped_receive, send)
        except _TooLarge:
            return await _reject(send, 413, "Request body too large.")


class _TooLarge(Exception):
    pass


async def _reject(send, status: int, detail: str, extra: dict[str, str] | None = None) -> None:
    body = json.dumps({"detail": detail}).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    headers += [(k.encode(), v.encode()) for k, v in (extra or {}).items()]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})
