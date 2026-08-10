/* ============================================================
   미구현 버튼 안내
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   문제
   ----
   화면에 버튼이 있는데 눌러도 아무 일이 없으면 사용자는 고장이라고 생각한다.
   그리고 무엇이 되고 무엇이 안 되는지 알 수 없어 서비스 전체를 의심한다.

   해결
   ----
   배선되지 않은 버튼을 눌렀을 때 "준비 중"임을 알린다. 버튼을 지우지 않는다 —
   디자이너 산출물을 보존하는 것이 계약이고, 기능 목록을 보여주는 가치도 있다.

   왜 개별 onClick 이 아니라 위임인가
   -------------------------------
   대상이 80개가 넘는다. 각 버튼에 핸들러를 붙이면 디자이너 마크업을 80곳
   수정해야 하고, 나중에 배선할 때 그 코드를 다시 지워야 한다.
   문서 수준에서 클릭을 위임하면 마크업을 한 줄도 건드리지 않는다.

   ★ 이미 동작하는 버튼을 방해하지 않는다
   React 의 onClick 은 DOM 속성이 아니라 합성 이벤트다. 즉 `el.onclick` 으로는
   배선 여부를 알 수 없다. 그래서 "동작하는 버튼 목록" 을 뒤지는 대신,
   **눌린 뒤에 화면이 아무 반응을 하지 않았는지** 를 보는 방식도 쓸 수 없다.
   대신 배선된 버튼에 표시(data-qt-wired)를 남기고, 표시가 없는 것만 안내한다.
   ============================================================ */

