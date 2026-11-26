"""F0a: money rules for finance documents (app.core.money)."""
from decimal import Decimal as D

import pytest

from app.core.money import DocumentTotals, Line, document_totals, line_amount, money, round_money


def test_round_half_up_to_satang():
    assert round_money(D("0.005")) == D("0.01")
    assert round_money(D("0.0049")) == D("0.00")
    assert round_money(D("2.675")) == D("2.68")  # a float would give 2.67


@pytest.mark.parametrize("qty,price,expected", [
    (D("1.125"), D("10.00"), D("11.25")),
    (D("0.333"), D("3.00"), D("1.00")),   # 0.999 -> 1.00
    (D("2.5"), D("19.99"), D("49.98")),   # 49.975 -> 49.98
    (D("3"), D("33.33"), D("99.99")),
])
def test_line_amount_three_decimal_quantities(qty, price, expected):
    assert line_amount(qty, price) == expected


def test_line_discount_is_subtracted_after_rounding():
    assert line_amount(D("1.125"), D("10.00"), D("1.25")) == D("10.00")
    with pytest.raises(ValueError):
        line_amount(D("1"), D("10.00"), D("10.01"))


@pytest.mark.parametrize("bad", [0.1, 1.5, True])
def test_floats_and_bools_are_refused(bad):
    with pytest.raises(TypeError):
        money(bad)
    with pytest.raises(TypeError):
        line_amount(bad, D("1.00"))


@pytest.mark.parametrize("call", [
    lambda: money(D("1.001")),              # 3 decimals on a price
    lambda: line_amount(D("1.0001"), D("1.00")),  # 4 decimals on a quantity
    lambda: money(D("-1.00")),
    lambda: money(D("NaN")),
])
def test_out_of_scale_negative_and_non_finite_values_are_refused(call):
    with pytest.raises(ValueError):
        call()


def test_vat_off_has_no_vat_line():
    totals = document_totals([Line(D("2"), D("100.00"))], vat_registered=False)
    assert totals == DocumentTotals(D("200.00"), D("0.00"), D("200.00"), D("0.00"), D("200.00"))


def test_vat_exclusive_adds_seven_percent():
    totals = document_totals([Line(D("1"), D("100.00"))], vat_registered=True,
                             vat_rate=D("7.00"), prices_include_vat=False)
    assert (totals.vat_base, totals.vat_amount, totals.grand_total) == (D("100.00"), D("7.00"), D("107.00"))


def test_vat_inclusive_splits_the_price():
    totals = document_totals([Line(D("1"), D("100.00"))], vat_registered=True,
                             vat_rate=D("7.00"), prices_include_vat=True)
    assert (totals.vat_base, totals.vat_amount, totals.grand_total) == (D("93.46"), D("6.54"), D("100.00"))


def test_known_rounding_case_three_times_33_33():
    lines = [Line(D("1"), D("33.33"))] * 3
    inclusive = document_totals(lines, vat_registered=True, prices_include_vat=True)
    assert (inclusive.vat_base, inclusive.vat_amount, inclusive.grand_total) == (D("93.45"), D("6.54"), D("99.99"))
    exclusive = document_totals(lines, vat_registered=True, prices_include_vat=False)
    assert (exclusive.vat_amount, exclusive.grand_total) == (D("7.00"), D("106.99"))
    # VAT is computed once on the total, never per line (3 x 2.33 = 6.99 would differ).


def test_vat_parts_always_add_up():
    lines = [Line(D("1.333"), D("17.77"), D("0.50")), Line(D("4"), D("2.49"))]
    for include in (False, True):
        t = document_totals(lines, vat_registered=True, prices_include_vat=include,
                            document_discount=D("1.11"))
        assert t.vat_base + t.vat_amount == t.grand_total
        assert t.subtotal - t.discount_total == (t.grand_total if include else t.vat_base)


def test_discounts_larger_than_subtotal_are_refused():
    with pytest.raises(ValueError):
        document_totals([Line(D("1"), D("10.00"))], vat_registered=False, document_discount=D("10.01"))


def test_vat_rate_range():
    with pytest.raises(ValueError):
        document_totals([Line(D("1"), D("1.00"))], vat_registered=True, vat_rate=D("100.01"))
    zero = document_totals([Line(D("1"), D("1.00"))], vat_registered=True, vat_rate=D("0"))
    assert zero.vat_amount == D("0.00") and zero.grand_total == D("1.00")
