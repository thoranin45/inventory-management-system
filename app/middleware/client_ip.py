"""Trusted client-IP resolution.

The socket peer is used unless a known number of reverse proxies sit in front
of the application (``settings.trusted_proxy_count``). Only that many trailing
hops of ``X-Forwarded-For`` are trusted; a longer, attacker-supplied chain is
ignored. An arbitrary public ``X-Forwarded-For`` is never trusted.
"""
from fastapi import Request

from app.core.config import settings


def resolve_client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "-"

    hops = settings.trusted_proxy_count
    if hops <= 0:
        return peer

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return peer

    chain = [part.strip() for part in forwarded.split(",") if part.strip()]
    if not chain:
        return peer

    # Trust only the Nth-from-last hop (the address the outermost trusted
    # proxy saw). If the chain is shorter than the trusted depth, fall back to
    # the left-most entry.
    index = max(0, len(chain) - hops)
    return chain[index]
