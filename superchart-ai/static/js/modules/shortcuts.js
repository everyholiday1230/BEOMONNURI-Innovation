// 키보드 단축키 (TradingView 스타일)
// 의존: window.setTimeframe, document.querySelector('[data-tf]')

(function() {
  'use strict';

  // 단축키 매핑
  const SHORTCUTS = {
    // 타임프레임 (1-7)
    '1': () => clickTf('1m'),
    '2': () => clickTf('5m'),
    '3': () => clickTf('15m'),
    '4': () => clickTf('1h'),
    '5': () => clickTf('4h'),
    '6': () => clickTf('1d'),

    // 차트 도구
    'l': () => toggleDrawingTool('hline-mode'),  // L = horizontal Line
    't': () => toggleDrawingTool('trendline-mode'),  // T = Trendline
    'f': () => toggleDrawingTool('fib'),  // F = Fibonacci
    'r': () => clearDrawings(),  // R = Remove

    // 패널 토글
    '[': () => toggleLeftPanel(),
    ']': () => toggleRightPanel(),

    // 검색 포커스
    '/': (e) => { e.preventDefault(); focusSearch(); },

    // 다크모드 토글
    'd': () => toggleDarkMode(),

    // 도움말
    '?': () => showHelp(),
  };

  function clickTf(tf) {
    const btn = document.querySelector(`[data-tf="${tf}"]`);
    if (btn) btn.click();
  }

  function toggleDrawingTool(name) {
    const btn = document.querySelector(`[data-draw="${name}"]`);
    if (btn) btn.click();
  }

  function clearDrawings() {
    const btn = document.querySelector('[data-draw="clear"]');
    if (btn) btn.click();
  }

  function toggleLeftPanel() {
    const left = document.querySelector('.left');
    if (left) left.classList.toggle('hidden-mobile');
  }

  function toggleRightPanel() {
    const right = document.querySelector('.right');
    if (right) right.classList.toggle('collapsed');
  }

  function focusSearch() {
    const search = document.getElementById('searchInput');
    if (search) {
      search.focus();
      search.select();
    }
  }

  function toggleDarkMode() {
    document.body.classList.toggle('dark');
    localStorage.setItem(
      'chartOS_theme',
      document.body.classList.contains('dark') ? 'dark' : 'light'
    );
    if (window.chart) window.chart._dirty = true;
    if (window.chart2) window.chart2._dirty = true;
    if (window._updateActiveIndList) window._updateActiveIndList();
  }

  function showHelp() {
    let panel = document.getElementById('shortcutHelp');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
      return;
    }
    panel = document.createElement('div');
    panel.id = 'shortcutHelp';
    panel.innerHTML = `
      <div class="shortcut-help-card">
        <div class="shortcut-help-header">
          <h3>키보드 단축키</h3>
          <button onclick="document.getElementById('shortcutHelp').style.display='none'" aria-label="닫기">✕</button>
        </div>
        <div class="shortcut-grid">
          <div class="shortcut-section">
            <h4>타임프레임</h4>
            <div><kbd>1</kbd> 1분</div>
            <div><kbd>2</kbd> 5분</div>
            <div><kbd>3</kbd> 15분</div>
            <div><kbd>4</kbd> 1시간</div>
            <div><kbd>5</kbd> 4시간</div>
            <div><kbd>6</kbd> 일봉</div>
          </div>
          <div class="shortcut-section">
            <h4>드로잉</h4>
            <div><kbd>L</kbd> 수평선</div>
            <div><kbd>T</kbd> 추세선</div>
            <div><kbd>F</kbd> 피보나치</div>
            <div><kbd>R</kbd> 모두 삭제</div>
          </div>
          <div class="shortcut-section">
            <h4>UI</h4>
            <div><kbd>[</kbd> 좌측 패널</div>
            <div><kbd>]</kbd> 우측 패널</div>
            <div><kbd>/</kbd> 검색</div>
            <div><kbd>D</kbd> 다크모드</div>
            <div><kbd>?</kbd> 도움말</div>
            <div><kbd>Esc</kbd> 닫기</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
  }

  // 키 이벤트 등록
  document.addEventListener('keydown', function(e) {
    // input/textarea/select 안에서는 무시
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target.isContentEditable) return;
    
    // ctrl/cmd/alt 키 조합은 무시
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();
    const handler = SHORTCUTS[key];
    if (handler) {
      handler(e);
    } else if (e.key === 'Escape') {
      // ESC: 도움말 닫기
      const help = document.getElementById('shortcutHelp');
      if (help) help.style.display = 'none';
    }
  });

  console.log('[shortcuts] Keyboard shortcuts active - press ? for help');
})();
