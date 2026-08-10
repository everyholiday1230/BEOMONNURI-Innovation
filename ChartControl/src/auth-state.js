/* ============================================================
   세션 상태 — 등급(권한)의 유일한 근거
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   왜 이 파일이 필요한가
   -------------------
   기존에는 화면 등급을 `localStorage['qt.tweaks'].role` 에서 읽었다.
   그건 개발용 스위치였고, 브라우저 콘솔에서 한 줄로 바꿀 수 있었다.

       localStorage.setItem('qt.tweaks', JSON.stringify({role:'super'}))

   즉 등급이 권한이 아니었다. 이제 등급은 **서버가 준 세션에서만** 온다.

   두 겹 방어
   ---------
   이 파일은 1겹(화면 숨김)을 담당한다. 화면을 숨기는 것만으로는 보안이 되지
   않는다 — 버튼을 숨겨도 그 버튼이 부르던 API 는 그대로 열려 있다. 2겹은
   서버가 403 을 내는 것이고, 그건 apps/api 의 RBAC 이 담당한다.
   여기서 하는 일은 "권한 없는 것을 보여주지 않는" 사용자 경험이다.
   ============================================================ */

(function () {
  'use strict';

  /**
   * 화면 등급 4종. 디자이너 사이드바의 `roles` 필드와 같은 표기다.
   *
   * 서버는 6등급(USER/PRO_USER/SUPPORT/ANALYST/ADMIN/SUPER_ADMIN)을 쓴다.
   * 화면은 4등급으로 묶어 쓰므로 매핑이 필요하다. 매핑을 코드 여러 곳에
   * 흩뿌리지 않고 여기 한 곳에 둔다.
   */
  var TIERS = ['user', 'ops', 'admin', 'super'];

  /**
   * 서버 등급 → 화면 등급.
   *
   * PRO_USER 는 유료 사용자지만 관리 권한은 없다 → user.
   * SUPPORT/ANALYST 는 조회·대응 권한이 있으나 변경 권한은 없다 → ops.
   */
  var SERVER_TO_TIER = {
    USER: 'user',
    PRO_USER: 'user',
    SUPPORT: 'ops',
    ANALYST: 'ops',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super',
    // 구버전 저장값 호환. 서버가 소문자로 주는 경우도 있다.
    user: 'user',
    pro_user: 'user',
    support: 'ops',
    analyst: 'ops',
    admin: 'admin',
    super_admin: 'super',
    ops: 'ops',
    super: 'super',
  };

  /** 등급 서열. 높은 등급은 낮은 등급의 화면을 모두 볼 수 있다. */
  var RANK = { user: 0, ops: 1, admin: 2, super: 3 };

  var state = {
    /** 서버가 확인해 준 사용자. 비로그인 시 null. */
    user: null,
    /** 화면 등급. 비로그인 시 null — 'user' 로 가정하지 않는다. */
    tier: null,
    /** 아직 서버에 물어보지 않았으면 true. 이때는 권한 판단을 미룬다. */
    loading: true,
    /** 백엔드가 없는 정적 프리뷰인지. */
    offline: false,
  };

  var listeners = new Set();

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.warn('[QTAuth] 리스너 오류', e); }
    });
  }

  /**
   * 서버 등급 문자열을 화면 등급으로 바꾼다.
   *
   * 모르는 값이 오면 **가장 낮은 등급**으로 떨어뜨린다. 모르는 값을 관리자로
   * 해석하면 권한 상승이 된다 (fail-safe).
   */
  function toTier(serverRole) {
    if (!serverRole) return null;
    return SERVER_TO_TIER[String(serverRole)] || SERVER_TO_TIER[String(serverRole).toUpperCase()] || 'user';
  }

  /**
   * 서버에 현재 세션을 물어 상태를 갱신한다.
   *
   * 로그인/로그아웃 직후에도 호출해야 한다 — 그러지 않으면 화면이 이전 등급을
   * 계속 들고 있다.
   */
  /**
   * 백엔드가 있는지 요청 없이 판별한다.
   *
   * live-market.js 와 같은 방식을 쓴다 — 백엔드는 HTML 응답에
   * `Server-Timing: qtbackend` 를 붙이고, 그 헤더는 same-origin 에서 추가 요청
   * 없이 읽을 수 있다. 이렇게 하지 않으면 정적 프리뷰에서 /api/auth/me 를 찔러
   * 404 가 콘솔 에러로 남는다 ("콘솔 에러 0" 계약 위반).
   */
  function detectBackend() {
    try {
      var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')) || [];
      var entry = nav[0];
      if (!entry) return false;
      if (typeof entry.serverTiming === 'undefined') return true; // 미지원 브라우저는 확인 요청 허용
      for (var i = 0; i < entry.serverTiming.length; i += 1) {
        if (entry.serverTiming[i].name === 'qtbackend') return true;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  var backendPresent = detectBackend();

  function refresh() {
    if (!backendPresent || !window.QTApi || !window.QTApi.auth) {
      // 정적 프리뷰. 서버가 없으니 등급을 확인할 방법이 없다.
      state.offline = true;
      state.loading = false;
      state.user = null;
      state.tier = null;
      notify();
      return Promise.resolve(null);
    }

    return window.QTApi.auth.me()
      .then(function (user) {
        state.offline = false;
        state.loading = false;
        state.user = user || null;
        state.tier = user ? toTier(user.role) : null;
        notify();
        return user;
      })
      .catch(function (err) {
        // 네트워크 실패는 "권한 없음"과 다르다. 등급을 올리지 않고 비워둔다.
        console.info('[QTAuth] 세션 확인 실패 — 비로그인으로 취급:', err && err.message);
        state.loading = false;
        state.user = null;
        state.tier = null;
        notify();
        return null;
      });
  }

  function logout() {
    if (!window.QTApi || !window.QTApi.auth) return Promise.resolve();
    return window.QTApi.auth.logout()
      .catch(function () { /* 실패해도 로컬 상태는 비운다 */ })
      .then(function () {
        state.user = null;
        state.tier = null;
        notify();
      });
  }

  /**
   * 이 등급이 필요한 화면/버튼을 볼 수 있는가.
   *
   * @param {string[]|string|undefined} allowed 허용 등급 목록. 없으면 누구나 허용.
   */
  function can(allowed) {
    if (!allowed) return true;
    var list = Array.isArray(allowed) ? allowed : [allowed];
    if (list.length === 0) return true;
    if (!state.tier) return false; // 비로그인은 등급 제한이 있는 것을 못 본다
    return list.indexOf(state.tier) !== -1;
  }

  /** 최소 등급 이상인가. `atLeast('admin')` = admin 또는 super. */
  function atLeast(tier) {
    if (!state.tier) return false;
    var need = RANK[tier];
    if (need === undefined) return false;
    return RANK[state.tier] >= need;
  }

  /**
   * 아직 개발되지 않은 기능을 볼 수 있는가.
   *
   * 발주자 방침: 미개발 탭·버튼은 super 와 admin 에게만 보인다.
   * 런칭 후에도 유지한다 — 미완성 화면을 일반 사용자가 열면 신뢰를 잃는다.
   */
  function canSeeUnbuilt() {
    return atLeast('admin');
  }

  window.QTAuth = {
    TIERS: TIERS,
    refresh: refresh,
    logout: logout,
    can: can,
    atLeast: atLeast,
    canSeeUnbuilt: canSeeUnbuilt,
    toTier: toTier,

    /** 현재 상태 스냅샷. 직접 수정하지 말 것. */
    get: function () {
      return { user: state.user, tier: state.tier, loading: state.loading, offline: state.offline };
    },
    getTier: function () { return state.tier; },
    getUser: function () { return state.user; },
    isLoading: function () { return state.loading; },
    isLoggedIn: function () { return Boolean(state.user); },

    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    /**
     * React 훅 — 세션이 바뀌면 컴포넌트를 재렌더한다.
     *
     * 훅을 여기 두는 이유: 세션을 쓰는 화면이 여럿인데(설정·헤더·가드) 각자
     * 구독 코드를 쓰면 해제를 빠뜨려 누수가 나고, 구독을 잊은 화면은 로그인
     * 직후에도 비로그인 상태를 계속 보여준다.
     */
    useAuth: function () {
      var R = window.React;
      var pair = R.useState(function () { return window.QTAuth.get(); });
      var snap = pair[0], setSnap = pair[1];
      R.useEffect(function () {
        // 마운트 시점의 값이 이미 바뀌었을 수 있으므로 한 번 맞춘다.
        setSnap(window.QTAuth.get());
        return window.QTAuth.subscribe(function (st) {
          setSnap({ user: st.user, tier: st.tier, loading: st.loading, offline: st.offline });
        });
      }, []);
      return snap;
    },

    /** 진단용. 콘솔에서 QTAuth.debug() */
    debug: function () {
      return {
        user: state.user ? { id: state.user.id, email: state.user.email, serverRole: state.user.role } : null,
        tier: state.tier,
        loading: state.loading,
        offline: state.offline,
        canSeeUnbuilt: canSeeUnbuilt(),
      };
    },
  };

  // 모듈 로드 시점에 세션을 확인한다.
  //
  // 화면이 그려지기 전에 등급을 알아야 한다. 늦으면 권한 없는 메뉴가 한 번
  // 번쩍 보이고 사라진다 (사용자에게는 버그로 보인다).
  refresh();
})();
