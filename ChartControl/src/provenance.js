/* ============================================================
   구현 상태 표시 (Provenance)
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   무엇을 하는가
   -----------
   화면의 각 부분이 **실데이터인지 목업인지** 눈으로 구분되게 표시한다.
   개발이 진행되면서 어떤 화면은 실제로 동작하고 어떤 화면은 아직 목업인데,
   섞여 있으면 구분이 불가능하다. 목업을 실제로 착각하면 잘못된 판단을 한다.

   왜 별도 레지스트리인가
   -------------------
   상태를 각 컴포넌트에 흩뿌리면 배선이 끝났는데 표시가 남거나, 반대로 아직
   목업인데 실제로 표시되는 일이 생긴다. 그게 표시가 없는 것보다 나쁘다.
   그래서 **한 파일에 모아** 관리한다. 화면 배선을 끝낼 때 여기 한 줄만 고친다.

   디자이너 산출물 불가침
   -------------------
   기존 마크업·CSS 를 수정하지 않는다. 이 파일이 런타임에 겉면 표시만 덧붙이고,
   끄면 원래 화면과 완전히 같아진다. 기본값은 켜짐 — 개발 중에는 보이는 것이
   목적이기 때문이다. 헤더 배지를 눌러 끌 수 있다.

   상태 정의
   --------
   live     실 백엔드에 배선됨. 표시되는 값이 진짜다.
   partial  일부만 실제다. 무엇이 아직 목업인지 note 에 적는다.
   mock     아직 목업이다. 화면만 있고 기능이 없다.
   ============================================================ */

