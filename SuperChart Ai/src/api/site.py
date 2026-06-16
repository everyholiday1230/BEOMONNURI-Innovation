"""공지사항 + FAQ + 사이트설정 API."""
import structlog
logger = structlog.get_logger(__name__)
import os
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.session import get_db
from src.models.tables import Notice, FAQ, SiteSetting
from src.models.schemas import ApiResponse

router = APIRouter()


def ADMIN_KEY() -> str:
    """관리자 키 — 매 호출 시 환경변수 다시 읽기 (테스트 등에서 패치 가능)."""
    return os.getenv("ADMIN_KEY", "")


async def _check_admin(request: Request):
    """Alias to src/services/admin_helpers.py:auth_admin_check.

    통합 인증 체크 사용 — 하위 호환용 내부 별칭.
    신규 코드는 admin_helpers 에서 직접 import 권장.
    """
    from src.services.admin_helpers import auth_admin_check
    return await auth_admin_check(request)


# ── 공지사항 (공개) ──
@router.get("/notices")
async def list_notices(content_type: str = "", db: AsyncSession = Depends(get_db)):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    q = select(Notice).where(Notice.is_active == True, Notice.status == "published")
    if content_type:
        q = q.where(Notice.content_type == content_type)
    # 기간 필터: start_at/end_at이 설정된 경우만 체크
    q = q.where((Notice.start_at.is_(None)) | (Notice.start_at <= now))
    q = q.where((Notice.end_at.is_(None)) | (Notice.end_at >= now))
    q = q.order_by(desc(Notice.priority), desc(Notice.is_pinned), desc(Notice.created_at))
    try:
        notices = (await db.execute(q)).scalars().all()
        return ApiResponse(data=[{
            "id": str(n.id), "title": n.title, "content": n.content,
            "content_type": n.content_type, "is_pinned": n.is_pinned,
            "priority": n.priority, "dismiss_policy": n.dismiss_policy,
            "target_user": n.target_user, "cta_text": n.cta_text, "cta_url": n.cta_url,
            "created_at": str(n.created_at)
        } for n in notices])
    except Exception as e:
        logger.warning("site.notices_fallback", error=str(e)[:200])
        return ApiResponse(data=[])


@router.get("/notices/banner")
async def notice_banner(db: AsyncSession = Depends(get_db)):
    """메인 페이지 상단 배너용 — 고정 공지 1개."""
    try:
        setting = await db.execute(select(SiteSetting).where(SiteSetting.key == "notice_enabled"))
        s = setting.scalar()
        if s and s.value == "false":
            return ApiResponse(data=None)
        result = await db.execute(select(Notice).where(Notice.is_active == True, Notice.is_pinned == True).order_by(desc(Notice.created_at)).limit(1))
        n = result.scalar()
        if not n:
            return ApiResponse(data=None)
        return ApiResponse(data={"id": str(n.id), "title": n.title, "content": n.content})
    except Exception as e:
        logger.warning("site.notice_banner_fallback", error=str(e)[:200])
        return ApiResponse(data=None)

@router.get("/notices/admin")
async def admin_list_notices(request: Request, db: AsyncSession = Depends(get_db)):
    """관리자용 전체 공지 목록 (draft/archived 포함)."""
    await _check_admin(request=request)
    notices = (await db.execute(select(Notice).order_by(desc(Notice.created_at)))).scalars().all()
    return ApiResponse(data=[{
        "id": str(n.id), "title": n.title, "content": n.content,
        "content_type": getattr(n, 'content_type', 'notice'),
        "status": getattr(n, 'status', 'published'),
        "priority": getattr(n, 'priority', 0),
        "is_pinned": n.is_pinned, "is_active": n.is_active,
        "placement": getattr(n, 'placement', 'home'),
        "target_user": getattr(n, 'target_user', 'all'),
        "dismiss_policy": getattr(n, 'dismiss_policy', 'close'),
        "locale": getattr(n, 'locale', 'ko'),
        "start_at": str(n.start_at) if getattr(n, 'start_at', None) else None,
        "end_at": str(n.end_at) if getattr(n, 'end_at', None) else None,
        "view_count": getattr(n, 'view_count', 0),
        "click_count": getattr(n, 'click_count', 0),
        "cta_text": getattr(n, 'cta_text', None),
        "cta_url": getattr(n, 'cta_url', None),
        "created_at": str(n.created_at), "updated_at": str(getattr(n, 'updated_at', n.created_at)),
    } for n in notices])


