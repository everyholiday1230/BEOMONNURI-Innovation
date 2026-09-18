/**
 * 고객이 만든 **신호 규칙** 평가기.
 *
 * 왜 존재하나
 * ----------
 * 운영 결정(2026-09-18): **매매 신호는 우리가 주는 것이 아니라 고객이 만든다.**
 * 고객이 조건을 쓰고(예: `CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))`),
 * 이 모듈이 그 조건을 캔들 계열에 평가해 **성립한 봉**을 찾는다. 차트는 그 지점에
 * 표시만 한다.
 *
 * ★★★ **이것은 감지이고 예측이 아니다.**
 *   "MACD 선이 09:15 에 신호선을 상향 교차했다" 는 데이터가 무엇을 했는지에 대한
 *   서술이다. 다음에 무엇이 일어날지는 말하지 않는다. 그래서 결과에 **어떤 규칙이
 *   언제 성립했는지**를 함께 담는다(`ruleText`, `time`) — 표시만 있고 근거가 없으면
 *   고객은 그것을 예측으로 읽는다. 약관 제4조2호·리스크 제6조가 같은 말을 한다.
 *
 * ★★ **모르는 봉은 신호가 아니다.** DSL 은 웜업·결측을 NaN 으로 남긴다(삼값 논리).
 *   NaN 을 거짓으로 접으면 "조건이 성립하지 않았다" 와 "아직 계산할 수 없다" 가
 *   구별되지 않는다. 여기서도 NaN 은 신호로 세지 않고, **몇 봉이 모름이었는지**를
 *   함께 돌려준다 — 규칙이 데이터 부족으로 한 번도 못 돈 것을 "신호 0건" 으로
 *   보여주면 고객은 규칙이 틀렸다고 오해한다.
 *
 * ★ 방향(롱/숏)을 우리가 정하지 않는다. 규칙에 방향이 붙어 있으면 그것은 **고객이
 *   붙인 것**이고, 그대로 표시한다. 규칙에 없으면 방향 없는 표시로 둔다.
 */
(function () {
  'use strict';

  /** 표시 상한 — 한 화면에 마커가 수백 개면 캔들이 보이지 않는다. */
  const MAX_MARKS = 200;

  /**
   * 규칙 하나를 평가한다.
   *
   * @param {string} expression  DSL 조건식
   * @param {Array<{time?:number, timestamp?:number, open:number, high:number, low:number, close:number, volume:number}>} bars
   * @param {{ direction?: 'long'|'short'|null, label?: string, maxMarks?: number }} [opts]
   * @returns {{ ok: true, marks: Array<{index:number, time:number|null, price:number, direction:string|null, label:string, ruleText:string}>,
   *             total: number, unknownBars: number, truncated: boolean }
   *          | { ok: false, error: string }}
   */
  function evaluate(expression, bars, opts) {
    const fmla = window.QTFmla;
    if (!fmla) return { ok: false, error: 'DSL_UNAVAILABLE' };
    if (!Array.isArray(bars) || bars.length === 0) return { ok: false, error: 'NO_BARS' };

    const parsed = fmla.parse(expression);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    let values;
    try { values = fmla.eval(parsed.ast, bars); }
    catch (e) { return { ok: false, error: (e && e.message) || 'EVAL_FAILED' }; }

    const o = opts || {};
    const cap = Number.isFinite(o.maxMarks) ? Math.max(1, Math.floor(o.maxMarks)) : MAX_MARKS;
    /*
       ★ 방향은 고객이 준 것만 쓴다. 없으면 null 로 둔다 — 우리가 추측해 넣으면
         그 순간 우리가 방향을 발신한 것이 된다.
    */
    const direction = o.direction === 'long' || o.direction === 'short' ? o.direction : null;
    const ruleText = String(expression).trim();
    const label = String(o.label || '').trim() || ruleText;

    const marks = [];
    let unknownBars = 0;
    let total = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) { unknownBars += 1; continue; }
      /*
         ★ 조건식은 1/0 을 돌려준다. 그런데 고객이 조건이 아닌 계산식을 넣을 수도
           있다(예: `close`). 그때 모든 봉이 "참" 이 되어 마커가 봉마다 찍히면
           화면이 무의미해진다. 0.5 를 넘는 값을 참으로 보는 것은 DSL 과 같은 기준이고,
           호출부가 그것을 알 수 있도록 total 을 함께 돌려준다.
      */
      if (v <= 0.5) continue;
      total += 1;
      if (marks.length >= cap) continue;
      const b = bars[i];
      const t = Number.isFinite(b.time) ? b.time : (Number.isFinite(b.timestamp) ? b.timestamp : null);
      marks.push({
        index: i,
        time: t,
        /* ★ 표시 가격은 종가다 — 조건이 확정되는 시점의 값이다. */
        price: Number(b.close),
        direction,
        label,
        ruleText,
      });
    }

    return {
      ok: true,
      marks,
      total,
      unknownBars,
      /*
         ★ 잘렸는지 밝힌다. 조용히 자르면 고객은 신호가 그만큼만 났다고 읽는다.
      */
      truncated: total > marks.length,
    };
  }

  /**
   * 규칙 여러 개를 한 번에 평가한다.
   *
   * ★ 하나가 실패해도 나머지를 돌린다. 규칙 하나에 오타가 있으면 그것만 알리고
   *   나머지 표시는 살린다 — 전부 사라지면 무엇이 문제인지 알 수 없다.
   */
  function evaluateAll(rules, bars) {
    const out = [];
    for (const r of Array.isArray(rules) ? rules : []) {
      if (!r || !r.expression) continue;
      const res = evaluate(r.expression, bars, {
        direction: r.direction,
        label: r.name || r.label,
        maxMarks: r.maxMarks,
      });
      out.push({ id: r.id || null, name: r.name || null, ...res });
    }
    return out;
  }

  window.QTSignalRules = { evaluate, evaluateAll, MAX_MARKS };
})();
