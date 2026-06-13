import json
import secrets
from datetime import datetime, timezone

from cryptography.fernet import Fernet
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..models.app_setting import AppSetting

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

KNOWN_PROVIDERS: dict[str, str] = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
}

PROVIDER_MODELS: dict[str, list[str]] = {
    "openai": ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    "anthropic": ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"],
}


class SettingsService:
    def __init__(self, settings: Settings):
        key = settings.encryption_key
        if not key:
            key = Fernet.generate_key().decode()
        self._fernet = Fernet(key.encode() if isinstance(key, str) else key)

    def _encrypt(self, value: str) -> bytes:
        return self._fernet.encrypt(value.encode())

    def _decrypt(self, data: bytes) -> str:
        return self._fernet.decrypt(data).decode()

    async def get(self, db: AsyncSession, key: str) -> str | None:
        row = await db.get(AppSetting, key)
        if row is None:
            return None
        return self._decrypt(row.value_encrypted)

    async def set(self, db: AsyncSession, key: str, value: str) -> None:
        now = datetime.now(timezone.utc)
        stmt = (
            pg_insert(AppSetting)
            .values(key=key, value_encrypted=self._encrypt(value), updated_at=now)
            .on_conflict_do_update(
                index_elements=["key"],
                set_={"value_encrypted": self._encrypt(value), "updated_at": now},
            )
        )
        await db.execute(stmt)
        await db.commit()

    async def seed_defaults(self, db: AsyncSession, env_settings: Settings) -> None:
        existing = await db.execute(select(AppSetting.key))
        existing_keys = {r[0] for r in existing}

        if "admin_password_hash" not in existing_keys:
            pw = env_settings.admin_password.get_secret_value()
            await self.set(db, "admin_password_hash", pwd_context.hash(pw))

        # Gateway provider registry (для проксирования клиентских запросов).
        # НЕ используется судьёй — у судьи свой собственный ключ (см. judge_config).
        if "llm_providers" not in existing_keys:
            stored: dict[str, str] = {}
            provider_key = env_settings.provider_api_key.get_secret_value()
            if provider_key and provider_key not in ("", "sk-changeme"):
                stored["openai"] = provider_key
            await self.set(db, "llm_providers", json.dumps(stored))

        # Конфиг судьи (L7): provider + model + СОБСТВЕННЫЙ api_key.
        # Изолирован от gateway-registry чтобы разделить billing/secrets.
        if "judge_config" not in existing_keys:
            judge_key = env_settings.judge_api_key.get_secret_value()
            initial_key = judge_key if judge_key and judge_key not in ("", "sk-changeme") else ""
            await self.set(db, "judge_config", json.dumps({
                "provider": env_settings.judge_provider,
                "model": env_settings.judge_model,
                "api_key": initial_key,
            }))

        if "session_state_salt" not in existing_keys:
            # BLAKE2b key (соль) для хешированных n-грамм §4.5.3 / §10.3.
            # Генерируется один раз per deployment, никогда не ротируется
            # (иначе self-reference detection потеряет историю до миграции).
            await self.set(db, "session_state_salt", secrets.token_hex(32))

        # Раздельные preference устройства для L4 inference и LoRA training.
        # Дефолт "auto" → torch.cuda.is_available() решает.
        # Меняются через UI Layer 4 (layer4_device) и через UI Датасеты и обучение → Конфигурация (training_device).
        if "layer4_device" not in existing_keys:
            # Backward-compat: если в БД был inference_device от предыдущей версии — наследуем
            legacy = None
            if "inference_device" in existing_keys:
                legacy = await self.get(db, "inference_device")
            await self.set(db, "layer4_device", legacy or "auto")

        if "training_device" not in existing_keys:
            legacy = None
            if "inference_device" in existing_keys:
                legacy = await self.get(db, "inference_device")
            await self.set(db, "training_device", legacy or "auto")

    async def get_session_state_salt(self, db: AsyncSession) -> str:
        salt = await self.get(db, "session_state_salt")
        if not salt:
            salt = secrets.token_hex(32)
            await self.set(db, "session_state_salt", salt)
        return salt

    # ── Provider key management ────────────────────────────────────────────────

    async def get_llm_providers(self, db: AsyncSession) -> list[dict]:
        raw = await self.get(db, "llm_providers")
        stored: dict[str, str] = json.loads(raw) if raw else {}
        return [
            {
                "id": pid,
                "name": name,
                "configured": bool(stored.get(pid)),
                "api_key_masked": _mask(stored[pid]) if stored.get(pid) else None,
            }
            for pid, name in KNOWN_PROVIDERS.items()
        ]

    async def set_provider_key(self, db: AsyncSession, provider_id: str, api_key: str) -> None:
        raw = await self.get(db, "llm_providers")
        stored: dict[str, str] = json.loads(raw) if raw else {}
        stored[provider_id] = api_key
        await self.set(db, "llm_providers", json.dumps(stored))

    async def get_provider_key(self, db: AsyncSession, provider_id: str) -> str:
        raw = await self.get(db, "llm_providers")
        if not raw:
            return ""
        return json.loads(raw).get(provider_id, "")

    async def get_llm_providers_raw(self, db: AsyncSession) -> dict[str, str]:
        """Сырой dict {provider_id: api_key} — для ProviderRouter."""
        raw = await self.get(db, "llm_providers")
        return json.loads(raw) if raw else {}

    # ── Judge config (изолирован от gateway-registry) ─────────────────────────

    async def get_judge_config(self, db: AsyncSession) -> dict:
        raw = await self.get(db, "judge_config")
        if raw:
            cfg = json.loads(raw)
            # legacy-safe: если api_key не было — пустая строка
            cfg.setdefault("api_key", "")
            return cfg
        return {"provider": "openai", "model": "gpt-4o-mini", "api_key": ""}

    async def get_judge_config_masked(self, db: AsyncSession) -> dict:
        cfg = await self.get_judge_config(db)
        return {
            "provider": cfg.get("provider", "openai"),
            "model": cfg.get("model", "gpt-4o-mini"),
            "api_key_masked": _mask(cfg.get("api_key", "")) if cfg.get("api_key") else None,
            "configured": bool(cfg.get("api_key")),
        }

    async def set_judge_config(
        self,
        db: AsyncSession,
        *,
        provider: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
    ) -> dict:
        """Partial update — None означает «не менять»."""
        cfg = await self.get_judge_config(db)
        if provider is not None:
            cfg["provider"] = provider
        if model is not None:
            cfg["model"] = model
        if api_key is not None:
            cfg["api_key"] = api_key
        await self.set(db, "judge_config", json.dumps(cfg))
        return cfg

    # ── Auth ───────────────────────────────────────────────────────────────────

    async def verify_password(self, db: AsyncSession, password: str) -> bool:
        stored_hash = await self.get(db, "admin_password_hash")
        if stored_hash is None:
            return False
        return pwd_context.verify(password, stored_hash)

    async def change_password(self, db: AsyncSession, new_password: str) -> None:
        await self.set(db, "admin_password_hash", pwd_context.hash(new_password))

    @property
    def fernet(self) -> Fernet:
        """Доступ к Fernet-инстансу для ClientAppService (DRY — один ключ на всё)."""
        return self._fernet


def _mask(value: str) -> str:
    if len(value) <= 8:
        return "***"
    return value[:6] + "..." + value[-4:]
