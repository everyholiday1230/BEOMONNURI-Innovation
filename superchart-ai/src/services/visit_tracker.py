"""방문 통계 트래커 (파일 기반 저장).

프로세스 메모리에 카운터를 유지하고, 60초마다 파일에 스냅샷을 저장합니다.
서버 재시작 시 파일에서 복원. 단일 워커 환경에서만 정확하며,
다중 워커 시에는 Redis 기반으로 이전이 필요합니다.

사용:
    from src.services.visit_tracker import stats, record_visit, save_if_due

    # 현재 통계 조회
    stats["total"], stats["unique_ips"], stats["daily"]

    # 방문 기록
    record_visit(ip)

    # 주기적 저장 (미들웨어에서 호출)
    save_if_due()
"""
import json as _json
import time as _time

import structlog

logger = structlog.get_logger(__name__)


_STATS_FILE = "visit_stats.json"
_SAVE_INTERVAL_SEC = 60
_MAX_UNIQUE_IPS = 100_000
_KEEP_DAYS = 7


def _load() -> dict:
    try:
        with open(_STATS_FILE) as f:
            d = _json.load(f)
            d["unique_ips"] = set(d.get("unique_ips", []))
            return d
    except FileNotFoundError:
        # 첫 기동 시 정상적으로 없음 — 로그 불필요
        return {"total": 0, "unique_ips": set(), "daily": {}}
    except Exception as e:
        logger.warning("visit_tracker.load_fail", error=str(e)[:100], file=_STATS_FILE)
        return {"total": 0, "unique_ips": set(), "daily": {}}


def _save() -> None:
    try:
        data = {**stats, "unique_ips": list(stats["unique_ips"])}
        with open(_STATS_FILE, "w") as f:
            _json.dump(data, f)
    except Exception as e:
        logger.warning("visit_tracker.save_fail", error=str(e)[:100], file=_STATS_FILE)


# 모듈 싱글턴 — 서버 기동 시 파일에서 복원
stats: dict = _load()

# 마지막 저장 시각 (미들웨어가 주기적으로 업데이트)
_last_save: float = 0.0


def record_visit(ip: str) -> None:
    """방문 기록 (/ 경로 방문 시 호출)."""
    stats["total"] += 1
    if len(stats["unique_ips"]) < _MAX_UNIQUE_IPS:
        stats["unique_ips"].add(ip)
    day = _time.strftime("%Y-%m-%d")
    stats["daily"][day] = stats["daily"].get(day, 0) + 1
    # 최근 N일만 유지
    keys = sorted(stats["daily"])
    for k in keys[:-_KEEP_DAYS]:
        del stats["daily"][k]


def save_if_due() -> bool:
    """60초 경과 시 파일 저장. 저장했으면 True."""
    global _last_save
    if _time.time() - _last_save > _SAVE_INTERVAL_SEC:
        _save()
        _last_save = _time.time()
        return True
    return False


def force_save() -> None:
    """즉시 저장 (종료 시 호출 권장)."""
    global _last_save
    _save()
    _last_save = _time.time()


__all__ = ["stats", "record_visit", "save_if_due", "force_save"]
