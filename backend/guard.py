"""Abuse protection: per-client sliding-window rate limits and request-body
caps on /api/ (adapted from DFS-Riches app/guard.py).

Buckets, requests per client per minute (override with RATE_LIMIT_<NAME>):
    write   POST / PUT / PATCH / DELETE        30
    heavy   portfolio analytics, market data   60
    api     any other /api/ call               300
Webhooks are exempt (providers retry on 429, and they're verified anyway).

The client address comes from the proxy-appended end of X-Forwarded-For
(TRUSTED_PROXY_HOPS, default 1), never from a value the client can set; see
client_ip(). Limits are per process;
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
# Receipt photos and statements (api_imports.MAX_FILE_BYTES, plus multipart overhead).
UPLOAD_PREFIXES = ("/api/imports",)
MAX_UPLOAD_BYTES = 11 * 1024 * 1024
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


def _hops() -> int:
    try:
        return max(0, int(os.environ.get("TRUSTED_PROXY_HOPS", "1")))
    except ValueError:
        return 1


def client_ip(headers: dict[str, str], peer: str | None) -> str:
    """The address a request really came from. Forwarding headers are written by
    whoever sent the request, so only what *our own* proxies appended is trusted:
    each proxy adds the address it saw to the end of X-Forwarded-For, so the
    entry TRUSTED_PROXY_HOPS from the end (default 1: the host's load balancer)
    is the client; anything the client put in front of it is ignored.
    TRUST_CLOUDFLARE=1 additionally honors CF-Connecting-IP, only safe when the
    API can be reached through Cloudflare alone."""
    if os.environ.get("TRUST_CLOUDFLARE") == "1" and headers.get("cf-connecting-ip"):
        return headers["cf-connecting-ip"].strip()
    hops = _hops()
    chain = [p.strip() for p in headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if hops and len(chain) >= hops:
        return chain[-hops]
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
        cap = MAX_UPLOAD_BYTES if method == "POST" and path.rstrip("/") in UPLOAD_PREFIXES else MAX_BODY_BYTES
        try:
            declared = int(headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        if declared > cap:
            return await _reject(send, 413, "Request body too large.")
        received = 0

        async def capped_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > cap:
                    raise _TooLarge()
            return message

        try:
            return await self.app(scope, capped_receive, send)
        except _TooLarge:
            return await _reject(send, 413, "Request body too large.")


SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
    (b"cache-control", b"no-store"),
    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
]


class SecurityHeadersMiddleware:
    """Adds baseline response headers to every API response (JSON only, so the CSP is fully closed)."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                present = {k.lower() for k, _ in message.get("headers", [])}
                message = dict(message)
                message["headers"] = list(message.get("headers", [])) + [
                    h for h in SECURITY_HEADERS if h[0] not in present
                ]
            await send(message)

        return await self.app(scope, receive, send_with_headers)


class _TooLarge(Exception):
    pass


async def _reject(send, status: int, detail: str, extra: dict[str, str] | None = None) -> None:
    body = json.dumps({"detail": detail}).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    headers += [(k.encode(), v.encode()) for k, v in (extra or {}).items()]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})
