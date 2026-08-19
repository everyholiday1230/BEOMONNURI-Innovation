/* ============================================================
   판단 문맥 수집 — window.QTDecisionContext

   무엇을 하는가
   -----------
   주문을 낼 때 "그 순간 화면이 어떤 상태였는지" 를 한 덩어리로 모아 준다.
   서버는 이 값을 학습 데이터에 담는다.

   ★★ 왜 화면이 모아야 하는가

     지표 on/off, 주기, 레이아웃은 **화면에만 있는 상태**다. 서버는 알 수 없다.
     학습의 목적이 "어떤 근거로 그 매매를 했는가" 이므로, 화면이 보내지 않으면
     결과만 남고 근거가 사라진다 — 그런 데이터로는 판단을 학습할 수 없다.

   불변식
   -----
   1. **모르는 것은 넣지 않는다.** 지표를 읽을 수 없으면 `indicators` 키를
      아예 뺀다. 빈 배열을 넣으면 "지표를 하나도 켜지 않았다" 는 사실 주장이
      되고, 우리는 그것을 확인하지 않았다.
   2. **시세를 담지 않는다.** 서버가 자기 원천에서 읽는다. 화면 값을 보내면
      조작된 요청으로 학습 데이터를 오염시킬 수 있다.
   3. **개인정보를 담지 않는다.** 도형은 **개수만** 담는다. 도형에는 이용자가
      쓴 메모가 들어 있을 수 있다.
   4. **여기서 예외를 던지지 않는다.** 이 함수가 실패하면 주문이 실패한다.
      문맥은 부수 목적이고 주문은 본래 목적이다.
   ============================================================ */
(function () {
  'use strict';

  /**
   * 지금 화면의 판단 문맥을 만든다.
   *
   * @param {string} [source] 주문을 낸 위치. 'order-panel' | 'chart-hotkey' |
   *   'copilot' | 'positions' 등. 같은 조건이라도 어디서 냈는지에 따라 행동이
   *   다르다(단축키 주문은 대개 급하다).
   * @returns {object|null} 담을 것이 하나도 없으면 null — 빈 객체를 보내면
   *   서버가 "화면이 보고했지만 아무 것도 없었다" 로 기록한다.
   */
  function collect(source) {
    try {
      var ctx = {};

      /* ---- 지표 (이 데이터셋의 핵심) ---- */
      var cs = window.QTChartState;
      if (cs) {
        var detail = typeof cs.getIndicatorDetail === 'function' ? cs.getIndicatorDetail() : null;
        if (detail && detail.length) {
          ctx.indicators = detail;
        } else {
          /*
             설정값을 못 얻으면 이름만이라도 담는다.

             ★ 이름만 있으면 20일선인지 120일선인지 모른다. 그래도 "MA 를 보고
               있었다" 는 사실은 남는다 — 없는 것보다 낫고, 없는 값을 만들지도
               않는다.
          */
          var names = typeof cs.getIndicators === 'function' ? cs.getIndicators() : null;
          if (names && names.length) {
            ctx.indicators = names.map(function (n) { return { id: String(n) }; });
          }
          /*
             ★ 둘 다 없으면 `indicators` 를 넣지 않는다. 차트가 없는 화면에서
               주문할 수도 있고(포지션 목록), 그때 "지표 없음" 은 사실이 아니다.
          */
        }
      }

      /* ---- 주기 ---- */
      var live = window.QTLive;
      if (live && typeof live.getActiveTimeframe === 'function') {
        var tf = live.getActiveTimeframe();
        if (tf) ctx.timeframe = String(tf);
      }

      /* ---- 도형 개수 ----
         ★ 아직 담지 않는다. 도형 개수를 읽는 창구가 없다.

           차트 라이브러리에 물어보는 방법이 있지만, 그러려면 이 파일이 차트
           인스턴스를 알아야 한다. 차트가 없는 화면(포지션 목록)에서 주문할 때
           깨지고, 무엇보다 **도형에는 이용자가 쓴 메모가 들어 있다** — 개수만
           얻으려고 전체를 훑는 경로를 만들면 나중에 내용까지 담기기 쉽다.

           차트를 소유한 쪽이 개수만 게시하도록 만드는 것이 맞는 순서다.
           그때까지는 이 칸을 비운다(없는 값을 만들지 않는다).
      */

      /* ---- 레이아웃·차트 종류 ---- */
      var tw = null;
      try {
        tw = JSON.parse(window.localStorage.getItem('qt.tweaks') || 'null');
      } catch (e) { tw = null; }
      if (tw) {
        if (tw.presetId) ctx.preset = String(tw.presetId);
        if (tw.chartType) ctx.chartType = String(tw.chartType);
      }

      /* ---- 어디서 냈는가 ---- */
      if (source) ctx.source = String(source);

      return Object.keys(ctx).length ? ctx : null;
    } catch (e) {
      /*
         ★ 문맥 수집 실패가 주문을 막지 않는다. null 이면 서버는 "화면이
           보고하지 않았다" 로 기록하고, 그것이 사실이다.
      */
      return null;
    }
  }

  window.QTDecisionContext = collect;
})();
