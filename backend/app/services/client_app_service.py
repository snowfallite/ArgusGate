"""
Управление клиентскими приложениями и их gateway-токенами.

Архитектура:
- Каждое приложение получает 1 gateway-token (Bearer для запросов к /v1/chat/completions).
- Token хранится зашифрованным (Fernet) + SHA256-fingerprint для быстрого lookup.
- Provider-ключи (OpenAI/Anthropic) хранятся отдельно на gateway-уровне (см. SettingsService),
  не на уровне клиента. Это даёт централизованное управление billing/secrets/routing.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.client_application import ClientApplication

_TOKEN_PREFIX = "arg_live_"
_TOKEN_BYTES = 32  # 256 бит энтропии


def _fingerprint(token: str) -> str:
    """SHA256-fingerprint plaintext token для индексированного lookup в БД."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _generate_token() -> str:
    return _TOKEN_PREFIX + secrets.token_urlsafe(_TOKEN_BYTES)


def _mask(token: str) -> str:
    if len(token) <= 12:
        return "***"
    return token[:12] + "..." + token[-4:]


class ClientAppService:
    """Stateless вокруг SQLAlchemy. Получает Fernet от SettingsService для шифрования."""

    def __init__(self, fernet: Fernet) -> None:
        self._fernet = fernet

    # ─── CRUD ───────────────────────────────────────────────────────────────

    async def list_apps(self, db: AsyncSession) -> list[ClientApplication]:
        result = await db.execute(
            select(ClientApplication).order_by(ClientApplication.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_app(self, db: AsyncSession, app_id) -> ClientApplication | None:
        return await db.get(ClientApplication, app_id)

    async def create_app(
        self,
        db: AsyncSession,
        *,
        name: str,
        description: str | None = None,
    ) -> tuple[ClientApplication, str]:
        """
        Создаёт приложение + генерирует token. Возвращает (app, plaintext_token).
        Plaintext возвращается ТОЛЬКО ОДИН РАЗ — клиент должен скопировать.
        """
        token = _generate_token()
        now = datetime.now(timezone.utc)
        app = ClientApplication(
            name=name.strip(),
            description=description.strip() if description else None,
            gateway_key_encrypted=self._fernet.encrypt(token.encode("utf-8")),
            gateway_key_fingerprint=_fingerprint(token),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(app)
        await db.commit()
        await db.refresh(app)
        return app, token

    async def update_app(
        self,
        db: AsyncSession,
        app_id,
        *,
        name: str | None = None,
        description: str | None = None,
        is_active: bool | None = None,
    ) -> ClientApplication | None:
        app = await db.get(ClientApplication, app_id)
        if app is None:
            return None
        if name is not None:
            app.name = name.strip()
        if description is not None:
            app.description = description.strip() if description else None
        if is_active is not None:
            app.is_active = is_active
        app.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(app)
        return app

    async def delete_app(self, db: AsyncSession, app_id) -> bool:
        app = await db.get(ClientApplication, app_id)
        if app is None:
            return False
        await db.delete(app)
        await db.commit()
        return True

    async def regenerate_token(
        self, db: AsyncSession, app_id
    ) -> tuple[ClientApplication, str] | None:
        """Выпускает новый token, старый перестаёт работать сразу."""
        app = await db.get(ClientApplication, app_id)
        if app is None:
            return None
        token = _generate_token()
        app.gateway_key_encrypted = self._fernet.encrypt(token.encode("utf-8"))
        app.gateway_key_fingerprint = _fingerprint(token)
        app.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(app)
        return app, token

    # ─── Auth ──────────────────────────────────────────────────────────────

    async def find_by_token(
        self, db: AsyncSession, token: str
    ) -> ClientApplication | None:
        """Lookup приложения по предъявленному Bearer-token."""
        if not token:
            return None
        fp = _fingerprint(token)
        result = await db.execute(
            select(ClientApplication).where(
                ClientApplication.gateway_key_fingerprint == fp,
                ClientApplication.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def touch_last_used(self, db: AsyncSession, app_id) -> None:
        """Обновляет last_used_at (best-effort, без блокировки запроса)."""
        try:
            await db.execute(
                update(ClientApplication)
                .where(ClientApplication.id == app_id)
                .values(last_used_at=datetime.now(timezone.utc))
            )
            await db.commit()
        except Exception:
            await db.rollback()

    # ─── Helpers для frontend ──────────────────────────────────────────────

    def reveal_token(self, app: ClientApplication) -> str | None:
        """Расшифровывает token (для смены отображения админа). Возвращает None при ошибке."""
        try:
            return self._fernet.decrypt(app.gateway_key_encrypted).decode("utf-8")
        except (InvalidToken, ValueError):
            return None

    @staticmethod
    def to_dict(app: ClientApplication, *, masked_token: str | None = None) -> dict:
        return {
            "id": str(app.id),
            "name": app.name,
            "description": app.description,
            "is_active": app.is_active,
            "created_at": app.created_at.isoformat() if app.created_at else None,
            "updated_at": app.updated_at.isoformat() if app.updated_at else None,
            "last_used_at": app.last_used_at.isoformat() if app.last_used_at else None,
            "gateway_key_masked": masked_token,
        }
