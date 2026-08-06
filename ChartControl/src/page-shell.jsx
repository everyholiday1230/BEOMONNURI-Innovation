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
  window.AppSidebar = function AppSidebar({ activePath, role, onNavigate, collapsed, onToggleCollapsed }) {
    const items = SIDEBAR_ITEMS.filter(it => it.roles.includes(role || 'user'));
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

    return (
      <aside className={`app-sidebar-v2 ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="app-sidebar-v2__scroll">
          {Object.keys(grouped).map(section => (
            <div className="sb-section" key={section}>
              {!collapsed && (
                <div className="sb-section__label">
                  {t(SECTION_LABEL_KEYS[section])}
                  {section === 'admin' && <span className="sb-section__badge">ADMIN</span>}
                </div>
              )}
              {grouped[section].map(it => {
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
                    {!collapsed && <span className="sb-item-v2__label">{t(it.labelKey)}</span>}
                    {active && <span className="sb-item-v2__mark"/>}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
        <div className="app-sidebar-v2__foot">
          <button className="sb-item-v2 sb-item-v2--sm" onClick={onToggleCollapsed} title={collapsed ? 'Expand' : 'Collapse'}>
            <span className="sb-item-v2__icon">
              {collapsed ? <I.ChevronRight size={13}/> : <I.X size={13}/>}
            </span>
            {!collapsed && <span className="sb-item-v2__label" style={{fontSize:11}}>Collapse</span>}
          </button>
        </div>
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
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
      return localStorage.getItem('qt.sidebarCollapsed') === '1';
    });
    useEffect(() => {
      localStorage.setItem('qt.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    }, [sidebarCollapsed]);

    return (
      <div className={`page-shell ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <window.AppSidebar
          activePath={activePath}
          role={role}
          onNavigate={onNavigate}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
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
