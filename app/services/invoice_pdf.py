"""F2a: invoice and adjustment note PDFs (A4, Thai + English, shaped Thai text).

Rendered on the fly from the document's own snapshots, never from live master
data, and never written to disk. Same layout as the quotation PDF.
"""
from decimal import Decimal
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.pdf_fonts import thai_style
from app.models import AdjustmentNote, Invoice
from app.services.quotation_pdf import _date, _money, _p, _qty, baht_text, customer_box, seller_lines

_LINE_STYLE = TableStyle([
    ("LINEABOVE", (0, 0), (-1, 0), 0.8, colors.black),
    ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.black),
    ("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.black),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F2F2")),
])


def _styles(prefix: str) -> dict:
    return {
        "body": thai_style(f"{prefix}-body", fontSize=9.5, leading=14),
        "small": thai_style(f"{prefix}-small", fontSize=8.5, leading=12, textColor=colors.HexColor("#555555")),
        "bold": thai_style(f"{prefix}-bold", bold=True, fontSize=9.5, leading=14),
        "right": thai_style(f"{prefix}-right", fontSize=9.5, leading=14, alignment=TA_RIGHT),
        "right_bold": thai_style(f"{prefix}-right-bold", bold=True, fontSize=10.5, leading=15, alignment=TA_RIGHT),
        "title": thai_style(f"{prefix}-title", bold=True, fontSize=16, leading=22, alignment=TA_RIGHT),
        "seller": thai_style(f"{prefix}-seller", bold=True, fontSize=12, leading=17),
    }


def _build(title: str, head: list[str], seller: dict, customer: dict, lines: Table, totals: list,
           grand_total, notes: str | None, signatures: tuple[str, str], s: dict, pdf_title: str) -> bytes:
    head_right = [_p(title, s["title"]), Spacer(1, 4)] + [_p(text, s["right"]) for text in head]
    header = Table([[seller_lines(seller, s["body"], s["small"], s["seller"]), head_right]],
                   colWidths=[105 * mm, 75 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    totals_table = Table(totals, colWidths=[148 * mm, 32 * mm])
    totals_table.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.black),
                                      ("LINEBELOW", (0, -1), (-1, -1), 1.2, colors.black)]))
    story = [header, Spacer(1, 8), customer_box(customer, s["body"], s["small"], s["bold"]), Spacer(1, 8),
             lines, Spacer(1, 4), totals_table, Spacer(1, 4),
             _p(f"({baht_text(Decimal(grand_total))})", s["right"]), Spacer(1, 10)]
    if notes:
        story += [_p("หมายเหตุ / Notes", s["bold"]), _p(notes, s["body"]), Spacer(1, 8)]
    if not seller.get("vat_registered"):
        story.append(_p("เอกสารนี้ไม่ใช่ใบกำกับภาษี / This document is not a tax invoice.", s["small"]))
    sign = Table([[
        [Spacer(1, 18), _p("......................................", s["body"]), _p(signatures[0], s["small"])],
        [Spacer(1, 18), _p("......................................", s["body"]), _p(signatures[1], s["small"])],
    ]], colWidths=[90 * mm, 90 * mm])
    story += [Spacer(1, 18), sign]
    buffer = BytesIO()
    SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
        title=pdf_title, author=seller.get("legal_name_en") or "",
    ).build(story)
    return buffer.getvalue()


def _vat_rows(document, seller: dict, s: dict) -> list:
    if not seller.get("vat_registered"):
        return []
    rate = seller.get("vat_rate") or "7.00"
    return [[_p("มูลค่าก่อนภาษี / Amount before VAT", s["right"]), _p(_money(document.vat_base), s["right"])],
            [_p(f"ภาษีมูลค่าเพิ่ม / VAT {rate}%", s["right"]), _p(_money(document.vat_amount), s["right"])]]


