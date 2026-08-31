/* ============================================================
   오버레이 실시간 라벨 — 두 차트 엔진이 공유한다
   ------------------------------------------------------------
   왜 별도 파일인가

   차트 엔진은 두 개다(klinecharts / 자체 Canvas). 둘은 의도적으로 같은 props
   계약을 구현하지만, **돈이 표시되는 계산을 각자 복사하면 언젠가 두 화면이
   서로 다른 손익을 보여준다.** 그래서 계산과 문자열 조립은 여기 한 곳에만 둔다.

   왜 라벨을 그리는 순간에 만드는가

   진입가 선의 라벨을 오버레이 데이터에 문자열로 굳혀 두면, 그 문자열은 값을
   불러온 순간의 손익이다. 가격이 움직여도 숫자가 그대로 남아 이용자는 옛 손익을
   현재 손익으로 읽는다. 그래서 오버레이에는 **계산에 필요한 값만** 담고, 라벨은
   차트가 그리는 순간에 최신가로 만든다. (그리기는 시세가 들어올 때마다 일어난다)

   부수 효과: 오버레이 배열을 매 틱마다 새로 만들 필요가 없다 → 드래그 중에
   선이 원래 위치로 튕겨 돌아가는 문제도 생기지 않는다.
   ============================================================ */

(function () {
  'use strict';

  /** 심볼 키 -> 최신가. 차트 컴포넌트가 갱신하고, 오버레이 렌더러가 읽는다. */
  const LIVE_PRICE = new Map();

  /** 'BTC/USDT', 'BTCUSDT' 등을 'BTCUSDT' 로 맞춘다. */
  function normKey(symbol) {
    return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function setPrice(symbol, price) {
    const k = normKey(symbol);
    const n = Number(price);
    if (!k || !Number.isFinite(n) || n <= 0) return;
    LIVE_PRICE.set(k, n);
  }

  function getPrice(symbol) {
    return LIVE_PRICE.get(normKey(symbol)) || null;
  }

  function signed(n, digits) {
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
  }

  /**
   * 오버레이 라벨을 완성한다.
   *
   * @param {object} ov       오버레이 ({ label, live, symbol })
   * @param {number} [price]  최신가. 없으면 live.symbol 로 조회한다.
   * @returns {string} 표시할 라벨. 계산할 수 없으면 원래 라벨을 그대로 돌려준다.
   */
  function labelFor(ov, price) {
    if (!ov) return '';
    const base = ov.label || '';
    const live = ov.live;
    if (!live) return base;

    const last = Number(price) || getPrice(live.symbol || ov.symbol);
    if (!(last > 0)) return base;

    /*
       포지션 진입가 선 — 지금 이익인지 손실인지, 얼마인지.

       ★ 두 숫자를 함께 적는다:
           가격 변동%  (진입가 대비, 방향 반영)
           ROE        (증거금 대비 = 가격 변동% × 레버리지)

       ★ 레버리지를 모르면 ROE 를 적지 않는다. 1배로 가정하면 손실을 실제보다
         작게 보여주는 방향의 거짓이 된다.
    */
    if (live.kind === 'position') {
      const entry = Number(live.entry);
      if (!(entry > 0)) return base;
      const dir = live.side === 'short' ? -1 : 1;
      const chg = ((last - entry) / entry) * 100 * dir;
      const lev = Number(live.leverage);
      const roe = (Number.isFinite(lev) && lev > 0) ? ` · ROE ${signed(chg * lev, 2)}` : '';
      return `${base} · ${signed(chg, 2)}${roe}`;
    }

    /*
       작성 중인 TP/SL 선 — 현재가에서 몇 % 떨어져 있는지.
       "1.9000" 만 보면 그게 먼 손절인지 붙은 손절인지 알 수 없다.
    */
    if (live.kind === 'away') {
      const target = Number(live.price);
      if (!(target > 0)) return base;
      return `${base} ${signed(((target - last) / last) * 100, 2)}`;
    }

    return base;
  }

  window.QTOverlayLive = { setPrice, getPrice, labelFor, normKey };
})();
