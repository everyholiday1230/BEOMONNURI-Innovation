"""접속 로그 + 로그인 실패 제한 + Rate Limit."""
import time
from collections import defaultdict

# 로그인 실패 추적: {ip: [timestamps]}
_login_failures: dict[str, list[float]] = defaultdict(list)
MAX_FAILURES = 5
LOCK_SECONDS = 1800  # 30분

# Rate limit: 빠른 연속 요청 감지
_request_times: dict[str, list[float]] = defaultdict(list)
RATE_WINDOW = 10  # 10초
RATE_LIMIT = 3000  # 로컬 서버 — 사실상 무제한
_MAX_IPS = 50_000  # 메모리 보호 — 이 이상 누적되면 오래된 항목 정리

# 주기적 청소용 카운터
_cleanup_counter = 0
_CLEANUP_INTERVAL = 1000  # 매 1000회 요청마다 오래된 항목 정리


def _cleanup_if_needed(now: float) -> None:
    """_request_times/_login_failures에서 만료된 IP 엔트리를 제거."""
    global _cleanup_counter
    _cleanup_counter += 1
    if _cleanup_counter < _CLEANUP_INTERVAL and len(_request_times) < _MAX_IPS:
        return
    _cleanup_counter = 0
    # request_times 정리 — 활성 요청이 없는 IP 제거
    stale = [ip for ip, ts in _request_times.items()
             if not ts or now - ts[-1] > RATE_WINDOW * 6]
    for ip in stale:
        _request_times.pop(ip, None)
    # login_failures 정리 — LOCK_SECONDS 초과 시 제거
    stale_f = [ip for ip, ts in _login_failures.items()
               if not ts or now - max(ts) > LOCK_SECONDS]
    for ip in stale_f:
        _login_failures.pop(ip, None)


def is_locked(ip: str) -> bool:
    """IP가 잠금 상태인지 확인."""
    fails = _login_failures.get(ip, [])
    now = time.time()
    recent = [t for t in fails if now - t < LOCK_SECONDS]
    if recent:
        _login_failures[ip] = recent
    else:
        _login_failures.pop(ip, None)
    return len(recent) >= MAX_FAILURES


def record_failure(ip: str):
    _login_failures[ip].append(time.time())


def clear_failures(ip: str):
    _login_failures.pop(ip, None)


def get_lock_remaining(ip: str) -> int:
    """남은 잠금 시간(초)."""
    fails = _login_failures.get(ip, [])
    if len(fails) < MAX_FAILURES:
        return 0
    oldest_relevant = sorted(fails)[-MAX_FAILURES]
    remaining = int(LOCK_SECONDS - (time.time() - oldest_relevant))
    return max(0, remaining)


def is_rate_limited(ip: str) -> bool:
    """빠른 연속 요청 감지."""
    now = time.time()
    _cleanup_if_needed(now)
    times = _request_times[ip]
    # 윈도우 밖 제거 후 추가 (리스트 길이를 우선 제한)
    cutoff = now - RATE_WINDOW
    # 선형 스캔을 피하기 위해 앞쪽부터 제거
    while times and times[0] < cutoff:
        times.pop(0)
    times.append(now)
    return len(times) > RATE_LIMIT
