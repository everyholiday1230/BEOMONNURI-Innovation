/* ============================================================
   구현 상태 표시 (Provenance)
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   무엇을 하는가
   -----------
   화면의 각 부분이 **실데이터인지 목업인지** 눈으로 구분되게 표시한다.
   개발이 진행되면서 어떤 화면은 실제로 동작하고 어떤 화면은 아직 목업인데,
   섞여 있으면 구분이 불가능하다. 목업을 실제로 착각하면 잘못된 판단을 한다.

   왜 별도 레지스트리인가
   -------------------
   상태를 각 컴포넌트에 흩뿌리면 배선이 끝났는데 표시가 남거나, 반대로 아직
   목업인데 실제로 표시되는 일이 생긴다. 그게 표시가 없는 것보다 나쁘다.
   그래서 **한 파일에 모아** 관리한다. 화면 배선을 끝낼 때 여기 한 줄만 고친다.

   디자이너 산출물 불가침
   -------------------
   기존 마크업·CSS 를 수정하지 않는다. 이 파일이 런타임에 겉면 표시만 덧붙이고,
   끄면 원래 화면과 완전히 같아진다. 기본값은 켜짐 — 개발 중에는 보이는 것이
   목적이기 때문이다. 헤더 배지를 눌러 끌 수 있다.

   상태 정의
   --------
   live     실 백엔드에 배선됨. 표시되는 값이 진짜다.
   partial  일부만 실제다. 무엇이 아직 목업인지 note 에 적는다.
   mock     아직 목업이다. 화면만 있고 기능이 없다.
   ============================================================ */