(function () {
  'use strict';

  function t(key, vars) {
    return window.QTI18n ? window.QTI18n.t(key, vars) : key;
  }

  /**
   * 안내를 띄우지 않을 버튼.
   *
   * 이 선택자에 걸리는 버튼은 이미 배선돼 있거나, 컨테이너를 여는 등
   * 자체 동작이 있다. 목록을 좁게 유지한다 — 넓게 잡으면 미구현 버튼이
   * 조용히 지나간다.
   */
  var WIRED_SELECTORS = [
    // 차트 도구 (chart-actions.js)
    '.chart-drawtools button',
    '.chart-tool',
    '.chart-tf__btn',
    // 지표·비교·템플릿 패널 내부
    '.chart-ind-panel button',
    '.chart-ind-row',
    // 거래 모드·주문 입력 (app.jsx, widgets.jsx)
    '.seg__opt',
    '.oe-tab',
    '.oe-buttons button',
    // 하단 탭·취소
    '.pos-tabs .tab',
    '.pos-tabs__right button',
    '.pos-body button',
    // 헤더
    '.app-header button',
    '.qt-drawer-toggle',
    '.role-switcher__opt',
    // 사이드바·페이지 이동
    '.sb-item-v2',
    '.app-sidebar button',
    '.sidebar-item',
    // 인증 화면 (pages-auth.jsx)
    '.auth-form button',
    // 마켓 목록
    '.mw-tab',
    '.mw-row',
    // 구현 상태 배지
    '.qt-prov-badge__toggle',
    // 모달 닫기·확인
    '.modal button',
    // 관리자 화면 (admin-data.js 로 배선된 것)
    '.admin-shell button',
  ];

  /** 안내 문구를 고르는 규칙. 버튼 내용으로 무엇을 하려던 것인지 추측한다. */
  var HINTS = [
    { match: /export|내보내기|csv/i, key: 'pending_export' },
    { match: /backtest|백테스트/i, key: 'pending_backtest' },
    { match: /strategy|전략|follow|팔로우/i, key: 'pending_strategy' },
    { match: /kakao|telegram|twitter|email|초대|공유|share/i, key: 'pending_share' },
    { match: /deposit|withdraw|입금|출금|send|receive|transfer/i, key: 'pending_transfer' },
    { match: /api ?key|키 추가|add key|revoke/i, key: 'pending_apikey' },
    { match: /approve|reject|승인|거절/i, key: 'pending_approval' },
    { match: /tp\/sl|margin|증거금|calculator/i, key: 'pending_position_tool' },
    { match: /ai|review|generate/i, key: 'pending_ai' },
    { match: /filter|필터|sync|동기화/i, key: 'pending_filter' },
  ];

  function hintFor(label) {
    for (var i = 0; i < HINTS.length; i += 1) {
      if (HINTS[i].match.test(label)) return HINTS[i].key;
    }
    return 'pending_generic';
  }

  function isWired(el) {
    for (var i = 0; i < WIRED_SELECTORS.length; i += 1) {
      try {
        if (el.closest(WIRED_SELECTORS[i]) || el.matches(WIRED_SELECTORS[i])) return true;
      } catch (e) { /* 잘못된 선택자는 건너뛴다 */ }
    }
    /*
       form 제출 버튼은 자체 동작이 있다.

       ★ el.type 을 보면 안 된다 — <button> 의 기본값이 'submit' 이라서
         모든 버튼이 제출 버튼으로 판정된다(실제로 겪었다 — 안내가 전혀 뜨지 않았다).
         속성이 **명시된** 경우만, 그리고 실제로 form 안에 있을 때만 인정한다.
    */
    if (el.getAttribute('type') === 'submit' && el.closest('form')) return true;
    // 링크를 감싼 버튼은 이동 동작이 있다.
    if (el.closest('a')) return true;
    // 명시적으로 배선됐다고 표시한 것.
    if (el.hasAttribute('data-qt-wired')) return true;
    return false;
  }

  /** 최근에 안내한 버튼. 같은 버튼을 연타할 때 토스트가 쌓이지 않게 한다. */
  var lastNotified = { el: null, at: 0 };

  /*
     배선 여부를 어떻게 아는가 — 이것이 이 파일의 핵심 난제다.

     React 의 onClick 은 DOM 속성이 아니라 합성 이벤트다. 그래서 `el.onclick` 은
     항상 null 이고, 선택자 목록만으로는 배선된 버튼을 다 잡을 수 없다
     (실제로 'Connect API' 처럼 onClick 이 있는 버튼이 목록에서 빠졌다).

     그래서 **결과를 보고 판단한다.**
     클릭을 처리한 버튼은 거의 항상 화면을 바꾼다 — 상태 변경, 모달 열기,
     라우트 이동, 토스트. 클릭 직후 한 프레임 뒤에 아무 변화가 없으면
     그 버튼은 아무 일도 하지 않은 것이다.

     이 방식은 선택자 목록을 관리하지 않아도 되고, 새 기능을 배선하면
     자동으로 안내 대상에서 빠진다.
  */

  /** 화면 상태의 지문. 값이 바뀌면 무언가 일어난 것이다. */
  function snapshot() {
    return [
      location.hash,
      document.querySelectorAll('.toast').length,
      document.querySelectorAll('.overlay, .modal, [class*="panel"][class*="open"], .chart-ind-panel').length,
      // 클래스 변화(is-active 토글 등)를 값싸게 잡는다.
      document.body.className,
      document.documentElement.dataset.theme,
      document.documentElement.dataset.density,
      // 표·목록 행 수 변화
      document.querySelectorAll('tbody tr').length,
      document.querySelectorAll('.seg__opt.is-active, .tab.is-active').length,
      /*
         ★ 패널을 접거나 펼치는 동작은 위의 어느 값도 바꾸지 않는다. 그래서
           실제로 잘 동작하는 코파일럿 접기 버튼이 "아직 준비되지 않았습니다"
           로 잘못 안내됐다(실측으로 확인). 접힘으로 사라지는 본문 요소를
           세어 지문에 넣는다.

         ★ 이런 오탐은 그냥 불편한 정도가 아니다 — 사용자가 "이 기능은 아직
           안 되는구나" 하고 다시 쓰지 않게 된다.
      */
      document.querySelectorAll('.ai-messages, .ai-input, .ai-layers').length,
      // aria-expanded 로 접힘 상태를 밝히는 버튼들(패널 토글의 표준 표기).
      [].map.call(document.querySelectorAll('[aria-expanded]'), function (e) {
        return e.getAttribute('aria-expanded');
      }).join(','),
    ].join('|');
  }

  document.addEventListener(
    'click',
    function (e) {
      var el = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!el || el.disabled) return;
      // 명백히 배선된 영역은 바로 제외한다 (불필요한 관찰을 줄인다).
      if (isWired(el)) return;

      var now = Date.now();
      if (lastNotified.el === el && now - lastNotified.at < 2500) return;

      var before = snapshot();
      var beforeActive = el.className;

      /*
         React 가 상태를 반영할 시간을 준다.

         너무 짧으면 배선된 버튼도 "반응 없음" 으로 오판하고, 너무 길면
         사용자가 안내를 늦게 본다. 리렌더 두 프레임 정도면 충분하다.
      */
      setTimeout(function () {
        if (before !== snapshot() || beforeActive !== el.className) return; // 무언가 일어났다
        if (!window.QTToast) return;

        lastNotified = { el: el, at: Date.now() };
        var label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
        window.QTToast({
          title: label ? t('pending_title_named', { label: label }) : t('pending_title'),
          desc: t(hintFor(label)),
          variant: 'info',
          duration: 5000,
        });
      }, 220);
    },
    false,
  );

  window.QTPending = {
    WIRED_SELECTORS: WIRED_SELECTORS,
    isWired: isWired,
    hintFor: hintFor,

    /**
     * 진단용 **추정치**. 선택자 목록만으로 세므로 React onClick 이 붙은 버튼도
     * 포함된다. 실제 안내는 클릭 후 화면 변화를 보고 판단하므로 이 수보다 적다.
     * 정확한 수를 알려면 실제로 눌러봐야 한다.
     */
    audit: function () {
      var all = [...document.querySelectorAll('button')];
      var pending = all.filter(function (el) { return !isWired(el) && !el.disabled; });
      return {
        total: all.length,
        pending: pending.length,
        labels: pending.map(function (el) {
          return (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 26) || '(라벨없음)';
        }),
      };
    },
  };
})();
