import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(..., min_length=8)
    email: str | None = None
    full_name: str | None = Field(default=None, max_length=255)
    role: str = Field(default="admin", pattern=r"^(admin|viewer|operator)$")
    is_active: bool = True


class UserUpdate(BaseModel):
    email: str | None = None
    full_name: str | None = Field(default=None, max_length=255)
    role: str | None = Field(default=None, pattern=r"^(admin|viewer|operator)$")
    is_active: bool | None = None


class UserPasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class UserRead(BaseModel):
    id: uuid.UUID
    username: str
    email: str | None
    full_name: str | None
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None

    model_config = {"from_attributes": True}


class UserSummary(BaseModel):
    """Краткая карточка пользователя — для списков."""
    id: uuid.UUID
    username: str
    email: str | None
    full_name: str | None
    role: str
    is_active: bool
    last_login_at: datetime | None

    model_config = {"from_attributes": True}


class MeResponse(BaseModel):
    """Ответ GET /api/auth/me."""
    user_id: str
    username: str
    email: str | None
    full_name: str | None
    role: str
    is_active: bool
    last_login_at: datetime | None
