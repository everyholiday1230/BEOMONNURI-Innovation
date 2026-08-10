/* ============================================================
   PageShell — Reusable frame for all non-trading pages
   ------------------------------------------------------------
   신규 페이지는 이 컴포넌트로 감싸면 자동으로 얻는 것:
   - Simulation stripe (상단)
   - Global header (nav, theme, lang, avatar)
   - Role-aware sidebar (user / admin/ops role 별 아이템)
   - Page header (title, breadcrumb, actions)
   - Consistent content area
   ------------------------------------------------------------
   사용 예:
     <PageShell
       title="Markets"
       breadcrumb={['Home','Markets']}
       actions={<button>...</button>}
     >
       <YourContent/>
     </PageShell>
   ============================================================ */

(function () {
  const { useState, useEffect, useCallback, useMemo } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
  const I = window.Icons;

  // ---- Sidebar item registry — grouped by section, filtered by role ----
  const SIDEBAR_ITEMS = [
    // ---------- USER ITEMS ----------
    { section: 'trading', labelKey: 'nav_trade',       icon: 'Chart',       route: '/trade',          roles: ['user','ops','admin','super'] },
    { section: 'trading', labelKey: 'nav_ai_workspace',   icon: 'Sparkles',    route: '/trade?workspace=ai', roles: ['user','ops','admin','super'] },
    { section: 'trading', labelKey: 'nav_multi_chart',    icon: 'Grid',        route: '/multi-chart',    roles: ['user','ops','admin','super'] },

    { section: 'market',  labelKey: 'nav_markets',        icon: 'Grid',        route: '/markets',        roles: ['user','ops','admin','super'] },
    { section: 'market',  labelKey: 'nav_ai_strategies',  icon: 'Sparkles',    route: '/ai-strategies',  roles: ['user','ops','admin','super'] },
    { section: 'market',  labelKey: 'nav_analytics',      icon: 'Book',        route: '/analytics',      roles: ['user','ops','admin','super'] },

    { section: 'account', labelKey: 'nav_portfolio',      icon: 'Wallet',      route: '/portfolio',      roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_wallet',         icon: 'Wallet',      route: '/wallet',         roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_order_history',  icon: 'Book',        route: '/order-history',  roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_notifications',  icon: 'Bell',        route: '/notifications',  roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_referral',       icon: 'Share',       route: '/referral',       roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_points',         icon: 'Zap',         route: '/points',         roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_fees_rebates', icon: 'Zap',         route: '/fees',           roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_settings',       icon: 'Cog',         route: '/settings',       roles: ['user','ops','admin','super'] },
    { section: 'account', labelKey: 'nav_help',           icon: 'Info',        route: '/help',           roles: ['user','ops','admin','super'] },

    // ---------- ADMIN ITEMS ----------
    { section: 'admin',   labelKey: 'nav_admin_home',     icon: 'LayoutIcon',  route: '/admin',            roles: ['ops','admin','super'] },
    { section: 'admin',   labelKey: 'nav_users',          icon: 'User',        route: '/admin/users',      roles: ['ops','admin','super'] },
    { section: 'admin',   labelKey: 'nav_kyc_queue',      icon: 'Camera',      route: '/admin/kyc',        roles: ['ops','admin','super'] },
    { section: 'admin',   labelKey: 'nav_trade_monitor',  icon: 'Chart',       route: '/admin/trades',     roles: ['ops','admin','super'] },
    { section: 'admin',   labelKey: 'nav_risk_queue',     icon: 'Alert',       route: '/admin/risk',       roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_deposits',       icon: 'Down',        route: '/admin/deposits',   roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_withdrawals',    icon: 'Up',          route: '/admin/withdrawals',roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_assets_vault', icon: 'Wallet',      route: '/admin/assets',     roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_ai_ops',         icon: 'Sparkles',    route: '/admin/ai-ops',     roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_fees_promo',   icon: 'Zap',         route: '/admin/fees',       roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_notices_cs',   icon: 'Bell',        route: '/admin/notices',    roles: ['ops','admin','super'] },
    { section: 'admin',   labelKey: 'nav_broadcast',      icon: 'Send',        route: '/admin/broadcast',  roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_referral_ops',   icon: 'Share',       route: '/admin/referral',   roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_admin_points',   icon: 'Zap',         route: '/admin/points',     roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_admin_legal',    icon: 'Shield',      route: '/admin/legal',      roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_system_health',  icon: 'Wifi',        route: '/admin/system',     roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_audit_log',      icon: 'Book',        route: '/admin/audit',      roles: ['admin','super'] },
    { section: 'admin',   labelKey: 'nav_design_ops',     icon: 'Layers',      route: '/admin/design-ops', roles: ['super'] },
  ];

  /** 섹션 헤더. 라벨 문자열이 아니라 사전 키를 둔다. */
  const SECTION_LABEL_KEYS = {
    trading: 'nav_section_trading',
    market: 'nav_section_market',
    account: 'nav_section_account',
    admin: 'nav_section_admin',
  };

  // ============================================================
  // ROUTE HELPERS
  // ============================================================
  function parseHash() {
    const hash = window.location.hash.replace(/^#/, '') || '/trade';
    const [path, qs] = hash.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    return { path, query };
  }

  window.usePageRoute = function usePageRoute() {
    const [route, setRoute] = useState(parseHash);
    useEffect(() => {
      const onHash = () => setRoute(parseHash());
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const push = useCallback((path, query = {}) => {
      const qs = new URLSearchParams(query).toString();
      window.location.hash = path + (qs ? '?' + qs : '');
    }, []);
    return [route, push];
  };

  // ============================================================
  // SIDEBAR — role-aware, sectioned, expandable/collapsible
  // ============================================================
  /**
   * 사이드바.
   *
   * @param extraTools 화면 고유 도구 (선택). 거래 화면의 레이아웃 편집·Tweaks
   *   처럼 특정 화면에만 있는 버튼을 여기로 넣는다. 사이드바를 화면마다
   *   따로 만들면 접기 상태와 메뉴 구성이 갈라진다 — 실제로 거래 화면과
   *   일반 화면이 서로 다른 사이드바를 쓰고 있었다.
   */
  window.AppSidebar = function AppSidebar({ activePath, role, onNavigate, collapsed, onToggleCollapsed, extraTools }) {
    /*
       메뉴 필터.

       접근 규칙(src/access.js)을 그대로 쓴다. 예전에는 항목의 roles 배열만
       봤는데, 라우팅 가드는 다른 근거를 쓰고 있어서 "메뉴에는 없는데 주소로는
       열리는" 상태가 가능했다. 두 곳이 같은 함수를 써야 어긋나지 않는다.

       roles 배열도 함께 존중한다 — 디자이너가 지정한 값이므로 지우지 않고,
       두 조건을 모두 만족해야 보이게 한다(더 좁은 쪽이 이긴다).
    */
    const items = SIDEBAR_ITEMS.filter(it => {
      if (!it.roles.includes(role || 'user')) return false;
      if (!window.QTAccess) return true;
      // 메뉴 경로에 쿼리가 붙는 경우가 있다(예: /trade?workspace=ai).
      const path = String(it.route || '').split('?')[0];
      return window.QTAccess.canAccess(path, role).allowed;
    });
    // Group by section
    const grouped = {};
    items.forEach(it => {
      grouped[it.section] = grouped[it.section] || [];
      grouped[it.section].push(it);
    });

    const isActive = (route) => {
      const routePath = route.split('?')[0];
      const routeQuery = route.split('?')[1] || '';
      if (routeQuery && activePath.includes(routeQuery)) return true;
      return activePath === routePath || (activePath.startsWith(routePath) && routePath !== '/');
    };

    /*
       즐겨찾기(고정).

       메뉴가 30개다. 펼치면 세로 1,240px 이 되어 1920px 화면에서도 8개가
       스크롤 밖으로 나간다. 자주 쓰는 3~4개를 매번 스크롤해서 찾게 된다.

       그래서 접힌 상태에서는 **고정한 메뉴만** 아이콘으로 보여준다.
       고정은 QTNav 가 기억한다(기기별 저장).
    */
    const nav = window.QTNav && window.QTNav.useNav ? window.QTNav.useNav() : null;
    const pinnedSet = new Set(nav ? nav.pinned : []);

    /*
       접힌 레일에 넣을 항목.

       현재 보고 있는 화면은 고정하지 않았어도 넣는다 — 지금 있는 위치가
       레일에 없으면 "내가 어디 있는지" 표시가 사라진다.
       접근 권한이 없는 고정 항목은 자동으로 빠진다(items 가 이미 걸렀다).
    */
    const railItems = items.filter(it => pinnedSet.has(it.route) || isActive(it.route));

    const adminBadge = (it) => (
      /*
         관리자 전용 표시.

         섹션 머리글에만 ADMIN 배지가 있어서, 스크롤해서 중간부터 보면
         지금 보는 항목이 관리자용인지 알 수 없었다. 항목마다 표시한다.
         등급을 이름으로 쓰지 않고 '가장 낮은 접근 등급' 을 보여준다 —
         /admin/risk 는 super 만, /admin/users 는 ops 부터인 식으로 다르다.
      */
      window.QTAccess && window.QTAccess.requiredTier
        ? (() => {
            const tier = window.QTAccess.requiredTier(String(it.route).split('?')[0]);
            if (!tier || tier === 'user') return null;
            return <span className={`sb-item-v2__tier sb-item-v2__tier--${tier}`}>{tier.toUpperCase()}</span>;
          })()
        : null
    );

    return (
      <aside className={`app-sidebar-v2 ${collapsed ? 'is-collapsed' : ''}`}>
        {/*
           접기 버튼을 **위로** 옮겼다.

           원래 스크롤 영역 아래(__foot)에 있었는데, 메뉴가 길어 그 자리까지
           내려가야 보였다. 접으려면 스크롤을 해야 하는 접기 버튼은 쓸 수 없다.
           위에 고정하면 어느 스크롤 위치에서도 누를 수 있다.
        */}
        <div className="app-sidebar-v2__head">
          <button
            className="sb-item-v2 sb-item-v2--sm"
            onClick={onToggleCollapsed}
            title={collapsed ? t('nav_expand') : t('nav_collapse')}
            aria-expanded={!collapsed}
          >
            <span className="sb-item-v2__icon">
              {collapsed ? <I.ChevronRight size={13}/> : <I.ChevronLeft size={13}/>}
            </span>
            {!collapsed && <span className="sb-item-v2__label" style={{fontSize:11}}>{t('nav_collapse')}</span>}
          </button>
        </div>

        <div className="app-sidebar-v2__scroll">
          {collapsed ? (
            /*
               접힌 레일 — 고정한 메뉴만.

               전체를 아이콘으로 늘어놓으면 30개가 세로로 쌓여 여전히 잘린다.
               고정한 것만 두면 한 화면에 들어온다.
            */
            <div className="sb-section">
              {railItems.map(it => {
                const Icon = I[it.icon] || I.Grid;
                const active = isActive(it.route);
                return (
                  <a
                    key={it.route}
                    className={`sb-item-v2 ${active ? 'is-active' : ''}`}
                    href={'#' + it.route}
                    onClick={(e) => { onNavigate && onNavigate(it.route, e); }}
                    title={t(it.labelKey)}
                  >
                    <span className="sb-item-v2__icon"><Icon size={15}/></span>
                    {active && <span className="sb-item-v2__mark"/>}
                  </a>
                );
              })}
              {/*
                 고정이 하나도 없을 때.

                 빈 레일은 고장으로 보인다. 펼치라는 안내를 아이콘으로 준다.
              */}
              {railItems.length === 0 && (
                <button
                  className="sb-item-v2"
                  onClick={onToggleCollapsed}
                  title={t('nav_no_pins_hint')}
                >
                  <span className="sb-item-v2__icon"><I.Star size={15}/></span>
                </button>
              )}
            </div>
          ) : (
            <>
              {Object.keys(grouped).map(section => (
                <div className="sb-section" key={section}>
                  <div className="sb-section__label">
                    {t(SECTION_LABEL_KEYS[section])}
                    {section === 'admin' && <span className="sb-section__badge">ADMIN</span>}
                  </div>
                  {grouped[section].map(it => {
                    const Icon = I[it.icon] || I.Grid;
                    const active = isActive(it.route);
                    const isPin = pinnedSet.has(it.route);
                    return (
                      <div key={it.route} className="sb-row">
                        <a
                          className={`sb-item-v2 ${active ? 'is-active' : ''}`}
                          href={'#' + it.route}
                          onClick={(e) => { onNavigate && onNavigate(it.route, e); }}
                          title={t(it.labelKey)}
                        >
                          <span className="sb-item-v2__icon"><Icon size={15}/></span>
                          <span className="sb-item-v2__label">{t(it.labelKey)}</span>
                          {adminBadge(it)}
                          {active && <span className="sb-item-v2__mark"/>}
                        </a>
                        {/*
                           고정 토글.

                           별을 누르면 접힌 레일에 남는다. 링크와 겹치지 않도록
                           별도 버튼으로 두고, 클릭이 링크로 전파되지 않게 막는다 —
                           고정하려다 화면이 이동하면 흐름이 끊긴다.
                        */}
                        <button
                          className={`sb-pin ${isPin ? 'is-on' : ''}`}
                          aria-pressed={isPin}
                          title={isPin ? t('nav_unpin') : t('nav_pin')}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (nav) nav.togglePin(it.route);
                          }}
                        >★</button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}

          {/*
             화면 고유 도구.

             접힌 상태에서도 보여준다 — 거래 화면의 레이아웃 편집은 차트를
             보면서 쓰는 도구이고, 접었다고 쓸 수 없게 되면 안 된다.
          */}
          {extraTools && (
            <div className="sb-section sb-section--tools">
              {!collapsed && <div className="sb-section__label">{t('nav_section_tools')}</div>}
              {extraTools}
            </div>
          )}
        </div>

        {/* 펼친 상태에서만 안내를 둔다. 접힌 레일에는 글자가 들어갈 자리가 없다. */}
        {!collapsed && (
          <div className="app-sidebar-v2__foot">
            <div className="sb-hint">
              {t('nav_pin_hint', { n: pinnedSet.size })}
              {window.QTNav && !window.QTNav.isDefault() && (
                <button className="sb-hint__reset" onClick={() => window.QTNav.resetPins()}>
                  {t('nav_pin_reset')}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    );
  };

  // ============================================================
  // PAGE HEADER — reusable title/breadcrumb/actions row
  // ============================================================
  window.PageHeader = function PageHeader({ title, subtitle, breadcrumb, actions, badge }) {
    return (
      <div className="page-header">
        <div className="page-header__left">
          {breadcrumb && breadcrumb.length > 0 && (
            <div className="page-breadcrumb">
              {breadcrumb.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="page-breadcrumb__sep">/</span>}
                  <span className={i === breadcrumb.length - 1 ? 'is-current' : ''}>{crumb}</span>
                </React.Fragment>
              ))}
            </div>
          )}
          <div className="page-header__title-row">
            <h1 className="page-header__title">{title}</h1>
            {badge}
          </div>
          {subtitle && <div className="page-header__subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    );
  };

  // ============================================================
  // PAGE SHELL — the top-level wrapper for every non-trading page
  // ============================================================
  window.PageShell = function PageShell({
    title, subtitle, breadcrumb, actions, badge,
    activePath, role = 'user', onNavigate,
    children,
    // Optional: full-bleed pages (no padding on body)
    fullBleed = false,
  }) {
    /*
       접기 상태는 QTNav 가 유일한 출처다.

       원래 이 컴포넌트가 자체 useState 로 들고 있었다. 그러면 거래 화면의
       레일과 상태가 갈라져서, 한쪽에서 접어도 다른 쪽은 펼쳐진 채였다.
       QTNav 로 모으면 어느 화면에서 접어도 전체가 같은 상태를 본다.
    */
    const nav = window.QTNav && window.QTNav.useNav ? window.QTNav.useNav() : null;
    const sidebarCollapsed = nav ? nav.collapsed : false;
    const setSidebarCollapsed = () => { if (nav) nav.toggleCollapsed(); };

    return (
      <div className={`page-shell ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <window.AppSidebar
          activePath={activePath}
          role={role}
          onNavigate={onNavigate}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={setSidebarCollapsed}
        />

        <main className="page-main">
          <window.PageHeader
            title={title}
            subtitle={subtitle}
            breadcrumb={breadcrumb}
            actions={actions}
            badge={badge}
          />
          <div className={`page-body ${fullBleed ? 'is-full-bleed' : ''}`}>
            {children}
          </div>
        </main>
      </div>
    );
  };

  // ============================================================
  // Common helpers — reusable page primitives
  // ============================================================

  // KPI Card — for dashboards
  window.KPICard = function KPICard({ label, value, delta, deltaLabel, icon, tone, sub }) {
    const IconComp = icon ? (I[icon] || I.Grid) : null;
    return (
      <div className={`kpi-card ${tone ? 'kpi-card--' + tone : ''}`}>
        <div className="kpi-card__head">
          <span className="kpi-card__label">{label}</span>
          {IconComp && <span className="kpi-card__icon"><IconComp size={13}/></span>}
        </div>
        <div className="kpi-card__value">{value}</div>
        {(delta != null || sub) && (
          <div className="kpi-card__foot">
            {delta != null && (
              <span className={`kpi-card__delta ${delta >= 0 ? 'is-up' : 'is-dn'}`}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}% {deltaLabel && <span className="muted">{deltaLabel}</span>}
              </span>
            )}
            {sub && <span className="kpi-card__sub">{sub}</span>}
          </div>
        )}
      </div>
    );
  };

  // Section card — reusable panel with title + optional actions
  window.SectionCard = function SectionCard({ title, subtitle, actions, children, noPadding, className }) {
    return (
      <div className={`section-card ${className || ''}`}>
        {(title || actions) && (
          <div className="section-card__head">
            <div>
              {title && <div className="section-card__title">{title}</div>}
              {subtitle && <div className="section-card__subtitle">{subtitle}</div>}
            </div>
            {actions && <div className="section-card__actions">{actions}</div>}
          </div>
        )}
        <div className={`section-card__body ${noPadding ? 'is-no-padding' : ''}`}>
          {children}
        </div>
      </div>
    );
  };

  // Data Table — reusable sortable table wrapper (light)
  window.DataTable = function DataTable({ columns, rows, empty = 'No data', onRowClick }) {
    return (
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} style={{ textAlign: c.align || 'left', width: c.width }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="data-table__empty">{empty}</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id || i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'is-clickable' : ''}>
                  {columns.map(c => (
                    <td key={c.key} style={{ textAlign: c.align || 'left' }}>
                      {c.render ? c.render(r) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  // Simple placeholder for scaffolded pages
  /**
   * 구조적으로 존재하지 않는 기능을 알리는 패널.
   *
   * PagePlaceholder 와 다른 점
   * ------------------------
   * PagePlaceholder 는 "아직 안 만들었다(TODO)" 를 뜻한다. 이 컴포넌트는
   * "이 구조에서는 생기지 않는다" 를 뜻한다. 둘을 구분해야 하는 이유:
   *
   *   운영자가 TODO 를 보면 기다린다. 출금 승인 화면을 기다리다가 고객에게
   *   "승인 대기 중입니다" 라고 잘못 답한다. 실제로는 우리가 승인할 대상이
   *   아예 없고, 고객은 거래소에서 직접 출금해야 한다.
   *
   * 그래서 이유를 함께 적는다 — "없다" 만 말하면 언젠가 만들 것으로 읽힌다.
   */
  window.NotApplicablePanel = function NotApplicablePanel({ title, reason, points, whereInstead }) {
    return (
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        <div style={{
          padding:'16px 18px', borderRadius:8,
          background:'color-mix(in srgb, var(--color-brand) 8%, transparent)',
          border:'1px solid var(--color-brand)',
        }}>
          <div style={{display:'flex', alignItems:'center', gap:8, fontWeight:600, fontSize:13.5, marginBottom:8}}>
            <I.Lock size={14}/> {title}
          </div>
          <div style={{fontSize:12.5, lineHeight:1.8, color:'var(--color-text-primary)'}}>{reason}</div>
          {Array.isArray(points) && points.length > 0 && (
            <ul style={{margin:'10px 0 0', paddingLeft:20, fontSize:12.5, lineHeight:1.9, color:'var(--color-text-secondary)'}}>
              {points.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
          {whereInstead && (
            <div style={{
              marginTop:12, paddingTop:10, borderTop:'1px solid var(--color-border-subtle)',
              fontSize:12, color:'var(--color-text-secondary)',
            }}>{whereInstead}</div>
          )}
        </div>
      </div>
    );
  };

  window.PagePlaceholder = function PagePlaceholder({ title, todo, icon = 'LayoutIcon' }) {
    const IconComp = I[icon] || I.LayoutIcon;
    return (
      <div className="page-placeholder">
        <div className="page-placeholder__icon"><IconComp size={32}/></div>
        <div className="page-placeholder__title">{title}</div>
        <div className="page-placeholder__body">{t('page_placeholder_63aff4')} <strong>{t('page_placeholder_ed5dd4')}</strong> {t('page_placeholder_be3553')}</div>
        {todo && (
          <div className="page-placeholder__todo">
            <div className="page-placeholder__todo-title">To do</div>
            <ul>{todo.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        )}
        <div className="page-placeholder__hint">
          <strong>{t('page_placeholder_0db548')}</strong> <code>/design-library/</code> {t('page_placeholder_8547a6')}
        </div>
      </div>
    );
  };
})();
