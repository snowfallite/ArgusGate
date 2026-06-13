from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from .config import settings
from .db import async_session_factory

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ── Token creation ────────────────────────────────────────────────────────────


def create_access_token(user_id: str, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {
        "sub": user_id,          # UUID пользователя
        "username": username,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


# ── Token decoding ────────────────────────────────────────────────────────────


def decode_token(token: str) -> dict:
    """
    Декодирует JWT и возвращает:
      {"user_id": str, "username": str}
    Выбрасывает HTTPException 401 если токен невалиден/истёк.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id: str = payload.get("sub")
        username: str = payload.get("username")
        if not user_id or not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
        return {"user_id": user_id, "username": username}
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# ── FastAPI dependencies ──────────────────────────────────────────────────────


async def get_current_user(token: str | None = Depends(_oauth2_scheme)) -> dict:
    """
    Dependency: проверяет Bearer JWT, возвращает {"user_id": str, "username": str}.
    Не делает запрос в БД — достаточно для большинства endpoint'ов.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_token(token)


# Псевдоним для обратной совместимости — все роутеры используют get_current_admin
get_current_admin = get_current_user


# ── Client app auth (прокси) ──────────────────────────────────────────────────


async def verify_client_key(request: Request, authorization: str = Header(default="")) -> dict:
    """
    Аутентификация клиентского приложения по Bearer-token.
    Возвращает {token, client_app_id, client_app_name} или 401.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization[7:]
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    from .deps import get_client_app_service
    svc = get_client_app_service()
    if svc is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Client app service not ready",
        )

    async with async_session_factory() as db:
        app = await svc.find_by_token(db, token)
        if app is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        # touch_last_used best-effort, не блокируем запрос
        try:
            from datetime import datetime, timezone as _tz
            app.last_used_at = datetime.now(_tz.utc)
            await db.commit()
        except Exception:
            await db.rollback()

        return {
            "token": token,
            "client_app_id": str(app.id),
            "client_app_name": app.name,
        }
