"""
Клиентское приложение — abstraction для аутентификации клиентов к gateway.

Каждое приложение получает один gateway_key (Bearer token).
Provider-ключи (OpenAI/Anthropic) хранятся отдельно на уровне gateway-registry
(app_settings.llm_providers), не на уровне клиента.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ClientApplication(Base):
    __tablename__ = "client_applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # Encrypted Fernet payload — никогда не хранится открытым в БД
    gateway_key_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # Plaintext fingerprint (SHA256 hex 16 chars) для быстрого lookup в auth без расшифровки
    gateway_key_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
