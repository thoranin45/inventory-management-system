"""F1a: quotation PDF (A4, Thai + English labels, shaped Thai text).

Rendered on the fly from the quotation's own snapshots (seller, customer,
lines, totals), never from live master data, and never written to disk.
"""
from datetime import date
from decimal import Decimal
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.pdf_fonts import thai_style
from app.models import Quotation

_DIGITS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]


def _read_under_million(number: int, has_higher: bool = False) -> str:
    text = ""
    digits = str(number)
    size = len(digits)
    for index, char in enumerate(digits):
        digit = int(char)
        place = size - index - 1
        if digit == 0:
            continue
        if place == 0 and digit == 1 and (size > 1 or has_higher):
            text += "เอ็ด"
        elif place == 1 and digit == 2:
            text += "ยี่สิบ"
        elif place == 1 and digit == 1:
            text += "สิบ"
        else:
            text += _DIGITS[digit] + _PLACES[place]
    return text


def _read_number(number: int) -> str:
    if number == 0:
        return "ศูนย์"
    millions, rest = divmod(number, 1_000_000)
    text = _read_number(millions) + "ล้าน" if millions else ""
    return text + (_read_under_million(rest, has_higher=bool(millions)) if rest else "")


def baht_text(amount: Decimal) -> str:
    """Thai words for an amount in baht, e.g. 1021.50 -> หนึ่งพันยี่สิบเอ็ดบาทห้าสิบสตางค์."""
    cents_total = int((amount * 100).to_integral_value())
    if cents_total < 0:
        raise ValueError("amount must not be negative")
    baht, satang = divmod(cents_total, 100)
    if baht == 0 and satang == 0:
        return "ศูนย์บาทถ้วน"
    text = _read_number(baht) + "บาท" if baht else ""
    return text + (_read_number(satang) + "สตางค์" if satang else "ถ้วน")


def _money(value) -> str:
    return f"{Decimal(value):,.2f}"


