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

// ═══ 실서비스 UX 고도화: 빠른 시작 + 모바일 퀵액션 + 온보딩 퍼널 ═══
(function () {
  function trackUx(name, payload) {
    try {
      if (window.dataLayer && typeof window.dataLayer.push === 'function') {
        window.dataLayer.push({ event: name, ...payload });
      }
      if (typeof window.gtag === 'function') {
        window.gtag('event', name, payload || {});
      }
    } catch (_) {}
  }

  function markFunnelStep(step, payload) {
    try {
      const key = 'chartOS_onboardingSteps';
      const raw = sessionStorage.getItem(key) || '';
      const steps = raw ? raw.split(',') : [];
      if (steps.includes(step)) return;
      steps.push(step);
      sessionStorage.setItem(key, steps.join(','));
      trackUx('superchart_onboarding_step', { step, ...payload, depth: steps.length });
    } catch (_) {}
  }

  function setTip(text) {
    const tip = document.getElementById('quickStartTip');
    if (tip) tip.innerHTML = text;
  }

  function openRightPaneAI() {
    const aiTab = document.querySelector('.right-tab[data-p="ai"]');
    aiTab && aiTab.click();
    if (window.innerWidth <= 980) {
      const mnRight = document.getElementById('mnRight');
      mnRight && mnRight.click();
    }
    markFunnelStep('ai_tab_open');
  }

  function setTimeframe(tf) {
    const tfBtn = document.querySelector('.tb[data-tf="' + tf + '"]');
    tfBtn && tfBtn.click();
    markFunnelStep('timeframe_select', { timeframe: tf });
  }

  function focusSearch() {
    const leftOpenBtn = document.querySelector('[data-action="toggleLeft"]');
    if (window.innerWidth <= 980 && leftOpenBtn) leftOpenBtn.click();
    window.setTimeout(function () {
      const search = document.getElementById('searchInput');
      if (search) {
        search.focus();
        search.select && search.select();
      }
    }, 90);
  }

  function clickSignupEntry() {
    const loginCta = document.getElementById('loginCta');
    const heroStart = document.getElementById('heroStart');
    if (loginCta && !loginCta.classList.contains('d-none')) {
      loginCta.click();
    } else if (heroStart) {
      heroStart.click();
    }
    markFunnelStep('signup_click');
  }

  function toggleBeginner() {
    const on = !document.body.classList.contains('beginner-focus');
    document.body.classList.toggle('beginner-focus', on);
    localStorage.setItem('chartOS_beginnerFocus', on ? '1' : '0');
    setTip(
      on
        ? '초보 집중 모드가 활성화되었습니다. 핵심 조작(종목/타임프레임/AI 분석) 중심으로 화면을 단순화합니다.'
        : '초보 집중 모드를 해제했습니다. 고급 도구를 다시 모두 표시합니다.'
    );
    trackUx('superchart_beginner_focus_toggled', { enabled: on ? 1 : 0 });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const dock = document.getElementById('quickStartDock');
    const mobileQuick = document.getElementById('mobileQuickActions');
    if (!dock && !mobileQuick) return;
    const isMobileView = window.innerWidth <= 980;

    // 모바일 레이아웃 안정성 우선: 실험 UI 비활성화
    if (isMobileView) {
      if (dock) dock.hidden = true;
      if (mobileQuick) mobileQuick.hidden = true;
    }

    markFunnelStep('visit');

    const dismissed = localStorage.getItem('chartOS_quickStartDismissed') === '1';
    if (dock) dock.hidden = isMobileView ? true : dismissed;

    const beginnerOn = localStorage.getItem('chartOS_beginnerFocus') === '1';
    if (beginnerOn) document.body.classList.add('beginner-focus');

    const seenCount = Number(localStorage.getItem('chartOS_quickStartSeen') || '0') + 1;
    localStorage.setItem('chartOS_quickStartSeen', String(seenCount));

    if (!dismissed && !isMobileView) {
      trackUx('superchart_quick_start_shown', { visit_count: seenCount });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('focus', function () {
        markFunnelStep('search_focus');
      });
    }

    document.addEventListener('click', function (e) {
      const tfBtn = e.target.closest('.tb[data-tf]');
      if (tfBtn && tfBtn.dataset.tf) {
        markFunnelStep('timeframe_select', { timeframe: tfBtn.dataset.tf });
      }

      const aiTab = e.target.closest('.right-tab[data-p="ai"]');
      if (aiTab) {
        markFunnelStep('ai_tab_open');
      }

      if (e.target.closest('#loginCta') || e.target.closest('#heroStart')) {
        markFunnelStep('signup_click');
      }

      if (e.target.closest('#aiIndRunBtn')) {
        markFunnelStep('ai_analysis_run');
        trackUx('superchart_ai_analysis_run', { source: 'ai_panel' });
      }
    });

    dock && dock.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-quick-action]');
      if (!btn) return;
      const action = btn.dataset.quickAction;

      switch (action) {
        case 'search':
          focusSearch();
          setTip('종목 검색창으로 이동했습니다. 예: BTC, ETH, NVDA, GOLD');
          trackUx('superchart_quick_start_click', { action: 'search' });
          markFunnelStep('search_focus');
          break;
        case 'tf-5m':
          setTimeframe('5m');
          setTip('5분봉으로 전환했습니다. 단기 진입 타이밍 확인에 적합합니다.');
          trackUx('superchart_quick_start_click', { action: 'tf_5m' });
          break;
        case 'open-ai':
          openRightPaneAI();
          setTip('AI 분석 탭을 열었습니다. 지표 요약과 진입 시그널을 먼저 확인하세요.');
          trackUx('superchart_quick_start_click', { action: 'open_ai' });
          break;
        case 'beginner':
          toggleBeginner();
          break;
        case 'signup':
          clickSignupEntry();
          setTip('회원가입/로그인 화면으로 이동합니다. 저장 기능과 개인화 기능을 사용할 수 있습니다.');
          trackUx('superchart_quick_start_click', { action: 'signup' });
          break;
        case 'dismiss':
          dock.hidden = true;
          localStorage.setItem('chartOS_quickStartDismissed', '1');
          trackUx('superchart_quick_start_dismissed', {});
          break;
      }
    });

    if (mobileQuick) {
      mobileQuick.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-mobile-action]');
        if (!btn) return;
        const action = btn.dataset.mobileAction;

        if (action === 'search') {
          focusSearch();
          setTip('모바일 종목 검색으로 이동했습니다.');
        } else if (action === 'ai') {
          openRightPaneAI();
          setTip('모바일 AI 분석 탭을 열었습니다.');
        } else if (action === 'guide') {
          if (dock) dock.hidden = false;
          localStorage.removeItem('chartOS_quickStartDismissed');
          setTip('빠른 시작 가이드를 다시 열었습니다.');
        } else if (action === 'signup') {
          clickSignupEntry();
          setTip('회원가입/로그인 화면으로 이동합니다.');
        }

        trackUx('superchart_mobile_quick_action', { action });
      });
    }

    (function runIndicatorResidueSelfTest() {
      let qaMode = '';
      try {
        qaMode = new URLSearchParams(window.location.search).get('qa') || '';
      } catch (_) {
        return;
      }
      if (qaMode !== 'indicator' && qaMode !== '1') return;

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const clickToggle = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        el.click();
        return true;
      };

      async function run() {
        await wait(1200);
        const steps = [
          { name: 'RSI', selector: '[data-sub="rsi"]' },
          { name: 'MACD', selector: '[data-sub="macd"]' },
          { name: '볼린저', selector: '[data-ind="bb"]' },
          { name: '피봇', selector: '[data-ind="pivot"]' },
          { name: '거래량분포', selector: '[data-ind="volprofile"]' }
        ];

        const report = [];

        for (const step of steps) {
          const onClicked = clickToggle(step.selector);
          await wait(260);
          if (typeof window.calcIndicators === 'function') window.calcIndicators();
          await wait(220);

          const offClicked = clickToggle(step.selector);
          await wait(260);
          if (typeof window.calcIndicators === 'function') window.calcIndicators();
          await wait(220);

          let probe = null;
          if (typeof window.__indicatorResidueProbe === 'function') {
            probe = window.__indicatorResidueProbe();
          }

          report.push({
            indicator: step.name,
            selector: step.selector,
            onClicked,
            offClicked,
            probe
          });
        }

        try {
          window.__qaIndicatorResidueReport = report;
          console.log('[QA][indicator-residue] report', report);
          console.log('[QA][indicator-residue] report-json', JSON.stringify(report));
          trackUx('superchart_indicator_residue_selftest', {
            mode: qaMode,
            steps: report.length
          });
        } catch (_) {}
      }

      run();
    })();
  });
})();
