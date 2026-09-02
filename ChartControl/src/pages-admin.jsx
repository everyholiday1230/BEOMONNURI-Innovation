/* ============================================================
   Admin Pages
   ------------------------------------------------------------
   - AdminDashboardPage    /admin
   - AdminUsersPage        /admin/users
   - AdminTradesPage       /admin/trades
   - AdminAIOpsPage        /admin/ai-ops
   - AdminDesignOpsPage    /admin/design-ops
   - AdminRiskPage         /admin/risk        (scaffolded)
   - AdminAssetsPage       /admin/assets      (scaffolded)
   - AdminFeesPage         /admin/fees        (scaffolded + hifi tier table)
   - AdminNoticesPage      /admin/notices     (scaffolded + hifi list)
   - AdminSystemPage       /admin/system      (hifi)
   - AdminAuditPage        /admin/audit       (hifi)
   ============================================================ */

(function () {
  const { useState, useEffect } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const _useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);

  /*
     서버가 돌려주는 고정 문구(note)를 사람이 읽는 말로 바꾼다.

     ★ 왜 매핑인가 — note 는 API 응답 필드에 담긴 **영어 상수**다. 그대로 붙이면
       번역된 문장 옆에 영어가 남는다(중국어·일본어 화면에서 실측됨). 아는 문구는
       사전으로 바꾸고, 모르는 문구는 그대로 보여준다 — 서버가 문구를 바꿨을 때
       정보를 잃는 것보다 영어로라도 보이는 편이 낫다.
  */
  const SERVER_NOTE_KEYS = {
    'read-only; no admin order submission, modification or cancellation': 'adm_note_trades_readonly',
    'read-only; no close, leverage or margin-mode change': 'adm_note_risk_readonly',
    'read-only; prompt/response text is never returned': 'adm_note_aiops_readonly',
  };
  const serverNote = (note) => {
    const s = String(note || '').trim();
    if (!s) return '';
    const key = SERVER_NOTE_KEYS[s];
    return key ? t(key) : s;
  };
  const I = window.Icons;
  const { fmt, fmtCompact } = window.QTFmt;

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  // ============================================================
  // ADMIN DASHBOARD
  // ============================================================
  window.AdminDashboardPage = function AdminDashboardPage({ shellProps }) {
    const adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };
    const users = window.QTApp.ADMIN_USERS;
    const system = window.QTApp.ADMIN_SYSTEM;
    const ai = window.QTApp.ADMIN_AI_METRICS;
    /*
       ★★ 실시간 거래 · 위험 대기열의 목업.

         `ADMIN_LIVE_TRADES`(usr_kuri001 0.185BTC@68,432.5) 와
         `ADMIN_RISK_QUEUE`(usr_00011 suspicious · marginRatio 0.94 critical) 는
         실데이터가 없을 때 그대로 표시됐다. 관리자 홈은 "지금 무슨 일이
         일어나는지" 를 보는 화면이다. 없는 거래와 없는 위험 경보가 보이면
         운영자는 있는 문제를 놓치고 없는 문제를 쫓는다.

       ★ 실서비스에서는 빈 목록을 준다(아래 표가 "없음" 을 보여준다).
         디자인 미리보기에서만 목업을 채운다.
    */
    const dashMock = window.QTMockPolicy && window.QTMockPolicy.allowMockData
      ? window.QTMockPolicy.allowMockData()
      : false;
    const trades = dashMock ? window.QTApp.ADMIN_LIVE_TRADES : [];
    const risk = dashMock ? window.QTApp.ADMIN_RISK_QUEUE : [];

    /*
       관리자 홈 (실데이터).

       ★ 목업이었던 것들:
           '$142,820 수수료 매출 · +12.4%'  — 우리는 수수료를 받지 않는다
           '99.984% 가동률'                  — 측정하지 않는다
           '24h 거래량 = 목업합계 × 24'      — 24를 곱한 추정치였다
           'Auto-review active'              — 자동 심사 기능이 없다
           'AI 신호 486건 · 승인율 62%'      — 집계하지 않는다
           'Last refresh · just now'         — 실제 시각과 무관한 고정 문구

       이 화면은 운영자가 가장 먼저 보는 곳이다. 여기 숫자가 거짓이면
       나머지를 확인할 이유가 없어진다.
    */
    const [sec, setSec] = useState(null);
    const [tickets, setTickets] = useState(null);
    const [orders, setOrders] = useState(null);

    useEffect(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api) return undefined;
      let cancelled = false;
      const guard = (fn) => (fn ? fn().catch(() => null) : Promise.resolve(null));
      Promise.all([
        guard(api.securitySummary),
        guard(api.tickets ? () => api.tickets({ limit: 1 }) : null),
        guard(api.orders ? () => api.orders({ limit: 100 }) : null),
      ]).then(([s, tk, od]) => {
        if (cancelled) return;
        if (s) setSec(s.data || null);
        if (tk) setTickets(tk);
        if (od) setOrders(od);
      });
      return () => { cancelled = true; };
    }, [adm.version]);

    /*
       ★★ 실서비스 여부는 '백엔드가 응답했는가'(adm.isLive = status READY) 로만 판정한다.

       전에는 여기에 Boolean(sec || tickets || orders) 를 AND 로 걸었다. 그러면
       갓 런칭해 주문·문의·보안이벤트가 하나도 없을 때 — 즉 정상적인 신규 상태 —
       실서비스인데도 화면에 'MOCK' 배지가 떴다. 운영자는 이걸 "아직 목업이다"
       로 오해한다(실제로 그 문의가 들어왔다). 활동이 없는 것과 목업인 것은 다르다.

       활동이 없으면 아래 각 표는 실데이터(빈 배열)를 받아 "아직 없음" 빈 상태를
       보여준다 — 가짜 행을 만들지 않는다(dashMock 은 백엔드가 있으면 false).
    */
    const isLive = adm.isLive;
    // 목업 KPI 는 디자인 미리보기에서만. 실서비스에서는 숫자를 만들지 않는다.
    const mockAllowedDash = window.QTMockPolicy && window.QTMockPolicy.allowMockData
      ? window.QTMockPolicy.allowMockData()
      : false;
    const health = window.QTAdmin ? window.QTAdmin.getHealth() : null;
    const switches = window.QTAdmin ? window.QTAdmin.getKillSwitches() : null;

    const active = users.filter(u => u.status === 'active').length;
    const suspended = users.filter(u => u.status === 'suspended').length;
    const pending = users.filter(u => u.status === 'pending').length;
    const totalVol24h = trades.reduce((a,t) => a + t.notional, 0);
    const flaggedTrades = trades.filter(t => t.tag === 'suspicious' || t.tag === 'flagged').length;
    const criticalRisk = risk.filter(r => r.severity === 'critical' || r.severity === 'high').length;

    // 실 주문에서 명목가치 합계. 가격·수량이 없는 주문은 제외한다(0 으로 세지 않는다).
    const liveNotional = (() => {
      if (!orders || !Array.isArray(orders.data)) return null;
      const withBoth = orders.data.filter((o) => Number.isFinite(Number(o.price)) && Number.isFinite(Number(o.quantity)));
      if (!withBoth.length) return { sum: 0, counted: 0, total: orders.data.length };
      return {
        sum: withBoth.reduce((a, o) => a + Number(o.price) * Number(o.quantity), 0),
        counted: withBoth.length,
        total: orders.data.length,
      };
    })();

    const okCount = health
      ? Object.keys(health).filter((k) => /^(ok|Connected|Configured|Enabled)/i.test(String(health[k]))).length
      : null;
    const checkedCount = health
      ? Object.keys(health).filter((k) => !/^(latency|cpu|memory|node|build|git|uptime|wsC|wsCandle|marketDataSource|aiProvider|tradingMode)/i.test(k)).length
      : null;

    const badge = <span style={{padding:'2px 8px', background:'oklch(80% 0.14 75 / 0.14)', color:'var(--color-warning)', border:'1px solid var(--color-warning)', borderRadius:3, fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'0.06em'}}>ADMIN</span>;

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_dashboard_title')}
        subtitle={t('admin_dashboard_0ccafd')}
        breadcrumb={['Home','Admin']}
        badge={badge}
        actions={
          <>
            {/* 실제 갱신 시각. 'just now' 는 언제 봐도 방금이라 쓸모가 없다. */}
            <span style={{fontSize:11, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
              {isLive && window.QTAdmin && window.QTAdmin.getAsOf()
                ? t('admin_last_refresh', { time: new Date(window.QTAdmin.getAsOf()).toLocaleTimeString() })
                : 'Last refresh · just now'}
            </span>
            <button className="btn btn--sm" onClick={() => { if (window.QTAdmin) window.QTAdmin.refresh(); }}><I.Refresh size={13}/> {t('refresh')}</button>
          </>
        }
      >
        {/* Top KPI grid */}
        <div className="grid-4">
          {isLive ? (
            <>
              <window.KPICard
                label={t('adm_users')}
                value={sec && sec.users ? sec.users.total : (window.QTAdmin ? window.QTAdmin.getUserTotal() : '—')}
                sub={sec && sec.users ? t('adm_users_sub', { active: sec.users.active, disabled: sec.users.disabled, admins: sec.users.adminRoles }) : undefined}
                icon="User" tone="brand"
              />
              {/*
                 주문 금액. '24h Volume' 이 아니다 — 24시간 창으로 집계하지 않고,
                 조회한 최근 주문의 합계다. 라벨이 범위를 정확히 말해야 한다.
              */}
              <window.KPICard
                label={t('adm_notional')}
                value={liveNotional === null ? '—' : '$' + fmtCompact(liveNotional.sum)}
                sub={liveNotional ? t('adm_notional_sub', { n: liveNotional.counted, total: liveNotional.total }) : undefined}
                icon="Chart" tone="long"
              />
              {/* 활성 세션 — 실제로 아는 값. */}
              <window.KPICard
                label={t('adm_sessions')}
                value={sec && sec.sessions ? sec.sessions.active : '—'}
                sub={sec && sec.sessions ? t('adm_sessions_sub', { n: sec.sessions.distinctUsers }) : undefined}
                icon="Wifi" tone="brand"
              />
              {/* 킬스위치 — 위험 대응 상태. '자동 심사' 같은 없는 기능을 말하지 않는다. */}
              <window.KPICard
                label={t('admin_risk_killswitch')}
                value={Array.isArray(switches) ? switches.filter(k => k.enabled || k.active || k.engaged).length : '—'}
                sub={Array.isArray(switches) ? t('admin_risk_killswitch_sub', { total: switches.length }) : undefined}
                icon="Alert"
                tone={Array.isArray(switches) && switches.some(k => k.enabled || k.active || k.engaged) ? 'danger' : 'success'}
              />
            </>
          ) : (
            <>
              <window.KPICard label="Total Users"   value={users.length.toLocaleString()} sub={`${active} active · ${pending} pending · ${suspended} suspended`} icon="User" tone="brand"/>
              <window.KPICard label="24h Volume"    value={'$' + fmtCompact(totalVol24h * 24)} delta={+8.4} deltaLabel="vs yesterday" icon="Chart" tone="long"/>
              <window.KPICard label="Flagged Trades" value={flaggedTrades} sub={`${trades.length} tracked · Auto-review active`} icon="Alert" tone={flaggedTrades > 0 ? 'warning' : 'success'}/>
              <window.KPICard label="Critical Risk" value={criticalRisk} sub={`${risk.length} positions in queue`} icon="Alert" tone={criticalRisk > 0 ? 'danger' : 'success'}/>
            </>
          )}
        </div>

        {/* Second row */}
        <div className="grid-4">
          {isLive ? (
            <>
              {/* MFA 채택률 — 보안 상태로 실제 의미가 있다. */}
              <window.KPICard
                label={t('adm_mfa')}
                value={sec && sec.mfa && sec.mfa.adoptionPct !== null ? sec.mfa.adoptionPct + '%' : '—'}
                sub={sec && sec.mfa ? t('adm_mfa_sub', { n: sec.mfa.usersFlagged }) : undefined}
                icon="Lock"
                tone={sec && sec.mfa && sec.mfa.usersFlagged > 0 ? 'success' : 'warning'}
              />
              <window.KPICard
                label={t('adm_health')}
                value={okCount === null ? '—' : `${okCount}/${checkedCount} OK`}
                sub={health ? t('adm_health_sub', { src: health.marketDataSource || '—' }) : undefined}
                icon="Wifi"
                tone={okCount !== null && checkedCount !== null && okCount >= checkedCount ? 'success' : 'warning'}
              />
              {/* 실제 티켓 건수. */}
              <window.KPICard
                label={t('adm_tickets')}
                value={tickets && tickets.counts ? (tickets.counts.open + tickets.counts.pending) : '—'}
                sub={tickets && tickets.counts ? t('adm_tickets_sub', { open: tickets.counts.open, pending: tickets.counts.pending, resolved: tickets.counts.resolved }) : undefined}
                icon="Bell" tone="brand"
              />
              {/*
                 수수료 매출.

                 우리는 거래 수수료를 받지 않는다 — 거래소가 받는다.
                 '$142,820' 은 존재하지 않는 매출이었다. 실제 수익원은 브로커
                 리베이트와 추천 가입이며, 리베이트는 아직 설정되지 않았다.
              */}
              <window.KPICard
                label={t('adm_revenue')}
                value={t('admin_fees_zero')}
                sub={t('adm_revenue_sub')}
                icon="Wallet"
              />
            </>
          ) : mockAllowedDash ? (
            /*
               ★★ 이 네 칸은 목업이다.

                 `AI Signals 486` · `System Health n/n OK` · `Open CS Tickets` ·
                 **`Fee Revenue · 30d $142,820 (+12.4%)`** — 마지막이 특히 나쁘다.
                 수수료 수익은 사업 판단의 근거인데, 우리는 아직 브로커 리베이트
                 조건이 확정되지 않아 실제 수익이 0이다. 조회에 실패한 화면에서
                 $142,820 을 보면 사업이 되고 있다고 오해한다.

               ★ 디자인 미리보기에서만 렌더한다. 실서비스에서는 아래 안내로
                 대체한다 — 숫자를 만들지 않는다.
            */
            <>
              <window.KPICard label="AI Signals · Today" value={ai.signalsToday.toLocaleString()} sub={`Approve ${(ai.approveRate*100).toFixed(0)}% · Hit 7d ${(ai.hitRate7d*100).toFixed(0)}%`} icon="Sparkles" tone="ai"/>
              <window.KPICard label={t('admin_system_title')} value={system.filter(s => s.status === 'ok').length + '/' + system.length + ' OK'} sub={system.find(s => s.status !== 'ok')?.name || 'All systems nominal'} icon="Wifi" tone={system.some(s => s.status !== 'ok') ? 'warning' : 'success'}/>
              <window.KPICard label="Open CS Tickets" value={window.QTApp.CS_TICKETS.filter(c => c.status !== 'resolved').length} sub={`${window.QTApp.CS_TICKETS.filter(c => c.priority === 'high').length} high priority`} icon="Bell" tone="brand"/>
              <window.KPICard label="Fee Revenue · 30d" value="$142,820" delta={+12.4} deltaLabel="vs prev 30d" icon="Wallet" tone="brand"/>
            </>
          ) : (
            <div
              style={{
                gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                padding:'12px 14px', border:'1px solid var(--color-warning)', borderRadius:6,
                background:'color-mix(in srgb, var(--color-warning) 10%, transparent)',
              }}
            >
              <span style={{fontSize:12, color:'var(--color-warning)'}}>{t('adm_overview_unavailable')}</span>
              {adm.refresh && <button className="btn btn--xs" type="button" onClick={() => adm.refresh()}>{t('sec_retry')}</button>}
            </div>
          )}
        </div>

        {/* Live streams */}
        <div className="grid-2-1">
          {/*
             실시간 거래 · 위험 대기열.

             둘 다 목업 배열이었다. 실데이터로 바꾸면 대개 비어 있다 —
             비수탁이라 우리를 통해 나간 주문만 보이기 때문이다.
             빈 표에는 이유를 함께 적는다(설명 없는 빈 표는 조회 장애로 읽힌다).
             자세한 화면은 /admin/trades · /admin/risk 에 있으므로 여기서는
             요약만 보여주고 그쪽으로 보낸다.
          */}
          <window.SectionCard
            title={isLive ? t('adm_recent_orders') : '🔴 Live Trades'}
            subtitle={isLive
              ? t('adm_recent_orders_sub', { n: (orders && orders.data ? orders.data.length : 0) })
              : `${trades.length} events in last minute · click row to inspect`}
            /*
               ★★ <button> 이라서 눌러도 아무 일이 없었다. 같은 화면의 다른
                 'View all' 은 <a href="#/admin/risk"> 로 되어 있다 — 한쪽만
                 링크가 되어 있어 같은 라벨이 다르게 동작했다.

               ★ 최근 주문의 전체 목록은 /admin/trades 다.
            */
            actions={<a className="btn btn--sm" href="#/admin/trades">{t('adm_view_all')}</a>}
            noPadding
          >
            <window.DataTable
              columns={[
                { key: 'time', label: t('adm_col_time'), width: 60, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{Math.floor((Date.now()-r.time)/1000)}s</span> },
                { key: 'user', label: t('adm_col_user'), render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.userId}</span> },
                { key: 'sym',  label: t('adm_col_symbol'), render: r => <strong>{r.sym}</strong> },
                { key: 'side', label: t('adm_col_side'), render: r => <span className={r.side==='long'?'t-long':'t-short'}>{r.side==='long'?'▲':'▼'}</span>},
                { key: 'size', label: t('adm_col_size'), align:'right', render: r => fmt(r.size, 3) },
                { key: 'price',label: t('adm_col_price'), align:'right', render: r => fmt(r.price, 1) },
                { key: 'not',  label: t('adm_col_notional'), align:'right', render: r => '$' + fmtCompact(r.notional) },
                { key: 'tag',  label: t('adm_col_flag'), render: r => {
                  if (r.tag === 'ok') return <span style={{color:'var(--color-text-tertiary)', fontSize:11}}>·</span>;
                  const cls = { large: 'warn', suspicious: 'danger', flagged: 'danger', vip: 'ok' }[r.tag] || 'neutral';
                  return <span className={`status-pill status-pill--${cls}`}>{r.tag.toUpperCase()}</span>;
                }},
              ]}
              rows={isLive
                ? (orders && Array.isArray(orders.data)
                    ? orders.data.slice(0, 10).map((o) => {
                        const price = Number(o.price);
                        const size = Number(o.quantity);
                        return {
                          time: Number(o.createdAt || o.ts) || undefined,
                          userId: o.userId || '—',
                          sym: o.symbol ? String(o.symbol).replace(/USDT$/, '/USDT') : '—',
                          side: o.side ? String(o.side).toLowerCase() : '—',
                          size: Number.isFinite(size) ? size : undefined,
                          price: Number.isFinite(price) ? price : undefined,
                          notional: Number.isFinite(price) && Number.isFinite(size) ? price * size : undefined,
                          tag: o.status ? String(o.status).toLowerCase() : 'ok',
                        };
                      })
                    : [])
                : trades.slice(0, 10)}
              onRowClick={(r) => alert('Trade inspector: ' + r.userId + ' · ' + r.sym)}
            />
          </window.SectionCard>

          <window.SectionCard
            title={isLive ? t('adm_risk_summary') : '⚠ Risk Queue'}
            subtitle={isLive ? t('adm_risk_summary_sub') : `${risk.length} positions require attention`}
            actions={<a className="btn btn--sm" href="#/admin/risk">{t('adm_view_all')}</a>}
          >
            {/*
               실데이터에서는 위험 요약을 보여준다.

               포지션 위험 계산은 /admin/risk 가 이미 한다. 여기서 같은 계산을
               다시 구현하면 두 화면의 기준이 갈라진다 — 한쪽은 5%, 다른 쪽은
               3% 로 위험을 판정하는 상태가 된다.
            */}
            {isLive ? (
              <div style={{display:'flex', flexDirection:'column', gap:10, fontSize:12.5, lineHeight:1.8}}>
                <div style={{color:'var(--color-text-secondary)'}}>{t('adm_risk_scope')}</div>
                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  <a className="btn btn--sm" href="#/admin/risk" style={{textDecoration:'none'}}>{t('adm_open_risk')}</a>
                  <a className="btn btn--sm" href="#/admin/trades" style={{textDecoration:'none'}}>{t('adm_open_trades')}</a>
                </div>
                {Array.isArray(switches) && switches.some(k => k.enabled || k.active || k.engaged) && (
                  <div style={{
                    padding:'9px 11px', borderRadius:6, fontSize:11.5,
                    background:'color-mix(in srgb, var(--color-danger) 10%, transparent)',
                    border:'1px solid var(--color-danger)', color:'var(--color-danger)',
                  }}>
                    {t('adm_killswitch_on', { n: switches.filter(k => k.enabled || k.active || k.engaged).length })}
                  </div>
                )}
                {/*
                   ★★ 조작 링크. 예전에는 "몇 개 켜져 있음" 만 보여주고 **끄고 켤 방법이
                     없었다.** 부팅 로그는 "관리자 콘솔에서 끄십시오" 라고 안내하는데
                     갈 곳이 없었고, 이제 이 스위치들이 실주문을 실제로 막으므로
                     비상정지를 비상시에 풀 수 없는 상태였다.
                */}
                <a className="btn btn--sm" href="#/admin/system" style={{textDecoration:'none', alignSelf:'flex-start'}}>
                  {t('ks_title')}
                </a>
              </div>
            ) : (
            <div style={{display:'flex', flexDirection:'column', gap: 6}}>
              {risk.map(r => (
                <div key={r.id} style={{padding:'10px 12px', background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)', borderLeft: `3px solid ${r.severity === 'critical' ? 'var(--color-danger)' : r.severity === 'high' ? 'var(--color-danger)' : r.severity === 'medium' ? 'var(--color-warning)' : 'var(--color-border-default)'}`, borderRadius:4, fontSize:12}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:6}}>
                    <div>
                      <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
                        <span className={`severity-pill severity-pill--${r.severity}`}>{r.severity.toUpperCase()}</span>
                        <strong>{r.sym}</strong>
                        <span className={r.side==='long'?'t-long':'t-short'} style={{fontSize:11}}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span>
                      </div>
                      <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                        {r.userId} · MR {(r.marginRatio*100).toFixed(0)}% · Liq dist {r.liqDist}%
                      </div>
                    </div>
                    <button className="btn btn--xs">{t('col_notify')}</button>
                  </div>
                </div>
              ))}
            </div>
            )}
          </window.SectionCard>
        </div>

        {/* System status */}
        {/*
           시스템 상태.

           목업 표는 서비스 9개마다 '지연 2ms · 가동률 99.998%' 를 보여줬다.
           우리는 서비스별 지연도 가동률도 측정하지 않는다 — 전부 만들어낸
           값이었고, 소수점 세 자리까지 있어 더 정밀해 보였다.

           실데이터에서는 /admin/system 과 **같은 출처**를 쓴다. 두 화면이
           다른 값을 보여주면 어느 쪽을 믿어야 하는지 알 수 없다.
        */}
        <window.SectionCard
          title={t('adm_health')}
          subtitle={isLive ? t('admin_system_components_sub') : 'Real-time service status · Click for detail'}
          actions={isLive ? <a className="btn btn--sm" href="#/admin/system" style={{textDecoration:'none'}}>{t('adm_open_system')}</a> : undefined}
          noPadding
        >
          {isLive ? (
            <window.DataTable
              columns={[
                { key:'name', label:t('admin_system_component'), render: r => <strong style={{fontFamily:'var(--font-mono)', fontSize:12}}>{r.name}</strong> },
                { key:'state', label:t('admin_system_state'), render: r => (
                  r.grade === 'info'
                    ? <span style={{color:'var(--color-text-tertiary)', fontSize:11}}>{t('admin_system_info')}</span>
                    : <span className={`status-pill status-pill--${r.grade === 'ok' ? 'ok' : r.grade === 'warn' ? 'warn' : 'neutral'}`}>
                        {r.grade === 'unknown' ? t('admin_system_unmeasured') : r.grade.toUpperCase()}
                      </span>
                ) },
                { key:'value', label:t('admin_system_reported'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11, color: r.grade === 'unknown' ? 'var(--color-text-tertiary)' : undefined}}>{r.value}</span>
                ) },
              ]}
              rows={health ? Object.keys(health).map((k) => {
                const v = String(health[k]);
                const INFO = /^(buildVersion|gitSha|nodeVersion|aiProvider|tradingMode|marketDataSource|uptimeSeconds|memory|wsC|latency|cpu)/i;
                const grade = INFO.test(k) ? 'info'
                  : /^(ok|Connected|Configured|Enabled)/i.test(v) ? 'ok'
                  : /^(Idle|Locked|Mock|Not Implemented)/i.test(v) ? 'warn'
                  : /^(Unavailable|Not Connected|unavailable)/i.test(v) ? 'unknown' : 'info';
                return { name: k, value: v, grade };
              }) : []}
            />
          ) : (
          <window.DataTable
            columns={[
              { key: 'name',   label: 'Service', render: r => <strong>{r.name}</strong> },
              { key: 'status', label: t('adm_col_status'), render: r => <span className={`status-pill status-pill--${r.status === 'ok' ? 'ok' : r.status === 'degraded' ? 'warn' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key: 'latency', label: 'Latency', align:'right', render: r => typeof r.latency === 'number' ? r.latency + 'ms' : r.latency },
              { key: 'uptime',  label: 'Uptime', align:'right', render: r => r.uptime.toFixed(3) + '%' },
              { key: 'note',    label: 'Note', render: r => <span style={{color:'var(--color-text-tertiary)', fontSize:11}}>{r.note || ''}</span> },
            ]}
            rows={system}
          />
          )}
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN REFERRAL — 친구 초대 제도 운영
  // ============================================================
  /**
   * 리퍼럴 운영 화면.
   *
   * 디자이너 화면이 없어 기존 컴포넌트(KPICard·SectionCard·DataTable)로
   * 조립한다. 새 CSS 를 만들지 않는다 — 디자인 시스템 밖의 스타일이 늘면
   * 나중에 테마·밀도 전환에서 어긋난다.
   *
   * ★ 이 화면이 지키는 것
   *   · 적립액을 계산해 보여주지 않는다. 지급액은 운영자가 거래소 어필리에이트
   *     보고서에서 실수령액을 확인한 뒤 산정해 입력한다.
   *   · 지급 기록에 '방법' 을 필수로 받는다. 근거 없는 기록은 검증할 수 없다.
   *   · 제도를 켤 때 지급 방법 설명을 요구한다(서버도 검증한다).
   */
  window.AdminReferralPage = function AdminReferralPage({ shellProps }) {
    const _adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };

    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    // 조건 편집 폼. 서버 값이 오면 채운다.
    const [form, setForm] = useState(null);
    // 지급 입력 폼. 대상이 정해지면 열린다.
    const [payTo, setPayTo] = useState(null);
    const [pay, setPay] = useState({ amount: '', method: '', reference: '', note: '' });

    const api = window.QTApi && window.QTApi.admin;
    const canWrite = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.referral.write'));

    const load = React.useCallback(() => {
      if (!api || !api.referral) return;
      api.referral(200)
        .then((r) => {
          setData(r);
          if (r.settings) {
            setForm({
              enabled: Boolean(r.settings.enabled),
              sharePct: String(r.settings.sharePct ?? 0),
              minPayout: String(r.settings.minPayout ?? 0),
              payoutCurrency: r.settings.payoutCurrency || 'USDT',
              payoutNote: r.settings.payoutNote || '',
            });
          }
          setErr(null);
        })
        .catch((e) => setErr((e && e.message) || 'load failed'));
    }, [api]);
    useEffect(() => { load(); }, [load]);

    const isLive = Boolean(data && data.supported);
    const settings = (data && data.settings) || null;
    const referrers = (data && data.referrers) || [];

    const saveSettings = async () => {
      if (!api || !api.setReferralSettings || !form) return;
      setBusy(true); setMsg(null);
      try {
        const r = await api.setReferralSettings({
          enabled: form.enabled,
          sharePct: Number(form.sharePct),
          minPayout: Number(form.minPayout),
          payoutCurrency: form.payoutCurrency,
          payoutNote: form.payoutNote,
        });
        if (r && r.ok === false) {
          // 서버 검증 메시지를 그대로 보여준다 — 왜 거부됐는지가 중요하다.
          setMsg({ ok: false, text: r.message || t('adm_ref_save_failed') });
        } else {
          setMsg({ ok: true, text: form.enabled ? t('adm_ref_enabled') : t('adm_ref_disabled') });
          load();
        }
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('adm_ref_save_failed') });
      }
      setBusy(false);
    };

    const submitPayout = async () => {
      if (!api || !api.recordReferralPayout || !payTo) return;
      const amount = Number(pay.amount);
      if (!Number.isFinite(amount) || amount <= 0 || !pay.method.trim()) return;
      setBusy(true); setMsg(null);
      try {
        const r = await api.recordReferralPayout({
          referrerUserId: payTo.userId,
          amount,
          currency: settings ? settings.payoutCurrency : 'USDT',
          method: pay.method.trim(),
          reference: pay.reference.trim() || null,
          note: pay.note.trim() || null,
        });
        if (r && r.ok === false) {
          setMsg({ ok: false, text: r.message || t('adm_ref_pay_failed') });
        } else {
          setMsg({ ok: true, text: t('adm_ref_paid', { amount: amount, cur: settings ? settings.payoutCurrency : '' }) });
          setPayTo(null);
          setPay({ amount: '', method: '', reference: '', note: '' });
          load();
        }
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('adm_ref_pay_failed') });
      }
      setBusy(false);
    };

    return (
      <window.PageShell
        {...shellProps}
        title={t('adm_ref_title')}
        subtitle={t('adm_ref_subtitle')}
        breadcrumb={['Home','Admin','Referral']}
        actions={<button aria-label={t('refresh')} className="btn btn--sm" onClick={load} title={t('refresh')}><I.Refresh size={13}/></button>}
      >
        {!isLive ? (
          <window.NotApplicablePanel
            title={t('adm_ref_unavailable')}
            reason={t('adm_ref_unavailable_why')}
            points={[]}
          />
        ) : (
          <>
            {/*
               제도 상태를 가장 먼저 보여준다.

               꺼져 있으면 코드가 발급되지 않고 귀속도 일어나지 않는다.
               그 사실을 운영자가 즉시 알아야 한다 — 모르고 있으면 "왜 초대가
               집계되지 않나" 를 다른 곳에서 찾는다.
            */}
            <div className="grid-4">
              <window.KPICard
                label={t('adm_ref_status')}
                value={settings && settings.enabled ? t('adm_ref_on') : t('adm_ref_off')}
                sub={settings ? t('adm_ref_version', { n: settings.version }) : undefined}
                tone={settings && settings.enabled ? 'success' : 'warning'}
              />
              <window.KPICard
                label={t('adm_ref_referrers')}
                value={referrers.length}
                sub={t('adm_ref_referrers_sub')}
              />
              <window.KPICard
                label={t('adm_ref_signups')}
                value={referrers.reduce((a, x) => a + (Number(x.signups) || 0), 0)}
                sub={t('adm_ref_signups_sub', { n: referrers.reduce((a, x) => a + (Number(x.traded) || 0), 0) })}
              />
              <window.KPICard
                label={t('adm_ref_paid_total')}
                value={fmt(referrers.reduce((a, x) => a + (Number(x.paidTotal) || 0), 0), 2)}
                sub={settings ? settings.payoutCurrency : undefined}
              />
            </div>

            {/*
               ★ 운영자가 알아야 하는 사실.

               적립액을 시스템이 계산하지 않는다. 지급액은 거래소 어필리에이트
               보고서의 실수령액에서 산정해야 한다. 이 문구가 없으면 운영자가
               화면에 있는 숫자를 근거로 지급액을 정한다.
            */}
            <div style={{
              padding:'13px 15px', borderRadius:7, fontSize:12.5, lineHeight:1.85,
              background:'color-mix(in srgb, var(--color-warning) 10%, transparent)',
              border:'1px solid var(--color-warning)',
            }}>
              <div style={{fontWeight:600, marginBottom:5}}>{t('adm_ref_how_title')}</div>
              <ul style={{margin:0, paddingLeft:20}}>
                <li>{t('adm_ref_how_1')}</li>
                <li>{t('adm_ref_how_2')}</li>
                <li>{t('adm_ref_how_3')}</li>
              </ul>
            </div>

            {msg && (
              <div style={{
                padding:'10px 12px', borderRadius:6, fontSize:12,
                background: msg.ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                border: '1px solid ' + (msg.ok ? 'var(--color-success)' : 'var(--color-danger)'),
                color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)',
              }}>{msg.text}</div>
            )}

            {/* 제도 조건 */}
            <window.SectionCard title={t('adm_ref_terms')} subtitle={t('adm_ref_terms_sub')}>
              {form ? (
                <div style={{display:'flex', flexDirection:'column', gap:12, maxWidth:640}}>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      disabled={!canWrite}
                      onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    />
                    <span className="chk__box"><I.Check size={10}/></span>
                    {t('adm_ref_enable')}
                  </label>

                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10}}>
                    <div className="input-group">
                      <span className="input-group__label">{t('adm_ref_share')}</span>
                      <input aria-label={t('adm_ref_share')}
                        type="number" min="0" max="100" step="0.5"
                        value={form.sharePct} disabled={!canWrite}
                        onChange={(e) => setForm({ ...form, sharePct: e.target.value })}
                      />
                    </div>
                    <div className="input-group">
                      <span className="input-group__label">{t('adm_ref_min')}</span>
                      <input aria-label={t('adm_ref_min')}
                        type="number" min="0" step="0.01"
                        value={form.minPayout} disabled={!canWrite}
                        onChange={(e) => setForm({ ...form, minPayout: e.target.value })}
                      />
                    </div>
                    <div className="input-group">
                      <span className="input-group__label">{t('adm_ref_currency')}</span>
                      <input aria-label={t('adm_ref_currency')}
                        value={form.payoutCurrency} disabled={!canWrite} maxLength={10}
                        onChange={(e) => setForm({ ...form, payoutCurrency: e.target.value.toUpperCase() })}
                      />
                    </div>
                  </div>

                  {/*
                     ★★ 이 설정으로 **실제로 보상이 지급되는가**.

                       payoutNote 는 여기서 쓴 글이 고객 화면에 그대로 나간다.
                       그런데 지급 조건은 코드에 있고 운영자는 볼 수 없었다.
                       프로덕션에서 실제로 어긋나 있었다: 문구는 "양쪽 2,000 포인트",
                       코드는 직원(team_leader) 코드일 때 신규 회원만 지급, 그리고
                       team_leader 보유자가 0명이라 아무에게도 지급되지 않았다.

                       지킬 수 없는 약속을 쓰지 않도록 사실을 옆에 붙여 둔다.
                  */}
                  {data && data.rewardReality && (
                    <div style={{
                      padding:'9px 11px', borderRadius:6, fontSize:11.5, lineHeight:1.8,
                      background: data.rewardReality.anyRewardPossible
                        ? 'var(--color-bg-elevated)'
                        : 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
                      border: '1px solid ' + (data.rewardReality.anyRewardPossible
                        ? 'var(--color-border-subtle)' : 'var(--color-danger)'),
                      color: data.rewardReality.anyRewardPossible
                        ? 'var(--color-text-secondary)' : 'var(--color-danger)',
                    }}>
                      <div style={{fontWeight:700, marginBottom:3}}>
                        {data.rewardReality.anyRewardPossible ? t('adm_ref_reality_ok') : t('adm_ref_reality_none')}
                      </div>
                      <div>{t('adm_ref_reality_points', {
                        n: data.rewardReality.pointsPerSignup,
                        on: data.rewardReality.pointsEnabled ? t('adm_ref_reality_on') : t('adm_ref_reality_off'),
                      })}</div>
                      <div>{t('adm_ref_reality_referee_only')}</div>
                      <div>{t('adm_ref_reality_staff', { n: data.rewardReality.staffCodeOwners })}</div>
                      {!data.rewardReality.anyRewardPossible && (
                        <div style={{marginTop:4, fontWeight:600}}>{t('adm_ref_reality_fix')}</div>
                      )}
                    </div>
                  )}

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5}}>
                      {t('adm_ref_note')}
                    </div>
                    <textarea aria-label={t('adm_ref_note_ph')}
                      value={form.payoutNote} disabled={!canWrite} maxLength={1000}
                      placeholder={t('adm_ref_note_ph')}
                      onChange={(e) => setForm({ ...form, payoutNote: e.target.value })}
                      style={{width:'100%', minHeight:80, padding:9, background:'var(--color-bg-input)', border:'1px solid var(--color-border-default)', borderRadius:6, color:'var(--color-text-primary)', fontSize:12.5, fontFamily:'var(--font-sans)', resize:'vertical', outline:'none', lineHeight:1.7}}
                    />
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:4}}>{t('adm_ref_note_why')}</div>
                  </div>

                  <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
                    <button
                      className="btn btn--sm btn--primary"
                      disabled={busy || !canWrite}
                      onClick={saveSettings}
                    >{busy ? '…' : t('adm_ref_save')}</button>
                  </div>
                  {!canWrite && (
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textAlign:'right'}}>{t('admin_read_only_notice')}</div>
                  )}
                </div>
              ) : (
                <div style={{fontSize:12, color:'var(--color-text-tertiary)'}}>{t('help_loading')}</div>
              )}
            </window.SectionCard>

            {/* 초대자 목록 */}
            <window.SectionCard
              title={t('adm_ref_list')}
              subtitle={t('adm_ref_list_sub')}
              noPadding={referrers.length > 0}
            >
              {referrers.length > 0 ? (
                <window.DataTable
                  columns={[
                    { key:'email', label:t('adm_ref_col_user'), render: r => (
                      <span style={{fontFamily:'var(--font-mono)', fontSize:11.5}}>{r.email || r.userId.slice(0, 8)}</span>
                    ) },
                    { key:'code', label:t('adm_ref_col_code'), render: r => (
                      <strong style={{fontFamily:'var(--font-mono)'}}>{r.code || '—'}</strong>
                    ) },
                    { key:'signups', label:t('adm_ref_col_signups'), align:'right', render: r => r.signups },
                    /* 실제 수익이 발생하는 단계. 지급 판단의 근거다. */
                    { key:'keys', label:t('adm_ref_col_keys'), align:'right', render: r => r.keysConnected },
                    { key:'traded', label:t('adm_ref_col_traded'), align:'right', render: r => (
                      <strong style={{color: r.traded > 0 ? 'var(--color-success)' : undefined}}>{r.traded}</strong>
                    ) },
                    { key:'paid', label:t('adm_ref_col_paid'), align:'right', render: r => (
                      r.paidTotal > 0 ? `${fmt(r.paidTotal, 2)} ${r.currency || ''}` : '—'
                    ) },
                    { key:'act', label:'', align:'right', render: r => (
                      canWrite
                        ? <button className="tbl-action" onClick={() => { setPayTo(r); setPay({ amount: '', method: '', reference: '', note: '' }); }}>
                            {t('adm_ref_record')}
                          </button>
                        : <span style={{color:'var(--color-text-tertiary)'}}>—</span>
                    ) },
                  ]}
                  rows={referrers}
                />
              ) : (
                <div style={{fontSize:12, lineHeight:1.8, color:'var(--color-text-tertiary)'}}>
                  {settings && settings.enabled ? t('adm_ref_none_yet') : t('adm_ref_none_off')}
                </div>
              )}
            </window.SectionCard>

            {/* 지급 입력 */}
            {payTo && (
              <window.SectionCard
                title={t('adm_ref_pay_title', { who: payTo.email || payTo.userId.slice(0, 8) })}
                subtitle={t('adm_ref_pay_sub')}
                actions={<button className="btn btn--sm" onClick={() => setPayTo(null)}>{t('close')}</button>}
              >
                <div style={{display:'flex', flexDirection:'column', gap:10, maxWidth:640}}>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:10}}>
                    <div className="input-group">
                      <span className="input-group__label">{t('ref_col_amount')} ({settings ? settings.payoutCurrency : ''})</span>
                      <input aria-label={t('ref_col_amount')}
                        type="number" min="0" step="0.00000001"
                        value={pay.amount}
                        onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                      />
                    </div>
                    <div className="input-group">
                      <span className="input-group__label">{t('ref_col_method')}</span>
                      <input aria-label={t('adm_ref_method_ph')}
                        value={pay.method}
                        placeholder={t('adm_ref_method_ph')}
                        onChange={(e) => setPay({ ...pay, method: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="input-group">
                    <span className="input-group__label">{t('ref_col_reference')}</span>
                    <input aria-label={t('adm_ref_ref_ph')}
                      value={pay.reference}
                      placeholder={t('adm_ref_ref_ph')}
                      onChange={(e) => setPay({ ...pay, reference: e.target.value })}
                    />
                  </div>
                  <div style={{fontSize:11.5, lineHeight:1.7, color:'var(--color-text-tertiary)'}}>
                    {t('adm_ref_pay_warn')}
                  </div>
                  <div style={{display:'flex', justifyContent:'flex-end'}}>
                    <button
                      className="btn btn--sm btn--primary"
                      disabled={busy || !Number(pay.amount) || !pay.method.trim()}
                      onClick={submitPayout}
                    >{busy ? '…' : t('adm_ref_record')}</button>
                  </div>
                </div>
              </window.SectionCard>
            )}

            {err && <div style={{fontSize:11.5, color:'var(--color-danger)'}}>{t('admin_load_failed')} · {err}</div>}
          </>
        )}
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN USERS PAGE
  // ============================================================
  window.AdminUsersPage = function AdminUsersPage({ shellProps }) {
    /*
       관리자 데이터가 도착하면 재렌더한다. 이 훅이 없으면 QTAdmin 이
       ADMIN_USERS 를 바꿔치기해도 React 는 모른다.
    */
    const adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };
    const users = window.QTApp.ADMIN_USERS;
    const [q, setQ] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    /*
       변경 권한.

       서버가 준 실제 권한 목록으로 판단한다. 등급 이름(`role === 'ADMIN'`)으로
       켜면 서버가 권한을 조정한 순간 화면이 따라오지 않아 "버튼은 보이는데
       누르면 403" 이 된다. ops 등급이 정지 권한을 잃은 변경이 실제로 있었다.
    */
    const canChangeStatus = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.user.status.write'));

    const [busyId, setBusyId] = useState(null);
    const [actionMsg, setActionMsg] = useState(null);

    /*
       정지 / 해제.

       사유를 반드시 받는다 — 서버가 요구하고(400), 감사 로그에 남는 값이다.
       "누가 왜 정지시켰는지" 없이 남은 기록은 나중에 쓸모가 없다.
    */
    const changeStatus = async (user, disable) => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api) return;

      // eslint-disable-next-line no-alert
      const reason = window.prompt(disable ? t('admin_suspend_reason') : t('admin_reactivate_reason'), '');
      // 취소하면 아무 일도 하지 않는다. 빈 문자열도 사유가 아니다.
      if (reason === null || !String(reason).trim()) return;

      setBusyId(user.id);
      setActionMsg(null);
      try {
        const r = disable
          ? await api.disableUser(user.id, String(reason).trim())
          : await api.enableUser(user.id, String(reason).trim());
        if (r && r.ok === false) {
          setActionMsg({ ok: false, msg: (r.message) || t('admin_action_failed') });
        } else {
          setActionMsg({
            ok: true,
            msg: disable
              ? t('admin_suspended_ok', { n: (r && r.sessionsRevoked) || 0 })
              : t('admin_reactivated_ok'),
          });
          // 서버 상태를 다시 읽어 화면과 일치시킨다.
          if (window.QTAdmin && window.QTAdmin.refresh) window.QTAdmin.refresh();
        }
      } catch (e) {
        setActionMsg({ ok: false, msg: (e && e.message) || t('admin_action_failed') });
      }
      setBusyId(null);
    };
    const filtered = users
      .filter(u => statusFilter === 'all' || u.status === statusFilter)
      /*
         실 사용자에는 name 이 없을 수 있다(우리 DB 는 이메일만 가진다).
         u.name.toLowerCase() 를 그대로 부르면 화면 전체가 렌더 실패한다.
      */
      .filter(u => {
        if (!q) return true;
        const needle = q.toLowerCase();
        return [u.name, u.email, u.id, u.role]
          .filter(Boolean)
          .some(v => String(v).toLowerCase().includes(needle));
      });

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_users_title')}
        subtitle={t('admin_users_subtitle', { n: users.length })}
        breadcrumb={['Home','Admin','Users']}
        actions={
          <>
            {/*
               ★★ 회원 목록 내보내기 — 개인정보 대량 반출이다.

                 화면에서 한 명씩 보는 것과 성질이 다르다. 파일로 나가면 우리
                 통제 밖으로 복사된다. 서버가 admin.audit.export 권한을 함께
                 요구하고 high 위험도로 감사에 남기며 5,000행으로 제한한다.

               ★ 주소를 그대로 열어 브라우저가 파일로 받게 한다. fetch 로 받아
                 화면에서 파일을 만들면 파일명·인코딩을 다시 구현해야 하고,
                 그 과정에서 개인정보가 메모리에 한 번 더 남는다.

               ★ 권한이 없으면 버튼을 감춘다 — 누르면 403 인 버튼을 두면
                 "왜 안 되지" 를 반복한다.
            */}
            {Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.audit.export')) && (
              <a
                className="btn btn--sm"
                href={window.QTApi && window.QTApi.admin && window.QTApi.admin.userExportUrl
                  ? window.QTApi.admin.userExportUrl({ q: q || undefined, status: statusFilter !== 'all' ? statusFilter : undefined, limit: 5000 })
                  : '#'}
                title={t('adm_export_hint')}
              >
                <I.Camera size={13}/> {t('adm_export_users')}
              </a>
            )}
            {/* 초대 기능은 서버 API 가 없다 — 누를 수 있는 것처럼 두지 않는다. */}
            <button aria-label={t('adm_feature_absent')} className="btn btn--sm" disabled title={t('adm_feature_absent')}>
              <I.Plus size={13}/> {t('adm_invite_user')}
              <span className="qt-pending-mark">{t('sec_pending')}</span>
            </button>
          </>
        }
      >
        {/*
           ★★ 조회 상태 배너.

             전에는 이것이 없었다. 권한이 없거나(403) 세션이 끊겼을 때(401)
             admin-data.js 가 목업 회원 12명으로 되돌렸고, 화면에는 아무 표시가
             없어서 그 목록이 실제 회원처럼 보였다. 운영자는 없는 사람을 상대로
             정지·등급 변경을 누르려 한다.

             이제 목업 복원은 미리보기에서만 일어나고(실서비스는 빈 목록),
             여기서 왜 비었는지 말한다. 빈 목록과 "못 불러옴" 은 다른 사실이다.
        */}
        {adm.status && adm.status !== 'READY' && (
          <div
            role="status"
            style={{
              display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
              padding:'10px 14px', marginBottom:12, borderRadius:6,
              border:'1px solid ' + (adm.status === 'LOADING' ? 'var(--color-border-subtle)' : 'var(--color-warning)'),
              background: adm.status === 'LOADING'
                ? 'var(--color-bg-surface)'
                : 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
            }}
          >
            <span style={{fontSize:12, color: adm.status === 'LOADING' ? 'var(--color-text-tertiary)' : 'var(--color-warning)'}}>
              {t(
                adm.status === 'LOADING' ? 'adm_state_loading'
                  : adm.status === 'FORBIDDEN' ? 'adm_state_forbidden'
                  : adm.status === 'UNAUTHENTICATED' ? 'adm_state_unauth'
                  : adm.status === 'OFFLINE' ? 'adm_state_offline'
                  : 'adm_state_error',
              )}
            </span>
            {/* 서버가 준 사유가 있으면 함께 보여준다 — 문의할 때 근거가 된다. */}
            {adm.error && (
              <span style={{fontSize:11, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                {String(adm.error).slice(0, 120)}
              </span>
            )}
            {adm.refresh && adm.status !== 'LOADING' && (
              <button className="btn btn--xs" type="button" onClick={() => adm.refresh()}>{t('sec_retry')}</button>
            )}
          </div>
        )}

        <div className="grid-4">
          <window.KPICard label={t('adm_kpi_total')}      value={users.length}/>
          <window.KPICard label={t('adm_kpi_active')}     value={users.filter(u => u.status === 'active').length} tone="long"/>
          <window.KPICard label={t('adm_kpi_pending_kyc')} value={users.filter(u => u.status === 'pending').length} tone="warning"/>
          <window.KPICard label={t('adm_kpi_suspended')} value={users.filter(u => u.status === 'suspended' || u.status === 'restricted').length} tone="danger"/>
        </div>

        {actionMsg && (
          <div style={{
            padding:'10px 12px', borderRadius:6, fontSize:12,
            background: actionMsg.ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
                                     : 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
            border: '1px solid ' + (actionMsg.ok ? 'var(--color-success)' : 'var(--color-danger)'),
            color: actionMsg.ok ? 'var(--color-success)' : 'var(--color-danger)',
          }}>{actionMsg.msg}</div>
        )}

        {/*
           열람 전용 안내.

           권한을 아는 상태에서 변경 권한이 없을 때만 보여준다. 로딩 중에 띄우면
           권한이 있는 관리자에게도 잠깐 "열람 전용" 이 보여 혼란스럽다.
        */}
        {window.QTAdmin && window.QTAdmin.permissionsKnown && window.QTAdmin.permissionsKnown() && !canChangeStatus && (
          <div style={{padding:'8px 12px', borderRadius:6, fontSize:11, color:'var(--color-text-tertiary)', border:'1px solid var(--color-border-subtle)'}}>
            {t('admin_read_only_notice')}
          </div>
        )}

        <window.SectionCard
          title={t('admin_users_list_title')}
          actions={
            <>
              <div className="input-group" style={{width: 240, height: 30}}>
                <I.Search size={12}/>
                <input aria-label={t('admin_users_3fefdf')} placeholder={t('admin_users_3fefdf')} value={q} onChange={e => setQ(e.target.value)}/>
              </div>
              <select aria-label={t('a11y_status_filter')} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input" style={{height:28, fontSize:11, width:140}}>
                <option value="all">{t('adm_all_statuses')}</option>
                <option value="active">{t('col_active')}</option>
                <option value="pending">{t('col_pending')}</option>
                <option value="restricted">{t('col_restricted')}</option>
                <option value="suspended">{t('col_suspended')}</option>
              </select>
            </>
          }
          noPadding
        >
          <window.DataTable
            columns={[
              /*
                 ★ ID 를 눌러서 복사할 수 있게 한다. 포인트 수동 지급·회수 화면이
                   userId 를 요구하는데, UUID 를 손으로 옮겨 적으면 틀리기 쉽다
                   (틀린 id 는 400 이거나 더 나쁘게 다른 사람에게 지급된다).
              */
              { key:'id', label:'ID', render: r => (
                <button aria-label={t('adm_copy_user_id')}
                  type="button"
                  onClick={() => window.QTCopy && window.QTCopy(r.id)}
                  title={t('adm_copy_user_id')}
                  style={{
                    fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)',
                    background:'none', border:'none', padding:0, cursor:'copy', textAlign:'left',
                  }}
                >{r.id}</button>
              ) },
              { key:'name', label: t('adm_col_name_email'), render: r => (
                <div>
                  <div style={{fontWeight:500}}>{r.name}</div>
                  <div style={{fontSize:10, color:'var(--color-text-tertiary)'}}>{r.email}</div>
                </div>
              )},
              { key:'country', label: t('adm_col_country'), width: 60, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.country}</span> },
              { key:'tier', label: t('col_tier'), render: r => <span className="badge badge--neutral">{r.tier}</span> },
              { key:'kyc', label:'KYC', render: r => (
                <div style={{display:'inline-flex', alignItems:'center', gap:4}}>
                  {[1,2,3].map(lv => <span key={lv} style={{width:6, height:6, borderRadius:'50%', background: lv <= r.kyc ? 'var(--color-success)' : 'var(--color-border-default)'}}/>)}
                  <span style={{fontFamily:'var(--font-mono)', fontSize:10, marginLeft:2}}>L{r.kyc}</span>
                </div>
              )},
              { key:'vol', label: t('adm_col_vol30'), align:'right', render: r => '$' + fmtCompact(r.vol30) },
              { key:'flags', label: t('adm_col_flags'), render: r => r.flags.length ? r.flags.map(f => <span key={f} className="severity-pill severity-pill--medium" style={{marginRight:3}}>{f}</span>) : <span style={{color:'var(--color-text-tertiary)'}}>·</span> },
              { key:'status', label: t('adm_col_status'), render: r => <span className={`status-pill status-pill--${r.status}`}>{r.status.toUpperCase()}</span> },
              { key:'joined', label: t('ref_col_joined'), render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{r.joined}</span> },
              { key:'act', label:'', align:'right', render: r => (
                <>
                  <button className="tbl-action" onClick={() => { window.location.hash = '#/admin/users/detail?id=' + encodeURIComponent(r.id); }}>{t('col_view')}</button>
                  {/*
                     ★★ onClick 이 없어서 눌러도 아무 일이 없었다.

                       ★ 그런데 여기에 KYC 심사 기능을 만들 수 없다 — **우리는 KYC 를
                         수집하지 않는다.** 신원 서류도, 얼굴 인증도 받지 않는다.
                         고객은 거래소에서 이미 KYC 를 마치고 오고, 우리는 자금을
                         보관하지 않으므로 그것을 다시 확인할 근거가 없다.

                       ★ 전에 이 화면에 'Face match 98.4%' 같은 KYC 심사 표가 있었고
                         전부 목업이었다. 운영자가 그것으로 AML 판단을 하고 있었다 —
                         제거했다. 이 버튼은 그때 남은 것이다.

                     ★ 그래서 버튼을 지우지 않고(디자인 불가침) 왜 동작하지 않는지
                       말한다. 조용히 아무 일도 안 하는 것보다 정직하다.
                  */}
                  <button aria-label={t('adm_kyc_not_collected')}
                    className="tbl-action"
                    style={{marginLeft:3, opacity: 0.6}}
                    title={t('adm_kyc_not_collected')}
                    onClick={(e) => {
                      e.stopPropagation();   // 행 클릭(상세 이동)과 겹치지 않게
                      if (window.QTToast) {
                        window.QTToast({
                          title: t('adm_kyc_not_collected'),
                          desc: t('adm_kyc_not_collected_desc'),
                          variant: 'warning',
                        });
                      }
                    }}
                  >
                    KYC
                  </button>
                  {/*
                     변경 버튼은 권한이 있을 때만 보인다.

                     숨기는 것은 UX 이고 실제 차단은 서버가 한다(403 실측 확인).
                     권한 없는 사람에게 버튼을 보여주면 누르고 실패해서
                     "고장났다" 고 오해한다.
                  */}
                  {canChangeStatus && r.status === 'active' && (
                    <button
                      className="tbl-action tbl-action--danger"
                      style={{marginLeft:3}}
                      disabled={busyId === r.id}
                      onClick={() => changeStatus(r, true)}
                    >{busyId === r.id ? '…' : t('admin_user_detail_1d441e')}</button>
                  )}
                  {canChangeStatus && (r.status === 'suspended' || r.status === 'disabled') && (
                    <button
                      className="tbl-action"
                      style={{marginLeft:3}}
                      disabled={busyId === r.id}
                      onClick={() => changeStatus(r, false)}
                    >{busyId === r.id ? '…' : t('adm_reactivate')}</button>
                  )}
                </>
              )},
            ]}
            rows={filtered}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN TRADES MONITORING PAGE
  // ============================================================
  window.AdminTradesPage = function AdminTradesPage({ shellProps }) {
    const [filter, setFilter] = useState('all');

    /*
       전체 주문 감시 (실데이터).

       서버가 읽기 전용임을 명시한다: 관리자는 주문을 제출·수정·취소할 수 없다.
       그 사실을 화면에 표시한다 — 없으면 관리자가 취소 버튼을 찾다가
       "기능이 빠졌다" 고 오해한다. 의도된 제약이다.

       ★ 왜 대개 비어 있는가
       우리는 비수탁이고 주문은 고객의 거래소 계정에서 집행된다. 우리 DB 에는
       우리를 통해 나간 주문만 남는다. 거래소에서 직접 한 거래는 보이지 않는다.
       "거래가 없다" 와 "우리를 통한 거래가 없다" 는 다르다 — 화면이 구분해야 한다.
    */
    const [live, setLive] = useState(null);
    const [meta, setMeta] = useState({ readOnly: false, note: '' });
    const [err, setErr] = useState(null);

    const load = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.orders) return;
      api.orders({ limit: 100 })
        .then((r) => { setLive(r.data || []); setMeta({ readOnly: r.readOnly, note: r.note }); setErr(null); })
        .catch((e) => setErr((e && e.message) || 'load failed'));
    }, []);
    useEffect(() => { load(); }, [load]);

    const isLive = Array.isArray(live);

    /*
       실 주문을 화면 모양으로 바꾼다.

       없는 값은 '—' 가 되도록 undefined 로 둔다. 0 으로 채우면 "0달러 거래" 로
       읽히고, 합계가 틀어진다.
    */
    const toRow = (o) => {
      const price = Number(o.price);
      const size = Number(o.quantity !== undefined ? o.quantity : o.size);
      const notional = Number.isFinite(price) && Number.isFinite(size) ? price * size : undefined;
      return {
        time: Number(o.createdAt || o.ts || o.time) || undefined,
        userId: o.userId || o.accountId || '—',
        sym: o.symbol ? String(o.symbol).replace(/USDT$/, '/USDT') : '—',
        side: o.side ? String(o.side).toLowerCase() : '—',
        size: Number.isFinite(size) ? size : undefined,
        price: Number.isFinite(price) ? price : undefined,
        notional: notional,
        // 우리는 위험 태깅을 하지 않는다. 태그를 만들어 붙이면 근거 없는 판단이 된다.
        tag: o.status ? String(o.status).toLowerCase() : 'ok',
      };
    };

    /*
       ★ 조회 실패·미연결에서 목업 거래로 되돌리지 않는다.
         목업 행(usr_kuri001 0.185BTC@68,432.5)이 실주문처럼 보이면 운영자가
         없는 거래를 조사한다. 실서비스는 빈 목록, 미리보기에서만 목업.
    */
    const trades = isLive
      ? live.map(toRow)
      : (window.QTMockPolicy && window.QTMockPolicy.pick
          ? (window.QTMockPolicy.pick(null, window.QTApp.ADMIN_LIVE_TRADES) || [])
          : []);
    const filtered = filter === 'all' ? trades : trades.filter(t => t.tag === filter);

    const withNotional = trades.filter(t => typeof t.notional === 'number');
    const totalVol = withNotional.reduce((a, t) => a + t.notional, 0);
    // 빈 배열에 Math.max 를 쓰면 -Infinity 가 나와 화면에 그대로 찍힌다.
    const largest = withNotional.length ? Math.max(...withNotional.map(t => t.notional)) : 0;
    const flagged = trades.filter(t => t.tag === 'suspicious' || t.tag === 'flagged').length;

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_trades_title')}
        subtitle={t('admin_trades_bc077b')}
        breadcrumb={['Home','Admin','Trade Monitor']}
        actions={
          <>
            {/* LIVE 배지는 실제로 실데이터일 때만 켠다. 목업에 LIVE 를 붙이면 거짓이다. */}
            <span style={{padding:'2px 8px', background: isLive ? 'oklch(78% 0.14 145 / 0.14)' : 'var(--color-bg-input)', color: isLive ? 'var(--color-success)' : 'var(--color-text-tertiary)', borderRadius:3, fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'0.06em'}}>
              {isLive ? '● ' + t('adm_badge_live') : '○ ' + t('adm_badge_mock')}
            </span>
            <button aria-label={t('refresh')} className="btn btn--sm" onClick={load} title={t('refresh')}><I.Refresh size={13}/></button>
          </>
        }
      >
        <div className="grid-4">
          {/*
             KPI 라벨을 사실에 맞춘다.

             'Last 1m' 은 우리가 1분 창으로 집계하지 않으므로 거짓이다 —
             조회한 최근 주문 전체다. 'Auto-review triggered' 는 자동 심사
             기능이 없으므로 약속이 된다. 'Flagged' 도 우리가 태깅하지 않는다.
             라벨을 조회 범위에 맞게 바꾸고, 없는 기능은 말하지 않는다.
          */}
          <window.KPICard
            label={isLive ? t('admin_trades_kpi_orders') : 'Trades · Last 1m'}
            value={trades.length}
            sub={isLive ? t('admin_trades_kpi_orders_sub') : 'Rolling window'}
            tone="brand"
          />
          <window.KPICard
            label={isLive ? t('admin_trades_kpi_notional') : 'Volume · Last 1m'}
            value={withNotional.length ? '$' + fmtCompact(totalVol) : '—'}
            sub={isLive && withNotional.length !== trades.length ? t('admin_trades_kpi_partial', { n: withNotional.length, total: trades.length }) : undefined}
            tone="long"
          />
          <window.KPICard
            label={t('adm_kpi_largest_trade')}
            value={withNotional.length ? '$' + fmtCompact(largest) : '—'}
            sub={isLive ? undefined : 'Auto-review triggered'}
          />
          <window.KPICard
            label={isLive ? t('admin_trades_kpi_rejected') : 'Flagged'}
            value={isLive ? trades.filter(x => x.tag === 'rejected').length : flagged}
            tone={(isLive ? trades.filter(x => x.tag === 'rejected').length : flagged) > 0 ? 'danger' : 'success'}
          />
        </div>

        <window.SectionCard
          title={t('adm_stream_title')}
          actions={
            <div className="seg">
              {[
                { id:'all', label:t('adm_filter_all') },
                { id:'suspicious', label:t('adm_filter_suspicious') },
                { id:'flagged', label:t('adm_filter_flagged') },
                { id:'large', label:t('adm_filter_large') },
                { id:'vip', label:'VIP' },
              ].map(f => (
                <button key={f.id} className={`seg__opt ${filter===f.id?'is-active':''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
            </div>
          }
          noPadding
        >
          <window.DataTable
            columns={[
              /* 없는 값은 '—'. 0 이나 1970-01-01 로 채우면 값으로 오인된다. */
              { key: 'time', label: t('adm_col_time'), width:80, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{r.time ? new Date(r.time).toLocaleTimeString('en-GB', {hour12:false}) : '—'}</span> },
              { key: 'user', label: t('adm_col_user'), render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.userId}</span> },
              { key: 'sym',  label: t('adm_col_symbol'), render: r => <strong>{r.sym}</strong> },
              { key: 'side', label: t('adm_col_side'), render: r => (
                r.side === 'long' || r.side === 'buy' ? <span className="t-long" style={{fontWeight:500}}>▲ LONG</span>
                : r.side === 'short' || r.side === 'sell' ? <span className="t-short" style={{fontWeight:500}}>▼ SHORT</span>
                : <span style={{color:'var(--color-text-tertiary)'}}>—</span>
              ) },
              { key: 'size', label: t('adm_col_size'), align:'right', render: r => (typeof r.size === 'number' ? fmt(r.size, 3) : '—') },
              { key: 'price', label: t('adm_col_price'), align:'right', render: r => (typeof r.price === 'number' ? fmt(r.price, 1) : '—') },
              { key: 'not',  label: t('adm_col_notional'), align:'right', render: r => (typeof r.notional === 'number' ? '$' + fmtCompact(r.notional) : '—') },
              { key: 'tag',  label: t('adm_col_flag'), render: r => {
                if (r.tag === 'ok') return <span style={{color:'var(--color-text-tertiary)'}}>ok</span>;
                const cls = { large: 'warn', suspicious: 'danger', flagged: 'danger', vip: 'ok', filled: 'ok', canceled: 'neutral', rejected: 'danger' }[r.tag] || 'neutral';
                return <span className={`status-pill status-pill--${cls}`}>{String(r.tag).toUpperCase()}</span>;
              }},
              /*
                 동작 버튼.

                 Inspect 는 배선할 대상이 없다(주문 상세 API 없음). User 는
                 사용자 상세로 보낼 수 있다. 배선할 수 없는 버튼은 실데이터일 때
                 감춘다 — 눌러도 아무 일 없으면 고장으로 보인다.
              */
              { key: 'act', label: '', render: r => (
                isLive
                  ? (r.userId && r.userId !== '—'
                      ? <button className="tbl-action" onClick={() => { window.location.hash = '#/admin/users/detail?id=' + encodeURIComponent(r.userId); }}>{t('admin_c_s_ticket_5c50d9')}</button>
                      : <span style={{color:'var(--color-text-tertiary)'}}>—</span>)
                  : <><button className="tbl-action" /* qt-i18n-ignore: 진단용 개발 버튼 */>Inspect</button> <button className="tbl-action" style={{marginLeft:3}}>{t('admin_c_s_ticket_5c50d9')}</button></>
              ) },
            ]}
            rows={filtered}
          />

          {/*
             왜 비어 있는지 설명한다.

             비수탁이라 우리 DB 에는 우리를 통해 나간 주문만 남는다. 고객이
             거래소에서 직접 한 거래는 보이지 않는다. 설명 없이 빈 표를 보여주면
             운영자가 "감시가 안 되고 있다" 고 판단하거나 조회 장애로 오해한다.
          */}
          {isLive && filtered.length === 0 && (
            <div style={{padding:'18px 16px', fontSize:12, lineHeight:1.8, color:'var(--color-text-tertiary)'}}>
              <div>{t('admin_trades_empty')}</div>
              <div style={{marginTop:4}}>{t('admin_trades_scope')}</div>
            </div>
          )}

          {/* 읽기 전용임을 서버가 알려준다. 관리자가 취소 버튼을 찾지 않게 표시한다. */}
          {isLive && meta.readOnly && (
            <div style={{padding:'10px 16px', borderTop:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)'}}>
              {t('admin_trades_readonly')}{meta.note ? ` · ${serverNote(meta.note)}` : ''}
            </div>
          )}
          {err && (
            <div style={{padding:'10px 16px', fontSize:11, color:'var(--color-danger)'}}>{t('admin_load_failed')} · {err}</div>
          )}
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN AI OPS PAGE
  // ============================================================
  window.AdminAIOpsPage = function AdminAIOpsPage({ shellProps }) {
    const ai = window.QTApp.ADMIN_AI_METRICS;

    /*
       AI 운영.

       ★ 목업 지표 전체가 근거 없는 값이었다:
         '오늘 신호 486건 · 승인율 62% · 적중률 58% · 비용 $68.42 ·
          지연 1,240ms · 오류율 · 모델 트래픽 86%/14% · 롤백 준비 v1.3.9'

         우리는 AI 신호를 집계하지 않고, 모델을 두 버전으로 나눠 트래픽을
         쪼개지도, 롤백 장치를 두지도 않았다. 운영 지표가 거짓이면 장애를
         알아채지 못하고, 없는 롤백을 믿고 위험한 배포를 한다.

       ★ 서버가 사실을 알려준다:
         provider='unavailable' — AI 제공자가 연결되지 않았다.
         liveExecution='Not Executed' — 실제 실행이 없었다.
         summary 의 null 은 0 이 아니라 "미실행" 이다.
         prompt 원문과 자격증명은 서버가 절대 반환하지 않는다(digest 만).
    */
    const adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };
    const [policy, setPolicy] = useState(null);
    const [usage, setUsage] = useState(null);
    const [status, setStatus] = useState(null); // /api/ai/status — 연결 여부/제공자/모델/사유
    const [err, setErr] = useState(null);

    useEffect(() => {
      const api = window.QTApi && window.QTApi.admin;
      const rest = window.QTApi && window.QTApi.rest;
      if (!api || !api.aiPolicy) return undefined;
      let cancelled = false;
      Promise.all([
        api.aiPolicy().catch((e) => ({ __err: e })),
        api.aiUsage ? api.aiUsage().catch((e) => ({ __err: e })) : Promise.resolve(null),
        rest && rest.aiStatus ? rest.aiStatus().catch(() => null) : Promise.resolve(null),
      ]).then(([p, u, s]) => {
        if (cancelled) return;
        if (p && !p.__err) setPolicy(p.data); else if (p && p.__err) setErr((p.__err.message) || 'policy failed');
        if (u && !u.__err) setUsage(u.data);
        if (s) setStatus(s);
      });
      return () => { cancelled = true; };
    }, [adm.version]);

    const isLive = Boolean(policy || usage);
    const provider = (status && status.provider) || (usage ? usage.provider : null);
    const executed = Boolean((status && status.available) || (provider && provider !== 'unavailable'));
    const sum = (usage && usage.summary) || null;

    // null 은 미실행이다. 0 으로 바꾸면 실행했는데 결과가 0 인 것과 구분되지 않는다.
    const numOr = (v) => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const micros = numOr(sum && sum.actual_cost_micros) ?? numOr(sum && sum.estimated_cost_micros);
    const costUsd = micros === null ? null : micros / 1e6;
    const inTok = numOr(sum && sum.input_tokens);
    const outTok = numOr(sum && sum.output_tokens);
    const totalTok = (inTok === null && outTok === null) ? null : (inTok || 0) + (outTok || 0);

    if (isLive) {
      return (
        <window.PageShell
          {...shellProps}
          title={t('admin_aiops_title')}
          subtitle={t('aiops_subtitle', { provider: provider || '—' })}
          breadcrumb={['Home','Admin','AI Ops']}
          actions={<button aria-label={t('refresh')} className="btn btn--sm" onClick={() => { if (window.QTAdmin) window.QTAdmin.refresh(); }} title={t('refresh')}><I.Refresh size={13}/></button>}
        >
          {/* 실행 여부를 먼저 명확히 한다. */}
          <div style={{
            padding:'12px 14px', borderRadius:6, fontSize:12.5, lineHeight:1.8,
            background: executed ? 'color-mix(in srgb, var(--color-success) 10%, transparent)' : 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
            border: '1px solid ' + (executed ? 'var(--color-success)' : 'var(--color-warning)'),
          }}>
            <div style={{fontWeight:600, marginBottom:4}}>
              {executed ? t('aiops_active', { provider: provider }) : t('aiops_inactive')}
            </div>
            <div>{executed ? t('aiops_active_note') : t('aiops_inactive_note')}</div>
            {status && status.available && status.model && (
              <div style={{marginTop:6, fontFamily:'var(--font-mono)', fontSize:12}}>{t('aiops_model', { model: status.model })}</div>
            )}
            {status && !status.available && status.reason && (
              <div style={{marginTop:6, fontSize:12, color:'var(--color-warning)'}}>{t('aiops_unavail_reason', { reason: status.reason })}</div>
            )}
          </div>

          <div className="grid-4">
            {/*
               실행 기록 수. '오늘 신호 486건' 은 집계하지 않는 값이었다.
               우리가 아는 것은 저장된 실행 레코드 수다.
            */}
            <window.KPICard
              label={t('aiops_runs')}
              value={usage ? usage.total : '—'}
              sub={sum ? t('aiops_records', { n: sum.records }) : undefined}
              tone="ai"
            />
            <window.KPICard
              label={t('aiops_tokens')}
              value={totalTok === null ? '—' : totalTok.toLocaleString()}
              sub={inTok !== null || outTok !== null ? t('aiops_tokens_split', { i: inTok ?? 0, o: outTok ?? 0 }) : t('aiops_not_executed')}
            />
            <window.KPICard
              label={t('aiops_cost')}
              value={costUsd === null ? '—' : '$' + costUsd.toFixed(4)}
              sub={costUsd === null ? t('aiops_not_executed') : undefined}
            />
            {/* 일일 한도는 정책에 실제로 있는 값이다. */}
            <window.KPICard
              label={t('aiops_limit')}
              value={policy && Number(policy.dailyCostLimitMicros) > 0
                ? '$' + (Number(policy.dailyCostLimitMicros) / 1e6).toFixed(2)
                : t('aiops_no_limit')}
              sub={policy ? t('aiops_max_tokens', { n: policy.maxOutputTokens }) : undefined}
              tone={policy && Number(policy.dailyCostLimitMicros) > 0 ? 'success' : 'warning'}
            />
          </div>

          <window.SectionCard title={t('aiops_policy')} subtitle={t('aiops_policy_sub')} noPadding>
            <window.DataTable
              columns={[
                { key:'k', label:t('aiops_setting'), render: r => <strong style={{fontFamily:'var(--font-mono)', fontSize:12}}>{r.k}</strong> },
                { key:'v', label:t('aiops_value'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11.5, color: r.muted ? 'var(--color-text-tertiary)' : undefined}}>{r.v}</span>
                ) },
              ]}
              rows={policy ? [
                { k: 'provider', v: provider || '—', muted: !provider },
                { k: 'liveExecution', v: policy.liveExecution || '—', muted: !policy.liveExecutionEnabled },
                { k: 'maxOutputTokens', v: String(policy.maxOutputTokens) },
                { k: 'dailyCostLimit', v: Number(policy.dailyCostLimitMicros) > 0 ? '$' + (Number(policy.dailyCostLimitMicros) / 1e6).toFixed(2) : t('aiops_no_limit'), muted: !(Number(policy.dailyCostLimitMicros) > 0) },
                { k: 'allowedTools', v: (policy.allowedTools && policy.allowedTools.length) ? policy.allowedTools.join(', ') : t('aiops_none'), muted: !(policy.allowedTools && policy.allowedTools.length) },
                /*
                   시스템 프롬프트는 원문이 오지 않는다 — digest 만 온다.
                   프롬프트에는 사업 논리가 들어가므로 관리 화면에 노출하지 않는 설계다.
                */
                { k: 'systemPrompt', v: policy.systemPrompt && policy.systemPrompt.digest
                    ? `${policy.systemPrompt.algorithm}:${String(policy.systemPrompt.digest).slice(0, 16)}… (${policy.systemPrompt.length} chars)`
                    : t('aiops_no_prompt'), muted: !(policy.systemPrompt && policy.systemPrompt.digest) },
                { k: 'promptVersion', v: policy.promptVersion || '—', muted: !policy.promptVersion },
                { k: 'policyVersion', v: String(policy.version) },
                { k: 'historyEntries', v: String(policy.historyEntries) },
                { k: 'updatedBy', v: policy.updatedBy || '—', muted: !policy.updatedBy },
              ] : []}
            />
            <div style={{padding:'10px 16px', borderTop:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)'}}>
              {t('aiops_redacted')}
            </div>
          </window.SectionCard>

          {/* 실행 기록. 프롬프트·응답 본문은 서버가 반환하지 않는다. */}
          <window.SectionCard
            title={t('aiops_runs_title')}
            subtitle={usage && usage.note ? serverNote(usage.note) : undefined}
            noPadding={Boolean(usage && usage.runs && usage.runs.length)}
          >
            {usage && Array.isArray(usage.runs) && usage.runs.length > 0 ? (
              <window.DataTable
                columns={[
                  { key:'at', label:t('aiops_time'), render: r => (
                    <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.created_at ? new Date(Number(r.created_at)).toLocaleString() : '—'}</span>
                  ) },
                  { key:'model', label:t('aiops_model'), render: r => r.model || '—' },
                  { key:'tok', label:t('aiops_tokens'), align:'right', render: r => {
                    const i = Number(r.input_tokens), o = Number(r.output_tokens);
                    return (Number.isFinite(i) || Number.isFinite(o)) ? `${i || 0} / ${o || 0}` : '—';
                  } },
                  { key:'cost', label:t('aiops_cost'), align:'right', render: r => {
                    const c = Number(r.actual_cost_micros ?? r.estimated_cost_micros);
                    return Number.isFinite(c) ? '$' + (c / 1e6).toFixed(4) : '—';
                  } },
                ]}
                rows={usage.runs}
              />
            ) : (
              <div style={{fontSize:12, lineHeight:1.8, color:'var(--color-text-tertiary)'}}>
                {t('aiops_no_runs')}
              </div>
            )}
          </window.SectionCard>
          {err && <div style={{fontSize:11, color:'var(--color-danger)'}}>{t('admin_load_failed')} · {err}</div>}
        </window.PageShell>
      );
    }

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_aiops_title')}
        /*
           ★ 모델 버전·배포 시각은 서버가 주는 값만 쓴다.
             전에는 목업(`ADMIN_AI_METRICS.modelVersion` / `lastDeploy`)을 그대로
             찍어서, AI 가 연결되지 않은 상태에서도 특정 모델이 배포된 것처럼
             보였다.
        */
        subtitle={usage && usage.liveModel && usage.liveModel !== 'Not Executed'
          ? t('adm_ai_model', { model: usage.liveModel })
          : t('adm_ai_model_unknown')}
        breadcrumb={['Home','Admin','AI Ops']}
        actions={
          <>
            <button className="btn btn--sm"><I.Book size={13}/> {t('col_prompts')}</button>
            <button className="btn btn--sm btn--primary"><I.Sparkles size={13}/> {t('aiops_deploy')}</button>
          </>
        }
      >
        {/*
           ★★ 이 8칸은 전부 목업이었다.

             `Signals 486` · `Hit Rate 7d` · `Avg Confidence` · `Cost` ·
             `Avg Latency` · `Error Rate` · `Model Traffic 86%/14%` ·
             `Rollback Ready ✓ v1.3.9`. 마지막 둘은 아예 고정 문자열이다.

             AI 는 아직 연결되지 않았다(provider unavailable). 즉 신호도 비용도
             지연도 존재하지 않는다. 그런데 이 화면은 숫자를 보여줬고,
             "Rollback Ready" 는 되돌릴 준비가 됐다고 단정했다 — 되돌릴 대상이
             없는데. 운영자가 이 화면을 근거로 판단하면 전부 헛수고가 된다.

           ★ 실데이터(사용량·정책)가 있을 때만 값을 보여준다. 없으면 없다고
             말한다. 0 으로도 채우지 않는다 — "신호 0건" 과 "AI 미연결" 은
             다른 사실이다.
        */}
        {usage ? (
          /*
             서버 실측 필드를 그대로 쓴다 (실측 확인한 형태):
               { provider, liveModel, summary: { records, input_tokens,
                 output_tokens, estimated_cost_micros, actual_cost_micros,
                 fallback_count }, runs, total }

             ★ 지금은 provider 가 'unavailable' 이고 토큰·비용이 모두 null 이다.
               null 은 0 이 아니라 **집계 대상이 없었다**는 뜻이므로 '—' 로 둔다.
             ★ 비용은 micros(1/1,000,000 달러) 단위다. 단위를 잘못 읽으면
               100만 배 틀린 금액이 화면에 뜬다.
          */
          <div className="grid-4">
            <window.KPICard
              label="AI Provider"
              value={usage.provider && usage.provider !== 'unavailable' ? usage.provider : '—'}
              sub={usage.provider === 'unavailable' ? t('adm_ai_provider_off') : undefined}
              tone={usage.provider && usage.provider !== 'unavailable' ? 'ai' : 'warning'}
            />
            <window.KPICard
              label="Runs recorded"
              value={Number.isFinite(usage.summary && usage.summary.records) ? Number(usage.summary.records).toLocaleString() : '—'}
            />
            <window.KPICard
              label="Tokens (in / out)"
              value={(() => {
                const su = usage.summary || {};
                const a = su.input_tokens, b = su.output_tokens;
                if (a == null && b == null) return '—';
                return `${a == null ? '—' : Number(a).toLocaleString()} / ${b == null ? '—' : Number(b).toLocaleString()}`;
              })()}
              sub={(usage.summary && usage.summary.input_tokens == null) ? t('adm_ai_no_metric') : undefined}
            />
            <window.KPICard
              label="Cost (actual)"
              value={(() => {
                const m = usage.summary && usage.summary.actual_cost_micros;
                // micros → USD. null 이면 만들지 않는다.
                return m == null ? '—' : '$' + (Number(m) / 1e6).toFixed(4);
              })()}
              sub={(usage.summary && usage.summary.actual_cost_micros == null) ? t('adm_ai_no_metric') : undefined}
            />
          </div>
        ) : (
          <div
            style={{
              display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
              padding:'12px 14px', marginBottom:12, border:'1px solid var(--color-warning)',
              borderRadius:6, background:'color-mix(in srgb, var(--color-warning) 10%, transparent)',
            }}
          >
            <span style={{fontSize:12, color:'var(--color-warning)'}}>{t('adm_ai_metrics_absent')}</span>
          </div>
        )}

        <div className="grid-2">
          <window.SectionCard title={t('aiops_signal_quality')} subtitle="Hit rate = signals reaching TP1 within window">
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              {ai.modelBreakdown.map(m => (
                <div key={m.model}>
                  <div style={{display:'flex', justifyContent:'space-between', fontSize:12, marginBottom: 4}}>
                    <strong>{m.model}</strong>
                    <span style={{fontFamily:'var(--font-mono)'}}>{(m.share*100).toFixed(0)}% traffic · {(m.hitRate*100).toFixed(0)}% hit</span>
                  </div>
                  <div style={{height:8, background:'var(--color-bg-input)', borderRadius:999, overflow:'hidden', position:'relative'}}>
                    <div style={{position:'absolute', top:0, left:0, height:'100%', width: (m.share*100)+'%', background:'var(--color-brand)', opacity: 0.5}}/>
                    <div style={{position:'absolute', top:0, left:0, height:'100%', width: (m.hitRate*100)+'%', background:'var(--color-ai)'}}/>
                  </div>
                </div>
              ))}
            </div>
            <div style={{marginTop:16, padding:'8px 12px', background:'var(--color-ai-bg)', borderRadius:4, fontSize:11.5, color:'var(--color-text-secondary)'}}>
              {t('admin_a_i_ops_50ede2')}
            </div>
          </window.SectionCard>

          <window.SectionCard title={t('aiops_incidents')} noPadding>
            {ai.recentIncidents.map((inc, i) => (
              <div key={i} style={{padding:'10px 16px', borderBottom:'1px solid var(--color-border-subtle)', display:'flex', alignItems:'center', gap:12}}>
                <span className={`status-pill status-pill--${inc.severity === 'warn' ? 'warn' : 'ok'}`}>{inc.severity.toUpperCase()}</span>
                <span style={{fontSize:12, flex:1}}>{inc.desc}</span>
                <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{timeAgo(inc.time)}</span>
              </div>
            ))}
          </window.SectionCard>
        </div>

        <window.SectionCard title={t('aiops_prompts')} subtitle="Versioned prompts · A/B tests · Rollout schedule">
          <window.DataTable
            columns={[
              { key: 'name', label: 'Prompt' },
              { key: 'ver',  label: 'Version', render: () => <span className="badge badge--neutral">v14.2</span> },
              { key: 'status', label: t('adm_col_status'), render: () => <span className="status-pill status-pill--ok">DEPLOYED</span> },
              /*
                 ★ 전에는 `t('admin_a_i_ops_ed2648')` = "3d ago · 권누리" 를 모든
                   행에 고정으로 찍었다. 프롬프트를 누가 언제 고쳤는지는 감사
                   대상인데, 서버가 그 값을 주지 않는다. 실제로 존재하지 않는
                   사람 이름이 편집자로 남으면 기록으로서 해롭다.
              */
              { key: 'lastEdit', label: 'Last Edit', render: (r) => (
                r && r.updatedAt
                  ? <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{new Date(r.updatedAt).toLocaleString()}</span>
                  : <span style={{color:'var(--color-text-tertiary)'}}>—</span>
              ) },
              { key: 'act', label: '', align:'right', render: () => <><button className="tbl-action">{t('col_edit')}</button> <button className="tbl-action" style={{marginLeft:3}}>{t('col_diff')}</button></> },
            ]}
            rows={[
              { name: 'analyst.system' },
              { name: 'analyst.signal-generation' },
              { name: 'analyst.trendline' },
              { name: 'analyst.support-resistance' },
              { name: 'mentor.beginner-explain' },
            ]}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN DESIGN OPS PAGE — 대표님이 UI 토큰/컴포넌트 관리
  // ============================================================
  window.AdminDesignOpsPage = function AdminDesignOpsPage({ shellProps }) {
    const d = window.QTApp.DESIGN_OPS;

    /*
       디자인 운영.

       ★ '미게시 변경 3건' 과 'Publish to sync to codebase' 는 근거가 없다.
         디자인 토큰을 코드로 내보내는 파이프라인이 없다 — 버튼을 누를 대상이
         없고, 운영자는 게시를 기다린다.

       ★ 반대로 셀 수 있는 것은 실제로 센다. 런타임에 등록된 컴포넌트 수,
         라우트 수, 사용 가능한 테마·밀도는 모두 조회 가능하다.
         하드코딩한 '27 / 24' 는 코드가 바뀌면 즉시 거짓이 된다.
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const __backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    const isLive = __backend !== false;

    const counts = React.useMemo(() => {
      // window 에 등록된 컴포넌트를 센다. 대문자로 시작하는 함수만.
      let components = 0;
      let pages = 0;
      try {
        for (const k of Object.keys(window)) {
          if (!/^[A-Z][A-Za-z0-9]*$/.test(k)) continue;
          if (typeof window[k] !== 'function') continue;
          components += 1;
          if (/Page$/.test(k)) pages += 1;
        }
      } catch (e) { /* 접근 불가 속성은 무시 */ }

      // 라우트는 접근 규칙이 유일한 출처다.
      const routes = (window.QTAccess && window.QTAccess.allRoutes) ? window.QTAccess.allRoutes().length : null;

      // 실제로 적용되는 테마·밀도·언어.
      const themes = ['dark', 'light'];
      const densities = ['comfortable', 'compact', 'dense'];
      const locales = (window.QTI18n && window.QTI18n.available)
        ? window.QTI18n.available().length : null;

      return { components, pages, routes, themes: themes.length, densities: densities.length, locales };
    }, []);

    if (isLive) {
      return (
        <window.PageShell
          {...shellProps}
          title={t('admin_dops_title')}
          subtitle={t('dops_subtitle')}
          breadcrumb={['Home','Admin','Design Ops']}
          badge={<span className="badge badge--ai">{t('adm_badge_super')}</span>}
          actions={
            <>
              {/*
                 ★★ design-system.html · developer-handoff.html 로 가는 버튼을 없앴다.
                   두 파일은 정적 서빙 허용목록(static-web.ts) 에 없어서 **404 가 난다**
                   (실측). 눌러도 안 되는 버튼은 없는 것보다 나쁘다 — 운영자는 기능이
                   고장났다고 판단한다. 문서는 저장소에서 열면 된다. 허용목록에 넣지
                   않은 것은 의도다: 정적 서빙에는 인증이 없어 내부 문서가 공개된다.
              */}
              <a className="btn btn--sm" href="design-library/index.html" target="_blank" rel="noopener noreferrer"><I.Layers size={13}/> Library {/* qt-i18n-ignore: 개발자 문서 */} {/* qt-i18n-ignore: 개발자 전용 화면 이름 */}</a>
            </>
          }
        >
          <div className="grid-4">
            <window.KPICard
              label={t('dops_components')}
              value={counts.components}
              sub={t('dops_components_sub')}
              icon="Layers" tone="brand"
            />
            <window.KPICard label={t('dops_pages')} value={counts.pages} sub={t('dops_pages_sub')} tone="ai"/>
            <window.KPICard
              label={t('dops_routes')}
              value={counts.routes === null ? '—' : counts.routes}
              sub={t('dops_routes_sub')}
            />
            <window.KPICard
              label={t('dops_variants')}
              value={counts.themes * counts.densities}
              sub={t('dops_variants_sub', { themes: counts.themes, densities: counts.densities, locales: counts.locales === null ? '—' : counts.locales })}
            />
          </div>

          {/*
             게시 파이프라인이 없다는 사실.

             '미게시 3건 · Publish' 를 지우기만 하면 운영자는 어디서 게시하는지
             찾는다. 그런 단계가 없다는 것을 밝힌다.
          */}
          <window.NotApplicablePanel
            title={t('dops_no_pipeline_title')}
            reason={t('dops_no_pipeline')}
            points={[t('dops_p1'), t('dops_p2'), t('dops_p3')]}
            whereInstead={t('dops_instead')}
          />

          {/* 실제로 적용되는 디자인 설정 — Tweaks 패널이 쓰는 것과 같다. */}
          <window.SectionCard title={t('dops_applied')} subtitle={t('dops_applied_sub')} noPadding>
            <window.DataTable
              columns={[
                { key:'k', label:t('aiops_setting'), render: r => <strong style={{fontSize:12}}>{r.k}</strong> },
                { key:'v', label:t('aiops_value'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11.5}}>{r.v}</span>
                ) },
                { key:'where', label:t('dops_where'), render: r => (
                  <span style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{r.where}</span>
                ) },
              ]}
              rows={[
                { k: t('dops_theme'), v: [t('tw_theme_dark'), t('tw_theme_light')].join(' · '), where: t('dops_via_tweaks') },
                { k: t('dops_density'), v: [t('tw_density_comfortable'), t('tw_density_compact'), t('tw_density_dense')].join(' · '), where: t('dops_via_tweaks') },
                { k: t('dops_locale'), v: (window.QTI18n && window.QTI18n.available)
                    ? window.QTI18n.available().map((x) => (typeof x === 'string' ? x : x.code)).join(' · ') : '—',
                  where: t('dops_via_settings') },
                { k: t('dops_tokens_file'), v: 'src/tokens.css', where: t('dops_via_code') },
              ]}
            />
          </window.SectionCard>
        </window.PageShell>
      );
    }

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_dops_title')}
        subtitle={t('admin_design_ops_247f98')}
        breadcrumb={['Home','Admin','Design Ops']}
        badge={<span className="badge badge--ai">{t('adm_badge_super')}</span>}
        actions={
          <>
            <a className="btn btn--sm" href="design-library/index.html" target="_blank"><I.Layers size={13}/> Library {/* qt-i18n-ignore: 개발자 문서 */} {/* qt-i18n-ignore: 개발자 전용 화면 이름 */}</a>
            {/*
               ★★ 'Publish (N)' 버튼을 없앴다. 누르면 아무 일도 일어나지 않으며,
                 존재하지 않는 동기화(관리자 화면 → 코드)를 있는 것처럼 보이게 한다.
                 이 화면의 본문이 이미 "디자인 공개 공정은 없다" 고 말한다 —
                 버튼과 본문이 서로 다른 말을 하고 있었다.
            */}
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="Design Tokens" value={d.tokens.brands.length + d.tokens.longshortPairs.length + d.tokens.themes.length + d.tokens.densities.length + '+'} sub="Brand · L/S · Theme · Density" icon="Layers" tone="brand"/>
          <window.KPICard label="Components" value={d.componentCount} sub="Buttons · Modals · Tables · Widgets · …" tone="ai"/>
          <window.KPICard label="Pages" value={d.pageCount} sub="User · Admin · Auth · Library"/>
          <window.KPICard label="Unpublished" value={d.unpublishedChanges} sub="Publish to sync to codebase" tone={d.unpublishedChanges > 0 ? 'warning' : 'success'}/>
        </div>

        <div className="grid-2">
          <window.SectionCard title={t('dops_palettes')} actions={<button className="btn btn--sm"><I.Plus size={11}/> {t('col_new')}</button>}>
            {d.tokens.brands.map(b => (
              <div key={b} style={{display:'flex', alignItems:'center', gap: 12, padding:'10px 12px', border:'1px solid var(--color-border-subtle)', borderRadius:4, marginBottom: 6}}>
                <div style={{display:'flex', gap:2}}>
                  {[500,600,700].map(shade => (
                    <div key={shade} style={{width:24, height:24, borderRadius:3, background: b === 'institutional-cool' ? `oklch(${shade === 500 ? 56 : shade === 600 ? 48 : 38}% 0.15 220)` : 'var(--color-brand)'}}/>
                  ))}
                </div>
                <span style={{flex:1, fontSize:12, fontWeight:500}}>{b}</span>
                {b === 'institutional-cool' && <span className="status-pill status-pill--ok">DEFAULT</span>}
                <button className="tbl-action">{t('col_edit')}</button>
              </div>
            ))}
          </window.SectionCard>

          <window.SectionCard title={t('dops_longshort')} actions={<button className="btn btn--sm"><I.Plus size={11}/> {t('col_new')}</button>}>
            {d.tokens.longshortPairs.map(p => (
              <div key={p} style={{display:'flex', alignItems:'center', gap: 12, padding:'10px 12px', border:'1px solid var(--color-border-subtle)', borderRadius:4, marginBottom: 6}}>
                <div style={{display:'flex', gap:4}}>
                  <div style={{width:24, height:24, borderRadius:3, background: p === 'teal-magenta' ? 'oklch(72% 0.14 175)' : p === 'green-red' ? 'oklch(70% 0.17 145)' : 'oklch(72% 0.15 220)'}}/>
                  <div style={{width:24, height:24, borderRadius:3, background: p === 'teal-magenta' ? 'oklch(68% 0.22 355)' : p === 'green-red' ? 'oklch(64% 0.22 25)' : 'oklch(72% 0.17 55)'}}/>
                </div>
                <span style={{flex:1, fontSize:12, fontWeight:500}}>{p}</span>
                {p === 'teal-magenta' && <span className="status-pill status-pill--ok">DEFAULT</span>}
                <button className="tbl-action">{t('col_edit')}</button>
              </div>
            ))}
          </window.SectionCard>
        </div>

        <window.SectionCard title={t('dops_recent_changes')} subtitle={`Last publish · ${new Date(d.lastPublished).toLocaleString('en-GB', {hour12:false})}`}>
          {d.changes.map((c, i) => (
            <div key={i} style={{display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom: i < d.changes.length-1 ? '1px solid var(--color-border-subtle)' : ''}}>
              <span className="badge badge--neutral" style={{textTransform:'uppercase'}}>{c.kind}</span>
              <span style={{flex:1, fontSize:12.5}}>{c.title}</span>
              <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{c.author}</span>
              <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{timeAgo(c.time)}</span>
              <button className="tbl-action">{t('col_diff')}</button>
            </div>
          ))}
        </window.SectionCard>

        <window.SectionCard title={t('adm_quick_actions')} subtitle={t('admin_design_ops_127e5c')}>
          <div className="grid-4">
            {[
              { icon: 'LayoutIcon', title: t('admin_design_ops_631818'), desc: t('admin_design_ops_ad367e'), href: 'design-library/templates/blank.html' },
              { icon: 'Grid',       title: t('admin_design_ops_b31be6'), desc: t('admin_design_ops_376325'), href: 'design-library/components/index.html' },
              { icon: 'Layers',     title: t('admin_design_ops_b1169b'), desc: t('admin_design_ops_23188a'), href: 'design-library/snippets/index.html' },
              { icon: 'Book',       title: t('admin_design_ops_341930'), desc: t('admin_design_ops_454af0'), href: 'design-library/guide.md' },
            ].map((a, i) => {
              const Ic = I[a.icon] || I.Grid;
              return (
                <a key={i} href={a.href} target="_blank" style={{padding:14, border:'1px solid var(--color-border-subtle)', borderRadius:6, textDecoration:'none', color:'inherit', display:'flex', flexDirection:'column', gap:8, background:'var(--color-bg-surface)', transition:'border-color var(--dur-fast)'}}>
                  <span style={{width:32, height:32, borderRadius:6, background:'var(--color-brand-subtle)', color:'var(--color-brand)', display:'inline-flex', alignItems:'center', justifyContent:'center'}}><Ic size={16}/></span>
                  <div>
                    <div style={{fontSize:13, fontWeight:600}}>{a.title}</div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop: 2}}>{a.desc}</div>
                  </div>
                </a>
              );
            })}
          </div>
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN SYSTEM PAGE
  // ============================================================
  window.AdminSystemPage = function AdminSystemPage({ shellProps }) {
    const _adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };

    /*
       시스템 상태 (실데이터).

       서버가 항목별 문자열을 준다(api='ok', postgres='Connected', …).
       상태 화면이 거짓이면 없는 것보다 나쁘다 — 운영자가 죽은 곳을 살았다고
       보고 엉뚱한 데를 고친다. 그래서 서버 문자열을 해석만 하고 꾸미지 않는다.
    */
    const health = window.QTAdmin ? window.QTAdmin.getHealth() : null;

    /*
       문자열 → 상태 등급.

       'ok'/'Connected'/'Configured' → 정상
       'Idle'/'Locked'/'Mock…'       → 주의 (동작하지만 완전하지 않음)
       'Unavailable'/'Not Connected' → 알 수 없음. **오류로 표시하지 않는다** —
         측정하지 않는 항목(cpu 등)까지 빨갛게 되면 진짜 장애를 못 찾는다.
    */
    const gradeOf = (v) => {
      const t = String(v);
      if (/^(ok|Connected|Configured|Enabled)/i.test(t)) return 'ok';
      if (/^(Idle|Locked|Mock|Not Implemented)/i.test(t)) return 'warn';
      if (/^(Unavailable|Not Connected|unavailable)/i.test(t)) return 'unknown';
      return 'info';
    };

    // 숫자·버전 같은 정보성 항목은 상태 판정 대상이 아니다.
    const INFO_KEYS = new Set([
      'buildVersion', 'gitSha', 'nodeVersion', 'aiProvider', 'tradingMode',
      'marketDataSource', 'uptimeSeconds', 'memoryHeapUsed', 'memoryRss',
      'wsClients', 'wsCandleSeries', 'latencyP50', 'latencyP95', 'latencyP99', 'cpu',
    ]);

    const liveRows = health
      ? Object.keys(health).map((k) => ({
          name: k,
          value: String(health[k]),
          grade: INFO_KEYS.has(k) ? 'info' : gradeOf(health[k]),
          isInfo: INFO_KEYS.has(k),
        }))
      : null;

    const isLive = Array.isArray(liveRows);
    // 목업 표시가 허용된 환경인가(백엔드 없는 디자인 미리보기). 실서비스는 금지.
    const mockAllowedSys = window.QTMockPolicy && window.QTMockPolicy.allowMockData
      ? window.QTMockPolicy.allowMockData()
      : false;
    const system = window.QTApp.ADMIN_SYSTEM;
    const okCount = isLive
      ? liveRows.filter((r) => r.grade === 'ok').length
      : system.filter(s => s.status === 'ok').length;
    const checked = isLive ? liveRows.filter((r) => !r.isInfo).length : system.length;

    // 업타임은 초로 온다. 사람이 읽는 단위로 바꾼다.
    const uptime = (() => {
      const sec = Number(health && health.uptimeSeconds);
      if (!Number.isFinite(sec) || sec < 0) return null;
      if (sec < 60) return sec + 's';
      if (sec < 3600) return Math.floor(sec / 60) + 'm';
      if (sec < 86400) return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
      return Math.floor(sec / 86400) + 'd ' + Math.floor((sec % 86400) / 3600) + 'h';
    })();

    /*
       ★★ 운영 오류 목록.

         이 서비스는 장애를 **고객 신고로만** 알 수 있었다. 서버 예외는 어디에도
         쌓이지 않았고 클라이언트 오류는 console.error 로만 남았다. 이제 서버가
         ops_errors 에 모아주므로, 시스템 상태 화면에서 함께 본다.

       ★ 조회 실패를 빈 목록으로 두지 않는다 — "오류가 없다" 로 읽히면
         관측 장치를 만든 의미가 사라진다.
    */
    const [opsErr, setOpsErr] = useState(null);      // null = 아직 모름
    const [opsErrState, setOpsErrState] = useState('loading'); // loading | ok | failed | unsupported
    useEffect(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.opsErrors) { setOpsErrState('unsupported'); return undefined; }
      let cancelled = false;
      api.opsErrors(30).then((r) => {
        if (cancelled) return;
        if (!r || r.ok === false) { setOpsErrState('failed'); return; }
        if (r.supported === false) { setOpsErrState('unsupported'); return; }
        setOpsErr(r);
        setOpsErrState('ok');
      });
      return () => { cancelled = true; };
    }, [_adm.version]);

    const agoText = (ms) => {
      const d = Date.now() - Number(ms);
      if (!Number.isFinite(d) || d < 0) return '—';
      if (d < 60000) return Math.floor(d / 1000) + 's';
      if (d < 3600000) return Math.floor(d / 60000) + 'm';
      if (d < 86400000) return Math.floor(d / 3600000) + 'h';
      return Math.floor(d / 86400000) + 'd';
    };

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_system_title')}
        subtitle={isLive
          ? t('admin_system_subtitle', { ok: okCount, total: checked })
          : `${okCount}/${system.length} services healthy · WebSocket · DB · API · Batch`}
        breadcrumb={['Home','Admin','System']}
        actions={<button aria-label={t('refresh')} className="btn btn--sm" onClick={() => { if (window.QTAdmin) window.QTAdmin.refresh(); }} title={t('refresh')}><I.Refresh size={13}/></button>}
      >
        {/*
           KPI.

           원래 네 값 모두 고정이었다(99.984% · 1,242명 · 8,412 · 2건).
           운영 지표가 거짓이면 장애를 알아채지 못한다.
           30일 가동률은 우리가 측정하지 않는다 — 그 자리에 프로세스 가동시간을
           넣는다. 없는 지표를 만들지 않고, 가진 지표를 정확히 보여준다.
        */}
        <div className="grid-4">
          {isLive ? (
            <>
              <window.KPICard
                label={t('admin_system_uptime')}
                value={uptime || '—'}
                sub={t('admin_system_uptime_sub')}
                tone={uptime ? 'success' : undefined}
              />
              <window.KPICard
                label={t('admin_system_ws_clients')}
                value={health && health.wsClients !== undefined ? health.wsClients : '—'}
                sub={health && health.wsCandleSeries !== undefined ? t('admin_system_series', { n: health.wsCandleSeries }) : undefined}
              />
              <window.KPICard
                label={t('admin_system_memory')}
                value={(health && health.memoryHeapUsed) || '—'}
                sub={health && health.memoryRss ? t('admin_system_rss', { v: health.memoryRss }) : undefined}
              />
              <window.KPICard
                label={t('admin_system_market')}
                value={(health && health.marketDataSource) || '—'}
                sub={(health && health.tradingMode) ? t('admin_system_mode', { mode: health.tradingMode, orders: health.liveOrders }) : undefined}
                tone={health && health.marketDataSource && health.marketDataSource !== 'mock_replay' ? 'success' : 'warning'}
              />
            </>
          ) : mockAllowedSys ? (
            /*
               ★★ 이 네 칸은 목업이다.

                 `Overall Uptime 99.984%` · `Active Users 1,242` ·
                 `WS Connections 8,412` · `Alerts 2` — 전부 고정 문자열이다.
                 시스템 상태 화면의 숫자는 "지금 서비스가 정상인가" 를 판단하는
                 근거다. 조회에 실패했는데 99.984% 가 보이면 운영자는 문제를
                 모르고 넘어간다. 장애를 늦게 아는 것이 가장 비싼 실수다.

               ★ 디자인 미리보기에서만 렌더한다. 실서비스에서는 아래 안내로
                 대체된다(숫자를 만들지 않는다).
            */
            <>
              <window.KPICard label="Overall Uptime · 30d" value="99.984%" sub="4.6m downtime" tone="success"/>
              <window.KPICard label="Active Users" value="1,242" sub="Real-time"/>
              <window.KPICard label="WS Connections" value="8,412" sub="Peak today 12,340"/>
              <window.KPICard label="Alerts · Last 24h" value="2" sub="1 warn · 0 critical" tone="warning"/>
            </>
          ) : (
            <div
              style={{
                gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                padding:'12px 14px', border:'1px solid var(--color-warning)', borderRadius:6,
                background:'color-mix(in srgb, var(--color-warning) 10%, transparent)',
              }}
            >
              <span style={{fontSize:12, color:'var(--color-warning)'}}>{t('adm_health_unavailable')}</span>
            </div>
          )}
        </div>

        {isLive ? (
          <window.SectionCard title={t('admin_system_components')} subtitle={t('admin_system_components_sub')} noPadding>
            <window.DataTable
              columns={[
                { key:'name', label:t('admin_system_component'), render: r => <strong style={{fontFamily:'var(--font-mono)', fontSize:12}}>{r.name}</strong> },
                { key:'grade', label:t('admin_system_state'), render: r => (
                  r.isInfo
                    ? <span style={{color:'var(--color-text-tertiary)', fontSize:11}}>{t('admin_system_info')}</span>
                    : <span className={`status-pill status-pill--${r.grade === 'ok' ? 'ok' : r.grade === 'warn' ? 'warn' : 'neutral'}`}>
                        {r.grade === 'unknown' ? t('admin_system_unmeasured') : r.grade.toUpperCase()}
                      </span>
                ) },
                { key:'value', label:t('admin_system_reported'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11, color: r.grade === 'unknown' ? 'var(--color-text-tertiary)' : undefined}}>{r.value}</span>
                ) },
              ]}
              rows={liveRows}
            />
          </window.SectionCard>
        ) : (
        <window.SectionCard title={t('sys_services')} noPadding>
          <window.DataTable
            columns={[
              { key:'name', label:'Service', render: r => <strong>{r.name}</strong> },
              { key:'status', label: t('adm_col_status'), render: r => <span className={`status-pill status-pill--${r.status === 'ok' ? 'ok' : r.status === 'degraded' ? 'warn' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key:'latency', label:'Latency', align:'right', render: r => typeof r.latency === 'number' ? r.latency + 'ms' : r.latency },
              { key:'uptime', label:'Uptime · 30d', align:'right', render: r => r.uptime + '%' },
              { key:'note', label:'Note' },
              { key:'act', label:'', align:'right', render: () => <><button className="tbl-action">{t('col_logs')}</button> <button className="tbl-action" style={{marginLeft:3}}>{t('col_restart')}</button></> },
            ]}
            rows={system}
          />
        </window.SectionCard>
        )}
        {/*
           운영 오류 (관측).

           ★★ 이 목록이 없으면 오류를 서버가 모아도 아무도 보지 못한다. 알림 메일은
             '새 오류' 만 알려주므로, "지금 무엇이 몇 번 깨지고 있는가" 는 여기서 본다.
           ★ 같은 원인은 지문으로 한 줄로 묶이고 누적 횟수를 보여준다 — 폭주해도
             목록을 읽을 수 있어야 한다.
        */}
        <window.SectionCard
          title={t('ops_err_title')}
          subtitle={opsErrState === 'ok' && opsErr && opsErr.summary
            ? t('ops_err_subtitle', { d: opsErr.summary.distinct, n: opsErr.summary.total })
            : t('ops_err_subtitle_plain')}
          noPadding
        >
          {opsErrState === 'loading' && (
            <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>…</div>
          )}
          {opsErrState === 'failed' && (
            <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--color-danger, #dc2626)' }}>
              {t('ops_err_failed')}
            </div>
          )}
          {opsErrState === 'unsupported' && (
            <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
              {t('ops_err_unsupported')}
            </div>
          )}
          {opsErrState === 'ok' && opsErr && opsErr.errors.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
              {t('ops_err_none')}
            </div>
          )}
          {opsErrState === 'ok' && opsErr && opsErr.errors.length > 0 && (
            <window.DataTable
              columns={[
                { key: 'source',
                  label: t('ops_err_col_source'),
                  render: (r) => (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-elevated)' }}>
                      {r.source === 'server' ? 'API' : 'UI'}
                    </span>
                  ) },
                { key: 'message',
                  label: t('ops_err_col_message'),
                  render: (r) => (
                    <span title={r.stack || ''} style={{ fontSize: 11.5 }}>
                      {String(r.message).slice(0, 120)}
                      {r.url ? <span style={{ color: 'var(--color-text-tertiary)' }}>{' · ' + String(r.url).slice(0, 60)}</span> : null}
                    </span>
                  ) },
                { key: 'seenCount', label: t('ops_err_col_count'), align: 'right',
                  render: (r) => <span style={{ fontFamily: 'var(--font-num)' }}>{r.seenCount}</span> },
                { key: 'lastSeenAt', label: t('ops_err_col_last'), align: 'right',
                  render: (r) => <span style={{ fontFamily: 'var(--font-num)' }}>{agoText(r.lastSeenAt)}</span> },
              ]}
              rows={opsErr.errors}
            />
          )}
        </window.SectionCard>

        {/* 킬스위치 조작 — 이 화면이 없어서 비상정지를 화면에서 풀 수 없었다. */}
        {window.AdminKillSwitchPanel && <window.AdminKillSwitchPanel/>}

        {window.AdminBugReportsPanel && <window.AdminBugReportsPanel/>}
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN AUDIT LOG PAGE
  // ============================================================
  window.AdminAuditPage = function AdminAuditPage({ shellProps }) {
    const adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };
    // 실 감사 로그. 서버가 추가만 허용한다(수정·삭제 없음).
    const liveAudit = window.QTAdmin ? window.QTAdmin.getAudit() : [];
    /*
       감사 로그.

       ★★ 전에는 `(adm.isLive && liveAudit.length > 0) ? liveAudit : 목업` 이었다.

         조건에 `length > 0` 이 있어서, 실제 감사 기록이 **0건이면 목업 9건**이
         떴다(`admin_kuri / fee.update / maker 0.02→0.015` 같은 항목). 감사 로그가
         비어 있는 것은 그 자체로 사실이다 — "아직 관리 작업이 없었다". 그것을
         목업으로 채우면 운영자는 없는 행위를 있다고 판단하고, 나중에 분쟁이
         생기면 그 화면을 근거로 삼는다.

         권한이 없어 조회하지 않은 경우(`__skipped`)도 마찬가지다. 그때는
         "기록이 없다" 가 아니라 "볼 수 없다" 다.

       ★ 지금은 판정처를 하나로 둔다. 실서비스에서는 실기록만, 없으면 빈 표와
         이유. 목업은 미리보기에서만.
    */
    const mockAllowed = window.QTMockPolicy && window.QTMockPolicy.allowMockData
      ? window.QTMockPolicy.allowMockData()
      : false;
    const audit = (adm.isLive && liveAudit.length > 0)
      ? liveAudit
      : (mockAllowed ? window.QTApp.ADMIN_AUDIT : []);
    // 왜 비었는지 구분해 알린다.
    /*
       'Filter' 버튼 상태 — 실패한 동작만 보기.

       ★★ 전에는 onClick 이 없어서 눌러도 아무 일이 없었다.
       ★ 감사 로그에서 운영자가 가장 자주 찾는 것은 **실패한 관리자 동작**이다
         (권한 거부·검증 실패). ok 칼럼이 이미 있으므로 그것으로 좁힌다.
    */
    const [failOnly, setFailOnly] = useState(false);
    const auditEmptyReason = audit.length > 0 ? null
      : (adm.status && adm.status !== 'READY') ? 'adm_audit_unavailable'
      : 'adm_audit_none';

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_audit_title')}
        subtitle={t('adm_audit_subtitle')}
        breadcrumb={['Home','Admin','Audit']}
        actions={
          <>
            {/* ★ 감사 로그 CSV 내보내기. 전에는 onClick 이 없어 눌러도 아무 일이 없었다. */}
            <a
              className="btn btn--sm"
              href={window.QTApi && window.QTApi.admin && window.QTApi.admin.auditExportUrl
                ? window.QTApi.admin.auditExportUrl({ limit: 5000 })
                : '/api/admin/audit/export'}
              download
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            ><I.Camera size={13}/> {t('col_export')}</a>
            <button aria-label={failOnly ? t('adm_audit_fail_on') : t('adm_audit_fail_off')}
              className={`btn btn--sm ${failOnly ? 'btn--primary' : ''}`}
              onClick={() => setFailOnly((v) => !v)}
              title={failOnly ? t('adm_audit_fail_on') : t('adm_audit_fail_off')}
            >
              {t('notifications_f53a6e')}
            </button>
          </>
        }
      >
        {/* ★ 비어 있는 이유를 말한다 — "기록 없음" 과 "볼 수 없음" 은 다른 사실이다. */}
        {auditEmptyReason && (
          <div
            style={{
              padding:'12px 14px', marginBottom:12, borderRadius:6,
              border:'1px solid var(--color-border-subtle)', background:'var(--color-bg-surface)',
              fontSize:12, color:'var(--color-text-tertiary)', lineHeight:1.7,
            }}
          >
            {t(auditEmptyReason)}
          </div>
        )}
        <window.SectionCard title={t('sys_events')} subtitle={t('adm_audit_entries', { n: audit.length })} noPadding>
          <window.DataTable
            columns={[
              { key:'time', label: t('adm_col_time'), render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{new Date(r.time).toLocaleString('en-GB', {hour12:false})}</span> },
              { key:'actor', label: t('adm_col_actor'), render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.actor}</span> },
              { key:'action', label: t('adm_col_action'), render: r => <span style={{fontFamily:'var(--font-mono)', color:'var(--color-brand)'}}>{r.action}</span> },
              { key:'target', label: t('adm_col_target'), render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.target}</span> },
              { key:'ip', label:'IP', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>{r.ip}</span> },
              { key:'meta', label: t('adm_col_detail'), render: r => <span style={{fontSize:11, color:'var(--color-text-secondary)'}}>{r.meta || ''}</span> },
              { key:'ok', label: t('adm_col_result'), render: r => r.ok ? <span className="status-pill status-pill--ok">OK</span> : <span className="status-pill status-pill--danger">FAIL</span> },
            ]}
            rows={failOnly ? audit.filter((r) => r.ok === false || r.ok === 'false' || r.ok === 0) : audit}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN FEES / PROMOTIONS
  // ============================================================
  window.AdminFeesPage = function AdminFeesPage({ shellProps }) {
    const tiers = window.QTApp.FEE_TIERS;
    const promos = window.QTApp.PROMOTIONS;

    /*
       수수료 · 프로모션 (관리자).

       원래 화면은 우리가 수수료를 정하는 거래소를 전제로 했다:
         · 자체 등급표(Maker 0.015% …) — 우리가 정하는 값이 아니다.
         · 'Token Hold Req. … QT' — 우리 토큰이 없다.
         · 프로모션 지급액 — 지급 수단이 없다.

       실제 구조
       --------
       수수료는 **거래소가** 고객 계정 등급에 따라 매긴다. 우리는 주문을
       전달할 뿐이고 별도 수수료를 받지 않는다. 우리 수익은 브로커 리베이트와
       추천 가입이며, 둘 다 거래소가 정산한다.

       그래서 여기서 보여줄 것은 '우리가 정한 등급표' 가 아니라
       '거래소 실제 수수료율' 과 '리베이트 설정 상태' 다.
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    const isLive = backend !== false;

    // 거래소 실제 수수료율.
    const [specs, setSpecs] = useState(null);
    // 브로커 리베이트 설정 상태. configured=false 는 장애가 아니라 사실이다.
    const [rebate, setRebate] = useState(null);
    /** KuCoin 브로커 정산 (커미션). 실제 수익 값이다. */
    const [kcBroker, setKcBroker] = useState(null);
    const cfg = (window.QTApi && window.QTApi.useConfig) ? window.QTApi.useConfig() : null;

    useEffect(() => {
      if (!isLive || !window.QTApi) return undefined;
      let cancelled = false;
      if (window.QTApi.rest && window.QTApi.rest.contractSpecs) {
        window.QTApi.rest.contractSpecs(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'])
          .then((r) => { if (!cancelled) setSpecs(r.data || []); })
          .catch(() => { /* 조회 실패 시 표를 숨긴다 */ });
      }
      if (window.QTApi.admin && window.QTApi.admin.brokerRebates) {
        window.QTApi.admin.brokerRebates()
          .then((r) => { if (!cancelled) setRebate(r); })
          .catch(() => { if (!cancelled) setRebate({ configured: false, data: [] }); });
      }
      /*
         KuCoin 브로커 정산.

         ★★ 이것이 **우리 수익의 실제 값**이다. 앞의 `brokerRebates` 는 BitMart
           시절 경로이고, 이 배포는 KuCoin 을 쓴다.

         ★ 세 상태를 구분해 보여준다:
             configured:false     운영자 키 미설정 — 수익 0원이 아니라 '모른다'
             approved:false       키는 있으나 브로커 승인 전
             brokerAttached:false 승인됐지만 서명 헤더가 없어 앞으로도 집계 안 됨
      */
      if (window.QTApi.admin && window.QTApi.admin.brokerCommission) {
        window.QTApi.admin.brokerCommission({ pageSize: 12 })
          .then((r) => { if (!cancelled) setKcBroker(r); })
          .catch(() => { /* 조회 실패를 '수익 0' 으로 위장하지 않는다 (null 유지) */ });
      }
      return () => { cancelled = true; };
    }, [isLive]);

    const pct = (v) => (v == null ? null : (v * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%');
    const referrals = (cfg && cfg.exchangeReferralUrls) || {};
    const referralCount = Object.keys(referrals).length;

    if (isLive) {
      return (
        <window.PageShell
          {...shellProps}
          title={t('admin_fees_title')}
          subtitle={t('admin_fees_subtitle')}
          breadcrumb={['Home','Admin','Fees']}
        >
          {/*
             ★★ 우리 수익을 가장 먼저 보여준다.

               브로커 커미션이 이 서비스의 수익이다. 그 값이 화면 아래쪽에
               묻혀 있으면 운영자가 "리베이트가 0원" 인 상태를 몇 주 동안
               모른 채 지날 수 있다.
          */}
          {(() => {
            if (!kcBroker) return null;

            // ① 운영자 키가 없다 — 수익이 0 인 것이 아니라 조회할 수 없는 것이다.
            if (!kcBroker.configured) {
              return (
                <div style={{padding:'13px 15px', borderRadius:7, fontSize:12.5, lineHeight:1.85,
                  background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)'}}>
                  <div style={{fontWeight:600, marginBottom:4}}>{t('kcb_not_configured')}</div>
                  <div style={{color:'var(--color-text-secondary)'}}>{t('kcb_not_configured_why')}</div>
                </div>
              );
            }

            // ② 키는 있으나 브로커로 승인되지 않았다.
            if (!kcBroker.approved) {
              return (
                <div style={{padding:'13px 15px', borderRadius:7, fontSize:12.5, lineHeight:1.85,
                  background:'color-mix(in srgb, var(--color-warning, #d97706) 10%, transparent)',
                  border:'1px solid var(--color-warning, #d97706)'}}>
                  <div style={{fontWeight:600, marginBottom:4}}>{t('kcb_not_approved')}</div>
                  <div style={{color:'var(--color-text-secondary)'}}>{t('kcb_not_approved_why')}</div>
                  {kcBroker.error && kcBroker.error.message && (
                    <div style={{marginTop:8, fontSize:11.5, fontFamily:'var(--font-mono)', color:'var(--color-text-tertiary)'}}>
                      {String(kcBroker.error.code || '')} {String(kcBroker.error.message).slice(0, 140)}
                    </div>
                  )}
                </div>
              );
            }

            /*
               ③ 승인됐다. 합계를 낸다.

               ★ 태그 있음(우리 실적)과 없음을 따로 합산한다. 합쳐서 하나로
                 보여주면 "서명이 새고 있다" 는 사실이 가려진다.
            */
            const sum = (key) => kcBroker.items.reduce((acc, x) => {
              const n = Number(x[key]);
              return Number.isFinite(n) ? acc + n : acc;
            }, 0);
            const tagged = sum('tagCommission');
            const untagged = sum('noTagCommission');
            const cur = (kcBroker.items[0] && kcBroker.items[0].currency) || 'USDT';

            return (
              <>
                {/* 서명 헤더가 없으면 앞으로의 거래도 집계되지 않는다 — 가장 시급한 경고다. */}
                {!kcBroker.brokerAttached && (
                  <div style={{padding:'12px 14px', borderRadius:7, fontSize:12.5, lineHeight:1.8,
                    background:'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                    border:'1px solid var(--color-danger)', color:'var(--color-danger)'}}>
                    <strong>{t('kcb_no_headers')}</strong>
                    <div>{t('kcb_no_headers_why')}</div>
                  </div>
                )}
                <div className="grid-4">
                  <window.KPICard
                    label={t('kcb_tag_commission')}
                    value={fmt(tagged, 4) + ' ' + cur}
                    sub={t('kcb_tag_commission_sub')}
                    tone="long" icon="Wallet"
                  />
                  <window.KPICard
                    label={t('kcb_notag_commission')}
                    value={fmt(untagged, 4) + ' ' + cur}
                    sub={t('kcb_notag_commission_sub')}
                    tone={untagged > 0 ? 'short' : undefined}
                  />
                  <window.KPICard
                    label={t('kcb_periods')}
                    value={fmt(kcBroker.totalNum, 0)}
                    sub={t('kcb_periods_sub')}
                  />
                  <window.KPICard
                    label={t('kcb_headers')}
                    value={kcBroker.brokerAttached ? t('admin_on') : t('admin_off')}
                    sub={t('kcb_headers_sub')}
                    tone={kcBroker.brokerAttached ? 'long' : 'short'}
                  />
                </div>

                {kcBroker.items.length > 0 && (
                  <window.SectionCard title={t('kcb_settlements')} subtitle={t('kcb_settlements_sub')} noPadding>
                    <window.DataTable columns={[
                      { key:'period', label:t('kcb_period'), render: r => (
                        <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>
                          {r.periodStartTime ? new Date(r.periodStartTime).toISOString().slice(0,10) : '\u2014'}
                        </span>
                      ) },
                      { key:'site', label:t('kcb_site'), render: r => r.siteType || '\u2014' },
                      { key:'users', label:t('kcb_traders'), align:'right', render: r => r.totalTradeUser || '\u2014' },
                      { key:'tagVol', label:t('kcb_tag_volume'), align:'right', render: r => r.tagTradeVolume || '\u2014' },
                      { key:'tagCom', label:t('kcb_tag_com'), align:'right', render: r => (
                        <strong style={{fontFamily:'var(--font-num)', color:'var(--color-success)'}}>{r.tagCommission || '\u2014'}</strong>
                      ) },
                      { key:'noTagCom', label:t('kcb_notag_com'), align:'right', render: r => (
                        <span style={{fontFamily:'var(--font-num)', color:'var(--color-text-tertiary)'}}>{r.noTagCommission || '\u2014'}</span>
                      ) },
                      { key:'paid', label:t('kcb_paid'), render: r => (
                        r.payoutTime ? new Date(r.payoutTime).toLocaleDateString() : t('kcb_not_paid')
                      ) },
                    ]} rows={kcBroker.items}/>
                  </window.SectionCard>
                )}
              </>
            );
          })()}

          {/* 구조적 사실을 먼저 놓는다. */}
          <div style={{
            padding:'14px 16px', borderRadius:6, fontSize:12.5, lineHeight:1.8,
            background:'color-mix(in srgb, var(--color-brand) 8%, transparent)',
            border:'1px solid var(--color-brand)',
          }}>
            <div style={{fontWeight:600, marginBottom:6}}>{t('admin_fees_who_title')}</div>
            <div>{t('admin_fees_who_1')}</div>
            <div style={{marginTop:6}}>{t('admin_fees_who_2')}</div>
          </div>

          <div className="grid-3">
            {/* 브로커 리베이트 — 설정되지 않았으면 그대로 말한다. */}
            <window.KPICard
              label={t('admin_fees_broker')}
              value={rebate === null ? '—' : (rebate.configured ? t('admin_fees_configured') : t('admin_fees_not_configured'))}
              sub={rebate && !rebate.configured ? t('admin_fees_broker_sub') : undefined}
              tone={rebate && rebate.configured ? 'success' : 'warning'}
            />
            <window.KPICard
              label={t('admin_fees_referral')}
              value={referralCount || '—'}
              sub={referralCount ? Object.keys(referrals).join(', ') : t('admin_fees_referral_none')}
              tone={referralCount ? 'success' : 'warning'}
            />
            <window.KPICard
              label={t('admin_fees_our_cut')}
              value={t('admin_fees_zero')}
              sub={t('admin_fees_our_cut_sub')}
            />
          </div>

          {/* 거래소 실제 수수료율 */}
          {specs && specs.length > 0 && (
            <window.SectionCard title={t('admin_fees_exchange_rates')} subtitle={t('admin_fees_exchange_rates_sub')} noPadding>
              <window.DataTable
                columns={[
                  { key:'symbol', label: t('adm_col_symbol'), render: r => <strong>{r.symbol.replace('USDT','/USDT')}</strong> },
                  { key:'maker', label:'Maker', align:'right', render: r => pct(r.makerFeeRate) || '—' },
                  { key:'taker', label:'Taker', align:'right', render: r => pct(r.takerFeeRate) || '—' },
                  { key:'funding', label:t('fee_funding_8h'), align:'right', render: r => pct(r.fundingFeeRate) || '—' },
                  { key:'mm', label:t('fee_maint_margin'), align:'right', render: r => pct(r.maintenanceMarginRate) || '—' },
                  { key:'lev', label:'Max Lev', align:'right', render: r => (r.maxLeverage ? r.maxLeverage + '×' : '—') },
                ]}
                rows={specs}
              />
            </window.SectionCard>
          )}

          {/*
             프로모션.

             지급 수단이 없다 — 우리는 자금을 보관하지 않으므로 사용자에게
             직접 지급할 경로가 없다. 프로모션 표를 목업으로 보여주면 운영자가
             "이미 지급되고 있다" 고 오해한다.
          */}
          <window.SectionCard title={t('admin_fees_promos')} subtitle={t('admin_fees_promos_sub')}>
            <div style={{fontSize:12, lineHeight:1.8, color:'var(--color-text-secondary)'}}>
              <div>{t('admin_fees_promos_1')}</div>
              <div style={{marginTop:6, color:'var(--color-text-tertiary)'}}>{t('admin_fees_promos_2')}</div>
            </div>
          </window.SectionCard>
        </window.PageShell>
      );
    }

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_fees_title')}
        subtitle={t('admin_fees_65feac')}
        breadcrumb={['Home','Admin','Fees']}
        actions={<button className="btn btn--sm btn--primary"><I.Plus size={13}/> {t('fee_new_promo')}</button>}
      >
        <window.SectionCard title={t('fee_tiers_title')} subtitle="Maker / Taker · Volume-based" noPadding>
          <window.DataTable
            columns={[
              { key:'tier', label: t('col_tier'), render: r => <strong>{r.tier}</strong> },
              { key:'maker', label:'Maker', align:'right', render: r => (r.maker*100).toFixed(3) + '%' },
              { key:'taker', label:'Taker', align:'right', render: r => (r.taker*100).toFixed(3) + '%' },
              { key:'vol', label: t('adm_col_vol30_req'), align:'right', render: r => '$' + fmtCompact(r.vol30Req) },
              { key:'hold', label:'Token Hold Req.', align:'right', render: r => r.holdReq + ' QT' },
              { key:'act', label:'', align:'right', render: () => <button className="tbl-action">{t('col_edit')}</button> },
            ]}
            rows={tiers}
          />
        </window.SectionCard>

        <window.SectionCard title={t('fee_active_promos')} noPadding>
          <window.DataTable
            columns={[
              { key:'id', label:'ID', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.id}</span> },
              { key:'name', label:'Name', render: r => <strong>{r.name}</strong> },
              { key:'period', label:'Period' },
              { key:'status', label: t('adm_col_status'), render: r => <span className={`status-pill status-pill--${r.status === 'active' ? 'ok' : 'neutral'}`}>{r.status.toUpperCase()}</span> },
              { key:'payout', label:'Payout · 30d', align:'right', render: r => '$' + fmtCompact(r.payout) },
              { key:'act', label:'', align:'right', render: () => <><button className="tbl-action">{t('col_report')}</button> <button className="tbl-action" style={{marginLeft:3}}>{t('col_edit')}</button></> },
            ]}
            rows={promos}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN NOTICES & CS PAGE
  // ============================================================
  window.AdminNoticesPage = function AdminNoticesPage({ shellProps }) {
    /*
       CS 티켓 요약.

       목업 배열(usr_00005 등)이었다. 실제 티켓 시스템이 있으므로 그것을 쓴다 —
       목업을 남겨두면 운영자가 존재하지 않는 문의를 처리하려 한다.
    */
    const [liveCs, setLiveCs] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.tickets) return undefined;
      let cancelled = false;
      api.tickets({ limit: 20 })
        .then((r) => { if (!cancelled) setLiveCs(r.data || []); })
        .catch(() => { /* 실패 시 목업 유지 */ });
      return () => { cancelled = true; };
    }, []);

    const csIsLive = Array.isArray(liveCs);
    const cs = csIsLive
      ? liveCs.map((x) => ({
          id: x.id,
          // 이메일이 사용자 식별자다. 목업의 usr_00005 같은 ID 는 우리에게 없다.
          user: x.userEmail || x.userId || '—',
          subject: x.subject,
          status: x.status,
          priority: x.priority,
          updated: x.updatedAt,
        }))
      /*
         ★★ 조회 실패 시 목업으로 되돌리지 않는다.

           전에는 `: window.QTApp.CS_TICKETS` 였다. 목업 티켓
           (`cs-001 / usr_00005 / KYC 승인 대기`)이 실제 문의처럼 떴고,
           운영자는 없는 문의에 답하려 하거나 **실제로 들어온 문의를 이미
           처리한 것으로 착각**한다. 고객 문의는 답이 늦으면 그대로 손해다.

           바로 아래 공지 쪽 주석에는 "실패하면 목업으로 되돌리지 않는다" 고
           적혀 있었는데 코드는 되돌리고 있었다. 주석과 코드가 어긋난 상태였다.
      */
      : (window.QTMockPolicy && window.QTMockPolicy.pick
          ? (window.QTMockPolicy.pick(null, window.QTApp.CS_TICKETS) || [])
          : []);

    /*
       공지 목록 (실데이터).

       초안·게시·보관 전부 가져온다. 관리자는 아직 안 나간 초안도 봐야 한다.
       실패하면 목업으로 되돌리지 않는다 — 조회 실패를 빈 목록으로 위장하면
       "공지가 없다" 로 읽히고 관리자가 같은 공지를 또 쓴다.
    */
    const [live, setLive] = useState(null);
    const [err, setErr] = useState(null);
    const [busyId, setBusyId] = useState(null);

    /*
       공지 쓰기 권한. ops 는 목록을 읽을 수 있지만 게시·내림은 못 한다
       (실측: ops 로 POST /api/admin/notices = 403).
       버튼을 보여주고 403 을 받게 하면 "고장" 으로 오해한다.
    */
    const canWriteNotice = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.notice.write'));

    const load = React.useCallback(() => {
      if (!window.QTApi || !window.QTApi.admin || !window.QTApi.admin.notices) return;
      window.QTApi.admin.notices(100)
        .then((r) => { setLive(r.data || []); setErr(null); })
        .catch((e) => setErr((e && e.message) || 'load failed'));
    }, []);
    useEffect(() => { load(); }, [load]);

    // 게시 / 내림 / 보관. 끝나면 목록을 다시 읽어 화면과 서버를 일치시킨다.
    const act = async (id, kind) => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api) return;
      setBusyId(id);
      try {
        if (kind === 'publish') await api.publishNotice(id);
        else if (kind === 'unpublish') await api.unpublishNotice(id);
        else await api.archiveNotice(id);
        load();
      } catch (e) {
        setErr((e && e.message) || 'action failed');
      }
      setBusyId(null);
    };

    const isLive = Array.isArray(live);
    const notices = isLive
      ? live.map((n) => ({
          id: n.id,
          title: n.title,
          status: n.status,
          pinned: n.pinned,
          // 게시 안 된 공지는 게시 시각이 없다. 0 이나 '-' 로 채우지 않는다.
          published: n.publishedAt ? new Date(n.publishedAt).toLocaleString() : '—',
          locale: n.locale,
          expiresAt: n.expiresAt,
        }))
      /*
         ★ 위 주석대로 목업으로 되돌리지 않는다(전에는 되돌렸다).
           목업 공지(`nt-42 정기 점검 안내`)가 보이면 관리자는 이미 공지한
           것으로 알고 실제 공지를 쓰지 않는다.
      */
      : (window.QTMockPolicy && window.QTMockPolicy.pick
          ? (window.QTMockPolicy.pick(null, window.QTApp.NOTICES) || [])
          : []);

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_notices_title')}
        subtitle={t('admin_notices_11300f')}
        breadcrumb={['Home','Admin','Notices & CS']}
        actions={canWriteNotice
          ? <button className="btn btn--sm btn--primary" onClick={() => { window.location.hash = '#/admin/notices/new'; }}><I.Plus size={13}/> {t('notice_new')}</button>
          : null}
      >
        <div className="grid-2">
          <window.SectionCard
            title={t('admin_notices_15d236')}
            subtitle={err ? t('notice_load_failed') : `${notices.filter(n => n.pinned).length} pinned · ${notices.length} total`}
            noPadding
          >
            {isLive && notices.length === 0 && (
              <div style={{padding:'20px 16px', fontSize:12, color:'var(--color-text-tertiary)'}}>{t('notice_empty')}</div>
            )}
            {notices.map(n => (
              <div key={n.id} style={{display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom:'1px solid var(--color-border-subtle)'}}>
                {n.pinned && <I.Star size={12} style={{color:'var(--color-warning)'}}/>}
                <div style={{flex:1}}>
                  <div style={{fontSize:13, fontWeight:500}}>{n.title}</div>
                  <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', marginTop:2}}>{n.id} · {n.published}</div>
                </div>
                <span className={`status-pill status-pill--${n.status === 'published' ? 'ok' : n.status === 'archived' ? 'neutral' : 'warn'}`}>{n.status.toUpperCase()}</span>
                {/*
                  실데이터일 때만 동작 버튼을 준다. 목업 행에 버튼을 달면
                  눌렀을 때 아무 일도 안 일어나 관리자가 고장으로 오해한다.
                */}
                {isLive && canWriteNotice ? (
                  <div style={{display:'flex', gap:6}}>
                    {n.status !== 'published' && (
                      <button className="tbl-action" disabled={busyId === n.id} onClick={() => act(n.id, 'publish')}>
                        {busyId === n.id ? '…' : t('notice_action_publish')}
                      </button>
                    )}
                    {n.status === 'published' && (
                      <button className="tbl-action" disabled={busyId === n.id} onClick={() => act(n.id, 'unpublish')}>
                        {busyId === n.id ? '…' : t('notice_action_unpublish')}
                      </button>
                    )}
                    {n.status !== 'archived' && (
                      <button className="tbl-action" disabled={busyId === n.id} onClick={() => act(n.id, 'archive')}>
                        {t('notice_action_archive')}
                      </button>
                    )}
                  </div>
                ) : (
                  <button className="tbl-action">{t('col_edit')}</button>
                )}
              </div>
            ))}
          </window.SectionCard>

          <window.SectionCard
            title={t('admin_cs_title')}
            subtitle={`${cs.filter(x => x.status !== 'resolved').length} open`}
            actions={csIsLive ? <a className="btn btn--sm" href="#/admin/cs" style={{textDecoration:'none'}}>{t('help_col_open')}</a> : undefined}
            noPadding
          >
            {csIsLive && cs.length === 0 && (
              <div style={{padding:'18px 16px', fontSize:12, color:'var(--color-text-tertiary)'}}>{t('adm_no_tickets')}</div>
            )}
            {cs.map(t => (
              <div key={t.id} style={{padding:'12px 16px', borderBottom:'1px solid var(--color-border-subtle)'}}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                  <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{t.id}</span>
                  <span className={`severity-pill severity-pill--${t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : 'low'}`}>{t.priority.toUpperCase()}</span>
                  <span className={`status-pill status-pill--${t.status === 'open' ? 'warn' : t.status === 'pending' ? 'neutral' : 'ok'}`}>{t.status.toUpperCase()}</span>
                  <span style={{marginLeft:'auto', fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{timeAgo(t.updated)}</span>
                </div>
                <div style={{fontSize:12, fontWeight:500}}>{t.subject}</div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', marginTop:2}}>User · {t.user}</div>
              </div>
            ))}
          </window.SectionCard>
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // Scaffolded admin pages — Risk / Assets
  // ============================================================
  window.AdminRiskPage = function AdminRiskPage({ shellProps }) {
    /*
       위험 관리 (실데이터).

       출처: /api/admin/positions — 전체 포지션(읽기 전용).
       마진율·청산거리를 포지션에서 계산한다. 서버가 그 값을 주지 않으므로
       우리가 계산해야 하는데, **계산할 수 없으면 '—' 로 둔다**. 임의 공식으로
       채우면 운영자가 근거 없는 숫자로 강제청산을 판단한다.

       ★ 서버는 포지션 변경을 허용하지 않는다(note: 'no close, leverage or
         margin-mode change'). 'Force Close' 버튼은 배선할 대상이 없다.
         비수탁이므로 우리가 고객 포지션을 닫는 것은 설계상 불가능하다 —
         할 수 있는 것은 사용자에게 알리는 것뿐이다.
    */
    /*
       관리자 데이터 구독.

       킬스위치는 QTAdmin 이 폴링해서 채운다. 이 훅이 없으면 데이터가 도착해도
       재렌더되지 않아 '0개' 로 고정된다(실제로 겪음).
    */
    const _adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };

    const [live, setLive] = useState(null);
    const [meta, setMeta] = useState({ readOnly: false, note: '' });
    const [err, setErr] = useState(null);

    const load = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.positions) return;
      api.positions({ limit: 200 })
        .then((r) => { setLive(r.data || []); setMeta({ readOnly: r.readOnly, note: r.note }); setErr(null); })
        .catch((e) => setErr((e && e.message) || 'load failed'));
    }, []);
    useEffect(() => { load(); }, [load]);

    // 킬스위치는 폴링 결과에서 직접 읽는다 — adm.version 이 바뀌면 재렌더된다.
    const switches = window.QTAdmin ? window.QTAdmin.getKillSwitches() : null;

    const isLive = Array.isArray(live);

    const toRow = (pos) => {
      const size = Number(pos.quantity !== undefined ? pos.quantity : pos.size);
      const _entry = Number(pos.entryPrice);
      const mark = Number(pos.markPrice);
      const liq = Number(pos.liquidationPrice);
      const margin = Number(pos.margin !== undefined ? pos.margin : pos.initialMargin);
      const notional = Number.isFinite(mark) && Number.isFinite(size) ? Math.abs(mark * size) : undefined;

      /*
         마진율 = 증거금 / 명목가치. 둘 중 하나라도 없으면 계산하지 않는다.
         청산거리 = |청산가 - 마크가| / 마크가. 청산가가 없으면 계산하지 않는다.
      */
      const marginRatio = (Number.isFinite(margin) && notional && notional > 0) ? margin / notional : undefined;
      const liqDist = (Number.isFinite(liq) && liq > 0 && Number.isFinite(mark) && mark > 0)
        ? Math.abs(liq - mark) / mark * 100 : undefined;

      /*
         심각도는 청산거리로만 판정한다. 청산거리를 모르면 심각도도 모른다 —
         'low' 로 채우면 위험한 포지션이 안전해 보인다.
         기준은 QTRisk 와 같게 유지한다(5% 위험 / 12% 주의). 두 곳에서 다른
         기준을 쓰면 사용자 경고와 운영자 화면이 어긋난다.
      */
      const severity = liqDist === undefined ? 'unknown'
        : liqDist < 3 ? 'critical'
        : liqDist < 5 ? 'high'
        : liqDist < 12 ? 'medium' : 'low';

      return {
        severity: severity,
        userId: pos.userId || pos.accountId || '—',
        sym: pos.symbol ? String(pos.symbol).replace(/USDT$/, '/USDT') : '—',
        side: pos.side ? String(pos.side).toLowerCase() : '—',
        size: Number.isFinite(size) ? Math.abs(size) : undefined,
        marginRatio: marginRatio,
        liqDist: liqDist,
        notional: notional,
      };
    };

    /*
       ★ 위험 대기열도 같다. 없는 경보(marginRatio 0.94 critical)를 보여주면
         실제 위험을 그 사이에 놓친다. 실서비스는 빈 목록.
    */
    const risk = isLive
      ? live.map(toRow)
      : (window.QTMockPolicy && window.QTMockPolicy.pick
          ? (window.QTMockPolicy.pick(null, window.QTApp.ADMIN_RISK_QUEUE) || [])
          : []);

    /*
       롱/숏 노출.

       명목가치를 아는 포지션만으로 계산한다. 하나도 없으면 '—' 다.
       '58% / 42% · Balanced' 처럼 고정값을 보여주면 운영자가 실제로 한쪽으로
       쏠린 상태를 알아채지 못한다.
    */
    const exposure = (() => {
      if (!isLive) return null;
      const withN = risk.filter((r) => typeof r.notional === 'number' && r.notional > 0);
      if (!withN.length) return { known: false };
      const long = withN.filter((r) => r.side === 'long' || r.side === 'buy').reduce((a, r) => a + r.notional, 0);
      const short = withN.filter((r) => r.side === 'short' || r.side === 'sell').reduce((a, r) => a + r.notional, 0);
      const total = long + short;
      if (total <= 0) return { known: false };
      return { known: true, longPct: long / total * 100, shortPct: short / total * 100 };
    })();

    const activeSwitches = Array.isArray(switches) ? switches.filter((k) => k.enabled || k.active || k.engaged).length : null;

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_risk_title')}
        subtitle={t('admin_risk_a1edf2')}
        breadcrumb={['Home','Admin','Risk']}
      >
        <div className="grid-4">
          <window.KPICard label={t('adm_kpi_critical_high')} value={risk.filter(r => r.severity === 'critical' || r.severity === 'high').length} tone="danger"/>
          <window.KPICard
            label={isLive ? t('admin_risk_positions') : 'Total in Queue'}
            value={risk.length}
            sub={isLive ? t('admin_risk_positions_sub') : undefined}
          />
          {/*
             자동청산 건수는 우리가 집계하지 않는다. 청산은 거래소가 하고
             우리에게 통지되지 않는다 — 12 라는 숫자는 근거가 없었다.
             그 자리에 우리가 실제로 아는 것(활성 킬스위치)을 넣는다.
          */}
          <window.KPICard
            label={isLive ? t('admin_risk_killswitch') : 'Auto-liquidations · 24h'}
            value={isLive ? (activeSwitches === null ? '—' : activeSwitches) : '12'}
            sub={isLive && Array.isArray(switches) ? t('admin_risk_killswitch_sub', { total: switches.length }) : undefined}
            tone={isLive && activeSwitches ? 'danger' : undefined}
          />
          <window.KPICard
            label={t('adm_kpi_exposure')}
            value={!isLive ? '58% / 42%'
              : (exposure && exposure.known ? `${exposure.longPct.toFixed(0)}% / ${exposure.shortPct.toFixed(0)}%` : '—')}
            sub={!isLive ? 'Balanced' : (exposure && exposure.known ? undefined : t('admin_risk_no_exposure'))}
          />
        </div>
        <window.SectionCard title={t('nav_risk_queue')} noPadding>
          <window.DataTable
            columns={[
              { key:'sev', label: t('adm_col_severity'), render: r => <span className={`severity-pill severity-pill--${r.severity}`}>{r.severity.toUpperCase()}</span> },
              { key:'user', label: t('adm_col_user'), render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.userId}</span> },
              { key:'sym', label: t('adm_col_symbol'), render: r => <strong>{r.sym}</strong> },
              { key:'side', label: t('adm_col_side'), render: r => <span className={r.side==='long'?'t-long':'t-short'}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key:'size', label: t('adm_col_size'), align:'right', render: r => fmt(r.size, 3) },
              { key:'mr', label: t('adm_col_margin_ratio'), align:'right', render: r => (typeof r.marginRatio === 'number' ? (r.marginRatio*100).toFixed(0) + '%' : '—') },
              { key:'liq', label: t('adm_col_liq_distance'), align:'right', render: r => (
                typeof r.liqDist === 'number'
                  ? <span className={r.liqDist < 5 ? 't-short' : ''}>{r.liqDist.toFixed(1)}%</span>
                  : <span style={{color:'var(--color-text-tertiary)'}}>—</span>
              ) },
              /*
                 동작 버튼.

                 'Force Close' 는 배선할 대상이 없다 — 서버가 포지션 변경을
                 허용하지 않고(read-only), 비수탁이므로 우리가 고객 포지션을
                 닫는 것은 설계상 불가능하다. 실데이터에서는 감춘다.
                 사용자에게 알리는 것은 가능하지만 서버 알림 생성 API 가 아직
                 없다 — 있는 척하지 않고 사용자 상세로 보낸다.
              */
              { key:'act', label:'', align:'right', render: r => (
                isLive
                  ? (r.userId && r.userId !== '—'
                      ? <button className="tbl-action" onClick={() => { window.location.hash = '#/admin/users/detail?id=' + encodeURIComponent(r.userId); }}>{t('admin_risk_view_user')}</button>
                      : <span style={{color:'var(--color-text-tertiary)'}}>—</span>)
                  : <><button className="tbl-action">{t('col_notify')}</button> <button className="tbl-action" style={{marginLeft:3}}>{t('risk_force_close')}</button></>
              ) },
            ]}
            rows={risk}
          />

          {isLive && risk.length === 0 && (
            <div style={{padding:'18px 16px', fontSize:12, lineHeight:1.8, color:'var(--color-text-tertiary)'}}>
              <div>{t('admin_risk_empty')}</div>
              <div style={{marginTop:4}}>{t('admin_trades_scope')}</div>
            </div>
          )}
          {isLive && meta.readOnly && (
            <div style={{padding:'10px 16px', borderTop:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)'}}>
              {t('admin_risk_readonly')}{meta.note ? ` · ${serverNote(meta.note)}` : ''}
            </div>
          )}
          {err && <div style={{padding:'10px 16px', fontSize:11, color:'var(--color-danger)'}}>{t('admin_load_failed')} · {err}</div>}
        </window.SectionCard>
      </window.PageShell>
    );
  };

  window.AdminAssetsPage = function AdminAssetsPage({ shellProps }) {
    /*
       자산 · 출금 (관리자).

       원래 이 화면은 "핫/콜드 지갑 잔고", "온체인 확인 상태", "출금 승인 큐"
       를 만들 예정(TODO)으로 적어두고 있었다. 그것은 **수탁 거래소의 구조**다.

       우리 구조에서는 그 기능이 생기지 않는다:
         · 고객 자금은 고객의 거래소 계정에 있다. 우리 지갑이 없다.
         · 우리는 온체인 전송을 하지 않는다. 확인할 트랜잭션이 없다.
         · 출금은 거래소에서 일어난다. 우리가 승인할 대상이 없다.
         · 우리가 요구하는 API 키에는 출금 권한이 없다(일부러).

       "곧 만들 예정" 으로 남겨두면 운영자가 출금 승인 화면을 기다리고,
       고객 문의에 "승인 대기 중" 이라고 잘못 답한다. 사실을 적는다.

       대신 우리가 **실제로 아는 것**을 보여준다: 사용자·세션 집계.
    */
    const adm = window.useAdminData ? window.useAdminData() : { status: 'OFFLINE', isLive: false };
    const [sec, setSec] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.securitySummary) return undefined;
      let cancelled = false;
      api.securitySummary()
        .then((r) => { if (!cancelled) setSec(r.data || null); })
        .catch(() => { /* 조회 실패 시 집계를 숨긴다 — 0 으로 위장하지 않는다 */ });
      return () => { cancelled = true; };
    }, [adm.version]);

    const users = sec && sec.users;
    const sessions = sec && sec.sessions;

    return (
      <window.PageShell {...shellProps} title={t('adm_assets_withdrawals')} subtitle={t('admin_assets_subtitle')} breadcrumb={['Home','Admin','Assets']}>
        {/* 구조적 사실. 미구현이 아니라 설계상 존재하지 않는다. */}
        <div style={{
          padding:'14px 16px', borderRadius:6, fontSize:12.5, lineHeight:1.8,
          background:'color-mix(in srgb, var(--color-brand) 8%, transparent)',
          border:'1px solid var(--color-brand)',
        }}>
          <div style={{fontWeight:600, marginBottom:6, display:'flex', alignItems:'center', gap:6}}>
            <I.Lock size={13}/> {t('admin_assets_noncustodial_title')}
          </div>
          <div>{t('admin_assets_noncustodial_1')}</div>
          <ul style={{margin:'8px 0 0', paddingLeft:20}}>
            <li>{t('admin_assets_point_1')}</li>
            <li>{t('admin_assets_point_2')}</li>
            <li>{t('admin_assets_point_3')}</li>
            <li>{t('admin_assets_point_4')}</li>
          </ul>
        </div>

        {/* 우리가 실제로 집계할 수 있는 것 */}
        <div className="grid-4">
          <window.KPICard label={t('admin_assets_custody')} value={t('admin_assets_none')} sub={t('admin_assets_custody_sub')} tone="brand"/>
          <window.KPICard label={t('admin_assets_users')} value={users ? users.total : '—'} sub={users ? t('admin_assets_users_sub', { active: users.active, disabled: users.disabled }) : undefined}/>
          <window.KPICard label={t('admin_assets_sessions')} value={sessions ? sessions.active : '—'} sub={sessions ? t('admin_assets_sessions_sub', { n: sessions.distinctUsers }) : undefined}/>
          <window.KPICard label={t('admin_assets_withdrawal_queue')} value={t('admin_assets_na')} sub={t('admin_assets_withdrawal_sub')}/>
        </div>
      </window.PageShell>
    );
  };
  /* 서버 열거값 → 사전 키. 코드에 문구를 박으면 번역되지 않는다. */
  const REASON_KEY_ADMIN = {
    referral_signup: 'pt_reason_referral', event_reward: 'pt_reason_event',
    competition_prize: 'pt_reason_prize', admin_grant: 'pt_reason_grant',
    admin_revoke: 'pt_reason_revoke', purchase: 'pt_reason_purchase',
    redeem: 'pt_reason_redeem', refund: 'pt_reason_refund', expiry: 'pt_reason_expiry',
  };

  // ============================================================
  // 포인트 (운영)
  //
  // ★★ 이 화면의 첫 숫자는 '미사용 포인트' 다 — 그것이 **부채**다.
  //
  //   사용자가 가진 포인트만큼 우리가 가치를 제공할 의무가 있다. 적립만
  //   늘리고 이 값을 보지 않으면 감당할 수 없는 의무가 쌓인다. 그래서
  //   '총 적립' 이 아니라 '미사용' 을 먼저 보여준다.
  //
  // ★ 원장 정합성을 함께 보여준다. 위반이 0 이 아니면 동시성 결함이 있다는
  //   뜻이고, 그때는 적립·사용을 멈추고 원인을 찾아야 한다.
  // ============================================================
  window.AdminPointsPage = function AdminPointsPage({ shellProps }) {
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [adj, setAdj] = useState({ userId: '', amount: '', direction: 'grant', memo: '' });

    const load = React.useCallback(() => {
      const A = window.QTApi && window.QTApi.admin;
      if (!A || !A.points) return;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return;
      A.points().then(r => { setD(r); setErr(null); }).catch(e => setErr((e && e.message) || 'load failed'));
    }, []);
    useEffect(() => { load(); }, [load]);

    /*
       버튼 표시는 **서버가 준 실제 권한 목록**으로 판단한다 (등급 이름 아님).
       QTAdmin 이 /api/admin/me 결과를 들고 있는 단일 출처다 — 다른 관리자
       화면과 같은 방식을 쓴다.
    */
    const canWrite = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.points.write'));
    const live = Boolean(d && d.supported);
    const st = d && d.settings;
    /*
       포인트 단위명.

       ★★ 저장할 때 이 값을 그대로 보내면 안 된다.

         `st.unitName || t('pt_unit_default')` 로 표시용 값을 만든 뒤, 아래
         toggle() 이 그것을 `unitName` 으로 저장했다. 그래서 관리자가 다른
         설정(활성 여부·만료일)만 바꾸려고 눌러도 **현재 화면 언어의 기본어가
         DB 에 박혔다.** 한국어 화면에서 저장하면 '포인트' 가 저장되고, 그
         뒤로는 영어·일본어 화면에서도 '포인트' 로 보인다(실제로 그 상태였다).

       ★ DB 값이 비어 있으면 각 화면이 자기 언어의 기본어를 쓴다. 그것이
         3언어 서비스에서 맞는 동작이다. 관리자가 브랜드 고유 명칭(예: 'CC코인')
         을 정하면 그때는 번역하지 않는 것이 맞으므로 그 값을 저장한다.

       그래서 두 값을 구분한다.
         unitStored — DB 에 실제로 있는 값(없으면 빈 문자열). 저장할 때 쓴다.
         unit       — 화면에 보여줄 값. 비어 있으면 언어별 기본어.
    */
    const unitStored = (st && typeof st.unitName === 'string') ? st.unitName : '';
    const unit = unitStored || t('pt_unit_default');

    const call = async (fn, okText) => {
      setBusy(true); setMsg(null);
      try {
        const r = await fn();
        if (r && r.ok === false) setMsg({ ok: false, text: r.message || t('admin_save_failed') });
        else { setMsg({ ok: true, text: okText }); load(); }
      } catch (e) { setMsg({ ok: false, text: (e && e.message) || t('admin_save_failed') }); }
      setBusy(false);
    };

    const toggle = () => call(() => window.QTApi.admin.setPointSettings({
      enabled: !(st && st.enabled),
      // ★ 표시용 기본어가 아니라 저장된 값을 그대로 보낸다(위 주석 참고).
      unitName: unitStored,
      expiryDays: (st && st.expiryDays) || 0,
      referralAsPoints: Boolean(st && st.referralAsPoints),
      referralPoints: (st && st.referralPoints) || 0,
    }), t('admin_pt_saved'));

    return (
      <window.PageShell {...shellProps} title={t('admin_pt_title')} subtitle={t('admin_pt_sub')}
        breadcrumb={['Admin', t('admin_pt_title')]}
        actions={<button className="btn btn--sm" onClick={load}><I.Refresh size={13}/></button>}>
        {!live ? (
          <window.NotApplicablePanel title={t('pt_unavailable')} reason={t('pt_unavailable_why')} points={[]}/>
        ) : (
          <React.Fragment>
            <div className="grid-4">
              {/* 부채가 첫 숫자다. */}
              <window.KPICard label={t('admin_pt_outstanding')} value={fmt(d.totals.outstanding, 0)}
                sub={t('admin_pt_outstanding_sub')} tone="short" icon="Alert"/>
              <window.KPICard label={t('admin_pt_holders')} value={fmt(d.totals.holders, 0)} sub={t('admin_pt_holders_sub')}/>
              <window.KPICard label={t('admin_pt_granted')} value={fmt(d.totals.grantedTotal, 0)} sub={t('admin_pt_granted_sub')} tone="long"/>
              <window.KPICard label={t('admin_pt_integrity')}
                value={d.integrity ? (d.integrity.mismatches === 0 ? 'OK' : String(d.integrity.mismatches)) : '\u2014'}
                sub={t('admin_pt_integrity_sub')}
                tone={d.integrity && d.integrity.mismatches > 0 ? 'short' : 'long'}/>
            </div>

            {d.integrity && d.integrity.mismatches > 0 && (
              <div style={{padding:'12px 14px', borderRadius:7, fontSize:12.5, lineHeight:1.8,
                background:'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                border:'1px solid var(--color-danger)', color:'var(--color-danger)'}}>
                <strong>{t('admin_pt_integrity_bad')}</strong>
                <div>{t('admin_pt_integrity_bad_why')}</div>
              </div>
            )}

            <window.SectionCard title={t('admin_pt_programme')} subtitle={t('admin_pt_programme_sub')}>
              {/*
                 제도 조건.

                 ★ 현금 구매 줄을 반드시 넣는다. 결제 대행사가 없으면 서버가
                   켜기를 거부하는데, 그 사실을 화면에 적지 않으면 운영자가
                   설정에서 켜려 시도하고 400 을 받는다.
              */}
              <div style={{display:'grid', gap:0}}>
                {[
                  [t('admin_pt_state'), st.enabled ? t('admin_on') : t('admin_off')],
                  /* 비어 있으면 "언어별 기본어를 쓴다" 는 사실을 알린다. */
                  [t('admin_pt_unit'), st.unitName || t('admin_pt_unit_default_note')],
                  [t('admin_pt_expiry'), st.expiryDays > 0 ? t('pt_expiry_sub', { n: st.expiryDays }) : t('pt_no_expiry')],
                  [t('admin_pt_ref'), st.referralAsPoints ? fmt(st.referralPoints, 0) + ' ' + unit : t('admin_off')],
                  [t('admin_pt_purchase'), t('admin_pt_purchase_blocked')],
                ].map(function (row) {
                  return (
                    <div key={row[0]} style={{
                      display:'flex', gap:12, padding:'8px 0', fontSize:12.5,
                      borderBottom:'1px solid var(--color-border-subtle)',
                    }}>
                      <span style={{minWidth:130, color:'var(--color-text-tertiary)'}}>{row[0]}</span>
                      <span style={{flex:1}}>{row[1]}</span>
                    </div>
                  );
                })}
              </div>
              {canWrite ? (
                <div style={{display:'flex', gap:8, marginTop:12, flexWrap:'wrap'}}>
                  <button className={'btn btn--sm ' + (st.enabled ? '' : 'btn--primary')} disabled={busy} onClick={toggle}>
                    {st.enabled ? t('admin_pt_stop') : t('admin_pt_start')}
                  </button>
                </div>
              ) : (
                <div style={{marginTop:10, fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('admin_read_only')}</div>
              )}
            </window.SectionCard>

            {/* 이유별 집계 — 어디서 부채가 생기는지 본다. */}
            {d.totals.byReason.length > 0 && (
              <window.SectionCard title={t('admin_pt_by_reason')} subtitle={t('admin_pt_by_reason_sub')} noPadding>
                <window.DataTable columns={[
                  { key:'reason', label:t('pt_col_reason'), render: r => t(REASON_KEY_ADMIN[r.reason] || 'pt_reason_other') },
                  { key:'entries', label:t('admin_pt_entries'), align:'right', render: r => fmt(r.entries, 0) },
                  { key:'total', label:t('admin_pt_net'), align:'right', render: r => (
                    <strong style={{fontFamily:'var(--font-num)', color: r.total > 0 ? 'var(--color-success)' : 'var(--color-danger)'}}>
                      {r.total > 0 ? '+' : ''}{fmt(r.total, 0)}
                    </strong>
                  ) },
                ]} rows={d.totals.byReason}/>
              </window.SectionCard>
            )}

            <window.SectionCard title={t('admin_pt_catalog')} subtitle={t('admin_pt_catalog_sub')} noPadding>
              <window.DataTable columns={[
                { key:'id', label:'ID', render: r => <code style={{fontSize:11}}>{r.id}</code> },
                { key:'name', label:t('admin_pt_item'), render: r => t(r.nameKey) },
                { key:'kind', label:t('admin_pt_kind'), render: r => t('pt_kind_' + r.kind) },
                { key:'cost', label:t('admin_pt_cost'), align:'right', render: r => fmt(r.cost, 0) },
                { key:'grants', label:t('admin_pt_grants'), align:'right', render: r => fmt(r.grants, 0) },
                { key:'enabled', label:t('admin_pt_shown'), render: r => (
                  <span className={'badge ' + (r.enabled ? 'badge--success' : 'badge--neutral')}>
                    {r.enabled ? t('admin_on') : t('admin_off')}
                  </span>
                ) },
              ]} rows={d.catalog} emptyText={t('admin_pt_no_items')}/>
            </window.SectionCard>

            {/*
               수동 지급·회수.

               ★ 이유(memo)를 필수로 받는다. 서버도 없으면 400 이다 —
                 이유 없는 지급·회수는 나중에 검증할 수 없다.
               ★ 회수는 삭제가 아니다. 반대 항목을 추가해 상쇄한다.
            */}
            {canWrite && (
              <window.SectionCard title={t('admin_pt_adjust')} subtitle={t('admin_pt_adjust_sub')}>
                <div style={{display:'grid', gap:10, maxWidth:560}}>
                  <label style={{fontSize:11.5}}>{t('admin_pt_user_id')}
                    <input aria-label={t('admin_pt_user_id')} className="input" style={{marginTop:4}} value={adj.userId}
                      onChange={e => setAdj({...adj, userId: e.target.value})} placeholder="usr_..."/>
                  </label>
                  <div style={{display:'flex', gap:8}}>
                    <label style={{fontSize:11.5, flex:1}}>{t('admin_pt_amount')}
                      <input aria-label={t('admin_pt_amount')} className="input" style={{marginTop:4}} type="number" min="1" step="1" value={adj.amount}
                        onChange={e => setAdj({...adj, amount: e.target.value})}/>
                    </label>
                    <label style={{fontSize:11.5, flex:1}}>{t('admin_pt_direction')}
                      <select aria-label={t('admin_pt_direction')} className="input" style={{marginTop:4}} value={adj.direction}
                        onChange={e => setAdj({...adj, direction: e.target.value})}>
                        <option value="grant">{t('admin_pt_grant')}</option>
                        <option value="revoke">{t('admin_pt_revoke')}</option>
                      </select>
                    </label>
                  </div>
                  <label style={{fontSize:11.5}}>{t('admin_pt_memo')}
                    <input aria-label={t('admin_pt_memo')} className="input" style={{marginTop:4}} value={adj.memo}
                      onChange={e => setAdj({...adj, memo: e.target.value})} placeholder={t('admin_pt_memo_ph')}/>
                  </label>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', lineHeight:1.7}}>{t('admin_pt_adjust_note')}</div>
                  <button className="btn btn--sm btn--primary" style={{justifySelf:'start'}}
                    disabled={busy || !adj.userId.trim() || !adj.memo.trim() || !(Number(adj.amount) > 0)}
                    onClick={() => call(() => window.QTApi.admin.adjustPoints({
                      userId: adj.userId.trim(), amount: Number(adj.amount),
                      direction: adj.direction, memo: adj.memo.trim(),
                    }), t('admin_pt_adjusted'))}>
                    {busy ? '\u2026' : t('admin_pt_apply')}
                  </button>
                </div>
              </window.SectionCard>
            )}

            {msg && (
              <div style={{padding:'10px 12px', borderRadius:6, fontSize:12,
                color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)',
                border:'1px solid ' + (msg.ok ? 'var(--color-success)' : 'var(--color-danger)')}}>{msg.text}</div>
            )}
            {err && <div style={{fontSize:11.5, color:'var(--color-danger)'}}>{t('admin_load_failed')} \u00b7 {err}</div>}
          </React.Fragment>
        )}
      </window.PageShell>
    );
  };

  // ============================================================
  // 법적 문서 (운영)
  //
  // ★★ 게시는 되돌릴 수 없다.
  //
  //   약관을 게시하면 그것이 회사의 법적 약속이 되고, 이미 본 사람이 있으므로
  //   "안 본 것으로" 만들 수 없다. 그래서 초안과 게시를 분리하고, 게시된 문서의
  //   수정은 서버가 거부한다(새 버전을 만들어야 한다).
  //
  // ★ 이 화면의 첫 정보는 **런칭 가능 여부**다.
  //   약관과 개인정보처리방침이 게시되지 않으면 회원가입에서 받는 동의가
  //   아무것도 가리키지 않는다.
  // ============================================================
  window.AdminLegalPage = function AdminLegalPage({ shellProps }) {
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [draft, setDraft] = useState({ kind: 'terms', locale: 'en', version: '', title: '', body: '' });

    const load = React.useCallback(() => {
      const A = window.QTApi && window.QTApi.admin;
      if (!A || !A.legal) return;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return;
      A.legal().then(r => { setD(r); setErr(null); }).catch(e => setErr((e && e.message) || 'load failed'));
    }, []);
    useEffect(() => { load(); }, [load]);

    /* 쓰기 권한은 SUPER 만 갖는다 (법무 검토 우회 방지). 서버 권한 목록으로 판단. */
    const canWrite = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.legal.write'));
    const live = Boolean(d && d.supported);

    const call = async (fn, okText) => {
      setBusy(true); setMsg(null);
      try {
        const r = await fn();
        if (r && r.ok === false) setMsg({ ok: false, text: r.message || t('admin_save_failed') });
        else { setMsg({ ok: true, text: okText }); load(); }
      } catch (e) { setMsg({ ok: false, text: (e && e.message) || t('admin_save_failed') }); }
      setBusy(false);
    };

    return (
      <window.PageShell {...shellProps} title={t('admin_legal_title')} subtitle={t('admin_legal_sub')}
        breadcrumb={['Admin', t('admin_legal_title')]}
        actions={<button className="btn btn--sm" onClick={load}><I.Refresh size={13}/></button>}>
        {!live ? (
          <window.NotApplicablePanel title={t('admin_legal_unavailable')} reason={t('admin_legal_unavailable_why')} points={[]}/>
        ) : (
          <React.Fragment>
            {/*
               런칭 가능 여부가 첫 정보다.

               ★ canLaunch 가 false 면 회원가입 동의가 무의미한 상태다.
            */}
            <div style={{
              padding:'13px 15px', borderRadius:7, fontSize:12.5, lineHeight:1.85,
              background: d.readiness && d.readiness.canLaunch
                ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
                : 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
              border: '1px solid ' + (d.readiness && d.readiness.canLaunch ? 'var(--color-success)' : 'var(--color-danger)'),
            }}>
              <div style={{fontWeight:600, marginBottom:4}}>
                {d.readiness && d.readiness.canLaunch ? t('admin_legal_ready') : t('admin_legal_not_ready')}
              </div>
              <div style={{color:'var(--color-text-secondary)'}}>
                {d.readiness && d.readiness.canLaunch ? t('admin_legal_ready_body') : t('admin_legal_not_ready_body')}
              </div>
            </div>

            <window.SectionCard title={t('admin_legal_docs')} subtitle={t('admin_legal_docs_sub')} noPadding>
              <window.DataTable columns={[
                { key:'kind', label:t('admin_legal_kind'), render: r => t(
                  r.kind === 'terms' ? 'legal_terms' : r.kind === 'privacy' ? 'legal_privacy'
                  : r.kind === 'risk' ? 'legal_risk' : 'legal_security') },
                { key:'locale', label:t('admin_legal_locale'), render: r => <code style={{fontSize:11}}>{r.locale}</code> },
                { key:'version', label:t('admin_legal_version'), render: r => r.version },
                { key:'title', label:t('admin_legal_doc_title'), render: r => r.title },
                { key:'state', label:t('admin_legal_state'), render: r => (
                  <span className={'badge ' + (r.publishedAt ? 'badge--success' : 'badge--neutral')}>
                    {r.publishedAt ? t('admin_legal_published') : t('admin_legal_draft')}
                  </span>
                ) },
                { key:'effective', label:t('admin_legal_effective'), render: r => (
                  r.effectiveAt ? new Date(r.effectiveAt).toLocaleDateString() : '\u2014'
                ) },
                { key:'act', label:'', render: r => (
                  /*
                     게시 버튼은 초안에만 나온다.

                     ★ 게시된 문서에 버튼을 남겨두면 운영자가 누르고 409 를 받는다.
                       할 수 없는 일은 보여주지 않는다.
                  */
                  (canWrite && !r.publishedAt) ? (
                    <button className="btn btn--sm btn--primary" disabled={busy}
                      onClick={() => {
                        // 되돌릴 수 없는 동작이므로 한 번 더 묻는다.
                        if (!window.confirm(t('admin_legal_confirm', { v: r.version }))) return;
                        call(() => window.QTApi.admin.publishLegal(r.id), t('admin_legal_published_ok'));
                      }}>{t('admin_legal_publish')}</button>
                  ) : null
                ) },
              ]} rows={d.documents} emptyText={t('admin_legal_none')}/>
            </window.SectionCard>

            {canWrite ? (
              <window.SectionCard title={t('admin_legal_new')} subtitle={t('admin_legal_new_sub')}>
                <div style={{display:'grid', gap:10, maxWidth:760}}>
                  <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                    <label style={{fontSize:11.5, flex:'1 1 140px'}}>{t('admin_legal_kind')}
                      <select aria-label={t('admin_legal_kind')} className="input" style={{marginTop:4}} value={draft.kind}
                        onChange={e => setDraft({...draft, kind: e.target.value})}>
                        <option value="terms">{t('legal_terms')}</option>
                        <option value="privacy">{t('legal_privacy')}</option>
                        <option value="risk">{t('legal_risk')}</option>
                        <option value="security">{t('legal_security')}</option>
                      </select>
                    </label>
                    <label style={{fontSize:11.5, flex:'1 1 100px'}}>{t('admin_legal_locale')}
                      <input aria-label={t('admin_legal_locale')} className="input" style={{marginTop:4}} value={draft.locale} maxLength={10}
                        onChange={e => setDraft({...draft, locale: e.target.value})} placeholder="en"/>
                    </label>
                    <label style={{fontSize:11.5, flex:'1 1 100px'}}>{t('admin_legal_version')}
                      <input aria-label={t('admin_legal_version')} className="input" style={{marginTop:4}} value={draft.version} maxLength={40}
                        onChange={e => setDraft({...draft, version: e.target.value})} placeholder="1.0"/>
                    </label>
                  </div>
                  <label style={{fontSize:11.5}}>{t('admin_legal_doc_title')}
                    <input aria-label={t('admin_legal_doc_title')} className="input" style={{marginTop:4}} value={draft.title} maxLength={200}
                      onChange={e => setDraft({...draft, title: e.target.value})}/>
                  </label>
                  <label style={{fontSize:11.5}}>{t('admin_legal_body')}
                    <textarea aria-label={t('admin_legal_body')} className="input" style={{marginTop:4, minHeight:220, fontFamily:'var(--font-mono)', fontSize:12, lineHeight:1.7}}
                      value={draft.body} onChange={e => setDraft({...draft, body: e.target.value})}
                      placeholder={t('admin_legal_body_ph')}/>
                  </label>
                  {/*
                     HTML 금지를 미리 알린다.

                     서버가 거부하지만, 붙여넣고 저장을 누른 뒤에 알게 되면
                     작성한 내용을 잃을 수 있다.
                  */}
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', lineHeight:1.7}}>
                    {t('admin_legal_md_note')}
                  </div>
                  <button className="btn btn--sm" style={{justifySelf:'start'}}
                    disabled={busy || !draft.version.trim() || !draft.title.trim() || !draft.body.trim()}
                    onClick={() => call(() => window.QTApi.admin.createLegalDraft({
                      kind: draft.kind, locale: draft.locale.trim(), version: draft.version.trim(),
                      title: draft.title.trim(), body: draft.body,
                    }), t('admin_legal_draft_ok'))}>
                    {busy ? '\u2026' : t('admin_legal_save_draft')}
                  </button>
                </div>
              </window.SectionCard>
            ) : (
              <div style={{fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('admin_legal_super_only')}</div>
            )}

            {msg && (
              <div style={{padding:'10px 12px', borderRadius:6, fontSize:12,
                color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)',
                border:'1px solid ' + (msg.ok ? 'var(--color-success)' : 'var(--color-danger)')}}>{msg.text}</div>
            )}
            {err && <div style={{fontSize:11.5, color:'var(--color-danger)'}}>{t('admin_load_failed')} \u00b7 {err}</div>}
          </React.Fragment>
        )}
      </window.PageShell>
    );
  };

})();
