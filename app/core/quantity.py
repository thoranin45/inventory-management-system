"""Lossless quantity output without changing ordinary JSON numeric responses."""
from decimal import Decimal

from fastapi.encoders import jsonable_encoder


def decimal_json(value: Decimal) -> int | float | str:
    if not value.is_finite():
        raise ValueError("Non-finite decimal output")
    if value == value.to_integral_value() and abs(value) <= 9007199254740991:
        return int(value)
    number = float(value)
    if Decimal(str(number)) == value:
        return number
    return format(value, "f")


def encode_quantities(value):
    return jsonable_encoder(value, custom_encoder={Decimal: decimal_json})


def quantity_text(value: Decimal) -> str:
    """Exact three-place text for quantities already validated/persisted at scale 3."""
    if not value.is_finite() or value != value.quantize(Decimal("0.001")):
        raise ValueError("Quantity cannot be represented exactly at scale 3")
    return format(value, ".3f")
