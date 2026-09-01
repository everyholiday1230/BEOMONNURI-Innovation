/* ============================================================
   거래 모드 (현물 / 선물 / 모의)
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   세 모드의 실제 상태
   -----------------
   futures  KuCoin USDT 무기한 선물. 시세·주문 모두 실제로 동작한다.
   paper    모의 거래. 주문이 거래소로 나가지 않고 서버가 시뮬레이션 체결한다.
            시세는 실제다 — 가짜 가격으로 연습하면 의미가 없기 때문이다.
   spot     현물. **아직 지원하지 않는다.** 현물 어댑터가 없다.

   왜 spot 을 버튼만 두고 막는가
   ---------------------------
   버튼을 지우지 않는 것이 디자이너 산출물 계약이다. 대신 누르면 왜 안 되는지
   분명히 알린다 — 눌러도 아무 일 없는 상태로 두면 사용자는 고장이라고 생각한다.

   ★ 모드는 화면 표시가 아니라 **주문 경로**를 바꾼다.
   paper 에서 실주문이 나가면 사용자가 연습이라고 믿고 실제 손실을 본다.
   그래서 주문 제출 시 모드를 다시 확인한다(단일 지점: getOrderPath).
   ============================================================ */

(function () {
  'use strict';

  var STORAGE_KEY = 'qt.tradeMode';

  /**
   * 모드 정의.
   *
   * available: false 인 모드는 선택할 수 없다. 목록에서 지우지 않는 이유는
   * 나중에 구현될 것이고, 사용자에게 "준비 중" 임을 알리는 것이 낫기 때문이다.
   */
  var MODES = {
    spot: {
      id: 'spot',
      /*
         ★ 현물은 시세와 **주문 모두** 지원한다.

           시세: KuCoin 현물 공개 API(api.kucoin.com)로 심볼·캔들·티커를 받는다.
           주문: KucoinSpotTradingAdapter → api.kucoin.com `/api/v1/hf/orders`.
                 선물과는 **다른 어댑터·다른 호스트**다. 어느 쪽으로 나가는지는
                 요청의 `market` 필드가 정한다.

         ★★ 이 주석은 한때 "현물은 시세만 지원하고 orderPath 는 null 이다" 라고
           적혀 있었는데, 바로 아래 값은 그때도 'live' 였다. 실제로 고객의 현물
           주문이 거래소까지 가서 거부된 기록이 있다(Balance insufficient!).
           주석이 코드와 반대를 말하고 있었던 것이다. 이 상태가 위험한 이유는,
           읽는 사람이 "현물은 주문이 안 나간다" 고 믿고 판단하거나 orderPath 를
           null 로 "되돌려" 현물 거래를 끊어버릴 수 있기 때문이다.

         ★ available(시세 지원)과 orderPath(주문 지원)는 여전히 별개 개념이다.
           orderPath 가 null 이면 주문은 getOrderPath() 한 곳에서 반드시 막힌다.
      */
      available: true,
      reasonKey: null,
      /*
         주문 경로.

         ★ 현물 주문 어댑터가 붙었다(KucoinSpotTradingAdapter). 경로는 선물과
           같은 'live' 다 — 주문이 거래소로 실제로 나간다는 뜻이고, 어느 시장으로
           나가는지는 요청의 `market` 필드가 정한다.

         ★★ 그래도 실제 전송은 여러 겹의 잠금을 통과해야 한다:
             FEATURE_LIVE_ORDERS_ENABLED · 킬스위치 해제 · 리스크 게이트 통과 ·
             자격증명 검증. 기본 배포는 전부 잠겨 있다.
      */
      orderPath: 'live',
    },
    futures: {
      id: 'futures',
      available: true,
      reasonKey: null,
      // 실주문 경로. 킬스위치·리스크 게이트를 모두 통과해야 실제로 나간다.
      orderPath: 'live',
    },
    paper: {
      id: 'paper',
      available: true,
      reasonKey: null,
      // 시뮬레이션 경로. 거래소로 나가지 않는다.
      orderPath: 'sim',
    },
  };

  /** 기본 모드. 모의로 시작하지 않는다 — 실거래 화면임을 분명히 한다. */
  var DEFAULT_MODE = 'futures';

  var current = DEFAULT_MODE;
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    // 저장된 값이 지금 사용 가능한 모드인지 확인한다. 예전에 저장된 'spot' 이
    // 그대로 살아나면 주문 경로가 없는 상태로 화면이 열린다.
    if (saved && MODES[saved] && MODES[saved].available) current = saved;
  } catch (e) { /* 저장소 접근 불가는 치명적이지 않다 */ }

  var listeners = new Set();

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(current); } catch (e) { console.warn('[QTMode] 리스너 오류', e); }
    });
  }

  /**
   * 모드 변경.
   *
   * @returns {{ok:boolean, reasonKey?:string}} 실패하면 이유 키를 돌려준다.
   *          호출자가 사용자에게 알려야 한다 — 조용히 무시하면 고장으로 보인다.
   */
  function setMode(id) {
    var m = MODES[id];
    if (!m) return { ok: false, reasonKey: 'mode_unknown' };
    if (!m.available) return { ok: false, reasonKey: m.reasonKey };
    if (current === id) return { ok: true };

    current = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* noop */ }
    notify();
    return { ok: true };
  }

  /**
   * 지금 주문이 나갈 경로.
   *
   * 주문 제출 코드가 이 값만 보고 판단한다. 화면 상태와 주문 경로를 따로
   * 관리하면 어긋나고, 그 어긋남이 "모의인데 실주문" 이라는 사고가 된다.
   */
  function getOrderPath() {
    var m = MODES[current];
    return m && m.available ? m.orderPath : null;
  }

  window.QTMode = {
    MODES: MODES,
    DEFAULT_MODE: DEFAULT_MODE,

    /**
     * 지금 모드에서 **주문을 낼 수 있는가**.
     *
     * ★ 모드를 고를 수 있는 것과 주문을 낼 수 있는 것은 다르다. 현물은 시세만
     *   지원하므로 차트는 보이지만 주문은 나가지 않는다. 화면이 이 값을 보고
     *   주문 영역에 이유를 표시해야 한다 — 버튼만 안 먹으면 고장으로 보인다.
     */
    canOrder: function () {
      var m = MODES[current];
      return Boolean(m && m.available && m.orderPath);
    },
    /** 주문이 안 되는 이유(번역 키). 가능하면 null. */
    orderBlockedReasonKey: function () {
      var m = MODES[current];
      if (!m) return 'mode_unknown';
      if (m.available && m.orderPath) return null;
      return m.marketDataOnlyReasonKey || m.reasonKey || 'mode_unknown';
    },

    get: function () { return current; },
    getOrderPath: getOrderPath,
    isPaper: function () { return current === 'paper'; },
    isAvailable: function (id) { return Boolean(MODES[id] && MODES[id].available); },
    reasonKeyFor: function (id) { return MODES[id] ? MODES[id].reasonKey : 'mode_unknown'; },
    setMode: setMode,

    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    debug: function () {
      return {
        current: current,
        orderPath: getOrderPath(),
        available: Object.keys(MODES).filter(function (k) { return MODES[k].available; }),
      };
    },
  };
})();
