/**
 * 즐겨찾기(워치리스트).
 *
 * 무엇을 하는가
 * -----------
 * 사용자가 ★ 를 누른 심볼 목록을 기억한다. 화면 여러 곳(심볼 헤더, 마켓
 * 워치리스트, 마켓 페이지)이 같은 목록을 보고 같은 상태를 그려야 한다.
 *
 * 왜 별 모듈인가
 * ------------
 * 컴포넌트마다 localStorage 를 직접 읽으면 세 가지가 깨진다:
 *   1. 한 곳에서 토글해도 다른 곳이 갱신되지 않는다(구독이 없다).
 *   2. 저장 키가 조금씩 달라져 목록이 갈라진다.
 *   3. 잘못된 저장값(문자열·null)에 대한 방어가 곳마다 다르다.
 *
 * ★ 저장 위치의 한계
 * ----------------
 * localStorage 는 **기기별**이다. 다른 기기·브라우저에서는 목록이 보이지 않고,
 * 브라우저 데이터를 지우면 사라진다. 서버 계정 동기화가 있어야 진짜 "내 목록"
 * 이 되지만, 그 API 가 아직 없다. 있는 척하지 않고 화면 안내에 명시한다.
 * 서버가 준비되면 load/save 두 함수만 교체하면 된다.
 */