(function () {
  'use strict';

  var STORAGE_KEY = 'qt.provenance';

  /**
   * 라우트별 구현 상태.
   *
   * ★ 배선을 끝내면 여기를 반드시 갱신한다. 갱신을 잊으면 이 표시가 거짓이 되고,
   *   거짓 표시는 표시가 없는 것보다 나쁘다.
   *
   * 기준일: 2026-08-06
   */
  var ROUTES = {
    // ---- 인증 (실 API 배선 완료) ----
    '/login': { status: 'live', note: 'auth_wired' },
    '/signup': { status: 'live', note: 'auth_wired' },
    '/verify-email': { status: 'live', note: 'auth_wired' },
    '/password-reset': { status: 'live', note: 'auth_wired' },
    '/kyc': { status: 'live', note: 'kyc_by_exchange' },
    '/': { status: 'partial', note: 'landing_static' },

    // ---- 거래 ----
    '/trade': { status: 'partial', note: 'trade_partial' },  // 차트·지표·비교·드로잉 실제 / 주문집행 시뮬레이션
    '/markets': { status: 'live', note: 'market_live' },

    // ---- 계정 ----
    '/portfolio': { status: 'partial', note: 'needs_api_key' },
    '/wallet': { status: 'partial', note: 'needs_api_key' },
    '/wallet/deposit': { status: 'live', note: 'non_custodial' },
    '/wallet/withdraw': { status: 'live', note: 'non_custodial' },
    '/wallet/transactions': { status: 'partial', note: 'needs_api_key' },
    '/order-history': { status: 'dynamic:account', note: 'needs_api_key' },
    '/analytics': { status: 'dynamic:account', note: 'needs_api_key' },
    '/settings': { status: 'partial', note: 'settings_partial' },

    // ---- 미구현 ----
    '/ai-strategies': { status: 'partial', note: 'ai_provider_off' },
    '/ai-strategies/detail': { status: 'partial', note: 'ai_provider_off' },
    '/ai-strategies/my': { status: 'partial', note: 'ai_provider_off' },
    '/referral': { status: 'partial', note: 'referral_manual_payout' },
    '/fees': { status: 'partial', note: 'fees_partial' },
    '/help': { status: 'live', note: 'support_wired' },
    '/notifications': { status: 'partial', note: 'notif_partial' },
  };

  /** 관리자 라우트는 전부 미구현이다. 개별로 적지 않고 접두사로 처리한다. */
  /*
     배선이 끝난 관리자 화면은 개별로 등록한다.
     접두사 규칙(/admin → mock)보다 개별 등록이 우선한다(routeStatus 참고).
  */
  ROUTES['/admin'] = { status: 'partial', note: 'admin_partial' };
  ROUTES['/admin/users'] = { status: 'dynamic:admin', note: 'admin_users_live' };
  ROUTES['/admin/users/detail'] = { status: 'dynamic:admin', note: 'admin_users_live' };
  ROUTES['/admin/audit'] = { status: 'dynamic:admin', note: 'admin_audit_live' };
  // 공지 — 실 저장·게시. Postgres 백엔드가 없으면 화면이 미지원을 알린다.
  ROUTES['/admin/notices'] = { status: 'dynamic:admin', note: 'admin_notices_live' };
  ROUTES['/admin/notices/new'] = { status: 'dynamic:admin', note: 'admin_notices_live' };
  /*
     입금·출금 — 비수탁 안내로 배선됨.

     '실데이터' 가 아니라 'partial' 이다. 거래소 잔고는 실제지만 입금 주소·출금
     실행은 우리에게 없다(있는 척하면 자금 사고가 난다). 그 사실을 화면이 알린다.
  */
  ROUTES['/wallet/deposit'] = { status: 'partial', note: 'noncustodial_guide' };
  ROUTES['/wallet/withdraw'] = { status: 'partial', note: 'noncustodial_guide' };

  /*
     이번 배선으로 실데이터가 된 화면들.

     ★ 이 목록을 갱신하지 않으면 완성된 기능이 계속 'MOCK' 배지를 달고,
       사용자와 운영자가 실제 값을 목업으로 오해한다. 반대로 목업이 실데이터
       배지를 달면 더 나쁘다 — 배선이 끝난 것만 여기 올린다.
  */
  // 본인 인증 — 신분서류를 받지 않는다는 사실을 알리는 화면 (구조적 결론)
  ROUTES['/kyc'] = { status: 'partial', note: 'kyc_not_required' };

  /*
     AI 전략 — 내장전략 4개 + 실 백테스트(수수료·슬리피지 차감).

     ★★ `dynamic:account` 였다. 그 판정은 **거래소 키 연결 여부**를 보는데,
       이 화면은 키와 무관하게 동작한다(전략 목록·백테스트는 공개 시세로 돈다).
       그래서 키가 없는 계정에는 'MOCK' 으로 표시됐다 — 실제로 동작하는 화면을
       목업이라고 말하는 거짓 표시다.

     ★ `partial` 인 이유: 전략·백테스트는 실제지만 **AI 분석 provider 가
       연결되지 않았다**(`aiProvider: unavailable`). 아직 확정이 아닌 부분이
       남아 있으므로 노란색으로 표시한다.
  */
  ROUTES['/ai-strategies'] = { status: 'partial', note: 'ai_provider_off' };
  ROUTES['/ai-strategies/detail'] = { status: 'partial', note: 'ai_provider_off' };
  ROUTES['/ai-strategies/my'] = { status: 'partial', note: 'ai_provider_off' };

  /*
     도움말 — FAQ + 실제 티켓 접수·답변.

     ★ 거래소 키와 무관하다(로그인만 필요). `dynamic:account` 로 두면 키가 없는
       사용자에게 목업으로 보인다.
  */
  ROUTES['/help'] = { status: 'live', note: 'support_wired' };

  // 관리자 — 실 API 배선 완료
  ROUTES['/admin/system'] = { status: 'dynamic:admin', note: 'admin_system_live' };
  ROUTES['/admin/trades'] = { status: 'dynamic:admin', note: 'admin_readonly_live' };
  ROUTES['/admin/risk'] = { status: 'dynamic:admin', note: 'admin_readonly_live' };
  ROUTES['/admin/fees'] = { status: 'dynamic:admin', note: 'admin_fees_live' };
  ROUTES['/admin/cs'] = { status: 'dynamic:admin', note: 'admin_cs_live' };
  ROUTES['/admin/broadcast'] = { status: 'dynamic:admin', note: 'admin_broadcast_live' };
  ROUTES['/admin/referral'] = { status: 'dynamic:admin', note: 'admin_referral_live' };
  ROUTES['/admin/ai-ops'] = { status: 'dynamic:admin', note: 'admin_aiops_live' };
  ROUTES['/admin/design-ops'] = { status: 'dynamic:admin', note: 'admin_dops_live' };

  /*
     구조상 해당 없는 화면 — 'partial' 로 둔다.

     'live' 가 아니다: 보여줄 실데이터가 있는 게 아니라 "그 기능이 없다" 는
     사실을 보여준다. 'mock' 도 아니다: 만들어낸 값이 하나도 없다.
  */
  ROUTES['/admin/kyc'] = { status: 'partial', note: 'na_by_design' };
  ROUTES['/admin/deposits'] = { status: 'partial', note: 'na_by_design' };
  ROUTES['/admin/withdrawals'] = { status: 'partial', note: 'na_by_design' };
  ROUTES['/admin/assets'] = { status: 'partial', note: 'na_by_design' };

  /*
     친구 초대 — 실제 제도.

     ★★ `dynamic:account` 였다. 그 판정은 **거래소 키 연결 여부**를 보는데,
       추천 제도는 키와 무관하다(로그인만 필요). 그래서 키가 없는 계정에는
       'MOCK' 으로 표시됐다.

     ★ `partial` 인 이유: 코드 발급·초대 현황은 실제지만 **적립 예정액을
       계산하지 않고 지급이 운영자 수동**이다. 자동화가 확정되지 않았으므로
       노란색으로 남긴다.
  */
  ROUTES['/referral'] = { status: 'partial', note: 'referral_manual_payout' };
  /*
     포인트 — 실제 원장(append-only, 행 잠금).

     ★ 거래소 키와 무관하다. `dynamic:account` 를 쓰면 키가 없는 계정에
       목업으로 보인다.

     ★ `partial` 인 이유: 적립·차감·잔액은 실제지만 **판매(결제)가 열려 있지
       않다**(결제 대행사 미연결). 그 부분이 확정되지 않았다.
  */
  ROUTES['/points'] = { status: 'partial', note: 'points_no_payment' };
  /*
     법적 문서 — 게시 여부에 따라 내용이 달라진다.

     'live' 로 두지 않는 이유: 게시되지 않았으면 문서가 없다고 표시한다.
     그 상태도 정직한 실제 상태다.
  */
  ROUTES['/terms'] = { status: 'dynamic:admin', note: 'legal_live' };
  ROUTES['/privacy'] = { status: 'dynamic:admin', note: 'legal_live' };
  ROUTES['/risk'] = { status: 'dynamic:admin', note: 'legal_live' };
  ROUTES['/security'] = { status: 'dynamic:admin', note: 'legal_live' };
  ROUTES['/admin/legal'] = { status: 'dynamic:admin', note: 'admin_legal_live' };
  ROUTES['/admin/points'] = { status: 'dynamic:admin', note: 'admin_points_live' };

  /*
     접두사 규칙.

     ★★ `/admin` 전체를 `mock` 으로 두고 있었다. 그런데 `access.js` 의
       `BUILT_ADMIN_ROUTES` 에는 배선 완료된 관리자 화면 22개가 등록돼 있다 —
       두 파일이 어긋난 채로 남아, 실제로 동작하는 화면에 "아직 목업" 이
       표시됐다. 운영자는 그 표시를 보고 실제 값을 의심한다.

     ★ 접근 판정(access.js)과 상태 표시(여기)가 같은 목록을 봐야 어긋나지
       않는다. 목록을 복제하지 않고 `access.js` 를 직접 조회한다.
  */
  var ROUTE_PREFIXES = [
    { prefix: '/admin', status: 'mock', note: 'admin_not_built' },
  ];

  /**
   * 관리자 화면의 상태를 `access.js` 기준으로 판정한다.
   *
   * ★ 배선 완료로 등록된 화면은 `live`. 아직 아닌 것만 `mock`.
   *   `access.js` 한 곳만 갱신하면 접근과 표시가 함께 맞는다.
   */
  function adminRouteStatus(path) {
    var A = window.QTAccess;
    if (!A || typeof A.isUndeveloped !== 'function') {
      // 판정할 수 없으면 안전한 쪽(아직 목업)으로 둔다.
      return { status: 'mock', note: 'admin_not_built' };
    }
    return A.isUndeveloped(path)
      ? { status: 'mock', note: 'admin_not_built' }
      : { status: 'live', note: 'admin_wired' };
  }

  /**
   * 화면 요소별 상태.
   *
   * selector 는 디자이너가 쓴 클래스명이다. 클래스명이 바뀌면 표시가 사라지므로
   * 정확해야 한다 (없는 선택자는 조용히 무시된다 — 화면을 깨뜨리지 않는다).
   */
  /**
   * 화면 요소별 상태.
   *
   * selector 는 디자이너가 쓴 클래스명·속성이다. 없는 선택자는 조용히 무시되므로
   * 화면을 깨뜨리지 않지만, 표시가 사라진다. 클래스명을 바꿀 때 함께 갱신할 것.
   *
   * status 에 'dynamic:account' 를 쓰면 실행 중에 판정한다 (API 키 연결 여부).
   */
  var ELEMENTS = [
    // ================= 거래 화면 위젯 (data-widget-type) =================
    // 위젯은 레이아웃 엔진이 data-widget-type 을 붙여준다. 가장 정확한 대상이다.
    { selector: '[data-widget-type="chart"]', status: 'live', note: 'chart_live' },
    { selector: '[data-widget-type="miniChart"]', status: 'live', note: 'chart_live' },
    { selector: '[data-widget-type="marketWatch"]', status: 'live', note: 'market_live' },
    { selector: '[data-widget-type="orderBook"]', status: 'live', note: 'book_live' },
    { selector: '[data-widget-type="recentTrades"]', status: 'live', note: 'trades_live' },
    // 주문 입력은 서버 검증까지 실제이고 집행만 시뮬레이션이다.
    { selector: '[data-widget-type="orderEntry"]', status: 'partial', note: 'order_sim' },
    // 포지션·자산은 API 키가 검증되면 실데이터가 된다.
    { selector: '[data-widget-type="positions"]', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '[data-widget-type="assetsRisk"]', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '[data-widget-type="aiCopilot"]', status: 'mock', note: 'ai_not_built' },

    /*
       포지션 위젯의 탭은 상태가 서로 다르다.
       위젯 하나로 뭉쳐 표시하면 "포지션은 배선됐는데 주문내역은 미구현" 인 사실이
       가려진다. 탭 버튼을 개별로 표시한다.

       DOM 순서에 의존한다(nth-of-type). 디자이너가 탭 순서를 바꾸면 함께 고쳐야 한다 —
       그래서 여기 한 곳에만 둔다.
    */
    { selector: '.pos-tabs .tab:nth-of-type(1)', status: 'dynamic:account', note: 'needs_api_key' },
    // 미체결·주문내역·체결내역·입출금내역 모두 배선 완료.
    // 키가 검증되면 실데이터, 아니면 예시가 표시된다 (dynamic 판정).
    { selector: '.pos-tabs .tab:nth-of-type(2)', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '.pos-tabs .tab:nth-of-type(3)', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '.pos-tabs .tab:nth-of-type(4)', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '.pos-tabs .tab:nth-of-type(5)', status: 'dynamic:account', note: 'needs_api_key' },
    { selector: '.pos-tabs .tab:nth-of-type(6)', status: 'mock', note: 'ai_not_built' },
    // 전량 청산·개별 취소 배선 완료. 키가 검증되면 실제로 취소된다.
    { selector: '.pos-tabs__right .btn--danger', status: 'dynamic:account', note: 'needs_api_key' },
    // 거래 모드: 선물·모의는 동작, 현물은 미지원(누르면 이유 안내).
    { selector: '.seg', status: 'partial', note: 'mode_partial' },

    // 차트 도구: 비교 기능이 배선됐다.
    { selector: '.chart-drawtools', status: 'live', note: 'draw_tools_live' },

    // ================= 실제 동작하는 것 =================
    { selector: '.chart-kline-wrap', status: 'live', note: 'chart_live' },
    { selector: '.conn-cluster', status: 'live', note: 'conn_live' },
    { selector: '.role-switcher', status: 'live', note: 'role_from_server' },
    // 차트 도구 모음: 타임프레임·지표·드로잉·스크린샷이 실제로 동작한다.
    { selector: '.chart-tf', status: 'live', note: 'chart_tools_live' },
    // 인증 화면의 입력 폼
    { selector: '.auth-form', status: 'live', note: 'auth_wired' },
    // 거래소 연결 마법사 (저장 + 실검증)
    { selector: '.wizard-progress', status: 'live', note: 'cred_wired' },
    // 언어·테마 토글
    { selector: '.header-tool[title="Language"]', status: 'live', note: 'i18n_live' },
    { selector: '.header-tool[title="Toggle theme"]', status: 'live', note: 'theme_live' },

    // ================= 미구현 버튼 =================
    // 알림 벨: 청산 위험 경고가 실 포지션에서 계산된다.
    { selector: '.header-tool--icon[title*="alert"], .header-tool--icon[title*="위험"], .header-tool--icon[title*="청산"]', status: 'dynamic:account', note: 'risk_alerts_live' },
    { selector: '.ai-copilot, [class*="copilot"]', status: 'mock', note: 'ai_not_built' },

    // ================= 목업 데이터 화면 =================
    // 관리자 화면 전체
    { selector: '.admin-shell, [class*="admin-"]', status: 'mock', note: 'admin_not_built' },
    // 거래 일지·성과 분석
    { selector: '.journal, [class*="journal"]', status: 'mock', note: 'not_built' },
    // AI 인사이트·신호 카드
    { selector: '[class*="signal-card"], [class*="insight"]', status: 'mock', note: 'ai_not_built' },
    // 알림·공지·티켓 목록
    { selector: '[class*="notif"], [class*="notice"], [class*="ticket"]', status: 'mock', note: 'not_built' },
    // 리퍼럴 링크
    { selector: '[class*="referral"]', status: 'mock', note: 'referral_not_built' },
    // 입출금
    { selector: '[class*="deposit"], [class*="withdraw"]', status: 'mock', note: 'not_built' },
    // 수수료·리베이트 표
    { selector: '[class*="fee-tier"], [class*="rebate"]', status: 'mock', note: 'not_built' },
    /*
       전략 카드·백테스트는 **실데이터**다 — 이 목록에서 뺐다.

         목록은 `GET /api/strategies`, 상세는 `GET /api/strategies/:id`,
         그리고 실행은 `POST /api/strategies/:id/backtest` 로 서버가 실제
         캔들에 규칙을 적용해 계산한다(수수료·슬리피지 차감 포함).

       ★ 여기 남겨 두면 운영자에게 "이 숫자는 목업" 이라고 잘못 알린다.
         목업을 실데이터로 표시하는 것과 마찬가지로, 실데이터를 목업으로
         표시하는 것도 사실과 다르다 — 운영자가 실제 결과를 무시하게 된다.
    */
  ];

  /*
     ★★ 기본값은 프로덕션에서 꺼둔다.

       이 오버레이는 데이터 출처(LIVE/PARTIAL/MOCK)를 요소마다 배지로 붙여 주는
       **개발·디자인 확인용 도구**다. 관리자에게만 보이지만(isVisibleToViewer),
       기본이 켜져 있어서 실서비스에 들어온 운영자가 'MOCK' 범례를 보고 "아직
       목업이다" 로 오해했다. 실데이터는 LIVE 로 태깅되는데도 그렇다.

       그래서 로컬 개발(localhost)에서만 기본으로 켜고, 실제 도메인에서는 끈다.
       필요하면 화면의 토글(prov_show)로 켤 수 있고, 저장된 설정은 아래에서
       그대로 존중한다.
  */
  var isLocalDev = (function () {
    try { return /localhost|127\.0\.0\.1/.test(window.location.hostname); }
    catch (e) { return false; }
  })();

  var state = {
    enabled: isLocalDev,
    /** 'badge' = 배지만, 'outline' = 배지 + 테두리 */
    mode: 'outline',
  };

  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.enabled === 'boolean') state.enabled = saved.enabled;
      if (saved.mode === 'badge' || saved.mode === 'outline') state.mode = saved.mode;
    }
  } catch (e) { /* 손상된 값은 무시하고 기본값을 쓴다 */ }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 실패는 치명적이지 않다 */ }
  }

  /*
     이 표시를 볼 수 있는 사람.

     ★★ 개발 상태 표시는 **관리자에게만** 보여야 한다. 원래 등급 제한이 없어서
       일반 고객에게도 "일부실제 · 주문 집행은 시뮬레이션" 같은 문구가 보였다.
       고객은 이 화면을 완성된 서비스로 보러 왔는데, 내부 개발 용어를 읽으면
       미완성 제품을 쓰고 있다고 느낀다.
       (발주자 방침: 미개발 표시는 super·admin 에게만)

     ★ 백엔드가 없는 디자인 미리보기에서는 보여준다 — 디자이너가 자기 화면의
       어느 부분이 목업인지 확인하는 것이 이 도구의 원래 목적이다.

     ★ 판정을 못 하는 동안(로그인 확인 전)에는 보여주지 않는다. 잠깐 보였다
       사라지면 고객이 그 문구를 기억한다.
  */
  function isVisibleToViewer() {
    // 미리보기(백엔드 없음) — 디자이너 확인용으로 항상 보인다.
    if (window.QTLive && typeof window.QTLive.isBackendPresent === 'function'
        && window.QTLive.isBackendPresent() === false) {
      return true;
    }
    var A = window.QTAccess;
    var auth = window.QTAuth;
    if (!A || !A.RANK || !auth || typeof auth.getTier !== 'function') return false;
    /* ★ 서버 role 이 아니라 화면 등급(tier)을 쓴다. auth-state.js 가 서버 role 을
         화면 등급으로 변환해 두었고, 사이드바·접근 판정이 모두 이 값을 쓴다.
         두 체계를 섞으면 어느 한쪽이 어긋난다. */
    var rank = A.RANK[auth.getTier()];
    return typeof rank === 'number' && rank >= A.RANK.admin;
  }

  function t(key, vars) {
    return window.QTI18n ? window.QTI18n.t(key, vars) : key;
  }

  /** 현재 해시 라우트. `#/trade?x=1` → `/trade` */
  function currentRoute() {
    var h = String(window.location.hash || '').replace(/^#/, '');
    var path = h.split('?')[0] || '/';
    return path;
  }

  /**
   * 라우트의 구현 상태를 돌려준다.
   *
   * 등록되지 않은 라우트는 'unknown' 이다. 'live' 로 가정하지 않는다 —
   * 모르는 것을 완성됐다고 표시하면 안 된다.
   */
  function routeStatus(path) {
    if (ROUTES[path]) return ROUTES[path];
    for (var i = 0; i < ROUTE_PREFIXES.length; i += 1) {
      var p = ROUTE_PREFIXES[i];
      if (path === p.prefix || path.indexOf(p.prefix + '/') === 0) {
        /* ★ 관리자 화면은 access.js 의 배선 목록으로 판정한다 —
             접두사 하나로 전부 목업 처리하면 완성된 화면에 거짓 표시가 남는다. */
        if (p.prefix === '/admin') return adminRouteStatus(path);
        return { status: p.status, note: p.note };
      }
    }
    return { status: 'unknown', note: 'unknown_route' };
  }

  /** 계정 데이터 상태에 따라 실제/목업을 런타임 판정한다. */
  function resolveDynamic(spec) {
    if (spec === 'dynamic:account') {
      if (!window.QTAccount) return 'mock';
      return window.QTAccount.isLive() ? 'live' : 'mock';
    }
    if (spec === 'dynamic:admin') {
      // 관리자 실데이터가 도착했는지. 권한이 없으면 목업이 보인다.
      if (!window.QTAdmin) return 'mock';
      return window.QTAdmin.isLive() ? 'live' : 'mock';
    }
    return spec;
  }

  // ---------------------------------------------------------------
  // 화면 표시
  // ---------------------------------------------------------------

  var host = null; // 배지를 담는 컨테이너 (기존 DOM 을 건드리지 않기 위해 분리)

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.className = 'qt-prov-host';
    document.body.appendChild(host);
    return host;
  }

  /** 요소에 상태 속성을 심는다. CSS 가 이 속성으로 테두리를 그린다. */
  function tagElements() {
    // 이전 표시를 지운다. 라우트가 바뀌면 대상이 달라진다.
    var prev = document.querySelectorAll('[data-qt-prov]');
    for (var i = 0; i < prev.length; i += 1) prev[i].removeAttribute('data-qt-prov');

    if (!state.enabled) return;
    // 요소 테두리도 관리자에게만 (고객 화면에 개발용 표시가 남으면 안 된다)
    if (!isVisibleToViewer()) return;

    for (var j = 0; j < ELEMENTS.length; j += 1) {
      var spec = ELEMENTS[j];
      var status = resolveDynamic(spec.status);
      var nodes;
      try {
        nodes = document.querySelectorAll(spec.selector);
      } catch (e) {
        continue; // 잘못된 선택자는 건너뛴다. 화면을 깨뜨리지 않는다.
      }
      for (var k = 0; k < nodes.length; k += 1) {
        var el = nodes[k];
        el.setAttribute('data-qt-prov', status);
        // title 은 마우스를 올렸을 때 브라우저가 보여준다. 이유를 알 수 있어야 한다.
        el.setAttribute('data-qt-prov-note', t('prov_note_' + spec.note));
        el.setAttribute('data-qt-prov-label', t('prov_status_' + status));

        // 작은 요소는 꼬리표가 내용을 다 덮는다. 점으로만 표시한다.
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 120) el.setAttribute('data-qt-prov-small', '1');
        else el.removeAttribute('data-qt-prov-small');

        // 기존 title 을 덮지 않는다. 디자이너가 넣은 설명이 사라지면 안 된다.
        if (!el.getAttribute('title')) {
          el.setAttribute('title', t('prov_status_' + status) + ' — ' + t('prov_note_' + spec.note));
        }
      }
    }
  }

  /** 헤더에 붙는 현재 라우트 상태 배지 + 켜기/끄기. */
  function renderBadge() {
    var h = ensureHost();
    h.innerHTML = '';

    /* ★ 관리자가 아니면 표시하지 않는다. host 는 비워 둔 채로 남긴다 —
         지우면 등급이 확인된 뒤 다시 만들어야 한다. */
    if (!isVisibleToViewer()) {
      document.documentElement.setAttribute('data-qt-prov-mode', 'off');
      return;
    }

    var info = routeStatus(currentRoute());
    /*
       ★★ `resolveDynamic` 을 반드시 거친다.

         이것이 빠져 있어서 `status` 가 `'dynamic:account'` 문자열 그대로
         클래스명에 들어갔다(`qt-prov-badge--dynamic:account`). CSS 에 없는
         이름이므로 **색이 붙지 않아** /order-history · /analytics · /referral 의
         상태를 눈으로 구분할 수 없었다. 라벨도 사전에 없는 키로 조회됐다.
    */
    var status = resolveDynamic(info.status);

    // 계정 데이터가 실제이면 partial 을 live 로 승격한다.
    // '키를 연결하면 실데이터' 인 화면에서, 실제로 연결된 뒤에도 계속
    // '일부 목업' 이라고 표시하면 그것도 거짓이다.
    if (status === 'partial' && info.note === 'needs_api_key' && window.QTAccount && window.QTAccount.isLive()) {
      status = 'live';
    }

    var wrap = document.createElement('div');
    wrap.className = 'qt-prov-badge qt-prov-badge--' + status + (state.enabled ? '' : ' is-off');

    var dot = document.createElement('span');
    dot.className = 'qt-prov-badge__dot';
    wrap.appendChild(dot);

    var label = document.createElement('span');
    label.className = 'qt-prov-badge__label';
    label.textContent = t('prov_status_' + status);
    wrap.appendChild(label);

    var note = document.createElement('span');
    note.className = 'qt-prov-badge__note';
    note.textContent = t('prov_note_' + info.note);
    wrap.appendChild(note);

    var toggle = document.createElement('button');
    toggle.className = 'qt-prov-badge__toggle';
    toggle.type = 'button';
    toggle.textContent = state.enabled ? t('prov_hide') : t('prov_show');
    toggle.title = t('prov_toggle_hint');
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      state.enabled = !state.enabled;
      persist();
      refresh();
    });
    wrap.appendChild(toggle);

    h.appendChild(wrap);

    if (state.enabled) h.appendChild(buildLegend());
    document.documentElement.setAttribute('data-qt-prov-mode', state.enabled ? state.mode : 'off');
  }

  function buildLegend() {
    var legend = document.createElement('div');
    legend.className = 'qt-prov-legend';
    ['live', 'partial', 'mock'].forEach(function (s) {
      var item = document.createElement('span');
      item.className = 'qt-prov-legend__item qt-prov-legend__item--' + s;
      var d = document.createElement('i');
      item.appendChild(d);
      item.appendChild(document.createTextNode(t('prov_status_' + s)));
      legend.appendChild(item);
    });
    return legend;
  }

  var refreshTimer = null;
  function refresh() {
    // 라우트 전환 직후에는 DOM 이 아직 그려지지 않았다. 다음 프레임에 처리한다.
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      renderBadge();
      tagElements();
    }, 120);
  }

  window.addEventListener('hashchange', refresh);
  if (window.QTI18n && window.QTI18n.subscribe) window.QTI18n.subscribe(refresh);
  if (window.QTAccount && window.QTAccount.subscribe) window.QTAccount.subscribe(refresh);
  /*
     ★ 로그인 상태가 바뀌면 다시 판정한다. 이 구독이 없으면 관리자가 로그인해도
       표시가 나타나지 않고(첫 렌더에 등급이 없었으므로), 로그아웃해도 남는다.
  */
  if (window.QTAuth && window.QTAuth.subscribe) window.QTAuth.subscribe(refresh);

  // React 가 화면을 다시 그리면 심어둔 속성이 사라진다. 주기적으로 다시 심는다.
  // MutationObserver 는 리렌더마다 수백 번 호출되어 오히려 무겁다.
  setInterval(function () { if (state.enabled) tagElements(); }, 2000);

  window.QTProvenance = {
    ROUTES: ROUTES,
    ELEMENTS: ELEMENTS,
    routeStatus: routeStatus,
    refresh: refresh,

    isEnabled: function () { return state.enabled; },
    setEnabled: function (v) { state.enabled = Boolean(v); persist(); refresh(); },
    setMode: function (m) { if (m === 'badge' || m === 'outline') { state.mode = m; persist(); refresh(); } },

    /**
     * 등록되지 않은 라우트를 찾는다. 라우트를 추가하고 상태 등록을 잊는 것을 막는다.
     * 콘솔에서 QTProvenance.audit() 로 확인한다.
     */
    audit: function () {
      var known = (window.QT_ALL_ROUTES || []).slice();
      var missing = known.filter(function (r) { return routeStatus(r).status === 'unknown'; });
      var counts = { live: 0, partial: 0, mock: 0, unknown: 0 };
      known.forEach(function (r) { counts[routeStatus(r).status] += 1; });
      return { total: known.length, counts: counts, unregistered: missing };
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
