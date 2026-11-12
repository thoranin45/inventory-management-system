"""R5-SAFE.1B: fulfilment claim tokens.

A claim token is a server-generated, unpredictable opaque bearer value issued to
the authenticated holder of a fulfilment claim. Only its SHA-256 hex digest is
stored (``sales_orders.fulfillment_claim_token_hash``); the raw token never
reaches the database, logs, audit text, errors or read models. A 256-bit random
token makes a salted / slow hash unnecessary: the digest cannot be reversed or
brute-forced.

The guarantee is one active *authorized claim* — not device attestation: any
client presenting the same bearer token (for example a duplicated browser tab)
is the same claim.
"""
import hashlib
import hmac
import secrets

TOKEN_BYTES = 32  # 256 bits of entropy
HASH_LENGTH = 64  # hex SHA-256


def generate_claim_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_claim_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def claim_token_matches(presented: str | None, stored_hash: str | None) -> bool:
    """Constant-time comparison of a presented token against the stored digest."""
    if not presented or not stored_hash or len(stored_hash) != HASH_LENGTH:
        return False
    return hmac.compare_digest(hash_claim_token(presented), stored_hash)
