"""운영 모니터링 엔드포인트.

모든 엔드포인트는 Admin 인증(_auth_admin_check) 필수.

제공:
- GET /v1/ops/metrics     — 요청/에러 메트릭 요약
- GET /v1/ops/dashboard   — 통합 운영 대시보드 (12개 섹션)
- GET /v1/ops/db-status   — DB 스키마/파티션/인덱스 통계
- GET /v1/debug/ingest    — 실시간 데이터 플로우 진단
"""
import os
import time as _time
from pathlib import Path

from fastapi import APIRouter, Request
import structlog

# 프로젝트 루트 (src/api/ops/ops.py → parent x4). 배포 환경별 절대경로 하드코딩 제거.
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

from src.api.auth import _auth_admin_check
from src.services.monitoring import metrics
from src.services.visit_tracker import stats as _visit_stats
from src.ws.gateway import ws_manager

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/v1/ops/metrics")
async def ops_metrics(request: Request):
    """운영 메트릭 대시보드."""
    await _auth_admin_check(request)
    summary = metrics.get_summary()
    summary["alerts"] = metrics.check_alerts()
    summary["ws_connections"] = ws_manager.connection_count
    return summary


@router.get("/v1/debug/ingest")
async def debug_ingest(request: Request):
    """실시간 데이터 플로우 진단 — Admin-Key 필요."""
    await _auth_admin_check(request)
    st = getattr(request.app.state, "ingest_stats", None) or {}
    now = _time.time()
    last_c = st.get("last_candle_at", 0.0)
    last_b = st.get("last_broadcast_at", 0.0)
    active = {
        s: {
            "count": v.get("count", 0),
            "last_at_sec_ago": round(now - v.get("last_at", 0), 1) if v.get("last_at") else None,
            "last_sent": v.get("last_sent", 0),
        }
        for s, v in (st.get("by_symbol") or {}).items()
        if v.get("last_at", 0) > now - 120
    }
    return {
        "total_candles_received": st.get("total_candles", 0),
        "total_broadcasts_sent": st.get("total_broadcasts", 0),
        "last_candle": {
            "symbol": st.get("last_symbol", ""),
            "tf": st.get("last_tf", ""),
            "age_sec": round(now - last_c, 1) if last_c else None,
        },
        "last_broadcast_age_sec": round(now - last_b, 1) if last_b else None,
        "ws_connections": ws_manager.connection_count,
        "subscription_keys": len(ws_manager._subscriptions),
        "active_symbols_60s": len(active),
        "by_symbol_recent": active,
    }


