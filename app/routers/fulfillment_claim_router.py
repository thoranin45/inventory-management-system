"""UNMOUNTED claim adapter. Do not include this router in the production app.

A separate integration gate must replace all legacy mutation paths and add BFF
and durable client support together. This module alone protects no HTTP workflow.
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from app.core.dependencies import DatabaseSession, require_warehouse
from app.core.exceptions import AppException
from app.repositories.sales_order_repository import SalesOrderRepository
from app.schemas.fulfillment_claim_schema import (ClaimRequest, TakeoverRequest, ReleaseRequest,
    ClaimStatus, AcquiredClaim, VerifiedReleaseResult, UnverifiedReleaseResult)
from app.services.fulfillment_integrity_service import (
    acquire_fulfillment_claim, fulfillment_claim_status, validate_fulfillment_claim,
    release_fulfillment_claim,
)


class PrivateClaimRoute(APIRoute):
    """Never reflect validation inputs or credentials, including on rejected requests."""
    def get_route_handler(self):
        original = super().get_route_handler()

        async def private(request):
            try:
                response = await original(request)
            except RequestValidationError:
                response = JSONResponse({"detail": "Invalid claim request"}, status_code=422)
            except AppException as exc:
                response = JSONResponse({"detail": exc.message}, status_code=exc.status_code)
            except HTTPException as exc:
                response = JSONResponse({"detail": "Claim authentication or authorization failed"},
                                        status_code=exc.status_code)
            except Exception:
                # Do not reflect or log exception payloads that could contain credentials.
                # This adapter is still unmounted; future integration supplies safe
                # request-ID diagnostics without logging token-bearing inputs.
                response = JSONResponse({"detail": "Claim operation failed"}, status_code=500)
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            return response
        return private


router = APIRouter(prefix="/api/v1/sales-orders/{sales_order_id}/fulfillment/claim",
                   route_class=PrivateClaimRoute, tags=["Unmounted fulfillment claims"])


def _epoch(value, expected, required=False):
    if value is None:
        if required:
            raise AppException("Claim epoch header required", 422)
        return expected
    # No whitespace, signs or alternate textual representation.
    if len(value) > 10 or not value.isascii() or not value.isdecimal() or str(int(value)) != value or int(value) != expected:
        raise AppException("Conflicting or invalid claim epoch", 422)
    return expected


def _token(value):
    if value is None or len(value) != 43 or not all(c.isascii() and (c.isalnum() or c in "-_") for c in value):
        raise AppException("Invalid claim credentials", 422)
    return value


@router.get("", response_model=ClaimStatus)
def status(sales_order_id: int, db: DatabaseSession, user=Depends(require_warehouse)):
    return fulfillment_claim_status(db, SalesOrderRepository(db), sales_order_id=sales_order_id, current_user=user)


@router.post("/acquire", response_model=AcquiredClaim)
def acquire(sales_order_id: int, data: ClaimRequest, db: DatabaseSession,
            epoch: str | None = Header(None, alias="X-Fulfillment-Claim-Epoch"), user=Depends(require_warehouse)):
    _epoch(epoch, data.expected_epoch)
    return acquire_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=sales_order_id,
                                    current_user=user, phase=data.phase, expected_epoch=data.expected_epoch)


@router.post("/takeover", response_model=AcquiredClaim)
def takeover(sales_order_id: int, data: TakeoverRequest, db: DatabaseSession,
             epoch: str | None = Header(None, alias="X-Fulfillment-Claim-Epoch"), user=Depends(require_warehouse)):
    _epoch(epoch, data.expected_epoch)
    if data.confirmed is not True:
        raise AppException("Explicit takeover confirmation required", 422)
    return acquire_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=sales_order_id,
                                    current_user=user, phase=data.phase, expected_epoch=data.expected_epoch,
                                    takeover=True, reason=data.reason)


@router.post("/validate", response_model=ClaimStatus)
def validate(sales_order_id: int, data: ClaimRequest, db: DatabaseSession,
             token: str | None = Header(None, alias="X-Fulfillment-Claim-Token"),
             epoch: str | None = Header(None, alias="X-Fulfillment-Claim-Epoch"), user=Depends(require_warehouse)):
    return validate_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=sales_order_id,
                                     current_user=user, phase=data.phase, claim_token=_token(token),
                                     expected_epoch=_epoch(epoch, data.expected_epoch, required=True))


@router.post("/release", response_model=VerifiedReleaseResult | UnverifiedReleaseResult)
def release(sales_order_id: int, data: ReleaseRequest, db: DatabaseSession,
            token: str | None = Header(None, alias="X-Fulfillment-Claim-Token"),
            epoch: str | None = Header(None, alias="X-Fulfillment-Claim-Epoch"), user=Depends(require_warehouse)):
    kwargs = ({"allocations": [line.model_dump() for line in data.allocations],
               "physical_count_attested": data.physical_count_attested} if data.mode == "VERIFIED"
              else {"reason": data.reason})
    return release_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=sales_order_id,
                                    current_user=user, phase=data.phase, claim_token=_token(token),
                                    expected_epoch=_epoch(epoch, data.expected_epoch, required=True),
                                    mode=data.mode, **kwargs)