def _qty(value) -> str:
    text = format(Decimal(value).quantize(Decimal("0.001")), ",f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _date(value: date | None) -> str:
    return value.strftime("%d/%m/%Y") if value else "-"


def _p(text, style) -> Paragraph:
    return Paragraph(escape(str(text or "")).replace("\n", "<br/>"), style)


def render_quotation_pdf(quotation: Quotation) -> bytes:
    body = thai_style("qt-body", fontSize=9.5, leading=14)
    small = thai_style("qt-small", fontSize=8.5, leading=12, textColor=colors.HexColor("#555555"))
    bold = thai_style("qt-bold", bold=True, fontSize=9.5, leading=14)
    right = thai_style("qt-right", fontSize=9.5, leading=14, alignment=TA_RIGHT)
    right_bold = thai_style("qt-right-bold", bold=True, fontSize=10.5, leading=15, alignment=TA_RIGHT)
    title = thai_style("qt-title", bold=True, fontSize=16, leading=22, alignment=TA_RIGHT)
    seller_name_style = thai_style("qt-seller", bold=True, fontSize=12, leading=17)

    seller = quotation.seller_snapshot or {}
    customer = quotation.customer_snapshot or {}

    seller_lines = [_p(seller.get("legal_name_th") or seller.get("legal_name_en") or "-", seller_name_style)]
    if seller.get("legal_name_th") and seller.get("legal_name_en"):
        seller_lines.append(_p(seller["legal_name_en"], body))
    for key in ("address_th", "address_en"):
        if seller.get(key):
            seller_lines.append(_p(seller[key], small))
    contact = "  ".join(filter(None, [
        f"โทร / Tel {seller['phone']}" if seller.get("phone") else None,
        seller.get("email"),
    ]))
    if contact:
        seller_lines.append(_p(contact, small))
    if seller.get("tax_id"):
        branch = seller.get("branch_code")
        branch_text = "สำนักงานใหญ่ / Head office" if branch in (None, "00000") else f"สาขา / Branch {branch}"
        seller_lines.append(_p(f"เลขประจำตัวผู้เสียภาษี / Tax ID {seller['tax_id']}  {branch_text}", small))

    head_right = [
        _p("ใบเสนอราคา / QUOTATION", title),
        Spacer(1, 4),
        _p(f"เลขที่ / No. {quotation.quotation_number}", right),
        _p(f"วันที่ / Date {_date(quotation.issue_date)}", right),
        _p(f"ยืนราคาถึง / Valid until {_date(quotation.valid_until)}", right),
    ]
    header = Table([[seller_lines, head_right]], colWidths=[105 * mm, 75 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))

    customer_lines = [_p("ลูกค้า / Customer", small), _p(customer.get("name") or "-", bold)]
    if customer.get("address"):
        customer_lines.append(_p(customer["address"], body))
    if customer.get("tax_id"):
        branch = customer.get("branch_code")
        branch_text = "" if branch is None else (
            "  สำนักงานใหญ่ / Head office" if branch == "00000" else f"  สาขา / Branch {branch}")
        customer_lines.append(_p(f"เลขประจำตัวผู้เสียภาษี / Tax ID {customer['tax_id']}{branch_text}", small))
    customer_box = Table([[customer_lines]], colWidths=[180 * mm])
    customer_box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#999999")),
                                      ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 4),
                                      ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))

    rows = [[_p("#", bold), _p("รายการ / Description", bold), _p("จำนวน / Qty", right),
             _p("ราคาต่อหน่วย / Unit price", right), _p("จำนวนเงิน / Amount", right)]]
    for item in quotation.items:
        rows.append([_p(item.line_no, body), _p(item.description, body), _p(_qty(item.quantity), right),
                     _p(_money(item.unit_price), right), _p(_money(item.line_total), right)])
    lines = Table(rows, colWidths=[10 * mm, 82 * mm, 24 * mm, 32 * mm, 32 * mm], repeatRows=1)
    lines.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.8, colors.black),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.black),
        ("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F2F2")),
    ]))

    vat_on = bool(seller.get("vat_registered"))
    totals = [[_p("รวมเป็นเงิน / Subtotal", right), _p(_money(quotation.subtotal), right)]]
    if vat_on:
        rate = seller.get("vat_rate") or "7.00"
        totals += [[_p("มูลค่าก่อนภาษี / Amount before VAT", right), _p(_money(quotation.vat_base), right)],
                   [_p(f"ภาษีมูลค่าเพิ่ม / VAT {rate}%", right), _p(_money(quotation.vat_amount), right)]]
    totals.append([_p("ยอดรวมทั้งสิ้น / Grand total (THB)", right_bold), _p(_money(quotation.grand_total), right_bold)])
    totals_table = Table(totals, colWidths=[148 * mm, 32 * mm])
    totals_table.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.black),
                                      ("LINEBELOW", (0, -1), (-1, -1), 1.2, colors.black)]))

    story = [header, Spacer(1, 8), customer_box, Spacer(1, 8), lines, Spacer(1, 4), totals_table,
             Spacer(1, 4), _p(f"({baht_text(Decimal(quotation.grand_total))})", right), Spacer(1, 10)]
    if quotation.notes:
        story += [_p("หมายเหตุ / Notes", bold), _p(quotation.notes, body), Spacer(1, 8)]
    if not vat_on:
        story.append(_p("เอกสารนี้ไม่ใช่ใบกำกับภาษี / This document is not a tax invoice.", small))

    signatures = Table([[
        [Spacer(1, 18), _p("......................................", body), _p("ผู้เสนอราคา / Authorized by", small)],
        [Spacer(1, 18), _p("......................................", body), _p("ผู้อนุมัติซื้อ / Accepted by", small)],
    ]], colWidths=[90 * mm, 90 * mm])
    story += [Spacer(1, 18), signatures]

    buffer = BytesIO()
    SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Quotation {quotation.quotation_number}", author=seller.get("legal_name_en") or "",
    ).build(story)
    return buffer.getvalue()
