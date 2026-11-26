"""F0a: money arithmetic for finance documents.

Rules (one place, so every document rounds the same way):
- Decimal only. A float is refused, never converted: ``0.1 + 0.2`` is not 0.3.
- Quantities have at most 3 decimal places, prices and amounts at most 2.
- Each line is rounded to 0.01 with ROUND_HALF_UP, then lines are summed.
- VAT is computed once on the document total, never per line.
- When the business is not VAT-registered, there is no VAT: the grand total
  is the sum of the lines.
"""
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Iterable

CENT = Decimal("0.01")
_QTY_STEP = Decimal("0.001")
_HUNDRED = Decimal("100")


def _decimal(value, name: str, step: Decimal) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (Decimal, int, str)):
        raise TypeError(f"{name} must be Decimal, int or str, not {type(value).__name__}")
    number = Decimal(value)
    if not number.is_finite():
        raise ValueError(f"{name} must be finite")
    if number < 0:
        raise ValueError(f"{name} must not be negative")
    try:
        exact = number == number.quantize(step)
    except InvalidOperation:
        raise ValueError(f"{name} is too large") from None
    if not exact:
        raise ValueError(f"{name} has more than {abs(step.as_tuple().exponent)} decimal places")
    return abs(number)  # normalises -0 to 0


def money(value) -> Decimal:
    """A non-negative amount with at most 2 decimal places, as Decimal('x.xx')."""
    return _decimal(value, "amount", CENT).quantize(CENT)


def round_money(value: Decimal) -> Decimal:
    """Round any Decimal to 0.01, half up (0.005 -> 0.01)."""
    if not isinstance(value, Decimal):
        raise TypeError("round_money takes a Decimal")
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Line:
    quantity: Decimal
    unit_price: Decimal
    discount: Decimal = Decimal("0")


def line_amount(quantity, unit_price, discount=Decimal("0")) -> Decimal:
    """Quantity x unit price, rounded to 0.01 half up, minus the line discount."""
    qty = _decimal(quantity, "quantity", _QTY_STEP)
    price = money(unit_price)
    off = money(discount)
    gross = round_money(qty * price)
    if off > gross:
        raise ValueError("line discount is larger than the line amount")
    return gross - off


@dataclass(frozen=True)
class DocumentTotals:
    subtotal: Decimal        # sum of rounded line amounts before any discount
    discount_total: Decimal  # line discounts + document discount
    vat_base: Decimal        # amount VAT is charged on (= net when VAT is off)
    vat_amount: Decimal
    grand_total: Decimal     # what the customer pays


def document_totals(
    lines: Iterable[Line],
    *,
    vat_registered: bool,
    vat_rate=Decimal("7.00"),
    prices_include_vat: bool = False,
    document_discount=Decimal("0"),
) -> DocumentTotals:
    if type(vat_registered) is not bool or type(prices_include_vat) is not bool:
        raise TypeError("vat_registered and prices_include_vat must be bool")
    subtotal = Decimal("0.00")
    line_discounts = Decimal("0.00")
    for line in lines:
        gross = round_money(_decimal(line.quantity, "quantity", _QTY_STEP) * money(line.unit_price))
        off = money(line.discount)
        if off > gross:
            raise ValueError("line discount is larger than the line amount")
        subtotal += gross
        line_discounts += off

    doc_off = money(document_discount)
    net = subtotal - line_discounts - doc_off
    if net < 0:
        raise ValueError("discounts are larger than the document subtotal")
    discount_total = line_discounts + doc_off

    if not vat_registered:
        return DocumentTotals(subtotal, discount_total, net, Decimal("0.00"), net)

    rate = money(vat_rate)
    if rate > _HUNDRED:
        raise ValueError("vat_rate must be between 0 and 100")
    if prices_include_vat:
        vat_base = round_money(net * _HUNDRED / (_HUNDRED + rate))
        vat_amount = net - vat_base
        grand_total = net
    else:
        vat_base = net
        vat_amount = round_money(net * rate / _HUNDRED)
        grand_total = net + vat_amount
    return DocumentTotals(subtotal, discount_total, vat_base, vat_amount, grand_total)
