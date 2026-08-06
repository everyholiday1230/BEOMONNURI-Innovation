/* ============================================================
   계정 데이터 — 실 잔고 / 실 포지션
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   설계 원칙
   --------
   1) 목업과 **같은 형태**로 돌려준다. 화면 코드를 고치지 않기 위해서다.
      (디자이너 산출물 불가침)

   2) 실데이터가 없으면 목업을 유지하되 **사실을 표시한다.**
      빈 배열을 돌려주면 "포지션이 없다", 0 을 돌려주면 "잔고가 0" 으로 읽힌다.
      둘 다 거짓이고, 사용자는 자금이 사라진 줄 안다. 그래서 상태를 함께 준다:
        NONE      키를 연결하지 않았다
        FAILED    키가 있으나 거래소가 거부했다
        VERIFIED  실데이터다
        ERROR     조회에 실패했다 (네트워크·거래소 장애)

   3) 조회 실패를 성공으로 위장하지 않는다. 화면이 "확인 불가" 를 보여줘야 한다.

   왜 폴링인가
   ----------
   잔고·포지션은 개인 데이터다. 지금 WS 게이트웨이(/ws)에는 인증이 없고
   공개 시세만 흐른다. 인증 없는 채널로 개인 데이터를 흘리면 다른 사용자에게
   보일 수 있다. 세션 인증을 붙이기 전까지는 REST 폴링을 쓴다.
   ============================================================ */

