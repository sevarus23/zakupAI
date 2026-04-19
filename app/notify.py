import logging
import os
import smtplib
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "")
ADMIN_URL = os.getenv("ADMIN_URL", "https://app.zakupai.tech/admin.html")


def _send(subject: str, body: str, to: str) -> None:
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASSWORD, to]):
        logger.warning("SMTP not configured or no recipient, skipping notification: %s", subject)
        return

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = to

    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        logger.info("Notification sent to %s: %s", to, subject)
    except Exception:
        logger.exception("Failed to send notification: %s", subject)


def send_lead_notification(name: str, email: str, company: str | None, phone: str | None) -> None:
    body = (
        f"Новая заявка на пилот zakupAI\n\n"
        f"Имя: {name}\n"
        f"Email: {email}\n"
        f"Компания: {company or '—'}\n"
        f"Телефон: {phone or '—'}\n"
    )
    _send(f"Новая заявка: {name}", body, NOTIFY_EMAIL)


def send_registration_notification(email: str, full_name: str | None, organization: str | None) -> None:
    """Notify admin that a new user registered and is awaiting approval."""
    body = (
        f"Новая регистрация в zakupAI (ожидает подтверждения)\n\n"
        f"Email: {email}\n"
        f"ФИО: {full_name or '—'}\n"
        f"Организация: {organization or '—'}\n\n"
        f"Подтвердить/отклонить: {ADMIN_URL}\n"
    )
    _send(f"Регистрация: {email}", body, NOTIFY_EMAIL)


def send_activation_notification(email: str, full_name: str | None) -> None:
    """Notify the user that their account has been activated by admin."""
    greeting = f"Здравствуйте, {full_name}!" if full_name else "Здравствуйте!"
    body = (
        f"{greeting}\n\n"
        f"Ваш аккаунт в zakupAI подтверждён и готов к работе.\n"
        f"Войти: https://app.zakupai.tech/login.html\n\n"
        f"Если нужна помощь с запуском — напишите на info@zakupai.tech.\n"
    )
    _send("zakupAI: доступ открыт", body, email)
