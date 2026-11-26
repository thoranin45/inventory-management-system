"""F0a: the seller's company profile (single row, id = 1)."""
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.unit_of_work import UnitOfWork
from app.models import AuditLog, CompanyProfile, User
from app.schemas.company_profile_schema import CompanyProfileResponse, CompanyProfileUpdate

PROFILE_ID = 1


def get_company_profile_service(db: Session) -> CompanyProfileResponse:
    """The stored profile, or the defaults (VAT off) when none is saved yet."""
    profile = db.get(CompanyProfile, PROFILE_ID)
    if profile is None:
        return CompanyProfileResponse()
    return CompanyProfileResponse.model_validate(profile)


def update_company_profile_service(
    db: Session,
    data: CompanyProfileUpdate,
    current_user: User,
) -> CompanyProfileResponse:
    values = data.model_dump()
    values["vat_rate"] = Decimal(values["vat_rate"]).quantize(Decimal("0.01"))

    with UnitOfWork(db) as uow:
        profile = db.execute(
            select(CompanyProfile).where(CompanyProfile.id == PROFILE_ID).with_for_update()
        ).scalar_one_or_none()
        created = profile is None
        if created:
            profile = CompanyProfile(id=PROFILE_ID)
            db.add(profile)

        changed = sorted(
            name for name, value in values.items()
            if created or getattr(profile, name) != value
        )
        for name, value in values.items():
            setattr(profile, name, value)
        profile.updated_by_user_id = current_user.id
        profile.updated_at = func.now()

        db.add(AuditLog(
            username=current_user.username,
            action="CREATE_COMPANY_PROFILE" if created else "UPDATE_COMPANY_PROFILE",
            table_name="company_profile",
            record_id=PROFILE_ID,
            description=("Changed: " + ", ".join(changed)) if changed else "No field changed",
        ))

    uow.refresh(profile)
    return CompanyProfileResponse.model_validate(profile)
