"""F0a: Thai text in PDFs uses an embedded Thai font (not Helvetica)."""
import os
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from app.core.pdf_fonts import FONT_DIR, THAI_FONT, THAI_FONT_BOLD, register_thai_fonts

SAMPLE_LINES = [
    "ใบแจ้งหนี้ / INVOICE  INV-2026-0001",
    "ผู้ซื้อ: บริษัท ตัวอย่าง จำกัด (สำนักงานใหญ่ 00000)",
    "ที่อยู่: 99 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310",
    "รายการ: น้ำดื่ม 600 มล. จำนวน 1.125 ลัง ราคา 1,234.50 บาท",
    "วรรณยุกต์ซ้อน: ที่ นี่ ปู่ ผู้ เสื้อ ป้า ก๊ก จ๋า ฟ้า ญี่ปุ่น ฎีกา ฐาน",
]


def build_sample(path: Path) -> Path:
    regular, bold = register_thai_fonts()
    body = ParagraphStyle("th", fontName=regular, fontSize=12, leading=20)
    title = ParagraphStyle("th-title", parent=body, fontName=bold, fontSize=16, leading=26)
    story = [Paragraph(SAMPLE_LINES[0], title), Spacer(1, 8)]
    story += [Paragraph(line, body) for line in SAMPLE_LINES[1:]]
    SimpleDocTemplate(str(path), pagesize=A4).build(story)
    return path


def test_fonts_and_license_ship_with_the_app():
    for name in ("IBMPlexSansThai-Regular.ttf", "IBMPlexSansThai-Bold.ttf", "OFL.txt"):
        assert (FONT_DIR / name).is_file(), name
    assert "SIL Open Font License" in (FONT_DIR / "OFL.txt").read_text(encoding="utf-8")


def test_registration_is_idempotent():
    assert register_thai_fonts() == (THAI_FONT, THAI_FONT_BOLD)
    assert register_thai_fonts() == (THAI_FONT, THAI_FONT_BOLD)


def test_thai_sample_pdf_embeds_the_thai_font(tmp_path):
    pdf = build_sample(tmp_path / "thai-sample.pdf").read_bytes()
    assert pdf.startswith(b"%PDF")
    assert b"FontFile2" in pdf                 # a TrueType font program is embedded
    assert b"IBMPlexSansThai" in pdf
    out = os.environ.get("THAI_SAMPLE_PDF")   # set to keep a copy for visual review
    if out:
        Path(out).write_bytes(pdf)
