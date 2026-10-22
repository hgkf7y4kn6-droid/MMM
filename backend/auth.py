"""Who is calling: Clerk session tokens (verification adapted from
DFS-Riches app/accounts.py).

The app sends Clerk's short-lived RS256 session JWT as
`Authorization: Bearer <token>`. It's verified against the instance's public
JWKS (located from the publishable key), so no secret is needed to know who
is calling. The verified `sub` is the user id every per-user query is scoped
to -- a user id in a URL or body is never trusted on its own.

CLERK_PUBLISHABLE_KEY      required unless sign-in is disabled
CLERK_AUTHORIZED_PARTIES   comma-separated web origins whose sessions are accepted
REQUIRE_SIGN_IN=0          local development only: every request is DEV_USER_ID
                           (refused when APP_ENV=production)
"""
from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, Request

JWKS_MIN_REFRESH_SECONDS = 60


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class User:
    id: str
    claims: dict[str, Any] = field(default_factory=dict)


def sign_in_required() -> bool:
    required = os.environ.get("REQUIRE_SIGN_IN", "1") != "0"
    if not required and os.environ.get("APP_ENV") == "production":
        raise RuntimeError("REQUIRE_SIGN_IN=0 is not allowed in production.")
    return required


def frontend_api() -> str:
    """The Clerk instance host encoded in the publishable key."""
    pk = os.environ.get("CLERK_PUBLISHABLE_KEY", "")
    if not pk.startswith("pk_"):
        raise AuthError("sign-in isn't configured on this server")
    encoded = pk.split("_", 2)[-1]
    return base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode().rstrip("$")


def authorized_parties() -> set[str]:
    return {o.strip().rstrip("/") for o in os.environ.get("CLERK_AUTHORIZED_PARTIES", "").split(",") if o.strip()}


_JWKS: dict[str, Any] = {"at": 0.0, "keys": {}}


async def _signing_key(kid: str):
    # Refresh hourly, or for an unseen key id (rotation) at most once a minute,
    # so forged tokens with random kids can't make us hammer Clerk.
    age = time.time() - _JWKS["at"]
    if age > 3600 or (kid not in _JWKS["keys"] and age > JWKS_MIN_REFRESH_SECONDS):
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"https://{frontend_api()}/.well-known/jwks.json")
            resp.raise_for_status()
        _JWKS["keys"] = {k["kid"]: jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(k)) for k in resp.json()["keys"]}
        _JWKS["at"] = time.time()
    key = _JWKS["keys"].get(kid)
    if key is None:
        raise AuthError("unknown signing key")
    return key


async def verify_claims(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("sign in required")
    token = authorization.split(" ", 1)[1].strip()
    try:
        kid = jwt.get_unverified_header(token).get("kid")
        claims = jwt.decode(token, await _signing_key(kid), algorithms=["RS256"], leeway=30,
                            options={"verify_aud": False, "require": ["exp", "sub"]})
    except AuthError:
        raise
    except Exception as exc:
        raise AuthError("invalid session") from exc
    if claims.get("iss") and frontend_api() not in claims["iss"]:
        raise AuthError("session from another Clerk instance")
    allowed = authorized_parties()
    if allowed and claims.get("azp") and claims["azp"].rstrip("/") not in allowed:
        raise AuthError("session issued for another site")
    return claims


async def current_user(request: Request) -> User:
    """FastAPI dependency: the verified caller, or 401."""
    cached = getattr(request.state, "user", None)
    if cached is not None:
        return cached
    if not sign_in_required():
        user = User(os.environ.get("DEV_USER_ID", "dev-user"), {"dev": True})
    else:
        try:
            claims = await verify_claims(request.headers.get("authorization"))
        except AuthError as exc:
            raise HTTPException(status_code=401, detail=f"Sign in to continue ({exc}).",
                                headers={"WWW-Authenticate": "Bearer"}) from exc
        user = User(claims["sub"], claims)
    request.state.user = user
    return user


def require_self(user_id: str, user: User) -> None:
    """For the legacy /{user_id} routes: the path must name the caller."""
    if user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only access your own data.")


def is_admin(user: User) -> bool:
    ids = {u.strip() for u in os.environ.get("ADMIN_USER_IDS", "").split(",") if u.strip()}
    return user.id in ids
