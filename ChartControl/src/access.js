/* ============================================================
   접근 제어 — 화면 등급 규칙의 단일 출처
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   이 파일이 정하는 것
   -----------------
   각 라우트를 어느 등급이 볼 수 있는가. 사이드바 숨김과 라우팅 차단이
   **같은 근거**를 써야 한다. 두 곳에 따로 적으면 한쪽만 고쳐서
   "메뉴에는 없는데 주소로는 열리는" 상태가 생긴다.

   ★ 이건 1겹(화면)이다. 보안이 아니다.
   화면을 숨겨도 그 화면이 부르던 API 는 그대로 열려 있다. 실제 차단은 서버가
   401/403 으로 한다(packages/auth/src/policy.ts, admin-routes.ts).
   여기서 하는 일은 "권한 없는 것을 보여주지 않는" 사용자 경험이다.

   두 가지 규칙이 겹친다
   -------------------
   1) 기능 등급   그 화면이 원래 어느 등급의 것인가 (관리자 화면은 admin+)
   2) 개발 상태   아직 목업인 화면은 admin+ 만 본다 (발주자 방침, 런칭 후에도 유지)

   둘 중 **높은 쪽**이 적용된다. 예: /analytics 는 원래 user 화면이지만
   아직 목업이므로 admin+ 만 보인다.
   ============================================================ */

