"""SQLAlchemy 모델."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, SmallInteger, BigInteger, Numeric, Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

def utcnow():
    return datetime.now(timezone.utc)

# ── Users ──
class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    nickname: Mapped[str] = mapped_column(String(80), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)        # M / F / U
    birthday: Mapped[str | None] = mapped_column(String(10), nullable=True)      # MM-DD (네이버 제공 형식)
    birth_year: Mapped[str | None] = mapped_column(String(4), nullable=True)     # YYYY
    referral_code: Mapped[str | None] = mapped_column(String(50))
    role: Mapped[str] = mapped_column(String(30), default="user")
    tier: Mapped[str] = mapped_column(String(10), default="free")  # free / pro / premium
    bitmart_cid: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    beom_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    referral_verified_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    referral_exchange: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    email_token: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reset_token: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reset_token_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    points: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    refresh_token_hash: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

# ── Exchanges & Symbols ──
class Exchange(Base):
    __tablename__ = "exchanges"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=True)
    exchange_code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    region: Mapped[str] = mapped_column(String(20))
    asset_support: Mapped[str] = mapped_column(String(100), default="crypto")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

class Symbol(Base):
    __tablename__ = "symbols"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    exchange_id: Mapped[int] = mapped_column(ForeignKey("exchanges.id"))
    asset_class: Mapped[str] = mapped_column(String(20))
    market_type: Mapped[str] = mapped_column(String(20), default="spot")
    symbol_code: Mapped[str] = mapped_column(String(50))
    base_asset: Mapped[str] = mapped_column(String(30))
    quote_asset: Mapped[str] = mapped_column(String(30))
    display_name_ko: Mapped[str | None] = mapped_column(String(120))
    display_name_en: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="active")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    __table_args__ = (UniqueConstraint("exchange_id", "symbol_code"),)

# ── Watchlists ──
class Watchlist(Base):
    __tablename__ = "watchlists"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80), default="관심종목")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    watchlist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("watchlists.id", ondelete="CASCADE"))
    symbol_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("symbols.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (UniqueConstraint("watchlist_id", "symbol_id"),)

# ── Chart Layouts ──
class ChartLayout(Base):
    __tablename__ = "chart_layouts"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    symbol_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("symbols.id"))  # DDL: UUID FK
    name: Mapped[str] = mapped_column(String(120))
    timeframe: Mapped[str] = mapped_column(String(10), default="15m")
    chart_type: Mapped[str] = mapped_column(String(20), default="candles")
    theme: Mapped[str] = mapped_column(String(20), default="dark")
    layout_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)

class ChartDrawing(Base):
    __tablename__ = "chart_drawings"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    layout_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chart_layouts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    symbol_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("symbols.id"))
    drawing_type: Mapped[str] = mapped_column(String(30))
    geometry_json: Mapped[dict] = mapped_column(JSONB)
    style_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

class IndicatorPreset(Base):
    __tablename__ = "indicator_presets"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    layout_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chart_layouts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    indicator_code: Mapped[str] = mapped_column(String(30))
    params_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    pane_index: Mapped[int] = mapped_column(Integer, default=0)

# ── Alerts ──
class AlertRule(Base):
    __tablename__ = "alert_rules"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    symbol_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("symbols.id"))
    timeframe: Mapped[str | None] = mapped_column(String(10))
    rule_type: Mapped[str] = mapped_column(String(40))
    rule_json: Mapped[dict] = mapped_column(JSONB)
    delivery_channel: Mapped[str] = mapped_column(String(20), default="inapp")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

class AlertEvent(Base):
    __tablename__ = "alert_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    alert_rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("alert_rules.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID)
    symbol_id: Mapped[uuid.UUID] = mapped_column(UUID)
    event_status: Mapped[str] = mapped_column(String(20), default="triggered")
    trigger_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    trigger_price: Mapped[float | None] = mapped_column(Numeric(30, 12))
    triggered_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

# ── AI ──
# ── Access Log ──
class AccessLog(Base):
    __tablename__ = "access_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    ip: Mapped[str] = mapped_column(String(45), nullable=False)
    path: Mapped[str] = mapped_column(String(255))
    method: Mapped[str] = mapped_column(String(10))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500))
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    event_type: Mapped[str] = mapped_column(String(30), default="page_view")  # page_view, login_ok, login_fail, locked
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    __table_args__ = (Index("ix_access_logs_ip", "ip"), Index("ix_access_logs_created", "created_at"),)

# ── Notice ──
class Notice(Base):
    __tablename__ = "notices"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(20), default="notice")  # notice/popup/banner/whats_new/onboarding
    status: Mapped[str] = mapped_column(String(20), default="published")  # draft/published/archived
    priority: Mapped[int] = mapped_column(Integer, default=0)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    placement: Mapped[str] = mapped_column(String(30), default="home")  # home/top/chart/support
    target_user: Mapped[str] = mapped_column(String(20), default="all")  # all/guest/member/pro/premium
    dismiss_policy: Mapped[str] = mapped_column(String(20), default="close")  # close/session/1day/7days/forever
    start_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    locale: Mapped[str] = mapped_column(String(5), default="ko")
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    click_count: Mapped[int] = mapped_column(Integer, default=0)
    cta_text: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cta_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)

class FAQ(Base):
    __tablename__ = "faqs"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    question: Mapped[str] = mapped_column(String(300), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="general")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    locale: Mapped[str] = mapped_column(String(5), default="ko")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

# ── Site Settings ──
class SiteSetting(Base):
    __tablename__ = "site_settings"
    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")

# ── User Chart Settings ──
class UserChartSettings(Base):
    __tablename__ = "user_chart_settings"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    settings_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)

# ── AI ──
class AIAnalysis(Base):
    __tablename__ = "ai_analyses"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    symbol_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("symbols.id"))
    timeframe: Mapped[str] = mapped_column(String(10))
    input_snapshot: Mapped[dict] = mapped_column(JSONB)
    result_json: Mapped[dict | None] = mapped_column(JSONB)
    model_name: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

# ── Demo Trades ──
class DemoTrade(Base):
    __tablename__ = "demo_trades"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    symbol: Mapped[str] = mapped_column(String(30))
    side: Mapped[str] = mapped_column(String(10))
    entry_price: Mapped[float] = mapped_column(Numeric(20, 8))
    exit_price: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    size: Mapped[float] = mapped_column(Numeric(20, 8))
    pnl: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    pnl_pct: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")
    opened_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

# ── Support Tickets ──
class SupportTicket(Base):
    __tablename__ = "support_tickets"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(30), default="general")
    status: Mapped[str] = mapped_column(String(20), default="open")
    priority: Mapped[int] = mapped_column(Integer, default=0)
    admin_memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)

class TicketLog(Base):
    __tablename__ = "ticket_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    old_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    new_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

# ── Admin Audit Log ──
class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    admin_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID, nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)


# ── Verification Request (거래소 인증 요청) ──
class VerificationRequest(Base):
    __tablename__ = "verification_requests"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    exchange: Mapped[str] = mapped_column(String(20), nullable=False)  # bitmart / bitget
    submitted_value: Mapped[str] = mapped_column(String(100), nullable=False)  # CID or UID
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/approved/rejected
    reviewed_by: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