(function () {
  'use strict';

  var KEY = 'qt.favorites.v1';

  /** 심볼 표기를 하나로 맞춘다. 'btc/usdt' 와 'BTCUSDT' 가 다른 항목이 되면 안 된다. */
  function normalize(symbol) {
    if (!symbol) return '';
    return String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /*
     저장값 읽기.

     JSON.parse 는 손상된 값에 예외를 던진다. 즐겨찾기 하나 때문에 화면 전체가
     죽으면 안 되므로 실패하면 빈 목록으로 시작한다.
     배열이 아닌 값(과거 형식·수동 편집)도 빈 목록으로 본다.
  */
  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // 문자열만 남기고 정규화, 중복 제거.
      var seen = Object.create(null);
      var out = [];
      for (var i = 0; i < parsed.length; i += 1) {
        var sym = normalize(parsed[i]);
        if (sym && !seen[sym]) { seen[sym] = true; out.push(sym); }
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  var items = load();
  var listeners = new Set();

  function notify() {
    listeners.forEach(function (fn) {
      // 한 구독자의 예외가 나머지 갱신을 막지 않는다.
      try { fn(items.slice()); } catch (e) { /* 무시 */ }
    });
  }

  function persist() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {
      /*
         저장 실패(용량 초과·사생활 보호 모드)를 삼킨다.

         화면의 ★ 는 이미 켜졌고 이번 세션에서는 동작한다. 여기서 예외를 던지면
         별을 누른 순간 화면이 죽는다. 다음 방문에 사라지는 것이 더 나은 실패다.
      */
    }
    pushToServer();
  }

  /*
     서버 동기화.

     ★★ 왜 필요한가

       localStorage 는 **기기별**이다. 휴대폰에서 즐겨찾기를 등록하고 컴퓨터에서
       열면 목록이 비어 있다. 사용자는 자기가 등록한 것이 사라졌다고 본다.

       서버에는 이미 저장 경로가 있었다(`/api/me/favorites`, `user_favorites`
       테이블). 그런데 화면이 그것을 호출하지 않아서 테이블이 계속 비어 있었다 —
       기능이 반쯤 만들어진 상태로 남아 있던 것이다.

     ★ 서버 저장이 실패해도 화면은 그대로 둔다. 로컬에는 이미 반영됐고, 별이
       다시 꺼지면 사용자는 자기 동작이 취소된 줄 안다.
  */
  var syncTimer = null;

  function pushToServer() {
    var api = window.QTApi && window.QTApi.rest;
    if (!api || !api.saveFavorites) return;
    // 백엔드가 없는 미리보기에서는 시도하지 않는다 (콘솔 404 방지).
    if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return;
    /*
       로그인하지 않았으면 보내지 않는다.

       로그인 전에도 별을 누를 수 있다(랜딩·시세 화면). 그때 보내면 401 이 쌓이고,
       목록은 로컬에 남아 로그인 후 첫 동기화에서 올라간다.
    */
    var auth = window.QTAuth;
    if (!auth || !auth.isLoggedIn || !auth.isLoggedIn()) return;

    /*
       연속 클릭을 묶어서 한 번만 보낸다.

       별을 빠르게 여러 개 누르면 매번 PUT 을 보내게 되고, 순서가 뒤바뀌면
       나중 요청이 이전 목록을 덮어쓴다.
    */
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      api.saveFavorites(items.slice()).catch(function () {
        /* 서버 저장 실패를 화면에 되돌리지 않는다 (위 주석 참고) */
      });
    }, 400);
  }

  /**
   * 서버 목록을 불러와 합친다.
   *
   * ★ 서버 값으로 **덮어쓰지 않고 합친다.** 이 기기에서 방금 추가한 것이 아직
   *   서버에 올라가지 않았을 수 있는데, 덮어쓰면 그것이 사라진다.
   *
   * ★ 로그인 직후에 호출한다. 로그인하지 않은 상태에서는 서버에 목록이 없다.
   */
  function pullFromServer() {
    var api = window.QTApi && window.QTApi.rest;
    if (!api || !api.favorites) return Promise.resolve(items.slice());
    if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
      return Promise.resolve(items.slice());
    }
    /*
       ★ 로그인 여부를 먼저 본다.

         로그인 화면에서도 이 함수가 호출되는데, 그때 요청을 보내면 401 이
         콘솔에 쌓인다. 기능은 멀쩡하지만 콘솔이 잡음으로 차면 진짜 장애를
         찾을 때 놓친다 — 실제로 검증 스크립트가 전 라우트를 실패로 판정했다.

       ★ 아직 판정 중(loading)일 때도 보내지 않는다. 곧 subscribe 가 다시 부른다.
    */
    var auth = window.QTAuth;
    if (!auth || !auth.isLoggedIn || !auth.isLoggedIn()) return Promise.resolve(items.slice());
    return api.favorites().then(function (r) {
      var remote = (r && r.symbols) || [];
      if (!remote.length) {
        // 서버가 비어 있으면 이 기기의 목록을 올린다 (첫 동기화).
        if (items.length) pushToServer();
        return items.slice();
      }
      var seen = Object.create(null);
      var merged = [];
      // 이 기기 목록을 먼저 둔다 — 방금 누른 것이 위에 오는 편이 자연스럽다.
      items.concat(remote).forEach(function (x) {
        var sym = normalize(x);
        if (sym && !seen[sym]) { seen[sym] = true; merged.push(sym); }
      });
      var changed = merged.length !== items.length;
      items = merged;
      try { window.localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* 위 참고 */ }
      if (changed) { notify(); pushToServer(); }
      return items.slice();
    }).catch(function () {
      // 조회 실패를 빈 목록으로 위장하지 않는다 — 이 기기 목록을 그대로 쓴다.
      return items.slice();
    });
  }

  window.QTFavorites = {
    /** 현재 목록 (정규화된 심볼 배열). 복사본이라 외부에서 바꿔도 안전하다. */
    all: function () { return items.slice(); },

    /**
     * 서버와 합친다. 로그인 직후에 부른다.
     *
     * 기기별 localStorage 만 쓰면 다른 기기에서 목록이 비어 보인다.
     */
    sync: pullFromServer,

    has: function (symbol) {
      var sym = normalize(symbol);
      return Boolean(sym) && items.indexOf(sym) !== -1;
    },

    add: function (symbol) {
      var sym = normalize(symbol);
      if (!sym || items.indexOf(sym) !== -1) return false;
      // 최근에 추가한 것을 앞에 둔다 — 워치리스트에서 바로 보인다.
      items.unshift(sym);
      persist();
      notify();
      return true;
    },

    remove: function (symbol) {
      var sym = normalize(symbol);
      var i = items.indexOf(sym);
      if (i === -1) return false;
      items.splice(i, 1);
      persist();
      notify();
      return true;
    },

    /** 켜져 있으면 끄고, 꺼져 있으면 켠다. 켜진 뒤 상태를 돌려준다. */
    toggle: function (symbol) {
      var sym = normalize(symbol);
      if (!sym) return false;
      if (items.indexOf(sym) === -1) { this.add(sym); return true; }
      this.remove(sym);
      return false;
    },

    /** 변경 구독. 해제 함수를 돌려준다. */
    subscribe: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    /**
     * React 훅 — 목록이 바뀌면 컴포넌트를 재렌더한다.
     *
     * 훅을 여기 두는 이유: 즐겨찾기를 쓰는 화면이 여럿인데 각자 구독 코드를
     * 쓰면 해제를 빠뜨려 누수가 난다.
     */
    useFavorites: function () {
      var R = window.React;
      var pair = R.useState(items.slice());
      var list = pair[0], setList = pair[1];
      R.useEffect(function () {
        return window.QTFavorites.subscribe(function (next) { setList(next); });
      }, []);
      return list;
    },

    /** 저장이 기기별이라는 사실. 화면이 안내 문구를 고를 때 쓴다. */
    isDeviceLocal: function () { return true; },

    normalize: normalize,

    debug: function () { return { key: KEY, count: items.length, items: items.slice() }; },
  };

  /*
     다른 탭에서의 변경을 반영한다.

     같은 사용자가 탭 두 개를 열어두는 일은 흔하다. 한쪽에서 ★ 를 눌렀는데
     다른 쪽이 옛 목록을 보여주면, 거기서 토글할 때 방금 한 변경을 덮어쓴다.
  */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    items = load();
    notify();
  });

  /*
     로그인 상태가 바뀌면 서버와 합친다.

     ★ 로그인 직후에 불러야 한다. 그 전에는 서버에 이 사용자의 목록이 없다.
     ★ 로그아웃 시에도 호출되지만, 그때는 서버가 401 을 주고 catch 에서
       이 기기 목록을 그대로 쓴다 — 목록을 지우지 않는다. 로그아웃했다고
       즐겨찾기가 사라지면 사용자는 데이터를 잃었다고 본다.

     다른 모듈(account-data.js · admin-data.js)이 쓰는 것과 같은 구독 방식이다.
  */
  if (window.QTAuth && window.QTAuth.subscribe) {
    window.QTAuth.subscribe(function () { pullFromServer(); });
  }
  /*
     이미 로그인된 상태로 화면이 열리는 경우(새로고침).

     ★ `get()` 은 로그인하지 않아도 객체를 돌려준다 — 그래서 항상 참이었다.
       `isLoggedIn()` 을 써야 한다.
  */
  if (window.QTAuth && window.QTAuth.isLoggedIn && window.QTAuth.isLoggedIn()) {
    pullFromServer();
  }
})();
