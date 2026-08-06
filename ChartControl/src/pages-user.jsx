/* ============================================================
   User Pages
   ------------------------------------------------------------
   - MarketsPage        /markets
   - AIStrategiesPage   /ai-strategies
   - PortfolioPage      /portfolio
   - AnalyticsPage      /analytics
   - MultiChartPage     /multi-chart
   - WalletPage         /wallet          (Exchange connect + Referrals)
   - SettingsPage       /settings        (Profile · Security · Notifications · API keys)
   - NotificationsPage  /notifications
   - OrderHistoryPage   /order-history
   ============================================================ */

(function () {
  const { useState, useEffect, useMemo, useCallback } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
  const I = window.Icons;
  const { fmt, fmtPct, fmtCompact } = window.QTFmt;

  // Helper: format time ago
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  // Sparkline SVG util
  function Sparkline({ points, width = 90, height = 24, up = true }) {
    if (!points || points.length < 2) return null;
    let mn = Infinity, mx = -Infinity;
    for (const p of points) { if (p < mn) mn = p; if (p > mx) mx = p; }
    const range = (mx - mn) || 1;
    const stride = width / (points.length - 1);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i*stride).toFixed(1)} ${(height - ((p - mn) / range) * height).toFixed(1)}`).join(' ');
    return (
      <svg className={`sparkline sparkline--${up ? 'up' : 'dn'}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <path d={path} fill="none" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }

  // ============================================================
  // MARKETS PAGE
  // ============================================================
  window.MarketsPage = function MarketsPage({ shellProps }) {
    const [q, setQ] = useState('');
    const [tab, setTab] = useState('All');
    const [sort, setSort] = useState({ key: 'vol', dir: 'desc' });
    const [view, setView] = useState('table'); // table | heatmap

    const markets = window.QT.MARKETS;
    // 실시세가 QT.MARKETS 를 제자리 갱신하므로, 재계산 트리거가 필요하다.
    const liveVersion = window.QTLive ? window.QTLive.useLiveVersion() : 0;
    const filtered = useMemo(() => {
      let list = [...markets];
      if (tab === 'Favorites') list = list.filter(m => m.fav);
      else if (tab === 'Gainers') list = list.filter(m => m.chg24h > 2);
      else if (tab === 'Losers')  list = list.filter(m => m.chg24h < -0.5);
      else if (tab === 'New')     list = list.slice(-8);
      if (q) list = list.filter(m => m.base.toLowerCase().includes(q.toLowerCase()));
      list.sort((a,b) => {
        const dir = sort.dir === 'asc' ? 1 : -1;
        const k = sort.key === 'chg' ? 'chg24h' : sort.key === 'price' ? 'price' : 'vol24h';
        return (a[k] - b[k]) * dir;
      });
      return list;
    }, [q, tab, sort, markets, liveVersion]);

    // heat cell color
    function heatCol(chg) {
      const abs = Math.min(6, Math.abs(chg));
      const alpha = 0.15 + (abs / 6) * 0.55;
      if (chg >= 0) return `oklch(72% 0.14 175 / ${alpha.toFixed(3)})`;
      return `oklch(68% 0.22 355 / ${alpha.toFixed(3)})`;
    }

    return (
      <window.PageShell
        {...shellProps}
        title="Markets"
        subtitle="21 pairs · Perpetual · USDT-margined · Live mock stream"
        breadcrumb={['Home','Markets']}
        actions={
          <>
            <div className="seg">
              <button className={`seg__opt ${view==='table' ? 'is-active' : ''}`} onClick={() => setView('table')}>
                <I.LayoutIcon size={11}/> Table
              </button>
              <button className={`seg__opt ${view==='heatmap' ? 'is-active' : ''}`} onClick={() => setView('heatmap')}>
                <I.Grid size={11}/> Heatmap
              </button>
            </div>
            <button className="btn btn--sm"><I.Filter size={13}/> Filter</button>
          </>
        }
      >
        {/* KPI row */}
        <div className="grid-4">
          <window.KPICard label="24h Volume" value={fmtCompact(markets.reduce((a,m) => a + m.vol24h, 0))} delta={+2.14} deltaLabel="vs yesterday" icon="Chart" tone="brand"/>
          <window.KPICard label="Gainers" value={markets.filter(m => m.chg24h > 0).length + ' / ' + markets.length} sub="Bull dominance 62%" icon="Zap" tone="long"/>
          <window.KPICard label="Top Mover" value="OP · +6.32%" sub="OP/USDT · $1.84" icon="Sparkles" tone="ai"/>
          <window.KPICard label="Fear & Greed" value="72 · Greed" sub="30d avg 58" icon="Info" tone="warning"/>
        </div>

        <window.SectionCard
          title="All Markets"
          actions={
            <>
              <div className="input-group" style={{width: 240, height: 30}}>
                <I.Search size={12}/>
                <input placeholder="Search symbol..." value={q} onChange={e => setQ(e.target.value)}/>
              </div>
              <div className="seg">
                {['All','Favorites','Gainers','Losers','New'].map(t => (
                  <button key={t} className={`seg__opt ${tab===t?'is-active':''}`} onClick={() => setTab(t)}>{t}</button>
                ))}
              </div>
            </>
          }
          noPadding
        >
          {view === 'table' && (
            <window.DataTable
              columns={[
                { key: 'fav',   label: '', width: 32, render: r => <span style={{color:r.fav?'var(--color-warning)':'var(--color-text-tertiary)', cursor:'pointer'}}>{r.fav ? '★' : '☆'}</span> },
                { key: 'sym',   label: 'Pair', render: r => <span><strong>{r.base}</strong><span style={{color:'var(--color-text-tertiary)'}}>/{r.quote}</span><span className="badge badge--perp" style={{marginLeft:6}}>{r.type}</span></span> },
                { key: 'price', label: 'Price', align: 'right', render: r => <span style={{fontFamily:'var(--font-num)'}}>{r.price.toLocaleString('en-US', {maximumFractionDigits: r.price >= 100 ? 2 : 4})}</span> },
                { key: 'chg',   label: '24h Change', align: 'right', render: r => (
                  <span className={r.chg24h >= 0 ? 't-long' : 't-short'} style={{fontFamily:'var(--font-mono)', fontWeight:500}}>
                    {r.chg24h >= 0 ? '▲' : '▼'} {Math.abs(r.chg24h).toFixed(2)}%
                  </span>
                ) },
                { key: 'range', label: '24h Range', align: 'right', render: r => (
                  <span style={{fontFamily:'var(--font-num)', color:'var(--color-text-secondary)', fontSize:11}}>{fmt(r.lo, r.lo >= 100 ? 1 : 4)} – {fmt(r.hi, r.hi >= 100 ? 1 : 4)}</span>
                ) },
                { key: 'vol',   label: '24h Volume', align: 'right', render: r => <span style={{fontFamily:'var(--font-num)'}}>{fmtCompact(r.vol24h)}</span> },
                { key: 'spark', label: 'Trend', align: 'right', width: 100, render: r => {
                  const pts = Array.from({length: 24}, (_, i) => r.price * (1 + Math.sin(i / 3 + r.base.charCodeAt(0)) * 0.02 + (Math.random()-0.5) * 0.006));
                  return <Sparkline points={pts} up={r.chg24h >= 0}/>;
                }},
                { key: 'act',   label: '', align: 'right', width: 100, render: r => (
                  <a className="btn btn--xs btn--primary" href={`#/trade?symbol=${r.base}${r.quote}`}>Trade</a>
                ) },
              ]}
              rows={filtered}
              onRowClick={(r) => shellProps.onNavigate && shellProps.onNavigate('/trade?symbol=' + r.base + r.quote)}
            />
          )}
          {view === 'heatmap' && (
            <div style={{padding: 12}}>
              <div className="markets-heatmap">
                {filtered.map(m => (
                  <div key={m.base} className="heat-cell" style={{background: heatCol(m.chg24h)}} onClick={() => shellProps.onNavigate && shellProps.onNavigate('/trade?symbol=' + m.base + m.quote)}>
                    <div className="heat-cell__sym">{m.base}</div>
                    <div>
                      <div className="heat-cell__chg" style={{color: m.chg24h >= 0 ? 'var(--color-trade-long)' : 'var(--color-trade-short)'}}>
                        {m.chg24h >= 0 ? '+' : ''}{m.chg24h.toFixed(2)}%
                      </div>
                      <div className="heat-cell__price">{fmt(m.price, m.price >= 100 ? 1 : 4)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // AI STRATEGIES PAGE
  // ============================================================
  window.AIStrategiesPage = function AIStrategiesPage({ shellProps }) {
    const strategies = window.QTApp.STRATEGIES;
    const [filter, setFilter] = useState('all');   // all | free | pro | vip
    const [sort, setSort] = useState('pnl');
    const filtered = strategies
      .filter(s => filter === 'all' || s.subscription.toLowerCase() === filter)
      .sort((a,b) => {
        if (sort === 'pnl') return b.pnl30 - a.pnl30;
        if (sort === 'sharpe') return b.sharpe - a.sharpe;
        if (sort === 'winRate') return b.winRate - a.winRate;
        return b.followers - a.followers;
      });

    return (
      <window.PageShell
        {...shellProps}
        title="AI Strategies"
        subtitle="AI-driven trading strategies · Backtest · Follow · Deploy — all with simulated execution"
        breadcrumb={['Home','AI Strategies']}
        actions={
          <>
            <button className="btn btn--sm"><I.Plus size={12}/> Create Strategy</button>
            <button className="btn btn--sm btn--primary"><I.Sparkles size={12}/> AI Generate</button>
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="Total Strategies" value={strategies.length} sub="Free 4 · Pro 3 · VIP 1" icon="Sparkles" tone="ai"/>
          <window.KPICard label="Avg 30d PnL" value={'+' + (strategies.reduce((a,s) => a+s.pnl30, 0)/strategies.length).toFixed(1) + '%'} delta={+8.4} deltaLabel="vs prev 30d" tone="long"/>
          <window.KPICard label="Following" value="0" sub="Follow strategies to auto-copy signals" icon="Zap" tone="brand"/>
          <window.KPICard label="AI Signals · Today" value={window.QTApp.ADMIN_AI_METRICS.signalsToday} sub={`Approve rate ${(window.QTApp.ADMIN_AI_METRICS.approveRate * 100).toFixed(0)}%`} tone="ai"/>
        </div>

        <window.SectionCard
          title="Strategy Gallery"
          subtitle="Simulated performance based on backtest + paper live. Not investment advice."
          actions={
            <>
              <div className="seg">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'free', label: 'Free' },
                  { id: 'pro', label: 'Pro' },
                  { id: 'vip', label: 'VIP' },
                ].map(f => (
                  <button key={f.id} className={`seg__opt ${filter===f.id?'is-active':''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
                ))}
              </div>
              <select className="input" style={{height:28, fontSize:11, width: 130}} value={sort} onChange={e => setSort(e.target.value)}>
                <option value="pnl">Sort · 30d PnL</option>
                <option value="sharpe">Sort · Sharpe</option>
                <option value="winRate">Sort · Win Rate</option>
                <option value="followers">Sort · Followers</option>
              </select>
            </>
          }
        >
          <div className="grid-4">
            {filtered.map(s => (
              <div key={s.id} className={`strategy-card ${s.featured ? 'is-featured' : ''}`}>
                {s.featured && <div className="strategy-card__featured">✦ FEATURED</div>}
                <div className="strategy-card__head">
                  <div>
                    <div className="strategy-card__name">{s.name}</div>
                    <div className="strategy-card__author">{s.author}</div>
                  </div>
                  <span className="strategy-card__tag">{s.tag}</span>
                </div>

                <div className="strategy-card__stats">
                  <div className="strategy-card__stat">
                    <span className="strategy-card__stat__k">30d PnL</span>
                    <span className="strategy-card__stat__v" style={{color: s.pnl30 >= 0 ? 'var(--color-trade-long)' : 'var(--color-trade-short)'}}>{s.pnl30 >= 0 ? '+' : ''}{s.pnl30}%</span>
                  </div>
                  <div className="strategy-card__stat">
                    <span className="strategy-card__stat__k">Win Rate</span>
                    <span className="strategy-card__stat__v">{s.winRate}%</span>
                  </div>
                  <div className="strategy-card__stat">
                    <span className="strategy-card__stat__k">Sharpe</span>
                    <span className="strategy-card__stat__v">{s.sharpe}</span>
                  </div>
                  <div className="strategy-card__stat">
                    <span className="strategy-card__stat__k">Max DD</span>
                    <span className="strategy-card__stat__v" style={{color:'var(--color-trade-short)'}}>-{s.maxDD}%</span>
                  </div>
                </div>

                <div className="strategy-card__foot">
                  <span className="followers"><I.User size={9} style={{verticalAlign:'-1px'}}/> {s.followers.toLocaleString()} followers</span>
                  <span className={`sub ${s.subscription}`}>{s.subscription}</span>
                </div>

                <div style={{display:'flex', gap:6}}>
                  <button className="btn btn--xs" style={{flex:1}}><I.Chart size={11}/> Backtest</button>
                  <button className="btn btn--xs btn--primary" style={{flex:1}}><I.Plus size={11}/> Follow</button>
                </div>
              </div>
            ))}
          </div>
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // PORTFOLIO PAGE
  // ============================================================
  window.PortfolioPage = function PortfolioPage({ shellProps }) {
    // 계정 데이터가 갱신되면 재렌더한다. 이 훅이 없으면 실 잔고가 도착해도
    // 화면은 최초 렌더의 목업을 계속 보여준다.
    const account = window.useAccountData ? window.useAccountData() : { status: 'OFFLINE', isLive: false };

    const A = window.QTApp.ALLOCATION;
    const eq = window.QTApp.EQUITY_CURVE;
    const totalValue = A.reduce((a,x) => a + x.value, 0);
    const positions = window.QT.POSITIONS;

    /*
       실데이터 기반 KPI.

       실데이터가 아니면 목업 값을 그대로 쓴다(디자이너 화면을 그대로 보여준다).
       실데이터인데 계산이 불가능하면 null 을 둔다 — 0 으로 채우면 "손익 없음"
       이라는 거짓이 된다.
    */
    const live = (() => {
      if (!account.isLive) {
        return { unrealized: 396.77, realized: 1240.42, marginRatio: 18.4 };
      }
      const sum = (key) =>
        positions.reduce((acc, p) => (Number.isFinite(Number(p[key])) ? acc + Number(p[key]) : acc), 0);

      const unrealized = positions.length > 0 ? sum('unPnl') : 0;
      const realized = positions.length > 0 ? sum('rlzPnl') : 0;

      // 증거금률 = 사용 중 증거금 / 총자산. 거래소가 직접 주지 않아 잔고에서 구한다.
      const used = A.reduce((acc, x) => (Number.isFinite(x.used) ? acc + x.used : acc), 0);
      const marginRatio = totalValue > 0 && used > 0 ? (used / totalValue) * 100 : null;

      return { unrealized, realized, marginRatio };
    })();

    // Donut generation
    const donutSize = 180;
    const donutR = 70;
    const donutC = 2 * Math.PI * donutR;
    let accPct = 0;
    const donutColors = ['#0EA5C4','#5EEAD4','#F0B90B','#7DD3FC','#F472B6','#A78BFA','#94A3B8'];

    // Equity path
    const eqLo = Math.min(...eq.map(p => p.v));
    const eqHi = Math.max(...eq.map(p => p.v));
    const eqRange = eqHi - eqLo || 1;
    const eqW = 800, eqH = 200;
    const eqPath = eq.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * eqW / (eq.length - 1)).toFixed(1)} ${(eqH - ((p.v - eqLo) / eqRange) * (eqH - 20) - 10).toFixed(1)}`).join(' ');
    const eqArea = eqPath + ` L ${eqW} ${eqH} L 0 ${eqH} Z`;

    return (
      <window.PageShell
        {...shellProps}
        title="Portfolio"
        subtitle="Assets · Equity curve · Allocation · Open positions"
        breadcrumb={['Home','Portfolio']}
        actions={
          <>
            {/*
              데이터 출처 표시. 목업을 실데이터로 오해하는 것이 이 화면에서 가장
              위험한 오류다. 배지를 새로 만들지 않고 기존 badge 클래스를 쓴다.
            */}
            <span
              className={`badge ${account.isLive ? 'badge--long' : ''}`}
              title={account.error || t('acct_status_' + String(account.status).toLowerCase())}
            >
              {account.isLive ? t('acct_live') : t('acct_status_' + String(account.status).toLowerCase())}
            </span>
            <button className="btn btn--sm"><I.Camera size={13}/> Export Report</button>
            <button
              className="btn btn--sm"
              title={t('acct_refresh')}
              onClick={() => { if (window.QTAccount) window.QTAccount.refresh(); }}
            >
              <I.Refresh size={13}/>
            </button>
          </>
        }
      >
        {/*
          KPI. 실데이터가 있으면 포지션·잔고에서 계산한다.

          예전에는 세 카드가 하드코딩된 숫자였다(396.77 / 1240.42 / 18.4%).
          실 잔고가 표시되는 화면에 목업 손익이 섞이면 사용자가 그 값을 믿는다.
          계산할 수 없는 값은 '—' 로 두고 delta 를 생략한다 — 모르는 것을
          숫자로 채우지 않는다.
        */}
        <div className="grid-4">
          <window.KPICard label="Total Equity" value={'$' + fmt(totalValue)} delta={account.isLive ? undefined : +3.42} deltaLabel="24h" icon="Wallet" tone="brand"/>
          <window.KPICard
            label="Unrealized PnL"
            value={live.unrealized === null ? '—' : (live.unrealized >= 0 ? '+$' : '-$') + fmt(Math.abs(live.unrealized))}
            delta={account.isLive ? undefined : +3.18}
            deltaLabel="vs entry"
            tone={live.unrealized === null ? undefined : live.unrealized >= 0 ? 'long' : 'short'}
          />
          <window.KPICard
            label="Realized 30d"
            value={live.realized === null ? '—' : (live.realized >= 0 ? '+$' : '-$') + fmt(Math.abs(live.realized))}
            delta={account.isLive ? undefined : +9.7}
            deltaLabel="vs prev 30d"
            tone={live.realized === null ? undefined : live.realized >= 0 ? 'long' : 'short'}
          />
          <window.KPICard
            label="Margin Ratio"
            value={live.marginRatio === null ? '—' : fmt(live.marginRatio, 1) + '%'}
            sub={live.marginRatio === null ? (account.isLive ? t('acct_not_available') : 'Healthy · Liq. at 82%') : undefined}
            icon="Alert"
            tone="warning"
          />
        </div>

        {/* Equity curve + Allocation */}
        <div className="grid-2-1">
          <window.SectionCard
            title="Equity Curve · 30 days"
            actions={
              <div className="seg">
                {['1D','7D','30D','90D','1Y','All'].map(r => (
                  <button key={r} className={`seg__opt ${r==='30D'?'is-active':''}`}>{r}</button>
                ))}
              </div>
            }
          >
            <svg viewBox={`0 0 ${eqW} ${eqH}`} width="100%" height="240" preserveAspectRatio="none">
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35"/>
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* grid */}
              {[0.25, 0.5, 0.75].map(f => (
                <line key={f} x1="0" x2={eqW} y1={eqH*f} y2={eqH*f} stroke="var(--chart-grid)" strokeDasharray="2 4"/>
              ))}
              <path d={eqArea} fill="url(#eqGrad)"/>
              <path d={eqPath} fill="none" stroke="var(--color-brand)" strokeWidth="2"/>
              {/* labels */}
              <text x="4" y="14" fill="var(--color-text-tertiary)" fontFamily="var(--font-mono)" fontSize="10">${fmt(eqHi)}</text>
              <text x="4" y={eqH-4} fill="var(--color-text-tertiary)" fontFamily="var(--font-mono)" fontSize="10">${fmt(eqLo)}</text>
            </svg>
          </window.SectionCard>

          <window.SectionCard title="Allocation" subtitle={`${A.length} assets · Rebalance suggested`}>
            <div style={{display:'flex', justifyContent:'center', marginBottom: 12}}>
              <svg width={donutSize} height={donutSize} viewBox={`0 0 ${donutSize} ${donutSize}`}>
                {A.map((a, i) => {
                  const pctFrac = a.pct / 100;
                  const dash = pctFrac * donutC;
                  const gap = donutC - dash;
                  const rotation = (accPct / 100) * 360 - 90;
                  accPct += a.pct;
                  return (
                    <circle
                      key={a.asset}
                      cx={donutSize/2} cy={donutSize/2} r={donutR}
                      fill="none" stroke={donutColors[i % donutColors.length]}
                      strokeWidth="22"
                      strokeDasharray={`${dash} ${gap}`}
                      transform={`rotate(${rotation} ${donutSize/2} ${donutSize/2})`}
                    />
                  );
                })}
                <text x={donutSize/2} y={donutSize/2 - 4} textAnchor="middle" fontFamily="var(--font-num)" fontSize="18" fontWeight="600" fill="var(--color-text-primary)">${fmtCompact(totalValue)}</text>
                <text x={donutSize/2} y={donutSize/2 + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-text-tertiary)">TOTAL</text>
              </svg>
            </div>
            <div className="donut-legend">
              {A.map((a, i) => (
                <div key={a.asset} className="donut-legend__row">
                  <span className="donut-legend__sw" style={{background: donutColors[i % donutColors.length]}}/>
                  <span>{a.assetKey ? t(a.assetKey) : a.asset}</span>
                  <span className="donut-legend__pct">{a.pct.toFixed(1)}%</span>
                  <span>${fmt(a.value)}</span>
                </div>
              ))}
            </div>
          </window.SectionCard>
        </div>

        {/* Open Positions */}
        <window.SectionCard title="Open Positions" subtitle={`${positions.length} open`} noPadding>
          <window.DataTable
            columns={[
              { key: 'sym', label: 'Symbol', render: r => <strong>{r.symbol.replace('USDT','/USDT')}</strong> },
              { key: 'side', label: 'Side', render: r => <span className={r.side==='long'?'t-long':'t-short'} style={{fontWeight:500}}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key: 'size', label: 'Size', align:'right', render: r => fmt(r.size, 3) },
              { key: 'entry', label: 'Entry', align:'right', render: r => fmt(r.entry, 1) },
              { key: 'mark',  label: 'Mark',  align:'right', render: r => fmt(r.mark, 1) },
              { key: 'liq',   label: 'Liq. Price', align:'right', render: r => <span className="t-warning">{fmt(r.liq, 1)}</span> },
              { key: 'pnl',   label: 'PnL', align:'right', render: r => <span className={r.unPnl >= 0 ? 't-long':'t-short'}>{r.unPnl >= 0 ? '+' : ''}${fmt(r.unPnl)}<span style={{color:'var(--color-text-tertiary)', marginLeft:4}}>({r.unPnlPct.toFixed(1)}%)</span></span> },
              { key: 'act', label: '', align:'right', render: r => (
                <>
                  <button className="tbl-action">TP/SL</button>
                  <button className="tbl-action tbl-action--danger" style={{marginLeft:4}}>Close</button>
                </>
              ) },
            ]}
            rows={positions}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ANALYTICS PAGE — Trade Journal + Performance
  // ============================================================
  window.AnalyticsPage = function AnalyticsPage({ shellProps }) {
    const tj = window.QTApp.TRADE_JOURNAL;
    const wins = tj.filter(t => t.pnl > 0);
    const losses = tj.filter(t => t.pnl < 0);
    const totalPnl = tj.reduce((a,t) => a+t.pnl, 0);
    const winRate = (wins.length / tj.length) * 100;
    const avgWin = wins.reduce((a,t) => a+t.pnl, 0) / (wins.length || 1);
    const avgLoss = losses.reduce((a,t) => a+t.pnl, 0) / (losses.length || 1);

    // Bar heights (win/loss distribution)
    const daysBack = 30;
    const dailyPnl = Array.from({length: daysBack}, (_, i) => {
      const day = tj.filter((_, idx) => idx % daysBack === i);
      return day.reduce((a,t) => a+t.pnl, 0);
    });

    return (
      <window.PageShell
        {...shellProps}
        title="Analytics"
        subtitle="Trade journal · Performance · Behavioral patterns"
        breadcrumb={['Home','Analytics']}
        actions={
          <>
            <button className="btn btn--sm"><I.Camera size={13}/> Export CSV</button>
            <button className="btn btn--sm btn--primary"><I.Sparkles size={13}/> AI Review</button>
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="Total PnL · 10 trades" value={(totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl)} delta={+12.4} deltaLabel="vs prev 10" tone={totalPnl >= 0 ? 'long' : 'short'}/>
          <window.KPICard label="Win Rate" value={winRate.toFixed(0) + '%'} sub={`${wins.length}W · ${losses.length}L`} tone="brand"/>
          <window.KPICard label="Avg Win / Loss" value={`$${fmt(avgWin,0)} / $${fmt(Math.abs(avgLoss),0)}`} sub={`R:R ${(avgWin / Math.abs(avgLoss)).toFixed(2)} : 1`} tone="ai"/>
          <window.KPICard label="Best Trade" value="+$212 · BTC/USDT" sub="2026-08-02 · Long · AI signal" tone="long"/>
        </div>

        <div className="grid-2-1">
          <window.SectionCard title="Daily PnL · 30 days" subtitle="Simulated distribution">
            <svg viewBox="0 0 600 160" width="100%" height="180">
              {[0.25, 0.5, 0.75].map(f => (
                <line key={f} x1="0" x2="600" y1={160*f} y2={160*f} stroke="var(--chart-grid)" strokeDasharray="2 4"/>
              ))}
              {/* zero line */}
              <line x1="0" x2="600" y1="80" y2="80" stroke="var(--color-border-default)"/>
              {dailyPnl.map((v, i) => {
                const h = Math.min(70, Math.abs(v) * 0.3);
                const y = v >= 0 ? 80 - h : 80;
                const barW = 600 / daysBack - 2;
                return (
                  <rect key={i} x={i * (barW + 2) + 1} y={y} width={barW} height={h} fill={v >= 0 ? 'var(--color-trade-long)' : 'var(--color-trade-short)'} opacity="0.8"/>
                );
              })}
              <text x="4" y="14" fontFamily="var(--font-mono)" fontSize="9" fill="var(--color-text-tertiary)">+PnL</text>
              <text x="4" y="156" fontFamily="var(--font-mono)" fontSize="9" fill="var(--color-text-tertiary)">-PnL</text>
            </svg>
          </window.SectionCard>

          <window.SectionCard title="AI Insights" subtitle="Detected patterns">
            <div style={{display:'flex', flexDirection:'column', gap: 10}}>
              <div style={{padding:'10px 12px', background:'var(--color-ai-bg)', borderLeft:'3px solid var(--color-ai)', borderRadius:4, fontSize:12}}>
                <strong>{t('analytics_171e3e')}</strong><br/>
                <span style={{color:'var(--color-text-secondary)'}}>{t('analytics_19b9a2')}</span>
              </div>
              <div style={{padding:'10px 12px', background:'oklch(80% 0.14 75 / 0.10)', borderLeft:'3px solid var(--color-warning)', borderRadius:4, fontSize:12}}>
                <strong>{t('analytics_d6aabf')}</strong><br/>
                <span style={{color:'var(--color-text-secondary)'}}>{t('analytics_4fa8b3')}</span>
              </div>
              <div style={{padding:'10px 12px', background:'oklch(78% 0.14 145 / 0.10)', borderLeft:'3px solid var(--color-success)', borderRadius:4, fontSize:12}}>
                <strong>{t('analytics_c511d6')}</strong><br/>
                <span style={{color:'var(--color-text-secondary)'}}>{t('analytics_4b3b6f')}</span>
              </div>
            </div>
          </window.SectionCard>
        </div>

        <window.SectionCard
          title="Trade Journal"
          subtitle={`${tj.length} recorded trades · Manual + AI-assisted`}
          actions={<button className="btn btn--sm"><I.Plus size={12}/> Manual Entry</button>}
          noPadding
        >
          <window.DataTable
            columns={[
              { key: 'date',  label: 'Date', width: 100 },
              { key: 'sym',   label: 'Symbol', render: r => <strong>{r.sym}</strong> },
              { key: 'side',  label: 'Side', render: r => <span className={r.side==='long'?'t-long':'t-short'}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key: 'entry', label: 'Entry', align:'right', render: r => fmt(r.entry, 2) },
              { key: 'exit',  label: 'Exit',  align:'right', render: r => fmt(r.exit, 2) },
              { key: 'size',  label: 'Size',  align:'right', render: r => fmt(r.size, 3) },
              { key: 'pnl',   label: 'PnL', align:'right', render: r => (
                <span className={r.pnl >= 0 ? 't-long' : 't-short'} style={{fontWeight:500}}>{r.pnl >= 0 ? '+' : ''}${fmt(r.pnl)}<span style={{color:'var(--color-text-tertiary)', marginLeft:4, fontSize:10}}>({r.roi >= 0 ? '+' : ''}{r.roi.toFixed(2)}%)</span></span>
              ) },
              { key: 'mood',  label: 'Mood', render: r => {
                const m = { confident: '😎', neutral: '😐', nervous: '😬' };
                return <span title={r.mood} style={{fontSize:14}}>{m[r.mood] || '·'}</span>;
              }},
              { key: 'tag',   label: 'Tags', render: r => (
                <span style={{display:'inline-flex', gap:3, flexWrap:'wrap'}}>
                  {r.tag.map(tg => <span key={tg} style={{padding:'1px 5px', background:'var(--color-bg-elevated)', borderRadius:3, fontFamily:'var(--font-mono)', fontSize:9, color:'var(--color-text-secondary)'}}>{tg}</span>)}
                </span>
              )},
            ]}
            rows={tj}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // MULTI-CHART PAGE
  // ============================================================
  window.MultiChartPage = function MultiChartPage({ shellProps }) {
    const [layout, setLayout] = useState('2x2');   // 2x2 | 1x2 | 3x2 | 2x3
    const symbols = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT','DOGE/USDT'];
    const [selectedSymbols, setSelectedSymbols] = useState(symbols.slice(0, 4));

    const layoutGrids = {
      '2x2': { cols: 2, rows: 2, count: 4 },
      '1x2': { cols: 2, rows: 1, count: 2 },
      '3x2': { cols: 3, rows: 2, count: 6 },
      '2x3': { cols: 2, rows: 3, count: 6 },
    };
    const cfg = layoutGrids[layout];

    return (
      <window.PageShell
        {...shellProps}
        title="Multi-Chart"
        subtitle={`View up to ${cfg.count} symbols simultaneously · Synced crosshair · Independent timeframes`}
        breadcrumb={['Home','Multi-Chart']}
        actions={
          <>
            <div className="seg">
              {Object.keys(layoutGrids).map(l => (
                <button key={l} className={`seg__opt ${layout===l?'is-active':''}`} onClick={() => setLayout(l)}>{l}</button>
              ))}
            </div>
            <button className="btn btn--sm"><I.Camera size={13}/></button>
            <button className="btn btn--sm"><I.Expand size={13}/></button>
          </>
        }
        fullBleed
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cfg.cols}, 1fr)`,
          gridTemplateRows: `repeat(${cfg.rows}, 1fr)`,
          gap: 6,
          padding: 6,
          height: '100%',
          background: 'var(--color-bg-app)',
        }}>
          {Array.from({length: cfg.count}).map((_, i) => {
            const sym = selectedSymbols[i] || symbols[i % symbols.length];
            return (
              <div key={i} style={{background:'var(--color-bg-panel)', border:'1px solid var(--color-border-subtle)', borderRadius:6, display:'flex', flexDirection:'column', overflow:'hidden', minHeight: 240}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 10px', borderBottom:'1px solid var(--color-border-subtle)'}}>
                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                    <select
                      style={{background:'transparent', border:0, color:'var(--color-text-primary)', fontSize:13, fontWeight:600, fontFamily:'var(--font-en)', cursor:'pointer'}}
                      value={sym}
                      onChange={e => { const next = [...selectedSymbols]; next[i] = e.target.value; setSelectedSymbols(next); }}
                    >
                      {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="badge badge--perp">PERP</span>
                  </div>
                  <div className="seg" style={{fontSize:10}}>
                    {['1m','5m','15m','1H','4H'].map(tf => (
                      <button key={tf} className={`seg__opt ${tf==='15m'?'is-active':''}`} style={{height:20, padding:'0 5px', fontSize:10}}>{tf}</button>
                    ))}
                  </div>
                </div>
                <div style={{flex:1, minHeight:0, position:'relative'}}>
                  <window.MiniChart symbol={sym} timeframe="15m" hideHeader={true}/>
                </div>
              </div>
            );
          })}
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // WALLET PAGE — Exchange Connect + Referrals + Balances
  // ============================================================
  window.WalletPage = function WalletPage({ shellProps }) {
    const EX = window.QTApp.EXCHANGES;
    const USER = window.QTApp.USER;
    const [tab, setTab] = useState('exchanges');   // exchanges | balances | deposit | withdraw
    const [connectingEx, setConnectingEx] = useState(null); // exchange 객체

    return (
      <window.PageShell
        {...shellProps}
        title="Wallet"
        subtitle={t('wallet_95195c')}
        breadcrumb={['Home','Wallet']}
        actions={
          <>
            <button className="btn btn--sm"><I.Refresh size={13}/> Sync</button>
            <button className="btn btn--sm btn--primary"><I.Plus size={13}/> Add Exchange</button>
          </>
        }
      >
        {/* Tab bar */}
        <div style={{display:'flex', gap:0, borderBottom:'1px solid var(--color-border-subtle)', marginBottom: -12}}>
          {[
            { id:'exchanges', label:t('wallet_ed546c'),   icon:'Wifi' },
            { id:'balances',  label:t('wallet_f23807'),     icon:'Wallet' },
            { id:'deposit',   label:t('wallet_b9ca11'),          icon:'Down' },
            { id:'withdraw',  label:t('wallet_972169'),          icon:'Up' },
          ].map(t => {
            const Ic = I[t.icon] || I.Grid;
            return (
              <button
                key={t.id}
                className={`tab ${tab===t.id?'is-active':''}`}
                onClick={() => setTab(t.id)}
                style={{padding:'12px 20px'}}
              >
                <Ic size={13}/> {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'exchanges' && (
          <>
            <div style={{padding:'16px 20px', background:'var(--color-brand-subtle)', border:'1px solid var(--color-brand)', borderRadius: 6, display:'flex', alignItems:'center', gap: 14, marginTop: 24}}>
              <div style={{width:40, height:40, borderRadius:8, background:'var(--color-brand)', color:'var(--color-text-inverse)', display:'inline-flex', alignItems:'center', justifyContent:'center'}}>
                <I.Sparkles size={20}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:14, fontWeight:600, marginBottom:2}}>{t('wallet_ea90da')}</div>
                <div style={{fontSize:12, color:'var(--color-text-secondary)'}}>
                  {t('wallet_ceef92')} <strong>{t('wallet_cbe9e9')}</strong>{t('wallet_fc0c97')}
                </div>
              </div>
            </div>

            <div className="grid-3">
              {EX.map(ex => {
                const isConnected = USER.connectedExchanges.includes(ex.id);
                return (
                  <div key={ex.id} className={`exchange-card ${isConnected ? 'is-connected' : ''} ${ex.recommended ? 'is-recommended' : ''}`}>
                    <div className="exchange-card__head">
                      <div className="exchange-card__logo" style={{background: ex.logoBg, color: ex.logoColor}}>{ex.logoText}</div>
                      <div style={{flex:1, minWidth:0}}>
                        <div className="exchange-card__name">{ex.name}</div>
                        <div className="exchange-card__market">{ex.market}</div>
                      </div>
                      <span className={`exchange-card__status ${ex.status}`}>{ex.status === 'coming-soon' ? 'SOON' : ex.status.toUpperCase()}</span>
                    </div>

                    <div className="exchange-card__products">
                      {ex.supportedProducts.map(p => <span key={p} className="exchange-card__product-chip">{p}</span>)}
                    </div>

                    <div className="exchange-card__referral">
                      <I.Sparkles size={13} style={{color:'var(--color-brand)', flexShrink:0}}/>
                      <span className="exchange-card__referral__note">{window.QTI18n ? window.QTI18n.formatRebate(ex.referralRebate) : ''}</span>
                    </div>

                    <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                      Required: {ex.required.join(' · ')}
                      <br/>Latency ~{ex.minLatency}ms · <a href={ex.apiDocs} target="_blank" style={{color:'var(--color-brand)'}}>API docs ↗</a>
                    </div>

                    <div className="exchange-card__actions">
                      <a
                        href={ex.referral}
                        target="_blank"
                        className="btn btn--sm"
                        style={{flex: isConnected ? 1 : 1.4}}
                      >
                        <I.User size={11}/> {t('wallet_ecb4cc')}
                      </a>
                      {isConnected ? (
                        <button className="btn btn--sm btn--primary" style={{flex:1}} onClick={() => setConnectingEx(ex)}>
                          <I.Check size={11}/> Connected
                        </button>
                      ) : (
                        <button className="btn btn--sm btn--primary" style={{flex:1}} disabled={ex.status === 'coming-soon'} onClick={() => setConnectingEx(ex)}>
                          <I.Plus size={11}/> Connect API
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'balances' && (
          <window.SectionCard title={t('wallet_f23807')} subtitle={`Across ${USER.connectedExchanges.length} connected exchanges`} noPadding>
            <window.DataTable
              columns={[
                { key: 'asset', label: 'Asset', render: r => <strong>{r.assetKey ? t(r.assetKey) : r.asset}</strong> },
                { key: 'value', label: 'Value', align:'right', render: r => '$' + fmt(r.value) },
                { key: 'pct',   label: 'Allocation', align:'right', render: r => r.pct.toFixed(1) + '%' },
                { key: 'chg',   label: '24h', align:'right', render: r => <span className={r.chg24h >= 0 ? 't-long' : 't-short'}>{r.chg24h >= 0 ? '+' : ''}{r.chg24h.toFixed(2)}%</span> },
                { key: 'ex',    label: 'Held on', render: () => <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>Binance · Bitget</span> },
                { key: 'act',   label: '', align:'right', render: () => <><button className="tbl-action">Send</button> <button className="tbl-action">Receive</button></> },
              ]}
              rows={window.QTApp.ALLOCATION}
            />
          </window.SectionCard>
        )}

        {tab === 'deposit' && (
          <div style={{textAlign:'center', padding:'30px'}}>
            <a className="btn btn--primary btn--lg" href="#/wallet/deposit">{t('wallet_57177e')}</a>
          </div>
        )}
        {tab === 'withdraw' && (
          <div style={{textAlign:'center', padding:'30px'}}>
            <a className="btn btn--primary btn--lg" href="#/wallet/withdraw">{t('wallet_d3cdff')}</a>
          </div>
        )}

        {/* Exchange Connect Wizard modal */}
        {connectingEx && (
          <window.ExchangeConnectWizard
            exchange={connectingEx}
            onClose={() => setConnectingEx(null)}
            onSuccess={(ex, form) => {
              console.log('Connected', ex.id, form);
            }}
          />
        )}
      </window.PageShell>
    );
  };

  // ============================================================
  // SETTINGS PAGE
  // ============================================================
  window.SettingsPage = function SettingsPage({ shellProps }) {
    const [tab, setTab] = useState('profile');
    const USER = window.QTApp.USER;

    return (
      <window.PageShell
        {...shellProps}
        title="Settings"
        subtitle={t('settings_2d430b')}
        breadcrumb={['Home','Settings']}
      >
        <div style={{display:'grid', gridTemplateColumns:'220px 1fr', gap: 24, alignItems: 'start'}}>
          <div style={{display:'flex', flexDirection:'column', gap: 2}}>
            {[
              { id:'profile',   label:t('settings_14fab1'),      icon:'User' },
              { id:'security',  label:t('settings_cfaa68'),  icon:'Lock' },
              { id:'notif',     label:t('settings_e29d14'),        icon:'Bell' },
              { id:'api',       label:'API Keys',    icon:'Wallet' },
              { id:'prefs',     label:t('settings_643822'),    icon:'Cog' },
              { id:'a11y',      label:t('settings_3a4173'),      icon:'Eye' },
              { id:'danger',    label:t('settings_5a4346'),   icon:'Alert' },
            ].map(t => {
              const Ic = I[t.icon] || I.Grid;
              return (
                <button
                  key={t.id}
                  className={`sb-item-v2 ${tab === t.id ? 'is-active' : ''}`}
                  style={{padding:'10px 12px'}}
                  onClick={() => setTab(t.id)}
                >
                  <span className="sb-item-v2__icon"><Ic size={14}/></span>
                  <span className="sb-item-v2__label">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div>
            {tab === 'profile' && (
              <window.SectionCard title={t('settings_0d64b7')}>
                <div style={{display:'flex', alignItems:'center', gap: 16, marginBottom: 16}}>
                  <div style={{width:64, height:64, borderRadius: '50%', background:'var(--color-brand)', color:'var(--color-text-inverse)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize: 22, fontWeight: 600}}>{USER.avatarInitial}</div>
                  <div>
                    <div style={{fontSize:16, fontWeight:600}}>{USER.name}</div>
                    <div style={{fontSize:12, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{USER.id}</div>
                    <div style={{marginTop:6, display:'flex', gap:6}}>
                      <span className="badge badge--success"><I.Check size={9}/> KYC Level {USER.kycLevel}</span>
                      <span className="badge badge--neutral">{USER.tier}</span>
                    </div>
                  </div>
                  <button className="btn btn--sm" style={{marginLeft:'auto'}}>{t('settings_b7909f')}</button>
                </div>

                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginTop: 16}}>
                  <div className="input-group"><span className="input-group__label">{t('settings_9aa18e')}</span><input defaultValue={USER.name}/></div>
                  <div className="input-group"><span className="input-group__label">{t('settings_3c3776')}</span><input defaultValue={USER.email}/></div>
                  <div className="input-group"><span className="input-group__label">{t('settings_84b6d0')}</span><input defaultValue="Republic of Korea"/></div>
                  <div className="input-group"><span className="input-group__label">{t('settings_76245e')}</span><input defaultValue="Asia/Seoul (UTC+9)"/></div>
                </div>
                <div style={{marginTop:16, display:'flex', gap:8, justifyContent:'flex-end'}}>
                  <button className="btn btn--sm">{t('settings_19b2d1')}</button>
                  <button className="btn btn--sm btn--primary">{t('settings_1f1712')}</button>
                </div>
              </window.SectionCard>
            )}

            {tab === 'security' && (
              <div style={{display:'flex', flexDirection:'column', gap:16}}>
                <window.SectionCard title={t('settings_965a8c')}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--color-border-subtle)'}}>
                    <div>
                      <div style={{fontWeight:500}}>{t('settings_819738')}</div>
                      <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('settings_9074af')}</div>
                    </div>
                    <button className="btn btn--sm">{t('settings_ce0109')}</button>
                  </div>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--color-border-subtle)'}}>
                    <div>
                      <div style={{fontWeight:500}}>{t('settings_a5d18c')}</div>
                      <div style={{fontSize:11, color:'var(--color-success)'}}>{t('settings_e33c1f')}</div>
                    </div>
                    <button className="btn btn--sm">{t('settings_ee3963')}</button>
                  </div>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0'}}>
                    <div>
                      <div style={{fontWeight:500}}>{t('settings_872543')}</div>
                      <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>+82 10-****-1234</div>
                    </div>
                    <label className="switch"><input type="checkbox" defaultChecked/><span className="switch__track"><span className="switch__thumb"/></span></label>
                  </div>
                </window.SectionCard>

                <window.SectionCard title={t('settings_4bd28a')} subtitle={t('settings_2ac6ff')}>
                  <div style={{display:'flex', flexDirection:'column', gap: 6}}>
                    {[
                      { name:'Chrome · Seoul, KR', when:t('settings_b7a78a'), ok:true },
                      { name:'iPhone Safari · Seoul, KR', when:'2h ago', ok:true },
                      { name:'Firefox · Tokyo, JP', when:t('settings_3c8a15'), ok:false },
                    ].map((s, i) => (
                      <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', border:'1px solid var(--color-border-subtle)', borderRadius: 4, background:'var(--color-bg-surface)'}}>
                        <div>
                          <div style={{fontSize:12, fontWeight:500}}>{s.name}</div>
                          <div style={{fontSize:10, color:s.ok ? 'var(--color-text-tertiary)' : 'var(--color-warning)', fontFamily:'var(--font-mono)'}}>{s.when}</div>
                        </div>
                        <button className="btn btn--xs btn--danger">{t('settings_cafdc6')}</button>
                      </div>
                    ))}
                  </div>
                </window.SectionCard>
              </div>
            )}

            {tab === 'api' && (
              <window.SectionCard
                title="API Keys"
                subtitle={t('settings_8eb853')}
                actions={<button className="btn btn--sm btn--primary"><I.Plus size={12}/> Add Key</button>}
                noPadding
              >
                <div className="api-key-row" style={{background:'var(--color-bg-panel)', color:'var(--color-text-tertiary)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500}}>
                  <span/><span>Label / Exchange</span><span>Key</span><span>Perms</span><span>Last used</span><span/>
                </div>
                {USER.apiKeys.map(k => {
                  const ex = window.QTApp.EXCHANGES.find(e => e.id === k.exchange);
                  return (
                    <div key={k.id} className="api-key-row">
                      <div className="exchange-card__logo" style={{width:26, height:26, borderRadius:5, fontSize:10, background:ex.logoBg, color:ex.logoColor}}>{ex.logoText}</div>
                      <div>
                        <div style={{fontWeight:500}}>{k.label}</div>
                        <div style={{fontSize:10, color:'var(--color-text-tertiary)'}}>{ex.name}</div>
                      </div>
                      <div className="api-key-row__mask">••••••{k.id.slice(-4)}</div>
                      <div className="api-key-row__perms">
                        {k.permissions.map(p => <span key={p} className="api-key-row__perm-chip">{p}</span>)}
                      </div>
                      <div style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{timeAgo(new Date(k.lastUsed).getTime())}</div>
                      <div style={{display:'inline-flex', gap:4}}>
                        <button className="tbl-action">Edit</button>
                        <button className="tbl-action tbl-action--danger">Revoke</button>
                      </div>
                    </div>
                  );
                })}
                <div style={{padding:'12px 16px', fontSize:11, color:'var(--color-text-tertiary)', background:'var(--color-bg-surface)', borderTop:'1px solid var(--color-border-subtle)'}}>
                  🔒 <strong>{t('sec_tip_label')}</strong> {t('sec_tip_a')}<em>{t('sec_tip_perm_allow')}</em>{t('sec_tip_b')}<em>{t('sec_tip_perm_deny')}</em>{t('sec_tip_c')}
                </div>
              </window.SectionCard>
            )}

            {tab === 'notif' && (
              <window.SectionCard title={t('settings_16930c')}>
                {[
                  { k:'signal', label:t('settings_b83309') },
                  { k:'order',  label:t('settings_37397b') },
                  { k:'risk',   label:t('settings_716902') },
                  { k:'promo',  label:t('settings_2207de') },
                  { k:'notice', label:t('settings_15d236') },
                ].map(r => (
                  <div key={r.k} style={{display:'grid', gridTemplateColumns:'1fr auto auto auto auto', gap: 12, padding: '10px 0', borderBottom:'1px solid var(--color-border-subtle)', alignItems:'center'}}>
                    <span style={{fontSize:12}}>{r.label}</span>
                    <label className="chk"><input type="checkbox" defaultChecked/><span className="chk__box"><I.Check size={10}/></span>In-app</label>
                    <label className="chk"><input type="checkbox" defaultChecked={r.k !== 'promo'}/><span className="chk__box"><I.Check size={10}/></span>Email</label>
                    <label className="chk"><input type="checkbox" defaultChecked={r.k === 'risk'}/><span className="chk__box"><I.Check size={10}/></span>SMS</label>
                    <label className="chk"><input type="checkbox" defaultChecked={r.k === 'signal' || r.k === 'risk'}/><span className="chk__box"><I.Check size={10}/></span>Push</label>
                  </div>
                ))}
              </window.SectionCard>
            )}

            {tab === 'prefs' && (
              <window.SectionCard title={t('settings_643822')}>
                <div style={{display:'flex', flexDirection:'column', gap: 20}}>
                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>Theme</div>
                    <div className="seg" style={{width:'100%'}}>
                      <button className="seg__opt is-active" style={{flex:1}}><I.Moon size={11}/> Dark</button>
                      <button className="seg__opt" style={{flex:1}}><I.Sun size={11}/> Light</button>
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>Density</div>
                    <div className="seg" style={{width:'100%'}}>
                      <button className="seg__opt is-active" style={{flex:1}}>Comfortable</button>
                      <button className="seg__opt" style={{flex:1}}>Compact</button>
                      <button className="seg__opt" style={{flex:1}}>Dense</button>
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>Language</div>
                    <div className="seg" style={{width:'100%'}}>
                      <button className="seg__opt is-active" style={{flex:1}}>{t('settings_6e081b')}</button>
                      <button className="seg__opt" style={{flex:1}}>English</button>
                      <button className="seg__opt" style={{flex:1}}>日本語</button>
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>Number Format</div>
                    <div className="seg" style={{width:'100%'}}>
                      <button className="seg__opt is-active" style={{flex:1}}>Standard (18,240,000)</button>
                      <button className="seg__opt" style={{flex:1}}>Compact (18.24M)</button>
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>Default Trading View</div>
                    <select className="input" style={{width: '100%'}} defaultValue="standard-trader">
                      <option value="standard-trader">Standard Trader</option>
                      <option value="ai-workspace">AI Workspace</option>
                      <option value="chart-focus">Chart Focus</option>
                      <option value="scalper">Scalper</option>
                      <option value="multi-chart">Multi-Chart</option>
                    </select>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>Default Timeframe</div>
                    <div className="seg" style={{width:'100%'}}>
                      {['1m','5m','15m','30m','1H','4H','1D'].map(tf => (
                        <button key={tf} className={`seg__opt ${tf==='15m'?'is-active':''}`} style={{flex:1}}>{tf}</button>
                      ))}
                    </div>
                  </div>

                  <div style={{display:'flex', gap: 8, justifyContent:'flex-end'}}>
                    <button className="btn btn--sm">{t('settings_a2d19e')}</button>
                    <button className="btn btn--sm btn--primary">{t('settings_1f1712')}</button>
                  </div>
                </div>
              </window.SectionCard>
            )}

            {tab === 'a11y' && (
              <window.SectionCard title={t('settings_3a4173')}>
                <div style={{display:'flex', flexDirection:'column', gap: 16}}>
                  {[
                    { k:'reduce-motion',   label:t('settings_12d487'),                desc:t('settings_dc3d8a') },
                    { k:'high-contrast',   label:t('settings_02bb1c'),              desc:t('settings_a63c4a') },
                    { k:'large-text',      label:t('settings_c56d3c'),                  desc:t('settings_bbb99f') },
                    { k:'screen-reader',   label:t('settings_625fc6'),       desc:t('settings_da0cf0') },
                    { k:'keyboard-only',   label:t('settings_c35257'),         desc:t('settings_4599e3') },
                    { k:'color-blind',     label:t('settings_a5d169'),                desc:t('settings_3f9048') },
                    { k:'focus-indicator', label:t('settings_816538'),          desc:t('settings_fa2fee') },
                  ].map(r => (
                    <div key={r.k} style={{display:'flex', alignItems:'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)'}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13, fontWeight: 500}}>{r.label}</div>
                        <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:2}}>{r.desc}</div>
                      </div>
                      <label className="switch"><input type="checkbox" defaultChecked={r.k === 'focus-indicator'}/><span className="switch__track"><span className="switch__thumb"/></span></label>
                    </div>
                  ))}
                </div>

                <div className="auth-alert auth-alert--info" style={{marginTop: 12}}>
                  <I.Info size={12}/>
                  <div>{t('a11y_a')}<strong>{t('a11y_standard')}</strong>{t('a11y_b')}<code>prefers-reduced-motion</code>{t('a11y_c')}</div>
                </div>
              </window.SectionCard>
            )}

            {tab === 'danger' && (
              <div style={{display:'flex', flexDirection:'column', gap: 16}}>
                <window.SectionCard title={t('settings_be6117')}>
                  <div style={{display:'flex', flexDirection:'column', gap: 12}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)'}}>
                      <div>
                        <div style={{fontWeight:500}}>{t('settings_2508a1')}</div>
                        <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('settings_d15b63')}</div>
                      </div>
                      <button className="btn btn--sm"><I.Camera size={12}/> {t('settings_74e36c')}</button>
                    </div>

                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '10px 0'}}>
                      <div>
                        <div style={{fontWeight:500}}>{t('settings_0207e4')}</div>
                        <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('settings_c523ec')}</div>
                      </div>
                      <button className="btn btn--sm"><I.Camera size={12}/> Export</button>
                    </div>
                  </div>
                </window.SectionCard>

                <window.SectionCard title={t('settings_f1d559')}>
                  <div style={{display:'flex', flexDirection:'column', gap: 12}}>
                    <div style={{padding: 12, background: 'oklch(80% 0.14 75 / 0.10)', border:'1px solid var(--color-warning)', borderRadius: 6}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        <div>
                          <div style={{fontWeight:600, color:'var(--color-warning)'}}>{t('settings_7cbf79')}</div>
                          <div style={{fontSize:11, color:'var(--color-text-secondary)', marginTop:2}}>{t('settings_4957e1')}</div>
                        </div>
                        <button className="btn btn--sm">{t('settings_340d4e')}</button>
                      </div>
                    </div>

                    <div style={{padding: 12, background: 'oklch(64% 0.20 25 / 0.10)', border:'1px solid var(--color-danger)', borderRadius: 6}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        <div>
                          <div style={{fontWeight:600, color:'var(--color-danger)'}}>{t('settings_009e27')}</div>
                          <div style={{fontSize:11, color:'var(--color-text-secondary)', marginTop:2}}>{t('settings_560adc')}</div>
                        </div>
                        <button className="btn btn--sm btn--danger">{t('settings_254a82')}</button>
                      </div>
                    </div>

                    <div className="auth-alert auth-alert--warning" style={{marginTop: 8}}>
                      <I.Alert size={12}/>
                      <div>{t('del_warn_a')}<strong>{t('del_warn_em')}</strong>{t('del_warn_b')}</div>
                    </div>
                  </div>
                </window.SectionCard>
              </div>
            )}
          </div>
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // NOTIFICATIONS PAGE
  // ============================================================
  window.NotificationsPage = function NotificationsPage({ shellProps }) {
    const N = window.QTApp.NOTIFICATIONS;
    const [filter, setFilter] = useState('all');
    const filtered = filter === 'all' ? N : filter === 'unread' ? N.filter(x => x.unread) : N.filter(x => x.kind === filter);

    return (
      <window.PageShell
        {...shellProps}
        title="Notifications"
        subtitle={`${N.filter(x=>x.unread).length} unread · ${N.length} total`}
        breadcrumb={['Home','Notifications']}
        actions={
          <>
            <button className="btn btn--sm">{t('notifications_f6bc37')}</button>
            <button className="btn btn--sm">{t('notifications_f53a6e')}</button>
          </>
        }
      >
        <window.SectionCard
          title="Inbox"
          actions={
            <div className="seg">
              {[
                { id:'all', label:'All' },
                { id:'unread', label:'Unread' },
                { id:'signal', label:'Signals' },
                { id:'order', label:'Orders' },
                { id:'risk', label:'Risk' },
                { id:'notice', label:'Notices' },
              ].map(f => (
                <button key={f.id} className={`seg__opt ${filter===f.id?'is-active':''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
            </div>
          }
          noPadding
        >
          {filtered.map(n => (
            <div key={n.id} className={`notif-item ${n.unread ? 'is-unread' : ''}`}>
              <div className={`notif-item__icon ${n.kind}`}>
                {n.kind === 'signal' ? <I.Sparkles size={14}/> :
                 n.kind === 'order' ? <I.Check size={14}/> :
                 n.kind === 'risk' ? <I.Alert size={14}/> :
                 n.kind === 'system' ? <I.Wifi size={14}/> :
                 n.kind === 'promo' ? <I.Zap size={14}/> :
                 <I.Bell size={14}/>}
              </div>
              <div className="notif-item__body notif-item__dot">
                <div className="notif-item__title">{n.title}</div>
                <div className="notif-item__desc">{n.body}</div>
              </div>
              <div className="notif-item__time">{timeAgo(n.time)}</div>
            </div>
          ))}
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // ORDER HISTORY PAGE
  // ============================================================
  window.OrderHistoryPage = function OrderHistoryPage({ shellProps }) {
    const orders = [
      ...window.QT.OPEN_ORDERS.map(o => ({...o, status: o.status || 'pending'})),
      ...window.QTApp.TRADE_JOURNAL.map(t => ({
        id: 'fill-' + t.id, symbol: t.sym.replace('/','') , side: t.side, type: 'LIMIT',
        price: t.entry, amount: t.size, filled: t.size, time: new Date(t.date).getTime(),
        status: 'filled', pnl: t.pnl,
      })),
    ].sort((a,b) => b.time - a.time);

    return (
      <window.PageShell
        {...shellProps}
        title="Order History"
        subtitle={t('order_history_ea8391')}
        breadcrumb={['Home','Order History']}
        actions={
          <>
            <select className="input" style={{height:28, fontSize:11, width:120}}>
              <option>All symbols</option>
              <option>BTC/USDT</option>
              <option>ETH/USDT</option>
            </select>
            <button className="btn btn--sm"><I.Camera size={13}/> Export CSV</button>
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="Total Orders" value={orders.length} sub="Last 30 days"/>
          <window.KPICard label="Fill Rate" value="87%" sub="↑ 2.4% vs prev" tone="brand"/>
          <window.KPICard label="Avg Slippage" value="0.023%" sub="Excellent" tone="long"/>
          <window.KPICard label="Total Fees" value="$18.42" sub="Maker: 62% · Taker: 38%"/>
        </div>

        <window.SectionCard title="Orders" noPadding>
          <window.DataTable
            columns={[
              { key: 'time',   label: 'Time', width: 120, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{new Date(r.time).toLocaleString('en-GB', {hour12:false})}</span> },
              { key: 'sym',    label: 'Symbol', render: r => <strong>{(r.symbol || '').replace('USDT','/USDT')}</strong> },
              { key: 'side',   label: 'Side', render: r => <span className={r.side==='long'?'t-long':'t-short'} style={{fontWeight:500}}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key: 'type',   label: 'Type' },
              { key: 'price',  label: 'Price', align:'right', render: r => fmt(r.price, r.price >= 100 ? 1 : 4) },
              { key: 'amount', label: 'Amount', align:'right', render: r => fmt(r.amount, 3) },
              { key: 'filled', label: 'Filled', align:'right', render: r => fmt(r.filled, 3) + '/' + fmt(r.amount, 3) },
              { key: 'status', label: 'Status', render: r => <span className={`status-pill status-pill--${r.status === 'filled' ? 'ok' : r.status === 'partial' ? 'warn' : 'neutral'}`}>{r.status.toUpperCase()}</span> },
              { key: 'pnl',    label: 'PnL', align:'right', render: r => r.pnl != null ? <span className={r.pnl >= 0 ? 't-long' : 't-short'} style={{fontWeight:500}}>{r.pnl >= 0 ? '+' : ''}${fmt(r.pnl)}</span> : <span style={{color:'var(--color-text-tertiary)'}}>—</span> },
            ]}
            rows={orders}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };
})();
