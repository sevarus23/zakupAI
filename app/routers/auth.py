import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from .. import auth
from ..database import get_session
from ..models import User
from ..notify import send_registration_notification
from ..schemas import LoginRequest, RegisterRequest, TokenResponse, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterRequest, session=Depends(get_session)) -> User:
    if len(payload.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long",
        )
    if len(payload.password) > 72:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at most 72 characters long",
        )

    existing = session.exec(select(User).where(User.email == payload.email)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User already exists")

    hashed = auth.hash_password(payload.password)
    user = User(
        email=payload.email,
        password_hash=hashed,
        full_name=payload.full_name,
        organization=payload.organization,
        is_active=False,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    threading.Thread(
        target=send_registration_notification,
        args=(user.email, user.full_name, user.organization),
        daemon=True,
    ).start()

    return user


@router.post("/login", response_model=TokenResponse)
def login_user(payload: LoginRequest, session=Depends(get_session)) -> TokenResponse:
    user = session.exec(select(User).where(User.email == payload.email)).first()
    if not user or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "pending_approval",
                "message": "Ваш аккаунт ожидает подтверждения администратором.",
            },
        )

    user.last_login_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)

    token = auth.create_access_token(user.id)
    return TokenResponse(
        token=token,
        user=UserRead(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            organization=user.organization,
            is_admin=user.is_admin,
            created_at=user.created_at,
        ),
    )


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(auth.get_current_user)) -> User:
    return current_user
