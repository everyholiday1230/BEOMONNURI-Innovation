"""Redis-based leader election for background tasks.

설계 원칙:
- TTL 짧게 (15초) → 비정상 종료 시 자동 만료
- WORKER_ID에 PID + 시작 시간 포함 → 같은 PID 재사용 충돌 방지
- 시작 시 stale lock 자동 정리 (다른 프로세스가 죽어있으면 강제 takeover)
"""
import asyncio
import os
import time
import redis.asyncio as aioredis
import structlog
from src.config import settings

logger = structlog.get_logger(__name__)

_LOCK_KEY = "co:leader:ingest"
_LOCK_TTL = 15  # seconds
_RENEW_INTERVAL = 5  # seconds
# WORKER_ID = "w<pid>:<startup_ms>" — PID 재사용 시에도 유일성 보장
_WORKER_ID = f"w{os.getpid()}:{int(time.time() * 1000)}"


class LeaderElection:
    """Only one worker runs ingest; others stay idle."""

    def __init__(self):
        self._redis: aioredis.Redis | None = None
        self._is_leader = False
        self._stop = False
        self._takeover_attempts = 0
        self._last_error_log = 0.0

    def _r(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.redis_url)
        return self._redis

    @property
    def is_leader(self) -> bool:
        return self._is_leader

    async def acquire(self) -> bool:
        """Lock 획득. NX로 시도 → 실패 시 stale 검사 → 강제 takeover."""
        try:
            # 1단계: 일반 NX 획득 시도
            ok = await self._r().set(_LOCK_KEY, _WORKER_ID, nx=True, ex=_LOCK_TTL)
            if ok:
                self._is_leader = True
                self._takeover_attempts = 0
                logger.info("leader.acquired", worker=_WORKER_ID)
                return True

            # 2단계: 기존 lock 보유자 확인. PID가 죽었으면 takeover
            val = await self._r().get(_LOCK_KEY)
            if val:
                holder = val.decode() if isinstance(val, bytes) else str(val)
                # WORKER_ID 형식: "w<pid>:<ms>"
                if holder.startswith("w") and ":" in holder:
                    pid_str = holder[1:].split(":")[0]
                    try:
                        holder_pid = int(pid_str)
                        # PID가 살아있는지 확인 (signal 0)
                        try:
                            os.kill(holder_pid, 0)
                            # 살아있음 → 정당한 leader
                            return False
                        except (ProcessLookupError, PermissionError):
                            # 죽음 → takeover
                            self._takeover_attempts += 1
                            logger.warning(
                                "leader.stale_takeover",
                                stale_worker=holder,
                                stale_pid=holder_pid,
                                new_worker=_WORKER_ID,
                                attempt=self._takeover_attempts,
                            )
                            # 강제 set (Lua 스크립트로 atomic check-and-replace)
                            lua = """
                            if redis.call('get', KEYS[1]) == ARGV[1] then
                                return redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3])
                            else
                                return nil
                            end
                            """
                            result = await self._r().eval(
                                lua, 1, _LOCK_KEY, holder, _WORKER_ID, _LOCK_TTL
                            )
                            if result:
                                self._is_leader = True
                                logger.info("leader.took_over", worker=_WORKER_ID)
                                return True
                    except (ValueError, IndexError):
                        # 구버전 형식 — 그대로 두기 (TTL로 자연 만료)
                        pass
            return False
        except Exception as e:
            now = time.time()
            if now - self._last_error_log >= 60:
                self._last_error_log = now
                logger.warning("leader.acquire_error", error=str(e))
            return False

    async def renew_loop(self):
        """Keep renewing lock while leader. If lost, set is_leader=False."""
        while not self._stop:
            await asyncio.sleep(_RENEW_INTERVAL)
            if not self._is_leader:
                # Try to become leader if previous one died
                await self.acquire()
                continue
            try:
                # Only renew if we still own the lock
                val = await self._r().get(_LOCK_KEY)
                holder = val.decode() if isinstance(val, bytes) else (str(val) if val else "")
                if holder == _WORKER_ID:
                    await self._r().expire(_LOCK_KEY, _LOCK_TTL)
                else:
                    self._is_leader = False
                    logger.warning("leader.lost", worker=_WORKER_ID, current_holder=holder)
            except Exception:
                self._is_leader = False

    async def release(self):
        """Graceful shutdown — lock 자발적 반환."""
        self._stop = True
        if self._is_leader:
            try:
                # Atomic check-and-delete (다른 워커가 takeover한 경우 안 지움)
                lua = """
                if redis.call('get', KEYS[1]) == ARGV[1] then
                    return redis.call('del', KEYS[1])
                else
                    return 0
                end
                """
                deleted = await self._r().eval(lua, 1, _LOCK_KEY, _WORKER_ID)
                if deleted:
                    logger.info("leader.released", worker=_WORKER_ID)
            except Exception as _e:
                logger.debug("services.leader.silent_except", error=str(_e)[:100])
        self._is_leader = False


leader = LeaderElection()