(function () {
  'use strict';

  /** 폴링 주기. 포지션은 손익이 계속 변하므로 시세보다 느리게, 그러나 충분히 자주. */
  var POLL_MS = 8000;

  var state = {
    /** 'NONE' | 'FAILED' | 'VERIFIED' | 'ERROR' | 'OFFLINE' | 'UNAUTHENTICATED' */
    status: 'OFFLINE',
    balances: [],
    positions: [],
    /** 마지막 성공 조회 시각. 오래되면 화면이 그 사실을 보여줄 수 있다. */
    asOf: null,
    /** 조회 실패 이유. 사용자에게 보여줄 문구를 만들 근거. */
    error: null,
    /** 값이 바뀔 때마다 증가. React 가 재렌더 트리거로 쓴다. */
    version: 0,
  };

  var listeners = new Set();
  var timer = null;
  var started = false;

  function bump() {
    state.version += 1;
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.warn('[QTAccount] 리스너 오류', e); }
    });
  }

  function backendReady() {
    return Boolean(window.QTApi && window.QTApi.credentials && window.QTAuth && window.QTAuth.isLoggedIn());
  }

  /**
   * 거래소 잔고 → 화면 자산 배분 형태.
   *
   * 목업(QTApp.ALLOCATION)은 { asset, value, pct, chg24h } 를 쓴다.
   * pct 는 합계 대비 비율이므로 여기서 계산한다.
   *
   * chg24h 는 거래소 잔고에 없는 정보다. 없는 값을 0 으로 채우면 "변동 없음"
   * 이라는 거짓이 되므로 undefined 로 둔다 — 화면은 값이 없으면 표시를 생략한다.
   */
  function toAllocation(balances) {
    if (!Array.isArray(balances) || balances.length === 0) return [];

    var rows = balances
      .map(function (b) {
        return {
          asset: b.asset,
          value: Number(b.equity),
          available: Number(b.available),
          used: Number(b.used),
        };
      })
      .filter(function (r) { return Number.isFinite(r.value); });

    var total = rows.reduce(function (a, r) { return a + r.value; }, 0);
    return rows.map(function (r) {
      return {
        asset: r.asset,
        value: r.value,
        // 총액이 0 이면 비율을 만들 수 없다. 0 으로 나누면 NaN 이 화면에 뜬다.
        pct: total > 0 ? Math.round((r.value / total) * 1000) / 10 : 0,
        chg24h: undefined,
        available: r.available,
        used: r.used,
      };
    });
  }

  /**
   * 거래소 포지션 → 화면 포지션 형태.
   *
   * 목업이 쓰는 필드를 그대로 채운다. 계산할 수 없는 값은 undefined 로 둔다:
   * 잘못된 숫자를 보여주는 것보다 빈 칸이 낫다. tp/sl 은 별도 주문이라
   * 포지션 응답에 없다.
   */
  function toUiPositions(positions) {
    if (!Array.isArray(positions)) return [];

    return positions
      .map(function (p, i) {
        var size = Number(p.size);
        var entry = Number(p.entryPrice);
        var mark = Number(p.markPrice);
        var pnl = Number(p.unrealizedPnl);
        var margin = Number(p.positionMargin !== undefined ? p.positionMargin : p.margin);

        // 수량을 못 구하면 행을 만들지 않는다. 수량 없는 포지션 행은
        // 화면에서 계산이 전부 어긋난다 (어댑터가 승수를 모를 때 빈 값이 온다).
        if (!Number.isFinite(size) || size === 0) return null;

        return {
          id: p.id || (p.symbol + '-' + p.side + '-' + i),
          symbol: p.symbol,
          type: 'PERP',
          side: p.side === 'short' ? 'short' : 'long',
          size: Math.abs(size),
          entry: Number.isFinite(entry) ? entry : undefined,
          mark: Number.isFinite(mark) ? mark : undefined,
          liq: Number.isFinite(Number(p.liquidationPrice)) ? Number(p.liquidationPrice) : undefined,
          margin: Number.isFinite(margin) ? margin : undefined,
          // 증거금률은 거래소가 주지 않는다. 증거금과 손익으로 추정하면 틀릴 수 있어 비운다.
          marginRatio: undefined,
          leverage: Number(p.leverage) || undefined,
          unPnl: Number.isFinite(pnl) ? pnl : undefined,
          // 수익률 = 손익 / 증거금. 증거금이 0 이면 계산 불가.
          unPnlPct:
            Number.isFinite(pnl) && Number.isFinite(margin) && margin > 0
              ? Math.round((pnl / margin) * 10000) / 100
              : undefined,
          rlzPnl: Number.isFinite(Number(p.realizedPnl)) ? Number(p.realizedPnl) : 0,
          tp: undefined,
          sl: undefined,
          adl: undefined,
          mode: (p.marginMode || 'isolated').toUpperCase() === 'CROSS' ? 'CROSS' : 'ISOLATED',
          /** 실데이터임을 표시한다. 화면이 목업과 구분할 수 있다. */
          isLive: true,
        };
      })
      .filter(Boolean);
  }

  function applyToMockGlobals() {
    // 화면 코드는 window.QT.POSITIONS / window.QTApp.ALLOCATION 을 읽는다.
    // 실데이터가 있으면 그 자리를 바꿔치기한다 — 화면 코드를 고치지 않기 위해서다.
    //
    // 목업을 지우지 않고 보관한다. 실데이터가 끊겼을 때 되돌려야 하고,
    // 정적 프리뷰에서는 목업이 그대로 필요하다.
    if (state.status !== 'VERIFIED') return;

    if (window.QT && state.positions.length > 0) {
      if (!window.QT.__mockPositions) window.QT.__mockPositions = window.QT.POSITIONS;
      window.QT.POSITIONS = state.positions;
    }
    if (window.QTApp && state.balances.length > 0) {
      if (!window.QTApp.__mockAllocation) window.QTApp.__mockAllocation = window.QTApp.ALLOCATION;
      window.QTApp.ALLOCATION = toAllocation(state.balances);
    }
  }

  /** 목업으로 되돌린다. 로그아웃·키 삭제 시 이전 사용자의 값이 남지 않게. */
  function restoreMocks() {
    if (window.QT && window.QT.__mockPositions) window.QT.POSITIONS = window.QT.__mockPositions;
    if (window.QTApp && window.QTApp.__mockAllocation) window.QTApp.ALLOCATION = window.QTApp.__mockAllocation;
  }

  function poll() {
    if (!backendReady()) {
      var next = window.QTAuth && !window.QTAuth.isLoggedIn() ? 'UNAUTHENTICATED' : 'OFFLINE';
      if (state.status !== next) {
        state.status = next;
        state.balances = [];
        state.positions = [];
        restoreMocks();
        bump();
      }
      return Promise.resolve();
    }

    return Promise.all([
      window.QTApi.credentials.balances().catch(function (e) { return { __err: e }; }),
      window.QTApi.credentials.positions().catch(function (e) { return { __err: e }; }),
    ]).then(function (res) {
      var bRes = res[0];
      var pRes = res[1];
      var firstErr = (bRes && bRes.__err) || (pRes && pRes.__err) || null;

      if (firstErr) {
        // 502 = 거래소 조회 실패(키 오류·장애). 잔고를 0 으로 만들지 않는다.
        state.status = firstErr.status === 401 ? 'UNAUTHENTICATED' : 'ERROR';
        state.error = firstErr.message || null;
        restoreMocks();
        bump();
        return;
      }

      var balances = (bRes && bRes.data) || [];
      var positions = (pRes && pRes.data) || [];

      /*
         응답은 200 이지만 실데이터가 아닌 경우가 있다.
           NONE    키를 연결하지 않았다
           FAILED  키가 있으나 거래소가 거부했다 (사용자가 고칠 수 있는 상태)
         서버가 이 둘을 200 + credentialStatus 로 준다 — 502 로 주면 정상 사용
         중에도 브라우저 콘솔에 오류가 계속 찍힌다.
      */
      var credStatus = (bRes && bRes.credentialStatus) || (pRes && pRes.credentialStatus) || null;
      if (credStatus && credStatus !== 'VERIFIED') {
        state.status = credStatus;
        state.balances = [];
        state.positions = [];
        state.error = (bRes && bRes.reason) || (pRes && pRes.reason) || null;
        restoreMocks();
        bump();
        return;
      }
      // 상태를 알 수 없는데 데이터도 없으면 실데이터라고 주장하지 않는다.
      if (!credStatus && balances.length === 0 && positions.length === 0) {
        state.status = 'NONE';
        state.balances = [];
        state.positions = [];
        state.error = null;
        restoreMocks();
        bump();
        return;
      }

      state.status = 'VERIFIED';
      state.error = null;
      state.balances = balances;
      state.positions = toUiPositions(positions);
      state.asOf = Date.now();
      applyToMockGlobals();
      bump();
    });
  }

  function start() {
    if (started) return;
    started = true;
    poll();
    timer = setInterval(poll, POLL_MS);

    // 로그인·로그아웃 시 즉시 갱신한다. 폴링을 기다리면 이전 사용자의 잔고가
    // 최대 8초간 화면에 남는다.
    if (window.QTAuth && window.QTAuth.subscribe) {
      window.QTAuth.subscribe(function () { poll(); });
    }
  }

  function stop() {
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  window.QTAccount = {
    start: start,
    stop: stop,
    refresh: poll,

    getStatus: function () { return state.status; },
    getBalances: function () { return state.balances.slice(); },
    getPositions: function () { return state.positions.slice(); },
    getAllocation: function () { return toAllocation(state.balances); },
    getError: function () { return state.error; },
    getAsOf: function () { return state.asOf; },
    isLive: function () { return state.status === 'VERIFIED'; },

    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    /** 변환기를 노출한다. 테스트와 화면에서 재사용한다. */
    convert: { allocation: toAllocation, positions: toUiPositions },

    /** 진단용. 콘솔에서 QTAccount.debug() */
    debug: function () {
      return {
        status: state.status,
        error: state.error,
        balances: state.balances.length,
        positions: state.positions.length,
        asOf: state.asOf ? new Date(state.asOf).toISOString() : null,
        version: state.version,
      };
    },
  };

  // 백엔드와 세션이 준비되면 폴링을 시작한다. 준비 전에는 아무 요청도 하지 않는다
  // (정적 프리뷰에서 404 가 콘솔 에러로 남는 것을 막는다).
  start();
})();
