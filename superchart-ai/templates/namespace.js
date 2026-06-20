/**
 * BEOM ON AI 네임스페이스 (window.BeomApp)
 *
 * 목적:
 * - 기존 window.* 전역 182개를 카테고리로 그룹화
 * - 코드 탐색/디버깅 편의성 (window.BeomApp.state.curSymbol)
 * - 향후 ES module 전환 시 경로 매핑 기준
 *
 * 정책:
 * - 기존 window.* 는 유지 (하위 호환) — namespace 는 alias 레이어
 * - 신규 전역 추가 시 namespace 에만 등록 권장
 * - module 화 전까지는 중복 노출 허용
 *
 * 사용 예:
 *   console.log(BeomApp.state.curSymbol);         // === window.curSymbol
 *   BeomApp.util.showToast('hi');                 // === window.showToast('hi')
 *   BeomApp.action.favorite.add('BTCUSDT');       // === window._addFav('BTCUSDT')
 *
 * 카테고리:
 * - state     : 현재 UI/세션 상태 (curSymbol, isLoggedIn 등)
 * - core      : 핵심 객체 (chart, API, ChartCore)
 * - util      : 유틸 함수 (api, showToast, sanitize 등)
 * - render    : 렌더링 함수 (_refreshOverlays 등)
 * - action    : 사용자 액션 (_googleLogin, _addFav, _deleteAccount 등)
 * - data      : 캐시/컬렉션 (_favSymbols, _indHistory 등)
 * - demo      : 데모 모드
 */
