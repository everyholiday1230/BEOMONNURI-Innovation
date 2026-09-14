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
  /*
     ★ 금액 표기. 자리수를 값 크기에 맞춘다 — 0.5 USDT 를 "1" 로 반올림하면
       소액 계정에서 손익이 사라져 보인다.
     ★★ 통화 기호를 붙이지 않는다. 선물 증거금은 USDT 지만 어댑터가 다른 정산통화를
       줄 수 있고, 틀린 기호는 틀린 금액보다 알아채기 어렵다.
  */
  /*
     ★★ 표시 폭(px) 추정. 10px 폰트에서 ASCII ≈ 5.6px, **한글·CJK ≈ 10px** 이다.
       `String.length` 로 재면 한글 라벨이 40% 가까이 좁게 계산돼 상자를 넘친다
       (차트 쪽 `textWidth` 와 같은 규칙을 쓴다 — 두 곳이 어긋나면 상자와 글자가 안 맞는다).
  */
  function width(text) {
    let w = 0;
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      const wide = (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf)
        || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
        || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
        || (c >= 0xffe0 && c <= 0xffe6);
      w += wide ? 10 : 5.6;
    }
    return w;
  }

  function fmtMoney(v) {
    const n = Math.abs(Number(v));
    const digits = n >= 1000 ? 0 : (n >= 1 ? 2 : 4);
    return Number(v).toFixed(digits);
  }

  /*
     ★ `opts.maxPx` — 라벨을 그릴 수 있는 가로 픽셀. 좁으면 축약한다.
       넘기지 않으면(기존 호출부) 축약하지 않는다 — 동작이 바뀌지 않는다.
  */
  function labelFor(ov, price, opts) {
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

      /*
         ★★ **들어간 금액(증거금)과 평가손익 금액.**

           % 만 보여주면 "그래서 얼마 벌었나" 를 알 수 없다. 운영자 요청이 정확히
           이것이다 — 진입 금액과 손익을 차트에서 바로 보고 싶다.

         ★ 증거금은 어댑터가 주는 값을 그대로 쓴다. `entry × size / leverage` 로
           재계산하면 승수·펀딩·부분체결 때문에 거래소 화면과 어긋난다.
         ★★ 값이 없으면 **적지 않는다.** 0 으로 적으면 증거금이 0 인 것처럼 읽힌다.
      */
      const margin = Number(live.margin);
      const marginTxt = (Number.isFinite(margin) && margin > 0)
        ? ` · ${fmtMoney(margin)}`
        : '';

      /*
         ★ 평가손익은 어댑터 값을 우선한다. 없으면 증거금 × ROE 로 근사하고 `~` 를
           붙인다 — 근사치를 확정값처럼 보여주면 안 된다.
      */
      const pnlRaw = Number(live.pnl);
      let pnlTxt = '';
      if (Number.isFinite(pnlRaw)) {
        pnlTxt = ` · ${pnlRaw >= 0 ? '+' : ''}${fmtMoney(pnlRaw)}`;
      } else if (Number.isFinite(margin) && margin > 0 && Number.isFinite(lev) && lev > 0) {
        const approx = margin * (chg * lev) / 100;
        pnlTxt = ` · ~${approx >= 0 ? '+' : ''}${fmtMoney(approx)}`;
      }

      /*
         ★★★ **좁은 차트에서는 줄인다 — 모바일 캔버스는 233px 이다.**

           전체 라벨은 "현재 포지션 · 롱 0.5 · 122.40 · +1.24% · ROE +3.72% · +4.55"
           처럼 길다. 233px 캔버스에서는 상자가 차트를 가로지르고 봉을 덮는다.

         ★ 지어내지 않고 **덜 중요한 것부터 뺀다**:
             ① 전체
             ② 이름·수량을 뺀다 (선의 색과 위치로 이미 안다)
             ③ 금액을 뺀다 (%가 더 급하다)
           숫자를 반올림해 줄이지 않는다 — 금액이 틀리게 보이는 것보다 없는 편이 낫다.
      */
      const full = `${base}${marginTxt} · ${signed(chg, 2)}${roe}${pnlTxt}`;
      const maxPx = Number(opts && opts.maxPx);
      if (!(maxPx > 0) || width(full) <= maxPx) return full;

      const mid = `${signed(chg, 2)}${roe}${pnlTxt}`.replace(/^ · /, '');
      if (width(mid) <= maxPx) return mid;

      const tight = `${signed(chg, 2)}${roe}`.replace(/^ · /, '');
      if (width(tight) <= maxPx) return tight;

      /*
         ★★ 아주 좁으면 **가격 변동%만** 남긴다. 이것이 마지막 단계다 —
           선의 색과 위치가 방향을, 오른쪽 가격 배지가 가격을 이미 말해 준다.
         ★★★ 여기서 더 줄이려고 숫자를 자르지 않는다. "+1.4" 처럼 잘린 숫자는
           **틀린 숫자**이고, 손익을 실제보다 작게 보여주는 방향의 거짓이 된다.
           넘치더라도 온전한 값을 보여주는 편이 낫다.
      */
      return signed(chg, 2);
    }

    /*
       작성 중인 TP/SL 선 — 현재가에서 몇 % 떨어져 있는지.
       "1.9000" 만 보면 그게 먼 손절인지 붙은 손절인지 알 수 없다.
    */
    /*
       ★★★ **보호주문(TP/SL) 선 — 진입가 기준으로 말한다.**

         운영자 지적(2026-09-14): "sl tp가 현재가격기준되는거같은데..? 내가 진입한
         기준으로 되어야할 것 같은데" — 맞다. 전에는 `kind: 'away'` 를 써서 **현재가
         대비 %** 를 적었다.

       ★★ 손절·익절에서 알아야 하는 것은 "지금 가격에서 얼마 떨어졌나" 가 아니라
         **"거기 닿으면 내 손익이 얼마인가"** 다. 그 기준은 진입가다. 현재가 대비로
         적으면 가격이 움직일 때마다 숫자가 바뀌어, 같은 손절인데 어떤 때는 -1%,
         어떤 때는 -3% 로 보인다 — 위험을 잘못 읽는다.

       ★ 세 가지를 적는다:
           가격 변동%  (진입가 대비, 방향 반영)
           ROE         (증거금 대비 = 변동% × 레버리지)
           금액         (수량 × 가격차)
       ★★ 레버리지를 모르면 ROE 를 적지 않는다. 1배로 가정하면 손실을 실제보다 작게
         보여주는 방향의 거짓이 된다.
    */
    if (live.kind === 'bracket') {
      const entry = Number(live.entry);
      const target = Number(live.price);
      if (!(entry > 0) || !(target > 0)) return base;

      const dir = live.side === 'short' ? -1 : 1;
      const chg = ((target - entry) / entry) * 100 * dir;

      const lev = Number(live.leverage);
      const roe = (Number.isFinite(lev) && lev > 0) ? ` · ROE ${signed(chg * lev, 2)}` : '';

      /*
         ★ 금액은 수량을 알아야 계산할 수 있다. 없으면 적지 않는다 — 추측한 금액은
           틀린 금액이고, 손절 크기를 잘못 판단하게 만든다.
      */
      const qty = Number(live.size);
      const amt = (Number.isFinite(qty) && qty > 0)
        ? ` · ${(target - entry) * qty * dir >= 0 ? '+' : ''}${fmtMoney((target - entry) * qty * dir)}`
        : '';

      const full = `${base} · ${signed(chg, 2)}${roe}${amt}`;
      const maxPx = Number(opts && opts.maxPx);
      if (!(maxPx > 0) || width(full) <= maxPx) return full;

      /* ★ 좁으면 덜 중요한 것부터 뺀다. 숫자를 자르지는 않는다. */
      const mid = `${base} · ${signed(chg, 2)}${roe}`;
      if (width(mid) <= maxPx) return mid;
      const tight = `${signed(chg, 2)}${roe}`;
      if (width(tight) <= maxPx) return tight;
      return signed(chg, 2);
    }

    if (live.kind === 'away') {
      const target = Number(live.price);
      if (!(target > 0)) return base;
      return `${base} ${signed(((target - last) / last) * 100, 2)}`;
    }

    return base;
  }

  window.QTOverlayLive = { setPrice, getPrice, labelFor, normKey };
})();
