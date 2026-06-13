"""
CRUD клиентских приложений + регенерация gateway-токена.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin
from ..deps import get_client_app_service, get_db
from ..services.client_app_service import ClientAppService, _mask

router = APIRouter(dependencies=[Depends(get_current_admin)])


class ClientAppCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class ClientAppUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    is_active: bool | None = None


class ClientAppOut(BaseModel):
    id: str
    name: str
    description: str | None
    is_active: bool
    created_at: str | None
    updated_at: str | None
    last_used_at: str | None
    gateway_key_masked: str | None


class ClientAppCreated(ClientAppOut):
    """Возвращается ПРИ СОЗДАНИИ — содержит plaintext token (один раз)."""
    gateway_key: str


def _svc() -> ClientAppService:
    svc = get_client_app_service()
    if svc is None:
        raise HTTPException(status_code=503, detail="Client app service not ready")
    return svc


@router.get("", response_model=list[ClientAppOut])
async def list_client_apps(db: AsyncSession = Depends(get_db)):
    svc = _svc()
    apps = await svc.list_apps(db)
    result = []
    for app in apps:
        revealed = svc.reveal_token(app)
        result.append(ClientAppOut(
            **svc.to_dict(app, masked_token=_mask(revealed) if revealed else None)
        ))
    return result


@router.post("", response_model=ClientAppCreated)
async def create_client_app(payload: ClientAppCreate, db: AsyncSession = Depends(get_db)):
    svc = _svc()
    app, token = await svc.create_app(db, name=payload.name, description=payload.description)
    return ClientAppCreated(
        **svc.to_dict(app, masked_token=_mask(token)),
        gateway_key=token,
    )


@router.put("/{app_id}", response_model=ClientAppOut)
async def update_client_app(
    app_id: uuid.UUID,
    payload: ClientAppUpdate,
    db: AsyncSession = Depends(get_db),
):
    svc = _svc()
    app = await svc.update_app(
        db, app_id,
        name=payload.name,
        description=payload.description,
        is_active=payload.is_active,
    )
    if app is None:
        raise HTTPException(status_code=404, detail="Application not found")
    revealed = svc.reveal_token(app)
    return ClientAppOut(**svc.to_dict(app, masked_token=_mask(revealed) if revealed else None))


@router.delete("/{app_id}")
async def delete_client_app(app_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    svc = _svc()
    ok = await svc.delete_app(db, app_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Application not found")
    return {"deleted": True}


@router.post("/{app_id}/regenerate-key", response_model=ClientAppCreated)
async def regenerate_key(app_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    svc = _svc()
    res = await svc.regenerate_token(db, app_id)
    if res is None:
        raise HTTPException(status_code=404, detail="Application not found")
    app, token = res
    return ClientAppCreated(
        **svc.to_dict(app, masked_token=_mask(token)),
        gateway_key=token,
    )
