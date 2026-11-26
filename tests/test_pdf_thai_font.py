"""F0a/F1-0: Thai text in PDFs uses an embedded Thai font and is shaped."""
import os
from pathlib import Path

import reportlab
import uharfbuzz

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from app.core.pdf_fonts import FONT_DIR, THAI_FONT, THAI_FONT_BOLD, register_thai_fonts, thai_style

SAMPLE_LINES = [
    "ใบแจ้งหนี้ / INVOICE  INV-2026-0001",
    "ผู้ซื้อ: บริษัท ตัวอย่าง จำกัด (สำนักงานใหญ่ 00000)",
    "ที่อยู่: 99 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310",
    "รายการ: น้ำดื่ม 600 มล. จำนวน 1.125 ลัง ราคา 1,234.50 บาท",
    "วรรณยุกต์ซ้อน: ที่ นี่ ปู่ ผู้ เสื้อ ป้า ก๊ก จ๋า ฟ้า ญี่ปุ่น ฎีกา ฐาน",
]


def build_sample(path: Path, *, shaped: bool = True) -> Path:
    if shaped:
        body = thai_style("th", fontSize=12, leading=20)
        title = thai_style("th-title", bold=True, fontSize=16, leading=26)
    else:  # the pre-F1-0 behaviour, kept only to prove shaping changes the output
        regular, bold = register_thai_fonts()
        body = ParagraphStyle("th", fontName=regular, fontSize=12, leading=20)
        title = ParagraphStyle("th-title", parent=body, fontName=bold, fontSize=16, leading=26)
    story = [Paragraph(SAMPLE_LINES[0], title), Spacer(1, 8)]
    story += [Paragraph(line, body) for line in SAMPLE_LINES[1:]]
    SimpleDocTemplate(str(path), pagesize=A4, invariant=1).build(story)
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


def test_reportlab_can_shape_thai():
    assert int(reportlab.Version.split(".")[0]) >= 5   # 4.x has no shaping
    style = thai_style("probe")
    assert style.shaping == 1
    assert style.fontName == THAI_FONT
    assert thai_style("probe-bold", bold=True).fontName == THAI_FONT_BOLD


def test_font_shaping_moves_the_tone_mark_off_the_upper_vowel():
    # "ที่" = tho thahan + sara ii + mai ek. Shaped, the tone mark becomes the
    # font's raised ".small" variant instead of the base glyph that overlaps.
    font = uharfbuzz.Font(uharfbuzz.Face(uharfbuzz.Blob.from_file_path(str(FONT_DIR / "IBMPlexSansThai-Regular.ttf"))))
    buf = uharfbuzz.Buffer()
    buf.add_str("ที่")
    buf.guess_segment_properties()
    uharfbuzz.shape(font, buf, {})
    names = [font.glyph_to_string(info.codepoint) for info in buf.glyph_infos]
    assert names[-1] != "uni0E48" and names[-1].startswith("uni0E48.")


def test_shaping_changes_the_rendered_pdf(tmp_path):
    shaped = build_sample(tmp_path / "shaped.pdf").read_bytes()
    plain = build_sample(tmp_path / "plain.pdf", shaped=False).read_bytes()
    # invariant=1 makes the same input render to identical bytes (no date or
    # random id), so any difference here comes from shaping alone
    assert build_sample(tmp_path / "plain2.pdf", shaped=False).read_bytes() == plain
    assert shaped != plain
