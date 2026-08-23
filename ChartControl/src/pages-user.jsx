/* ============================================================
   User Pages
   ------------------------------------------------------------
   - MarketsPage        /markets
   - AIStrategiesPage   /ai-strategies
   - PortfolioPage      /portfolio
   - AnalyticsPage      /analytics
   - WalletPage         /wallet          (Exchange connect + Referrals)
   - SettingsPage       /settings        (Profile · Security · Notifications · API keys)
   - NotificationsPage  /notifications
   - OrderHistoryPage   /order-history
   ============================================================ */

(function () {
  const { useState, useEffect, useMemo } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const _useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
  const I = window.Icons;
  const { fmt, fmtCompact } = window.QTFmt;

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
    const [sort, _setSort] = useState({ key: 'vol', dir: 'desc' });
    const [view, setView] = useState('table'); // table | heatmap

    /*
       ★ 목록과 즐겨찾기를 QTMarkets 한 곳에서 받는다.

         전에는 `window.QT.MARKETS`(선물 카탈로그)를 직접 읽었다. 그래서 현물
         모드에서도 선물 종목이 나왔고, 즐겨찾기 별은 목업의 고정 플래그였다.
         마켓 화면과 Market Watch 가 같은 출처를 보므로 두 곳이 어긋나지 않는다.
    */
    const mkSrc = window.QTMarkets ? window.QTMarkets.use() : { rows: (window.QT && window.QT.MARKETS) || [], market: 'futures', loading: false, failed: false };
    /*
       'Filter' 버튼 상태 — 즐겨찾기만 보기.

       ★★ 전에는 onClick 이 없어서 눌러도 아무 일이 없었다. 별도 필터 화면을
         새로 만들지 않고 **이미 있는 즐겨찾기**를 재사용한다 — 목록에 별 표시가
         이미 있고(toggleFav), 가장 자주 쓰는 좁히기다.
    */
    const [favOnly, setFavOnly] = useState(false);
    const allMarkets = mkSrc.rows;
    const markets = favOnly && window.QTMarkets && window.QTMarkets.isFav
      ? allMarkets.filter((r) => window.QTMarkets.isFav(r.base + r.quote, mkSrc.market))
      : allMarkets;
    // 실시세가 QT.MARKETS 를 제자리 갱신하므로, 재계산 트리거가 필요하다.
    const liveVersion = window.QTLive ? window.QTLive.useLiveVersion() : 0;

    /*
       미상장 심볼 판정.

       ★★ 거래소에 없는 심볼(예: TON)은 실시세가 덮어쓰지 못해 **목업 값이
         그대로 남는다.** live-market.js 는 `dataSource='mock'` 으로 표시해
         두지만, 화면이 그 플래그를 무시하면 사용자는 6.42 를 실제 가격으로
         읽고 'Trade' 를 누른다 — 거래할 수 없는 종목이다.

       ★ 행이나 버튼을 지우지 않는다(디자이너 UI 계약). 값만 `—` 로 바꾸고
         왜 없는지 뱃지로 알린다.

       ★ 미리보기(백엔드 없음)에서는 목업 값을 그대로 보여준다 —
         디자이너가 자기 화면을 확인할 수 있어야 한다.
    */
    const realService = window.QTMockPolicy ? window.QTMockPolicy.isRealService() : false;
    const unlisted = (r) => realService && r && r.dataSource === 'mock';
    /*
       상장 시각. 'New' 탭이 실제 신규 상장을 보여주려면 필요하다.

       ★★ 전에는 `list.slice(-8)` — **목록의 마지막 8개**였다. 그것은 카탈로그
         순서일 뿐 상장 순서가 아니고, 거래소에 상장되지 않은 심볼(TON)까지
         '신규' 로 올라갔다. 이용자는 그것을 새로 생긴 종목이라고 믿는다.

       ★ 값을 받지 못하면 'New' 정렬을 하지 않고 그 사실을 알린다. 임의 순서를
         '신규' 라고 부르지 않는다.
    */
    const [listedAt, setListedAt] = useState(null);   // { SYMBOL: ms } | null
    useEffect(() => {
      const api = window.QTApi;
      if (!api || !api.rest || !api.rest.contractSpecs) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return undefined;
      let cancelled = false;
      api.rest.contractSpecs()
        .then((r) => {
          if (cancelled) return;
          const rows = Array.isArray(r && r.data) ? r.data : [];
          const map = {};
          for (const x of rows) {
            if (x && x.symbol && Number(x.firstOpenDate) > 0) map[String(x.symbol)] = Number(x.firstOpenDate);
          }
          setListedAt(Object.keys(map).length ? map : null);
        })
        .catch(() => { /* 못 받으면 null 로 남는다 */ });
      return () => { cancelled = true; };
    }, []);

    const filtered = useMemo(() => {
      let list = [...markets];
      if (tab === 'Favorites') list = list.filter(m => m.fav);
      /*
         ★ 상승·하락 기준을 대칭으로 둔다.

           전에는 Gainers 가 `> 2`, Losers 가 `< -0.5` 였다. 그래서 +1% 인 종목은
           **어느 탭에도 나오지 않았다.** 임의로 정한 문턱 때문에 종목이 사라지면
           이용자는 목록이 잘못됐다고 생각한다. 오른 것은 오름, 내린 것은 내림이다.
      */
      /*
         ★ 미상장 심볼은 순위에서 제외한다.

           그 종목은 값이 전부 '—' 인데도 목업에서 남은 변동률 때문에 상승률
           1위로 올라왔다(실측: TON 이 Gainers 첫 줄). 실데이터가 없는 종목을
           순위에 넣으면 그 순위 자체가 거짓이 된다.
      */
      else if (tab === 'Gainers') list = list.filter(m => !unlisted(m) && Number(m.chg24h) > 0);
      else if (tab === 'Losers')  list = list.filter(m => !unlisted(m) && Number(m.chg24h) < 0);
      else if (tab === 'New') {
        if (!listedAt) list = [];
        else {
          list = list
            .filter(m => !unlisted(m) && listedAt[(m.base + m.quote).toUpperCase()])
            .sort((a, b) => listedAt[(b.base + b.quote).toUpperCase()] - listedAt[(a.base + a.quote).toUpperCase()])
            .slice(0, 12);
        }
      }
      if (q) list = list.filter(m => m.base.toLowerCase().includes(q.toLowerCase()));
      // 'New' 는 상장 시각 순서가 의미이므로 공통 정렬을 덮어쓰지 않는다.
      if (tab !== 'New') {
        list.sort((a,b) => {
          const dir = sort.dir === 'asc' ? 1 : -1;
          const k = sort.key === 'chg' ? 'chg24h' : sort.key === 'price' ? 'price' : 'vol24h';
          return (a[k] - b[k]) * dir;
        });
      }
      return list;
    }, [q, tab, sort, markets, liveVersion, listedAt]);

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
        title={t('nav_markets')}
        subtitle={(() => {
          /* ★ "21 pairs · Live mock stream" 이 하드코딩돼 있었다. 심볼 수가
               바뀌어도 21 로 남고, 실서비스에서도 "mock stream" 이라고 적혀
               있었다. 실제 상태를 센다. */
          const total = markets.length;
          const notListed = markets.filter(m => unlisted(m)).length;
          if (!realService) return t('mk_sub_preview', { n: total });
          return notListed > 0
            ? t('mk_sub_partial', { live: total - notListed, total, n: notListed })
            : t('mk_sub_live', { n: total });
        })()}
        breadcrumb={['Home','Markets']}
        actions={
          <>
            <div className="seg">
              <button className={`seg__opt ${view==='table' ? 'is-active' : ''}`} onClick={() => setView('table')}>
                <I.LayoutIcon size={11}/> {t('mk_view_table')}
              </button>
              <button className={`seg__opt ${view==='heatmap' ? 'is-active' : ''}`} onClick={() => setView('heatmap')}>
                <I.Grid size={11}/> {t('mk_heatmap')}
              </button>
            </div>
            <button
              className={`btn btn--sm ${favOnly ? 'btn--primary' : ''}`}
              onClick={() => setFavOnly((v) => !v)}
              /*
                 ★ 즐겨찾기가 없으면 켜도 빈 목록이 된다. 이용자가 고장으로
                   여기지 않게 상태를 제목에 밝힌다.
              */
              title={favOnly ? t('mk_fav_only_on') : t('mk_fav_only_off')}
            >
              <I.Filter size={13}/> {t('notifications_f53a6e')}
            </button>
          </>
        }
      >
        {/* KPI row */}
        <div className="grid-4">
          {/*
             마켓 KPI.

             ★ 목업이었던 것:
                 '+2.14% vs yesterday'  — 전일 거래량을 보관하지 않아 비교 불가
                 'Bull dominance 62%'   — 정의한 적 없는 지표
                 'Top Mover OP +6.32%'  — 실제 상승률 1위와 무관한 고정값
                 'Fear & Greed 72'      — 외부 지수를 조회하지 않는다

             전일 대비와 공포탐욕지수는 우리가 가진 데이터로 만들 수 없다.
             대신 **지금 시세로 계산할 수 있는 것**을 보여준다: 거래량 합계,
             상승 종목 수, 실제 상승률 1위, 실제 하락률 1위.
          */}
          {(() => {
            /*
               ★★ 미상장 심볼을 집계에서 제외한다. 목업 거래량 88.00M 을 합계에
                 더하면 "시장 전체 거래량" 이 부풀고, 목업 변동률이 상승률 1위로
                 뽑히면 사용자가 그 종목을 사려고 한다 — 거래할 수 없는 종목이다.
            */
            const live = markets.filter(m => !unlisted(m));
            const withChg = live.filter(m => Number.isFinite(Number(m.chg24h)));
            const sorted = withChg.slice().sort((a, b) => Number(b.chg24h) - Number(a.chg24h));
            const top = sorted[0] || null;
            const bottom = sorted[sorted.length - 1] || null;
            const pct = (v) => (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
            const label = (m) => `${m.base || m.symbol}${m.quote ? '/' + m.quote : ''}`;
            return (
              <>
                <window.KPICard
                  label={t('mk_volume')}
                  value={live.length ? fmtCompact(live.reduce((a, m) => a + (Number(m.vol24h) || 0), 0)) : '—'}
                  sub={t('mk_volume_sub', { n: live.length })}
                  icon="Chart" tone="brand"
                />
                <window.KPICard
                  label={t('mk_gainers')}
                  value={withChg.filter(m => Number(m.chg24h) > 0).length + ' / ' + withChg.length}
                  sub={t('mk_gainers_sub')}
                  icon="Zap" tone="long"
                />
                {/* 실제 1위. 값이 없으면 '—' 로 둔다. */}
                <window.KPICard
                  label={t('mk_top')}
                  value={top ? `${label(top)} · ${pct(top.chg24h)}` : '—'}
                  sub={top && Number.isFinite(Number(top.price)) ? '$' + fmt(top.price) : undefined}
                  icon="Sparkles" tone="long"
                />
                <window.KPICard
                  label={t('mk_bottom')}
                  value={bottom && bottom !== top ? `${label(bottom)} · ${pct(bottom.chg24h)}` : '—'}
                  sub={bottom && bottom !== top && Number.isFinite(Number(bottom.price)) ? '$' + fmt(bottom.price) : undefined}
                  icon="Alert" tone="short"
                />
              </>
            );
          })()}
        </div>

        <window.SectionCard
          title={t('mk_all_markets')}
          actions={
            <>
              <div className="input-group" style={{width: 240, height: 30}}>
                <I.Search size={12}/>
                <input placeholder={t('wl_search_ph')} value={q} onChange={e => setQ(e.target.value)}/>
              </div>
              <div className="seg">
                {[['All','mk_f_all'],['Favorites','mk_f_favorites'],['Gainers','mk_f_gainers'],['Losers','mk_f_losers'],['New','mk_f_new']].map(([id, k]) => (
                  <button key={id} className={`seg__opt ${tab===id?'is-active':''}`} onClick={() => setTab(id)}>{t(k)}</button>
                ))}
              </div>
            </>
          }
          noPadding
        >
          {view === 'table' && (
            <window.DataTable
              columns={[
                { key: 'fav', label: '', width: 32, render: r => (
                  /*
                     ★ 별을 실제로 저장한다. 전에는 cursor:pointer 만 있고
                       onClick 이 없어서, 눌러도 아무 일이 없었다.
                     ★ 행 클릭(차트로 이동)과 겹치지 않게 전파를 멈춘다.
                  */
                  <span
                    role="button"
                    aria-label={t(r.fav ? 'fav_remove' : 'fav_add')}
                    title={t(r.fav ? 'fav_remove' : 'fav_add')}
                    style={{color: r.fav ? 'var(--color-warning)' : 'var(--color-text-tertiary)', cursor:'pointer'}}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.QTMarkets) window.QTMarkets.toggleFav(r.base + r.quote, mkSrc.market);
                    }}
                  >{r.fav ? '★' : '☆'}</span>
                ) },
                { key: 'sym',   label: t('col_pair'), render: r => (
                  <span>
                    <strong>{r.base}</strong><span style={{color:'var(--color-text-tertiary)'}}>/{r.quote}</span>
                    <span className="badge badge--perp" style={{marginLeft:6}}>{r.type}</span>
                    {unlisted(r) && (
                      <span className="badge" style={{marginLeft:6, background:'var(--color-surface-3)', color:'var(--color-text-tertiary)'}}>
                        {t(r.unavailableReasonKey || 'market_not_listed')}
                      </span>
                    )}
                  </span>
                ) },
                { key: 'price', label: t('col_price'), align: 'right', render: r => <span style={{fontFamily:'var(--font-num)'}}>{unlisted(r) ? '—' : r.price.toLocaleString('en-US', {maximumFractionDigits: r.price >= 100 ? 2 : 4})}</span> },
                { key: 'chg',   label: t('mk_col_chg'), align: 'right', render: r => unlisted(r) ? (
                  <span style={{color:'var(--color-text-tertiary)'}}>—</span>
                ) : (
                  <span className={r.chg24h >= 0 ? 't-long' : 't-short'} style={{fontFamily:'var(--font-mono)', fontWeight:500}}>
                    {r.chg24h >= 0 ? '▲' : '▼'} {Math.abs(r.chg24h).toFixed(2)}%
                  </span>
                ) },
                { key: 'range', label: t('mk_col_range'), align: 'right', render: r => (
                  <span style={{fontFamily:'var(--font-num)', color:'var(--color-text-secondary)', fontSize:11}}>{unlisted(r) ? '—' : `${fmt(r.lo, r.lo >= 100 ? 1 : 4)} – ${fmt(r.hi, r.hi >= 100 ? 1 : 4)}`}</span>
                ) },
                { key: 'vol',   label: t('col_vol24'), align: 'right', render: r => <span style={{fontFamily:'var(--font-num)'}}>{unlisted(r) ? '—' : fmtCompact(r.vol24h)}</span> },
                { key: 'spark', label: t('col_trend'), align: 'right', width: 100, render: r => {
                  /* ★ 미상장 심볼에는 추세선을 그리지 않는다. 목업 가격으로 그린
                       선은 실제 움직임이 아니고, 작은 그림이라 근거가 없다는 것이
                       드러나지 않는다. */
                  if (unlisted(r)) return <span style={{color:'var(--color-text-tertiary)'}}>—</span>;
                  /*
                     ★★ 전에는 사인파 + 난수로 그렸다.

                       `r.price * (1 + Math.sin(i/3 + r.base.charCodeAt(0)) * 0.02 + (Math.random()-0.5)*0.006)`
                       심볼 이름으로 위상을 정한 가짜 곡선이었다. 사용자는 이
                       모양을 보고 종목을 고르는데 그 모양에 근거가 없었고,
                       그림이 작아서 가짜라는 것도 드러나지 않았다.

                     ★ 지금은 실제 1시간봉 종가 24개를 쓴다. 아직 도착하지 않았거나
                       받지 못했으면 '—' 로 둔다(가짜로 채우지 않는다).
                       도착하면 liveVersion 이 올라가 다시 그려진다.
                  */
                  const pts = window.QTLive && window.QTLive.getSparkline
                    ? window.QTLive.getSparkline(r.base + r.quote)
                    : [];
                  if (!pts || pts.length < 2) {
                    return <span style={{color:'var(--color-text-tertiary)'}} title={t('mk_trend_pending')}>—</span>;
                  }
                  // 방향도 실제 구간(첫 점 → 마지막 점)으로 판단한다.
                  return <Sparkline points={pts} up={pts[pts.length - 1] >= pts[0]}/>;
                }},
                { key: 'act',   label: '', align: 'right', width: 100, render: r => unlisted(r) ? (
                  /* ★ 버튼을 지우지 않는다(UI 계약). 비활성으로 두고 이유를 알린다.
                       누르게 두면 주문 패널까지 가서야 거래할 수 없음을 알게 된다. */
                  <button className="btn btn--xs" disabled title={t(r.unavailableReasonKey || 'market_not_listed')}>{t('nav_trade')}</button>
                ) : (
                  <a className="btn btn--xs btn--primary" href={`#/trade?symbol=${r.base}${r.quote}`}>{t('nav_trade')}</a>
                ) },
              ]}
              rows={filtered}
              onRowClick={(r) => shellProps.onNavigate && shellProps.onNavigate('/trade?symbol=' + r.base + r.quote)}
            />
          )}
          {/*
             빈 탭의 이유를 말한다. 'New' 는 상장 시각을 받지 못하면 정렬할 수
             없으므로, 임의 순서를 신규라고 부르지 않고 그 사실을 알린다.
          */}
          {view === 'table' && filtered.length === 0 && (
            <div className="empty" style={{padding:'18px 16px'}}>
              <span className="empty__icon">🔍</span>
              <span>{tab === 'New' && !listedAt ? t('mk_new_unavailable') : t('no_match')}</span>
            </div>
          )}
          {view === 'heatmap' && (
            <div style={{padding: 12}}>
              <div className="markets-heatmap">
                {filtered.map(m => (
                  <div key={m.base} className="heat-cell" style={{background: unlisted(m) ? 'var(--color-surface-2)' : heatCol(m.chg24h)}} onClick={() => shellProps.onNavigate && shellProps.onNavigate('/trade?symbol=' + m.base + m.quote)}>
                    <div className="heat-cell__sym">{m.base}</div>
                    <div>
                      {/* ★ 미상장은 색으로 상승·하락을 말하지 않는다 — 색이 가장 먼저 읽힌다. */}
                      {unlisted(m) ? (
                        <div className="heat-cell__chg" style={{color:'var(--color-text-tertiary)'}}>—</div>
                      ) : (
                        <div className="heat-cell__chg" style={{color: m.chg24h >= 0 ? 'var(--color-trade-long)' : 'var(--color-trade-short)'}}>
                          {m.chg24h >= 0 ? '+' : ''}{m.chg24h.toFixed(2)}%
                        </div>
                      )}
                      <div className="heat-cell__price">{unlisted(m) ? t(m.unavailableReasonKey || 'market_not_listed') : fmt(m.price, m.price >= 100 ? 1 : 4)}</div>
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
    const [filter, setFilter] = useState('all');   // all | free | pro | vip
    const [sort, setSort] = useState('pnl');

    /*
       전략 목록 (실데이터).

       백엔드에 내장 전략 4개와 실제 백테스트 엔진이 있다. 목업은
       '+38.4% · 승률 62% · 팔로워 1,240명' 같은 수치를 보여줬는데 전부
       근거가 없었다 — 투자 판단에 쓰이는 숫자를 만들어내는 것은
       가장 위험한 종류의 목업이다.

       ★ metrics 의 null 은 0 이 아니라 **미실행**이다. 0 으로 바꾸면
         "수익률 0%" 로 읽히고, 안 돌린 것과 돌렸는데 성과가 없는 것이
         구분되지 않는다.

       ★ 서버가 unavailable 로 없는 기능을 알려준다:
         subscriptionTiers(구독 등급) · userAuthoredStrategies(사용자 작성)
         · liveTrackRecord(실거래 실적). 그 UI 는 감춘다.
    */
    const [live, setLive] = useState(null);
    const [meta, setMeta] = useState(null);
    const [err, setErr] = useState(null);
    const [busyId, setBusyId] = useState(null);
    // { 전략ID: 팔로우레코드ID }. null = 아직 모른다.
    const [following, setFollowing] = useState(null);
    // 서버가 알려주는 팔로우의 의미(자동 실행 여부).
    const [followNote, setFollowNote] = useState(null);

    const load = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.strategies) return;
      api.strategies()
        .then((r) => {
          setLive(r.data || []);
          setMeta({
            symbol: r.symbol, timeframe: r.timeframe, dataSource: r.dataSource,
            // ★ 서버는 번역 키를 준다(문장이 아니다). 화면에서 t() 로 번역한다.
            metricsNoteKey: r.metricsNoteKey, caveats: r.caveats || [], unavailable: r.unavailable || [],
          });
          setErr(null);
        })
        .catch((e) => setErr((e && e.message) || 'load failed'));
      if (api.myStrategies) {
        api.myStrategies()
          /*
             팔로우 레코드를 전략 ID 로 색인한다.

             해제할 때는 레코드 ID 가 필요하므로 둘을 함께 보관한다 —
             전략 ID 만 저장하면 해제할 수 없다.
          */
          .then((r) => {
            const map = {};
            (r.data || []).forEach((x) => { map[x.strategyId] = x.id; });
            setFollowing(map);
            setFollowNote({ autoExecution: r.autoExecution, note: r.note });
          })
          .catch(() => setFollowing({}));
      }
    }, []);
    useEffect(() => { load(); }, [load]);

    /*
       ★★ 전에는 `Array.isArray(live)` 하나로 판정했다.

         live 의 초기값은 null 이므로 **최초 렌더와 조회 실패에서 목업 전략
         8개**(`+38.4% · 승률 62% · 팔로워 1,240`)가 그대로 보였다. 사용자는
         그것을 실제 성적으로 읽고 팔로우한다. 조회에 실패했다는 사실은
         화면 어디에도 없었다.

       ★ 지금은 판정처를 하나로 둔다(QTMockPolicy). 실서비스에서는 목업을
         쓰지 않고, 미리보기(백엔드 없는 디자인 확인)에서만 목업을 쓴다.
    */
    const isLive = Array.isArray(live);
    const mockAllowed = window.QTMockPolicy && window.QTMockPolicy.allowMockData
      ? window.QTMockPolicy.allowMockData()
      : false;
    // 조회에 실패했는데 목업도 쓸 수 없는 상태 — 이유를 말해야 한다.
    const loadFailed = Boolean(err) && !isLive && !mockAllowed;
    const unavailable = new Set((meta && meta.unavailable) || []);
    // 구독 등급이 없으면 Free/Pro/VIP 필터는 의미가 없다.
    const hasTiers = isLive ? !unavailable.has('subscriptionTiers') : true;

    /*
       실 전략을 카드 모양으로 맞춘다.

       숫자가 없으면 null 로 둔다 — 카드가 '—' 를 그린다. 0 으로 채우면
       사용자가 "성과 0" 으로 읽고 전략을 잘못 비교한다.
       Sharpe 는 백엔드가 계산하지 않는다. 없는 지표를 만들지 않는다.
    */
    const toCard = (x) => {
      const m = x.metrics || {};
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return {
        id: x.id,
        /*
           ★ 서버는 번역 키(nameKey/descriptionKey)를 함께 준다. 키가 있으면
             그것으로 번역하고, 없으면(사용자 작성 전략 등) 원문을 쓴다.
             전에는 원문만 썼기 때문에 영어·일본어 화면에 한국어 전략명이
             그대로 나왔다.
        */
        name: x.nameKey ? t(x.nameKey) : x.name,
        description: x.descriptionKey ? t(x.descriptionKey) : x.description,
        author: x.author === 'built-in' ? null : x.author,
        authorKey: x.author === 'built-in' ? 'strategy_builtin' : null,
        tag: x.category || '—',
        /* ★★ 여기에 `description: x.description || ''` 가 한 번 더 있었다. 같은 객체에
             같은 키를 두 번 쓰면 뒤가 이긴다 — 위에서 descriptionKey 로 번역한 값이
             조용히 버려지고, 일본어·중국어 화면에 원문이 그대로 나왔다. */
        pnl30: num(m.totalReturnPct),
        winRate: num(m.winRatePct),
        sharpe: num(m.sharpe),
        maxDD: num(m.maxDrawdownPct),
        // 서버 필드명은 tradeCount 다. trades 로 읽으면 항상 '—' 가 된다(실제로 겪음).
        trades: num(m.tradeCount),
        followers: num(x.followers),
        subscription: null,
        featured: false,
      };
    };

    /*
       ★ 실데이터가 있으면 그것을, 없으면 미리보기에서만 목업을 쓴다.
         실서비스에서 데이터가 없으면 **빈 목록**이다 — 가짜로 채우지 않는다.
    */
    const strategies = isLive
      ? live.map(toCard)
      : (window.QTMockPolicy && window.QTMockPolicy.pick
          ? (window.QTMockPolicy.pick(null, window.QTApp.STRATEGIES) || [])
          : []);

    const cmp = (a, b, key) => {
      // null 은 항상 뒤로 보낸다. 0 으로 취급하면 미실행 전략이 중간에 끼어든다.
      const av = a[key], bv = b[key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    };

    const filtered = strategies
      .filter(s => !hasTiers || filter === 'all' || (s.subscription || '').toLowerCase() === filter)
      .slice()
      .sort((a, b) => {
        if (sort === 'pnl') return cmp(a, b, 'pnl30');
        if (sort === 'sharpe') return cmp(a, b, 'sharpe');
        if (sort === 'winRate') return cmp(a, b, 'winRate');
        return cmp(a, b, 'followers');
      });

    /* 백테스트 실행. 서버가 계산하므로 시간이 걸린다. */
    const runBacktest = async (id) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.backtest) return;
      setBusyId(id);
      try {
        await api.backtest(id, {});
        load();
      } catch (e) {
        setErr((e && e.message) || 'backtest failed');
      }
      setBusyId(null);
    };

    const isFollowing = (id) => Boolean(following && following[id]);

    const toggleFollow = async (id) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.followStrategy) return;
      setBusyId(id);
      try {
        if (isFollowing(id)) {
          // 해제는 팔로우 레코드 ID 로 한다.
          await api.unfollowStrategy(following[id]);
        } else {
          /*
             팔로우는 심볼·주기 조합으로 기록된다. 백테스트가 돌아간 기준과
             같은 값을 쓴다 — 다른 값을 넣으면 목록의 성과와 팔로우 대상이
             어긋나 사용자가 다른 조합의 성과를 보고 판단한다.
          */
          await api.followStrategy(id, (meta && meta.symbol) || 'BTCUSDT', (meta && meta.timeframe) || '1h');
        }
        load();
      } catch (e) {
        setErr((e && e.message) || 'follow failed');
      }
      setBusyId(null);
    };

    return (
      <window.PageShell
        {...shellProps}
        title={t('nav_ai_strategies')}
        subtitle={t('strat_page_sub')}
        breadcrumb={['Home','AI Strategies']}
        actions={
          <>
            {/*
               전략 작성·AI 생성.

               서버가 userAuthoredStrategies 를 unavailable 로 알려준다 —
               사용자가 전략을 만들 수 있는 기능이 없다. 버튼을 두면 눌러보고
               아무 일도 없어 고장으로 오해한다.
            */}
            {!isLive || !unavailable.has('userAuthoredStrategies') ? (
              <>
                {/*
                   ★ 백엔드에는 전략 생성 API(POST /strategies)가 있지만, 이 화면엔
                     아직 입력 폼이 없어 눌러도 사용자가 만들 방법이 없다. 죽은 버튼으로
                     두지 않고 '준비중' 으로 명확히 표시한다. 폼을 붙이면 disabled 를
                     떼고 onClick 으로 생성 흐름을 연결하면 된다.
                */}
                <button className="btn btn--sm" disabled title={t('sec_pending')}>
                  <I.Plus size={12}/> {t('strat_create')} <span className="qt-pending-mark">{t('sec_pending')}</span>
                </button>
                <button className="btn btn--sm btn--primary" disabled title={t('sec_pending')}>
                  <I.Sparkles size={12}/> {t('strat_ai_generate')} <span className="qt-pending-mark">{t('sec_pending')}</span>
                </button>
              </>
            ) : (
              <button className="btn btn--sm" onClick={load} title={t('refresh')}><I.Refresh size={12}/></button>
            )}
          </>
        }
      >
        <div className="grid-4">
          {isLive ? (() => {
            const withRet = strategies.filter(x => x.pnl30 !== null);
            const avg = withRet.length ? withRet.reduce((a, x) => a + x.pnl30, 0) / withRet.length : null;
            return (
              <>
                <window.KPICard
                  label={t('strat_total')}
                  value={strategies.length}
                  sub={t('strat_builtin_only')}
                  icon="Sparkles" tone="ai"
                />
                {/*
                   평균 수익률.

                   백테스트를 돌린 전략만으로 계산한다. 미실행을 0 으로 넣으면
                   평균이 실제보다 낮게 나와 전략 전체가 나빠 보인다.
                   '+8.4% vs prev 30d' 라는 델타는 이전 기간을 비교하지 않으므로
                   표시하지 않는다.
                */}
                <window.KPICard
                  label={t('strat_avg_backtest')}
                  value={avg === null ? '—' : (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%'}
                  sub={t('strat_avg_sub', { n: withRet.length, total: strategies.length })}
                  tone={avg !== null && avg >= 0 ? 'long' : 'short'}
                />
                <window.KPICard
                  label={t('strat_following')}
                  value={following === null ? '—' : Object.keys(following).length}
                  sub={followNote && followNote.autoExecution === false ? t('strat_following_sub') : undefined}
                  icon="Zap" tone="brand"
                />
                {/*
                   시세 기준. 백테스트가 어느 심볼·주기로 돌아갔는지 밝힌다 —
                   밝히지 않으면 사용자가 자기가 보는 심볼의 성과로 오해한다.
                */}
                <window.KPICard
                  label={t('strat_basis')}
                  value={meta ? `${meta.symbol} · ${meta.timeframe}` : '—'}
                  sub={meta ? t('strat_basis_sub', { src: meta.dataSource }) : undefined}
                />
              </>
            );
          })() : loadFailed ? (
            /*
               ★★ 조회 실패. 전에는 이 자리에 목업 KPI 4개가 나왔다.

                 `Total Strategies · Free 4 Pro 3 VIP 1` · `Avg 30d PnL +8.4%` ·
                 `AI Signals · Today 486`(관리자 화면용 목업값을 사용자 화면에서
                 썼다). 서버에서 아무 것도 받지 못한 상태인데 숫자가 보이므로
                 사용자는 그것을 자기 서비스의 실적으로 읽는다.

               ★ 지금은 숫자를 만들지 않고 실패를 말한다. 0 으로도 채우지 않는다 —
                 "전략 0개" 와 "못 불러옴" 은 다른 사실이다.
            */
            <div
              style={{
                gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                padding:'12px 14px', border:'1px solid var(--color-warning)', borderRadius:6,
                background:'color-mix(in srgb, var(--color-warning) 10%, transparent)',
              }}
            >
              <span style={{fontSize:12, color:'var(--color-warning)'}}>{t('strat_load_failed')}</span>
              <button className="btn btn--xs" type="button" onClick={load}>{t('sec_retry')}</button>
            </div>
          ) : (
            <>
              <window.KPICard label={t('strat_kpi_total')} value={strategies.length} icon="Sparkles" tone="ai"/>
              <window.KPICard label={t('strat_kpi_avg30')} value={'+' + (strategies.reduce((a,s) => a+s.pnl30, 0)/strategies.length).toFixed(1) + '%'} delta={+8.4} deltaLabel={t('delta_vs_prev_30d')} tone="long"/>
              <window.KPICard label={t('strat_kpi_following')} value="0" sub={t('my_strategies_eb1536')} icon="Zap" tone="brand"/>
              <window.KPICard label={t('strat_kpi_signals_today')} value={window.QTApp.ADMIN_AI_METRICS.signalsToday} sub={`Approve rate ${(window.QTApp.ADMIN_AI_METRICS.approveRate * 100).toFixed(0)}%`} tone="ai"/>
            </>
          )}
        </div>

        <window.SectionCard
          title={t('strat_gallery')}
          subtitle={isLive ? t('strat_gallery_sub') : "Simulated performance based on backtest + paper live. Not investment advice."}
          actions={
            <>
              {/* 구독 등급 제도가 없으면 이 필터는 아무것도 걸러내지 못한다. */}
              {hasTiers && (
                <div className="seg">
                  {[
                    { id: 'all', label: t('mk_f_all') },
                    { id: 'free', label: t('strat_tier_free') },
                    { id: 'pro', label: t('strat_tier_pro') },
                    { id: 'vip', label: t('strat_tier_vip') },
                  ].map(f => (
                    <button key={f.id} className={`seg__opt ${filter===f.id?'is-active':''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
                  ))}
                </div>
              )}
              <select className="input" style={{height:28, fontSize:11, width: 130}} value={sort} onChange={e => setSort(e.target.value)}>
                <option value="pnl">{t('strat_sort_pnl')}</option>
                <option value="sharpe">{t('strat_sort_sharpe')}</option>
                <option value="winRate">{t('strat_sort_win')}</option>
                <option value="followers">{t('strat_sort_followers')}</option>
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
                    <div className="strategy-card__author">{s.authorKey ? t(s.authorKey) : (s.author || '—')}</div>
                  </div>
                  <span className="strategy-card__tag">{s.tag}</span>
                </div>

                {/*
                   지표.

                   null 은 '—' 로 그린다. 0% 로 쓰면 백테스트를 돌리지 않은
                   전략이 "수익 0" 으로 보이고, 사용자가 전략을 잘못 비교한다.
                   Sharpe 는 백엔드가 계산하지 않으므로 실데이터에서는
                   그 자리에 거래 횟수를 보여준다 — 표본 크기가 승률을
                   해석하는 데 더 중요하다(3거래 승률 67% 는 의미가 없다).
                */}
                <div className="strategy-card__stats">
                  <div className="strategy-card__stat">
                    <span className="strategy-card__stat__k">{isLive ? t('strat_backtest_ret') : '30d PnL'}</span>
                    <span className="strategy-card__stat__v" style={{color: s.pnl30 === null ? 'var(--color-text-tertiary)' : (s.pnl30 >= 0 ? 'var(--color-trade-long)' : 'var(--color-trade-short)')}}>
                      {s.pnl30 === null ? '—' : (s.pnl30 >= 0 ? '+' : '') + s.pnl30.toFixed(2) + '%'}
                    </span>
                  </div>
                  <div className="strategy-card__stat">
                    {/*
                       승률 옆에 거래 횟수를 붙인다.

                       표본을 모르면 승률을 해석할 수 없다 — 3거래 승률 67% 와
                       200거래 승률 55% 는 완전히 다른 이야기다. 승률만 크게
                       보여주면 사용자가 표본이 적은 전략을 더 좋다고 오해한다.
                    */}
                    <span className="strategy-card__stat__k">{t('strat_win_rate')}</span>
                    <span className="strategy-card__stat__v" style={s.winRate === null ? {color:'var(--color-text-tertiary)'} : undefined}>
                      {s.winRate === null ? '—' : s.winRate.toFixed(1) + '%'}
                      {isLive && s.trades !== null && (
                        <span style={{fontSize:9.5, color:'var(--color-text-tertiary)', marginLeft:3, fontWeight:400}}>
                          /{s.trades}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="strategy-card__stat">
                    <span className="strategy-card__stat__k">{t('col_sharpe')}</span>
                    <span className="strategy-card__stat__v" style={{color: s.sharpe === null ? 'var(--color-text-tertiary)' : undefined}}>
                      {s.sharpe === null ? '—' : (isLive ? s.sharpe.toFixed(2) : s.sharpe)}
                    </span>
                  </div>
                  <div className="strategy-card__stat">
                    <span className="strategy-card__stat__k">{t('strat_max_dd')}</span>
                    <span className="strategy-card__stat__v" style={{color: s.maxDD === null ? 'var(--color-text-tertiary)' : 'var(--color-trade-short)'}}>
                      {s.maxDD === null ? '—' : '-' + s.maxDD.toFixed(2) + '%'}
                    </span>
                  </div>
                </div>

                <div className="strategy-card__foot">
                  {/* 팔로워 수가 없으면 표시하지 않는다. 0 명을 강조할 이유가 없다. */}
                  <span className="followers">
                    <I.User size={9} style={{verticalAlign:'-1px'}}/>{' '}
                    {s.followers === null ? '—' : t('bt_followers', { n: s.followers.toLocaleString() })}
                  </span>
                  {/* 구독 등급 제도가 없으면 배지를 비운다 — 'null' 이라는 글자가 나오면 안 된다. */}
                  {s.subscription ? <span className={`sub ${s.subscription}`}>{s.subscription}</span> : <span/>}
                </div>

                <div style={{display:'flex', gap:6}}>
                  {isLive ? (
                    <>
                      <button
                        className="btn btn--xs" style={{flex:1}}
                        disabled={busyId === s.id}
                        onClick={() => runBacktest(s.id)}
                        title={t('strat_backtest_hint')}
                      ><I.Chart size={11}/> {busyId === s.id ? '…' : t('col_backtest')}</button>
                      <button
                        className={`btn btn--xs ${isFollowing(s.id) ? '' : 'btn--primary'}`}
                        style={{flex:1}}
                        disabled={busyId === s.id}
                        onClick={() => toggleFollow(s.id)}
                      >
                        {isFollowing(s.id)
                          ? <><I.Check size={11}/> {t('strat_following_on')}</>
                          : <><I.Plus size={11}/> {t('col_follow')}</>}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn--xs" style={{flex:1}}><I.Chart size={11}/> {t('col_backtest')}</button>
                      <button className="btn btn--xs btn--primary" style={{flex:1}}><I.Plus size={11}/> {t('col_follow')}</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/*
             주의사항.

             서버가 caveats 로 백테스트의 한계를 보내준다(lookahead 처리,
             수수료·슬리피지 차감, 펀딩비 미반영 등). 이걸 감추면 사용자가
             과거 수익률을 미래 수익으로 읽는다 — 가장 큰 오해다.
          */}
          {isLive && meta && meta.caveats.length > 0 && (
            <div style={{
              margin:'4px 16px 16px', padding:'12px 14px', borderRadius:6,
              background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)',
            }}>
              <div style={{fontSize:11.5, fontWeight:600, marginBottom:6, color:'var(--color-text-secondary)'}}>
                {t('strat_caveats_title')}
              </div>
              <ul style={{margin:0, paddingLeft:18, fontSize:11.5, lineHeight:1.9, color:'var(--color-text-tertiary)'}}>
                {/* caveats 는 번역 키 배열이다. 키가 사전에 없으면 i18n 이 영어로 폴백한다. */}
                {meta.caveats.map((c, i) => <li key={i}>{t(c)}</li>)}
              </ul>
              {meta.metricsNoteKey && (
                <div style={{marginTop:8, paddingTop:8, borderTop:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)'}}>
                  {t(meta.metricsNoteKey)}
                </div>
              )}
            </div>
          )}
          {err && <div style={{padding:'10px 16px', fontSize:11, color:'var(--color-danger)'}}>{t('admin_load_failed')} · {err}</div>}
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

    /*
       자산 배분·자산곡선.

       ★★ 둘 다 목업이었고 실서비스에서도 그대로 나왔다($20,000.14 총자산,
         7개 자산 배분). 거래소 잔고를 조회하지 못하면 우리는 자산을 모른다.

       ★ 실계정 잔고가 있으면 그것을 쓴다(QTAccount.getAllocation). 없으면
         미리보기에서만 예시를 쓰고, 실서비스에서는 빈 배열이다 —
         화면이 "자산 정보를 불러올 수 없습니다" 를 보여준다.
    */
    const liveAllocation = (account.isLive && window.QTAccount && window.QTAccount.getAllocation)
      ? window.QTAccount.getAllocation()
      : null;
    const A = window.QTMockPolicy
      ? (window.QTMockPolicy.pick(liveAllocation, window.QTApp.ALLOCATION) || [])
      : (liveAllocation || window.QTApp.ALLOCATION);
    /*
       자산곡선.

       ★★ 이제 일별 스냅샷을 기록한다(equity_snapshots). 잔고 조회가 성공할 때
         하루 한 번, 모의 주문 확인 시에도 출처를 나눠 남긴다.

       ★ `canPlot` 은 **서버 판정**을 쓴다. 점이 1개면 선을 만들 수 없고, 그
         기준을 화면마다 따로 두면 어느 한 곳이 빈 곡선을 그린다.

       ★ 출처를 섞지 않는다. 거래소 키가 검증됐으면 실잔고 곡선을, 아니면
         모의 곡선을 본다 — 한 그래프에 두 성격을 겹치면 무엇의 성과인지 알 수 없다.

       ★ 빈 날을 채우지 않는다(`interpolated:false`). 접속하지 않은 날은 점이 없다.
    */
    const [curve, setCurve] = useState(null);
    const [curveDays, setCurveDays] = useState(30);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.equityCurve) return undefined;
      if (window.QTMockPolicy && window.QTMockPolicy.allowMockData()) return undefined;
      let cancelled = false;
      const load = () => {
        const auth = window.QTAuth;
        if (!auth || !auth.isLoggedIn || !auth.isLoggedIn()) return;
        const src = (account.isLive) ? 'exchange' : 'mock';
        api.equityCurve({ days: curveDays, source: src })
          .then((r) => { if (!cancelled) setCurve(r); })
          .catch(() => { /* 조회 실패를 빈 곡선으로 위장하지 않는다 (null 유지) */ });
      };
      load();
      const off = (window.QTAuth && window.QTAuth.subscribe) ? window.QTAuth.subscribe(load) : null;
      return () => { cancelled = true; if (off) off(); };
    }, [curveDays, account.isLive, account.version]);

    /*
       화면이 쓰는 곡선 배열.

       ★ 서버 점을 `{v}` 형태로 바꾼다 — 기존 SVG 코드가 그 모양을 기대한다.
         목업 형태를 바꾸지 않는 편이 디자이너 화면을 건드리지 않는다.
    */
    const eq = (window.QTMockPolicy && window.QTMockPolicy.allowMockData())
      ? window.QTApp.EQUITY_CURVE
      : ((curve && curve.canPlot)
          ? curve.points.map((p) => ({ t: p.date, v: Number(p.equity) })).filter((x) => Number.isFinite(x.v))
          : []);
    /*
       총자산.

       ★★ 자산 목록이 비어 있으면 **모르는 것**이다. 0 으로 표시하면 "자산이
         없다" 로 읽히고, 사용자는 잔고가 사라졌다고 생각한다. 거래소 키가
         연결되지 않아 조회하지 못한 상태와 실제로 0 인 상태는 다르다.
    */
    const totalValue = A.length > 0
      ? A.reduce((a, x) => a + (Number(x.value) || 0), 0)
      : null;

    /*
       우리 DB 에 남은 포지션 (모의 포함).

       ★★ `account.isLive` 는 거래소 API 키 검증 상태다. 모의 주문으로 생긴
         포지션은 거래소에 없고 우리 DB 에만 있으므로, 키가 없어도 보여야 한다.
         전에는 읽는 경로가 없어서 모의 주문 후에도 목업 포지션 3개가 보였다 —
         사용자는 자기가 낸 주문이 어디 갔는지 알 수 없다.

       ★ 표시가·미실현손익은 실시간 시세가 있어야 채워진다. null 을 0 으로
         바꾸지 않는다 — "손익 0" 은 본전이라는 뜻으로 읽힌다.
    */
    const [localPos, setLocalPos] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.localPositions) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      api.localPositions().then((r) => {
        if (cancelled || !r.items.length) return;
        /*
           ★ 표가 기대하는 필드명을 정확히 맞춘다 (QT.POSITIONS 와 동일).

             `sym` 처럼 이름을 바꿔 넘기면 렌더 중 undefined.replace 로 터진다 —
             실제로 겪었다. 표는 symbol · type · unPnlPct 를 읽는다.

           ★ 모르는 값은 null 로 둔다. 0 으로 채우면 화면이 "손익 0" 을
             보여주고 사용자는 본전이라고 읽는다.
        */
        setLocalPos(r.items.map((x) => ({
          id: x.id,
          symbol: x.symbol,
          type: 'PERP',
          side: x.side,
          size: Number(x.size),
          entry: x.entryPrice === null ? null : Number(x.entryPrice),
          mark: x.markPrice === null ? null : Number(x.markPrice),
          liq: x.liquidationPrice === null ? null : Number(x.liquidationPrice),
          margin: null,
          marginRatio: null,
          leverage: x.leverage,
          unPnl: x.unrealizedPnl === null ? null : Number(x.unrealizedPnl),
          unPnlPct: null,
          // 실현손익은 포지션 행에 없다. 0 으로 만들면 "이익도 손실도 없었다" 가 된다.
          rlzPnl: null,
          tp: null,
          sl: null,
          adl: null,
          mode: String(x.marginMode || '').toUpperCase() || null,
          // 우리 DB 기록임을 표시할 수 있게 남긴다 (MOCK = 모의 체결).
          source: r.source,
        })));
      }).catch(() => { /* 조회 실패를 빈 목록으로 위장하지 않는다 */ });
      return () => { cancelled = true; };
    }, []);

    /*
       포지션: 거래소 실포지션 → 우리 DB 기록 → (미리보기에서만) 목업.

       ★★ 전에는 실데이터가 없으면 무조건 목업을 보여줬다. 그래서 거래 기록이
         없는 계정(신규 가입자·관리자)이 목업 포지션 3개(0.185 BTC @ 67,285)를
         **자기 포지션으로** 봤다. 실측으로 확인했다.

       ★ 이제 백엔드가 있으면(=실서비스) 목업을 쓰지 않는다. 빈 상태가
         고장처럼 보이는 것보다, 남의 거래를 자기 것으로 착각하는 편이 훨씬 나쁘다.
    */
    /*
       ★★ 어느 포지션을 보여줄지는 **모드**로 정한다 — 키 유무로 정하면 안 된다.

         전에는 `account.isLive` 가 true 면 거래소 포지션만 썼다. 그래서 키를
         연결한 이용자는 **모의 포지션이 보이지 않았다.** 실측: 모의 주문 4건으로
         포지션이 생겼고 `/api/positions` 도 그것을 돌려주는데 화면은 "No data"
         였다. Order History 에서도 같은 형태의 결함이 있었다.

       ★★ 두 출처를 합치지 않는다. 모의 포지션과 실제 포지션이 섞이면 증거금·
         청산가가 뒤섞여 이용자가 위험을 완전히 잘못 읽는다.
    */
    const isPaperMode = Boolean(window.QTMode && window.QTMode.get && window.QTMode.get() === 'paper');
    const positions = (!isPaperMode && account.isLive && window.QTAccount)
      ? window.QTAccount.getPositions()
      : (window.QTMockPolicy
          ? window.QTMockPolicy.pick(localPos, window.QT.POSITIONS)
          : (localPos || window.QT.POSITIONS));

    /*
       실데이터 화면인가.

       ★★ **백엔드가 있으면 실서비스다.** 거래 기록이 없어도 목업 값을 붙이지
         않는다. 전에는 `account.isLive || Boolean(localPos)` 였고, 그래서 거래
         기록이 없는 계정에 목업 KPI(+$396.77 · 18.4% · +3.42%)가 그대로 나왔다.

       ★ 미리보기(백엔드 없음)에서는 목업을 유지한다 — 디자이너가 화면을 확인해야 한다.
    */
    const isReal = window.QTMockPolicy
      ? !window.QTMockPolicy.allowMockData()
      : (account.isLive || Boolean(localPos));

    /*
       실데이터 기반 KPI.

       실데이터가 아니면 목업 값을 그대로 쓴다(디자이너 화면을 그대로 보여준다).
       실데이터인데 계산이 불가능하면 null 을 둔다 — 0 으로 채우면 "손익 없음"
       이라는 거짓이 된다.
    */
    const live = (() => {
      /*
         실데이터 판정.

         ★ 거래소 키가 검증됐거나(account.isLive) **우리 DB 기록이 있으면**
           실데이터다. 전에는 앞의 조건만 봐서, 모의 주문으로 포지션이 생겨도
           목업 KPI(396.77 / 1240.42 / 18.4)를 계속 보여줬다.
      */
      /*
         ★ 미리보기에서만 예시 값을 쓴다.

           실서비스에서 이 값이 나오면 사용자가 자기 손익으로 읽는다. 계산할
           근거가 없으면 null 을 주고 화면이 '—' 를 표시하게 한다.
      */
      if (!isReal) {
        return { unrealized: 396.77, realized: 1240.42, marginRatio: 18.4 };
      }

      /*
         합계.

         ★★ 모르는 값이 하나라도 섞이면 **합계도 모르는 것**이다.

           전에는 `Number.isFinite(Number(p[key]))` 로 걸렀는데 `Number(null)` 은
           0 이고 isFinite(0) 은 true 다. 그래서 값이 없는 포지션이 0 으로
           합산되어 "미실현손익 $0" 이 표시됐다 — 사용자는 본전이라고 읽는다.

           null 을 반환하면 KPI 가 '—' 를 보여준다. 그것이 사실이다.
      */
      const sum = (key) => {
        /*
           ★ 포지션이 없으면 **모르는 것**이다.

             포지션이 정말 0개인지, 조회하지 못한 것인지 이 함수는 알 수 없다.
             0 을 주면 화면이 '+$0.00' 을 보여주고 사용자는 본전이라고 읽는다.
             '—' 가 정직하다.
        */
        if (!positions.length) return null;
        let acc = 0;
        for (const p of positions) {
          const raw = p[key];
          if (raw === null || raw === undefined) return null;
          const n = Number(raw);
          if (!Number.isFinite(n)) return null;
          acc += n;
        }
        return acc;
      };

      const unrealized = sum('unPnl');
      const realized = sum('rlzPnl');

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
    /*
       ★ 빈 배열이면 `Math.min(...[])` 가 Infinity 다 → 좌표가 NaN 이 되고
         SVG 가 깨진다. 이력을 기록하지 않으므로 실서비스에서는 빈 배열이
         정상 상태다.
    */
    const hasEquityCurve = Array.isArray(eq) && eq.length > 1;
    const eqLo = hasEquityCurve ? Math.min(...eq.map(p => p.v)) : 0;
    const eqHi = hasEquityCurve ? Math.max(...eq.map(p => p.v)) : 0;
    const eqRange = eqHi - eqLo || 1;
    const eqW = 800, eqH = 200;
    const eqPath = !hasEquityCurve ? '' : eq.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * eqW / (eq.length - 1)).toFixed(1)} ${(eqH - ((p.v - eqLo) / eqRange) * (eqH - 20) - 10).toFixed(1)}`).join(' ');
    const eqArea = eqPath + ` L ${eqW} ${eqH} L 0 ${eqH} Z`;

    return (
      <window.PageShell
        {...shellProps}
        title={t('nav_portfolio')}
        subtitle={t('pf_page_sub')}
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
{/*
               Export 버튼을 숨겼다 (2026-08, 베타 런칭 범위에서 제외).

               ★★ 버튼을 지우지 않고 감춘다. 마크업을 지우면 나중에 되살릴 때
                 디자이너 산출물과 달라진다 — 지금은 배선할 서버 경로가 없어
                 눌러도 아무 일이 없었고, 그것이 고장으로 보였다.

               ★ 되살리는 방법: 이 조건을 없애고 onClick 에 실제 내보내기를
                 붙인다(관리자 회원 Export 처럼 서버가 URL 을 준다).
              */}
            {/* eslint-disable-next-line no-constant-binary-expression -- 마크업을 지우지 않고 감춘다(배선 전). 되살릴 때 조건만 지운다. */}
            {false && (
              <button className="btn btn--sm"><I.Camera size={13}/> {t('an_export_report')}</button>
            )}
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
        {(() => {
          /*
             증감률·부제.

             ★★ 실데이터일 때는 목업 증감률을 붙이지 않는다.

               전에는 `account.isLive` 만 봤다. 거래소 키가 없고 우리 DB 기록만
               있는 상태(모의 주문 직후)에서는 그 조건이 false 라서, 실제
               포지션 옆에 하드코딩된 '+3.18% vs entry' 와
               'Healthy · Liq. at 82%' 가 붙었다. 사용자는 그 숫자를 자기 성과로
               읽는다.

             ★ 증감률을 계산할 근거가 없으면 아예 표시하지 않는다. 24시간 전
               자산이나 지난 30일 실적을 우리가 보관하지 않기 때문이다.
          */
          const mockDelta = (v) => (isReal ? undefined : v);
          return (
            <div className="grid-4">
              <window.KPICard
                label={t('pf_total_equity')}
                value={totalValue === null ? '—' : '$' + fmt(totalValue)}
                sub={totalValue === null ? t('pf_equity_unknown') : undefined}
                delta={mockDelta(+3.42)} deltaLabel="24h" icon="Wallet" tone="brand"/>
              <window.KPICard
                label={t('pf_unrealized')}
                value={live.unrealized === null ? '—' : (live.unrealized >= 0 ? '+$' : '-$') + fmt(Math.abs(live.unrealized))}
                delta={mockDelta(+3.18)}
                deltaLabel={t('delta_vs_entry')}
                sub={live.unrealized === null && isReal ? t('pos_pnl_unknown_short') : undefined}
                tone={live.unrealized === null ? undefined : live.unrealized >= 0 ? 'long' : 'short'}
              />
              <window.KPICard
                label={t('pf_realized_30d')}
                value={live.realized === null ? '—' : (live.realized >= 0 ? '+$' : '-$') + fmt(Math.abs(live.realized))}
                delta={mockDelta(+9.7)}
                deltaLabel={t('delta_vs_prev_30d')}
                sub={live.realized === null && isReal ? t('acct_not_available') : undefined}
                tone={live.realized === null ? undefined : live.realized >= 0 ? 'long' : 'short'}
              />
              <window.KPICard
                label={t('kpi_margin_ratio')}
                value={live.marginRatio === null ? '—' : fmt(live.marginRatio, 1) + '%'}
                sub={live.marginRatio === null ? (isReal ? t('acct_not_available') : 'Healthy · Liq. at 82%') : undefined}
                icon="Alert"
                tone="warning"
              />
            </div>
          );
        })()}

        {/* Equity curve + Allocation */}
        <div className="grid-2-1">
          <window.SectionCard
            title={t('pf_equity_curve')}
            subtitle={(() => {
              if (window.QTMockPolicy && window.QTMockPolicy.allowMockData()) return undefined;
              if (!curve) return undefined;
              if (!curve.canPlot) return t('pf_equity_need_more', { n: curve.history.points });
              // 출처를 밝힌다. 모의 곡선을 실제 성과로 읽으면 안 된다.
              return curve.source === 'mock'
                ? t('pf_equity_src_mock', { n: curve.points.length })
                : t('pf_equity_src_exchange', { n: curve.points.length });
            })()}
            /*
               기간 선택.

               ★ 전에는 이 버튼들에 `onClick` 이 없어 눌러도 아무 일도 일어나지
                 않았고, '30D' 가 활성으로 보여 사용자는 30일 곡선을 본다고 믿었다.
                 자산 이력을 기록하기 시작해 이제 실제로 동작한다.
            */
            actions={
              (() => {
                /*
                   기간 선택.

                   ★★ 이제 실제로 동작한다 — 일별 스냅샷을 기록하기 시작했다.
                     다만 **이력이 있는 범위만** 누를 수 있게 한다. 하루치만
                     쌓였는데 1Y 를 누르면 같은 점 하나가 나오고, 사용자는
                     "1년 동안 변화가 없었다" 로 읽는다.

                   ★ 판정 근거는 서버가 준 `history.points` 다. 화면이 추정하지 않는다.
                */
                const RANGES = [
                  ['1D', 1], ['7D', 7], ['30D', 30], ['90D', 90], ['1Y', 365], [t('mk_f_all'), 1825],
                ];
                const known = curve && curve.history ? curve.history.points : 0;
                const preview = window.QTMockPolicy ? window.QTMockPolicy.allowMockData() : false;
                return (
                  <div className="seg" title={(!preview && known < 2) ? t('pf_equity_range_why') : undefined}>
                    {RANGES.map(([label, days]) => {
                      // 미리보기에서는 원본처럼 30D 가 활성이고 전부 눌린다.
                      const disabled = !preview && known < 2;
                      return (
                        <button
                          key={label}
                          className={`seg__opt ${(preview ? label === '30D' : curveDays === days) ? 'is-active' : ''}`}
                          disabled={disabled}
                          aria-disabled={disabled}
                          onClick={preview ? undefined : () => setCurveDays(days)}
                        >{label}</button>
                      );
                    })}
                  </div>
                );
              })()
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
              {/*
                 ★ 이력이 없으면 곡선을 그리지 않는다. 평평한 선은 "자산이 변하지
                   않았다" 로 읽히지만, 실제로는 기록이 없는 것이다.
              */}
              {hasEquityCurve ? (
                <>
                  <path d={eqArea} fill="url(#eqGrad)"/>
                  <path d={eqPath} fill="none" stroke="var(--color-brand)" strokeWidth="2"/>
                  <text x="4" y="14" fill="var(--color-text-tertiary)" fontFamily="var(--font-mono)" fontSize="10">${fmt(eqHi)}</text>
                  <text x="4" y={eqH-4} fill="var(--color-text-tertiary)" fontFamily="var(--font-mono)" fontSize="10">${fmt(eqLo)}</text>
                </>
              ) : (
                <text x={eqW/2} y={eqH/2} textAnchor="middle" fill="var(--color-text-tertiary)" fontSize="12">
                  {t('pf_no_equity_history')}
                </text>
              )}
            </svg>
          </window.SectionCard>

          {/*
             ★ 'Rebalance suggested' 를 붙이지 않는다. 우리는 재조정을 제안하는
               로직이 없다 — 그 문구를 보고 사용자가 조언을 받았다고 믿는다.
          */}
          <window.SectionCard
            title={t('pf_alloc_title')}
            subtitle={A.length > 0 ? t('pf_alloc_sub', { n: A.length }) : t('pf_alloc_none')}
          >
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
                {/* 총자산을 모르면 '—' 다. $0 은 "자산이 없다" 로 읽힌다. */}
                <text x={donutSize/2} y={donutSize/2 - 4} textAnchor="middle" fontFamily="var(--font-num)" fontSize="18" fontWeight="600" fill="var(--color-text-primary)">
                  {totalValue === null ? '—' : `$${fmtCompact(totalValue)}`}
                </text>
                <text x={donutSize/2} y={donutSize/2 + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-text-tertiary)">{t('pf_alloc_total')}</text>
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
        <window.SectionCard title={t('pf_open_positions')} subtitle={t('pf_open_count', { n: positions.length })} noPadding>
          <window.DataTable
            columns={[
              { key: 'sym', label: t('col_symbol'), render: r => <strong>{r.symbol.replace('USDT','/USDT')}</strong> },
              { key: 'side', label: t('col_side'), render: r => <span className={r.side==='long'?'t-long':'t-short'} style={{fontWeight:500}}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key: 'size', label: t('col_size'), align:'right', render: r => fmt(r.size, 3) },
              { key: 'entry', label: t('col_entry'), align:'right', render: r => fmt(r.entry, 1) },
              { key: 'mark',  label: t('col_mark'),  align:'right', render: r => fmt(r.mark, 1) },
              { key: 'liq',   label: t('col_liq_price'), align:'right', render: r => <span className="t-warning">{fmt(r.liq, 1)}</span> },
              /*
                 손익.

                 ★★ 값이 없을 수 있다. 표시가를 모르면 미실현손익도 모른다 —
                   모의 주문으로 생긴 포지션이 그렇다.

                   전에는 `r.unPnlPct.toFixed(1)` 이 null 을 만나 터졌고, 표
                   전체가 렌더되지 않아 **포지션이 하나도 보이지 않았다.**
                   목업에는 항상 값이 있어서 드러나지 않던 결함이다.

                 ★ 0 으로 채우지 않는다. '손익 0' 은 본전이라는 뜻으로 읽힌다.
              */
              { key: 'pnl',   label: t('col_pnl'), align:'right', render: r => {
                /*
                   ★ null 을 먼저 걸러야 한다.

                     `Number(null)` 은 0 이고 `Number.isFinite(0)` 은 true 다.
                     그래서 Number() 로 감싸 검사하면 모르는 값이 '+$0.00' 으로
                     표시된다 — 사용자는 본전이라고 읽는다. 실제로 그렇게 나왔다.
                */
                const v = (r.unPnl === null || r.unPnl === undefined) ? NaN : Number(r.unPnl);
                if (!Number.isFinite(v)) {
                  return <span style={{color:'var(--color-text-tertiary)'}} title={t('pos_pnl_unknown')}>—</span>;
                }
                const pct = (r.unPnlPct === null || r.unPnlPct === undefined) ? NaN : Number(r.unPnlPct);
                return (
                  <span className={v >= 0 ? 't-long':'t-short'}>
                    {v >= 0 ? '+' : ''}${fmt(v)}
                    {Number.isFinite(pct) && (
                      <span style={{color:'var(--color-text-tertiary)', marginLeft:4}}>({pct.toFixed(1)}%)</span>
                    )}
                  </span>
                );
              } },
              { key: 'act', label: '', align:'right', render: _r => (
                <>
                  <button className="tbl-action">TP/SL</button>
                  <button className="tbl-action tbl-action--danger" style={{marginLeft:4}}>{t('close')}</button>
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
    const acct = window.useAccountData ? window.useAccountData() : { status: 'OFFLINE', isLive: false };

    /*
       거래 기록.

       실데이터는 거래소 원장의 REALIZED_PNL 항목이다 — 거래소가 확정한 금액이므로
       우리가 다시 계산하지 않는다. 체결(fills)로 손익을 직접 구하려면 진입·청산을
       짝지어야 하고, 그 결과가 거래소 값과 어긋나면 사용자는 어느 쪽을 믿어야
       할지 알 수 없다.

       실데이터가 없으면 목업을 유지한다. 빈 표를 보여주면 "거래 기록이 없다" 는
       거짓이 되고, 계산 결과도 전부 0 이 되어 화면이 고장처럼 보인다.
    */
    const liveJournal = (acct.isLive && window.QTAccount) ? window.QTAccount.getJournal() : [];

    /*
       우리 DB 의 체결 기록 (모의 포함).

       ★★ 전에는 `acct.isLive`(거래소 API 키 검증)만 봤다. 키가 없으면 우리 DB 에
         실제 체결이 있어도 목업 통계를 보여줬다:
             'TOTAL PNL · 10 TRADES +$661.87' · 'WIN RATE 80% 8W · 2L'
             'BEST TRADE +$212 · BTC/USDT'
         사용자는 이 숫자를 자기 성과로 읽는다. 전략을 그 숫자로 판단한다.

       ★ 손익을 지어내지 않는다. 우리 체결 기록에는 종료 가격이 없어(모의 주문은
         청산 흐름이 없다) 손익을 계산할 수 없다. `pnl: null` 로 두고, 아래
         집계가 null 을 만나면 통계를 '—' 로 표시한다.
    */
    const [localTrades, setLocalTrades] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.localTrades) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      const load = () => {
        const auth = window.QTAuth;
        if (!auth || !auth.isLoggedIn || !auth.isLoggedIn()) return;
        api.localTrades({ limit: 200 }).then((r) => {
          if (cancelled || !r.items.length) return;
          /*
             ★ 표가 기대하는 필드명을 정확히 맞춘다 (QT.TRADE_JOURNAL 과 동일).

               `sym` 을 `symbol` 로 넘기거나 `tag` 를 빠뜨리면 렌더 중
               `undefined.map` 으로 터져 **표 전체가 사라진다.** 실제로 겪었다 —
               목업에는 모든 필드가 있어서 드러나지 않던 문제다.
          */
          setLocalTrades(r.items.map((x) => ({
            id: x.id,
            // 표는 'BTC/USDT' 형태를 기대한다. 서버는 'BTCUSDT' 를 준다.
            sym: String(x.symbol || '').replace(/USDT$/, '/USDT'),
            date: x.at ? new Date(x.at).toISOString().slice(0, 10) : null,
            side: x.side,
            entry: x.price === null ? null : Number(x.price),
            // 종료 가격이 없다. 모의 주문에는 청산 흐름이 없기 때문이다.
            exit: null,
            size: x.quantity === null ? null : Number(x.quantity),
            // 수익률도 종료 가격이 있어야 계산된다.
            roi: null,
            // 감정 기록·태그는 사용자가 직접 남기는 것이고, 아직 입력 경로가 없다.
            mood: null,
            tag: [],
            /*
               손익을 계산하지 않는다.

               ★ 진입가만으로는 손익을 알 수 없다. 0 으로 두면 '손익 없음' 이
                 되고, 현재가로 계산하면 아직 청산하지 않은 것을 실현 손익으로
                 표시하는 셈이다. 둘 다 거짓이다.
            */
            pnl: null,
            fee: x.fee === null ? null : Number(x.fee),
            time: x.at,
          })));
        }).catch(() => { /* 조회 실패를 빈 목록으로 위장하지 않는다 */ });
      };
      load();
      const off = (window.QTAuth && window.QTAuth.subscribe) ? window.QTAuth.subscribe(load) : null;
      return () => { cancelled = true; if (off) off(); };
    }, []);

    /*
       ★★ `isLive` 를 "거래 기록이 있는가" 로 판단하고 있었다 — 그게 결함이었다.

         거래소 키를 연결했지만 아직 거래가 없는 이용자는 `isLive === false` 가
         되어 **목업 문구가 그대로 나왔다.** 실측: 거래 0건인데 화면에
         `TOTAL PNL · 10 TRADES` 와 `▲ 12.40% vs prev 10` 이 표시됐다.
         `QTMockPolicy.allowMockData()` 가 false 인 상태에서도 그랬다.

       ★ 거래 0건은 **사실**이다 — 목업으로 대체할 대상이 아니다. 그래서
         "실데이터인가" 는 기록 유무가 아니라 **목업이 허용되는 환경인가**로
         판단한다. 판정은 QTMockPolicy 한 곳에서 한다(규칙 7).
    */
    const mockAllowed = Boolean(window.QTMockPolicy && window.QTMockPolicy.allowMockData
      ? window.QTMockPolicy.allowMockData()
      : false);
    const isLive = !mockAllowed;
    /*
       거래소 계정을 읽을 수 있는가(검증된 키가 있는가).

       ★ 이것과 "거래 기록이 있는가" 는 다르다. 읽을 수 있는데 거래가 없으면
         손익 0 이 사실이고, 읽을 수 없으면 손익은 **모르는 값**이다.
       ★ 미리보기에서는 목업을 보여주므로 읽을 수 있는 것으로 취급한다.
    */
    const canReadAccount = mockAllowed
      || Boolean(window.QTAccount && window.QTAccount.isLive && window.QTAccount.isLive());
    /*
       거래 기록: 거래소 → 우리 DB → (미리보기에서만) 목업.

       ★ 실서비스에서 기록이 없으면 빈 배열이다. 목업 10건(승률 80% · +$661.87)을
         보여주면 신규 사용자가 자기 성과로 읽는다.
    */
    const tj = liveJournal.length > 0
      ? liveJournal
      : (window.QTMockPolicy
          ? window.QTMockPolicy.pick(localTrades, window.QTApp.TRADE_JOURNAL)
          : (localTrades || window.QTApp.TRADE_JOURNAL));

    /*
       손익을 알 수 없는 거래가 섞였는가.

       ★ 하나라도 모르면 합계·승률·평균을 만들 수 없다. 일부만 세면 그 값이
         전체처럼 보인다 — 10건 중 3건만 계산한 승률을 '승률' 이라고 하면 거짓이다.
    */
    const pnlUnknown = tj.some((x) => x.pnl === null || x.pnl === undefined);

    const wins = tj.filter(t => t.pnl > 0);
    const losses = tj.filter(t => t.pnl < 0);
    // 손익을 모르는 거래가 있으면 합계도 모르는 것이다 (위 pnlUnknown 참고).
    const totalPnl = pnlUnknown ? null : tj.reduce((a,t) => a+t.pnl, 0);
    // 거래가 0건이거나 손익을 모르면 승률을 만들 수 없다.
    const winRate = (tj.length > 0 && !pnlUnknown) ? (wins.length / tj.length) * 100 : null;
    const avgWin = pnlUnknown ? null : wins.reduce((a,t) => a+t.pnl, 0) / (wins.length || 1);
    const avgLoss = pnlUnknown ? null : losses.reduce((a,t) => a+t.pnl, 0) / (losses.length || 1);

    /*
       수수료·펀딩비.

       실현손익과 별개 항목이다. 순손익을 보려면 이것까지 빼야 한다 —
       손익만 보고 "이익이 났다" 고 판단하면 수수료로 잃은 부분을 놓친다.
    */
    const costs = React.useMemo(() => {
      if (!acct.isLive || !window.QTAccount) return null;
      const tx = window.QTAccount.getTransactions();
      const sum = (kind) => tx.filter(x => x.kind === kind).reduce((a, x) => a + (Number(x.amount) || 0), 0);
      return {
        fees: sum('COMMISSION_FEE'),
        funding: sum('FUNDING_FEE'),
        liquidation: sum('LIQUIDATION_CLEARANCE'),
      };
    }, [acct.version, acct.isLive]);

    // Bar heights (win/loss distribution)
    const daysBack = 30;
    /*
       일별 손익.

       예전에는 `idx % daysBack === i` 로 나눴다 — 배열 순서를 날짜처럼 쓴 것이고,
       실제 거래일과 아무 관계가 없다. 거래가 하루에 몰려도 30일에 흩어져 보인다.

       실제 날짜로 묶는다. 거래가 없는 날은 0 이다(빈 값이 아니라 0 이 사실이다).
    */
    const dailyPnl = React.useMemo(() => {
      const dayMs = 24 * 60 * 60 * 1000;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const startOfWindow = todayStart.getTime() - (daysBack - 1) * dayMs;

      const buckets = new Array(daysBack).fill(0);
      for (const t of tj) {
        // 목업은 date 문자열, 실데이터는 time(ms) 을 갖는다. 둘 다 처리한다.
        const ms = Number.isFinite(t.time) && t.time > 0
          ? t.time
          : (t.date ? new Date(t.date + 'T00:00:00').getTime() : NaN);
        if (!Number.isFinite(ms)) continue;
        const idx = Math.floor((ms - startOfWindow) / dayMs);
        // 30일 창 밖의 거래는 버린다 — 억지로 끝 칸에 몰면 그 날 손익이 왜곡된다.
        /*
           ★ 손익을 모르는 체결은 더하지 않는다.

             `buckets[idx] += null` 은 0 을 더하는 것과 같아서, 막대가 없는
             날처럼 보인다. 실제로는 "그 날 거래는 있었지만 손익을 모른다" 는
             뜻이므로, 그래프를 아예 그리지 않는 편이 정직하다(아래 pnlUnknown).
        */
        if (typeof t.pnl !== 'number' || !Number.isFinite(t.pnl)) continue;
        if (idx >= 0 && idx < daysBack) buckets[idx] += t.pnl;
      }
      return buckets;
    }, [tj]);

    return (
      <window.PageShell
        {...shellProps}
        title={t('nav_analytics')}
        subtitle={t('an_page_sub')}
        breadcrumb={['Home','Analytics']}
        actions={
          <>
            {/* Export 숨김 — 위 Export Report 와 같은 이유(배선할 경로가 없다). */}
            {/* eslint-disable-next-line no-constant-binary-expression -- 마크업을 지우지 않고 감춘다(배선 전). 되살릴 때 조건만 지운다. */}
            {false && (
              <button className="btn btn--sm"><I.Camera size={13}/> {t('export_csv')}</button>
            )}
            {/*
               ★★ onClick 이 없어서 눌러도 아무 일이 없었다.

                 AI 는 아직 연결되지 않았다(서버가 provider: 'unavailable' 을 준다).
                 그래서 분석을 만들어낼 수 없다 — 없는 분석을 그리면 이용자가 그
                 숫자로 매매한다.

               ★ 대신 코파일럿을 열어 거기서 답하게 한다. 코파일럿은 AI 미연결일 때
                 "연결되지 않아 가격을 제시하지 않는다" 고 이미 정직하게 말한다.
                 여기서 같은 문장을 또 만들지 않는다(한 곳에서만 말한다).
            */}
            <button
              className="btn btn--sm btn--primary"
              onClick={() => {
                /* 코파일럿이 접혀 있으면 펼친다. */
                if (window.QTPanelState && window.QTPanelState.setCollapsed) {
                  window.QTPanelState.setCollapsed('ai', false);
                }
                try { localStorage.setItem('qt.ai.collapsed', '0'); } catch (e) { /* 저장 실패는 치명적이지 않다 */ }
                /*
                   ★ 분석 화면에는 코파일럿이 없다. 거래 화면으로 보낸다 —
                     거기서 코파일럿이 종목 문맥을 들고 답한다.
                */
                if (typeof location !== 'undefined') location.hash = '#/trade?ai=review';
              }}
            >
              <I.Sparkles size={13}/> {t('an_ai_review')}
            </button>
          </>
        }
      >
        <div className="grid-4">
          {/*
            실데이터일 때는 delta(전기간 대비)를 넣지 않는다. 이전 구간과 비교하려면
            기간을 나눠 두 번 집계해야 하고, 지금은 그 근거가 없다.
            가짜 증감률을 붙이면 사용자가 추세를 잘못 읽는다.
          */}
          {/*
             총 손익.

             ★ null 이면 '—' 다. 우리 DB 의 체결 기록에는 종료 가격이 없어
               손익을 계산할 수 없다(모의 주문에 청산 흐름이 없다).
               0 으로 표시하면 "본전" 으로 읽히고, 현재가로 계산하면 청산하지
               않은 것을 실현 손익이라고 말하는 셈이다.
          */}
          <window.KPICard
            label={t('an_total_pnl', { count: tj.length })}
            /*
               ★★ 세 상태를 구분한다.

                 1) 계정을 읽을 수 없다(키 없음/미검증) → `—`
                    기록이 0건인 것은 우리가 **볼 수 없어서**다. `+$0.00` 을
                    보여주면 "거래했지만 본전" 으로 읽힌다. 실측으로 이 상태에서
                    `+$0.00 · Confirmed by the exchange` 가 나오고 있었다 —
                    거래소가 확인해 준 적이 없는데 그렇게 말했다.
                 2) 읽을 수 있고 기록 0건 → `$0.00` (사실이다: 실현 손익이 없다)
                 3) 손익을 모르는 거래가 섞였다 → `—` (일부만 세면 거짓이 된다)
            */
            value={!canReadAccount || totalPnl === null
              ? t('dash')
              : (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl)}
            /*
               ★★ `+12.4` 가 박혀 있었다 — 이전 기간과 비교한 적이 없다.

                 이전 10건과 비교하려면 그 10건의 손익이 있어야 하는데, 우리는
                 그 계산을 하지 않는다. 없는 비교를 표시하면 이용자가 "성과가
                 나아지고 있다" 고 읽는다. 값을 만들지 않고 델타를 빼둔다.
            */
            sub={!canReadAccount
              ? t('an_no_account')
              : (totalPnl === null ? t('an_pnl_unknown') : (isLive ? t('an_from_exchange') : undefined))}
            tone={!canReadAccount || totalPnl === null ? undefined : totalPnl >= 0 ? 'long' : 'short'}
          />
          {/* 거래가 0건이면 승률을 만들 수 없다. NaN 을 화면에 띄우지 않는다. */}
          <window.KPICard
            label={t('kpi_win_rate')}
            value={winRate === null ? '—' : winRate.toFixed(0) + '%'}
            sub={`${wins.length}W · ${losses.length}L`}
            tone="brand"
          />
          <window.KPICard
            label={t('an_avg_win_loss')}
            value={(tj.length === 0 || avgWin === null || avgLoss === null)
              ? '—'
              : `$${fmt(avgWin,0)} / $${fmt(Math.abs(avgLoss),0)}`}
            sub={(avgWin !== null && avgLoss !== null && losses.length > 0 && avgLoss !== 0)
              ? `R:R ${(avgWin / Math.abs(avgLoss)).toFixed(2)} : 1`
              : t('an_rr_na')}
            tone="ai"
          />
          {/* 최고 수익 거래를 실제 기록에서 찾는다. 예전에는 값이 박혀 있었다. */}
          {(() => {
            /*
               최고 수익 거래.

               ★ 손익을 모르면 '가장 좋은 거래' 를 정할 수 없다. 진입가가 높은
                 것을 최고라고 하면 그것은 손익과 무관한 값이다.
            */
            const scored = tj.filter((x) => typeof x.pnl === 'number' && Number.isFinite(x.pnl));
            const best = scored.length > 0 ? scored.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
            return (
              <window.KPICard
                label={t('an_best_trade')}
                value={best ? `${best.pnl >= 0 ? '+' : ''}$${fmt(best.pnl, 0)} · ${best.sym}` : '—'}
                sub={best ? [best.date, best.side ? (best.side === 'long' ? 'Long' : 'Short') : null].filter(Boolean).join(' · ') : undefined}
                tone={best && best.pnl >= 0 ? 'long' : 'short'}
              />
            );
          })()}
        </div>

        {/*
          비용 요약. 실현손익만 보면 수수료·펀딩비로 잃은 부분을 놓친다.
          실데이터가 있을 때만 보여준다 — 목업에는 이 값이 없다.
        */}
        {isLive && costs && (
          <div className="grid-4">
            <window.KPICard label={t('an_fees')} value={'$' + fmt(Math.abs(costs.fees), 4)} sub={t('an_cost_note')} tone="short"/>
            <window.KPICard label={t('an_funding')} value={(costs.funding >= 0 ? '+' : '-') + '$' + fmt(Math.abs(costs.funding), 4)} tone={costs.funding >= 0 ? 'long' : 'short'}/>
            {/* 손익을 모르면 순손익도 만들 수 없다. 수수료만 빼서 보여주면 그것이 순손익처럼 읽힌다. */}
            <window.KPICard label={t('an_net')}
              value={totalPnl === null ? '—' : ((totalPnl + costs.fees + costs.funding) >= 0 ? '+' : '') + '$' + fmt(totalPnl + costs.fees + costs.funding)}
              sub={totalPnl === null ? t('an_pnl_unknown') : t('an_net_note')}
              tone={totalPnl === null ? undefined : (totalPnl + costs.fees + costs.funding) >= 0 ? 'long' : 'short'}/>
            <window.KPICard label={t('an_liquidations')} value={costs.liquidation !== 0 ? '$' + fmt(Math.abs(costs.liquidation), 2) : '—'} tone={costs.liquidation !== 0 ? 'short' : undefined}/>
          </div>
        )}

        <div className="grid-2-1">
          <window.SectionCard
            title={t('an_daily_pnl_30')}
            /* ★ 목업 미리보기에서만 '모의 분포' 라고 밝힌다. 실서비스에서는 실데이터다. */
            subtitle={mockAllowed ? t('an_daily_simulated') : t('an_daily_real')}
          >
            {/*
               ★ 손익을 모르면 그래프를 그리지 않는다.

                 전부 0 인 막대 그래프는 "매일 본전이었다" 로 읽힌다. 실제로는
                 계산할 근거가 없는 것이다.
            */}
            {pnlUnknown ? (
              <div style={{padding:'28px 12px', textAlign:'center', fontSize:12.5, lineHeight:1.8,
                           color:'var(--color-text-tertiary)'}}>
                {t('an_pnl_unknown')}
              </div>
            ) : (
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
            )}
          </window.SectionCard>

          {/*
             ★★ 여기 있던 3개 카드는 전부 **만들어낸 숫자**였다.

               'AI signal win rate 82%' · 'Nervous trades lose 40% of the time'
               (손실 확률 2.3배) · 'Afternoon session outperforms 34%'.

               우리는 그 분석을 한 적이 없다. AI provider 는 연결조차 안 됐고
               (`/api/ai/status` → available:false), 감정 태그별 손실률이나
               시간대별 성과를 계산하는 코드도 없다. 그런데 화면은 그 수치를
               단정해서 말했고, 이용자는 그것으로 **매매 시간과 심리 관리를
               바꾼다.** 근거 없는 숫자가 실제 행동을 바꾸는 자리다.

             ★ 카드를 지우지 않고(UI 계약) 무엇이 필요한지 밝힌다. 표본이
               쌓이고 계산이 붙으면 이 자리에 실제 결과가 들어간다.
          */}
          <window.SectionCard title={t('an_ai_insights')} subtitle={t('an_insights_sub')}>
            <div style={{display:'flex', flexDirection:'column', gap: 10}}>
              <div style={{padding:'10px 12px', background:'var(--color-bg-subtle)', borderLeft:'3px solid var(--color-border-default)', borderRadius:4, fontSize:12, lineHeight:1.6}}>
                <strong>{t('an_insights_none')}</strong><br/>
                <span style={{color:'var(--color-text-secondary)'}}>{t('an_insights_why')}</span>
              </div>
              {/*
                 ★ 무엇이 있으면 되는지 적는다 — 이용자가 일지를 쓸 동기가 된다.
                   (거래 기록만으로는 감정·시간대 분석을 만들 수 없다.)
              */}
              <div style={{padding:'10px 12px', background:'var(--color-bg-subtle)', borderLeft:'3px solid var(--color-border-default)', borderRadius:4, fontSize:12, lineHeight:1.6}}>
                <strong>{t('an_insights_need')}</strong><br/>
                <span style={{color:'var(--color-text-secondary)'}}>{t('an_insights_need_why')}</span>
              </div>
            </div>
          </window.SectionCard>
        </div>

        <window.SectionCard
          title={t('an_journal')}
          subtitle={t('an_journal_sub', { n: tj.length })}
          /*
             Manual Entry 를 숨겼다 — 거래일지를 손으로 넣는 화면이 아직 없다.
             ★ 서버에 trade_journal 표는 있지만 입력 폼과 라우트가 없다.
               누를 수 있게 두면 이용자가 일지를 쓸 수 있다고 믿는다.
          */
          actions={null}
          noPadding
        >
          <window.DataTable
            columns={[
              { key: 'date',  label: t('col_date'), width: 100 },
              { key: 'sym',   label: t('col_symbol'), render: r => <strong>{r.sym}</strong> },
              /*
                 거래소 원장에는 방향·진입가·청산가·수량이 없다(실현손익만 준다).
                 없는 값을 만들지 않고 '—' 로 둔다 — 손익 부호로 방향을 추측하면
                 틀린다(숏도 이익이 날 수 있다).
              */
              { key: 'side',  label: t('col_side'), render: r => (
                r.side ? <span className={r.side==='long'?'t-long':'t-short'}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span>
                       : <span style={{color:'var(--color-text-tertiary)'}}>—</span>
              ) },
              { key: 'entry', label: t('col_entry'), align:'right', render: r => (r.entry == null ? '—' : fmt(r.entry, 2)) },
              { key: 'exit',  label: t('col_exit'),  align:'right', render: r => (r.exit == null ? '—' : fmt(r.exit, 2)) },
              { key: 'size',  label: t('col_size'),  align:'right', render: r => (r.size == null ? '—' : fmt(r.size, 3)) },
              { key: 'pnl',   label: t('col_pnl'), align:'right', render: r => {
                /*
                   ★ 손익을 모르면 '—' 만 쓴다.

                     전에는 `{r.pnl >= 0 ? '+' : ''}${fmt(r.pnl)}` 이라 null 일 때
                     '+$—' 처럼 부호와 통화기호가 남았다. 부호가 붙으면 이익이
                     있었던 것처럼 읽힌다.
                */
                if (r.pnl === null || r.pnl === undefined || !Number.isFinite(Number(r.pnl))) {
                  return <span style={{color:'var(--color-text-tertiary)'}} title={t('an_pnl_unknown')}>—</span>;
                }
                return (
                  <span className={r.pnl >= 0 ? 't-long' : 't-short'} style={{fontWeight:500}}>
                    {r.pnl >= 0 ? '+' : ''}${fmt(r.pnl)}
                    {/* 수익률은 투입 자본을 알아야 구한다. 원장에 없으면 표시하지 않는다. */}
                    {r.roi != null && (
                      <span style={{color:'var(--color-text-tertiary)', marginLeft:4, fontSize:10}}>({r.roi >= 0 ? '+' : ''}{r.roi.toFixed(2)}%)</span>
                    )}
                  </span>
                );
              } },
              { key: 'mood',  label: t('an_col_mood'), render: r => {
                const m = { confident: '😎', neutral: '😐', nervous: '😬' };
                return <span title={r.mood} style={{fontSize:14}}>{m[r.mood] || '·'}</span>;
              }},
              { key: 'tag',   label: t('an_col_tags'), render: r => (
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
  /*
     멀티차트 페이지를 제거했다 (2026-08, 사장님 지시).

     ★★ 기능은 거래 화면으로 옮겨졌다 — `window.ChartGrid`(src/chart-grid.jsx).

       `/trade` 차트 위의 `Charts: Single / 2 / 2x2 / 3x2` 가 같은 일을 한다.
       그쪽이 나은 점:
         · 칸마다 **완전한 차트**다(여기서는 축소판 MiniChart 였다).
         · 포커스된 칸이 주문 대상이므로 보던 자리에서 바로 주문한다.
           이 페이지에서는 주문 패널이 없어 탭을 옮겨야 했고, 그 사이 호가가 바뀐다.
         · 종목 목록이 QTMarkets 단일 출처다. 여기서는 6종목이 박혀 있었고
           표기가 `BTC/USDT` 라서 시세 키(`BTCUSDT`)와 달라 시세가 붙지 않았다.
  */


  // ============================================================
  // WALLET PAGE — Exchange Connect + Referrals + Balances
  // ============================================================
  window.WalletPage = function WalletPage({ shellProps }) {
    const _USER = window.QTApp.USER;
    /*
       ★ 훅은 조건 없이 호출한다. 원래 `if (window.QTApi && window.QTApi.useConfig)
         window.QTApi.useConfig();` 였다 — QTApi 가 첫 렌더보다 늦게 준비되면
         훅 개수가 바뀌어 화면이 비어 버린다(실제로 겪었다).
    */
    const _cfg = window.QTApi && window.QTApi.useConfig ? window.QTApi.useConfig() : null;

    /*
       KuCoin Fast API 인증 결과.

       ★★ 토스트가 아니라 **화면에 남는 배너**로 알린다.

         처음에는 QTToast 를 썼는데 알림이 뜨지 않았다. 원인은 타이밍이었다 —
         이 효과는 화면이 마운트될 때 바로 돌지만 그 시점에 window.QTToast 가
         아직 정의되지 않아 `if (window.QTToast)` 가 false 로 지나갔다.
         조용히 사라지는 알림이 된 것이다.

         타이밍을 맞추는 대신 배너로 바꾼다. 연결 성공·실패는 이용자가 놓치면
         안 되는 정보이고(키가 연결됐는지 여부다), 토스트는 몇 초 뒤 사라져
         잠깐 다른 곳을 보면 놓친다.

       ★ 주소에서 결과 값은 즉시 지운다. 남겨 두면 새로고침마다 같은 알림이
         뜨고, 이미 지난 실패를 현재 상태로 오해한다.
    */
    const [oauthResult, setOauthResult] = React.useState(null);
    React.useEffect(() => {
      /*
         ★ 해시가 아니라 **pathname 쿼리**를 읽는다.

           해시 뒤에 붙은 값(`#/wallet?kucoinOauth=…`)은 해시 라우터가 경로를
           정규화하면서 지운다(실측으로 확인했다). 서버 콜백은 그래서
           `/index.html?kucoinOauth=…#/wallet` 형태로 돌려보낸다.
      */
      const params = new URLSearchParams(window.location.search || '');
      const reason = params.get('kucoinOauth');
      if (!reason) return;

      const MAP = {
        connected: { key: 'fast_api_connected', ok: true },
        invalid_state: { key: 'fast_api_invalid_state', ok: false },
        session_mismatch: { key: 'fast_api_session_mismatch', ok: false },
        missing_params: { key: 'fast_api_invalid_state', ok: false },
        token_exchange_failed: { key: 'fast_api_token_failed', ok: false },
        key_issue_failed: { key: 'fast_api_key_failed', ok: false },
        unreachable: { key: 'fast_api_unreachable', ok: false },
      };
      setOauthResult(MAP[reason] || { key: 'fast_api_token_failed', ok: false });

      // 주소에서 결과 값을 제거한다(위 주석 참고). 해시는 그대로 둔다.
      params.delete('kucoinOauth');
      const rest = params.toString();
      window.history.replaceState(
        null, '',
        window.location.pathname + (rest ? '?' + rest : '') + (window.location.hash || ''),
      );
    }, []);

    /*
       거래소 목록 — 서버 판정을 쓴다.

       ★★ 원래 `window.QTApp.EXCHANGES`(예시 9개)를 직접 읽었다. 그 중 실제로
         연결되는 것은 2개(KuCoin·BitMart)뿐인데 9개 모두 "연결" 버튼이
         있었다. 사용자가 거래소에서 키를 만들어 넣고, 아무것도 조회되지 않는
         이유를 알 수 없다.

       ★ 관리자에게는 미협약까지 보여준다 — 어떤 거래소가 준비 중인지 운영자는
         알아야 한다. 일반 사용자에게는 감춘다.
    */
    const isStaff = window.QTAccess
      ? window.QTAccess.RANK[shellProps && shellProps.role] >= window.QTAccess.RANK.admin
      : false;
    /*
       ★★ 백엔드가 없는 디자인 미리보기에서는 예시 목록을 쓴다.

         이 분기가 없어서 미리보기에서 "거래소를 불러오는 중…" 에 영원히 멈췄다
         (API 가 없으므로 응답이 오지 않는다). 디자이너가 자기 화면을 볼 수 없게
         되는 것은 불가침 위반이다 — 랜딩에는 넣었는데 이 화면을 빠뜨렸다.
    */
    const exPreviewOnly = window.QTLive && window.QTLive.isBackendPresent
      && window.QTLive.isBackendPresent() === false;
    /*
       실제로 연결된 거래소.

       ★★ 전에는 목업 상수(`USER.connectedExchanges = ['binance','bitget']`)를 봤다.
         그래서 KuCoin 키를 진짜로 연결해도 카드는 `AVAILABLE` 이었고, 연결한 적
         없는 binance·bitget 이 '연결됨' 으로 표시됐다. 이용자는 자기가 어느
         거래소를 연결했는지 이 화면에서 확인하는데, 그 정보가 거짓이었다.

       ★ 조회 실패는 빈 목록이 아니라 null 로 남긴다 — "연결 없음" 과
         "확인 못 함" 은 다르다.
    */
    const [creds, setCreds] = useState(null);
    const [syncing, setSyncing] = useState(false);
    /*
       자격증명 목록 재조회.

       ★ 마운트와 'Sync' 버튼이 같은 함수를 쓴다. 두 곳에 따로 쓰면 한쪽만
         고치는 일이 생기고, 새로고침 결과가 처음 조회와 달라진다.
    */
    const reloadCreds = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.credentials;
      if (!api || !api.list) return Promise.resolve();
      return api.list()
        .then((r) => { setCreds((r && r.data) || []); })
        /* 실패는 null 로 남긴다 — "연결 없음" 과 "확인 못 함" 은 다르다. */
        .catch(() => { setCreds(null); });
    }, []);
    useEffect(() => {
      let alive = true;
      const api = window.QTApi && window.QTApi.credentials;
      if (!api || !api.list) return undefined;
      api.list()
        .then((r) => { if (alive) setCreds((r && r.data) || []); })
        .catch(() => { if (alive) setCreds(null); });
      return () => { alive = false; };
    }, []);
    /*
       ★ 검증된 것만 '연결됨' 으로 본다. UNVERIFIED/FAILED 를 연결됨으로 표시하면
         이용자가 왜 잔고가 안 보이는지 알 수 없다.
    */
    const connectedIds = React.useMemo(
      () => (creds || []).filter((c) => c.connectionStatus === 'VERIFIED').map((c) => String(c.exchange || '').toLowerCase()),
      [creds],
    );

    const exData = window.QTApi && window.QTApi.useExchanges
      ? window.QTApi.useExchanges(isStaff)
      : null;
    /* 조회 중(null)에는 예시 목록으로 채우지 않는다 — 잠깐 보였다 사라지면
       사용자가 그 거래소를 기억한다. 단 미리보기는 예외(위 참조). */
    const EX = exPreviewOnly
      ? (window.QTApp.EXCHANGES || [])
      : (exData ? exData.items : []);
    const exLoading = !exPreviewOnly && exData === null;
    const exHidden = exPreviewOnly ? 0 : (exData ? exData.hiddenNotConnectable : 0);
    const [tab, setTab] = useState('exchanges');   // exchanges | balances | deposit | withdraw
    const [connectingEx, setConnectingEx] = useState(null); // exchange 객체

    return (
      <window.PageShell
        {...shellProps}
        title={t('nav_wallet')}
        subtitle={t('wallet_95195c')}
        breadcrumb={['Home','Wallet']}
        actions={
          <>
            {/*
               ★★ 두 버튼 다 onClick 이 없어서 눌러도 아무 일이 없었다.

                 'Sync' 는 거래소 연결 상태를 다시 읽는 것이 자연스럽다 —
                 다른 창에서 키를 지웠거나 검증이 끝난 것을 반영한다.
                 'Add Exchange' 는 연결 탭으로 보낸다(추가 절차가 그 탭에 있다).
            */}
            <button
              className="btn btn--sm"
              disabled={syncing}
              onClick={() => {
                setSyncing(true);
                Promise.resolve(reloadCreds()).finally(() => setSyncing(false));
              }}
            >
              <I.Refresh size={13}/> {t('col_sync')}
            </button>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => {
                setTab('exchanges');
                /*
                   ★★ 스크롤만으로는 부족하다.

                     이미 연결 탭에 있고 목록이 화면에 보이면 **눌러도 아무 변화가
                     없다** — 이용자에게는 고장으로 보인다(검증 도구도 무반응으로
                     잡았다).

                   ★ 그래서 안내를 띄운다. 어디서 무엇을 해야 하는지 말한다.
                */
                if (typeof document !== 'undefined') {
                  const el = document.querySelector('[data-exchange-list]');
                  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                if (window.QTToast) {
                  window.QTToast({
                    title: t('wal_add_exchange_how'),
                    desc: t('wal_add_exchange_how_desc'),
                    variant: 'info',
                  });
                }
              }}
            >
              <I.Plus size={13}/> {t('wal_add_exchange')}
            </button>
          </>
        }
      >
        {/*
           KuCoin Fast API 연결 결과.

           ★ 화면에 남는 배너다(토스트가 아니다). 이용자가 KuCoin 을 다녀온 뒤
             연결됐는지 실패했는지 반드시 알아야 하고, 토스트는 몇 초 뒤 사라져
             잠깐 다른 곳을 보면 놓친다.
        */}
        {oauthResult && (
          <div
            role="status"
            style={{
              display:'flex', alignItems:'flex-start', gap:10, flexWrap:'wrap',
              padding:'12px 14px', marginBottom:12, borderRadius:6,
              border:'1px solid ' + (oauthResult.ok ? 'var(--color-success)' : 'var(--color-warning)'),
              background:'color-mix(in srgb, ' + (oauthResult.ok ? 'var(--color-success)' : 'var(--color-warning)') + ' 10%, transparent)',
            }}
          >
            <span style={{fontSize:12.5, lineHeight:1.7, color: oauthResult.ok ? 'var(--color-success)' : 'var(--color-warning)'}}>
              {t(oauthResult.key)}
            </span>
            <button
              className="btn btn--xs"
              type="button"
              style={{marginLeft:'auto'}}
              onClick={() => setOauthResult(null)}
            >
              {t('sec_done')}
            </button>
          </div>
        )}

        {/* Tab bar */}
        <div style={{display:'flex', gap:0, borderBottom:'1px solid var(--color-border-subtle)', marginBottom: -12}}>
          {[
            { id:'exchanges', label:t('wallet_ed546c'),   icon:'Wifi' },
            { id:'balances',  label:t('wallet_f23807'),     icon:'Wallet' },
          {/*
             ★★ 입금·출금 탭을 주석으로 내렸다 (요청: 우리 페이지에서 입출금을 하지 않는다).

               우리는 비수탁이므로 입금 주소도, 출금 실행 권한도 없다. 탭이 있으면
               사용자는 여기서 입출금을 하는 것으로 기대하고 들어와, 결국 "거래소에서
               하세요" 라는 안내만 보고 되돌아온다. 기대를 만들지 않는 편이 낫다.

             ★ 코드는 지우지 않는다. 나중에 입출금을 우리 화면에서 다루기로 하면
               이 두 줄과 아래 탭 본문의 주석을 풀면 된다.
               (되살릴 때 함께 볼 것: app.jsx 의 /wallet/deposit · /wallet/withdraw 라우트,
                access.js 의 라우트 등급, page-shell.jsx 의 메뉴 항목)
          */}
            // { id:'deposit',   label:t('wallet_b9ca11'),          icon:'Down' },
            // { id:'withdraw',  label:t('wallet_972169'),          icon:'Up' },
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
          /*
             ★ data-exchange-list 는 'Add Exchange' 버튼이 이 영역으로 스크롤할 때
               쓰는 표식이다. 표식이 없으면 scrollIntoView 가 조용히 아무것도
               하지 않아, 버튼이 다시 무반응이 된다.
          */
          <div data-exchange-list>
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

            {/*
               목록 상태 안내.

               ★ 조회 중과 0개를 구분한다. 둘 다 카드가 없는 화면이지만,
                 "불러오는 중" 과 "연결할 수 있는 거래소가 없다" 는 다른 사실이다.
               ★ 감춘 개수를 일반 사용자에게도 알린다 — 목록이 짧은 이유를
                 모르면 "왜 내가 쓰는 거래소가 없나" 로 문의가 온다.
            */}
            {exLoading && (
              <div style={{padding:'18px 0', textAlign:'center', color:'var(--color-text-tertiary)', fontSize:12}}>
                {t('ex_loading')}
              </div>
            )}
            {!exLoading && EX.length === 0 && (
              <div style={{padding:'18px 0', textAlign:'center', color:'var(--color-text-tertiary)', fontSize:12}}>
                {t('ex_none')}
              </div>
            )}
            {!exLoading && exHidden > 0 && (
              <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginBottom:10}}>
                {t('ex_hidden_note', { n: exHidden })}
              </div>
            )}

            <div className="grid-3">
              {EX.map(ex => {
                const isConnected = connectedIds.includes(String(ex.id).toLowerCase());
                /* 미협약 = 어댑터가 없어 실제로 연결되지 않는 거래소.
                   관리자에게만 보이며, 노란색으로 아직 확정이 아님을 알린다. */
                const notReady = ex.connectable === false;
                return (
                  <div key={ex.id} className={`exchange-card ${isConnected ? 'is-connected' : ''} ${ex.recommended && !notReady ? 'is-recommended' : ''}`} style={notReady ? {borderColor:'color-mix(in srgb, var(--color-warning) 40%, transparent)'} : undefined}>
                    <div className="exchange-card__head">
                      <div className="exchange-card__logo" style={{background: ex.logoBg, color: ex.logoColor, ...(notReady ? {opacity:0.55} : {})}}>
                        {/* ★ 실제 브랜드 로고가 있으면 SVG, 없으면 디자이너 원본
                            글자 배지로 폴백한다(마크업 구조는 그대로).

                            ★ BitMart 처럼 로고가 자체 브랜드 색을 가진 경우,
                              배지 배경색과 비슷해 묻힌다. 그럴 때만 흰 라운드
                              패드를 깔아 어느 배경에서도 선명하게 한다. KuCoin
                              심볼은 단색이라 배지의 logoColor 를 물려받으면 된다. */}
                        {(() => {
                          const logo = window.exchangeLogo && window.exchangeLogo(ex.id, { size: 22 });
                          if (!logo) return ex.logoText;
                          const needsPad = String(ex.id).toLowerCase() === 'bitmart';
                          return needsPad
                            ? <span style={{display:'inline-flex', alignItems:'center', justifyContent:'center', width:'82%', height:'82%', background:'#fff', borderRadius:6}}>{logo}</span>
                            : logo;
                        })()}
                      </div>
                      <div style={{flex:1, minWidth:0}}>
                        <div className="exchange-card__name">{ex.name}</div>
                        <div className="exchange-card__market">{
                          /* 서버가 번역 키를 준다(marketKey). 없으면 서버 문장으로 폴백한다 —
                             문장을 화면이 정하지 않고, 언어가 바뀌면 함께 바뀐다. */
                          ex.marketKey ? t(ex.marketKey) : ex.market
                        }</div>
                      </div>
                      {notReady ? (
                        <span
                          className="exchange-card__status"
                          style={{background:'color-mix(in srgb, var(--color-warning) 18%, transparent)', color:'var(--color-warning)'}}
                          title={t('ex_not_partnered_hint')}
                        >
                          {t('ex_not_partnered')}
                        </span>
                      ) : (
                        /*
                           ★★ 연결됐으면 그 사실을 배지로 말한다.

                             전에는 거래소 **가용 상태**(AVAILABLE)만 표시했다. 키를
                             연결한 이용자도 같은 배지를 보므로, 자기가 연결했는지
                             화면에서 확인할 방법이 없었다(테두리 색만 달라졌고 그것은
                             알아채기 어렵다).

                           ★ 두 정보를 겹쳐 쓰지 않는다. 연결됨은 내 상태, AVAILABLE 은
                             거래소 상태다 — 연결됐으면 내 상태를 먼저 보여준다.

                           ★ 중괄호로 감싼 JSX 주석은 **표현식 자리에 올 수 없다.**
                             삼항의 분기 안에 넣으면 `Expected ")"` 로 파일 전체가
                             깨진다 — 이 자리에서 두 번 겪었다. 일반 주석을 쓴다.
                             (그 형태를 여기 적으면 주석 자체가 조기 종료된다.)
                        */
                        <span className={`exchange-card__status ${isConnected ? 'available' : ex.status}`}>
                          {isConnected
                            ? t('wal_ex_connected')
                            /*
                               ★ 거래소 상태 배지도 번역한다.

                                 전에는 `ex.status.toUpperCase()` 를 그대로 찍었다. 상태 코드
                                 표기라는 이유였지만, 결과적으로 중국어·일본어 화면에
                                 'AVAILABLE' 이 영어로 남았다. 3개 언어 대응을 주장하는 제품에서
                                 첫 화면급으로 눈에 띄는 자리다.
                                 사전에 없는 상태가 새로 생기면 코드를 대문자로 보여준다(폴백).
                            */
                            : (t('ex_status_' + ex.status) !== 'ex_status_' + ex.status
                                ? t('ex_status_' + ex.status)
                                : ex.status.toUpperCase())}
                        </span>
                      )}
                    </div>

                    {/* ★ 왜 연결할 수 없는지 카드 안에서 밝힌다. 뱃지만 있으면
                        운영자가 "곧 되나" 하고 기다린다. */}
                    {notReady && (
                      <div style={{fontSize:10.5, lineHeight:1.5, color:'var(--color-warning)', background:'color-mix(in srgb, var(--color-warning) 10%, transparent)', padding:'6px 8px', borderRadius:4}}>
                        {t('ex_not_partnered_note')}
                      </div>
                    )}

                    <div className="exchange-card__products">
                      {ex.supportedProducts.map(p => <span key={p} className="exchange-card__product-chip">{p}</span>)}
                    </div>

                    <div className="exchange-card__referral">
                      <I.Sparkles size={13} style={{color:'var(--color-brand)', flexShrink:0}}/>
                      {/* ★ 서버의 referralNote(문자열)를 쓴다. 예전에는 예시
                          데이터의 referralRebate(객체)를 formatRebate 에 넘겼는데,
                          서버 응답에는 그 필드가 없어 **항상 빈 칸**이었다.
                          referralNote 가 없으면 이 줄을 그리지 않는다. */}
                      {/*
                          ★ 서버는 **번역 키**를 준다(referralNoteKey). 전에는 문장을
                            그대로 받았는데, 서버가 요청 언어를 모르므로 영어·일본어
                            화면에도 한국어가 나왔다.
                      */}
                      <span className="exchange-card__referral__note">{t(ex.referralNoteKey || 'ex_referral_tbd')}</span>
                    </div>

                    {/*
                       추천 코드 (직접 입력용).

                       ★★ 링크를 누르지 않고 거래소에서 바로 가입하는 사람이 있다.
                         그때 코드를 입력할 자리가 있는데, 우리가 코드를 보여주지
                         않으면 빈칸으로 가입하고 **귀속이 안 된다.** 가입은 정상
                         처리되고 리베이트만 0 이 되므로 화면에 아무 오류가 없다 —
                         알아챌 방법이 없는 종류의 손실이다.

                       ★ 코드가 설정에 없으면 이 줄을 그리지 않는다. 예시 코드로
                         채우면 우리 이용자가 남에게 귀속된다(없는 것보다 나쁘다).

                       ★ 이미 그 거래소 계정이 있는 사람은 소급 귀속되지 않는다.
                         문구에 그 사실을 적는다 — 기대만 만들면 안 된다.
                    */}
                    {!notReady && (window.QTApi && window.QTApi.getReferralCode
                      ? window.QTApi.getReferralCode(ex.id) : '') && (
                      <div className="qt-refcode">
                        <span className="qt-refcode__label">{t('wal_ref_code_label')}</span>
                        <code className="qt-refcode__value">{window.QTApi.getReferralCode(ex.id)}</code>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost qt-refcode__copy"
                          onClick={() => window.QTCopy(window.QTApi.getReferralCode(ex.id), {
                            onDone: (ok) => window.QTToast && window.QTToast({
                              title: t(ok ? 'copied' : 'copy_failed'),
                              variant: ok ? 'success' : 'danger',
                            }),
                          })}
                        >
                          <I.Copy size={11}/> {t('copy')}
                        </button>
                        <span className="qt-refcode__hint">{t('wal_ref_code_hint')}</span>
                      </div>
                    )}

                    <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                      {t('wal_required')}: {ex.required.join(' · ')}
                      <br/>{t('wal_latency')} ~{ex.minLatency}ms · <a href={ex.apiDocs} target="_blank" style={{color:'var(--color-brand)'}}>{t('wal_api_docs')}</a>
                    </div>

                    <div className="exchange-card__actions">
                      {/*
                         가입 버튼.

                         링크는 서버 설정에서 온다(거래소 ID 기준). 없으면 이 버튼을
                         렌더하지 않는다 — 예시 코드가 박힌 링크로 보내면 사용자는
                         가입하지만 귀속이 안 돼 수익이 0 이 된다.

                         rel="noopener noreferrer": target=_blank 만 두면 열린 쪽이
                         window.opener 로 우리 탭을 조작할 수 있다.
                      */}
                      {/* ★ 미협약이면 가입 링크도 내보내지 않는다. 우리가 귀속받지
                          못하는 거래소로 사용자를 보내면 그 사람은 우리 수익이
                          되지 않고, 우리가 지원하지 않는 곳에서 거래하게 된다. */}
                      {!notReady && (window.QTApi && window.QTApi.getReferralUrl ? window.QTApi.getReferralUrl(ex.id) : '') && (
                        <a
                          href={window.QTApi.getReferralUrl(ex.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn--sm"
                          style={{flex: isConnected ? 1 : 1.4}}
                        >
                          <I.User size={11}/> {t('wallet_ecb4cc')}
                        </a>
                      )}
                      {isConnected ? (
                        <button className="btn btn--sm btn--primary" style={{flex:1}} onClick={() => setConnectingEx(ex)}>
                          <I.Check size={11}/> Connected
                        </button>
                      ) : (
                        <button
                          className="btn btn--sm btn--primary"
                          style={{flex:1}}
                          disabled={ex.status === 'coming-soon' || notReady}
                          title={notReady ? t('ex_not_partnered_hint') : undefined}
                          onClick={() => setConnectingEx(ex)}
                        >
                          <I.Plus size={11}/> {t('wal_connect_api')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'balances' && (
          /*
             ★ 연결 개수도 실제 값이다. 목업 길이(2)를 쓰면 하나도 연결하지 않은
               이용자에게 "2개 거래소에 걸쳐" 라고 말한다.
             ★ 확인 못 했으면 개수를 말하지 않는다.
          */
          <window.SectionCard
            title={t('wallet_f23807')}
            subtitle={creds === null
              ? t('wal_connected_unknown')
              : t('wal_connected_count', { count: connectedIds.length })}
            noPadding
          >
            <window.DataTable
              columns={[
                { key: 'asset', label: t('asset'), render: r => <strong>{r.assetKey ? t(r.assetKey) : r.asset}</strong> },
                { key: 'value', label: t('col_value'), align:'right', render: r => '$' + fmt(r.value) },
                { key: 'pct',   label: t('pf_allocation'), align:'right', render: r => r.pct.toFixed(1) + '%' },
                { key: 'chg',   label: '24h', align:'right', render: r => <span className={r.chg24h >= 0 ? 't-long' : 't-short'}>{r.chg24h >= 0 ? '+' : ''}{r.chg24h.toFixed(2)}%</span> },
                { key: 'ex',    label: t('col_held_on'), render: () => <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>Binance · Bitget</span> },
                { key: 'act',   label: '', align:'right', render: () => <><button className="tbl-action">{t('help_submit')}</button> <button className="tbl-action">{t('withdraw_5f9394')}</button></> },
              ]}
              rows={window.QTApp.ALLOCATION}
            />
          </window.SectionCard>
        )}

        {/*
           입출금 탭 본문 — 위 탭 정의와 함께 주석 처리했다. 되살릴 때 같이 푼다.

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
        */}

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
  /*
     보안 설정 탭 — 2단계 인증과 로그인 세션.

     ★★ 전에는 이 탭 전체가 하드코딩이었다.

       "✓ 활성화됨 · Google Authenticator" · "마지막 변경 · 63일 전" ·
       "현재 활성 세션 3개" · "iPhone Safari · Seoul, KR" · "+82 10-****-1234"
       를 그대로 적어 놓았다. 2단계 인증을 켜지 않은 사람이 켜졌다고 읽고,
       그 믿음으로 비밀번호를 재사용한다. 남의 기기가 로그인해 있어도 목록에
       나오지 않는다 — 보안 화면이 거짓을 말하면 없는 것보다 나쁘다.

     ★ 지금은 서버 실측값만 보여준다.
       - 2단계 인증: GET /api/account/mfa/status
       - 세션 목록: GET /api/auth/sessions (종료는 revoke / revoke-others)

     ★ 없는 것은 만들지 않는다.
       - 비밀번호 마지막 변경 시각: 서버가 주지 않는다 → 문구를 지우고
         '변경' 버튼만 남긴다(그 버튼은 실제로 동작한다).
       - SMS 인증: 서버에 그 기능이 없다 → 준비 중임을 밝힌다. 스위치를
         켜지는 것처럼 두면 SMS 가 온다고 믿는다.
       - 위치(도시): 서버는 IP 만 준다. IP 를 도시로 바꾸는 조회를 하지 않으므로
         만들지 않는다. 대신 IP 와 접속 시각을 보여준다 — 본인 확인에는 그게 충분하다.
  */
  function SecurityTab({ t }) {
    const [mfa, setMfa] = React.useState({ state: 'loading', data: null, error: null });
    const [sess, setSess] = React.useState({ state: 'loading', list: [], error: null });
    const [busy, setBusy] = React.useState(null);
    /*
       2단계 인증 켜기/끄기 흐름.

       flow    null | 'enable' | 'disable'
       enroll  { secret, otpauthUri } → 코드 확인 후 { recoveryCodes }
       pw/code 입력값. 화면을 벗어나면 지운다(아래 setFlow(null) 지점들).
    */
    const [flow, setFlow] = React.useState(null);
    const [enroll, setEnroll] = React.useState(null);
    const [pw, setPw] = React.useState('');
    const [code, setCode] = React.useState('');
    const [flowErr, setFlowErr] = React.useState(null);

    /*
       ★ 이 기능들은 `QTApi.auth` 에 있다(`rest` 가 아니다).

         처음에 `rest` 를 봤더니 함수가 없어서 화면이 "이 배포에서는 보안
         상태를 제공하지 않습니다" 로 떨어졌다 — 서버에는 있는데 화면만 못
         찾는 상태였고, 그 문구는 사실과 달랐다. 객체를 확인해 바로잡았다.
    */
    const api = (window.QTApi && window.QTApi.auth) || null;

    const loadMfa = React.useCallback(() => {
      if (!api || !api.mfaStatus) { setMfa({ state: 'unsupported', data: null, error: null }); return; }
      setMfa((p) => ({ ...p, state: p.data ? 'ready' : 'loading' }));
      /*
         ★ 이 클라이언트의 계약: 성공하면 **JSON 본문 그대로**, 실패하면 throw.
           `{ ok, data }` 봉투가 아니다. 처음 그렇게 가정해서 정상 응답을
           오류로 읽었고, 화면이 "불러오지 못했습니다" 를 띄웠다.
      */
      api.mfaStatus().then((d) => {
        if (d && typeof d.enabled === 'boolean') setMfa({ state: 'ready', data: d, error: null });
        else setMfa({ state: 'error', data: null, error: 'unexpected_shape' });
      }).catch((e) => setMfa({ state: 'error', data: null, error: e }));
    }, [api]);

    const loadSessions = React.useCallback(() => {
      if (!api || !api.sessions) { setSess({ state: 'unsupported', list: [], error: null }); return; }
      api.sessions().then((d) => {
        const list = d && Array.isArray(d.sessions) ? d.sessions : null;
        if (list) setSess({ state: 'ready', list: list, error: null });
        else setSess({ state: 'error', list: [], error: 'unexpected_shape' });
      }).catch((e) => setSess({ state: 'error', list: [], error: e }));
    }, [api]);

    React.useEffect(() => { loadMfa(); loadSessions(); }, [loadMfa, loadSessions]);

    /*
       서버 오류를 사용자가 읽을 수 있는 문장으로.

       코드를 그대로 보여주면(REAUTH_FAILED) 무엇을 고쳐야 하는지 모른다.
       모르는 코드는 원문을 남긴다 — 문의할 때 근거가 된다.
    */
    function errText(e) {
      // throw 된 Error 에는 `.code`(서버 오류 코드)와 `.status` 가 붙어 있다.
      const codeStr = (e && (e.code || (e.payload && e.payload.error && e.payload.error.code))) || '';
      const map = {
        REAUTH_FAILED: 'sec_err_password',
        INVALID_CODE: 'sec_err_code',
        ALREADY_ENABLED: 'sec_err_already_on',
        NOT_ENABLED: 'sec_err_not_on',
        NO_PENDING: 'sec_err_restart',
        SETUP_EXPIRED: 'sec_err_expired',
        CSRF_FAILED: 'sec_err_reload',
        UNAUTHENTICATED: 'sec_err_signin',
      };
      if (map[codeStr]) return t(map[codeStr]);
      return t('sec_err_generic', { code: codeStr || '?' });
    }

    function beginEnroll() {
      if (!api || !api.startMfaSetup) return;
      setBusy('enable'); setFlowErr(null);
      api.startMfaSetup(pw).then((d) => {
        if (d && d.secret) {
          setEnroll({ secret: d.secret, otpauthUri: d.otpauthUri || null });
          setPw(''); // 비밀번호는 더 필요 없다 — 화면에 남겨두지 않는다.
        } else {
          setFlowErr(t('sec_err_generic', { code: '?' }));
        }
      }).catch((e) => setFlowErr(errText(e)))
        .finally(() => setBusy(null));
    }

    function confirmEnroll() {
      if (!api || !api.confirmMfaSetup) return;
      setBusy('confirm'); setFlowErr(null);
      api.confirmMfaSetup(code).then((d) => {
        if (d && d.enabled) {
          setEnroll((prev) => ({ ...(prev || {}), recoveryCodes: Array.isArray(d.recoveryCodes) ? d.recoveryCodes : [] }));
          setCode('');
          loadMfa();
        } else {
          setFlowErr(t('sec_err_generic', { code: '?' }));
        }
      }).catch((e) => setFlowErr(errText(e)))
        .finally(() => setBusy(null));
    }

    function doDisable() {
      if (!api || !api.disableMfa) return;
      setBusy('disable'); setFlowErr(null);
      api.disableMfa(pw, code).then(() => {
        setFlow(null); setPw(''); setCode(''); loadMfa();
      }).catch((e) => setFlowErr(errText(e)))
        .finally(() => setBusy(null));
    }

    function fmtWhen(ms) {
      if (!Number.isFinite(ms)) return '—';
      const d = new Date(ms);
      const diff = Date.now() - ms;
      const mins = Math.floor(diff / 60000);
      // 최근 접속은 상대 시각이 읽기 쉽고, 오래된 것은 날짜가 정확하다.
      if (mins < 1) return t('sec_just_now');
      if (mins < 60) return t('sec_mins_ago', { n: mins });
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return t('sec_hours_ago', { n: hrs });
      return d.toLocaleString();
    }

    /** User-Agent 를 사람이 읽을 만한 짧은 이름으로. 추측을 덧붙이지 않는다. */
    function uaLabel(ua) {
      if (!ua) return t('sec_unknown_device');
      const s = String(ua);
      const browser = /Edg\//.test(s) ? 'Edge'
        : /OPR\//.test(s) ? 'Opera'
        : /Chrome\//.test(s) ? 'Chrome'
        : /Firefox\//.test(s) ? 'Firefox'
        : /Safari\//.test(s) ? 'Safari'
        : /curl\//.test(s) ? 'curl'
        : null;
      const os = /iPhone|iPad/.test(s) ? 'iOS'
        : /Android/.test(s) ? 'Android'
        : /Mac OS X/.test(s) ? 'macOS'
        : /Windows/.test(s) ? 'Windows'
        : /Linux/.test(s) ? 'Linux'
        : null;
      if (browser && os) return browser + ' · ' + os;
      if (browser) return browser;
      // 모르면 원문을 짧게 보여준다 — 'Unknown' 보다 본인이 알아보기 쉽다.
      return s.slice(0, 40);
    }

    function revoke(id) {
      if (!api || !api.revokeSession) return;
      setBusy(id);
      api.revokeSession(id)
        .then(() => loadSessions())
        .catch(() => { if (window.QTToast) window.QTToast({ title: t('sec_sessions'), desc: t('sec_revoke_failed'), variant: 'warning' }); })
        .finally(() => setBusy(null));
    }

    function revokeOthers() {
      if (!api || !api.revokeOtherSessions) return;
      setBusy('others');
      api.revokeOtherSessions()
        .then(() => loadSessions())
        .catch(() => { if (window.QTToast) window.QTToast({ title: t('sec_sessions'), desc: t('sec_revoke_failed'), variant: 'warning' }); })
        .finally(() => setBusy(null));
    }

    const dim = { fontSize: 11, color: 'var(--color-text-tertiary)' };
    const rowStyle = {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', gap: 12,
    };

    const others = sess.list.filter((s) => !s.current).length;

    return (
      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        <window.SectionCard title={t('settings_965a8c')}>
          {/* 비밀번호 — 마지막 변경 시각은 서버가 주지 않으므로 적지 않는다. */}
          <div style={rowStyle}>
            <div>
              <div style={{fontWeight:500}}>{t('settings_819738')}</div>
              <div style={dim}>{t('sec_password_hint')}</div>
            </div>
            <a className="btn btn--sm" href="#/password-reset">{t('settings_ce0109')}</a>
          </div>

          {/* 2단계 인증 — 실제 상태만. */}
          <div style={{...rowStyle, borderBottom: 'none'}}>
            <div>
              <div style={{fontWeight:500}}>{t('settings_a5d18c')}</div>
              {mfa.state === 'loading' && <div style={dim}>{t('sec_loading')}</div>}
              {mfa.state === 'unsupported' && <div style={dim}>{t('sec_unsupported')}</div>}
              {mfa.state === 'error' && (
                <div style={{fontSize:11, color:'var(--color-warning)'}}>{t('sec_load_failed')}</div>
              )}
              {mfa.state === 'ready' && mfa.data && (
                mfa.data.enabled ? (
                  <div style={{fontSize:11, color:'var(--color-success)'}}>
                    {t('sec_mfa_on')}
                    {Number.isFinite(mfa.data.recoveryRemaining) && (
                      <> · {t('sec_recovery_left', { n: mfa.data.recoveryRemaining })}</>
                    )}
                  </div>
                ) : (
                  /* ★ 꺼져 있으면 켜라고 권한다. 조용히 두면 켜진 줄 안다. */
                  <div style={{fontSize:11, color:'var(--color-warning)'}}>
                    {mfa.data.pendingSetup ? t('sec_mfa_pending') : t('sec_mfa_off')}
                  </div>
                )
              )}
            </div>
            {/*
               ★ 흐름이 열려 있는 동안에는 이 버튼을 감춘다.

                 감추지 않으면 키를 받아 코드를 넣는 중에 이 버튼이 그대로
                 보이고, 누르면 setEnroll(null) 로 1단계로 되돌아간다. 방금 받은
                 키는 서버가 다시 주지 않으므로 사용자는 앱에 등록한 항목을
                 지우고 처음부터 해야 한다(실측으로 겪었다).
            */}
            {flow ? null : mfa.state === 'error'
              ? <button className="btn btn--sm" type="button" onClick={loadMfa}>{t('sec_retry')}</button>
              : mfa.state === 'ready' && mfa.data && (
                mfa.data.enabled
                  ? <button className="btn btn--sm" type="button" onClick={() => { setFlow('disable'); setPw(''); setCode(''); setFlowErr(null); }}>{t('sec_mfa_turn_off')}</button>
                  : <button className="btn btn--sm btn--primary" type="button" onClick={() => { setFlow('enable'); setPw(''); setCode(''); setEnroll(null); setFlowErr(null); }}>{t('sec_mfa_enable')}</button>
              )}
          </div>

          {/*
             2단계 인증 켜기 / 끄기.

             ★ 별도 화면으로 보내지 않는다. 상태를 보고 있는 자리에서 바로
               처리하는 편이 중간에 그만두는 사람을 줄인다. 지금 이 기능이
               켜져 있지 않은 계정이 대부분이므로 그 차이가 크다.

             ★ QR 이미지를 만들지 않는다. 이미지 생성 라이브러리를 새로 들이지
               않고, 인증 앱이 모두 지원하는 **수동 입력 키**와 otpauth 주소를
               보여준다. 키는 서버가 한 번만 주므로 다시 열 수 없다는 것도 알린다.
          */}
          {flow === 'enable' && (
            <div style={{borderTop:'1px solid var(--color-border-subtle)', paddingTop:12, display:'flex', flexDirection:'column', gap:8}}>
              {!enroll ? (
                <>
                  <div style={dim}>{t('sec_enable_step1')}</div>
                  <input
                    className="input" type="password" autoComplete="current-password"
                    placeholder={t('settings_819738')}
                    value={pw} onChange={(e) => setPw(e.target.value)}
                  />
                  {flowErr && <div style={{fontSize:11, color:'var(--color-danger, #ef4444)'}}>{flowErr}</div>}
                  <div style={{display:'flex', gap:8}}>
                    <button className="btn btn--sm btn--primary" type="button" disabled={busy === 'enable' || !pw} onClick={beginEnroll}>
                      {busy === 'enable' ? t('sec_loading') : t('sec_continue')}
                    </button>
                    <button className="btn btn--sm" type="button" onClick={() => setFlow(null)}>{t('settings_19b2d1')}</button>
                  </div>
                </>
              ) : enroll.recoveryCodes ? (
                <>
                  {/* 활성화 완료 — 복구 코드는 지금만 보여줄 수 있다. */}
                  <div style={{fontSize:12, color:'var(--color-success)', fontWeight:500}}>{t('sec_mfa_now_on')}</div>
                  <div style={{fontSize:11, color:'var(--color-warning)'}}>{t('sec_recovery_save')}</div>
                  <div
                    style={{
                      fontFamily:'var(--font-mono)', fontSize:12, lineHeight:1.7,
                      padding:'8px 10px', border:'1px solid var(--color-border-subtle)',
                      borderRadius:4, background:'var(--color-bg-surface)',
                      display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(120px, 1fr))', gap:4,
                      userSelect:'all',
                    }}
                  >
                    {enroll.recoveryCodes.map((c) => <span key={c}>{c}</span>)}
                  </div>
                  <div style={{display:'flex', gap:8}}>
                    <button
                      className="btn btn--sm" type="button"
                      onClick={() => {
                        const text = enroll.recoveryCodes.join('\n');
                        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
                      }}
                    >{t('sec_copy')}</button>
                    <button className="btn btn--sm btn--primary" type="button" onClick={() => { setFlow(null); setEnroll(null); loadMfa(); }}>
                      {t('sec_done')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={dim}>{t('sec_enable_step2')}</div>
                  <div
                    style={{
                      fontFamily:'var(--font-mono)', fontSize:13, letterSpacing:'0.06em',
                      padding:'8px 10px', border:'1px solid var(--color-border-subtle)',
                      borderRadius:4, background:'var(--color-bg-surface)', userSelect:'all', wordBreak:'break-all',
                    }}
                  >{enroll.secret}</div>
                  <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                    <button
                      className="btn btn--xs" type="button"
                      onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(enroll.secret).catch(() => {}); }}
                    >{t('sec_copy_key')}</button>
                    {enroll.otpauthUri && (
                      <a className="btn btn--xs" href={enroll.otpauthUri}>{t('sec_open_app')}</a>
                    )}
                  </div>
                  <input
                    className="input" type="text" inputMode="numeric" autoComplete="one-time-code"
                    placeholder={t('sec_code_placeholder')}
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  {flowErr && <div style={{fontSize:11, color:'var(--color-danger, #ef4444)'}}>{flowErr}</div>}
                  <div style={{display:'flex', gap:8}}>
                    <button className="btn btn--sm btn--primary" type="button" disabled={busy === 'confirm' || code.length !== 6} onClick={confirmEnroll}>
                      {busy === 'confirm' ? t('sec_loading') : t('sec_mfa_enable')}
                    </button>
                    <button className="btn btn--sm" type="button" onClick={() => { setFlow(null); setEnroll(null); }}>{t('settings_19b2d1')}</button>
                  </div>
                </>
              )}
            </div>
          )}

          {flow === 'disable' && (
            <div style={{borderTop:'1px solid var(--color-border-subtle)', paddingTop:12, display:'flex', flexDirection:'column', gap:8}}>
              {/* ★ 끄는 것이 위험하다는 사실을 말한다. 조용히 끄게 하지 않는다. */}
              <div style={{fontSize:11, color:'var(--color-warning)'}}>{t('sec_disable_warn')}</div>
              <input
                className="input" type="password" autoComplete="current-password"
                placeholder={t('settings_819738')}
                value={pw} onChange={(e) => setPw(e.target.value)}
              />
              <input
                className="input" type="text" inputMode="numeric" autoComplete="one-time-code"
                placeholder={t('sec_code_placeholder')}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              {flowErr && <div style={{fontSize:11, color:'var(--color-danger, #ef4444)'}}>{flowErr}</div>}
              <div style={{display:'flex', gap:8}}>
                <button className="btn btn--sm btn--danger" type="button" disabled={busy === 'disable' || !pw || code.length !== 6} onClick={doDisable}>
                  {busy === 'disable' ? t('sec_loading') : t('sec_mfa_turn_off')}
                </button>
                <button className="btn btn--sm" type="button" onClick={() => setFlow(null)}>{t('settings_19b2d1')}</button>
              </div>
            </div>
          )}

          {/*
             SMS 인증 — 서버에 없는 기능이다.
             스위치를 그대로 두면 켰다고 믿고 SMS 를 기다린다.
          */}
          <div style={{...rowStyle, borderBottom:'none', borderTop:'1px solid var(--color-border-subtle)'}}>
            <div>
              <div style={{fontWeight:500}}>
                {t('settings_872543')}
                <span className="qt-pending-mark">{t('sec_pending')}</span>
              </div>
              <div style={dim}>{t('sec_sms_absent')}</div>
            </div>
            <label className="switch" title={t('sec_sms_absent')}>
              <input type="checkbox" checked={false} disabled readOnly/>
              <span className="switch__track"><span className="switch__thumb"/></span>
            </label>
          </div>
        </window.SectionCard>

        <window.SectionCard
          title={t('settings_4bd28a')}
          subtitle={
            sess.state === 'ready'
              ? t('sec_sessions_count', { n: sess.list.length })
              : (sess.state === 'loading' ? t('sec_loading') : t('sec_load_failed'))
          }
          actions={
            sess.state === 'ready' && others > 0 ? (
              <button className="btn btn--sm btn--danger" type="button" disabled={busy === 'others'} onClick={revokeOthers}>
                {t('sec_revoke_others', { n: others })}
              </button>
            ) : null
          }
        >
          {sess.state === 'loading' && <div style={dim}>{t('sec_loading')}</div>}
          {sess.state === 'unsupported' && <div style={dim}>{t('sec_unsupported')}</div>}
          {sess.state === 'error' && (
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              {/* ★ 조회 실패를 빈 목록으로 위장하지 않는다. */}
              <span style={{fontSize:12, color:'var(--color-warning)'}}>{t('sec_sessions_failed')}</span>
              <button className="btn btn--xs" type="button" onClick={loadSessions}>{t('sec_retry')}</button>
            </div>
          )}
          {sess.state === 'ready' && (
            <div style={{display:'flex', flexDirection:'column', gap: 6}}>
              {sess.list.length === 0 && <div style={dim}>{t('sec_no_sessions')}</div>}
              {sess.list.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display:'flex', justifyContent:'space-between', alignItems:'center', gap: 10,
                    padding:'8px 10px', border:'1px solid var(--color-border-subtle)',
                    borderRadius: 4, background:'var(--color-bg-surface)',
                  }}
                >
                  <div style={{minWidth: 0}}>
                    <div style={{fontSize:12, fontWeight:500}}>
                      {uaLabel(s.userAgent)}
                      {s.current && <span style={{marginLeft:6, fontSize:10, color:'var(--color-success)'}}>{t('settings_b7a78a')}</span>}
                    </div>
                    <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                      {fmtWhen(s.createdAt)}{s.ip ? ' · ' + s.ip : ''}
                    </div>
                  </div>
                  {/* ★ 지금 이 기기는 종료 버튼을 주지 않는다 — 누르면 자기가 튕겨나간다. */}
                  {!s.current && (
                    <button className="btn btn--xs btn--danger" type="button" disabled={busy === s.id} onClick={() => revoke(s.id)}>
                      {t('settings_cafdc6')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </window.SectionCard>
      </div>
    );
  }

  window.SettingsPage = function SettingsPage({ shellProps }) {
    /*
       화면 설정. 값과 변경 함수를 shellProps 로 받는다.
       기능은 useTweaks 가 이미 구현해 두었다 — 버튼만 연결되지 않았다.
    */
    const tw = shellProps.tweaks || {};
    const setTw = shellProps.setTweaks || (() => {});

    const [tab, setTab] = useState('profile');

    /*
       프로필 — 실 세션.

       목업 USER 는 '권누리 / usr_kuri001 / kuri@quantumtrade.ai / KYC Level 2 /
       Pro 등급' 이었다. 로그인한 사람과 무관한 값이라, 자기 설정 화면에서
       남의 이름과 이메일을 본다. 특히 'KYC Level 2' 는 우리가 인증하지 않으므로
       거짓이고, 'Pro' 등급은 제도 자체가 없다.

       서버 세션은 이메일·역할·상태·이메일인증여부·MFA 여부만 준다.
       그 이상은 우리가 갖고 있지 않으므로 만들지 않는다.
    */
    const auth = window.QTAuth && window.QTAuth.useAuth ? window.QTAuth.useAuth() : null;
    const live = auth && auth.user;

    /*
       실제로 등록된 거래소 키.

       ★★ 전에는 'API Keys' 탭이 `USER.apiKeys`(목업 배열)를 읽었다. 실계정으로
         바꾼 뒤 그 필드가 없어져 `undefined.map` 으로 **설정 화면 전체가 죽었다.**
         탭을 누르면 화면이 통째로 하얗게 됐다.

       ★ 서버에 목록 조회 경로도 없었다(저장·검증·삭제만 있었다). 함께 만들었다.
    */
    const [exKeys, setExKeys] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.exchangeKeys) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      const load = () => {
        const a = window.QTAuth;
        if (!a || !a.isLoggedIn || !a.isLoggedIn()) return;
        api.exchangeKeys()
          .then((r) => { if (!cancelled) setExKeys(r.items); })
          .catch(() => { /* 조회 실패를 빈 목록으로 위장하지 않는다 (null 유지) */ });
      };
      load();
      const off = (window.QTAuth && window.QTAuth.subscribe) ? window.QTAuth.subscribe(load) : null;
      return () => { cancelled = true; if (off) off(); };
    }, []);

    const MOCK_USER = window.QTApp.USER;
    const USER = live
      ? {
          id: live.id,
          // 이름을 받지 않는다. 이메일 앞부분을 이름처럼 쓰면 실제 이름으로 오인된다.
          name: null,
          email: live.email,
          avatarInitial: String(live.email || '?').charAt(0).toUpperCase(),
          role: live.role,
          // 우리가 KYC 를 하지 않으므로 등급이 없다. 0 이 아니라 '없음' 이다.
          kycLevel: null,
          kycStatus: null,
          twofa: Boolean(live.mfaEnabled),
          emailVerified: Boolean(live.emailVerified),
          status: live.status,
          tier: null,
          /*
             등록된 거래소 키.

             ★ 조회 전(null)에는 빈 배열을 준다 — `undefined.map` 으로 화면이
               죽지 않게. 조회 결과가 비어 있으면 아래 표가 안내를 보여준다.
          */
          apiKeys: exKeys || [],
        }
      : MOCK_USER;
    const isLive = Boolean(live);

    return (
      <window.PageShell
        {...shellProps}
        title={t('nav_settings')}
        subtitle={t('settings_2d430b')}
        breadcrumb={['Home','Settings']}
      >
        <div style={{display:'grid', gridTemplateColumns:'220px 1fr', gap: 24, alignItems: 'start'}}>
          <div style={{display:'flex', flexDirection:'column', gap: 2}}>
            {[
              { id:'profile',   label:t('settings_14fab1'),      icon:'User' },
              { id:'security',  label:t('settings_cfaa68'),  icon:'Lock' },
              { id:'notif',     label:t('settings_e29d14'),        icon:'Bell' },
              { id:'api',       label:t('set_api_keys'),    icon:'Wallet' },
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
                    {/* 이름이 없으면 이메일을 크게 보여준다 — 빈 줄을 두면 계정이 잘못된 것처럼 보인다. */}
                    <div style={{fontSize:16, fontWeight:600}}>{USER.name || USER.email}</div>
                    <div style={{fontSize:12, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{USER.id}</div>
                    <div style={{marginTop:6, display:'flex', gap:6, flexWrap:'wrap'}}>
                      {isLive ? (
                        <>
                          {/*
                             실제로 아는 사실만 배지로 만든다.
                             'KYC Level 2' 는 우리가 인증하지 않으므로 쓸 수 없다.
                          */}
                          <span className={`badge badge--${USER.emailVerified ? 'success' : 'warning'}`}>
                            {USER.emailVerified ? <I.Check size={9}/> : <I.Alert size={9}/>} {t(USER.emailVerified ? 'set_email_verified' : 'set_email_unverified')}
                          </span>
                          <span className={`badge badge--${USER.twofa ? 'success' : 'neutral'}`}>
                            {t(USER.twofa ? 'set_mfa_on' : 'set_mfa_off')}
                          </span>
                          <span className="badge badge--neutral">{t('set_role', { role: String(USER.role || '').toUpperCase() })}</span>
                        </>
                      ) : (
                        <>
                          <span className="badge badge--success"><I.Check size={9}/> KYC Level {USER.kycLevel}</span>
                          <span className="badge badge--neutral">{USER.tier}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {/* 아바타 변경 기능이 없다 — 업로드 경로도 저장소도 없다. */}
                  {!isLive && <button className="btn btn--sm" style={{marginLeft:'auto'}}>{t('settings_b7909f')}</button>}
                </div>

                {isLive ? (
                  /*
                     편집 가능한 항목만 남긴다.

                     이름·국가·시간대를 저장할 API 가 없다. 입력칸을 두면
                     사용자가 고쳐서 저장을 누르고, 아무 일도 일어나지 않는다.
                     이메일은 인증에 쓰이므로 임의로 바꿀 수 없다 — 변경하려면
                     재인증이 필요하고 그 흐름이 없다.
                  */
                  <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:16}}>
                    <div className="input-group">
                      <span className="input-group__label">{t('settings_3c3776')}</span>
                      <input value={USER.email} readOnly disabled/>
                    </div>
                    <div style={{fontSize:11.5, lineHeight:1.7, color:'var(--color-text-tertiary)'}}>
                      <div>{t('set_email_locked')}</div>
                      <div style={{marginTop:4}}>{t('set_profile_minimal')}</div>
                    </div>
                    <div style={{display:'flex', gap:8, marginTop:4}}>
                      {/* 비밀번호 변경은 실제 API 가 있다. */}
                      <a className="btn btn--sm" href="#/password-reset" style={{textDecoration:'none'}}>
                        {t('set_change_password')}
                      </a>
                      <button
                        className="btn btn--sm"
                        onClick={() => { if (window.QTAuth) window.QTAuth.logout().then(() => { window.location.hash = '/login'; }); }}
                      >{t('set_sign_out')}</button>
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </window.SectionCard>
            )}

            {tab === 'security' && <SecurityTab t={t}/>}

            {tab === 'api' && (
              <window.SectionCard
                title={t('set_api_keys')}
                subtitle={t('settings_8eb853')}
                actions={<button className="btn btn--sm btn--primary"><I.Plus size={12}/> {t('wal_add_key')}</button>}
                noPadding
              >
                <div className="api-key-row" style={{background:'var(--color-bg-panel)', color:'var(--color-text-tertiary)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500}}>
                  <span/><span>{t('wal_col_label_exchange')}</span><span>{t('col_key')}</span><span>{t('col_perms')}</span><span>{t('wal_col_last_used')}</span><span/>
                </div>
                {/*
                   등록된 키가 없을 때.

                   ★ 빈 표를 그대로 두면 화면이 고장난 것처럼 보인다. 무엇을
                     해야 하는지 알려준다 — 이 화면의 목적은 키를 연결하게 만드는 것이다.
                */}
                {USER.apiKeys.length === 0 && (
                  <div style={{padding:'18px 16px', fontSize:12.5, lineHeight:1.8, color:'var(--color-text-secondary)'}}>
                    {isLive ? t('settings_no_keys') : t('settings_keys_preview')}
                  </div>
                )}
                {USER.apiKeys.map(k => {
                  /*
                     거래소 정보.

                     ★ 목록에 없는 거래소일 수 있다(설정이 바뀌었거나 새 거래소).
                       `ex.logoBg` 를 그냥 읽으면 undefined 접근으로 화면이 죽는다.
                       기본값을 둔다.
                  */
                  const ex = window.QTApp.EXCHANGES.find(e => e.id === k.exchange) || {
                    name: String(k.exchange || '').toUpperCase() || '—',
                    logoBg: 'var(--color-bg-elevated)',
                    logoColor: 'var(--color-text-secondary)',
                    logoText: String(k.exchange || '?').slice(0, 2).toUpperCase(),
                  };
                  /* 실계정 키는 마스킹된 접근키를 서버가 준다. 목업은 id 뒷자리를 썼다. */
                  const masked = k.accessKeyMasked || ('••••••' + String(k.id || '').slice(-4));
                  return (
                    <div key={k.id} className="api-key-row">
                      <div className="exchange-card__logo" style={{width:26, height:26, borderRadius:5, fontSize:10, background:ex.logoBg, color:ex.logoColor}}>{(window.exchangeLogo && window.exchangeLogo(ex.id, { size: 16 })) || ex.logoText}</div>
                      <div>
                        <div style={{fontWeight:500}}>{k.label || ex.name}</div>
                        <div style={{fontSize:10, color:'var(--color-text-tertiary)'}}>{ex.name}</div>
                      </div>
                      <div className="api-key-row__mask">{masked}</div>
                      <div className="api-key-row__perms">
                        {/*
                           권한.

                           ★ 거래소가 어떤 권한을 줬는지 우리는 알 수 없다.
                             아는 것은 "잔고 조회가 성공했는가" 뿐이므로 그것만 말한다.
                             권한 이름을 지어내면 사용자가 그것을 믿고 주문을 시도한다.
                        */}
                        {Array.isArray(k.permissions) && k.permissions.length > 0
                          ? k.permissions.map(p => <span key={p} className="api-key-row__perm-chip">{p}</span>)
                          : (
                            <span className="api-key-row__perm-chip" title={t('settings_perm_unknown_why')}>
                              {k.permissionsVerified ? t('settings_perm_read_ok') : t('settings_perm_unknown')}
                            </span>
                          )}
                      </div>
                      <div style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>
                        {/* 마지막 사용 시각을 기록하지 않는다. 모르는 것을 '방금' 으로 쓰지 않는다. */}
                        {k.lastUsed ? timeAgo(new Date(k.lastUsed).getTime()) : '—'}
                      </div>
                      <div style={{display:'inline-flex', gap:4}}>
                        <button className="tbl-action">{t('col_edit')}</button>
                        <button className="tbl-action tbl-action--danger">{t('col_revoke')}</button>
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
                    <label className="chk"><input type="checkbox" defaultChecked/><span className="chk__box"><I.Check size={10}/></span>{t('set_ch_inapp')}</label>
                    <label className="chk"><input type="checkbox" defaultChecked={r.k !== 'promo'}/><span className="chk__box"><I.Check size={10}/></span>{t('fld_email')}</label>
                    <label className="chk"><input type="checkbox" defaultChecked={r.k === 'risk'}/><span className="chk__box"><I.Check size={10}/></span>SMS</label>
                    <label className="chk"><input type="checkbox" defaultChecked={r.k === 'signal' || r.k === 'risk'}/><span className="chk__box"><I.Check size={10}/></span>{t('col_push')}</label>
                  </div>
                ))}
              </window.SectionCard>
            )}

            {tab === 'prefs' && (
              <window.SectionCard title={t('settings_643822')}>
                <div style={{display:'flex', flexDirection:'column', gap: 20}}>
                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>{t('dops_theme')}</div>
                    <div className="seg" style={{width:'100%'}}>
                      <button className={`seg__opt ${tw.theme === 'dark' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTw({ theme: 'dark' })}><I.Moon size={11}/> {t('theme_dark')}</button>
                      <button className={`seg__opt ${tw.theme === 'light' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTw({ theme: 'light' })}><I.Sun size={11}/> {t('theme_light')}</button>
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>{t('dops_density')}</div>
                    <div className="seg" style={{width:'100%'}}>
                      {['comfortable','compact','dense'].map(d => (
                        <button
                          key={d}
                          className={`seg__opt ${tw.density === d ? 'is-active' : ''}`}
                          style={{flex:1}}
                          onClick={() => setTw({ density: d })}
                        >
                          {d === 'comfortable' ? 'Comfortable' : d === 'compact' ? 'Compact' : 'Dense'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>{t('tw_7_language_word')}</div>
                    <div className="seg" style={{width:'100%'}}>
                      {/*
                        ★★ 언어 목록을 여기에 적지 않는다 — 등록된 사전에서 만든다.

                          전에는 `[['ko','한국어'],['en','English'],['ja','日本語']]` 로
                          적어 두었다. 그래서 중국어 사전을 등록한 뒤에도 **이 화면에는
                          중국어가 아예 나타나지 않았다.** 언어를 늘릴 때마다 이 줄을
                          고쳐야 하는 구조는, 고치는 것을 잊는 순간 조용히 틀린다.
                          (헤더의 언어 순환 버튼은 이미 available() 을 쓰고 있어서
                           두 곳이 서로 다른 목록을 보여주고 있었다)

                          label 은 사전이 자기 언어로 들고 있다(register 의 meta.label).
                          그래야 그 언어를 읽는 사람이 자기 언어를 알아본다.
                      */}
                      {(window.QTI18n && window.QTI18n.available
                        ? window.QTI18n.available()
                        : [{ code: 'en', label: 'English' }]
                      ).map(({ code, label }) => (
                        <button
                          key={code}
                          className={`seg__opt ${tw.lang === code ? 'is-active' : ''}`}
                          style={{flex:1}}
                          onClick={() => setTw({ lang: code })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>{t('tw_numfmt')}</div>
                    <div className="seg" style={{width:'100%'}}>
                      <button className={`seg__opt ${tw.numFmt === 'standard' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTw({ numFmt: 'standard' })}>{t('numfmt_standard')}</button>
                      <button className={`seg__opt ${tw.numFmt === 'compact' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTw({ numFmt: 'compact' })}>{t('numfmt_compact')}</button>
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>{t('set_default_view')}</div>
                    {/*
                       ★★ 목록을 코드에 박지 않고 프리셋 레지스트리에서 만든다.

                         전에는 5개가 손으로 적혀 있었고 `defaultValue` 로 고정돼
                         **선택해도 아무 일도 일어나지 않았다.** 설정 화면에 있는
                         조작기가 반응하지 않으면 이용자는 저장됐다고 믿는다.
                         (실제 프리셋은 7개 이상이라 목록도 사실과 달랐다)

                       ★ 이제 tweaks.presetId 를 직접 읽고 쓴다. Tweaks 패널과
                         같은 값을 보므로 두 화면이 어긋나지 않는다.
                    */}
                    <select
                      className="input"
                      style={{width: '100%'}}
                      value={tw.presetId}
                      onChange={(e) => setTw({ presetId: e.target.value })}
                    >
                      {Object.values((window.QT && window.QT.LAYOUT_PRESETS) || {}).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 8}}>{t('set_default_tf')}</div>
                    {/*
                       ★ 기본 시간봉은 아직 저장되는 설정이 아니다.

                         전에는 '15m' 이 활성으로 그려져 있고 누르면 아무 일도
                         일어나지 않았다. **이미 저장된 설정처럼 보이는 것**이
                         문제다 — 이용자는 자기 기본값이 15분이라고 믿는다.
                         저장 경로가 생기면 여기에 연결한다.
                    */}
                    <div className="seg" style={{width:'100%'}}>
                      {['1m','5m','15m','30m','1H','4H','1D'].map(tf => (
                        <button key={tf} className="seg__opt" style={{flex:1}} disabled title={t('set_default_tf_pending')}>{tf}</button>
                      ))}
                    </div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:4}}>{t('set_default_tf_pending')}</div>
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
                      {/*
                         ★★ 데이터 내보내기 — 개인정보처리방침 7절이 약속한
                           이전권이다. 전에는 onClick 이 없는 껍데기였다. 권리를
                           적어 놓고 행사할 수단을 주지 않으면 약속을 지키지 않는
                           것이다.

                         ★ 받은 JSON 을 파일로 저장한다. 화면에 그대로 뿌리면
                           개인정보가 브라우저 기록에 남고, 이용자가 그것을
                           보관하기도 어렵다.

                         ★ 응답의 `excluded` 를 함께 알린다 — 무엇이 빠졌는지
                           모르면 따로 요청할 수 없다.
                      */}
                      <button
                        className="btn btn--sm"
                        type="button"
                        onClick={async () => {
                          const api = window.QTApi && window.QTApi.auth;
                          if (!api || !api.exportMyData) return;
                          try {
                            const d = await api.exportMyData();
                            const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                            const missing = (d && d.excluded) || [];
                            if (window.QTToast) {
                              window.QTToast({
                                title: t('settings_2508a1'),
                                desc: t('data_export_done', { n: missing.length }),
                                variant: 'info',
                              });
                            }
                          } catch (e) {
                            if (window.QTToast) {
                              window.QTToast({
                                title: t('settings_2508a1'),
                                desc: (e && e.message) || t('data_export_failed'),
                                variant: 'warning',
                              });
                            }
                          }
                        }}
                      >
                        <I.Camera size={12}/> {t('settings_74e36c')}
                      </button>
                    </div>

                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '10px 0'}}>
                      <div>
                        <div style={{fontWeight:500}}>{t('settings_0207e4')}</div>
                        <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('settings_c523ec')}</div>
                      </div>
                      <button className="btn btn--sm"><I.Camera size={12}/> {t('col_export')}</button>
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
    const acct = window.useAccountData ? window.useAccountData() : { status: 'OFFLINE', isLive: false };
    const [filter, setFilter] = useState('all');

    /*
       서버 알림.

       ★★ 전에는 이 경로를 읽지 않았다. 서버가 알림을 만들어 저장하는데
         화면이 부르지 않아 사용자는 볼 수 없었다 — 문의에 답변을 달아도
         문의한 사람이 모르는 상태였다.

       ★ 지금 서버가 만드는 알림: 주문 체결 · 문의 답변 · 포인트 변동.
         청산 경고는 클라이언트가 계산한다(아래 liveAlerts) — 서버가 포지션별
         실시간 시세를 감시하지 않기 때문이다. 두 출처를 합쳐 보여준다.
    */
    const [serverAlerts, setServerAlerts] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.notifications) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      const load = () => {
        // 로그인 전에는 부르지 않는다 — 401 이 콘솔에 쌓인다.
        const auth = window.QTAuth;
        if (!auth || !auth.isLoggedIn || !auth.isLoggedIn()) return;
        api.notifications({ limit: 60 }).then((r) => {
          if (cancelled) return;
          setServerAlerts(r.items.map((n) => ({
            id: 'srv-' + n.id,
            kind: n.type === 'risk_alert' ? 'risk' : n.type === 'order_filled' ? 'order' : 'system',
            // 서버 메시지를 그대로 쓴다. 화면이 다시 쓰면 두 문구가 갈린다.
            title: n.message,
            body: '',
            time: n.createdAt,
            unread: !n.read,
            isLive: true,
            severity: n.severity,
          })));
        }).catch(() => { /* 조회 실패를 빈 목록으로 위장하지 않는다 */ });
      };
      load();
      const off = (window.QTAuth && window.QTAuth.subscribe) ? window.QTAuth.subscribe(load) : null;
      return () => { cancelled = true; if (off) off(); };
    }, []);

    /*
       청산 위험 경고 (클라이언트 계산).

       서버가 포지션별 실시간 시세를 감시하지 않으므로 화면에서 계산한다.
       실 경고를 목업 목록 **앞에** 놓는다 — 실제 위험이 예시 알림에 묻히면
       사용자가 놓친다.
    */
    const liveAlerts = React.useMemo(() => {
      if (!acct.isLive || !window.QTRisk) return [];
      return window.QTRisk.getAlerts().map((a) => ({
        id: 'risk-' + a.key,
        kind: 'risk',
        // 목업과 같은 필드를 쓴다. 화면 코드를 고치지 않기 위해서다.
        title: t('risk_liq_' + a.level, { symbol: a.symbol }),
        body: t('risk_liq_desc', {
          distance: a.distancePct.toFixed(1),
          liq: window.QTFmt ? window.QTFmt.fmtPrice(a.liq, a.symbol) : a.liq,
        }),
        time: Date.now(),
        unread: true,
        isLive: true,
      }));
    }, [acct.version, acct.isLive]);

    /*
       서버 공지를 알림으로 합친다.

       관리자가 게시한 공지는 사용자가 반드시 봐야 하는 정보(점검·정책 변경)다.
       공지 화면이 따로 없으므로 알림 목록에 넣는다 — 게시했는데 아무도 볼 수
       없으면 게시 기능이 무의미하다.
    */
    const [notices, setNotices] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.notices) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return undefined;
      let cancelled = false;
      api.notices()
        .then((r) => { if (!cancelled) setNotices(r.data || []); })
        .catch(() => { /* 실패 시 공지를 넣지 않는다 */ });
      return () => { cancelled = true; };
    }, []);

    const noticeItems = React.useMemo(() => {
      if (!Array.isArray(notices)) return [];
      return notices.map((n) => ({
        id: 'notice-' + n.id,
        kind: 'system',
        title: n.title,
        body: n.body || '',
        time: Number(n.publishedAt) || Date.now(),
        // 공지를 읽음으로 표시하는 기능이 없다. 항상 unread 로 두면 배지가
        // 사라지지 않아 배지 자체가 무의미해진다 — 읽음 표시 없이 목록에만 둔다.
        unread: false,
        isLive: true,
        pinned: Boolean(n.pinned),
      }));
    }, [notices]);

    /*
       목업 알림은 실계정에서 제외한다.

       'AI Signal · Confidence 74% · Entry 68,120–68,360' 같은 항목이 실제
       알림과 섞여 있었다. 사용자는 구분할 수 없고, 그 진입가로 주문을 낸다.
       실데이터가 있을 때는 목업을 섞지 않는다.
    */
    /*
       실데이터 판정.

       ★ 서버 알림(serverAlerts)도 실데이터다. 전에는 `acct.isLive`(거래소 키
         검증)와 공지만 봐서, 문의 답변 알림이 도착해도 목업이 섞여 있었다.
    */
    const hasLiveSource = acct.isLive || Array.isArray(notices) || Array.isArray(serverAlerts);
    const N = hasLiveSource
      ? [...liveAlerts, ...(serverAlerts || []), ...noticeItems].sort((a, b) => {
          // 고정 공지를 맨 위로, 그다음 최신순.
          if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
          return (b.time || 0) - (a.time || 0);
        })
      /*
         ★ 실서비스에서는 목업 알림을 섞지 않는다. 'AI Signal · Entry 68,120' 같은
           예시가 실제 알림과 나란히 보이면 사용자가 그 가격으로 주문을 낸다.
      */
      : [...liveAlerts, ...((window.QTMockPolicy && !window.QTMockPolicy.allowMockData())
          ? [] : window.QTApp.NOTIFICATIONS)];
    const filtered = filter === 'all' ? N : filter === 'unread' ? N.filter(x => x.unread) : N.filter(x => x.kind === filter);

    /*
       전체 읽음 처리.

       ★ 서버가 진실이다 — 로컬 상태만 바꾸면 새로고침하면 되돌아온다.
       ★ 실패를 조용히 넘기지 않는다. 눌렀는데 아무 일도 없으면 이용자는 다시
         누르고, 그래도 안 되면 고장이라고 여긴다.
    */
    const [markingAll, setMarkingAll] = useState(false);
    const markAllRead = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.markAllNotificationsRead) return;
      if (!(window.QTAuth && window.QTAuth.isLoggedIn && window.QTAuth.isLoggedIn())) return;
      setMarkingAll(true);
      api.markAllNotificationsRead()
        .then(() => {
          /*
             ★ 서버가 성공을 준 뒤에 다시 읽는다. 낙관적으로 먼저 지우면, 실패했을
               때 화면은 읽음인데 서버는 안 읽음이 되어 다음 접속에 되살아난다.
          */
          if (api.notifications) {
            return api.notifications().then((r) => {
              const rows = (r && (r.items || r.notifications)) || [];
              setServerAlerts(Array.isArray(rows) ? rows : []);
            });
          }
          return undefined;
        })
        .catch(() => { /* 실패하면 배지가 그대로 남는다 — 그것이 정직한 표시다. */ })
        .finally(() => setMarkingAll(false));
    }, []);

    return (
      <window.PageShell
        {...shellProps}
        title={t('nav_notifications')}
        subtitle={t('nt_sub', { unread: N.filter(x=>x.unread).length, total: N.length })}
        breadcrumb={['Home','Notifications']}
        actions={
          <>
            {/*
               ★★ 두 버튼 다 onClick 이 없어서 눌러도 아무 일이 없었다.

                 'Mark all read' 는 서버 라우트(/api/notifications/read-all)와
                 클라이언트 함수(markAllNotificationsRead)가 **이미 있었는데**
                 화면이 부르지 않았다. 배선만 빠진 상태였다.
            */}
            <button
              className="btn btn--sm"
              /*
                 ★ 읽지 않은 알림이 없으면 누를 수 없게 한다. 누를 수 있는데 아무
                   변화가 없으면 고장으로 보인다.
              */
              disabled={markingAll || N.filter((x) => x.unread).length === 0}
              onClick={markAllRead}
            >
              {t('notifications_f6bc37')}
            </button>
            {/*
               'Filter' 는 아래 세그먼트(All/Unread/Signals/…)와 같은 일을 한다.
               별도 동작을 만들지 않고 **읽지 않은 것만 보기** 로 잇는다 —
               가장 자주 쓰는 필터이고, 이미 있는 상태를 재사용한다.
            */}
            <button
              className={`btn btn--sm ${filter === 'unread' ? 'btn--primary' : ''}`}
              onClick={() => setFilter(filter === 'unread' ? 'all' : 'unread')}
            >
              {t('notifications_f53a6e')}
            </button>
          </>
        }
      >
        <window.SectionCard
          title={t('nt_inbox')}
          actions={
            <div className="seg">
              {[
                { id:'all', label:t('nt_f_all') },
                { id:'unread', label:t('nt_f_unread') },
                { id:'signal', label:t('nt_f_signals') },
                { id:'order', label:t('nt_f_orders') },
                { id:'risk', label:t('nt_f_risk') },
                { id:'notice', label:t('nt_f_notices') },
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
    // 계정 데이터가 도착하면 재렌더한다.
    const acct = window.useAccountData ? window.useAccountData() : { status: 'OFFLINE', isLive: false };
    const Acct = window.QTAccount;

    /** 심볼 필터. 서버에도 파라미터가 있지만 받아둔 데이터로 거른다. */
    const [symbolFilter, setSymbolFilter] = useState('all');

    /*
       실 주문·체결이 있으면 그것을 쓴다.

       미체결과 완료 주문을 합쳐 시간 역순으로 보여준다 — 사용자는 "내가 낸 주문"
       을 한 곳에서 보려 한다. 상태(open/done/canceled)로 구분한다.

       실데이터가 없으면 목업을 유지한다. 빈 표를 보여주면 "주문 기록이 없다" 는
       거짓이 되고, 사용자가 주문이 사라진 줄 안다.
    */
    /*
       우리 DB 에 남은 주문 기록 (모의 포함).

       ★★ 왜 별도로 읽는가

         `acct.isLive` 는 **거래소 API 키가 검증됐는지**를 뜻한다. 모의 주문은
         거래소로 나가지 않고 우리 DB 에만 남으므로, 키가 없어도 보여야 한다.

         전에는 이 경로가 없었다. 모의 주문이 DB 에 정확히 저장되는데도 화면은
         목업을 보여줬다 — 사용자는 자기 주문이 실패했다고 판단한다.

       ★ mode 가 'MOCK' 인 행은 화면이 그렇게 표시한다. 실제 체결로 오인되면
         전략 판단이 어긋난다.
    */
    const [localRows, setLocalRows] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.localOrders) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      Promise.all([
        api.localOrders({ limit: 100 }).catch(() => null),
        api.localOpenOrders({ limit: 100 }).catch(() => null),
        api.localTrades({ limit: 200 }).catch(() => null),
      ]).then(([hist, open, trades]) => {
        if (cancelled) return;
        const items = [...((open && open.items) || []), ...((hist && hist.items) || [])];
        if (!items.length) { setLocalRows(null); return; }

        // 체결 수수료를 주문에 붙인다. 실제로 얼마 나갔는지는 체결 쪽에만 있다.
        const feeByOrder = new Map();
        ((trades && trades.items) || []).forEach((f) => {
          if (!f.orderId) return;
          const prev = feeByOrder.get(f.orderId);
          const v = f.fee === null || f.fee === undefined ? null : Number(f.fee);
          // 수수료를 모르는 체결이 섞이면 합계도 모르는 것이다 — 0 으로 세지 않는다.
          feeByOrder.set(f.orderId, v === null || prev === null ? null : (prev || 0) + v);
        });

        setLocalRows(items.map((o) => ({
          id: o.id,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          price: o.price === null ? null : Number(o.price),
          avgPrice: null,
          amount: Number(o.quantity),
          filled: Number(o.filledQuantity),
          remaining: Number(o.quantity) - Number(o.filledQuantity),
          trigger: null,
          time: o.updatedAt || o.createdAt,
          status: String(o.status || '').toLowerCase(),
          fee: feeByOrder.has(o.id) ? feeByOrder.get(o.id) : null,
          // 모의 체결임을 화면이 밝힐 수 있게 그대로 넘긴다.
          mode: o.mode,
        })).sort((a, b) => b.time - a.time));
      });
      return () => { cancelled = true; };
    }, []);

    const live = React.useMemo(() => {
      if (!acct.isLive || !Acct) return null;
      const open = Acct.getOpenOrders();
      const done = Acct.getOrderHistory();
      const fills = Acct.getFills();

      // 체결 수수료를 주문에 붙인다. 실제로 얼마 나갔는지는 체결 쪽에만 있다.
      const feeByOrder = new Map();
      fills.forEach((f) => {
        if (!f.orderId) return;
        feeByOrder.set(f.orderId, (feeByOrder.get(f.orderId) || 0) + (Number(f.fee) || 0));
      });

      const rows = [...open, ...done]
        .map((o) => ({
          ...o,
          fee: feeByOrder.get(o.exchangeOrderId) ?? feeByOrder.get(o.id) ?? null,
        }))
        .sort((a, b) => b.time - a.time);

      return { rows, fills };
    }, [acct.version, acct.isLive]);

    /*
       표시 우선순위: 거래소 실주문 → 우리 DB 기록 → 목업.

       ★ 거래소 데이터가 있으면 그것이 사실이다. 없고 우리 기록이 있으면 그것을
         보여준다. 둘 다 없을 때만 디자이너 예시가 남는다.
    */
    /*
       주문 목록: 거래소 → 우리 DB → (미리보기에서만) 목업.

       ★ 실서비스에서 기록이 없으면 빈 배열이다. 아래 표가 "주문이 없습니다" 를
         보여준다 — 목업 주문을 자기 것으로 오해하는 것보다 정확하다.
    */
    /*
       ★★ 어느 목록을 보여줄지는 **모드**로 정한다 — 키 유무로 정하면 안 된다.

         전에는 `live ? live.rows : localRows` 였다. `live` 는 "거래소 키가
         검증됐는가" 이므로, 키를 연결한 이용자는 **모의 주문이 보이지 않았다.**
         실측: 모의 주문 4건이 DB 에 있고 `/api/orders/history` 도 4건을
         돌려주는데 표에는 "No data" 만 나왔다. 이용자는 자기 주문이 실패했다고
         판단한다.

       ★★ 두 목록을 합치지 않는다. 모의 체결과 실제 체결이 한 표에 섞이면
         어느 것이 실제 손익인지 알 수 없다 — 그 상태로 전략을 판단하면 틀린다.

       ★ Paper 모드에서는 우리 DB 기록(모의)이 정답이고, 실거래 모드에서는
         거래소 기록이 정답이다. 각 행은 `mode` 를 들고 있어 화면이 표시한다.
    */
    const isPaperMode = Boolean(window.QTMode && window.QTMode.get && window.QTMode.get() === 'paper');
    const allOrders = (isPaperMode ? null : live)
      ? live.rows
      : localRows
      ? localRows
      : (window.QTMockPolicy && !window.QTMockPolicy.allowMockData())
      ? []
      : [
          /*
             ★ 이 배열은 미리보기에서만 쓰인다 — 위 조건이 실서비스면 여기까지
               오지 않는다(아래 allOrders 정의 참고).
          */
          ...window.QT.OPEN_ORDERS.map(o => ({...o, status: o.status || 'pending'})),
          ...window.QTApp.TRADE_JOURNAL.map(t => ({
            id: 'fill-' + t.id, symbol: t.sym.replace('/','') , side: t.side, type: 'LIMIT',
            price: t.entry, amount: t.size, filled: t.size, time: new Date(t.date).getTime(),
            status: 'filled', pnl: t.pnl,
          })),
        ].sort((a,b) => b.time - a.time);

    const symbols = [...new Set(allOrders.map(o => o.symbol))].sort();
    const orders = symbolFilter === 'all' ? allOrders : allOrders.filter(o => o.symbol === symbolFilter);

    /*
       KPI 를 실데이터로 계산한다.

       예전에는 체결률 87% · 슬리피지 0.023% · 수수료 $18.42 가 하드코딩이었다.
       실 주문 목록 옆에 가짜 통계를 두면 사용자가 그 값을 믿는다.
       계산할 수 없으면 '—' 로 둔다 — 슬리피지는 주문가와 체결가를 함께
       비교해야 하고, 거래소가 주문별 체결가를 주지 않으면 구할 수 없다.
    */
    const kpi = React.useMemo(() => {
      if (!live) {
        /*
           ★★ 실서비스에서는 예시 통계를 쓰지 않는다.

             전에는 `!live` 이면 무조건 87% · 0.023% · $18.42 를 보여줬다.
             거래소 키가 없고 우리 DB 기록만 있는 상태(또는 기록도 없는 상태)가
             그 경로였고, 실제 주문 목록 옆에 가짜 통계가 나란히 놓였다.

           ★ 우리 DB 기록이 있으면 그것으로 셀 수 있는 것만 센다. 슬리피지는
             주문가와 체결가를 함께 비교해야 하므로 계산하지 않는다.
        */
        if (window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) {
          const filledLocal = orders.filter((o) => Number(o.filled) > 0).length;
          const feeSum = orders.reduce((a, o) => {
            const f = Number(o.fee);
            return Number.isFinite(f) ? a + f : a;
          }, 0);
          const anyFeeUnknown = orders.some((o) => o.fee === null || o.fee === undefined);
          return {
            total: orders.length,
            fillRate: orders.length > 0 ? `${Math.round((filledLocal / orders.length) * 100)}%` : '—',
            // 슬리피지는 근거가 없다. 0 으로 두면 "완벽하게 체결됐다" 로 읽힌다.
            slippage: '—',
            // 수수료를 모르는 체결이 섞이면 합계도 모르는 것이다.
            fees: (orders.length === 0 || anyFeeUnknown) ? '—' : `$${feeSum.toFixed(4)}`,
            isLive: true,
          };
        }
        return { total: orders.length, fillRate: '87%', slippage: '0.023%', fees: '$18.42', isLive: false };
      }
      const filled = orders.filter(o => Number(o.filled) > 0).length;
      const totalFee = live.fills.reduce((a, f) => a + (Number(f.fee) || 0), 0);
      const makerCount = live.fills.filter(f => /maker/i.test(f.liquidity || '')).length;
      const takerCount = live.fills.filter(f => /taker/i.test(f.liquidity || '')).length;
      const mix = (makerCount + takerCount) > 0
        ? `Maker ${Math.round(makerCount / (makerCount + takerCount) * 100)}% · Taker ${Math.round(takerCount / (makerCount + takerCount) * 100)}%`
        : undefined;
      return {
        total: orders.length,
        fillRate: orders.length > 0 ? Math.round(filled / orders.length * 100) + '%' : '—',
        // 슬리피지는 계산 근거가 없다. 만들어내지 않는다.
        slippage: '—',
        fees: live.fills.length > 0 ? '$' + fmt(totalFee, 4) : '—',
        feeMix: mix,
        isLive: true,
      };
    }, [live, orders.length]);

    return (
      <window.PageShell
        {...shellProps}
        title={t('order_history')}
        subtitle={t('order_history_ea8391')}
        breadcrumb={['Home','Order History']}
        actions={
          <>
            {/* 심볼 목록을 실제 주문에서 만든다. 없는 심볼을 고르면 빈 표가 된다. */}
            <select
              className="input"
              style={{height:28, fontSize:11, width:140}}
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
            >
              <option value="all">{t('oh_all_symbols')}</option>
              {symbols.map(sym => (
                <option key={sym} value={sym}>{sym.replace('USDT','/USDT')}</option>
              ))}
            </select>
            {/* Export 숨김 (베타 범위 제외) — 주문 내역 내보내기 경로가 아직 없다. */}
            {/* eslint-disable-next-line no-constant-binary-expression -- 마크업을 지우지 않고 감춘다(배선 전). 되살릴 때 조건만 지운다. */}
            {false && (
              <button className="btn btn--sm"><I.Camera size={13}/> {t('export_csv')}</button>
            )}
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label={t('oh_total_orders')} value={kpi.total} sub={kpi.isLive ? t('oh_from_exchange') : 'Last 30 days'}/>
          <window.KPICard label={t('oh_fill_rate')} value={kpi.fillRate} sub={kpi.isLive ? undefined : '↑ 2.4% vs prev'} tone="brand"/>
          {/* 슬리피지는 주문가·체결가를 함께 비교해야 구할 수 있다. 근거가 없으면 '—'. */}
          <window.KPICard label={t('oh_avg_slippage')} value={kpi.slippage} sub={kpi.isLive ? t('oh_not_available') : 'Excellent'} tone={kpi.isLive ? undefined : 'long'}/>
          <window.KPICard label={t('oh_total_fees')} value={kpi.fees} sub={kpi.feeMix || (kpi.isLive ? undefined : 'Maker: 62% · Taker: 38%')}/>
        </div>

        <window.SectionCard title={t('adm_stat_orders')} noPadding>
          <window.DataTable
            columns={[
              { key: 'time',   label: t('col_time'), width: 120, render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{new Date(r.time).toLocaleString('en-GB', {hour12:false})}</span> },
              { key: 'sym',    label: t('col_symbol'), render: r => <strong>{(r.symbol || '').replace('USDT','/USDT')}</strong> },
              { key: 'side',   label: t('col_side'), render: r => <span className={r.side==='long'?'t-long':'t-short'} style={{fontWeight:500}}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
              { key: 'type',   label: t('col_type') },
              // 시장가 주문은 지정가가 없다(null). fmt(null) 은 0 이 되어 '0원 주문' 으로 읽힌다.
              { key: 'price',  label: t('col_price'), align:'right', render: r => (r.price == null ? <span style={{color:'var(--color-text-tertiary)'}}>—</span> : fmt(r.price, r.price >= 100 ? 1 : 4)) },
              { key: 'amount', label: t('col_amount'), align:'right', render: r => fmt(r.amount, 3) },
              { key: 'filled', label: t('col_filled'), align:'right', render: r => fmt(r.filled, 3) + '/' + fmt(r.amount, 3) },
              /*
                 상태 표기가 두 갈래다: 목업은 filled/partial/pending, 거래소는 done/open/canceled.
                 양쪽을 모두 처리하고, r.status 가 없을 때 toUpperCase() 로 터지지 않게 한다.
              */
              { key: 'status', label: t('col_status'), render: r => {
                const st = String(r.status || 'unknown');
                const tone = /filled|done/i.test(st) ? 'ok'
                  : /partial/i.test(st) ? 'warn'
                  : /cancel/i.test(st) ? 'danger'
                  : 'neutral';
                return <span className={`status-pill status-pill--${tone}`}>{st.toUpperCase()}</span>;
              } },
              // 실제 나간 수수료. 체결에서 가져온다 — 주문 응답에는 없다.
              { key: 'fee', label: t('col_fee'), align:'right', render: r => (r.fee == null ? <span style={{color:'var(--color-text-tertiary)'}}>—</span> : <span className={r.fee < 0 ? 't-long' : undefined}>{fmt(r.fee, 4)}</span>) },
              { key: 'pnl',    label: t('col_pnl'), align:'right', render: r => r.pnl != null ? <span className={r.pnl >= 0 ? 't-long' : 't-short'} style={{fontWeight:500}}>{r.pnl >= 0 ? '+' : ''}${fmt(r.pnl)}</span> : <span style={{color:'var(--color-text-tertiary)'}}>—</span> },
            ]}
            rows={orders}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };
})();
