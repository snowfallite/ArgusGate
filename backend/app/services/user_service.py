"""
UserService — CRUD для таблицы users.
Все методы принимают AsyncSession — транзакция управляется снаружи.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.user import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserNotFound(Exception):
    pass


class UsernameAlreadyExists(Exception):
    pass


class EmailAlreadyExists(Exception):
    pass


class UserService:
    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def hash_password(plain: str) -> str:
        return pwd_context.hash(plain)

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        return pwd_context.verify(plain, hashed)

    # ── Read ─────────────────────────────────────────────────────────────────

    async def get_by_id(self, db: AsyncSession, user_id: uuid.UUID) -> User | None:
        return await db.get(User, user_id)

    async def get_by_username(self, db: AsyncSession, username: str) -> User | None:
        result = await db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def list_users(self, db: AsyncSession) -> list[User]:
        result = await db.execute(select(User).order_by(User.created_at.asc()))
        return list(result.scalars().all())

    async def count(self, db: AsyncSession) -> int:
        from sqlalchemy import func
        result = await db.execute(select(func.count()).select_from(User))
        return result.scalar_one()

    # ── Write ─────────────────────────────────────────────────────────────────

    async def create(
        self,
        db: AsyncSession,
        username: str,
        password: str,
        role: str = "admin",
        email: str | None = None,
        full_name: str | None = None,
        is_active: bool = True,
    ) -> User:
        # Уникальность username
        existing = await self.get_by_username(db, username)
        if existing is not None:
            raise UsernameAlreadyExists(f"Username '{username}' already taken")

        # Уникальность email (если задан)
        if email:
            result = await db.execute(select(User).where(User.email == email))
            if result.scalar_one_or_none() is not None:
                raise EmailAlreadyExists(f"Email '{email}' already registered")

        now = datetime.now(timezone.utc)
        user = User(
            id=uuid.uuid4(),
            username=username,
            email=email,
            full_name=full_name,
            hashed_password=self.hash_password(password),
            role=role,
            is_active=is_active,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        await db.flush()   # получаем id без commit (commit вызывается снаружи)
        return user

    async def update(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        *,
        email: str | None = ...,
        full_name: str | None = ...,
        role: str | None = None,
        is_active: bool | None = None,
    ) -> User:
        user = await self.get_by_id(db, user_id)
        if user is None:
            raise UserNotFound(f"User {user_id} not found")

        if email is not ...:
            if email and email != user.email:
                result = await db.execute(select(User).where(User.email == email))
                if result.scalar_one_or_none() is not None:
                    raise EmailAlreadyExists(f"Email '{email}' already registered")
            user.email = email

        if full_name is not ...:
            user.full_name = full_name
        if role is not None:
            user.role = role
        if is_active is not None:
            user.is_active = is_active

        user.updated_at = datetime.now(timezone.utc)
        await db.flush()
        return user

    async def change_password(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        new_password: str,
    ) -> None:
        user = await self.get_by_id(db, user_id)
        if user is None:
            raise UserNotFound(f"User {user_id} not found")
        user.hashed_password = self.hash_password(new_password)
        user.updated_at = datetime.now(timezone.utc)
        await db.flush()

    async def delete(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        user = await self.get_by_id(db, user_id)
        if user is None:
            raise UserNotFound(f"User {user_id} not found")
        await db.delete(user)
        await db.flush()

    async def touch_last_login(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        user = await self.get_by_id(db, user_id)
        if user:
            user.last_login_at = datetime.now(timezone.utc)
            user.updated_at = datetime.now(timezone.utc)
            await db.flush()

    # ── Seeding ───────────────────────────────────────────────────────────────

    async def ensure_admin(
        self,
        db: AsyncSession,
        username: str,
        password: str,
    ) -> User:
        """
        Создаёт admin-пользователя если таблица users пуста.
        Идемпотентно: при повторном вызове ничего не делает.
        """
        total = await self.count(db)
        if total > 0:
            return await self.get_by_username(db, username)

        user = await self.create(
            db, username=username, password=password, role="admin", is_active=True
        )
        await db.commit()
        return user
