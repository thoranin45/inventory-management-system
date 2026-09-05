from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import AppException
from app.core.logger import logger
from app.schemas.response import ErrorDetail, ErrorResponse


def _get_request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _error_response(
    *,
    status_code: int,
    message: str,
    request: Request,
    errors: list[ErrorDetail] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    payload = ErrorResponse(
        success=False,
        message=message,
        errors=errors or [],
        request_id=_get_request_id(request),
    )

    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(payload),
        headers=headers,
    )


async def app_exception_handler(
    request: Request,
    exc: AppException,
) -> JSONResponse:
    logger.warning(
        "APP_EXCEPTION | "
        f"route={getattr(request.scope.get('route'), 'path', 'unmatched')} | "
        f"status={exc.status_code} | "
        "type=business_error"
    )

    return _error_response(
        status_code=exc.status_code,
        message=exc.message,
        request=request,
    )


async def http_exception_handler(
    request: Request,
    exc: HTTPException,
) -> JSONResponse:
    logger.warning(
        "HTTP_EXCEPTION | "
        f"route={getattr(request.scope.get('route'), 'path', 'unmatched')} | "
        f"status={exc.status_code} | "
        "type=http_error"
    )

    if isinstance(exc.detail, str):
        message = exc.detail
        errors: list[ErrorDetail] = []

    else:
        message = "Request failed"
        errors = [
            ErrorDetail(
                message=str(exc.detail),
                error_type="http_error",
            )
        ]

    return _error_response(
        status_code=exc.status_code,
        message=message,
        request=request,
        errors=errors,
        headers=exc.headers,
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    logger.warning(
        "VALIDATION_ERROR | "
        f"route={getattr(request.scope.get('route'), 'path', 'unmatched')} | "
        f"error_types={[error.get('type') for error in exc.errors()]}"
    )

    errors: list[ErrorDetail] = []

    for error in exc.errors():
        location = error.get("loc", [])
        field = ".".join(
            str(part)
            for part in location
            if part not in {"body", "query", "path", "header"}
        )

        errors.append(
            ErrorDetail(
                field=field or None,
                message=error.get("msg", "Invalid value"),
                error_type=error.get("type"),
            )
        )

    return _error_response(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        message="Validation error",
        request=request,
        errors=errors,
    )


async def integrity_error_handler(
    request: Request,
    exc: IntegrityError,
) -> JSONResponse:
    logger.warning(
        "INTEGRITY_ERROR | "
        f"route={getattr(request.scope.get('route'), 'path', 'unmatched')}"
    )

    error_text = str(exc.orig).lower()

    if "products_sku_key" in error_text:
        message = "SKU already exists"
        error_type = "duplicate_sku"

    elif "products_barcode_key" in error_text:
        message = "Barcode already exists"
        error_type = "duplicate_barcode"

    elif "products_category_id_fkey" in error_text:
        message = "Category not found"
        error_type = "invalid_category"

    else:
        message = "Database constraint error"
        error_type = "integrity_error"

    return _error_response(
        status_code=status.HTTP_400_BAD_REQUEST,
        message=message,
        request=request,
        errors=[
            ErrorDetail(
                message=message,
                error_type=error_type,
            )
        ],
    )