(function () {
  'use strict';

  var STORAGE_KEY = 'qt.provenance';

  /**
   * 라우트별 구현 상태.
   *
   * ★ 배선을 끝내면 여기를 반드시 갱신한다. 갱신을 잊으면 이 표시가 거짓이 되고,
   *   거짓 표시는 표시가 없는 것보다 나쁘다.
   *
   * 기준일: 2026-08-06
   */
  var ROUTES = {
    // ---- 인증 (실 API 배선 완료) ----
    '/login': { status: 'live', note: 'auth_wired' },
    '/signup': { status: 'live', note: 'auth_wired' },
    '/verify-email': { status: 'live', note: 'auth_wired' },
    '/password-reset': { status: 'live', note: 'auth_wired' },
    '/kyc': { status: 'mock', note: 'kyc_not_built' },
    '/': { status: 'partial', note: 'landing_static' },

    // ---- 거래 ----
    '/trade': { status: 'partial', note: 'trade_partial' },
    '/multi-chart': { status: 'partial', note: 'chart_live_only' },
    '/markets': { status: 'live', note: 'market_live' },

    // ---- 계정 ----
    '/portfolio': { status: 'partial', note: 'needs_api_key' },
    '/wallet': { status: 'partial', note: 'needs_api_key' },
    '/wallet/deposit': { status: 'mock', note: 'not_built' },
    '/wallet/withdraw': { status: 'mock', note: 'not_built' },
    '/wallet/transactions': { status: 'partial', note: 'needs_api_key' },
    '/order-history': { status: 'mock', note: 'not_built' },
    '/analytics': { status: 'mock', note: 'not_built' },
    '/settings': { status: 'partial', note: 'settings_partial' },

    // ---- 미구현 ----
    '/ai-strategies': { status: 'mock', note: 'ai_not_built' },
    '/ai-strategies/detail': { status: 'mock', note: 'ai_not_built' },
    '/ai-strategies/my': { status: 'mock', note: 'ai_not_built' },
    '/referral': { status: 'mock', note: 'referral_not_built' },
    '/fees': { status: 'mock', note: 'not_built' },
    '/help': { status: 'mock', note: 'not_built' },
    '/notifications': { status: 'mock', note: 'not_built' },
  };

  /** 관리자 라우트는 전부 미구현이다. 개별로 적지 않고 접두사로 처리한다. */
  var ROUTE_PREFIXES = [
    { prefix: '/admin', status: 'mock', note: 'admin_not_built' },
  ];

  /**
   * 화면 요소별 상태.
   *
   * selector 는 디자이너가 쓴 클래스명이다. 클래스명이 바뀌면 표시가 사라지므로
   * 정확해야 한다 (없는 선택자는 조용히 무시된다 — 화면을 깨뜨리지 않는다).
   */
  /**
   * 화면 요소별 상태.
   *
   * selector 는 디자이너가 쓴 클래스명·속성이다. 없는 선택자는 조용히 무시되므로
   * 화면을 깨뜨리지 않지만, 표시가 사라진다. 클래스명을 바꿀 때 함께 갱신할 것.
   *
   * status 에 'dynamic:account' 를 쓰면 실행 중에 판정한다 (API 키 연결 여부).
   */
  var ELEMENTS = [
    // ================= 거래 화면 위젯 (data-widget-type) =================
    // 위젯은 레이아웃 엔진이 data-widget-type 을 붙여준다. 가장 정확한 대상이다.
    { selector: '[data-widget-type="chart"]', status: 'live', note: 'chart_live' },
    { selector: '[data-widget-type="miniChart"]', status: 'live', note: 'chart_live' },
    { selector: '[data-widget-type="marketWatch"]', status: 'live', note: 'market_live' },
    { selector: '[data-widget-type="orderBook"]', status: 'live', note: 'book_live' },
    { selector: '[data-widget-type="recentTrades"]', status: 'live', note: 'trades_live' },
    // 주문 입력은 서버 검증까지 실제이고 집행만 시뮬레이션이다.
    { selector: '[data-widget-type="orderEntry"]', status: 'partial', note: 'order_sim' },
    // 포지션·자산은 API 키가 검증되면 실데이터가 된다.
    { selector: '[data-widget-type="positions"]', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '[data-widget-type="assetsRisk"]', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '[data-widget-type="aiCopilot"]', status: 'mock', note: 'ai_not_built' },

    // ================= 실제 동작하는 것 =================
    { selector: '.chart-kline-wrap', status: 'live', note: 'chart_live' },
    { selector: '.conn-cluster', status: 'live', note: 'conn_live' },
    { selector: '.role-switcher', status: 'live', note: 'role_from_server' },
    // 차트 도구 모음: 타임프레임·지표·드로잉·스크린샷이 실제로 동작한다.
    { selector: '.chart-tf', status: 'live', note: 'chart_tools_live' },
    // 인증 화면의 입력 폼
    { selector: '.auth-form', status: 'live', note: 'auth_wired' },
    // 거래소 연결 마법사 (저장 + 실검증)
    { selector: '.wizard-progress', status: 'live', note: 'cred_wired' },
    // 언어·테마 토글
    { selector: '.header-tool[title="Language"]', status: 'live', note: 'i18n_live' },
    { selector: '.header-tool[title="Toggle theme"]', status: 'live', note: 'theme_live' },

    // ================= 미구현 버튼 =================
    { selector: '.header-tool[title="Alerts"]', status: 'mock', note: 'not_built' },
    { selector: '.ai-copilot, [class*="copilot"]', status: 'mock', note: 'ai_not_built' },

    // ================= 목업 데이터 화면 =================
    // 관리자 화면 전체
    { selector: '.admin-shell, [class*="admin-"]', status: 'mock', note: 'admin_not_built' },
    // 거래 일지·성과 분석
    { selector: '.journal, [class*="journal"]', status: 'mock', note: 'not_built' },
    // AI 인사이트·신호 카드
    { selector: '[class*="signal-card"], [class*="insight"]', status: 'mock', note: 'ai_not_built' },
    // 알림·공지·티켓 목록
    { selector: '[class*="notif"], [class*="notice"], [class*="ticket"]', status: 'mock', note: 'not_built' },
    // 리퍼럴 링크
    { selector: '[class*="referral"]', status: 'mock', note: 'referral_not_built' },
    // 입출금
    { selector: '[class*="deposit"], [class*="withdraw"]', status: 'mock', note: 'not_built' },
    // 수수료·리베이트 표
    { selector: '[class*="fee-tier"], [class*="rebate"]', status: 'mock', note: 'not_built' },
    // 전략 카드·백테스트
    { selector: '[class*="strategy"], [class*="backtest"]', status: 'mock', note: 'ai_not_built' },
  ];

  var state = {
    enabled: true,
    /** 'badge' = 배지만, 'outline' = 배지 + 테두리 */
    mode: 'outline',
  };

  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.enabled === 'boolean') state.enabled = saved.enabled;
      if (saved.mode === 'badge' || saved.mode === 'outline') state.mode = saved.mode;
    }
  } catch (e) { /* 손상된 값은 무시하고 기본값을 쓴다 */ }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 실패는 치명적이지 않다 */ }
  }

  function t(key, vars) {
    return window.QTI18n ? window.QTI18n.t(key, vars) : key;
  }

  /** 현재 해시 라우트. `#/trade?x=1` → `/trade` */
  function currentRoute() {
    var h = String(window.location.hash || '').replace(/^#/, '');
    var path = h.split('?')[0] || '/';
    return path;
  }

  /**
   * 라우트의 구현 상태를 돌려준다.
   *
   * 등록되지 않은 라우트는 'unknown' 이다. 'live' 로 가정하지 않는다 —
   * 모르는 것을 완성됐다고 표시하면 안 된다.
   */
  function routeStatus(path) {
    if (ROUTES[path]) return ROUTES[path];
    for (var i = 0; i < ROUTE_PREFIXES.length; i += 1) {
      var p = ROUTE_PREFIXES[i];
      if (path === p.prefix || path.indexOf(p.prefix + '/') === 0) {
        return { status: p.status, note: p.note };
      }
    }
    return { status: 'unknown', note: 'unknown_route' };
  }

  /** 계정 데이터 상태에 따라 실제/목업을 런타임 판정한다. */
  function resolveDynamic(spec) {
    if (spec !== 'dynamic:account') return spec;
    if (!window.QTAccount) return 'mock';
    return window.QTAccount.isLive() ? 'live' : 'mock';
  }

  // ---------------------------------------------------------------
  // 화면 표시
  // ---------------------------------------------------------------

  var host = null; // 배지를 담는 컨테이너 (기존 DOM 을 건드리지 않기 위해 분리)

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.className = 'qt-prov-host';
    document.body.appendChild(host);
    return host;
  }

  /** 요소에 상태 속성을 심는다. CSS 가 이 속성으로 테두리를 그린다. */
  function tagElements() {
    // 이전 표시를 지운다. 라우트가 바뀌면 대상이 달라진다.
    var prev = document.querySelectorAll('[data-qt-prov]');
    for (var i = 0; i < prev.length; i += 1) prev[i].removeAttribute('data-qt-prov');

    if (!state.enabled) return;

    for (var j = 0; j < ELEMENTS.length; j += 1) {
      var spec = ELEMENTS[j];
      var status = resolveDynamic(spec.status);
      var nodes;
      try {
        nodes = document.querySelectorAll(spec.selector);
      } catch (e) {
        continue; // 잘못된 선택자는 건너뛴다. 화면을 깨뜨리지 않는다.
      }
      for (var k = 0; k < nodes.length; k += 1) {
        var el = nodes[k];
        el.setAttribute('data-qt-prov', status);
        // title 은 마우스를 올렸을 때 브라우저가 보여준다. 이유를 알 수 있어야 한다.
        el.setAttribute('data-qt-prov-note', t('prov_note_' + spec.note));
        el.setAttribute('data-qt-prov-label', t('prov_status_' + status));

        // 작은 요소는 꼬리표가 내용을 다 덮는다. 점으로만 표시한다.
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 120) el.setAttribute('data-qt-prov-small', '1');
        else el.removeAttribute('data-qt-prov-small');

        // 기존 title 을 덮지 않는다. 디자이너가 넣은 설명이 사라지면 안 된다.
        if (!el.getAttribute('title')) {
          el.setAttribute('title', t('prov_status_' + status) + ' — ' + t('prov_note_' + spec.note));
        }
      }
    }
  }

  /** 헤더에 붙는 현재 라우트 상태 배지 + 켜기/끄기. */
  function renderBadge() {
    var h = ensureHost();
    h.innerHTML = '';

    var info = routeStatus(currentRoute());
    var status = info.status;

    // 계정 데이터가 실제이면 partial 을 live 로 승격한다.
    // '키를 연결하면 실데이터' 인 화면에서, 실제로 연결된 뒤에도 계속
    // '일부 목업' 이라고 표시하면 그것도 거짓이다.
    if (status === 'partial' && info.note === 'needs_api_key' && window.QTAccount && window.QTAccount.isLive()) {
      status = 'live';
    }

    var wrap = document.createElement('div');
    wrap.className = 'qt-prov-badge qt-prov-badge--' + status + (state.enabled ? '' : ' is-off');

    var dot = document.createElement('span');
    dot.className = 'qt-prov-badge__dot';
    wrap.appendChild(dot);

    var label = document.createElement('span');
    label.className = 'qt-prov-badge__label';
    label.textContent = t('prov_status_' + status);
    wrap.appendChild(label);

    var note = document.createElement('span');
    note.className = 'qt-prov-badge__note';
    note.textContent = t('prov_note_' + info.note);
    wrap.appendChild(note);

    var toggle = document.createElement('button');
    toggle.className = 'qt-prov-badge__toggle';
    toggle.type = 'button';
    toggle.textContent = state.enabled ? t('prov_hide') : t('prov_show');
    toggle.title = t('prov_toggle_hint');
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      state.enabled = !state.enabled;
      persist();
      refresh();
    });
    wrap.appendChild(toggle);

    h.appendChild(wrap);

    if (state.enabled) h.appendChild(buildLegend());
    document.documentElement.setAttribute('data-qt-prov-mode', state.enabled ? state.mode : 'off');
  }

  function buildLegend() {
    var legend = document.createElement('div');
    legend.className = 'qt-prov-legend';
    ['live', 'partial', 'mock'].forEach(function (s) {
      var item = document.createElement('span');
      item.className = 'qt-prov-legend__item qt-prov-legend__item--' + s;
      var d = document.createElement('i');
      item.appendChild(d);
      item.appendChild(document.createTextNode(t('prov_status_' + s)));
      legend.appendChild(item);
    });
    return legend;
  }

  var refreshTimer = null;
  function refresh() {
    // 라우트 전환 직후에는 DOM 이 아직 그려지지 않았다. 다음 프레임에 처리한다.
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      renderBadge();
      tagElements();
    }, 120);
  }

  window.addEventListener('hashchange', refresh);
  if (window.QTI18n && window.QTI18n.subscribe) window.QTI18n.subscribe(refresh);
  if (window.QTAccount && window.QTAccount.subscribe) window.QTAccount.subscribe(refresh);

  // React 가 화면을 다시 그리면 심어둔 속성이 사라진다. 주기적으로 다시 심는다.
  // MutationObserver 는 리렌더마다 수백 번 호출되어 오히려 무겁다.
  setInterval(function () { if (state.enabled) tagElements(); }, 2000);

  window.QTProvenance = {
    ROUTES: ROUTES,
    ELEMENTS: ELEMENTS,
    routeStatus: routeStatus,
    refresh: refresh,

    isEnabled: function () { return state.enabled; },
    setEnabled: function (v) { state.enabled = Boolean(v); persist(); refresh(); },
    setMode: function (m) { if (m === 'badge' || m === 'outline') { state.mode = m; persist(); refresh(); } },

    /**
     * 등록되지 않은 라우트를 찾는다. 라우트를 추가하고 상태 등록을 잊는 것을 막는다.
     * 콘솔에서 QTProvenance.audit() 로 확인한다.
     */
    audit: function () {
      var known = (window.QT_ALL_ROUTES || []).slice();
      var missing = known.filter(function (r) { return routeStatus(r).status === 'unknown'; });
      var counts = { live: 0, partial: 0, mock: 0, unknown: 0 };
      known.forEach(function (r) { counts[routeStatus(r).status] += 1; });
      return { total: known.length, counts: counts, unregistered: missing };
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
