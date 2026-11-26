from fastapi import APIRouter, Depends

from app.core.dependencies import DatabaseSession, require_admin, require_warehouse
from app.models import User
from app.schemas.company_profile_schema import CompanyProfileResponse, CompanyProfileUpdate
from app.schemas.response import ApiResponse
from app.services.company_profile_service import (
    get_company_profile_service,
    update_company_profile_service,
)

router = APIRouter(
    dependencies=[Depends(require_warehouse)],
    prefix="/company-profile",
    tags=["Company profile"],
)


@router.get("", response_model=ApiResponse[CompanyProfileResponse])
def get_company_profile(db: DatabaseSession) -> ApiResponse[CompanyProfileResponse]:
    return ApiResponse(
        message="Company profile retrieved successfully",
        data=get_company_profile_service(db),
    )


@router.put("", response_model=ApiResponse[CompanyProfileResponse])
def update_company_profile(
    data: CompanyProfileUpdate,
    db: DatabaseSession,
    current_user: User = Depends(require_admin),
) -> ApiResponse[CompanyProfileResponse]:
    return ApiResponse(
        message="Company profile updated successfully",
        data=update_company_profile_service(db, data, current_user),
    )