def render_invoice_pdf(invoice: Invoice, sales_order_number: str | None, quotation_number: str | None) -> bytes:
    s = _styles("inv")
    seller = invoice.seller_snapshot or {}
    head = [f"เลขที่ / No. {invoice.invoice_number}", f"วันที่ / Date {_date(invoice.issue_date)}",
            f"ครบกำหนด / Due {_date(invoice.due_date)}"
            + (f" ({invoice.credit_days} วัน / days)" if invoice.credit_days else " (เงินสด / Cash)")]
    if sales_order_number:
        head.append(f"ใบสั่งขาย / Sales order {sales_order_number}")
    if quotation_number:
        head.append(f"ใบเสนอราคา / Quotation {quotation_number}")
    if invoice.status == "VOID":
        head.append("ยกเลิกแล้ว / VOID")

    has_discount = any(item.discount_amount for item in invoice.items)
    header_row = [_p("#", s["bold"]), _p("รายการ / Description", s["bold"]), _p("จำนวน / Qty", s["right"]),
                  _p("ราคาต่อหน่วย / Unit price", s["right"])]
    widths = [10 * mm, 82 * mm, 24 * mm, 32 * mm, 32 * mm]
    if has_discount:
        header_row.append(_p("ส่วนลด / Discount", s["right"]))
        widths = [10 * mm, 66 * mm, 22 * mm, 28 * mm, 24 * mm, 30 * mm]
    header_row.append(_p("จำนวนเงิน / Amount", s["right"]))
    rows = [header_row]
    for item in invoice.items:
        row = [_p(item.line_no, s["body"]), _p(item.description, s["body"]), _p(_qty(item.quantity), s["right"]),
               _p(_money(item.unit_price), s["right"])]
        if has_discount:
            row.append(_p(_money(item.discount_amount) if item.discount_amount else "-", s["right"]))
        row.append(_p(_money(item.line_total), s["right"]))
        rows.append(row)
    lines = Table(rows, colWidths=widths, repeatRows=1)
    lines.setStyle(_LINE_STYLE)

    totals = [[_p("รวมเป็นเงิน / Subtotal", s["right"]), _p(_money(invoice.subtotal), s["right"])]]
    if invoice.discount_total:
        totals.append([_p("ส่วนลด / Discount", s["right"]), _p(_money(invoice.discount_total), s["right"])])
    totals += _vat_rows(invoice, seller, s)
    totals.append([_p("ยอดรวมทั้งสิ้น / Grand total (THB)", s["right_bold"]),
                   _p(_money(invoice.grand_total), s["right_bold"])])
    return _build("ใบแจ้งหนี้ / INVOICE", head, seller, invoice.customer_snapshot or {}, lines, totals,
                  invoice.grand_total, invoice.notes, ("ผู้วางบิล / Issued by", "ผู้รับวางบิล / Received by"),
                  s, f"Invoice {invoice.invoice_number}")


def render_adjustment_pdf(note: AdjustmentNote, invoice: Invoice, receipt_number: str | None) -> bytes:
    s = _styles("adj")
    seller = note.seller_snapshot or {}
    head = [f"เลขที่ / No. {note.adjustment_number}", f"วันที่ / Date {_date(note.issue_date)}",
            f"อ้างอิงใบแจ้งหนี้ / Invoice {invoice.invoice_number} ({_date(invoice.issue_date)})"]
    if receipt_number:
        head.append(f"ใบรับคืน / Return {receipt_number}")
    if note.status == "VOID":
        head.append("ยกเลิกแล้ว / VOID")
    rows = [[_p("#", s["bold"]), _p("รายการ / Description", s["bold"]), _p("จำนวน / Qty", s["right"]),
             _p("ลดต่อหน่วย / Reduction per unit", s["right"]), _p("จำนวนเงิน / Amount", s["right"])]]
    for item in note.items:
        rows.append([_p(item.line_no, s["body"]), _p(item.description, s["body"]), _p(_qty(item.quantity), s["right"]),
                     _p(_money(item.unit_price), s["right"]), _p(_money(item.line_total), s["right"])])
    lines = Table(rows, colWidths=[10 * mm, 82 * mm, 24 * mm, 32 * mm, 32 * mm], repeatRows=1)
    lines.setStyle(_LINE_STYLE)
    totals = [[_p("มูลค่าตามใบแจ้งหนี้เดิม / Original invoice total", s["right"]),
               _p(_money(invoice.grand_total), s["right"])],
              [_p("รวมเป็นเงิน / Subtotal", s["right"]), _p(_money(note.subtotal), s["right"])]]
    totals += _vat_rows(note, seller, s)
    totals.append([_p("ยอดลดหนี้ / Adjustment total (THB)", s["right_bold"]),
                   _p(_money(note.grand_total), s["right_bold"])])
    return _build("ใบลดหนี้ (เอกสารภายใน) / ADJUSTMENT NOTE", head, seller, note.customer_snapshot or {},
                  lines, totals, note.grand_total, f"เหตุผล / Reason: {note.reason}",
                  ("ผู้ออกเอกสาร / Issued by", "ผู้รับ / Received by"), s, f"Adjustment {note.adjustment_number}")
