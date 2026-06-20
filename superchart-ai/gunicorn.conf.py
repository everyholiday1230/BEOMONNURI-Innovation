"""Gunicorn 설정 — 워커 수를 서버 사양(CPU/메모리)에 맞춰 자동 계산.

목적:
  - 서버를 옮겨도(다른 사양) 그 서버에 맞는 적정 워커 수를 자동으로 사용.
  - 무한정 늘려 메모리가 터지는(OOM) 일이 없도록 메모리 기준 상한을 둔다.

계산 로직 (둘 중 '작은 값' 채택):
  1) CPU 기준 권장:  workers_cpu = 2 * CPU코어 + 1   (gunicorn 공식 권장)
  2) 메모리 기준 상한: workers_mem = (가용메모리 * 안전계수) / 워커당_예상메모리
  → 최종 = min(cpu, mem), 단 [WORKERS_MIN, WORKERS_MAX] 범위로 클램프.

환경변수로 모두 오버라이드 가능:
  GUNICORN_WORKERS         지정 시 자동계산 무시하고 이 값으로 고정.
  GUNICORN_WORKERS_MIN     최소 워커 수 (기본 2)
  GUNICORN_WORKERS_MAX     최대 워커 수 (기본 12)
  GUNICORN_MEM_PER_WORKER_MB  워커당 예상 메모리 MB (기본 700)
  GUNICORN_MEM_SAFETY      가용메모리 중 웹서버에 할당할 비율 (기본 0.6)
                           (나머지는 자동매매 봇/로거/DB 캐시 등 다른 프로세스 몫)
  GUNICORN_BIND            바인드 주소 (기본 0.0.0.0:8000)
  GUNICORN_TIMEOUT         워커 타임아웃 초 (기본 120)
"""
import os
import multiprocessing


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _cpu_count() -> int:
    # 컨테이너 cgroup 제한도 고려: sched_getaffinity가 더 정확.
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        return max(1, multiprocessing.cpu_count())


def _available_mem_mb() -> float:
    """가용 메모리(MB). /proc/meminfo의 MemAvailable 우선, 실패 시 보수적 기본값."""
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    kb = float(line.split()[1])
                    return kb / 1024.0
    except (OSError, ValueError, IndexError):
        pass
    # /proc 못 읽으면 보수적으로 1GB 가정 → 최소 워커만 뜨도록
    return 1024.0


def _calc_workers() -> int:
    # 1) 강제 고정값이 있으면 그대로 사용
    forced = os.getenv("GUNICORN_WORKERS")
    if forced:
        try:
            return max(1, int(forced))
        except ValueError:
            pass

    wmin = _env_int("GUNICORN_WORKERS_MIN", 2)
    wmax = _env_int("GUNICORN_WORKERS_MAX", 12)
    mem_per_worker = _env_float("GUNICORN_MEM_PER_WORKER_MB", 700.0)
    mem_safety = _env_float("GUNICORN_MEM_SAFETY", 0.6)

    cores = _cpu_count()
    avail_mb = _available_mem_mb()

    # CPU 기준 권장
    workers_cpu = 2 * cores + 1
    # 메모리 기준 상한 (가용메모리의 일부만 웹서버에 — 나머지는 봇/로거/DB캐시 몫)
    workers_mem = int((avail_mb * mem_safety) / max(1.0, mem_per_worker))

    workers = min(workers_cpu, workers_mem)
    workers = max(wmin, min(workers, wmax))
    return workers


# ── gunicorn 설정값 ──
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:8000")
workers = _calc_workers()
worker_class = "uvicorn.workers.UvicornWorker"
timeout = _env_int("GUNICORN_TIMEOUT", 120)
graceful_timeout = _env_int("GUNICORN_GRACEFUL_TIMEOUT", 30)
# 메모리 누수 방어: 일정 요청 수마다 워커 재활용 (지터로 동시 재시작 방지)
max_requests = _env_int("GUNICORN_MAX_REQUESTS", 2000)
max_requests_jitter = _env_int("GUNICORN_MAX_REQUESTS_JITTER", 200)
accesslog = "-"
errorlog = os.getenv("GUNICORN_ERROR_LOG", "logs/gunicorn_error.log")


def on_starting(server):
    """마스터 시작 시 1회 — 어떤 근거로 워커 수를 정했는지 로그로 남김."""
    cores = _cpu_count()
    avail = _available_mem_mb()
    server.log.info(
        "[gunicorn.conf] workers=%d (cores=%d, mem_avail=%.0fMB, "
        "cpu_rec=%d, mem_cap=%d) bind=%s",
        workers, cores, avail, 2 * cores + 1,
        int((avail * _env_float("GUNICORN_MEM_SAFETY", 0.6))
            / max(1.0, _env_float("GUNICORN_MEM_PER_WORKER_MB", 700.0))),
        bind,
    )
