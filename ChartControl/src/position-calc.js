/* ============================================================
   포지션 계산기 — 순수 계산.

   왜 별 파일인가
   ------------
   ★ 계산식을 화면(JSX)에서 떼어 낸다. 그래야 브라우저 없이 node 로 단위 테스트할
     수 있고("입력 X → 출력 Y"), 손익·청산가 같은 사용자가 돈을 거는 숫자를
     조용히 틀리게 두지 않는다.

   무엇을 계산하나 (USDT 마진 선형 무기한, 격리 마진 기준)
   -----------------------------------------------------
   · positionValue  = 진입가 × 수량            (정확)
   · initialMargin  = positionValue / 레버리지  (정확)
   · pnl / roe      = 청산가를 넣으면 실현 손익과 증거금 대비 수익률 (정확)
   · liqPrice       = **추정치**. 격리 마진 근사식이며 수수료·펀딩·유지증거금
     구간(MMR tier)을 반영하지 않는다. 그래서 화면에서 '추정' 이라고 명시한다 —
     실제 청산가는 거래소가 정한다.

   ★★ 지어내지 않는다. 입력이 유효하지 않으면 계산하지 않고 이유를 돌려준다.
      liqPrice 는 근사임을 호출자가 반드시 표시하도록 estimate:true 로 표식한다.
   ============================================================ */

(function () {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
  }

  /**
   * @param {object} input
   *   side: 'long' | 'short'
   *   entry: number (>0)      진입가
   *   qty: number (>0)        수량(계약/기초자산 단위)
   *   leverage: number (>=1)  레버리지
   *   exit?: number (>0)      청산/목표가 (선택) — 손익 계산용
   *   mmr?: number            유지증거금률 (기본 0.005 = 0.5%). liqPrice 근사에만 쓰임
   * @returns {{ok:true, ...}|{ok:false, error:string}}
   */
  function compute(input) {
    input = input || {};
    var side = input.side === 'short' ? 'short' : 'long';
    var entry = num(input.entry);
    var qty = num(input.qty);
    var leverage = num(input.leverage);
    var mmr = input.mmr == null ? 0.005 : num(input.mmr);

    if (!(entry > 0)) return { ok: false, error: 'ENTRY_INVALID' };
    if (!(qty > 0)) return { ok: false, error: 'QTY_INVALID' };
    if (!(leverage >= 1)) return { ok: false, error: 'LEVERAGE_INVALID' };
    if (!(mmr >= 0 && mmr < 1)) mmr = 0.005;

    var positionValue = entry * qty;
    var initialMargin = positionValue / leverage;

    /*
       격리 마진 청산가 근사.
         long:  entry × (1 − 1/lev + mmr)
         short: entry × (1 + 1/lev − mmr)
       수수료·펀딩·MMR 구간을 무시한 근사다. long 은 0 미만으로 내려가지 않게 막는다.
    */
    var liqPrice;
    if (side === 'long') {
      liqPrice = entry * (1 - 1 / leverage + mmr);
      if (liqPrice < 0) liqPrice = 0;
    } else {
      liqPrice = entry * (1 + 1 / leverage - mmr);
    }

    var out = {
      ok: true,
      side: side,
      entry: entry,
      qty: qty,
      leverage: leverage,
      positionValue: positionValue,
      initialMargin: initialMargin,
      liqPrice: liqPrice,
      liqIsEstimate: true,
    };

    var exit = num(input.exit);
    if (exit > 0) {
      var dir = side === 'long' ? 1 : -1;
      var pnl = (exit - entry) * qty * dir;
      out.exit = exit;
      out.pnl = pnl;
      out.roe = initialMargin > 0 ? (pnl / initialMargin) * 100 : 0;
      out.priceMovePct = ((exit - entry) / entry) * 100 * dir;
    }

    return out;
  }

  var api = { compute: compute };
  if (typeof window !== 'undefined') window.QTPositionCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
