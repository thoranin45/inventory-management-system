from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.dependencies import require_admin
from app.core.security import (
    validate_user_role,
    create_access_token,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.models import User
from app.schemas.user_schema import (
    UserLogin,
    UserRegister,
)


router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
)


def authenticate_user(
    db: Session,
    username: str,
    password: str,
) -> User:
    """
    Validate username and password.
    """

    db_user = (
        db.query(User)
        .filter(
            User.username == username
        )
        .first()
    )

    if db_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    if not verify_password(
        password,
        db_user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    if (
        hasattr(db_user, "is_active")
        and db_user.is_active is False
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    validate_user_role(db_user)
    return db_user


def generate_token(
    user: User,
) -> dict:
    """
    Generate JWT access token.
    """

    role = getattr(
        user,
        "role",
        None,
    )

    if hasattr(role, "value"):
        role = role.value

    access_token = create_access_token(
        {
            "sub": str(user.id),
            "username": user.username,
            "role": role,
        }
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
    }


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def register_user(
    user: UserRegister,
    db: Session = Depends(get_db),
):
    existing_user = (
        db.query(User)
        .filter(
            User.username == user.username
        )
        .first()
    )

    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    new_user = User(
        username=user.username,
        password_hash=hash_password(
            user.password
        ),
        role=user.role,
    )

    db.add(new_user)

    try:
        db.commit()
        db.refresh(new_user)

    except Exception:
        db.rollback()
        raise

    return {
        "success": True,
        "message": "User registered successfully",
        "data": {
            "id": new_user.id,
            "username": new_user.username,
            "role": new_user.role,
        },
    }


@router.post(
    "/login",
)
def login_user(
    user: UserLogin,
    db: Session = Depends(get_db),
):
    """
    JSON login endpoint.

    Intended for frontend applications and API clients.
    """

    db_user = authenticate_user(
        db=db,
        username=user.username,
        password=user.password,
    )

    return generate_token(
        db_user
    )


@router.post(
    "/token",
)
def oauth2_login(
    form_data: Annotated[
        OAuth2PasswordRequestForm,
        Depends(),
    ],
    db: Session = Depends(get_db),
):
    """
    OAuth2 login endpoint used by Swagger Authorize.
    """

    db_user = authenticate_user(
        db=db,
        username=form_data.username,
        password=form_data.password,
    )

    return generate_token(
        db_user
    )
