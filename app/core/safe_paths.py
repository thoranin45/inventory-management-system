"""Helpers for building filesystem paths from data that may be user-influenced.

Rule of thumb for Phase 9: derive generated-file names from a numeric database
id plus a fixed extension. Never interpolate a raw ``sku`` / ``barcode`` /
``lot_no`` / order string into a path. Where a name must contain a domain
identifier, sanitise it and then assert the resolved path stays inside its
base directory.
"""
from pathlib import Path

_SAFE_CHARS = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"
)


def safe_component(value: object, *, fallback: str = "item") -> str:
    """Reduce ``value`` to a single safe path component.

    Strips directory separators and anything outside ``[A-Za-z0-9._-]``,
    collapses leading dots, and never returns an empty string.
    """
    text = str(value or "")
    cleaned = "".join(ch if ch in _SAFE_CHARS else "_" for ch in text)
    # Strip any mix of leading/trailing separators-turned-underscores and dots
    # so the result can never be a dotfile or a "."/".." fragment.
    cleaned = cleaned.strip("._")
    return cleaned or fallback


def resolve_within(base_dir: str | Path, *parts: str) -> Path:
    """Join ``parts`` onto ``base_dir`` and confirm containment.

    Raises ``ValueError`` if the resolved path escapes ``base_dir`` (defence in
    depth even after :func:`safe_component`).
    """
    base = Path(base_dir).resolve()
    candidate = base.joinpath(*parts).resolve()
    if base != candidate and base not in candidate.parents:
        raise ValueError("Resolved path escapes its base directory")
    return candidate
