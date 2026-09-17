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
  /*
     보호주문(TP/SL) 라벨 — **진입가 기준**으로 계산한다.

     ★ 현재가를 쓰지 않는다. 그래서 시세가 아직 없어도 손익을 보여줄 수 있다.
  */
  function bracketLabel(base, live, opts) {

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

      /*
         ★★ 보호주문 선도 같은 규칙이다 — **이름을 빼고 손익만** 남긴다.
           트리거 가격은 오른쪽 축 배지에, 익절/손절 구분은 **선의 색**에 있다
           (익절=이익색, 손절=손실색). 이름을 다시 적으면 그만큼 봉이 가려진다.
         ★ 초안(점선)과 걸린 주문(실선)의 구분도 선 모양이 말한다.
      */
      const full = `${signed(chg, 2)}${roe}${amt}`;
      const maxPx = Number(opts && opts.maxPx);
      if (!(maxPx > 0) || width(full) <= maxPx) return full;

      /*
         ★★★ **좁을 때 먼저 빼는 것은 ROE 다 — %와 금액을 남긴다.**

           운영자 요청(2026-09-15): "지금 가격 나오는 위치에(캔들보다 더 오른쪽
           공간에) %랑 금액 나오게." 즉 이 라벨이 반드시 지켜야 하는 두 값은
           **가격 변동%와 금액**이다.

         ★ 예전에는 금액을 먼저 뺐다(`% · ROE` 로 줄였다). 라벨을 캔들 오른쪽
           여백(실측 85px)에 넣게 되면서 축약이 자주 일어나는데, 그때마다 요청받은
           금액이 사라졌다.

         ★ ROE 를 버리는 것이 아니다 — 자리가 있으면 위 `full` 에 그대로 있다.
           ROE 는 포지션 패널에도 있고, 금액은 이 라벨이 아니면 봉을 보면서 알 수 없다.
         ★★ 숫자를 잘라 줄이지는 않는다. 잘린 금액은 **틀린 금액**이다.
      */
      const noRoe = `${signed(chg, 2)}${amt}`;
      if (width(noRoe) <= maxPx) return noRoe;
      return signed(chg, 2);
  }

  function labelFor(ov, price, opts) {
    if (!ov) return '';
    const base = ov.label || '';
    const live = ov.live;
    if (!live) return base;

    const last = Number(price) || getPrice(live.symbol || ov.symbol);
    /*
       ★★★ **보호주문 라벨은 현재가가 없어도 만들 수 있다.**

         이 검사는 원래 "현재가 대비" 계산을 위한 것이었다. 그런데 보호주문(bracket)은
         **진입가 대비**로 계산하므로 현재가가 필요 없다. 그대로 두면 시세를 아직 못
         받은 순간에 라벨이 이름만("익절") 나오고, 이용자는 손익을 볼 수 없다.

       ★ 그래서 bracket 은 이 검사보다 **먼저** 처리한다. 나머지 종류는 현재가가 필요해
         그대로 둔다.
    */
    if (live.kind === 'bracket') return bracketLabel(base, live, opts);

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
      /*
         ★ 증거금 자체는 라벨에 적지 않는다(포지션 패널에 있다). 다만 아래에서
           평가손익을 근사할 때 필요하므로 값은 계산해 둔다.
      */

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
      /*
         ★★★ **캔들을 가리지 않게 손익만 남긴다.**

           운영자 지적(2026-09-14): "너무 캔들을 가리는거같아... 진입가격은 실시간가격
           처럼 차트 오른쪽축에 나오게 하고, +- 금액이랑 %율만 넣어주면 깔끔할꺼같은데."

         ★★ 맞다. 전에는 `현재 포지션 · 롱 0.5 · 10417 · +1.44% · ROE +4.32% · +450.00`
           이었다. 이름·방향·수량·증거금이 앞을 다 먹고 봉을 덮었다.
         ★ 정보를 잃지 않는다 — 각각 이미 다른 자리에 있다:
             진입가    → 차트 **오른쪽 축**의 가격 배지(실시간가와 같은 방식)
             방향·수량 → 포지션 패널의 행, 그리고 선의 **색**
             증거금    → 포지션 패널
           라벨에는 봉을 보면서 알아야 하는 것만 남긴다: **손익 %와 금액**.
         ★★ ROE 는 남긴다. 증거금 대비 수익률은 가격 변동%만으로는 알 수 없고,
           레버리지 거래에서 실제로 체감하는 숫자다.
      */
      const full = `${signed(chg, 2)}${roe}${pnlTxt}`;
      const maxPx = Number(opts && opts.maxPx);
      if (!(maxPx > 0) || width(full) <= maxPx) return full;

      /*
         ★★★ **ROE 를 먼저 뺀다 — %와 금액이 요청받은 두 값이다.**
           (위 bracketLabel 의 같은 주석 참고. 두 곳의 우선순위가 달라지면
            같은 화면에서 어떤 선은 금액이 보이고 어떤 선은 안 보인다.)
      */
      const noRoe = `${signed(chg, 2)}${pnlTxt}`;
      if (width(noRoe) <= maxPx) return noRoe;

      const tight = `${signed(chg, 2)}${roe}`;
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
    if (live.kind === 'away') {
      const target = Number(live.price);
      if (!(target > 0)) return base;
      return `${base} ${signed(((target - last) / last) * 100, 2)}`;
    }

    return base;
  }

  /**
   * 라벨을 **여러 줄로** 나눠 준다 — 좁은 자리에 %와 금액을 모두 넣기 위한 것.
   *
   * ★★ 왜 필요한가
   *
   *   손익 라벨을 "캔들보다 오른쪽 빈 공간" 에 두라는 요청을 지키면 쓸 수 있는 폭이
   *   실측 **77px** 다. 한 줄로는 `-1.50% · +513.24`(약 102px)가 안 들어가서 축약이
   *   일어나고, 그러면 요청받은 **금액이 사라진다.** 세로로 쌓으면 두 값이 다 남는다.
   *
   * ★ 계산을 다시 하지 않는다. `labelFor` 가 만든 문구를 ` · ` 단위로 나눠 담는다 —
   *   계산이 두 곳에 있으면 언젠가 서로 다른 숫자를 말한다(이 파일이 존재하는 이유다).
   *
   * ★ 한 토막이 혼자서도 폭을 넘으면 **자르지 않고** 그 줄에 그대로 둔다.
   *   잘린 금액은 틀린 금액이다.
   *
   * ★★ 줄 수가 한도를 넘으면 **가운데(ROE)부터 버린다.** 첫 토막(%)과 마지막
   *   토막(금액)이 요청받은 두 값이다.
   */
  function labelLinesFor(ov, price, opts) {
    const maxPx = Number(opts && opts.maxPx) || 0;
    const maxLines = Math.max(1, Number(opts && opts.maxLines) || 2);

    /* maxPx 를 주지 않고 부른다 — 축약 없는 전체 문구를 받아 우리가 나눈다. */
    const full = labelFor(ov, price, undefined);
    if (!full) return [];
    if (maxPx <= 0) return [full];

    let parts = String(full).split(' · ').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return [];

    const pack = (list) => {
      const lines = [];
      let cur = '';
      for (const seg of list) {
        const cand = cur ? `${cur} · ${seg}` : seg;
        if (!cur || width(cand) <= maxPx) {
          cur = cand;
        } else {
          lines.push(cur);
          cur = seg;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    let lines = pack(parts);
    /* 줄이 너무 많으면 가운데 토막을 하나씩 버리고 다시 담는다. */
    while (lines.length > maxLines && parts.length > 2) {
      parts = [parts[0], ...parts.slice(2)];
      lines = pack(parts);
    }
    if (lines.length > maxLines) lines = lines.slice(0, maxLines);
    return lines;
  }

  window.QTOverlayLive = { setPrice, getPrice, labelFor, labelLinesFor, normKey };
})();
