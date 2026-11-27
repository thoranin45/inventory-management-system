"""F3a: receipt and billing note PDFs (A4, Thai + English), same layout as the invoice PDF.

Rendered on the fly from the document's own snapshots; never written to disk.
"""
from reportlab.lib.units import mm
from reportlab.platypus import Table

from app.models import BillingNote, PaymentReceipt
from app.services.invoice_pdf import _LINE_STYLE, _build, _styles
from app.services.quotation_pdf import _date, _money, _p

METHOD_LABELS = {
    "CASH": "เงินสด / Cash",
    "TRANSFER": "โอนเงิน / Bank transfer",
    "CHEQUE": "เช็ค / Cheque",
    "OTHER": "อื่นๆ / Other",
}


def render_receipt_pdf(receipt: PaymentReceipt, invoice_numbers: dict[int, str | None],
                       invoice_dates: dict[int, object]) -> bytes:
    s = _styles("rc")
    seller = receipt.seller_snapshot or {}
    head = [f"เลขที่ / No. {receipt.receipt_number}", f"วันที่รับเงิน / Received {_date(receipt.received_date)}",
            f"ชำระโดย / Paid by {METHOD_LABELS.get(receipt.method, receipt.method)}"]
    if receipt.reference:
        head.append(f"อ้างอิง / Ref. {receipt.reference}")
    if receipt.status == "VOID":
        head.append("ยกเลิกแล้ว / VOID")
    has_wht = bool(receipt.wht_total)
    header = [_p("#", s["bold"]), _p("ใบแจ้งหนี้ / Invoice", s["bold"]), _p("วันที่ / Date", s["bold"])]
    widths = [10 * mm, 70 * mm, 36 * mm, 64 * mm]
    if has_wht:
        header += [_p("รับเงิน / Received", s["right"]), _p("หัก ณ ที่จ่าย / WHT", s["right"])]
        widths = [10 * mm, 52 * mm, 28 * mm, 30 * mm, 30 * mm, 30 * mm]
    header.append(_p("ชำระหนี้ / Settled", s["right"]))
    rows = [header]
    for a in receipt.allocations:
        row = [_p(a.line_no, s["body"]), _p(invoice_numbers.get(a.invoice_id) or f"#{a.invoice_id}", s["body"]),
               _p(_date(invoice_dates.get(a.invoice_id)), s["body"])]
        if has_wht:
            certificate = f" ({a.wht_certificate_no})" if a.wht_certificate_no else ""
            row += [_p(_money(a.amount), s["right"]), _p(_money(a.wht_amount) + certificate, s["right"])]
        row.append(_p(_money(a.amount + a.wht_amount), s["right"]))
        rows.append(row)
    lines = Table(rows, colWidths=widths, repeatRows=1)
    lines.setStyle(_LINE_STYLE)
    totals = []
    if has_wht:
        totals += [[_p("ชำระหนี้รวม / Total settled", s["right"]), _p(_money(receipt.settled_total), s["right"])],
                   [_p("หัก ณ ที่จ่าย / Withholding tax", s["right"]), _p(_money(receipt.wht_total), s["right"])]]
    totals.append([_p("รับเงินสุทธิ / Amount received (THB)", s["right_bold"]),
                   _p(_money(receipt.amount_total), s["right_bold"])])
    return _build("ใบเสร็จรับเงิน / RECEIPT", head, seller, receipt.customer_snapshot or {}, lines, totals,
                  receipt.amount_total, receipt.notes, ("ผู้รับเงิน / Received by", "ผู้จ่ายเงิน / Paid by"),
                  s, f"Receipt {receipt.receipt_number}")


def render_billing_pdf(note: BillingNote, invoices: dict[int, object]) -> bytes:
    s = _styles("bn")
    seller = note.seller_snapshot or {}
    head = [f"เลขที่ / No. {note.billing_number}", f"วันที่ / Date {_date(note.issue_date)}"]
    if note.payment_due_date:
        head.append(f"กำหนดชำระ / Payment due {_date(note.payment_due_date)}")
    if note.status == "VOID":
        head.append("ยกเลิกแล้ว / VOID")
    rows = [[_p("#", s["bold"]), _p("ใบแจ้งหนี้ / Invoice", s["bold"]), _p("วันที่ / Date", s["bold"]),
             _p("ครบกำหนด / Due", s["bold"]), _p("ยอดเต็ม / Invoice total", s["right"]),
             _p("ยอดค้างชำระ / Amount due", s["right"])]]
    for item in note.items:
        invoice = invoices.get(item.invoice_id)
        rows.append([_p(item.line_no, s["body"]),
                     _p(invoice.invoice_number if invoice else f"#{item.invoice_id}", s["body"]),
                     _p(_date(invoice.issue_date) if invoice else "-", s["body"]),
                     _p(_date(invoice.due_date) if invoice else "-", s["body"]),
                     _p(_money(invoice.grand_total) if invoice else "-", s["right"]),
                     _p(_money(item.amount), s["right"])])
    lines = Table(rows, colWidths=[10 * mm, 46 * mm, 28 * mm, 28 * mm, 34 * mm, 34 * mm], repeatRows=1)
    lines.setStyle(_LINE_STYLE)
    totals = [[_p("ยอดรวมที่ต้องชำระ / Total due (THB)", s["right_bold"]),
               _p(_money(note.total_amount), s["right_bold"])]]
    return _build("ใบวางบิล / BILLING NOTE", head, seller, note.customer_snapshot or {}, lines, totals,
                  note.total_amount, note.notes, ("ผู้วางบิล / Billed by", "ผู้รับวางบิล / Received by"),
                  s, f"Billing note {note.billing_number}")
