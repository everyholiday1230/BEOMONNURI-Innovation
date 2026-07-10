// 비로그인(게스트) 모드 자동 토글 + 잠금 UI 주입
// body에 .guest-mode 클래스 → CSS로 회원전용 컨텐츠 숨김
// 각 회원전용 탭에 안내 화면 자동 주입

(function() {
  'use strict';

  const LOCKED_PANES = [
    { id: 'llm', title: '나만의 신호', desc: '지표를 골라 나만의 매매 신호를 만들어 차트에 표시합니다' },
    { id: 'hot', title: '인기·트렌드', desc: '24시간 거래량·변동성 상위 종목을 확인합니다' },
    { id: 'heatmap', title: '시장 히트맵', desc: '전 종목 등락률을 한눈에 확인합니다' },
    { id: 'similar', title: '유사 패턴 검색', desc: '과거 유사한 차트 패턴을 자동으로 찾습니다' },
    { id: 'order', title: '모의 주문', desc: '가상 자금으로 매매 연습이 가능합니다' },
    { id: 'points', title: '포인트·초대', desc: '포인트 적립·사용과 친구 초대 보상을 관리합니다' },
  ];

  function buildLockedHTML(title, desc) {
    return `
      <div class="guest-locked">
        <div class="guest-locked-icon">!</div>
        <div class="guest-locked-title">${title}</div>
        <div class="guest-locked-desc">회원 전용 기능입니다.<br>${desc}</div>
        <div class="guest-locked-actions">
          <button class="btn-uniform btn-uniform-primary" onclick="window.showAuth?.()">로그인</button>
          <button class="btn-uniform btn-uniform-secondary" onclick="window.showAuth?.('register')">회원가입</button>
        </div>
      </div>
    `;
  }

  function injectLockedScreens() {
    LOCKED_PANES.forEach(({ id, title, desc }) => {
      const pane = document.getElementById(id);
      if (!pane) return;
      // 이미 안내 있으면 스킵
      if (pane.querySelector('.guest-locked')) return;
      const lockedHtml = buildLockedHTML(title, desc);
      // 패널 첫 번째 자식 앞에 삽입
      pane.insertAdjacentHTML('afterbegin', lockedHtml);
    });
  }

  function applyGuestMode() {
    const isGuest = !window.isLoggedIn || !window.isLoggedIn();
    document.body.classList.toggle('guest-mode', isGuest);
  }

  // 초기 한 번
  function init() {
    injectLockedScreens();
    applyGuestMode();
  }

  // DOM 준비 후
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 로그인 상태 변경 시 자동 갱신
  // refreshAuthState 후 호출되도록 주기적 체크 (자정한 timer)
  let lastAuthState = null;
  setInterval(() => {
    const cur = window.isLoggedIn?.() || false;
    if (cur !== lastAuthState) {
      lastAuthState = cur;
      applyGuestMode();
      // 로그인되면 잠금 화면 제거
      if (cur) {
        document.querySelectorAll('.guest-locked').forEach(el => el.remove());
      } else {
        // 로그아웃되면 다시 잠금 주입
        injectLockedScreens();
      }
    }
  }, 500);

  // 외부에서 즉시 갱신용
  window._refreshGuestMode = function() {
    applyGuestMode();
    if (window.isLoggedIn?.()) {
      document.querySelectorAll('.guest-locked').forEach(el => el.remove());
    } else {
      injectLockedScreens();
    }
  };

  // ─────────── 전역 클릭 캡처 차단 (모든 회원전용 요소) ───────────
  // capturing phase로 등록 → 다른 onclick보다 먼저 실행
  document.addEventListener('click', function(e) {
    if (window.isLoggedIn?.()) return;  // 로그인 상태면 통과
    
    const target = e.target.closest(
      // 지표(범온지표 포함)·보조지표·이동평균 — 클래스 기반으로 전부 커버(속성 유무 무관)
      '.ind-tag, .sub-ind, [data-ind], [data-sub], [data-ma-type], ' +
      // 매매전략·드로잉·프리셋
      '[data-strategy], [data-draw], [data-action="applyPreset"], ' +
      // 저장/캡처 등
      '[data-action="captureChart"], [data-action="saveSettings"], ' +
      '[data-action="saveWorkspace"], [data-action="saveUserPreset"], ' +
      // 분석·차트 기능도 회원 전용 (예측·투영·리플레이·차트 도구·나만의 신호)
      '[data-action="startForecast"], [data-action="startProjection"], ' +
      '[data-action="clearForecast"], [data-action="startReplayMode"], ' +
      '[data-action="stopReplayMode"], [data-action="replayFwd1"], ' +
      '[data-action="replayFwd10"], [data-action="replayBack1"], ' +
      '[data-action="replayBack10"], [data-action="replaySpeedUp"], ' +
      '[data-action="replaySpeedDown"], [data-action="toggleLogScale"], ' +
      '[data-action="toggleMagnet"], [data-action="buy"], ' +
      '[data-action="sell"], [data-action="zone"], ' +
      '.sb-preset, #sbAddCond, #sbRun'
    );
    if (!target) return;
    
    // 비로그인 차단
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const name = target.textContent.replace(/[\s]+$/g, '').trim() || '회원 전용 기능';
    if (typeof window.showMemberOnlyNotice === 'function') {
      window.showMemberOnlyNotice(name);
    } else {
      window.showToast?.('회원 전용 기능입니다. 로그인 후 이용해주세요.', '#921230');
      window.showAuth?.();
    }
    return false;
  }, true);  // capture=true → 가장 먼저 실행

  // 페이지 로드 시 비로그인이면 모든 .on 클래스 제거 + 차트 비우기
  function clearGuestState() {
    if (window.isLoggedIn?.()) return;
    document.querySelectorAll('.ind-tag.on, .sub-ind.on').forEach(el => el.classList.remove('on'));
    if (window.chart) {
      try {
        for (const k of Object.keys(window.chart.indicators || {})) {
          window.chart.removeIndicator(k);
        }
        if (window.chart.subCharts) {
          for (const k of Object.keys(window.chart.subCharts)) {
            window.chart.removeSubChart?.(k);
          }
        }
        window.chart.overlay.drawings = [];
        window.chart._uc = null;
        window.chart._bc = null;
        window.chart._uf = null;
        window.chart._dirty = true;
      } catch (e) {}
    }
  }

  // 초기 한 번 + 5초마다 (안전망)
  setTimeout(clearGuestState, 1500);
  setInterval(clearGuestState, 5000);

  // 로그인 상태 변경 감지에 clearGuestState 추가
  setInterval(() => {
    const cur = window.isLoggedIn?.() || false;
    if (!cur) clearGuestState();
  }, 2000);
})();