@router.get("/v1/ops/dashboard")
async def ops_dashboard(request: Request):
    """통합 운영 대시보드."""
    await _auth_admin_check(request)
    import redis.asyncio as aioredis
    from src.config import settings

    now = _time.time()
    pid = os.getpid()

    # 1. System — psutil 미설치 환경에서도 운영 대시보드가 500이 되지 않도록 fallback.
    try:
        import psutil
        proc = psutil.Process(pid)
        system = {
            "pid": pid,
            "cpu_pct": proc.cpu_percent(),
            "mem_mb": round(proc.memory_info().rss / 1024 / 1024),
            "threads": proc.num_threads(),
            "uptime_sec": int(now - proc.create_time()),
        }
    except Exception as e:
        logger.warning("ops.dashboard_psutil_unavailable", error=str(e)[:120])
        system = {
            "pid": pid,
            "cpu_pct": None,
            "mem_mb": None,
            "threads": None,
            "uptime_sec": None,
            "degraded": "psutil_unavailable",
        }

    # 2. Redis
    try:
        r = aioredis.from_url(settings.redis_url)
        info = await r.info("memory")
        keys = await r.dbsize()
        cache_keys = len(await r.keys("co:*"))
        await r.aclose()
        redis_info = {"status": "ok", "used_mb": round(info.get("used_memory", 0) / 1024 / 1024, 1), "keys": keys, "cache_keys": cache_keys}
    except Exception as e:
        redis_info = {"status": f"error: {e}"}

    # 3. DB
    try:
        from src.db.session import SessionLocal
        from sqlalchemy import text
        async with SessionLocal() as db:
            t0 = _time.time()
            await db.execute(text("SELECT 1"))
            db_info = {"status": "ok", "latency_ms": round((_time.time() - t0) * 1000)}
    except Exception as e:
        db_info = {"status": f"error: {e}"}

    # 4. Ingest
    st = getattr(request.app.state, "ingest_stats", None) or {}
    last_c = st.get("last_candle_at", 0)
    ingest_info = {
        "total_candles": st.get("total_candles", 0),
        "total_broadcasts": st.get("total_broadcasts", 0),
        "last_candle_age_sec": round(now - last_c, 1) if last_c else None,
        "active_symbols": len([s for s, v in (st.get("by_symbol") or {}).items() if v.get("last_at", 0) > now - 120]),
    }

    # 5. WebSocket
    ws_info = {
        "connections": ws_manager.connection_count,
        "subscriptions": len(ws_manager._subscriptions),
        "ip_count": len(ws_manager._ip_counts),
    }

    # 6. Leader
    try:
        r2 = aioredis.from_url(settings.redis_url)
        leader_val = await r2.get("co:leader:ingest")
        await r2.aclose()
        leader_info = {"holder": leader_val.decode() if leader_val else None, "is_me": leader_val and leader_val.decode() == f"w{pid}"}
    except Exception:
        leader_info = {"holder": None, "is_me": False}

    # 7. Metrics summary
    summary = metrics.get_summary()

    # 8. Alerts
    alerts = []
    if ingest_info["last_candle_age_sec"] and ingest_info["last_candle_age_sec"] > 60:
        alerts.append({"level": "critical", "msg": f"캔들 수신 {ingest_info['last_candle_age_sec']}초 지연"})
    if summary["total_requests"] > 100 and float(summary["error_rate"].replace("%", "")) > 5:
        alerts.append({"level": "warning", "msg": f"에러율 {summary['error_rate']}"})
    if ws_info["connections"] == 0:
        alerts.append({"level": "info", "msg": "WS 연결 0개"})
    if not leader_info["is_me"]:
        alerts.append({"level": "warning", "msg": f"이 워커가 leader 아님 (holder={leader_info['holder']})"})

    # 9. DB 통계
    db_stats = {}
    try:
        from src.db.session import SessionLocal
        from sqlalchemy import text
        async with SessionLocal() as db:
            db_stats["users"] = (await db.execute(text("SELECT count(*) FROM users"))).scalar()
            db_stats["tickets_open"] = (await db.execute(text("SELECT count(*) FROM support_tickets WHERE status='open'"))).scalar()
            db_stats["partitions"] = (await db.execute(text("SELECT count(*) FROM pg_tables WHERE tablename LIKE 'candle_bars_20%'"))).scalar()
            try:
                db_stats["alembic"] = (await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))).scalar()
            except Exception as e:
                logger.debug("ops.dashboard_alembic_fail", error=str(e)[:100])
                db_stats["alembic"] = "not_initialized"
    except Exception as e:
        logger.debug("ops.dashboard_db_stats_fail", error=str(e)[:100])

    # 10. 방문 통계
    visit_info = {
        "total": _visit_stats.get("total", 0),
        "unique": len(_visit_stats.get("unique_ips", set())),
        "today": _visit_stats.get("daily", {}).get(_time.strftime("%Y-%m-%d"), 0),
    }

    # 11. 에러 집계
    error_summary = summary.get("top_errors", {})

    # 12. 확장 알림
    if db_stats.get("tickets_open", 0) > 10:
        alerts.append({"level": "info", "msg": f"미처리 문의 {db_stats['tickets_open']}건"})
    last_b = st.get("last_broadcast_at", 0)
    if last_b and now - last_b > 120:
        alerts.append({"level": "warning", "msg": f"브로드캐스트 {round(now-last_b)}초 전 마지막"})

    return {
        "timestamp": now,
        "version": "0.1.0",
        "system": system,
        "redis": redis_info,
        "db": {**db_info, **db_stats},
        "ingest": {
            **ingest_info,
            "last_broadcast_age_sec": round(now - last_b, 1) if last_b else None,
            "last_symbol": st.get("last_symbol", ""),
            "last_tf": st.get("last_tf", ""),
        },
        "websocket": ws_info,
        "leader": leader_info,
        "visits": visit_info,
        "metrics": {
            "total_requests": summary["total_requests"],
            "error_rate": summary["error_rate"],
            "top_errors": dict(list(error_summary.items())[:10]),
            "recent_errors": summary.get("recent_errors", [])[-10:],
            "alerts_check": summary.get("alerts", []),
        },
        "alerts": alerts,
    }


