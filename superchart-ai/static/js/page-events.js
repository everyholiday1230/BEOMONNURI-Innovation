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

  function openRightPaneHot() {
    const hotTab = document.querySelector('.right-tab[data-p="hot"]');
    hotTab && hotTab.click();
    if (window.innerWidth <= 980) {
      const mnRight = document.getElementById('mnRight');
      mnRight && mnRight.click();
    }
    markFunnelStep('hot_tab_open');
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

  function _syncBeginnerButtonState() {
    const beginnerBtn = document.getElementById('quickStartBeginner');
    if (!beginnerBtn) return;
    const on = document.body.classList.contains('beginner-focus');
    beginnerBtn.classList.toggle('is-active', on);
    beginnerBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function toggleBeginner() {
    const on = !document.body.classList.contains('beginner-focus');
    document.body.classList.toggle('beginner-focus', on);
    localStorage.setItem('chartOS_beginnerFocus', on ? '1' : '0');
    _syncBeginnerButtonState();
    setTip(
      on
        ? '초보 집중 모드가 활성화되었습니다. 핵심 조작(종목/타임프레임/AI 분석) 중심으로 화면을 단순화합니다.'
        : '초보 집중 모드를 해제했습니다. 고급 도구를 다시 모두 표시합니다.'
    );
    trackUx('superchart_beginner_focus_toggled', { enabled: on ? 1 : 0 });
  }

  function _isNativeInteractive(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'summary';
  }

  function _enhanceKeyboardA11y() {
    const selectors = [
      '.tb[data-tf]',
      '.asset-tab',
      '.right-tab',
      '.ind-tag',
      '.tb-layout',
      '[data-quick-action]',
      '[data-mobile-action]'
    ];
    const nodes = document.querySelectorAll(selectors.join(','));
    nodes.forEach(function (node) {
      if (_isNativeInteractive(node)) return;
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
      if (!node.hasAttribute('role')) node.setAttribute('role', 'button');
      node.dataset.keyboardClick = '1';
    });
  }

  function _isTypingContext(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (el.isContentEditable) return true;
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function _isElementVisible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    const st = window.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  }

  function _syncQuickStartVisibility(dock, mobileQuick, isMobileView, dismissed) {
    if (dock) {
      dock.hidden = isMobileView ? true : dismissed;
      dock.setAttribute('aria-hidden', dock.hidden ? 'true' : 'false');
    }
    if (mobileQuick) {
      mobileQuick.hidden = !isMobileView || dismissed;
      mobileQuick.setAttribute('aria-hidden', mobileQuick.hidden ? 'true' : 'false');
    }
  }

  function _setupHeroDialogA11y() {
    const overlay = document.getElementById('heroOverlay');
    const closeBtn = document.getElementById('heroClose');
    if (!_isElementVisible(overlay)) return;

    const focusables = overlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0] || closeBtn;
    first && first.focus && first.focus();
  }

  document.addEventListener('keydown', function (e) {
    const target = e.target;

    if ((e.key === 'Enter' || e.key === ' ') && target && target.dataset && target.dataset.keyboardClick === '1') {
      e.preventDefault();
      target.click && target.click();
      return;
    }

    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !_isTypingContext(target)) {
      e.preventDefault();
      focusSearch();
      return;
    }

    if (e.key === 'Escape') {
      const overlay = document.getElementById('heroOverlay');
      const heroClose = document.getElementById('heroClose');
      if (_isElementVisible(overlay) && heroClose) {
        heroClose.click();
        return;
      }

      const dock = document.getElementById('quickStartDock');
      if (dock && !dock.hidden) {
        dock.hidden = true;
        dock.setAttribute('aria-hidden', 'true');
        localStorage.setItem('chartOS_quickStartDismissed', '1');
      }
      return;
    }

    if (e.key === 'Tab') {
      const overlay = document.getElementById('heroOverlay');
      if (!_isElementVisible(overlay)) return;

      const focusables = Array.from(
        overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(function (el) {
        return _isElementVisible(el) && !el.disabled;
      });
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    _enhanceKeyboardA11y();
    const dock = document.getElementById('quickStartDock');
    const mobileQuick = document.getElementById('mobileQuickActions');
    if (!dock && !mobileQuick) return;
    _setupHeroDialogA11y();

    let isMobileView = window.innerWidth <= 980;

    markFunnelStep('visit');

    const dismissed = localStorage.getItem('chartOS_quickStartDismissed') === '1';
    _syncQuickStartVisibility(dock, mobileQuick, isMobileView, dismissed);

    const beginnerOn = localStorage.getItem('chartOS_beginnerFocus') === '1';
    if (beginnerOn) document.body.classList.add('beginner-focus');
    _syncBeginnerButtonState();

    const seenCount = Number(localStorage.getItem('chartOS_quickStartSeen') || '0') + 1;
    localStorage.setItem('chartOS_quickStartSeen', String(seenCount));

    if (!dismissed && !isMobileView) {
      trackUx('superchart_quick_start_shown', { visit_count: seenCount });
      if (seenCount === 1 && dock) {
        const firstActionBtn = dock.querySelector('[data-quick-action="search"]');
        if (firstActionBtn) {
          firstActionBtn.classList.add('is-active');
          window.setTimeout(function () {
            firstActionBtn.classList.remove('is-active');
          }, 4200);
        }
        setTip('처음 방문이라면 1) 종목 찾기 → 2) 5분봉 → 3) AI 분석 순서로 시작해보세요.');
        trackUx('superchart_quick_start_nudge', { variant: 'first_visit_search' });
      }
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

      if (e.target.closest('#loginCta') || e.target.closest('#heroStart')) {
        markFunnelStep('signup_click');
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
        case 'open-hot':
          openRightPaneHot();
          setTip('인기 TOP 탭을 열었습니다. 시장 관심도 랭킹을 확인하세요.');
          trackUx('superchart_quick_start_click', { action: 'open_hot' });
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
          _syncQuickStartVisibility(dock, mobileQuick, isMobileView, true);
          localStorage.setItem('chartOS_quickStartDismissed', '1');
          trackUx('superchart_quick_start_dismissed', {});
          break;
      }
    });

    let resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        const nextMobile = window.innerWidth <= 980;
        if (nextMobile === isMobileView) return;
        isMobileView = nextMobile;
        const dismissedNow = localStorage.getItem('chartOS_quickStartDismissed') === '1';
        _syncQuickStartVisibility(dock, mobileQuick, isMobileView, dismissedNow);
        trackUx('superchart_viewport_mode_changed', { mobile: isMobileView ? 1 : 0 });
      }, 120);
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
          openRightPaneHot();
          setTip('모바일 인기 TOP 탭을 열었습니다.');
        } else if (action === 'guide') {
          localStorage.removeItem('chartOS_quickStartDismissed');
          isMobileView = window.innerWidth <= 980;
          _syncQuickStartVisibility(dock, mobileQuick, isMobileView, false);
          if (isMobileView && typeof window.openHelp === 'function') {
            window.openHelp();
          }
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

// ═══ 우측(분석) 패널 접기/펼치기 — 접으면 차트가 자동 확장 ═══
(function () {
  function resizeCharts() {
    // 패널 폭 변경 후 차트 캔버스를 새 영역에 맞춰 다시 그림
    [window.chart, window.chart2, window.chart3, window.chart4].forEach(function (c) {
      try { c && typeof c.resize === 'function' && c.resize(); if (c) c._dirty = true; } catch (_) {}
    });
  }

  window._toggleRightPanelBtn = function () {
    const right = document.querySelector('.right');
    const btn = document.getElementById('rightPanelToggle');
    if (!right) return;
    const collapsed = right.classList.toggle('collapsed');
    document.body.classList.toggle('right-collapsed', collapsed);
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('title', collapsed ? '분석 패널 펼치기' : '분석 패널 접기');
      btn.setAttribute('aria-label', collapsed ? '분석 패널 펼치기' : '분석 패널 접기');
    }
    // 레이아웃(flex) 적용 후 다음 프레임에 차트 리사이즈
    window.requestAnimationFrame(function () { window.setTimeout(resizeCharts, 60); });
  };
})();
