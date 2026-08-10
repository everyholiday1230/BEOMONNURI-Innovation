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
      available: false,
      reasonKey: 'mode_spot_unavailable',
      /** 주문 경로. 지원하지 않으므로 없다. */
      orderPath: null,
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
