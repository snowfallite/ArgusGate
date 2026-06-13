"""
CRUD-эндпоинты для управления пользователями.
Все маршруты — только для аутентифицированных admin.
Монтируется с prefix="/api/users".
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin
from ..deps import get_db, get_user_service
from ..schemas.user import UserCreate, UserPasswordChange, UserRead, UserSummary, UserUpdate
from ..services.user_service import (
    EmailAlreadyExists,
    UserNotFound,
    UserService,
    UsernameAlreadyExists,
)

router = APIRouter(
    tags=["users"],
    dependencies=[Depends(get_current_admin)],
)


@router.get("", response_model=list[UserSummary])
async def list_users(
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    """Список всех пользователей."""
    return await user_svc.list_users(db)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    """Создать нового пользователя."""
    try:
        user = await user_svc.create(
            db,
            username=body.username,
            password=body.password,
            role=body.role,
            email=body.email,
            full_name=body.full_name,
            is_active=body.is_active,
        )
        await db.commit()
        await db.refresh(user)
        return user
    except UsernameAlreadyExists as e:
        raise HTTPException(status_code=409, detail=str(e))
    except EmailAlreadyExists as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    """Получить пользователя по ID."""
    user = await user_svc.get_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    """Обновить профиль пользователя (email, full_name, role, is_active)."""
    update_kwargs: dict = {}
    if body.email is not None:
        update_kwargs["email"] = body.email
    if body.full_name is not None:
        update_kwargs["full_name"] = body.full_name
    if body.role is not None:
        update_kwargs["role"] = body.role
    if body.is_active is not None:
        update_kwargs["is_active"] = body.is_active

    try:
        user = await user_svc.update(db, user_id, **update_kwargs)
        await db.commit()
        await db.refresh(user)
        return user
    except UserNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except EmailAlreadyExists as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/{user_id}/password")
async def change_user_password(
    user_id: uuid.UUID,
    body: UserPasswordChange,
    current: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    """
    Сменить пароль пользователя.
    Пользователь может менять только свой пароль (с проверкой current_password).
    Admin может менять пароль любого пользователя (current_password игнорируется).
    """
    user = await user_svc.get_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Если меняют свой пароль — проверяем текущий
    if str(user.id) == current["user_id"]:
        if not user_svc.verify_password(body.current_password, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

    try:
        await user_svc.change_password(db, user_id, body.new_password)
        await db.commit()
    except UserNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {"status": "updated"}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    current: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    """Удалить пользователя. Нельзя удалить самого себя."""
    if str(user_id) == current["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    try:
        await user_svc.delete(db, user_id)
        await db.commit()
    except UserNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
