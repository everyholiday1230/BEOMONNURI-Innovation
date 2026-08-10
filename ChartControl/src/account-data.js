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
    /** 미체결 주문 */
    openOrders: [],
    /** 완료·취소된 주문 */
    orderHistory: [],
    /** 체결 내역 */
    fills: [],
    /** 자금 이동 내역 */
    transactions: [],
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

/**
   * 거래소 주문 → 화면 주문.
   *
   * 목업(QT.OPEN_ORDERS)이 쓰는 필드를 그대로 채운다:
   *   { id, symbol, side, type, price, avgPrice, amount, filled, remaining, trigger, time, status }
   *
   * 수량이 빈 값이면 행을 만들지 않는다 — 어댑터가 계약 승수를 모를 때 발생하고,
   * 수량 없는 주문 행은 화면 계산이 전부 어긋난다.
   */
  function toUiOrders(rows) {
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length; i += 1) {
      var o = rows[i];
      var amount = Number(o.quantity);
      var filled = Number(o.filledQuantity);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!Number.isFinite(filled)) filled = 0;

      out.push({
        id: o.exchangeOrderId || o.clientOrderId || (o.symbol + '-' + i),
        /*
           취소는 clientOrderId 로 한다. 거래소 내부 id 는 거래소를 바꾸면
           의미가 없어지고, 우리가 발급한 키만 우리 쪽에서 재현할 수 있다.
           이 값이 없으면 취소 버튼이 동작하지 않는다.
        */
        clientOrderId: o.clientOrderId || null,
        exchangeOrderId: o.exchangeOrderId || null,
        symbol: o.symbol,
        side: o.side === 'short' ? 'short' : 'long',
        type: String(o.type || '').toUpperCase(),
        /*
           시장가 주문은 지정가가 없다.

           null/undefined/빈문자열/0 을 모두 "가격 없음" 으로 본다.
           Number(null) 은 0 이고 Number.isFinite(0) 은 true 이므로, 앞선 검사만으로는
           시장가 주문이 '0.000' 으로 표시됐다(실제로 확인했다).
           선물 가격이 0 인 주문은 존재하지 않으므로 0 도 없음으로 취급한다.
        */
        price: (function () {
          if (o.price === null || o.price === undefined || o.price === '') return null;
          var n = Number(o.price);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        avgPrice: null,
        amount: amount,
        filled: filled,
        remaining: Math.max(0, amount - filled),
        trigger: null,
        time: Number(o.createdAt) || Date.now(),
        status: String(o.status || 'open'),
        isLive: true,
      });
    }
    return out;
  }

  /**
   * 체결 → 화면 체결.
   * 수수료 부호를 보존한다. 메이커 리베이트는 음수이고, 절대값으로 바꾸면
   * 받은 돈이 나간 돈으로 보인다.
   */
  function toUiFills(rows) {
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length; i += 1) {
      var f = rows[i];
      var qty = Number(f.quantity);
      var price = Number(f.price);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) continue;
      out.push({
        id: f.id || (f.orderId + '-' + i),
        orderId: f.orderId,
        symbol: f.symbol,
        side: f.side === 'short' ? 'short' : 'long',
        price: price,
        amount: qty,
        fee: Number(f.fee) || 0,
        feeCurrency: f.feeCurrency || 'USDT',
        liquidity: f.liquidity || '',
        time: Number(f.ts) || 0,
        isLive: true,
      });
    }
    return out;
  }

  /** 자금 이동 → 화면 내역. */
  function toUiTransactions(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map(function (r) {
        var amount = Number(r.amount);
        if (!Number.isFinite(amount)) return null;
        return {
          id: r.id,
          kind: r.kind || 'UNKNOWN',
          rawType: r.rawType || '',
          symbol: r.symbol || null,
          amount: amount,
          asset: r.asset || 'USDT',
          time: Number(r.time) || 0,
          isLive: true,
        };
      })
      .filter(Boolean);
  }

