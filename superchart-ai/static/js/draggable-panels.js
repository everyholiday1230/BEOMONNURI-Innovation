// ═══════════════════════════════════════════════
// 플로팅 패널 공통 유틸
//   1. 드래그 이동 (data-draggable="true" + data-drag-handle)
//   2. X 닫기 (data-action="_closePanel" data-target="패널ID")
//   3. 위치 localStorage 기억 (id 기준)
// ═══════════════════════════════════════════════
(function(){
  'use strict';

  const _LS_PREFIX = 'chartOS_panelPos_';

  // 저장된 위치 불러오기
  function _loadPos(id) {
    try {
      const s = localStorage.getItem(_LS_PREFIX + id);
      return s ? JSON.parse(s) : null;
    } catch(e) { return null; }
  }
  function _savePos(id, pos) {
    try { localStorage.setItem(_LS_PREFIX + id, JSON.stringify(pos)); } catch(e) {}
  }

  // 저장된 위치 적용
  function _applySavedPos(panel) {
    if (!panel || !panel.id) return;
    const pos = _loadPos(panel.id);
    if (!pos) return;
    // 화면 밖으로 나간 경우 복원 안 함 (재방문 안전)
    const vw = window.innerWidth, vh = window.innerHeight;
    if (pos.left < -50 || pos.left > vw - 100 ||
        pos.top < -50 || pos.top > vh - 50) return;
    panel.style.left = pos.left + 'px';
    panel.style.top = pos.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  // 드래그 시작 (마우스/터치 통합)
  function _startDrag(e, panel) {
    if (e.target.closest('button,input,select,textarea,a')) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const touch = e.touches && e.touches[0];
    const sx = touch ? touch.clientX : e.clientX;
    const sy = touch ? touch.clientY : e.clientY;
    const sl = rect.left, st = rect.top;
    panel.classList.add('is-dragging');
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const t = ev.touches && ev.touches[0];
      const cx = t ? t.clientX : ev.clientX;
      const cy = t ? t.clientY : ev.clientY;
      const dx = cx - sx;
      const dy = cy - sy;
      let nl = sl + dx, nt = st + dy;
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = rect.width, h = rect.height;
      nl = Math.max(-w + 60, Math.min(vw - 60, nl));
      nt = Math.max(0, Math.min(vh - 40, nt));
      panel.style.left = nl + 'px';
      panel.style.top = nt + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      if (t) ev.preventDefault();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      panel.classList.remove('is-dragging');
      document.body.style.userSelect = '';
      const r = panel.getBoundingClientRect();
      if (panel.id) _savePos(panel.id, { left: r.left, top: r.top });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  // 드래그 가능 패널 초기화
  function _initDraggablePanel(panel) {
    if (!panel || panel._draggableInit) return;
    panel._draggableInit = true;
    const handle = panel.querySelector('[data-drag-handle]') || panel;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => _startDrag(e, panel));
    handle.addEventListener('touchstart', (e) => _startDrag(e, panel), { passive: false });
    _applySavedPos(panel);
    const obs = new MutationObserver(() => {
      if (panel.style.display !== 'none') _applySavedPos(panel);
    });
    obs.observe(panel, { attributes: true, attributeFilter: ['style'] });
  }

  // 모든 [data-draggable] 패널 자동 초기화
  function _initAllPanels() {
    document.querySelectorAll('[data-draggable="true"]').forEach(_initDraggablePanel);
  }

  // X 닫기 버튼 공통 핸들러
  document.addEventListener('click', function(e){
    const t = e.target.closest('[data-action="_closePanel"]');
    if (!t) return;
    const targetId = t.dataset.target;
    if (!targetId) return;
    const panel = document.getElementById(targetId);
    if (panel) panel.style.display = 'none';
  });

  // DOM 로드 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initAllPanels);
  } else {
    _initAllPanels();
  }
  // 그 후 새로 나타나는 패널도 주기적 점검 (DOM 동적 변경 대응)
  setInterval(_initAllPanels, 3000);

  // 외부에서 호출 가능 — 특정 패널 초기화
  window._initDraggablePanel = _initDraggablePanel;
})();
