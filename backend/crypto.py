"""Encryption at rest for Plaid access tokens (bearer credentials to a
user's bank data). FERNET_KEY is a urlsafe base64 32-byte key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
Rotate by setting FERNET_KEY to the new key and FERNET_OLD_KEYS to a
comma-separated list of previous keys; old tokens still decrypt and are
re-encrypted with the new key on their next write.
"""
import os
from functools import lru_cache

from cryptography.fernet import Fernet, MultiFernet


@lru_cache(maxsize=1)
def _fernet() -> MultiFernet:
    key = os.environ.get("FERNET_KEY")
    if not key:
        raise RuntimeError("FERNET_KEY is required to store linked-account credentials.")
    old = [k.strip() for k in os.environ.get("FERNET_OLD_KEYS", "").split(",") if k.strip()]
    return MultiFernet([Fernet(key)] + [Fernet(k) for k in old])


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()
