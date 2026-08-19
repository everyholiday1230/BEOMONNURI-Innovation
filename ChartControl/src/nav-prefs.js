/**
 * 사이드바 사용자 설정 — 접기 상태 + 메뉴 즐겨찾기(고정).
 *
 * 왜 필요한가
 * ----------
 * 메뉴가 30개다. 펼치면 1,240px 세로가 되어 1920px 화면에서도 8개가 스크롤
 * 밖으로 나간다. 자주 쓰는 3~4개를 찾기 위해 매번 스크롤하게 된다.
 *
 * 그래서 두 가지 상태를 둔다:
 *   접힘  — 고정한 메뉴만 아이콘으로. 좁고 빠르다.
 *   펼침  — 전체 메뉴 + 글자. 찾고 고정하는 화면.
 *
 * ★ 접힌 상태에서 아무것도 안 보이면 안 된다.
 *   고정한 것이 없으면 기본 세트를 보여준다 — 빈 레일은 고장으로 보인다.
 *
 * 저장 위치의 한계
 * --------------
 * localStorage 는 **기기별**이다. 다른 기기에서는 초기화된 상태로 보인다.
 * 서버 동기화가 생기면 load/save 두 함수만 바꾸면 된다.
 */
(function () {
  'use strict';

  var PIN_KEY = 'qt.nav.pinned.v1';
  var COLLAPSE_KEY = 'qt.sidebarCollapsed';

  /*
     고정한 것이 없을 때 보여줄 기본 메뉴.

     거래·시장·포트폴리오 — 로그인해서 가장 먼저 하는 일 세 가지다.
     관리자 항목을 기본에 넣지 않는다: 대부분의 사용자에게는 보이지도 않고,
     보이는 사람에게도 관리 업무가 주 업무는 아니다.
  */
  var DEFAULT_PINNED = ['/trade', '/markets', '/portfolio'];

  function loadPinned() {
    try {
      var raw = window.localStorage.getItem(PIN_KEY);
      if (raw === null) return DEFAULT_PINNED.slice();
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_PINNED.slice();
      /*
         빈 배열을 그대로 존중한다.

         사용자가 전부 해제한 것과 아직 설정하지 않은 것은 다르다.
         전부 해제했으면 접힌 레일에 기본값을 되살리지 않고, 대신 화면이
         "고정한 메뉴가 없습니다" 를 안내한다.
      */
      return parsed.filter(function (x) { return typeof x === 'string' && x.charAt(0) === '/'; });
    } catch (e) {
      return DEFAULT_PINNED.slice();
    }
  }

  var pinned = loadPinned();
  var collapsed = null;   // 지연 초기화: 첫 조회 때 결정한다
  var listeners = new Set();

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { /* 한 구독자의 예외가 나머지를 막지 않는다 */ }
    });
  }

  function persistPinned() {
    try {
      window.localStorage.setItem(PIN_KEY, JSON.stringify(pinned));
    } catch (e) {
      /*
         저장 실패(용량·사생활 보호 모드)를 삼킨다.
         이번 세션에는 반영돼 있고, 다음 방문에 초기화되는 쪽이 나은 실패다.
      */
    }
  }

  function readCollapsed() {
    if (collapsed !== null) return collapsed;
    try {
      var v = window.localStorage.getItem(COLLAPSE_KEY);
      /*
         저장값이 없을 때의 기본.

         거래 화면은 차트 폭이 생명이므로 접힌 상태로 시작한다.
         나머지 화면은 메뉴가 보이는 편이 낫다.
         '/trade' 판정은 호출 시점의 해시로 한다 — 라우터를 의존하지 않는다.
      */
      if (v === null) {
        var path = String(window.location.hash || '').replace(/^#/, '').split('?')[0];
        // 멀티차트 탭이 없어졌다. 거래 화면만 기본 접힘이다.
        collapsed = path === '/trade';
      } else {
        collapsed = v === '1';
      }
    } catch (e) {
      collapsed = false;
    }
    return collapsed;
  }

  window.QTNav = {
    // ---- 접기 ----

    isCollapsed: function () { return readCollapsed(); },

    setCollapsed: function (v) {
      collapsed = Boolean(v);
      try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) { /* 무시 */ }
      notify();
    },

    toggleCollapsed: function () { this.setCollapsed(!readCollapsed()); },

    // ---- 즐겨찾기(고정) ----

    /** 고정한 라우트 목록. 복사본이라 외부에서 바꿔도 안전하다. */
    pinnedRoutes: function () { return pinned.slice(); },

    isPinned: function (route) { return pinned.indexOf(route) !== -1; },

    /** 아직 한 번도 설정하지 않았는가 (기본값을 쓰는 중인가). */
    isDefault: function () {
      try { return window.localStorage.getItem(PIN_KEY) === null; } catch (e) { return true; }
    },

    togglePin: function (route) {
      if (!route) return false;
      var i = pinned.indexOf(route);
      if (i === -1) {
        // 최근 고정한 것을 아래에 붙인다 — 순서가 흔들리면 근육기억이 깨진다.
        pinned.push(route);
      } else {
        pinned.splice(i, 1);
      }
      persistPinned();
      notify();
      return i === -1;
    },

    /** 기본 세트로 되돌린다. */
    resetPins: function () {
      try { window.localStorage.removeItem(PIN_KEY); } catch (e) { /* 무시 */ }
      pinned = DEFAULT_PINNED.slice();
      notify();
    },

    DEFAULT_PINNED: DEFAULT_PINNED.slice(),

    // ---- 구독 ----

    subscribe: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    /**
     * React 훅 — 접기·고정이 바뀌면 컴포넌트를 재렌더한다.
     *
     * 훅을 여기 두는 이유: 사이드바를 쓰는 셸이 둘(거래 화면, 일반 페이지)이라
     * 각자 구독 코드를 쓰면 해제를 빠뜨려 누수가 난다.
     */
    useNav: function () {
      var R = window.React;
      var pair = R.useState(0);
      var bump = pair[1];
      R.useEffect(function () {
        return window.QTNav.subscribe(function () { bump(function (n) { return n + 1; }); });
      }, []);
      return {
        collapsed: readCollapsed(),
        pinned: pinned.slice(),
        isPinned: function (r) { return pinned.indexOf(r) !== -1; },
        toggleCollapsed: function () { window.QTNav.toggleCollapsed(); },
        togglePin: function (r) { window.QTNav.togglePin(r); },
      };
    },

    debug: function () {
      return { collapsed: readCollapsed(), pinned: pinned.slice(), usingDefault: window.QTNav.isDefault() };
    },
  };

  /*
     다른 탭에서의 변경을 반영한다.

     같은 사용자가 탭 두 개를 열어두는 일은 흔하다. 한쪽에서 고정을 바꿨는데
     다른 쪽이 옛 목록을 보여주면, 거기서 토글할 때 방금 한 변경을 덮어쓴다.
  */
  window.addEventListener('storage', function (e) {
    if (e.key === PIN_KEY) { pinned = loadPinned(); notify(); }
    else if (e.key === COLLAPSE_KEY) { collapsed = e.newValue === '1'; notify(); }
  });
})();