/**
   * 실현손익 기록 → 거래 분석용 목록.
   *
   * 왜 체결(fills)로 손익을 계산하지 않는가
   * -------------------------------------
   * 체결만으로 손익을 구하려면 진입·청산을 짝지어야 하고, 부분 체결·평균단가·
   * 수수료·펀딩비를 우리가 다시 계산해야 한다. 거래소가 이미 계산해 둔 값과
   * 어긋나면 사용자는 어느 쪽을 믿어야 할지 알 수 없다.
   *
   * 그래서 원장의 REALIZED_PNL 항목을 권위 있는 출처로 쓴다. 거래소가 확정한
   * 금액이고, 우리가 다시 계산하지 않는다.
   *
   * ★ 진입가·청산가는 원장에 없다. 만들어 넣지 않는다 — 화면이 '—' 를 표시한다.
   */
  function toUiJournal(transactions) {
    if (!Array.isArray(transactions)) return [];
    return transactions
      .filter(function (x) { return x.kind === 'REALIZED_PNL'; })
      .map(function (x) {
        var pnl = Number(x.amount);
        if (!Number.isFinite(pnl)) return null;
        return {
          id: x.id,
          // 화면 표가 쓰는 필드 이름에 맞춘다.
          date: x.time ? new Date(x.time).toISOString().slice(0, 10) : null,
          time: x.time || 0,
          sym: x.symbol ? String(x.symbol).replace('USDT', '/USDT') : '—',
          // 방향은 원장에 없다. 손익 부호로 추측하면 틀린다(숏도 이익이 날 수 있다).
          side: null,
          entry: null,
          exit: null,
          size: null,
          pnl: pnl,
          // 수익률도 투입 자본을 알아야 구할 수 있다. 원장에는 없다.
          roi: null,
          mood: null,
          tag: [],
          isLive: true,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) { return b.time - a.time; });
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
    /*
       미체결 주문은 **0건도 사실**이다. 포지션과 다르게 처리한다.
       검증된 키가 있는데 미체결이 0건이면 "주문 없음" 이 맞고, 그때 목업을
       남겨두면 없는 주문이 화면에 보인다.
    */
    if (window.QT) {
      if (!window.QT.__mockOpenOrders) window.QT.__mockOpenOrders = window.QT.OPEN_ORDERS;
      window.QT.OPEN_ORDERS = state.openOrders;
    }
    if (window.QTApp && state.balances.length > 0) {
      if (!window.QTApp.__mockAllocation) window.QTApp.__mockAllocation = window.QTApp.ALLOCATION;
      window.QTApp.ALLOCATION = toAllocation(state.balances);
    }
  }

  /** 목업으로 되돌린다. 로그아웃·키 삭제 시 이전 사용자의 값이 남지 않게. */
  function restoreMocks() {
    if (window.QT && window.QT.__mockPositions) window.QT.POSITIONS = window.QT.__mockPositions;
    if (window.QT && window.QT.__mockOpenOrders) window.QT.OPEN_ORDERS = window.QT.__mockOpenOrders;
    if (window.QTApp && window.QTApp.__mockAllocation) window.QTApp.ALLOCATION = window.QTApp.__mockAllocation;
  }

  function poll() {
    if (!backendReady()) {
      /*
         백엔드 없음과 비로그인은 다른 사실이다.

         정적 프리뷰(백엔드 없음)에서 "로그인하면 내 계정이 표시됩니다" 를 보여주면
         사용자가 로그인을 시도하고, 로그인할 곳이 없어 혼란스럽다.
         백엔드 유무를 먼저 본다.
      */
      var offline = window.QTAuth ? window.QTAuth.get().offline : true;
      var next = offline
        ? 'OFFLINE'
        : (window.QTAuth && !window.QTAuth.isLoggedIn() ? 'UNAUTHENTICATED' : 'OFFLINE');
      if (state.status !== next) {
        state.status = next;
        state.balances = [];
        state.positions = [];
        restoreMocks();
        bump();
      }
      return Promise.resolve();
    }

    var C = window.QTApi.credentials;
    /*
       6개 조회를 병렬로 보낸다.

       순차로 보내면 8초 주기 안에 끝나지 않을 수 있고, 화면 일부만 갱신된
       어긋난 상태가 보인다. 개별 실패는 각자 잡아 다른 조회를 막지 않는다 —
       주문 조회가 실패해도 잔고는 보여야 한다.
    */
    return Promise.all([
      C.balances().catch(function (e) { return { __err: e }; }),
      C.positions().catch(function (e) { return { __err: e }; }),
      C.openOrders().catch(function (e) { return { __err: e }; }),
      C.orderHistory().catch(function (e) { return { __err: e }; }),
      C.fills().catch(function (e) { return { __err: e }; }),
      C.transactions().catch(function (e) { return { __err: e }; }),
    ]).then(function (res) {
      var bRes = res[0];
      var pRes = res[1];
      var oRes = res[2];
      var hRes = res[3];
      var fRes = res[4];
      var tRes = res[5];
      // 잔고·포지션 실패만 전체 상태를 좌우한다. 나머지는 부가 정보다.
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
        state.openOrders = [];
        state.orderHistory = [];
        state.fills = [];
        state.transactions = [];
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
      // 개별 실패는 빈 배열이 아니라 이전 값을 유지한다 — 한 번의 네트워크
      // 오류로 화면의 주문 목록이 사라지면 사용자가 주문이 취소된 줄 안다.
      if (oRes && !oRes.__err) state.openOrders = toUiOrders(oRes.data);
      if (hRes && !hRes.__err) state.orderHistory = toUiOrders(hRes.data);
      if (fRes && !fRes.__err) state.fills = toUiFills(fRes.data);
      if (tRes && !tRes.__err) state.transactions = toUiTransactions(tRes.data);
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
    getOpenOrders: function () { return state.openOrders.slice(); },
    getOrderHistory: function () { return state.orderHistory.slice(); },
    getFills: function () { return state.fills.slice(); },
    getTransactions: function () { return state.transactions.slice(); },
    /** 실현손익 기록. 거래 분석 화면이 쓴다. */
    getJournal: function () { return toUiJournal(state.transactions); },
    getAllocation: function () { return toAllocation(state.balances); },
    getError: function () { return state.error; },
    getAsOf: function () { return state.asOf; },
    isLive: function () { return state.status === 'VERIFIED'; },

    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    /** 변환기를 노출한다. 테스트와 화면에서 재사용한다. */
    convert: { allocation: toAllocation, positions: toUiPositions, orders: toUiOrders, fills: toUiFills, transactions: toUiTransactions, journal: toUiJournal },

    /** 진단용. 콘솔에서 QTAccount.debug() */
    debug: function () {
      return {
        status: state.status,
        error: state.error,
        balances: state.balances.length,
        positions: state.positions.length,
        openOrders: state.openOrders.length,
        orderHistory: state.orderHistory.length,
        fills: state.fills.length,
        transactions: state.transactions.length,
        asOf: state.asOf ? new Date(state.asOf).toISOString() : null,
        version: state.version,
      };
    },
  };

  // 백엔드와 세션이 준비되면 폴링을 시작한다. 준비 전에는 아무 요청도 하지 않는다
  // (정적 프리뷰에서 404 가 콘솔 에러로 남는 것을 막는다).
  start();
})();