(function () {
  'use strict';

  // getter/setter 로 기존 window.* 와 항상 동기화
  function _bind(target, key, winKey) {
    if (Object.prototype.hasOwnProperty.call(target, key)) return;
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() { return window[winKey]; },
      set(v) { window[winKey] = v; },
    });
  }

  const NS = {
    version: '1.0',
    state: {},
    core: {},
    util: {},
    render: {},
    action: {},
    data: {},
    demo: {},
  };

  // state
  ['curSymbol', 'curTf', 'isLoggedIn', 'isPremium', 'isAdmin'].forEach(k => _bind(NS.state, k, k));

  // core
  ['chart', 'ChartCore', 'API', 'COS'].forEach(k => _bind(NS.core, k, k));

  // util (가장 자주 쓰임)
  ['api', 'showToast', 't', 'dedupFetch', 'sanitize', 'esc', 'setText', '_escHtml', '_safeUrl'].forEach(k => _bind(NS.util, k, k));

  // render
  ['_refreshOverlays', '_renderFavInds', '_renderFavSymbols'].forEach(k => _bind(NS.render, k, k));

  // data
  ['_favSymbols', '_favInds', '_customMA', '_customSUB', '_indSettings', '_indHistory', '_checkedBars', '_compareSymbols'].forEach(k => _bind(NS.data, k, k));

  // demo
  ['_demoLong', '_demoShort', '_demoClose', '_demoClear', '_demoPos', '_demoMarkers'].forEach(k => _bind(NS.demo, k, k));

  // action (다수 — auth/favorite/chart 등 하위 그룹)
  const actionAuth = ['_googleLogin', '_forgotPassword', '_doResetPw', '_deleteAccount', '_logout'];
  const actionFav = ['_addFav', '_addFavSym', '_removeFav', '_removeFavSym'];
  const actionChart = ['_selectSym', '_refreshOverlays', '_debounceSaveChartSettings'];
  const actionAlert = ['_alertTypeChanged', '_initBeomAlertPanel', '_loadBeomAlerts'];

  NS.action.auth = {};
  NS.action.favorite = {};
  NS.action.chart = {};
  NS.action.alert = {};

  actionAuth.forEach(k => _bind(NS.action.auth, k.replace(/^_/, ''), k));
  actionFav.forEach(k => _bind(NS.action.favorite, k.replace(/^_(add|remove)Fav(Sym)?$/, (m, a, s) => a + (s ? 'Sym' : '')), k));
  actionChart.forEach(k => _bind(NS.action.chart, k.replace(/^_/, ''), k));
  actionAlert.forEach(k => _bind(NS.action.alert, k.replace(/^_/, ''), k));

  // 진단 유틸
  NS.dump = function () {
    const out = {};
    for (const cat of Object.keys(NS)) {
      if (typeof NS[cat] !== 'object' || NS[cat] === null) continue;
      out[cat] = Object.keys(NS[cat]);
    }
    return out;
  };

  // ── 통계 (하드코딩된 숫자 대체용) ─────────────────────
  // UI 문구에 박힌 "45개 코인" 같은 값을 실제 DB/DOM 기반으로 계산.
  // 값이 바뀌면 자동 반영 — 드리프트 방지.
  NS.stats = {
    /** 현재 활성화된 심볼(코인) 총 개수. window.symbols 가 로드되어야 정확. */
    get symbolCount() {
      try { return (window.symbols || []).length || 0; } catch(e) { return 0; }
    },
    /** 지원 타임프레임 개수 (고정: 1m/5m/15m/1h/4h/1d). */
    get timeframeCount() { return 6; },
    /** 메인 지표 수 (DOM 의 data-ind 개수, 숨김 제외). */
    get mainIndicatorCount() {
      try { return document.querySelectorAll('[data-ind]:not([style*="display:none"])').length; } catch(e) { return 0; }
    },
    /** 서브 지표 수 (DOM 의 data-sub 개수). */
    get subIndicatorCount() {
      try { return document.querySelectorAll('[data-sub]').length; } catch(e) { return 0; }
    },
    /** 전체 지표 수 (메인 + 서브). */
    get totalIndicatorCount() {
      return NS.stats.mainIndicatorCount + NS.stats.subIndicatorCount;
    },
    /** 플레이스홀더 치환 도우미. {코인수} {타임프레임수} {지표수} 등 지원. */
    fill(template) {
      if (!template) return '';
      return String(template)
        .replace(/\{코인수\}/g, NS.stats.symbolCount || '50+')
        .replace(/\{symbolCount\}/g, NS.stats.symbolCount || '50+')
        .replace(/\{타임프레임수\}/g, NS.stats.timeframeCount)
        .replace(/\{timeframeCount\}/g, NS.stats.timeframeCount)
        .replace(/\{지표수\}/g, NS.stats.totalIndicatorCount || '40+')
        .replace(/\{indicatorCount\}/g, NS.stats.totalIndicatorCount || '40+')
        .replace(/\{메인지표수\}/g, NS.stats.mainIndicatorCount || '30+')
        .replace(/\{서브지표수\}/g, NS.stats.subIndicatorCount || '10+');
    },
  };

  window.BeomApp = NS;

  // ── data-dynamic-text 자동 치환 ────────────────────────
  // HTML 에 data-dynamic-text="{지표수}+ 지표..." 로 적으면
  // symbols 로드 이후 자동으로 실제 숫자로 교체. 여러 줄은 | 로 구분.
  function _applyDynamicText() {
    try {
      document.querySelectorAll('[data-dynamic-text]').forEach(el => {
        const tpl = el.getAttribute('data-dynamic-text');
        if (!tpl) return;
        // | → <br> 로 변환
        const filled = NS.stats.fill(tpl).replace(/\|/g, '<br>');
        // span 안의 html(b 태그 등)까지 허용
        el.innerHTML = filled;
      });
    } catch (e) {
      console.warn('dynamic-text fill failed:', e);
    }
  }

  // 초기 시도 + symbols 로드 이벤트 후 재시도
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _applyDynamicText);
  } else {
    _applyDynamicText();
  }
  // symbols 가 늦게 로드되는 경우 대비
  setTimeout(_applyDynamicText, 1000);
  setTimeout(_applyDynamicText, 3000);
  // 다른 코드에서 수동 트리거 가능
  NS.refreshDynamicText = _applyDynamicText;
})();
