"""Non-routable R5-SAFE.2 contracts. No token-bearing response is replayable."""
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Epoch = Annotated[int, Field(strict=True, ge=0, le=2147483647)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Quantity = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=3, allow_inf_nan=False)]


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClaimRequest(StrictRequest):
    phase: Literal["PICK", "PACK"]
    expected_epoch: Epoch


class TakeoverRequest(ClaimRequest):
    confirmed: Annotated[bool, Field(strict=True)]
    reason: Reason


class PhysicalAllocation(StrictRequest):
    allocation_id: Annotated[int, Field(strict=True, gt=0)]
    picked_quantity: Quantity
    packed_quantity: Quantity

    @field_validator("picked_quantity", "packed_quantity", mode="before")
    @classmethod
    def exact_input(cls, value):
        # JSON floats may have lost precision before Pydantic sees them. Require
        # exact decimal text (or exact integers); never validate a rounded count.
        if type(value) not in (str, int, Decimal):
            raise ValueError("Physical quantities require exact decimal text or integers")
        return value


class VerifiedRelease(ClaimRequest):
    mode: Literal["VERIFIED"]
    physical_count_attested: Annotated[bool, Field(strict=True)]
    allocations: list[PhysicalAllocation]


class UnverifiedRelease(ClaimRequest):
    mode: Literal["UNVERIFIED"]
    reason: Reason


ReleaseRequest = Annotated[VerifiedRelease | UnverifiedRelease, Field(discriminator="mode")]


class ClaimStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sales_order_id: int
    claim_epoch: int
    phase: Literal["PICK", "PACK"] | None
    holder_user_id: int | None
    acquired_at: datetime | None
    reconciliation_required: bool
    reconciliation_status: Literal["REQUIRED", "CORRECTION_IN_PROGRESS", "ESCALATED"] | None


class AcquiredClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sales_order_id: int
    claim_epoch: int
    phase: Literal["PICK", "PACK"]
    holder_user_id: int
    acquired_at: datetime
    reconciliation_required: bool
    claim_token: str


class VerifiedReleaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sales_order_id: int
    claim_epoch: int
    mode: Literal["VERIFIED"]
    release_id: str
    evidence_sha256: str
    reconciliation_required: Literal[False]


class UnverifiedReleaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sales_order_id: int
    claim_epoch: int
    mode: Literal["UNVERIFIED"]
    reconciliation_required: Literal[True]
    reconciliation_id: int
