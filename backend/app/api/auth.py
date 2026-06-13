from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import create_access_token, get_current_user
from ..deps import get_db, get_user_service
from ..schemas.user import MeResponse
from ..services.user_service import UserService

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 86400


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    user = await user_svc.get_by_username(db, body.username)

    if user is None or not user_svc.verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    # Обновляем last_login_at (best-effort)
    try:
        await user_svc.touch_last_login(db, user.id)
        await db.commit()
    except Exception:
        await db.rollback()

    token = create_access_token(user_id=str(user.id), username=user.username)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=MeResponse)
async def me(
    current: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    import uuid
    user = await user_svc.get_by_id(db, uuid.UUID(current["user_id"]))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return MeResponse(
        user_id=str(user.id),
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        last_login_at=user.last_login_at,
    )
