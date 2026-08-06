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
  const { useState, useEffect, useMemo } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
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
    const users = window.QTApp.ADMIN_USERS;
    const trades = window.QTApp.ADMIN_LIVE_TRADES;
    const system = window.QTApp.ADMIN_SYSTEM;
    const risk = window.QTApp.ADMIN_RISK_QUEUE;
    const ai = window.QTApp.ADMIN_AI_METRICS;

    const active = users.filter(u => u.status === 'active').length;
    const suspended = users.filter(u => u.status === 'suspended').length;
    const pending = users.filter(u => u.status === 'pending').length;
    const totalVol24h = trades.reduce((a,t) => a + t.notional, 0);
    const flaggedTrades = trades.filter(t => t.tag === 'suspicious' || t.tag === 'flagged').length;
    const criticalRisk = risk.filter(r => r.severity === 'critical' || r.severity === 'high').length;

    const badge = <span style={{padding:'2px 8px', background:'oklch(80% 0.14 75 / 0.14)', color:'var(--color-warning)', border:'1px solid var(--color-warning)', borderRadius:3, fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'0.06em'}}>ADMIN</span>;

    return (
      <window.PageShell
        {...shellProps}
        title="Admin Dashboard"
        subtitle={t('admin_dashboard_0ccafd')}
        breadcrumb={['Home','Admin']}
        badge={badge}
        actions={
          <>
            <span style={{fontSize:11, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>Last refresh · just now</span>
            <button className="btn btn--sm"><I.Refresh size={13}/> Refresh</button>
          </>
        }
      >
        {/* Top KPI grid */}
        <div className="grid-4">
          <window.KPICard label="Total Users"   value={users.length.toLocaleString()} sub={`${active} active · ${pending} pending · ${suspended} suspended`} icon="User" tone="brand"/>
          <window.KPICard label="24h Volume"    value={'$' + fmtCompact(totalVol24h * 24)} delta={+8.4} deltaLabel="vs yesterday" icon="Chart" tone="long"/>
          <window.KPICard label="Flagged Trades" value={flaggedTrades} sub={`${trades.length} tracked · Auto-review active`} icon="Alert" tone={flaggedTrades > 0 ? 'warning' : 'success'}/>
          <window.KPICard label="Critical Risk" value={criticalRisk} sub={`${risk.length} positions in queue`} icon="Alert" tone={criticalRisk > 0 ? 'danger' : 'success'}/>
        </div>

        {/* Second row */}
        <div className="grid-4">
          <window.KPICard label="AI Signals · Today" value={ai.signalsToday.toLocaleString()} sub={`Approve ${(ai.approveRate*100).toFixed(0)}% · Hit 7d ${(ai.hitRate7d*100).toFixed(0)}%`} icon="Sparkles" tone="ai"/>
          <window.KPICard label="System Health" value={system.filter(s => s.status === 'ok').length + '/' + system.length + ' OK'} sub={system.find(s => s.status !== 'ok')?.name || 'All systems nominal'} icon="Wifi" tone={system.some(s => s.status !== 'ok') ? 'warning' : 'success'}/>
          <window.KPICard label="Open CS Tickets" value={window.QTApp.CS_TICKETS.filter(c => c.status !== 'resolved').length} sub={`${window.QTApp.CS_TICKETS.filter(c => c.priority === 'high').length} high priority`} icon="Bell" tone="brand"/>
          <window.KPICard label="Fee Revenue · 30d" value="$142,820" delta={+12.4} deltaLabel="vs prev 30d" icon="Wallet" tone="brand"/>
        </div>

        {/* Live streams */}
        <div className="grid-2-1">
          <window.SectionCard
            title="🔴 Live Trades"
            subtitle={`${trades.length} events in last minute · click row to inspect`}
            actions={<button className="btn btn--sm">View all →</button>}
            noPadding
          >
            <window.DataTable
              columns={[
                { key: 'time', label: 'Time', width: 60, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{Math.floor((Date.now()-r.time)/1000)}s</span> },
                { key: 'user', label: 'User', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.userId}</span> },
                { key: 'sym',  label: 'Symbol', render: r => <strong>{r.sym}</strong> },
                { key: 'side', label: 'Side', render: r => <span className={r.side==='long'?'t-long':'t-short'}>{r.side==='long'?'▲':'▼'}</span>},
                { key: 'size', label: 'Size', align:'right', render: r => fmt(r.size, 3) },
                { key: 'price',label: 'Price', align:'right', render: r => fmt(r.price, 1) },
                { key: 'not',  label: 'Notional', align:'right', render: r => '$' + fmtCompact(r.notional) },
                { key: 'tag',  label: 'Flag', render: r => {
                  if (r.tag === 'ok') return <span style={{color:'var(--color-text-tertiary)', fontSize:11}}>·</span>;
                  const cls = { large: 'warn', suspicious: 'danger', flagged: 'danger', vip: 'ok' }[r.tag] || 'neutral';
                  return <span className={`status-pill status-pill--${cls}`}>{r.tag.toUpperCase()}</span>;
                }},
              ]}
              rows={trades.slice(0, 10)}
              onRowClick={(r) => alert('Trade inspector: ' + r.userId + ' · ' + r.sym)}
            />
          </window.SectionCard>

          <window.SectionCard
            title="⚠ Risk Queue"
            subtitle={`${risk.length} positions require attention`}
            actions={<a className="btn btn--sm" href="#/admin/risk">View all →</a>}
          >
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
                    <button className="btn btn--xs">Notify</button>
                  </div>
                </div>
              ))}
            </div>
          </window.SectionCard>
        </div>

        {/* System status */}
        <window.SectionCard title="System Health" subtitle="Real-time service status · Click for detail" noPadding>
          <window.DataTable
            columns={[
              { key: 'name',   label: 'Service', render: r => <strong>{r.name}</strong> },
              { key: 'status', label: 'Status', render: r => <span className={`status-pill status-pill--${r.status === 'ok' ? 'ok' : r.status === 'degraded' ? 'warn' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key: 'latency', label: 'Latency', align:'right', render: r => typeof r.latency === 'number' ? r.latency + 'ms' : r.latency },
              { key: 'uptime',  label: 'Uptime', align:'right', render: r => r.uptime.toFixed(3) + '%' },
              { key: 'note',    label: 'Note', render: r => <span style={{color:'var(--color-text-tertiary)', fontSize:11}}>{r.note || ''}</span> },
            ]}
            rows={system}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN USERS PAGE
  // ============================================================
  window.AdminUsersPage = function AdminUsersPage({ shellProps }) {
    const users = window.QTApp.ADMIN_USERS;
    const [q, setQ] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const filtered = users
      .filter(u => statusFilter === 'all' || u.status === statusFilter)
      .filter(u => !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()) || u.id.includes(q));

    return (
      <window.PageShell
        {...shellProps}
        title="User Management"
        subtitle={t('admin_users_subtitle', { n: users.length })}
        breadcrumb={['Home','Admin','Users']}
        actions={
          <>
            <button className="btn btn--sm"><I.Camera size={13}/> Export</button>
            <button className="btn btn--sm btn--primary"><I.Plus size={13}/> Invite User</button>
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="Total"      value={users.length}/>
          <window.KPICard label="Active"     value={users.filter(u => u.status === 'active').length} tone="long"/>
          <window.KPICard label="Pending KYC" value={users.filter(u => u.status === 'pending').length} tone="warning"/>
          <window.KPICard label="Suspended / Restricted" value={users.filter(u => u.status === 'suspended' || u.status === 'restricted').length} tone="danger"/>
        </div>

        <window.SectionCard
          title="Users"
          actions={
            <>
              <div className="input-group" style={{width: 240, height: 30}}>
                <I.Search size={12}/>
                <input placeholder={t('admin_users_3fefdf')} value={q} onChange={e => setQ(e.target.value)}/>
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input" style={{height:28, fontSize:11, width:140}}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="restricted">Restricted</option>
                <option value="suspended">Suspended</option>
              </select>
            </>
          }
          noPadding
        >
          <window.DataTable
            columns={[
              { key:'id', label:'ID', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{r.id}</span> },
              { key:'name', label:'Name / Email', render: r => (
                <div>
                  <div style={{fontWeight:500}}>{r.name}</div>
                  <div style={{fontSize:10, color:'var(--color-text-tertiary)'}}>{r.email}</div>
                </div>
              )},
              { key:'country', label:'Country', width: 60, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.country}</span> },
              { key:'tier', label:'Tier', render: r => <span className="badge badge--neutral">{r.tier}</span> },
              { key:'kyc', label:'KYC', render: r => (
                <div style={{display:'inline-flex', alignItems:'center', gap:4}}>
                  {[1,2,3].map(lv => <span key={lv} style={{width:6, height:6, borderRadius:'50%', background: lv <= r.kyc ? 'var(--color-success)' : 'var(--color-border-default)'}}/>)}
                  <span style={{fontFamily:'var(--font-mono)', fontSize:10, marginLeft:2}}>L{r.kyc}</span>
                </div>
              )},
              { key:'vol', label:'30d Vol', align:'right', render: r => '$' + fmtCompact(r.vol30) },
              { key:'flags', label:'Flags', render: r => r.flags.length ? r.flags.map(f => <span key={f} className="severity-pill severity-pill--medium" style={{marginRight:3}}>{f}</span>) : <span style={{color:'var(--color-text-tertiary)'}}>·</span> },
              { key:'status', label:'Status', render: r => <span className={`status-pill status-pill--${r.status}`}>{r.status.toUpperCase()}</span> },
              { key:'joined', label:'Joined', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{r.joined}</span> },
              { key:'act', label:'', align:'right', render: r => (
                <>
                  <button className="tbl-action">View</button>
                  <button className="tbl-action" style={{marginLeft:3}}>KYC</button>
                  {r.status === 'active' && <button className="tbl-action tbl-action--danger" style={{marginLeft:3}}>Suspend</button>}
                  {r.status === 'suspended' && <button className="tbl-action" style={{marginLeft:3}}>Reactivate</button>}
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
    const trades = window.QTApp.ADMIN_LIVE_TRADES;
    const [filter, setFilter] = useState('all');
    const filtered = filter === 'all' ? trades : trades.filter(t => t.tag === filter);

    const totalVol = trades.reduce((a,t) => a+t.notional, 0);
    const largest = Math.max(...trades.map(t => t.notional));
    const flagged = trades.filter(t => t.tag === 'suspicious' || t.tag === 'flagged').length;

    return (
      <window.PageShell
        {...shellProps}
        title="Trade Monitoring"
        subtitle={t('admin_trades_bc077b')}
        breadcrumb={['Home','Admin','Trade Monitor']}
        actions={
          <>
            <span style={{padding:'2px 8px', background:'oklch(78% 0.14 145 / 0.14)', color:'var(--color-success)', borderRadius:3, fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'0.06em'}}>● LIVE</span>
            <button className="btn btn--sm"><I.Refresh size={13}/></button>
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="Trades · Last 1m" value={trades.length} sub="Rolling window" tone="brand"/>
          <window.KPICard label="Volume · Last 1m" value={'$' + fmtCompact(totalVol)} tone="long"/>
          <window.KPICard label="Largest Trade" value={'$' + fmtCompact(largest)} sub="Auto-review triggered"/>
          <window.KPICard label="Flagged" value={flagged} tone={flagged > 0 ? 'danger' : 'success'}/>
        </div>

        <window.SectionCard
          title="Live Trade Stream"
          actions={
            <div className="seg">
              {[
                { id:'all', label:'All' },
                { id:'suspicious', label:'Suspicious' },
                { id:'flagged', label:'Flagged' },
                { id:'large', label:'Large' },
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
              { key: 'time', label: 'Time', width:80, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{new Date(r.time).toLocaleTimeString('en-GB', {hour12:false})}</span> },
              { key: 'user', label: 'User', render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.userId}</span> },
              { key: 'sym',  label: 'Symbol', render: r => <strong>{r.sym}</strong> },
              { key: 'side', label: 'Side', render: r => <span className={r.side==='long'?'t-long':'t-short'} style={{fontWeight:500}}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key: 'size', label: 'Size', align:'right', render: r => fmt(r.size, 3) },
              { key: 'price', label: 'Price', align:'right', render: r => fmt(r.price, 1) },
              { key: 'not',  label: 'Notional', align:'right', render: r => '$' + fmtCompact(r.notional) },
              { key: 'tag',  label: 'Flag', render: r => {
                if (r.tag === 'ok') return <span style={{color:'var(--color-text-tertiary)'}}>ok</span>;
                const cls = { large: 'warn', suspicious: 'danger', flagged: 'danger', vip: 'ok' }[r.tag] || 'neutral';
                return <span className={`status-pill status-pill--${cls}`}>{r.tag.toUpperCase()}</span>;
              }},
              { key: 'act', label: '', render: () => <><button className="tbl-action">Inspect</button> <button className="tbl-action" style={{marginLeft:3}}>User</button></> },
            ]}
            rows={filtered}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN AI OPS PAGE
  // ============================================================
  window.AdminAIOpsPage = function AdminAIOpsPage({ shellProps }) {
    const ai = window.QTApp.ADMIN_AI_METRICS;

    return (
      <window.PageShell
        {...shellProps}
        title="AI Ops"
        subtitle={`Model: ${ai.modelVersion} · Deployed ${new Date(ai.lastDeploy).toLocaleString('en-GB', {hour12:false})}`}
        breadcrumb={['Home','Admin','AI Ops']}
        actions={
          <>
            <button className="btn btn--sm"><I.Book size={13}/> Prompts</button>
            <button className="btn btn--sm btn--primary"><I.Sparkles size={13}/> Deploy new version</button>
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="Signals · Today" value={ai.signalsToday.toLocaleString()} sub={`Approve rate ${(ai.approveRate*100).toFixed(0)}%`} tone="ai"/>
          <window.KPICard label="Hit Rate · 7d" value={(ai.hitRate7d*100).toFixed(1) + '%'} sub={`Avg R:R ${ai.avgRR}`} tone="long"/>
          <window.KPICard label="Avg Confidence" value={(ai.avgConfidence*100).toFixed(0) + '%'} sub={`± σ 12%`} tone="brand"/>
          <window.KPICard label="Cost · Today" value={'$' + ai.tokensCostUSD.toFixed(2)} sub={`${(ai.tokensToday/1e6).toFixed(2)}M tokens`}/>
        </div>

        <div className="grid-4">
          <window.KPICard label="Avg Latency" value={ai.avgLatencyMs.toLocaleString() + 'ms'} sub="p50 · goal < 1000ms" tone={ai.avgLatencyMs > 1000 ? 'warning' : 'success'}/>
          <window.KPICard label="Error Rate" value={(ai.errorRate*100).toFixed(2) + '%'} sub={`Tolerance < 1%`} tone={ai.errorRate > 0.01 ? 'warning' : 'success'}/>
          <window.KPICard label="Model Traffic" value="86% / 14%" sub="v1.4.2 / v1.3.9" tone="ai"/>
          <window.KPICard label="Rollback Ready" value="✓ v1.3.9" sub="Instant revert (<30s)" tone="success"/>
        </div>

        <div className="grid-2">
          <window.SectionCard title="Signal Quality · Model Comparison" subtitle="Hit rate = signals reaching TP1 within window">
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

          <window.SectionCard title="Recent Incidents" noPadding>
            {ai.recentIncidents.map((inc, i) => (
              <div key={i} style={{padding:'10px 16px', borderBottom:'1px solid var(--color-border-subtle)', display:'flex', alignItems:'center', gap:12}}>
                <span className={`status-pill status-pill--${inc.severity === 'warn' ? 'warn' : 'ok'}`}>{inc.severity.toUpperCase()}</span>
                <span style={{fontSize:12, flex:1}}>{inc.desc}</span>
                <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{timeAgo(inc.time)}</span>
              </div>
            ))}
          </window.SectionCard>
        </div>

        <window.SectionCard title="Prompt Management" subtitle="Versioned prompts · A/B tests · Rollout schedule">
          <window.DataTable
            columns={[
              { key: 'name', label: 'Prompt' },
              { key: 'ver',  label: 'Version', render: () => <span className="badge badge--neutral">v14.2</span> },
              { key: 'status', label: 'Status', render: () => <span className="status-pill status-pill--ok">DEPLOYED</span> },
              { key: 'lastEdit', label: 'Last Edit', render: () => t('admin_a_i_ops_ed2648') },
              { key: 'act', label: '', align:'right', render: () => <><button className="tbl-action">Edit</button> <button className="tbl-action" style={{marginLeft:3}}>Diff</button></> },
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

    return (
      <window.PageShell
        {...shellProps}
        title="Design Ops"
        subtitle={t('admin_design_ops_247f98')}
        breadcrumb={['Home','Admin','Design Ops']}
        badge={<span className="badge badge--ai">SUPER ADMIN</span>}
        actions={
          <>
            <a className="btn btn--sm" href="design-system.html" target="_blank"><I.Book size={13}/> Design System</a>
            <a className="btn btn--sm" href="design-library/index.html" target="_blank"><I.Layers size={13}/> Library</a>
            <button className="btn btn--sm btn--primary"><I.Check size={13}/> Publish ({d.unpublishedChanges})</button>
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
          <window.SectionCard title="Brand Palettes" actions={<button className="btn btn--sm"><I.Plus size={11}/> New</button>}>
            {d.tokens.brands.map(b => (
              <div key={b} style={{display:'flex', alignItems:'center', gap: 12, padding:'10px 12px', border:'1px solid var(--color-border-subtle)', borderRadius:4, marginBottom: 6}}>
                <div style={{display:'flex', gap:2}}>
                  {[500,600,700].map(shade => (
                    <div key={shade} style={{width:24, height:24, borderRadius:3, background: b === 'institutional-cool' ? `oklch(${shade === 500 ? 56 : shade === 600 ? 48 : 38}% 0.15 220)` : 'var(--color-brand)'}}/>
                  ))}
                </div>
                <span style={{flex:1, fontSize:12, fontWeight:500}}>{b}</span>
                {b === 'institutional-cool' && <span className="status-pill status-pill--ok">DEFAULT</span>}
                <button className="tbl-action">Edit</button>
              </div>
            ))}
          </window.SectionCard>

          <window.SectionCard title="Long / Short Pairings" actions={<button className="btn btn--sm"><I.Plus size={11}/> New</button>}>
            {d.tokens.longshortPairs.map(p => (
              <div key={p} style={{display:'flex', alignItems:'center', gap: 12, padding:'10px 12px', border:'1px solid var(--color-border-subtle)', borderRadius:4, marginBottom: 6}}>
                <div style={{display:'flex', gap:4}}>
                  <div style={{width:24, height:24, borderRadius:3, background: p === 'teal-magenta' ? 'oklch(72% 0.14 175)' : p === 'green-red' ? 'oklch(70% 0.17 145)' : 'oklch(72% 0.15 220)'}}/>
                  <div style={{width:24, height:24, borderRadius:3, background: p === 'teal-magenta' ? 'oklch(68% 0.22 355)' : p === 'green-red' ? 'oklch(64% 0.22 25)' : 'oklch(72% 0.17 55)'}}/>
                </div>
                <span style={{flex:1, fontSize:12, fontWeight:500}}>{p}</span>
                {p === 'teal-magenta' && <span className="status-pill status-pill--ok">DEFAULT</span>}
                <button className="tbl-action">Edit</button>
              </div>
            ))}
          </window.SectionCard>
        </div>

        <window.SectionCard title="Recent Changes" subtitle={`Last publish · ${new Date(d.lastPublished).toLocaleString('en-GB', {hour12:false})}`}>
          {d.changes.map((c, i) => (
            <div key={i} style={{display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom: i < d.changes.length-1 ? '1px solid var(--color-border-subtle)' : ''}}>
              <span className="badge badge--neutral" style={{textTransform:'uppercase'}}>{c.kind}</span>
              <span style={{flex:1, fontSize:12.5}}>{c.title}</span>
              <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{c.author}</span>
              <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{timeAgo(c.time)}</span>
              <button className="tbl-action">Diff</button>
            </div>
          ))}
        </window.SectionCard>

        <window.SectionCard title="Quick Actions" subtitle={t('admin_design_ops_127e5c')}>
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
    const system = window.QTApp.ADMIN_SYSTEM;
    const okCount = system.filter(s => s.status === 'ok').length;

    return (
      <window.PageShell
        {...shellProps}
        title="System Health"
        subtitle={`${okCount}/${system.length} services healthy · WebSocket · DB · API · Batch`}
        breadcrumb={['Home','Admin','System']}
        actions={<button className="btn btn--sm"><I.Refresh size={13}/></button>}
      >
        <div className="grid-4">
          <window.KPICard label="Overall Uptime · 30d" value="99.984%" sub="4.6m downtime" tone="success"/>
          <window.KPICard label="Active Users" value="1,242" sub="Real-time"/>
          <window.KPICard label="WS Connections" value="8,412" sub="Peak today 12,340"/>
          <window.KPICard label="Alerts · Last 24h" value="2" sub="1 warn · 0 critical" tone="warning"/>
        </div>

        <window.SectionCard title="Services" noPadding>
          <window.DataTable
            columns={[
              { key:'name', label:'Service', render: r => <strong>{r.name}</strong> },
              { key:'status', label:'Status', render: r => <span className={`status-pill status-pill--${r.status === 'ok' ? 'ok' : r.status === 'degraded' ? 'warn' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key:'latency', label:'Latency', align:'right', render: r => typeof r.latency === 'number' ? r.latency + 'ms' : r.latency },
              { key:'uptime', label:'Uptime · 30d', align:'right', render: r => r.uptime + '%' },
              { key:'note', label:'Note' },
              { key:'act', label:'', align:'right', render: () => <><button className="tbl-action">Logs</button> <button className="tbl-action" style={{marginLeft:3}}>Restart</button></> },
            ]}
            rows={system}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN AUDIT LOG PAGE
  // ============================================================
  window.AdminAuditPage = function AdminAuditPage({ shellProps }) {
    const audit = window.QTApp.ADMIN_AUDIT;

    return (
      <window.PageShell
        {...shellProps}
        title="Audit Log"
        subtitle="Admin actions · System events · 30-day retention"
        breadcrumb={['Home','Admin','Audit']}
        actions={
          <>
            <button className="btn btn--sm"><I.Camera size={13}/> Export</button>
            <button className="btn btn--sm">Filter</button>
          </>
        }
      >
        <window.SectionCard title="Events" subtitle={`${audit.length} entries · newest first`} noPadding>
          <window.DataTable
            columns={[
              { key:'time', label:'Time', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{new Date(r.time).toLocaleString('en-GB', {hour12:false})}</span> },
              { key:'actor', label:'Actor', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.actor}</span> },
              { key:'action', label:'Action', render: r => <span style={{fontFamily:'var(--font-mono)', color:'var(--color-brand)'}}>{r.action}</span> },
              { key:'target', label:'Target', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.target}</span> },
              { key:'ip', label:'IP', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>{r.ip}</span> },
              { key:'meta', label:'Detail', render: r => <span style={{fontSize:11, color:'var(--color-text-secondary)'}}>{r.meta || ''}</span> },
              { key:'ok', label:'Result', render: r => r.ok ? <span className="status-pill status-pill--ok">OK</span> : <span className="status-pill status-pill--danger">FAIL</span> },
            ]}
            rows={audit}
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

    return (
      <window.PageShell
        {...shellProps}
        title="Fees & Promotions"
        subtitle={t('admin_fees_65feac')}
        breadcrumb={['Home','Admin','Fees']}
        actions={<button className="btn btn--sm btn--primary"><I.Plus size={13}/> New Promo</button>}
      >
        <window.SectionCard title="Fee Tiers" subtitle="Maker / Taker · Volume-based" noPadding>
          <window.DataTable
            columns={[
              { key:'tier', label:'Tier', render: r => <strong>{r.tier}</strong> },
              { key:'maker', label:'Maker', align:'right', render: r => (r.maker*100).toFixed(3) + '%' },
              { key:'taker', label:'Taker', align:'right', render: r => (r.taker*100).toFixed(3) + '%' },
              { key:'vol', label:'30d Volume Req.', align:'right', render: r => '$' + fmtCompact(r.vol30Req) },
              { key:'hold', label:'Token Hold Req.', align:'right', render: r => r.holdReq + ' QT' },
              { key:'act', label:'', align:'right', render: () => <button className="tbl-action">Edit</button> },
            ]}
            rows={tiers}
          />
        </window.SectionCard>

        <window.SectionCard title="Active Promotions" noPadding>
          <window.DataTable
            columns={[
              { key:'id', label:'ID', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.id}</span> },
              { key:'name', label:'Name', render: r => <strong>{r.name}</strong> },
              { key:'period', label:'Period' },
              { key:'status', label:'Status', render: r => <span className={`status-pill status-pill--${r.status === 'active' ? 'ok' : 'neutral'}`}>{r.status.toUpperCase()}</span> },
              { key:'payout', label:'Payout · 30d', align:'right', render: r => '$' + fmtCompact(r.payout) },
              { key:'act', label:'', align:'right', render: () => <><button className="tbl-action">Report</button> <button className="tbl-action" style={{marginLeft:3}}>Edit</button></> },
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
    const notices = window.QTApp.NOTICES;
    const cs = window.QTApp.CS_TICKETS;

    return (
      <window.PageShell
        {...shellProps}
        title="Notices & CS"
        subtitle={t('admin_notices_11300f')}
        breadcrumb={['Home','Admin','Notices & CS']}
        actions={<button className="btn btn--sm btn--primary"><I.Plus size={13}/> New Notice</button>}
      >
        <div className="grid-2">
          <window.SectionCard title={t('admin_notices_15d236')} subtitle={`${notices.filter(n => n.pinned).length} pinned · ${notices.length} total`} noPadding>
            {notices.map(n => (
              <div key={n.id} style={{display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom:'1px solid var(--color-border-subtle)'}}>
                {n.pinned && <I.Star size={12} style={{color:'var(--color-warning)'}}/>}
                <div style={{flex:1}}>
                  <div style={{fontSize:13, fontWeight:500}}>{n.title}</div>
                  <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', marginTop:2}}>{n.id} · {n.published}</div>
                </div>
                <span className={`status-pill status-pill--${n.status === 'published' ? 'ok' : 'neutral'}`}>{n.status.toUpperCase()}</span>
                <button className="tbl-action">Edit</button>
              </div>
            ))}
          </window.SectionCard>

          <window.SectionCard title="CS Tickets" subtitle={`${cs.filter(t => t.status !== 'resolved').length} open`} noPadding>
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
    const risk = window.QTApp.ADMIN_RISK_QUEUE;
    return (
      <window.PageShell
        {...shellProps}
        title="Risk Management"
        subtitle={t('admin_risk_a1edf2')}
        breadcrumb={['Home','Admin','Risk']}
      >
        <div className="grid-4">
          <window.KPICard label="Critical / High" value={risk.filter(r => r.severity === 'critical' || r.severity === 'high').length} tone="danger"/>
          <window.KPICard label="Total in Queue" value={risk.length}/>
          <window.KPICard label="Auto-liquidations · 24h" value="12"/>
          <window.KPICard label="Exposure · Long / Short" value="58% / 42%" sub="Balanced"/>
        </div>
        <window.SectionCard title="Risk Queue" noPadding>
          <window.DataTable
            columns={[
              { key:'sev', label:'Severity', render: r => <span className={`severity-pill severity-pill--${r.severity}`}>{r.severity.toUpperCase()}</span> },
              { key:'user', label:'User', render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.userId}</span> },
              { key:'sym', label:'Symbol', render: r => <strong>{r.sym}</strong> },
              { key:'side', label:'Side', render: r => <span className={r.side==='long'?'t-long':'t-short'}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key:'size', label:'Size', align:'right', render: r => fmt(r.size, 3) },
              { key:'mr', label:'Margin Ratio', align:'right', render: r => (r.marginRatio*100).toFixed(0) + '%' },
              { key:'liq', label:'Liq. Distance', align:'right', render: r => <span className={r.liqDist < 3 ? 't-short' : ''}>{r.liqDist}%</span> },
              { key:'act', label:'', align:'right', render: () => <><button className="tbl-action">Notify</button> <button className="tbl-action" style={{marginLeft:3}}>Force Close</button></> },
            ]}
            rows={risk}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  window.AdminAssetsPage = function AdminAssetsPage({ shellProps }) {
    return (
      <window.PageShell {...shellProps} title="Assets & Withdrawals" subtitle={t('admin_assets_7c2e10')} breadcrumb={['Home','Admin','Assets']}>
        <window.PagePlaceholder
          title="Assets & Withdrawals"
          todo={[
            t('admin_assets_d52d75'),
            t('admin_assets_16f852'),
            t('admin_assets_293d08'),
            'On-chain confirmation status',
            t('admin_assets_657644'),
          ]}
        />
      </window.PageShell>
    );
  };
})();