@router.get("/v1/ops/db-status")
async def ops_db_status(request: Request):
    """DB 스키마/파티션/인덱스/테이블 통계."""
    await _auth_admin_check(request)
    from src.db.session import SessionLocal
    from sqlalchemy import text

    tables = {}
    partitions = []
    idx_count = 0
    alembic = "not_initialized"
    db_size = "unknown"

    async with SessionLocal() as db:
        try:
            for row in (await db.execute(text("SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY n_live_tup DESC"))).all():
                tables[row[0]] = row[1]
        except Exception as e:
            logger.debug("ops.db_status_tables_fail", error=str(e)[:100])
        try:
            partitions = [r[0] for r in (await db.execute(text("SELECT tablename FROM pg_tables WHERE tablename LIKE 'candle_bars_20%' ORDER BY tablename"))).all()]
        except Exception as e:
            logger.debug("ops.db_status_partitions_fail", error=str(e)[:100])
        try:
            idx_count = (await db.execute(text("SELECT count(*) FROM pg_indexes WHERE schemaname='public'"))).scalar() or 0
        except Exception as e:
            logger.debug("ops.db_status_idx_fail", error=str(e)[:100])
        try:
            alembic = (await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))).scalar() or "not_initialized"
        except Exception as e:
            logger.debug("ops.db_status_alembic_fail", error=str(e)[:100])
        try:
            db_size = (await db.execute(text("SELECT pg_size_pretty(pg_database_size(current_database()))"))).scalar() or "unknown"
        except Exception as e:
            logger.debug("ops.db_status_size_fail", error=str(e)[:100])

    return {
        "db_size": db_size,
        "alembic_version": alembic,
        "table_count": len(tables),
        "index_count": idx_count,
        "partition_count": len(partitions),
        "partitions": partitions,
        "tables": tables,
    }


@router.get("/v1/stats/visits")
async def visit_stats(request: Request, key: str = ""):
    """방문 통계 조회 — Admin 인증 필수."""
    await _auth_admin_check(request)
    return {
        "total": _visit_stats["total"],
        "unique": len(_visit_stats["unique_ips"]),
        "daily": dict(sorted(_visit_stats["daily"].items())[-7:]),
    }


@router.post("/v1/ops/clear-cache")
async def clear_cache(request: Request):
    """Redis 캐시 초기화."""
    await _auth_admin_check(request)
    import redis.asyncio as aioredis
    from src.config import settings
    r = aioredis.from_url(settings.redis_url)
    keys = await r.keys("co:*")
    if keys:
        await r.delete(*keys)
    await r.aclose()
    return {"success": True, "data": {"cleared": len(keys)}}


@router.get("/v1/ops/bot-status")
async def bot_status(request: Request):
    """데모봇 현황."""
    await _auth_admin_check(request)
    import subprocess, json, glob
    # 실행 중 봇 수
    result = subprocess.run(["pgrep", "-fc", "megabot_div_"], capture_output=True, text=True)
    running = int(result.stdout.strip()) if result.returncode == 0 else 0
    # 최근 거래
    trades = []
    for f in sorted(glob.glob("logs/paper_div_*.json"))[-5:]:
        try:
            d = json.load(open(f))
            trades.append({"file": f.split("/")[-1], "count": len(d.get("trades", [])), "pnl": round(d.get("total_pnl", 0), 1)})
        except Exception:
            pass
    total_pnl = sum(t["pnl"] for t in trades)
    return {"success": True, "data": {"running": running, "strategies": trades, "total_pnl": total_pnl}}