(function () {
  'use strict';

  /** 등급 서열. 높은 등급은 낮은 등급의 화면을 모두 볼 수 있다. */
  var RANK = { user: 0, ops: 1, admin: 2, super: 3 };

  /** 로그인 없이 볼 수 있는 라우트. */
  var PUBLIC_ROUTES = new Set([
    '/', '/login', '/signup', '/verify-email', '/kyc', '/password-reset',
    /*
       법적 문서.

       ★ 로그인 없이 열려야 한다. 회원가입에서 "약관에 동의합니다" 를 받는데
         로그인해야 약관을 볼 수 있으면, 동의 대상을 모르고 가입하는 셈이다.
         전에는 이 라우트들이 아예 없어서 링크가 404 였다.
    */
    '/terms', '/privacy', '/risk', '/security',
  ]);

  /**
   * 기능 등급 — 그 화면이 원래 누구의 것인가.
   *
   * 관리자 화면 안에서도 등급이 갈린다:
   *   ops    시스템 상태·티켓 대응 (열람 가능, 변경 불가 — 변경은 서버가 막는다)
   *   admin  사용자 관리·KYC·수수료·공지
   *   super  권한 부여·킬스위치·감사 로그
   */
  var BASE_TIER = {
    // --- 일반 사용자 ---
    '/trade': 'user',
    '/markets': 'user',
    '/portfolio': 'user',
    '/analytics': 'user',
    '/wallet': 'user',
    '/wallet/deposit': 'user',
    '/wallet/withdraw': 'user',
    '/wallet/transactions': 'user',
    '/order-history': 'user',
    '/ai-strategies': 'user',
    '/ai-strategies/detail': 'user',
    '/ai-strategies/my': 'user',
    '/referral': 'user',
    /*
       포인트.

       제도가 꺼져 있으면 화면이 "아직 시작하지 않았습니다" 를 보여주므로
       미개발로 숨기지 않는다 — 숨기면 제도를 켠 뒤에도 사용자가 찾을 수 없다.
    */
    '/points': 'user',
    '/fees': 'user',
    '/help': 'user',
    '/settings': 'user',
    '/notifications': 'user',

    // --- 운영 (열람 중심) ---
    '/admin': 'ops',
    '/admin/system': 'ops',
    '/admin/cs': 'ops',

    /*
       사용자 조회는 ops 도 본다 (서버 설계와 일치, 실측 확인).

       서버는 SUPPORT·ANALYST 에게 admin.user.read 를 준다 — 티켓에 답하려면
       해당 사용자를 찾아봐야 한다. 실측: ops 로 GET /api/admin/users = 200.
       화면만 막으면 "권한은 있는데 화면이 없는" 상태가 되고, 운영자는
       터미널로 API 를 직접 부르게 된다.

       ★ 변경은 여기서 막지 않는다. 정지·해제 버튼은 서버가 준 실제 권한
         (admin.user.status.write) 으로 켜고 끈다. 등급으로 화면을 막는 것과
         권한으로 버튼을 막는 것은 층이 다르다.
    */
    '/admin/users': 'ops',
    '/admin/users/detail': 'ops',

    // --- 관리자 ---
    '/admin/kyc': 'admin',
    '/admin/fees': 'admin',
    /*
       공지 열람은 ops 도 가능하다 (실측: ops 로 GET /api/admin/notices = 200).
       고객이 "공지 봤는데 무슨 뜻이냐" 고 물으면 운영자가 원문을 봐야 한다.
       작성 화면(/admin/notices/new)은 쓰기 동작이므로 admin 이상만 들어간다.
    */
    '/admin/notices': 'ops',
    '/admin/notices/new': 'admin',
    '/admin/deposits': 'admin',
    '/admin/withdrawals': 'admin',
    /*
       리퍼럴 운영.

       읽기는 ops 도 가능하지만(고객 문의 응대) 화면 등급은 admin 으로 둔다 —
       이 화면에는 제도 조건 변경과 지급 기록 입력이 함께 있고, ops 에게는
       그 버튼이 서버 권한으로 막혀 비활성으로만 보인다. 볼 수는 있으나
       할 수 있는 일이 거의 없는 화면을 메뉴에 두면 혼란스럽다.
    */
    '/admin/referral': 'admin',
    /*
       포인트 (운영).

       ★ 열람은 ops 까지 허용한다. 고객이 "포인트가 왜 줄었나요" 물으면 지원
         담당이 원장을 보고 답해야 한다. 서버도 admin.points.read 를 ops 에게
         준다 — 화면에서 진입을 막으면 서버 설계와 어긋난다.

       ★ 변경(지급·회수·제도 개시)은 서버가 admin.points.write 로 막고, 화면도
         그 권한이 없으면 버튼을 렌더하지 않는다. 포인트 지급은 부채 생성이다.
    */
    '/admin/points': 'ops',
    /*
       법적 문서 (운영).

       ★ 열람은 ops 까지 — 고객이 약관 내용을 물으면 지원 담당이 답해야 한다.
       ★ 게시는 서버가 admin.legal.write(SUPER 전용)로 막고, 화면도 그 권한이
         없으면 작성·게시 칸을 렌더하지 않는다.
    */
    '/admin/legal': 'ops',
    '/admin/trades': 'admin',
    '/admin/assets': 'admin',
    '/admin/ai-ops': 'admin',
    '/admin/design-ops': 'admin',
    '/admin/broadcast': 'admin',

    /*
       --- 최고 관리자만 ---
       킬스위치와 감사 로그는 되돌릴 수 없거나 남의 행동을 들여다보는 기능이다.

       ★ 알려진 불일치: 서버는 ANALYST 에게 admin.audit.read + export 를 주지만
         (SUPPORT 에게는 주지 않는다), 화면 등급은 4개뿐이라 SUPPORT·ANALYST 가
         같은 'ops' 로 묶인다. 'ops' 를 열면 SUPPORT 가 들어와 403 을 받는다.
         그래서 감사 로그는 super 로 유지한다 — 실제로 못 쓰는 화면을 보여주는
         것보다 안 보여주는 편이 낫다. 화면 등급을 6개로 늘리거나 권한 기반
         라우팅으로 바꾸면 해소된다.
    */
    '/admin/risk': 'super',
    '/admin/audit': 'super',
  };

  /**
   * 아직 개발되지 않은 라우트.
   *
   * 발주자 방침: 미개발 화면은 super·admin 에게만 보인다. 런칭 후에도 유지한다 —
   * 미완성 화면을 일반 사용자가 열면 신뢰를 잃는다.
   *
   * ★ 배선이 끝나면 여기서 지운다. 지우지 않으면 완성된 기능이 계속 숨는다.
   *   provenance.js 의 상태와 함께 관리한다 (그쪽은 표시, 여기는 접근).
   */
  var UNDEVELOPED = new Set([
    // '/analytics' 배선 완료 (거래소 원장의 실현손익 기준)
    // '/order-history' 배선 완료 (실 주문·체결·수수료)
    // '/notifications' 배선 완료 (실 청산 경고)
    // '/fees' 배선 완료 (거래소 실 수수료율)
    /*
       '/help' 배선 완료 — FAQ 검색 + 실제 문의 접수(티켓).
       문의는 /admin/cs 로 들어가고 답변을 이 화면에서 확인한다.
    */
    /*
       '/referral' 배선 완료 — 실제 제도.

       제도가 꺼져 있으면 코드를 발급하지 않고 "아직 시작하지 않았습니다" 를
       보여준다. 켜져 있으면 실제 코드·초대 현황·지급 이력을 보여주고,
       적립액을 계산하지 않는다는 사실과 자동 지급이 아니라는 사실을 함께
       표시한다(서버 disclosures).
    */
    /*
       AI 전략 3화면 배선 완료.

       내장 전략 4개 + 실제 백테스트 엔진(수수료·슬리피지 차감, lookahead 제거).
       팔로우는 관심 등록이며 자동 실행하지 않는다는 사실을 화면이 명시한다.
    */
    /*
       입금·출금은 사용자에게 공개한다 (배선 완료).

       미개발로 숨기면 안 되는 이유: 비수탁 서비스에서 "어디에 입금하는지"는
       사용자가 반드시 알아야 하는 정보다. 숨기면 우리에게 송금하려 시도한다.
       화면은 거래소로 안내하고, 우리 입금 주소가 없다는 사실을 명시한다.
    */
    // '/wallet/deposit' 배선 완료 (비수탁 안내)
    // '/wallet/withdraw' 배선 완료 (비수탁 안내 + 출금 권한 미보유 설명)
    /*
       '/kyc' 배선 완료 — 신분 서류를 수집하지 않는다는 사실을 알리고
       실제 다음 단계(거래소 계정 연결)로 보낸다. 사용자에게 보여야 하는
       화면이다: 이메일 인증 후 이 경로로 들어온다.
    */
    // 관리자 화면 전체가 아직 목업이다. 접두사로 처리한다(아래 isUndeveloped).
  ]);

  /** 접두사로 미개발 판정. */
  var UNDEVELOPED_PREFIXES = ['/admin'];

  /**
   * 배선이 끝난 관리자 화면 — 미개발 목록에서 제외한다.
   *
   * 이걸 갱신하지 않으면 완성된 기능이 계속 admin+ 전용으로 숨는다.
   * provenance.js 의 상태 등록과 함께 관리한다.
   */
  var BUILT_ADMIN_ROUTES = new Set([
    '/admin',
    '/admin/users',
    '/admin/users/detail',
    '/admin/audit',
    // 공지 — 작성·게시·내림·보관 배선 완료 (Postgres 백엔드 필요)
    '/admin/notices',
    '/admin/notices/new',
    // 시스템 상태 — 실측정 값 (postgres/시세출처/WS/메모리)
    '/admin/system',
    // 거래·위험 감시 — 실 주문·포지션 (읽기 전용)
    '/admin/trades',
    '/admin/risk',
    // 자산 — 비수탁 사실 + 실 사용자·세션 집계
    '/admin/assets',
    // 수수료 — 거래소 실 수수료율 + 리베이트 설정 상태
    '/admin/fees',
    // 고객 지원 티켓 — 실 저장·답장·내부메모 (Postgres 백엔드 필요)
    '/admin/cs',
    /*
       KYC·입금·출금 — 구조상 해당 없음을 설명하는 화면.

       '미개발' 로 두면 운영자에게 숨겨지는데, 운영자가 고객 문의에 답하려면
       "우리는 그 일을 하지 않는다" 는 사실을 볼 수 있어야 한다. 숨기면
       "곧 생기나" 하고 기다리다 고객에게 잘못 안내한다.
    */
    '/admin/kyc',
    '/admin/deposits',
    '/admin/withdrawals',
    // 브로드캐스트 — 공지 게시로 실제 동작 (인앱만)
    '/admin/broadcast',
    // 리퍼럴 운영 — 조건 설정 + 지급 기록 (실 저장)
    '/admin/referral',
    /*
       포인트 운영 — 실 원장 + 부채 집계 + 정합성 검사 (Postgres 필요)

       ★ 여기 등록하지 않으면 '미개발' 로 취급돼 admin+ 에게만 보이고, 그 결과
         제도를 켜도 운영자가 부채를 볼 수 없다. 실제로 이번에 겪었다 —
         화면·API·권한이 다 맞는데 렌더가 되지 않았다.
    */
    '/admin/points',
    // 법적 문서 — 초안·게시·버전 관리 (Postgres 필요)
    '/admin/legal',
    // AI 운영 — 실 정책·사용량 (미실행은 '—' 로 표시)
    '/admin/ai-ops',
    // 디자인 운영 — 런타임 집계 + 게시 파이프라인 부재 명시
    '/admin/design-ops',
  ]);

  /** 미개발 화면을 볼 수 있는 최소 등급. */
  var UNDEVELOPED_MIN_TIER = 'admin';

  /*
     서버 등급 설계와의 일치 (실측 확인, packages/admin-domain/src/permissions.ts)
     ----------------------------------------------------------------------
     서버는 SUPPORT·ANALYST(=우리 ops)도 관리자 대시보드 **진입은 허용**하고,
     변경 권한만 막는다(admin.*.write 없음 → 개별 엔드포인트에서 403).
     즉 서버는 "진입 차단" 이 아니라 "행위 차단" 방식이다.

     화면도 같은 방식을 따른다: ops 는 관리자 화면을 열람할 수 있고, 변경
     버튼을 눌러도 서버가 403 을 낸다. 화면에서 진입을 막으면 서버 설계와
     어긋나 "권한이 있는데 화면이 안 열리는" 상태가 된다.

     단, 미개발 화면 규칙(admin+ 만)이 더 좁으므로 지금은 그것이 먼저 적용된다.
     배선이 끝나 UNDEVELOPED 에서 지우면 ops 가 열람할 수 있게 된다.
  */

  function isUndeveloped(path) {
    // 배선이 끝난 화면은 개발 상태 제한을 받지 않는다 (기능 등급만 적용).
    if (BUILT_ADMIN_ROUTES.has(path)) return false;
    if (UNDEVELOPED.has(path)) return true;
    for (var i = 0; i < UNDEVELOPED_PREFIXES.length; i += 1) {
      var p = UNDEVELOPED_PREFIXES[i];
      if (path === p || path.indexOf(p + '/') === 0) return true;
    }
    return false;
  }

  /** 라우트의 기능 등급. 등록되지 않은 라우트는 가장 높은 등급으로 본다. */
  function baseTierFor(path) {
    if (BASE_TIER[path]) return BASE_TIER[path];
    // 모르는 라우트를 user 로 열면, 새 화면을 추가하고 등급 등록을 잊었을 때
    // 아무나 들어간다. 모르면 잠근다 (fail-safe).
    if (path.indexOf('/admin') === 0) return 'super';
    return 'super';
  }

  /**
   * 이 라우트에 필요한 최소 등급.
   *
   * 기능 등급과 개발 상태 중 **높은 쪽**을 쓴다.
   */
  function requiredTier(path) {
    var base = baseTierFor(path);
    if (!isUndeveloped(path)) return base;
    return RANK[base] >= RANK[UNDEVELOPED_MIN_TIER] ? base : UNDEVELOPED_MIN_TIER;
  }

  /**
   * 접근 가능 여부.
   *
   * @param {string} path 해시 라우트 경로 (예: '/admin/users')
   * @param {string|null} tier 서버가 준 화면 등급. 비로그인은 null.
   * @returns {{allowed:boolean, reason:string, required:string}}
   */
  function canAccess(path, tier) {
    if (PUBLIC_ROUTES.has(path)) {
      return { allowed: true, reason: 'public', required: 'public' };
    }

    var need = requiredTier(path);

    // 비로그인. 등급 제한이 있는 화면은 볼 수 없다.
    // 'user' 로 가정하지 않는다 — 그러면 로그인 없이 거래 화면이 열린다.
    if (!tier) {
      return { allowed: false, reason: 'login_required', required: need };
    }

    if (RANK[tier] === undefined) {
      // 알 수 없는 등급은 거부한다. 관리자로 해석하면 권한 상승이 된다.
      return { allowed: false, reason: 'unknown_tier', required: need };
    }

    if (RANK[tier] < RANK[need]) {
      return {
        allowed: false,
        // 미개발이라 막힌 것과 원래 권한이 없어서 막힌 것을 구분해 알린다.
        reason: isUndeveloped(path) && RANK[baseTierFor(path)] <= RANK[tier]
          ? 'under_development'
          : 'insufficient_tier',
        required: need,
      };
    }

    return { allowed: true, reason: 'ok', required: need };
  }

  window.QTAccess = {
    RANK: RANK,
    PUBLIC_ROUTES: PUBLIC_ROUTES,
    canAccess: canAccess,
    requiredTier: requiredTier,
    isUndeveloped: isUndeveloped,
    baseTierFor: baseTierFor,

    /**
     * 등록된 모든 라우트. 접근 규칙이 라우트 목록의 유일한 출처다.
     *
     * 화면이 라우트 수를 세어 보여줄 때 이 함수를 쓴다 — 숫자를 하드코딩하면
     * 라우트를 추가·삭제한 순간 거짓이 된다.
     */
    allRoutes: function () { return Object.keys(BASE_TIER); },

    /**
     * 등록 누락 감사. 라우트를 추가하고 등급 등록을 잊는 것을 막는다.
     * 콘솔에서 QTAccess.audit()
     */
    audit: function () {
      var all = (window.QT_ALL_ROUTES || []).slice();
      var unregistered = all.filter(function (r) {
        return !PUBLIC_ROUTES.has(r) && !BASE_TIER[r];
      });
      var byTier = { user: [], ops: [], admin: [], super: [], public: [] };
      all.forEach(function (r) {
        if (PUBLIC_ROUTES.has(r)) byTier.public.push(r);
        else byTier[requiredTier(r)].push(r);
      });
      return {
        total: all.length,
        counts: {
          public: byTier.public.length,
          user: byTier.user.length,
          ops: byTier.ops.length,
          admin: byTier.admin.length,
          super: byTier.super.length,
        },
        unregistered: unregistered,
        byTier: byTier,
      };
    },
  };
})();
