/* ============================================================
   목업 표시 허용 여부 — 단일 판정처

   왜 필요한가
   ---------
   화면마다 다른 조건으로 목업/실데이터를 골라왔다:
     · acct.isLive        거래소 API 키가 검증됐는가
     · Array.isArray(x)   조회가 끝났는가
     · localPos           우리 DB 에 기록이 있는가

   그 결과 **실데이터가 없는 계정은 목업을 봤다.** 신규 가입자는 거래 기록이
   없으므로 목업 포지션 3개(0.185 BTC @ 67,285)와 손익 $661.87 을 자기 것으로
   본다. 실측으로 확인했다: 관리자 계정(거래 기록 없음)에서
   /portfolio · /analytics · /order-history 에 목업 값이 그대로 나왔다.

   무엇이 맞는 기준인가
   ------------------
   ★★ **백엔드가 있으면 실서비스다.** 그때는 데이터가 없어도 목업을 보여주지
     않고 "아직 없습니다" 를 말한다. 빈 상태가 고장처럼 보이는 것보다, 남의
     거래를 자기 것으로 착각하는 것이 훨씬 나쁘다.

   ★ 백엔드가 없으면 디자이너 미리보기다. 그때는 목업이 유일한 표시 수단이므로
     그대로 둔다 — 디자이너가 자기 화면을 확인할 수 있어야 한다.

   ★ 판정 중(null)일 때는 목업을 쓰지 않는다. 잠깐 목업이 보이고 실데이터로
     바뀌면 사용자가 그 사이에 본 값을 기억한다.
   ============================================================ */

(function () {
  'use strict';

  /**
   * 목업(디자이너 예시)을 보여도 되는가.
   *
   * `true`  → 백엔드가 없는 미리보기. 목업이 유일한 표시 수단이다.
   * `false` → 실서비스. 데이터가 없으면 빈 상태 안내를 보여준다.
   */
  function allowMockData() {
    var L = window.QTLive;
    if (!L || typeof L.isBackendPresent !== 'function') {
      /*
         라이브 모듈이 없으면 정적 미리보기로 본다.

         ★ 이 파일이 백엔드 없는 환경에서도 로드되므로, 모듈 부재를 곧
           "미리보기" 로 해석하는 것이 맞다.
      */
      return true;
    }
    var present = L.isBackendPresent();
    /*
       ★ null 은 "아직 모른다" 다. 그때 목업을 허용하면 첫 렌더에 예시가
         보이고 곧 실데이터로 바뀐다 — 사용자는 사라진 값을 기억한다.
         모르는 동안에는 보여주지 않는다.
    */
    return present === false;
  }

  /**
   * 실서비스인가 (목업을 쓰면 안 되는 상태인가).
   *
   * `allowMockData()` 의 반대가 아니다 — 판정 중(null)일 때 둘 다 false 다.
   * "실서비스임이 확인됐다" 와 "미리보기임이 확인됐다" 를 구분해야 하기 때문이다.
   */
  function isRealService() {
    var L = window.QTLive;
    if (!L || typeof L.isBackendPresent !== 'function') return false;
    return L.isBackendPresent() === true;
  }

  window.QTMockPolicy = {
    allowMockData: allowMockData,
    isRealService: isRealService,

    /**
     * 목업과 실데이터 중 무엇을 쓸지 고른다.
     *
     * @param {*} real  실데이터 (없으면 null/빈 배열)
     * @param {*} mock  목업 데이터
     * @returns 실데이터가 있으면 그것, 없으면 미리보기에서만 목업, 실서비스에서는 빈 값
     *
     * ★ 실데이터가 "빈 배열" 인 것과 "없는 것" 을 구분한다. 빈 배열은
     *   "조회했고 결과가 0건" 이므로 그것이 사실이다 — 목업으로 채우지 않는다.
     */
    pick: function (real, mock) {
      var hasReal = Array.isArray(real) ? real.length > 0 : (real !== null && real !== undefined);
      if (hasReal) return real;
      if (allowMockData()) return mock;
      // 실서비스인데 데이터가 없다. 빈 값을 그대로 준다.
      return Array.isArray(mock) ? [] : null;
    },

    debug: function () {
      return {
        backendPresent: (window.QTLive && window.QTLive.isBackendPresent)
          ? window.QTLive.isBackendPresent() : 'QTLive 없음',
        allowMock: allowMockData(),
        realService: isRealService(),
      };
    },
  };
})();
