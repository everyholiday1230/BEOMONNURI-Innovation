/* ============================================================
   관리자 데이터 — 실 사용자·감사로그·시스템 상태
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   왜 별도 계층인가
   --------------
   관리자 화면 여러 개가 같은 데이터를 쓴다(대시보드·사용자목록·사용자상세).
   각 화면이 따로 조회하면 같은 요청이 3번 나가고, 화면마다 다른 시점의
   데이터를 보여준다. 한 곳에서 받아 공유한다.

   ★ 권한은 서버가 판단한다
   여기서 등급을 검사하지 않는다. 호출이 403 이면 그대로 상태에 담아 화면이
   "권한 없음" 을 보여준다. 화면에서 미리 막으면 두 판단이 어긋날 수 있고,
   그때 화면 판단을 신뢰하게 되는 것이 더 위험하다.

   ★ 실패를 빈 목록으로 위장하지 않는다
   사용자 목록 조회가 실패했는데 빈 배열을 주면 "사용자가 없다" 로 읽힌다.
   운영자가 그걸 보고 잘못된 판단을 한다.
   ============================================================ */

(function () {
  'use strict';

  /** 관리자 화면은 데이터가 자주 바뀌지 않는다. 시세보다 느리게 갱신한다. */
  var POLL_MS = 20000;

  var state = {
    /** 'IDLE' | 'LOADING' | 'READY' | 'FORBIDDEN' | 'UNAUTHENTICATED' | 'ERROR' | 'OFFLINE' */
    status: 'IDLE',
    users: [],
    userTotal: 0,
    overview: null,
    audit: [],
    auditAppendOnly: false,
    health: null,
    killSwitches: [],
    /*
       내 관리자 권한 (서버가 준 실제 목록).

       화면이 버튼을 켜고 끄는 판단은 전부 여기서 나온다. 등급 이름으로
       판단하면 서버가 권한을 조정했을 때 화면이 따라오지 않아
       "버튼은 보이는데 누르면 403" 이 된다.
       null = 아직 모른다(로딩 중). [] = 권한이 없다. 둘을 구분한다 —
       로딩 중에 [] 로 보면 잠깐 모든 버튼이 사라져 화면이 깜빡인다.
    */
    permissions: null,
    error: null,
    asOf: null,
    version: 0,
  };

  var listeners = new Set();
  var timer = null;

  function bump() {
    state.version += 1;
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.warn('[QTAdmin] 리스너 오류', e); }
    });
  }

  function backendReady() {
    return Boolean(window.QTApi && window.QTApi.admin && window.QTAuth && window.QTAuth.isLoggedIn());
  }

  /**
   * 서버 사용자 → 관리자 화면 형태.
   *
   * 목업(QTApp.ADMIN_USERS)이 쓰는 필드를 채운다. 서버가 주지 않는 값은
   * **채워 넣지 않는다** — 이름·국가·거래량은 우리 DB 에 없다. 임의로 만들면
   * 운영자가 그 값을 근거로 판단하게 된다.
   */
  function toUiUsers(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (u) {
      var created = Number(u.created_at || u.createdAt);
      return {
        id: u.id,
        // 이름이 없다. 이메일을 표시명으로 쓴다 — 빈 칸보다 식별에 도움이 된다.
        name: u.name || u.email || u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        mfaEnabled: Boolean(Number(u.mfa_enabled || u.mfaEnabled || 0)),
        emailVerified: Boolean(Number(u.email_verified || u.emailVerified || 0)),
        joined: Number.isFinite(created) ? new Date(created).toISOString().slice(0, 10) : null,
        // 서버에 없는 값은 undefined 로 둔다. 화면이 '—' 를 표시한다.
        kyc: undefined,
        tier: undefined,
        country: undefined,
        vol30: undefined,
        flags: [],
        isLive: true,
      };
    });
  }

  /**
   * 감사 로그 → 화면 형태.
   *
   * 서버 필드명(실측): id, actor_user_id, actor_role, action, resource,
   *   resource_id, target_user_id, result, risk_level, ip, correlation_id,
   *   reason, at
   *
   * 추측한 이름을 나열하지 않는다 — 매핑이 틀리면 화면이 조용히 빈 칸을 보여주고,
   * 운영자는 "기록이 없다" 고 판단한다.
   */
  function toUiAudit(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (e, i) {
      var ts = Number(e.at);
      return {
        id: e.id || String(i),
        time: Number.isFinite(ts) ? ts : 0,
        // 행위자는 id 로만 온다. 이메일은 사용자 목록에서 찾아 붙인다.
        actorId: e.actor_user_id || null,
        actorRole: e.actor_role || null,
        action: e.action || '—',
        resource: e.resource || null,
        targetId: e.target_user_id || e.resource_id || null,
        result: e.result || null,
        /** 'low' | 'medium' | 'high' — 화면이 색으로 구분한다. */
        riskLevel: e.risk_level || null,
        // 이유가 비어 있으면 그대로 비워둔다. '-' 로 채우면 기록된 것처럼 보인다.
        reason: e.reason || null,
        ip: e.ip || null,
        isLive: true,
      };
    });
  }

  /**
   * 감사 로그의 행위자 id 를 이메일로 바꿔 준다.
   *
   * 서버는 id 만 준다. 운영자에게 UUID 를 보여주면 누구인지 알 수 없다.
   * 사용자 목록을 이미 받아뒀으므로 추가 요청 없이 붙인다.
   */
  function withActorNames(auditRows, users) {
    var byId = new Map();
    users.forEach(function (u) { byId.set(u.id, u.email || u.name || u.id); });
    return auditRows.map(function (e) {
      return Object.assign({}, e, {
        actor: e.actorId ? (byId.get(e.actorId) || e.actorId) : '—',
        target: e.targetId ? (byId.get(e.targetId) || e.targetId) : null,
        /*
           디자이너 표가 쓰는 필드 이름에 맞춘다.
             ok    성공 여부 (목업은 boolean)
             meta  상세 설명 칸 — 위험도와 이유를 넣는다. 운영자가 표에서 바로
                   "왜 했는지" 를 볼 수 있어야 감사 로그가 쓸모 있다.
        */
        ok: e.result ? e.result === 'success' : true,
        meta: [e.riskLevel ? e.riskLevel.toUpperCase() : null, e.reason]
          .filter(Boolean)
          .join(' · '),
      });
    });
  }

  function applyToMockGlobals() {
    if (state.status !== 'READY') return;
    /*
       목업을 지우지 않고 보관한다. 권한을 잃거나 로그아웃하면 되돌려야 하고,
       정적 프리뷰에서는 목업이 그대로 필요하다.
    */
    if (window.QTApp && state.users.length > 0) {
      if (!window.QTApp.__mockAdminUsers) window.QTApp.__mockAdminUsers = window.QTApp.ADMIN_USERS;
      window.QTApp.ADMIN_USERS = state.users;
    }
  }

  function restoreMocks() {
    if (window.QTApp && window.QTApp.__mockAdminUsers) {
      window.QTApp.ADMIN_USERS = window.QTApp.__mockAdminUsers;
    }
  }

  function poll() {
    if (!backendReady()) {
      var offline = window.QTAuth ? window.QTAuth.get().offline : true;
      var next = offline ? 'OFFLINE' : 'UNAUTHENTICATED';
      if (state.status !== next) {
        state.status = next;
        state.users = [];
        state.audit = [];
        restoreMocks();
        bump();
      }
      return Promise.resolve();
    }

    var A = window.QTApi.admin;
    if (state.status === 'IDLE') { state.status = 'LOADING'; bump(); }

    /*
       6개 조회를 병렬로 보낸다. 개별 실패는 각자 잡아 다른 조회를 막지 않는다 —
       킬스위치 조회가 실패해도 사용자 목록은 보여야 한다.
    */
    /*
       권한을 먼저 확인한 뒤 나머지를 조회한다.

       왜 순차인가
       ----------
       서버는 SUPPORT 등급에 admin.audit.read 를 주지 않는다(의도된 설계).
       권한을 모른 채 감사 로그를 조회하면 403 이 브라우저 콘솔에 남는다.
       잡음이 차면 진짜 장애를 놓친다 — 이 코드베이스에서 반복해 겪은 실패다.

       비용은 첫 회차의 왕복 1회뿐이다. 권한을 한 번 알면 이후 폴링은
       곧바로 병렬로 나간다. 콘솔을 깨끗하게 유지하는 값으로 충분히 싸다.
    */
    var permsReady = Array.isArray(state.permissions)
      ? Promise.resolve(null)
      : A.me().then(function (m) {
          if (m && Array.isArray(m.permissions)) state.permissions = m.permissions;
          return m;
        }).catch(function () {
          /*
             권한 조회 자체가 실패했다.

             빈 배열로 두지 않는다 — "권한 없음" 으로 읽혀 관리자에게서 버튼이
             사라진다. null 로 남기면 다음 회차에 다시 시도한다.
             감사 로그는 이번 회차에 건너뛴다(모르는 상태에서 403 을 부르지 않는다).
          */
          return null;
        });

    return permsReady.then(function (preMe) {
    var canReadAudit = Array.isArray(state.permissions)
      && state.permissions.indexOf('admin.audit.read') !== -1;

    return Promise.all([
      A.users({ limit: 200 }).catch(function (e) { return { __err: e }; }),
      A.overview().catch(function (e) { return { __err: e }; }),
      canReadAudit
        ? A.audit({ limit: 100 }).catch(function (e) { return { __err: e }; })
        : Promise.resolve({ __skipped: true }),
      A.systemHealth().catch(function (e) { return { __err: e }; }),
      A.killSwitches().catch(function (e) { return { __err: e }; }),
      // 위에서 이미 받았으면 재사용한다. 같은 폴링에서 두 번 부르지 않는다.
      preMe ? Promise.resolve(preMe) : A.me().catch(function (e) { return { __err: e }; }),
    ]).then(function (res) {
      var uRes = res[0], oRes = res[1], aRes = res[2], hRes = res[3], kRes = res[4], mRes = res[5];

      /*
         권한 목록. 실패하면 null 로 유지한다 — [] 로 두면 "권한 없음" 으로
         읽혀 관리자에게서 버튼이 사라지고, 원인 없이 기능이 없어진 것처럼 보인다.
      */
      if (mRes && !mRes.__err && Array.isArray(mRes.permissions)) {
        state.permissions = mRes.permissions;
      }

      // 사용자 목록 실패가 전체 상태를 좌우한다. 관리자 화면의 핵심이기 때문이다.
      if (uRes && uRes.__err) {
        var err = uRes.__err;
        state.status = err.status === 403 ? 'FORBIDDEN'
          : err.status === 401 ? 'UNAUTHENTICATED'
          : 'ERROR';
        state.error = err.message || null;
        // 실패를 빈 목록으로 위장하지 않는다. 목업으로 되돌려 "실데이터 아님" 을 유지한다.
        state.users = [];
        restoreMocks();
        bump();
        return;
      }

      state.status = 'READY';
      state.error = null;
      state.users = toUiUsers(uRes.data);
      state.userTotal = uRes.total || state.users.length;

      // 부가 정보는 실패하면 이전 값을 유지한다. 한 번의 오류로 화면이 비지 않게.
      if (oRes && !oRes.__err) state.overview = oRes.data;
      // __skipped 는 권한이 없어 조회하지 않은 것이다. 빈 목록으로 덮지 않는다 —
      // 덮으면 "감사 기록이 없다" 로 읽힌다.
      if (aRes && !aRes.__err && !aRes.__skipped) {
        // 사용자 목록을 먼저 채운 뒤 행위자 이름을 붙인다.
        state.audit = withActorNames(toUiAudit(aRes.data), state.users);
        state.auditAppendOnly = aRes.appendOnly;
      }
      if (hRes && !hRes.__err) state.health = hRes.data;
      if (kRes && !kRes.__err) state.killSwitches = kRes.data;

      state.asOf = Date.now();
      applyToMockGlobals();
      bump();
    });
    });
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    poll();
    timer = setInterval(poll, POLL_MS);
    // 로그인·로그아웃 시 즉시 갱신한다.
    if (window.QTAuth && window.QTAuth.subscribe) {
      window.QTAuth.subscribe(function () { poll(); });
    }
  }

  window.QTAdmin = {
    start: start,
    stop: function () { started = false; if (timer) clearInterval(timer); timer = null; },
    refresh: poll,

    getStatus: function () { return state.status; },
    isLive: function () { return state.status === 'READY'; },
    getUsers: function () { return state.users.slice(); },
    getUserTotal: function () { return state.userTotal; },
    getOverview: function () { return state.overview; },
    getAudit: function () { return state.audit.slice(); },
    getHealth: function () { return state.health; },
    getKillSwitches: function () { return state.killSwitches.slice(); },

    /**
     * 이 권한을 갖고 있는가.
     *
     * 아직 모를 때(null)는 false 를 준다 — 모르는 상태에서 버튼을 켜면
     * 눌렀을 때 403 이 난다. 없는 것으로 보고 데이터가 오면 나타난다.
     */
    can: function (perm) {
      return Array.isArray(state.permissions) && state.permissions.indexOf(perm) !== -1;
    },
    /** 권한 목록을 아직 모르는가 (로딩 중과 '권한 없음' 을 구분한다). */
    permissionsKnown: function () { return Array.isArray(state.permissions); },
    getPermissions: function () { return Array.isArray(state.permissions) ? state.permissions.slice() : null; },
    getError: function () { return state.error; },
    getAsOf: function () { return state.asOf; },

    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    convert: { users: toUiUsers, audit: toUiAudit, withActorNames: withActorNames },

    debug: function () {
      return {
        status: state.status,
        error: state.error,
        users: state.users.length,
        audit: state.audit.length,
        killSwitches: state.killSwitches.length,
        health: state.health ? Object.keys(state.health).length : 0,
        asOf: state.asOf ? new Date(state.asOf).toISOString() : null,
      };
    },
  };

  /*
     관리자 화면에 들어갈 때만 조회를 시작한다.

     일반 사용자가 거래 화면만 쓰는데 관리자 API 를 5개씩 폴링하면
     대부분 403 이 되고 콘솔이 오류로 가득 찬다.
  */
  function maybeStart() {
    var path = String(window.location.hash || '').replace(/^#/, '').split('?')[0];
    if (path.indexOf('/admin') === 0) start();
  }
  window.addEventListener('hashchange', maybeStart);
  maybeStart();
})();
