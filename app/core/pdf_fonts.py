"""F0a: Thai-capable fonts for PDF documents (reportlab).

reportlab's built-in Helvetica has no Thai glyphs, so Thai names and
addresses would print as empty boxes. IBM Plex Sans Thai (the same family the
web UI uses; SIL Open Font License 1.1, see app/assets/fonts/OFL.txt) is
embedded instead.

Known limit (verified on a rendered sample, F0a): reportlab 4.2.2 does not
run complex text shaping, so a tone mark over an upper vowel (e.g. the tone
mark in "ที่", "ซื้อ", "ดื่ม") is drawn on top of the vowel instead of above
it. reportlab >= 5 with uharfbuzz and ``ParagraphStyle(shaping=1)`` draws it
correctly; that upgrade is a separate, approved-on-its-own change and must
land before any customer-facing Thai document (F2) is printed.
"""
from pathlib import Path

from reportlab.lib.fonts import addMapping
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

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