@router.post("/v1/ops/restart-bots")
async def restart_bots(request: Request):
    """봇 재시작."""
    await _auth_admin_check(request)
    import subprocess
    subprocess.run(["pkill", "-f", "megabot_div_"], capture_output=True)
    subprocess.Popen(["bash", "scripts/manage_bots.sh", "start"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"success": True, "data": {"message": "봇 재시작 요청됨"}}


@router.get("/v1/ops/today-stats")
async def today_stats(request: Request):
    """오늘 통계."""
    await _auth_admin_check(request)
    from src.db.session import SessionLocal
    from sqlalchemy import text
    # 각 카운트를 독립적으로 조회 — 일부 테이블이 없어도(예: alert_rules/bot_trades 미생성)
    # 전체 503 대신 해당 항목만 0 으로 처리(graceful degradation).
    async def _count(sql: str) -> int:
        try:
            async with SessionLocal() as db:
                r = await db.execute(text(sql))
                v = r.scalar()
                return int(v or 0)
        except Exception:
            return 0
    new_users_today = await _count("SELECT count(*) FROM users WHERE created_at >= CURRENT_DATE")
    total_users = await _count("SELECT count(*) FROM users")
    visits_today = await _count("SELECT count(*) FROM access_logs WHERE created_at >= CURRENT_DATE")
    active_alerts = await _count("SELECT count(*) FROM alert_rules WHERE is_active = true")
    bot_trades_today = await _count("SELECT count(*) FROM bot_trades WHERE opened_at >= CURRENT_DATE")
    return {"success": True, "data": {
        "new_users_today": new_users_today, "total_users": total_users,
        "visits_today": visits_today, "active_alerts": active_alerts,
        "bot_trades_today": bot_trades_today
    }}


@router.get("/v1/ops/error-log")
async def error_log(request: Request):
    """최근 에러 로그 (마지막 30줄)."""
    await _auth_admin_check(request)
    import subprocess
    # chartos.log에서 ERROR/WARNING 추출
    result = subprocess.run(
        ["grep", "-i", "error\\|warning\\|traceback", "logs/chartos.log"],
        capture_output=True, text=True, cwd=str(BASE_DIR)
    )
    lines = result.stdout.strip().split('\n')[-30:]
    return {"success": True, "data": {"log": '\n'.join(lines) if lines[0] else "에러 없음 ✅"}}


@router.post("/v1/ops/restart-server")
async def restart_server(request: Request):
    """서버 재시작 (graceful)."""
    await _auth_admin_check(request)
    import subprocess
    # systemctl restart를 백그라운드로 (현재 요청 응답 후 재시작)
    subprocess.Popen(["bash", "-c", "sleep 2 && sudo systemctl restart chart-os"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"success": True, "data": {"message": "2초 후 재시작됩니다"}}


@router.get("/v1/ops/user-analytics")
async def user_analytics(request: Request):
    """사용자 행동 분석."""
    await _auth_admin_check(request)
    from src.db.session import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        # 등급별 분포
        tiers = await db.execute(text("SELECT tier, count(*) FROM users GROUP BY tier ORDER BY count(*) DESC"))
        tier_data = [{"tier": r[0] or "free", "count": r[1]} for r in tiers.fetchall()]
        
        # 최근 7일 가입 추이
        signups = await db.execute(text("""
            SELECT created_at::date as d, count(*) 
            FROM users WHERE created_at >= CURRENT_DATE - 7 
            GROUP BY d ORDER BY d
        """))
        signup_data = [{"date": str(r[0]), "count": r[1]} for r in signups.fetchall()]
        
        # 최근 활성 사용자 (7일 내 접속)
        active = await db.execute(text("""
            SELECT count(DISTINCT user_id) FROM access_logs 
            WHERE created_at >= CURRENT_DATE - 7 AND user_id IS NOT NULL
        """))
        active_7d = active.scalar() or 0
        
        # 인기 종목 TOP 10
        popular = await db.execute(text("""
            SELECT path, count(*) as cnt FROM access_logs 
            WHERE path LIKE '/v1/charts/candles%' AND created_at >= CURRENT_DATE - 7
            GROUP BY path ORDER BY cnt DESC LIMIT 10
        """))
        popular_data = []
        for r in popular.fetchall():
            sym = r[0].split('symbol=')[1].split('&')[0] if 'symbol=' in r[0] else r[0]
            popular_data.append({"symbol": sym, "views": r[1]})

    return {"success": True, "data": {
        "tiers": tier_data,
        "signups_7d": signup_data,
        "active_7d": active_7d,
        "popular_symbols": popular_data
    }}


@router.post("/v1/ops/push-notice")
async def push_notice(request: Request):
    """접속 중인 사용자에게 공지 즉시 푸시 (WebSocket)."""
    await _auth_admin_check(request)
    body = await request.json()
    msg = body.get("message", "")
    if not msg:
        return {"success": False, "error": {"code": "BAD_REQUEST", "message": "message 필요"}}
    
    # Redis pub/sub으로 모든 WS 클라이언트에 전송
    import redis.asyncio as aioredis
    from src.config import settings
    r = aioredis.from_url(settings.redis_url)
    import json
    await r.publish("ws:broadcast", json.dumps({"type": "notice", "message": msg}))
    await r.aclose()
    return {"success": True, "data": {"message": "공지 발송됨", "text": msg}}


@router.get("/v1/ops/realtime")
async def realtime_stats(request: Request):
    """실시간 통계 — WS 접속자, 최근 가입자, 서버 리소스."""
    await _auth_admin_check(request)
    import psutil
    from src.db.session import SessionLocal
    from sqlalchemy import text
    
    # 서버 리소스
    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    
    # WS 접속자
    ws_count = getattr(request.app.state, 'ws_connections', 0)
    
    # 최근 가입자 5명
    async with SessionLocal() as db:
        recent = await db.execute(text("""
            SELECT nickname, email, created_at, tier 
            FROM users ORDER BY created_at DESC LIMIT 5
        """))
        recent_users = [{"nickname": r[0], "email": r[1][:3]+"***", "date": str(r[2])[:16], "tier": r[3] or "free"} for r in recent.fetchall()]
        
        # 오늘 활성 사용자
        active = await db.execute(text("SELECT count(DISTINCT user_id) FROM access_logs WHERE created_at >= CURRENT_DATE AND user_id IS NOT NULL"))
        active_today = active.scalar() or 0
    
    return {"success": True, "data": {
        "ws_connections": ws_count,
        "active_today": active_today,
        "server": {
            "cpu_pct": cpu,
            "mem_used_mb": round(mem.used / 1024 / 1024),
            "mem_total_mb": round(mem.total / 1024 / 1024),
            "mem_pct": mem.percent,
            "disk_used_gb": round(disk.used / 1024 / 1024 / 1024, 1),
            "disk_total_gb": round(disk.total / 1024 / 1024 / 1024, 1),
            "disk_pct": disk.percent,
        },
        "recent_users": recent_users
    }}


@router.get("/v1/ops/revenue")
async def revenue_stats(request: Request):
    """매출 통계."""
    await _auth_admin_check(request)
    from src.db.session import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        # 이번달 매출
        monthly = await db.execute(text("""
            SELECT COALESCE(SUM(amount), 0) FROM point_ledger 
            WHERE reason = 'payment' AND created_at >= date_trunc('month', CURRENT_DATE)
        """))
        monthly_revenue = monthly.scalar() or 0
        
        # 구독 현황
        tiers = await db.execute(text("SELECT tier, count(*) FROM users GROUP BY tier"))
        tier_data = {r[0] or 'free': r[1] for r in tiers.fetchall()}
        
        # 일별 매출 (7일)
        daily = await db.execute(text("""
            SELECT created_at::date, SUM(amount) FROM point_ledger 
            WHERE reason = 'payment' AND created_at >= CURRENT_DATE - 7
            GROUP BY created_at::date ORDER BY 1
        """))
        daily_data = [{"date": str(r[0]), "amount": r[1]} for r in daily.fetchall()]
    
    return {"success": True, "data": {
        "monthly_revenue": monthly_revenue,
        "tiers": tier_data,
        "daily_revenue": daily_data
    }}


@router.post("/v1/ops/delete-user")
async def delete_user(request: Request):
    """회원 삭제 (soft delete — 상태만 변경)."""
    await _auth_admin_check(request)
    body = await request.json()
    uid = body.get("user_id")
    if not uid: return {"success": False, "error": {"code": "BAD_REQUEST", "message": "user_id 필요"}}
    from src.db.session import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        await db.execute(text("UPDATE users SET status = 'deleted', email = email || '_deleted_' || now()::text WHERE id = :uid"), {"uid": uid})
        await db.commit()
    return {"success": True, "data": {"message": "회원 삭제 완료"}}


@router.post("/v1/ops/toggle-symbol")
async def toggle_symbol(request: Request):
    """종목 활성/비활성 토글."""
    await _auth_admin_check(request)
    body = await request.json()
    symbol = body.get("symbol_code")
    if not symbol: return {"success": False, "error": {"code": "BAD_REQUEST", "message": "symbol_code 필요"}}
    from src.db.session import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        row = (await db.execute(text("SELECT status FROM symbols WHERE symbol_code = :s"), {"s": symbol})).fetchone()
        if not row: return {"success": False, "error": {"code": "NOT_FOUND", "message": "종목 없음"}}
        new_status = 'inactive' if row[0] == 'active' else 'active'
        await db.execute(text("UPDATE symbols SET status = :st WHERE symbol_code = :s"), {"st": new_status, "s": symbol})
        await db.commit()
    return {"success": True, "data": {"symbol": symbol, "status": new_status}}


@router.get("/v1/ops/user-logs")
async def user_logs(request: Request):
    """특정 사용자 접속 기록."""
    await _auth_admin_check(request)
    uid = request.query_params.get("user_id", "")
    if not uid: return {"success": False, "error": {"code": "BAD_REQUEST", "message": "user_id 필요"}}
    from src.db.session import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT ip_address, path, created_at FROM access_logs 
            WHERE user_id = :uid ORDER BY created_at DESC LIMIT 50
        """), {"uid": uid})).fetchall()
    return {"success": True, "data": {"logs": [{"ip": r[0], "path": r[1], "time": str(r[2])} for r in rows]}}


@router.get("/v1/ops/signup-stats")
async def signup_stats(request: Request):
    """일별 가입자 통계 (30일)."""
    await _auth_admin_check(request)
    from src.db.session import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            SELECT created_at::date as d, count(*) FROM users 
            WHERE created_at >= CURRENT_DATE - 30 
            GROUP BY d ORDER BY d
        """))).fetchall()
    return {"success": True, "data": {"daily": [{"date": str(r[0]), "count": r[1]} for r in rows]}}


@router.post("/v1/ops/backup-db")
async def backup_db(request: Request):
    """DB 백업 수동 실행."""
    await _auth_admin_check(request)
    import subprocess
    r = subprocess.Popen(["bash", "scripts/db/backup_db.sh"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=str(BASE_DIR))
    return {"success": True, "data": {"message": "백업 시작됨 (백그라운드)"}}


@router.get("/v1/ops/server-log")
async def server_log(request: Request):
    """서버 로그 최근 50줄."""
    await _auth_admin_check(request)
    import subprocess
    r = subprocess.run(["journalctl", "-u", "chart-os", "--no-pager", "-n", "50", "-q"], capture_output=True, text=True)
    return {"success": True, "data": {"log": r.stdout[-3000:]}}
