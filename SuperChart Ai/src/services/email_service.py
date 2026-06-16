"""이메일 발송 서비스 — SMTP 기반."""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import structlog

logger = structlog.get_logger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@chartos.io")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")


def send_email(to: str, subject: str, html_body: str) -> bool:
    """이메일 발송. ENV=production이면 SMTP 미설정 시 실패."""
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
        env = os.getenv("ENV", "dev")
        if env in ("production", "prod"):
            logger.error("email.smtp_not_configured_in_production", to=to, subject=subject)
        else:
            logger.warning("email.smtp_not_configured_dev", to=to, subject=subject, body_preview=html_body[:100])
        return False  # SMTP 미설정 → 항상 실패 (거짓 성공 제거)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, to, msg.as_string())
        logger.info("email.sent", to=to, subject=subject)
        return True
    except Exception as e:
        logger.error("email.failed", to=to, error=str(e))
        return False


def send_verification_email(to: str, token: str):
    link = f"{BASE_URL}/v1/auth/verify-email?token={token}"
    html = f"""<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
    <h2>📧 이메일 인증</h2>
    <p>아래 버튼을 클릭하여 이메일을 인증해주세요.</p>
    <a href="{link}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">이메일 인증하기</a>
    <p style="color:#888;font-size:12px;margin-top:16px">이 링크는 24시간 동안 유효합니다.</p>
    </div>"""
    return send_email(to, "[범온 AI 슈퍼차트] 이메일 인증", html)


def send_password_reset_email(to: str, token: str):
    link = f"{BASE_URL}/v1/auth/reset-password-page?token={token}"
    html = f"""<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
    <h2>🔑 비밀번호 재설정</h2>
    <p>아래 버튼을 클릭하여 비밀번호를 재설정해주세요.</p>
    <a href="{link}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">비밀번호 재설정</a>
    <p style="color:#888;font-size:12px;margin-top:16px">이 링크는 1시간 동안 유효합니다.</p>
    </div>"""
    return send_email(to, "[범온 AI 슈퍼차트] 비밀번호 재설정", html)
