// ═══ demo.js — 모의주문 시스템으로 통합됨 (호환 stub) ═══
// 기존 데모매매 함수들은 모의주문(#order 탭) 시스템으로 리다이렉트.
// data-action="_demoLong" 등의 버튼이 있으면 자동으로 새 시스템 사용.

(function(){
  // 더미 함수들 — 외부에서 참조해도 에러 안 나도록
  window._demoMarkers = window._demoMarkers || JSON.parse(localStorage.getItem('chartOS_demoMarkers')||'[]');
  window._demoPos = window._demoPos || null;
  
  // 기존 호출이 있을 경우 모의주문 탭 알림
  function _redirectToOrder(action){
    window.showToast?.('모의주문 탭(우측 사이드바)에서 거래해주세요', '#921230');
    // 모의주문 탭 자동 활성화 시도
    const orderTab = document.querySelector('[data-p="order"]');
    if(orderTab) orderTab.click();
  }
  
  window._demoLong = window._demoLong || (() => _redirectToOrder('long'));
  window._demoShort = window._demoShort || (() => _redirectToOrder('short'));
  window._demoClose = window._demoClose || (() => _redirectToOrder('close'));
  window._demoClear = window._demoClear || function(){
    window._clearMockOrders?.();
  };
})();