# ── 공지사항 (관리자) ──
@router.post("/notices")
async def create_notice(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    n = Notice(title=req["title"], content=req.get("content", ""), is_pinned=req.get("is_pinned", False),
               content_type=req.get("content_type", "notice"), status=req.get("status", "published"),
               priority=req.get("priority", 0), placement=req.get("placement", "home"),
               target_user=req.get("target_user", "all"), dismiss_policy=req.get("dismiss_policy", "close"),
               locale=req.get("locale", "ko"), cta_text=req.get("cta_text"), cta_url=req.get("cta_url"))
    if req.get("start_at"):
        from datetime import datetime; n.start_at = datetime.fromisoformat(req["start_at"])
    if req.get("end_at"):
        from datetime import datetime; n.end_at = datetime.fromisoformat(req["end_at"])
    db.add(n)
    await db.commit()
    return ApiResponse(data={"id": str(n.id)})


@router.put("/notices/{notice_id}")
async def update_notice(notice_id: str, req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    result = await db.execute(select(Notice).where(Notice.id == notice_id))
    n = result.scalar()
    if not n:
        raise HTTPException(404, "Not found")
    for f in ["title","content","is_pinned","is_active","content_type","status","priority",
              "placement","target_user","dismiss_policy","locale","cta_text","cta_url"]:
        if f in req: setattr(n, f, req[f])
    if "start_at" in req:
        from datetime import datetime
        n.start_at = datetime.fromisoformat(req["start_at"]) if req["start_at"] else None
    if "end_at" in req:
        from datetime import datetime
        n.end_at = datetime.fromisoformat(req["end_at"]) if req["end_at"] else None
    await db.commit()
    return ApiResponse(data={"id": str(n.id)})


@router.delete("/notices/{notice_id}")
async def delete_notice(notice_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    result = await db.execute(select(Notice).where(Notice.id == notice_id))
    n = result.scalar()
    if not n:
        raise HTTPException(404, "Not found")
    await db.delete(n)
    await db.commit()
    return ApiResponse(data={"deleted": True})


# ── FAQ (공개) ──
@router.get("/faqs")
async def list_faqs(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(FAQ).where(FAQ.is_active == True).order_by(FAQ.sort_order))
        faqs = result.scalars().all()
        return ApiResponse(data=[{"id": str(f.id), "question": f.question, "answer": f.answer, "sort_order": f.sort_order} for f in faqs])
    except Exception as e:
        logger.warning("site.faqs_fallback", error=str(e)[:200])
        return ApiResponse(data=[])


# ── FAQ (관리자) ──
@router.post("/faqs")
async def create_faq(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    f = FAQ(question=req["question"], answer=req["answer"], sort_order=req.get("sort_order", 0))
    db.add(f)
    await db.commit()
    return ApiResponse(data={"id": str(f.id)})


@router.put("/faqs/{faq_id}")
async def update_faq(faq_id: str, req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    result = await db.execute(select(FAQ).where(FAQ.id == faq_id))
    f = result.scalar()
    if not f:
        raise HTTPException(404, "Not found")
    if "question" in req: f.question = req["question"]
    if "answer" in req: f.answer = req["answer"]
    if "sort_order" in req: f.sort_order = req["sort_order"]
    if "is_active" in req: f.is_active = req["is_active"]
    await db.commit()
    return ApiResponse(data={"id": str(f.id)})


@router.delete("/faqs/{faq_id}")
async def delete_faq(faq_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    result = await db.execute(select(FAQ).where(FAQ.id == faq_id))
    f = result.scalar()
    if not f:
        raise HTTPException(404, "Not found")
    await db.delete(f)
    await db.commit()
    return ApiResponse(data={"deleted": True})


# ── 사이트 설정 ──
@router.get("/settings")
async def get_settings(request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    result = await db.execute(select(SiteSetting))
    settings = result.scalars().all()
    return ApiResponse(data={s.key: s.value for s in settings})


@router.post("/settings")
async def update_settings(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_admin(request=request)
    for k, v in req.items():
        if k == "key":
            continue
        result = await db.execute(select(SiteSetting).where(SiteSetting.key == k))
        s = result.scalar()
        if s:
            s.value = str(v)
        else:
            db.add(SiteSetting(key=k, value=str(v)))
    await db.commit()
    return ApiResponse(data={"updated": True})


# ── 점검모드 확인 (공개) ──
@router.get("/settings/public")
async def public_settings(db: AsyncSession = Depends(get_db)):
    """점검모드 등 공개 설정."""
    keys = ["maintenance_mode", "site_name", "notice_enabled"]
    try:
        result = await db.execute(select(SiteSetting).where(SiteSetting.key.in_(keys)))
        settings = result.scalars().all()
        return ApiResponse(data={s.key: s.value for s in settings})
    except Exception as e:
        logger.warning("site.public_settings_fallback", error=str(e)[:200])
        return ApiResponse(data={"maintenance_mode": "false", "site_name": "Chart OS", "notice_enabled": "false"})


# ── 차트 설정 서버 저장 ──
from src.services.auth import get_current_user_id


@router.get("/chart-settings")
async def get_chart_settings(request: Request, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    from src.models.tables import UserChartSettings
    from src.services.beom_free import get_user_tier
    result = await db.execute(select(UserChartSettings).where(UserChartSettings.user_id == user_id))
    s = result.scalar()
    if not s or not s.settings_json:
        return ApiResponse(data=None)
    data = dict(s.settings_json)
    # read-time sanitize — tier 기반
    _REMOVED = {"bimaco4", "b3_60"}
    _PRO_INDS = {"ultra","bimaco2","ob","ttr","align","bimaco_tp",
        "udstoch","uprsi","ladder","qsig_safe","qsig_std","qsig_aggr",
        "buyscan","entry","entry2","v12sig","pvinvi","patterns","obsig","autobot"}
    _PRO_SUBS = {"kvo","master"}
    tier = await get_user_tier(request)
    is_pro = tier in ("pro", "premium")
    if "activeInds" in data:
        data["activeInds"] = [i for i in data["activeInds"] if i not in _REMOVED and (is_pro or i not in _PRO_INDS)]
    if "activeSubs" in data:
        data["activeSubs"] = [i for i in data["activeSubs"] if i not in _REMOVED and (is_pro or i not in _PRO_SUBS)]
    return ApiResponse(data=data)


@router.post("/chart-settings")
async def save_chart_settings(req: dict, request: Request, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    from src.models.tables import UserChartSettings
    from src.services.beom_free import get_user_tier

    # 허용목록 기반 sanitize
    _ALLOWED_INDS = {"ema9","ema20","ema50","ema200","sma50","sma200","tema20","tema60","beom_free","darak","dema21",
        "wma20","hma20","emaribbon","bb","keltner","envelope","vwap","ichimoku","psar",
        "supertrend","pivot","volprofile","stc","rsimfi","pasrpvi","autotrend","vol"}
    _PRO_INDS = {"ultra","bimaco2","ob","ttr","align","bimaco_tp",
        "udstoch","uprsi","ladder","qsig_safe","qsig_std","qsig_aggr",
        "buyscan","entry","entry2","v12sig","pvinvi","patterns","obsig","autobot"}
    _ALLOWED_SUBS = {"rsi","macd","stoch","obv","atr","cci","adx","willr","mfi","cmf","roc","imacd","stochrsi","mom","tsi","volosc","trix","ao"}
    _PRO_SUBS = {"kvo","master"}
    _REMOVED = {"bimaco4","b3_60"}

    tier = await get_user_tier(request)
    is_pro = tier in ("pro", "premium")

    allowed_inds = _ALLOWED_INDS | (_PRO_INDS if is_pro else set())
    allowed_subs = _ALLOWED_SUBS | (_PRO_SUBS if is_pro else set())

    sanitized = {}
    if "activeInds" in req:
        sanitized["activeInds"] = [i for i in req["activeInds"] if isinstance(i, str) and i in allowed_inds and i not in _REMOVED][:30]
    if "activeSubs" in req:
        sanitized["activeSubs"] = [s for s in req["activeSubs"] if isinstance(s, str) and s in allowed_subs and s not in _REMOVED][:10]
    _ALLOWED_STRATEGIES = {"golden","dead","ma_support","ma_resist","macd_cross","macd_dead",
        "bb_upper","bb_lower","bb_squeeze","rsi_ob","rsi_os","stoch_cross","stoch_cross_sell",
        "supertrend_buy","supertrend_sell","vol_break","obv_div_buy","obv_div_sell"}
    if "activeStrategies" in req:
        sanitized["activeStrategies"] = [st for st in req["activeStrategies"] if isinstance(st, str) and st in _ALLOWED_STRATEGIES][:20]

    # customMA: [{type, period, color, width}] — 최대 10개
    _MA_TYPES = {"EMA","SMA","WMA","TEMA","HMA","DEMA","VWMA"}
    _COLOR_RE = __import__("re").compile(r'^#[0-9a-fA-F]{3,8}$')
    if "customMA" in req and isinstance(req["customMA"], list):
        sanitized["customMA"] = [
            {"type": m["type"], "period": int(m["period"]), "color": m.get("color","#D8B66A"), "width": min(max(int(m.get("width",1)),1),5)}
            for m in req["customMA"][:10]
            if isinstance(m, dict) and m.get("type") in _MA_TYPES
            and isinstance(m.get("period"), (int,float)) and 1 <= int(m["period"]) <= 500
            and (not m.get("color") or _COLOR_RE.match(str(m.get("color",""))))
        ]

    # customSUB: [{type, ...params}] — 최대 6개
    _SUB_TYPES = {"RSI","MACD","STOCH","ATR","CCI","ADX","OBV","MFI","CMF","ROC","IMACD","WILLR"}
    if "customSUB" in req and isinstance(req["customSUB"], list):
        sanitized["customSUB"] = [
            {k: v for k, v in s.items() if isinstance(k, str) and len(k) < 20}
            for s in req["customSUB"][:6]
            if isinstance(s, dict) and s.get("type") in _SUB_TYPES
        ]

    # indSettings: {ind_id: {param: value}} — 허용 지표만
    _ALL_IND_IDS = allowed_inds | allowed_subs | _ALLOWED_SUBS
    if "indSettings" in req and isinstance(req["indSettings"], dict):
        sanitized["indSettings"] = {
            k: {pk: pv for pk, pv in v.items() if isinstance(pk, str) and len(pk) < 20}
            for k, v in req["indSettings"].items()
            if isinstance(k, str) and isinstance(v, dict) and k in _ALL_IND_IDS
        }

    # symbol/timeframe/obStyle — 허용값
    _TIMEFRAMES = {"1m","3m","5m","15m","30m","1h","2h","4h","1d","1w","1M"}
    _OB_STYLES = {"default","minimal","full"}
    if "symbol" in req and isinstance(req["symbol"], str) and len(req["symbol"]) <= 20:
        sanitized["symbol"] = req["symbol"]
    if "timeframe" in req and req["timeframe"] in _TIMEFRAMES:
        sanitized["timeframe"] = req["timeframe"]
    if "obStyle" in req and req["obStyle"] in _OB_STYLES:
        sanitized["obStyle"] = req["obStyle"]

    # 즐겨찾기
    if "favSymbols" in req and isinstance(req["favSymbols"], list):
        sanitized["favSymbols"] = [s for s in req["favSymbols"] if isinstance(s, str) and len(s) <= 20][:50]
    if "favInds" in req and isinstance(req["favInds"], list):
        sanitized["favInds"] = [s for s in req["favInds"] if isinstance(s, str) and len(s) <= 30][:30]

    result = await db.execute(select(UserChartSettings).where(UserChartSettings.user_id == user_id))
    s = result.scalar()
    if s:
        s.settings_json = sanitized
    else:
        db.add(UserChartSettings(user_id=user_id, settings_json=sanitized))
    await db.commit()
    return ApiResponse(data={"saved": True})

# ═══ 문의/CS ═══
@router.post("/support", response_model=ApiResponse)
async def create_ticket(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """문의 등록 (비로그인도 가능, 로그인 시 user_id 자동 연결)."""
    from src.models.tables import SupportTicket
    subject = (req.get("subject") or "").strip()
    message = (req.get("message") or "").strip()
    email = (req.get("email") or "").strip()
    if not subject or not message:
        from fastapi import HTTPException; raise HTTPException(400, "제목과 내용을 입력해주세요")
    ticket = SupportTicket(email=email, subject=subject, message=message,
                           category=req.get("category", "general"))
    # 로그인 사용자 자동 연결
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        try:
            from src.services.auth import decode_token
            payload = decode_token(auth[7:])
            if payload.get("sub"):
                import uuid as _uuid
                ticket.user_id = _uuid.UUID(payload["sub"])
                if not email:
                    from sqlalchemy import select
                    from src.models.tables import User
                    u = (await db.execute(select(User).where(User.id == ticket.user_id))).scalar()
                    if u: ticket.email = u.email
        except Exception as _e:
            logger.debug("api.site.silent_except", error=str(_e)[:100])
    db.add(ticket)
    await db.commit()
    return ApiResponse(data={"id": str(ticket.id), "status": "open"})

@router.get("/support/tickets", response_model=ApiResponse)
async def list_tickets(request: Request, status_filter: str = "", q: str = "", page: int = 1,
                       db: AsyncSession = Depends(get_db)):
    """문의 목록 (관리자) — 검색/필터/페이지네이션."""
    from src.models.tables import SupportTicket
    await _check_admin(request=request)
    from sqlalchemy import select, func, or_, desc
    base = select(SupportTicket)
    if status_filter:
        base = base.where(SupportTicket.status == status_filter)
    if q:
        base = base.where(or_(SupportTicket.subject.ilike(f"%{q}%"), SupportTicket.email.ilike(f"%{q}%"),
                               SupportTicket.message.ilike(f"%{q}%")))
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    per_page = 30
    rows = (await db.execute(base.order_by(desc(SupportTicket.created_at)).offset((page-1)*per_page).limit(per_page))).scalars().all()
    # 상태별 집계
    status_counts = {}
    for row in (await db.execute(select(SupportTicket.status, func.count(SupportTicket.id)).group_by(SupportTicket.status))).all():
        status_counts[row[0]] = row[1]
    return ApiResponse(data={
        "total": total, "page": page, "per_page": per_page, "status_counts": status_counts,
        "tickets": [{
            "id": str(t.id), "email": t.email, "subject": t.subject, "status": t.status,
            "category": getattr(t, 'category', 'general'), "priority": getattr(t, 'priority', 0),
            "user_id": str(t.user_id) if t.user_id else None,
            "message": t.message[:200], "admin_memo": t.admin_memo,
            "created_at": str(t.created_at), "updated_at": str(t.updated_at)
        } for t in rows]
    })

@router.get("/support/tickets/{ticket_id}", response_model=ApiResponse)
async def get_ticket_detail(ticket_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """문의 상세 (관리자) — 사용자 정보 + 처리 이력 포함."""
    from src.models.tables import SupportTicket, TicketLog, User
    await _check_admin(request=request)
    from sqlalchemy import select, desc
    t = (await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))).scalar()
    if not t: raise HTTPException(404, "Not found")
    # 처리 이력
    logs = (await db.execute(select(TicketLog).where(TicketLog.ticket_id == t.id).order_by(desc(TicketLog.created_at)))).scalars().all()
    # 사용자 정보
    user_info = None
    if t.user_id:
        u = (await db.execute(select(User).where(User.id == t.user_id))).scalar()
        if u:
            user_info = {"id": str(u.id), "email": u.email, "nickname": u.nickname, "tier": u.tier,
                         "referral_exchange": u.referral_exchange, "is_active": u.is_active,
                         "email_verified_at": str(u.email_verified_at) if u.email_verified_at else None}
    return ApiResponse(data={
        "id": str(t.id), "email": t.email, "subject": t.subject, "message": t.message,
        "status": t.status, "category": getattr(t, 'category', 'general'),
        "admin_memo": t.admin_memo, "user_id": str(t.user_id) if t.user_id else None,
        "created_at": str(t.created_at), "updated_at": str(t.updated_at),
        "user": user_info,
        "logs": [{"action": l.action, "old_status": l.old_status, "new_status": l.new_status,
                  "memo": l.memo, "admin_id": l.admin_id, "created_at": str(l.created_at)} for l in logs]
    })

@router.put("/support/tickets/{ticket_id}", response_model=ApiResponse)
async def update_ticket(ticket_id: str, req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """문의 상태 변경/메모 (관리자)."""
    from src.models.tables import SupportTicket, TicketLog
    await _check_admin(request=request)
    t = (await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))).scalar()
    if not t: raise HTTPException(404, "Not found")
    old_status = t.status
    if "status" in req and req["status"] in ("open","in_progress","waiting_user","resolved","closed","spam"):
        t.status = req["status"]
    if "admin_memo" in req: t.admin_memo = req["admin_memo"]
    if "priority" in req: t.priority = req["priority"]
    # 처리 이력 기록
    db.add(TicketLog(ticket_id=t.id, action="update", old_status=old_status, new_status=t.status,
                     memo=req.get("log_memo", ""), admin_id="admin_key"))
    await db.commit()
    return ApiResponse(data={"id": str(t.id), "status": t.status})
