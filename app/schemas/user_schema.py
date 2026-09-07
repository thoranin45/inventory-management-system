from typing import Literal

from pydantic import BaseModel, Field, field_validator


class UserRegister(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, repr=False)
    role: Literal["ADMIN", "WAREHOUSE"]

    @field_validator("role", mode="before")
    @classmethod
    def normalize_role(cls, value):
        # Preserve clients using the existing lowercase role spelling.
        return value.upper() if isinstance(value, str) else value

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must not exceed 72 UTF-8 bytes")
        return value


class UserLogin(BaseModel):
    username: str
    password: str = Field(repr=False)


class UserMe(BaseModel):
    """Frontend-safe view of the authenticated user. Never carries the
    password hash, token, or any other sensitive internal field."""

    id: int
    username: str | None = None
    role: str | None = None
    is_active: bool = True
