"""
Settings: gateway-уровневые провайдер-ключи (registry) + пароль пользователя.

Что НЕ здесь:
- Клиентские приложения / gateway-токены → /api/client-apps (см. client_apps.py)
- Конфигурация L7 (провайдер/модель/api_key судьи) → /api/layers/7/config (см. layers.py)
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin
from ..deps import get_db, get_settings_service, get_user_service
from ..services.settings_service import KNOWN_PROVIDERS, PROVIDER_MODELS, SettingsService
from ..services.user_service import UserService

router = APIRouter(tags=["settings"], dependencies=[Depends(get_current_admin)])


class ProviderKeyUpdate(BaseModel):
    api_key: str


class PasswordChange(BaseModel):
    current: str
    new: str


# ── Gateway provider registry ─────────────────────────────────────────────────


@router.get("/settings/providers")
async def list_providers(
    db: AsyncSession = Depends(get_db),
    svc: SettingsService = Depends(get_settings_service),
):
    return await svc.get_llm_providers(db)


@router.put("/settings/providers/{provider_id}")
async def update_provider_key(
    provider_id: str,
    body: ProviderKeyUpdate,
    db: AsyncSession = Depends(get_db),
    svc: SettingsService = Depends(get_settings_service),
):
    if provider_id not in KNOWN_PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    await svc.set_provider_key(db, provider_id, body.api_key)
    return {"status": "updated"}


@router.get("/settings/provider-models")
async def get_provider_models():
    return {"providers": KNOWN_PROVIDERS, "models": PROVIDER_MODELS}


# ── Password change ────────────────────────────────────────────────────────────


@router.put("/settings/password")
async def change_password(
    body: PasswordChange,
    current: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
    user_svc: UserService = Depends(get_user_service),
):
    """Сменить пароль текущего пользователя (требует текущий пароль)."""
    user = await user_svc.get_by_id(db, uuid.UUID(current["user_id"]))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if not user_svc.verify_password(body.current, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    await user_svc.change_password(db, user.id, body.new)
    await db.commit()
    return {"status": "updated"}
