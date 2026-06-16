/**
 * 페이지 전역 이벤트 리스너 (독립 IIFE).
 *
 * static/js/app.js에서 분리:
 * - 모바일 스와이프로 종목 전환 (touch gestures)
 * - 알림 패널 종목 클릭 위임 (BEOM 시그널 이력, 등록 알림, 삭제)
 *
 * 의존:
 * - window.curSymbol (현재 심볼)
 * - window._symbolList (전체 종목 목록)
 * - window._selectSym (종목 선택 함수)
 * - window.deleteAlert (알림 삭제)
 *
 * 이 모듈은 즉시 실행 (IIFE)하여 이벤트 리스너만 등록.
 * 실행 시점에 window.* 참조 없음 — 이벤트 발생 시에 접근.
 */

// ═══ 모바일 스와이프 종목 전환 ═══
(function () {
  if (!('ontouchstart' in window)) return;
  let startX = 0,
    startY = 0,
    swiping = false;
  const chart_el = document.getElementById('chartWrap');
  if (!chart_el) return;
  chart_el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      swiping = true;
    },
    { passive: true }
  );
  chart_el.addEventListener(
    'touchend',
    (e) => {
      if (!swiping) return;
      swiping = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      // 수평 스와이프 (50px 이상, 수직보다 큼)
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) {
        // 종목 목록에서 현재 위치 찾기
        const syms = window._symbolList || [];
        const idx = syms.indexOf(window.curSymbol);
        if (idx < 0) return;
        const next =
          dx < 0 ? (idx + 1) % syms.length : (idx - 1 + syms.length) % syms.length;
        window._selectSym && window._selectSym(syms[next]);
      }
    },
    { passive: true }
  );
})();

// ═══ 알림 패널 종목 클릭 위임 ═══
document.addEventListener('click', function (e) {
  // BEOM 시그널 이력 행 클릭
  const sigRow = e.target.closest('.beom-sig-row');
  if (sigRow && sigRow.dataset.sym) {
    window._selectSym && window._selectSym(sigRow.dataset.sym);
    return;
  }
  // 등록된 알림 종목 클릭
  const alertRow = e.target.closest('.beom-alert-row');
  if (alertRow && alertRow.dataset.sym) {
    window._selectSym && window._selectSym(alertRow.dataset.sym);
    return;
  }
  // 삭제 버튼
  const delBtn = e.target.closest('[data-del-alert]');
  if (delBtn) {
    e.stopPropagation();
    window.deleteAlert && window.deleteAlert(delBtn.dataset.delAlert);
    return;
  }
});
