"""토스페이먼츠 API 클라이언트.

문서용 테스트 키(공개, 회원가입 불필요)로 시작하고, 실제 상점 심사가 끝나면
환경변수(TOSS_CLIENT_KEY / TOSS_SECRET_KEY)만 교체하면 된다.

키는 토스페이먼츠 개발자센터 문서에서 "문서용 테스트 키" 로 제공하는 값을
그대로 사용한다 (https://docs.tosspayments.com/reference/using-api/api-keys).
이 모듈은 잘못된 키를 하드코딩해 결제 승인이 조용히 실패하는 사고를 막기 위해
값을 하드코딩하지 않고, 아래 두 환경변수를 반드시 요구한다:

  TOSS_CLIENT_KEY   프론트 SDK 초기화용 (공개 가능)
  TOSS_SECRET_KEY   결제 승인/취소 API Basic 인증용 (절대 노출 금지)

.env.example 에 문서용 테스트 키를 그대로 복사해 넣는 방법이 안내돼 있다.
결제 승인(confirm)만 서버에서 수행한다. 결제 요청/인증은 프론트 SDK(v2) 담당.
"""
from __future__ import annotations

import base64
import os

import httpx
import structlog

logger = structlog.get_logger(__name__)

TOSS_API_BASE = "https://api.tosspayments.com"

_client: httpx.AsyncClient | None = None


class TossNotConfiguredError(Exception):
    """TOSS_CLIENT_KEY / TOSS_SECRET_KEY 가 설정되지 않았을 때."""


def get_client_key() -> str:
    key = (os.getenv("TOSS_CLIENT_KEY") or "").strip()
    if not key:
        raise TossNotConfiguredError(
            "TOSS_CLIENT_KEY가 설정되지 않았습니다. 토스페이먼츠 개발자센터 문서의 "
            "'문서용 테스트 키'를 .env에 넣어주세요: "
            "https://docs.tosspayments.com/reference/using-api/api-keys"
        )
    return key


def _get_secret_key() -> str:
    key = (os.getenv("TOSS_SECRET_KEY") or "").strip()
    if not key:
        raise TossNotConfiguredError(
            "TOSS_SECRET_KEY가 설정되지 않았습니다. 토스페이먼츠 개발자센터 문서의 "
            "'문서용 테스트 키'를 .env에 넣어주세요: "
            "https://docs.tosspayments.com/reference/using-api/api-keys"
        )
    return key


def is_configured() -> bool:
    return bool((os.getenv("TOSS_CLIENT_KEY") or "").strip()) and bool((os.getenv("TOSS_SECRET_KEY") or "").strip())


def is_live_key_configured() -> bool:
    """실 상점 라이브 키(live_ 접두사)가 설정됐는지 여부. test_ 접두사면 테스트 환경으로 간주."""
    key = (os.getenv("TOSS_SECRET_KEY") or "").strip()
    return key.startswith("live_")


def _auth_header() -> str:
    token = base64.b64encode(f"{_get_secret_key()}:".encode("utf-8")).decode("utf-8")
    return f"Basic {token}"


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(base_url=TOSS_API_BASE, timeout=30)
    return _client


class TossPaymentError(Exception):
    """토스 API 에러 — code/message 를 그대로 전달."""

    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


async def confirm_payment(payment_key: str, order_id: str, amount: int) -> dict:
    """결제 승인 API 호출 — POST /v1/payments/confirm.

    성공 시 Payment 객체(dict)를 반환한다. 실패 시 TossPaymentError.
    """
    try:
        resp = await _http().post(
            "/v1/payments/confirm",
            headers={"Authorization": _auth_header(), "Content-Type": "application/json"},
            json={"paymentKey": payment_key, "orderId": order_id, "amount": amount},
        )
    except httpx.HTTPError as e:
        logger.warning("toss.confirm.network_error", error=str(e)[:200])
        raise TossPaymentError(502, "NETWORK_ERROR", "토스페이먼츠 서버에 연결할 수 없습니다") from e

    data = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        code = str(data.get("code") or "UNKNOWN_ERROR")
        message = str(data.get("message") or "결제 승인에 실패했습니다")
        logger.warning("toss.confirm.failed", status=resp.status_code, code=code, order_id=order_id)
        raise TossPaymentError(resp.status_code, code, message)
    return data


async def cancel_payment(payment_key: str, cancel_reason: str) -> dict:
    """결제 취소 API 호출 — POST /v1/payments/{paymentKey}/cancel."""
    try:
        resp = await _http().post(
            f"/v1/payments/{payment_key}/cancel",
            headers={"Authorization": _auth_header(), "Content-Type": "application/json"},
            json={"cancelReason": cancel_reason},
        )
    except httpx.HTTPError as e:
        logger.warning("toss.cancel.network_error", error=str(e)[:200])
        raise TossPaymentError(502, "NETWORK_ERROR", "토스페이먼츠 서버에 연결할 수 없습니다") from e

    data = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        code = str(data.get("code") or "UNKNOWN_ERROR")
        message = str(data.get("message") or "결제 취소에 실패했습니다")
        raise TossPaymentError(resp.status_code, code, message)
    return data
