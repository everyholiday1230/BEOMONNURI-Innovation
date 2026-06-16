"""운영 모니터링 — 요청 추적, 에러 로그, 메트릭 수집."""
import time
import uuid
import re
import structlog
from collections import defaultdict, deque

logger = structlog.get_logger(__name__)

# ═══ 요청 추적 ID ═══
def generate_request_id() -> str:
    return str(uuid.uuid4())[:8]


# ═══ 민감정보 마스킹 ═══
_MASK_PATTERNS = [
    (re.compile(r'(password|secret|token|api_key|passphrase)\s*[=:]\s*\S+', re.I), r'\1=***'),
    (re.compile(r'(Bearer\s+)\S+', re.I), r'\1***'),
    (re.compile(r'(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b)'), '***@***.***'),
]

def mask_sensitive(text: str) -> str:
    for pattern, repl in _MASK_PATTERNS:
        text = pattern.sub(repl, text)
    return text


# ═══ 메트릭 수집 ═══
class Metrics:
    def __init__(self):
        self.request_count = defaultdict(int)       # path → count
        self.error_count = defaultdict(int)         # path → count
        self.ai_calls = 0
        self.ai_failures = 0
        self.ai_total_ms = 0
        self.db_errors = 0
        self.recent_errors = deque(maxlen=100)      # 최근 에러 100개
        self.start_time = time.time()

    def record_request(self, path: str):
        self.request_count[path] += 1

    def record_error(self, path: str, error: str, request_id: str = ""):
        self.error_count[path] += 1
        self.recent_errors.append({
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "path": path,
            "error": mask_sensitive(error[:200]),
            "request_id": request_id,
        })

    def record_ai_call(self, success: bool, duration_ms: float):
        self.ai_calls += 1
        self.ai_total_ms += duration_ms
        if not success:
            self.ai_failures += 1

    def record_db_error(self):
        self.db_errors += 1

    def get_summary(self) -> dict:
        uptime = time.time() - self.start_time
        total_req = sum(self.request_count.values())
        total_err = sum(self.error_count.values())
        return {
            "uptime_sec": int(uptime),
            "total_requests": total_req,
            "total_errors": total_err,
            "error_rate": f"{total_err/max(total_req,1)*100:.2f}%",
            "ai": {
                "calls": self.ai_calls,
                "failures": self.ai_failures,
                "avg_ms": round(self.ai_total_ms / max(self.ai_calls, 1)),
                "failure_rate": f"{self.ai_failures/max(self.ai_calls,1)*100:.1f}%",
            },
            "db_errors": self.db_errors,
            "top_errors": dict(sorted(self.error_count.items(), key=lambda x: -x[1])[:10]),
            "top_paths": dict(sorted(self.request_count.items(), key=lambda x: -x[1])[:10]),
            "recent_errors": list(self.recent_errors)[-10:],
        }

    def check_alerts(self) -> list[str]:
        """장애 알림 기준 체크."""
        alerts = []
        total_req = sum(self.request_count.values())
        total_err = sum(self.error_count.values())

        # 에러율 5% 초과
        if total_req > 100 and total_err / total_req > 0.05:
            alerts.append(f"에러율 {total_err/total_req*100:.1f}% (기준: 5%)")

        # AI 실패율 30% 초과
        if self.ai_calls > 10 and self.ai_failures / self.ai_calls > 0.3:
            alerts.append(f"AI 실패율 {self.ai_failures/self.ai_calls*100:.0f}% (기준: 30%)")

        # DB 에러 10건 초과
        if self.db_errors > 10:
            alerts.append(f"DB 에러 {self.db_errors}건 (기준: 10)")

        return alerts


# 싱글톤
metrics = Metrics()
