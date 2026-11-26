"""F0a: Thai-capable fonts for PDF documents (reportlab).

reportlab's built-in Helvetica has no Thai glyphs, so Thai names and
addresses would print as empty boxes. IBM Plex Sans Thai (the same family the
web UI uses; SIL Open Font License 1.1, see app/assets/fonts/OFL.txt) is
embedded instead.

Thai needs complex text shaping: a tone mark over an upper vowel (e.g. the
tone mark in "ที่", "ซื้อ", "ดื่ม") must be moved or swapped for a variant glyph,
or it is drawn on top of the vowel. reportlab 5 does this with uharfbuzz, but
only for a paragraph style with ``shaping=1``. Build every Thai paragraph
style with ``thai_style()`` so shaping is never forgotten (F1-0; reportlab
4.2.2 could not shape at all, verified on a rendered sample in F0a).
"""
from pathlib import Path

from reportlab.lib.fonts import addMapping
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

try:  # reportlab shapes text only when uharfbuzz is importable
    import uharfbuzz  # noqa: F401
except ImportError:  # pragma: no cover - requirements.txt pins it
    uharfbuzz = None

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
THAI_FONT = "IBMPlexSansThai"
THAI_FONT_BOLD = "IBMPlexSansThai-Bold"

_FILES = {
    THAI_FONT: "IBMPlexSansThai-Regular.ttf",
    THAI_FONT_BOLD: "IBMPlexSansThai-Bold.ttf",
}


def register_thai_fonts() -> tuple[str, str]:
    """Register the Thai fonts once; returns (regular, bold) font names."""
    registered = set(pdfmetrics.getRegisteredFontNames())
    for name, filename in _FILES.items():
        if name not in registered:
            pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
    addMapping(THAI_FONT, 0, 0, THAI_FONT)
    addMapping(THAI_FONT, 1, 0, THAI_FONT_BOLD)
    addMapping(THAI_FONT, 0, 1, THAI_FONT)
    addMapping(THAI_FONT, 1, 1, THAI_FONT_BOLD)
    return THAI_FONT, THAI_FONT_BOLD


def thai_style(name: str, *, bold: bool = False, **kwargs) -> ParagraphStyle:
    """A ParagraphStyle in the Thai font with text shaping switched on.

    Raises if shaping cannot run (uharfbuzz missing), so a document never
    silently prints misplaced Thai tone marks.
    """
    regular, bold_name = register_thai_fonts()
    if uharfbuzz is None or not pdfmetrics.getFont(regular).shapable:
        raise RuntimeError("Thai PDF text needs uharfbuzz for shaping; install requirements.txt")
    kwargs.setdefault("fontName", bold_name if bold else regular)
    return ParagraphStyle(name, shaping=1, **kwargs)
