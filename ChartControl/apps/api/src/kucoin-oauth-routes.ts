/*
   KuCoin Fast API (OAuth 2.0) — 이용자 키 자동 연결
   ============================================================
   무엇을 하는가
     이용자가 KuCoin 에서 API 키를 손으로 만들지 않게 한다. 우리 화면에서
     "KuCoin 으로 연결" 을 누르면 KuCoin 로그인·승인 화면으로 갔다가 돌아오고,
     그 사이에 키가 자동 발급되어 우리에게 연결된다.

     지금 방식(수동)은 이용자가 이 순서를 다 해야 한다:
       KuCoin 로그인 → API 관리 → 키 생성 → 권한 3개 선택 → 출금 권한은 절대
       켜지 말 것 → IP 제한 → 키·시크릿·passphrase 를 우리 화면에 붙여넣기.
     이 단계에서 이탈이 많고, 실수로 출금 권한을 켤 위험도 있다.

   흐름 (KuCoin 문서 §5 authorization code 방식)
     1. GET  /exchanges/kucoin/oauth/start
          state 를 만들어 저장하고 KuCoin 승인 화면으로 302
     2. 이용자가 KuCoin 에서 승인
     3. GET  /exchanges/kucoin/oauth/callback?code=…&state=…
          state 검증 → code 를 액세스 토큰으로 교환 → 그 토큰으로 키 발급 →
          암호화 저장 → 화면으로 302

   ★★ 토큰을 저장하지 않는다.
     우리 용도는 "키를 한 번 발급받는 것" 이다. 발급이 끝나면 영구 API 키가
     있으므로 액세스/리프레시 토큰이 필요 없다. 저장하지 않으면 유출될 것도
     없다 — 리프레시 토큰을 3일간 들고 있는 편이 훨씬 위험하다.

   ★★ 출금 권한을 요구하지 않는다.
     우리는 자금을 보관하지 않고 입출금을 취급하지 않는다(이용약관 제2조).
     `API_WITHDRAW_OAUTH` 를 false 로 **고정**한다. 켜면 약관과 정면으로
     어긋나고, 우리 서버가 침해될 때 피해가 이용자 자산 전체로 번진다.

   ★ 설정이 완전하지 않으면 라우트를 등록하지 않는다(fail-closed).
     반쯤 설정된 상태로 켜면 이용자가 KuCoin 까지 갔다가 콜백에서 실패하고,
     그 사이 KuCoin 계정에는 우리 이름의 키가 만들어져 남는다.

   ── 검증 한계 (2026-08 현재) ─────────────────────────────
   `client_id` 가 아직 없어 **끝까지 실행해 본 적이 없다.** 구조·상태 검증·
   저장 경로는 검사로 확인했지만, KuCoin 응답 형태는 문서를 근거로 했다.
   `client_id` 를 받으면 실제 인증을 한 번 통과시켜 확인해야 한다.
   ─────────────────────────────────────────────────────────
*/

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthService } from '@quantumtrade/auth';
import { verifyCsrf, originAllowed, hasPermission } from '@quantumtrade/auth';
import type { CredentialVault } from './trading/credential-vault';
import type { CredentialStore } from './db/trading-repos';

const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

/** state 유효 시간. 인증은 몇 분 안에 끝난다 — 길게 두면 재사용 기회만 늘어난다. */
const STATE_TTL_MS = 10 * 60_000;

/*
   요청할 권한.

   ★★ 최소로 요청한다. 이용자 계정에서 우리가 할 수 있는 일이 곧 우리 서버가
     침해될 때의 피해 범위다.

       API_COMMON  — 조회(잔고·포지션). 필요하다.
       API_FUTURES — 선물 주문. 우리가 지금 제공하는 거래다.
       API_SPOT    — 현물 주문. 어댑터가 아직 없지만, 권한을 나중에 늘리려면
                     이용자가 다시 승인해야 하므로 함께 받는다.

     빼는 것과 이유:
       API_MARGIN         — 마진 거래를 제공하지 않는다.
       API_EARN           — 예치 상품을 다루지 않는다.
       API_TRANSFER       — 계정 간 이체를 하지 않는다.
       API_WITHDRAW_OAUTH — **출금. 우리는 입출금을 취급하지 않는다(약관 제2조).**
                            false 로 고정한다.
*/
const AUTH_GROUPS = Object.freeze({
  API_COMMON: true,
  API_SPOT: true,
  API_FUTURES: true,
  API_MARGIN: false,
  API_EARN: false,
  API_TRANSFER: false,
  API_WITHDRAW_OAUTH: false,
});

export interface KucoinOauthDeps {
  service: AuthService;
  vault: CredentialVault;
  /*
     ★ 구현이 아니라 **계약**에 의존한다(CredentialStore).

       전에는 `SqliteCredentialRepo` 를 직접 요구했다. 그래서 PostgreSQL 판을
       주입할 수 없었고, 회원은 Postgres 에 자격증명은 SQLite 에 남아 **키 등록이
       외래키 위반으로 500** 이 났다.
  */
  credRepo: CredentialStore;
  /** state 저장용. Postgres 전용 기능이다(개발 SQLite 에는 표가 없다). */
  pool: Pool;
  csrfKey: string;
  corsOrigins: string[];
  /** 세션 쿠키 이름. 다른 라우터와 같은 값을 받아야 한다. */
  cookieName: string;
  /** CSRF 쿠키 이름. */
  csrfCookieName: string;
  clientId: string;
  redirectUri: string;
  /** 기본 https://www.kucoin.com */
  oauthBase: string;
  /** 키 발급 경로 (v2 권장) */
  apiKeyPath: string;
  /** 돌아갈 문서 경로. 기본 '/index.html' — 결과는 이 뒤 쿼리에 붙는다. */
  appReturnPath?: string;
  /** 돌아갈 화면의 해시. 기본 '#/wallet' */
  appReturnHash?: string;
}

/**
 * 설정이 완전한가.
 *
 * ★ 라우터를 등록하기 전에 호출한다. 셋 중 하나라도 없으면 등록하지 않는다 —
 *   "있는데 안 되는" 상태보다 "없는" 상태가 낫다(화면이 그 사실을 표시한다).
 */
export function isKucoinOauthConfigured(env: {
  kucoinOauthClientId: string;
  kucoinOauthRedirectUri: string;
}): boolean {
  return Boolean(env.kucoinOauthClientId && env.kucoinOauthRedirectUri);
}

export function createKucoinOauthRouter(d: KucoinOauthDeps): Hono {
  const app = new Hono();
  /*
     돌아갈 화면.

     ★★ 결과를 **해시 앞(pathname) 쿼리**에 붙인다: `/index.html?kucoinOauth=…#/wallet`

       해시 뒤에 붙이면(`#/wallet?kucoinOauth=…`) 화면의 해시 라우터가 경로를
       정규화하면서 그 값을 지운다(실측으로 확인했다). 그러면 이용자는 KuCoin 을
       다녀온 뒤 **아무 일도 없었던 것처럼 보이는 화면**을 보게 된다 —
       연결됐는지 실패했는지 알 수 없다.

       pathname 쿼리는 해시 라우터가 건드리지 않으므로 화면이 확실히 읽는다.
  */
  const returnBase = d.appReturnPath ?? '/index.html';
  const returnHash = d.appReturnHash ?? '#/wallet';

  /*
     세션 쿠키에서 사용자를 확인한다.

     ★ 기존 라우터(trading-routes)와 같은 형태로 맞춘다 — validateSession 은
       { user, session } 을 주므로 csrfSecret 은 session 안에 있다.
  */
  async function authed(c: Context) {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  }

  /**
   * 세션 지문.
   *
   * ★ 세션 토큰 원문을 저장하지 않는다. 이 표가 유출되어도 세션을 탈취할 수
   *   없어야 한다. 같은 사용자라도 다른 브라우저에서 시작한 인증을 이어받지
   *   못하게 하는 것이 목적이므로 해시로 충분하다.
   */
  function sessionHash(c: Context): string {
    const raw = getCookie(c, d.cookieName) ?? '';
    return createHash('sha256').update(`${d.csrfKey}:${raw}`).digest('hex');
  }

  /*
     ★ verifyCsrf 는 헤더·쿠키·세션 비밀·서버 키 **네 값**을 받는다.
       헤더만 비교하면 쿠키를 심을 수 있는 공격자가 통과한다(이중 제출 방식).
  */
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, d.csrfCookieName), secret, d.csrfKey);

  /*
     인증 시작.

     ★ POST 로 받는다. GET 으로 두면 이미지 태그·링크만으로 남의 브라우저에서
       인증을 시작시킬 수 있다(CSRF). 시작 자체가 KuCoin 화면으로 보내는
       동작이므로 CSRF 토큰을 요구한다.

     ★ 302 로 바로 보내지 않고 **주소를 돌려준다.** 화면이 그 주소로 이동한다.
       fetch 로 302 를 따라가면 CORS 때문에 실패하고, 이용자에게는 아무 일도
       일어나지 않는 것처럼 보인다.
  */
  app.post('/exchanges/kucoin/oauth/start', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    if (!hasPermission(a.user.role, 'account.update.self')) {
      return c.json(err('FORBIDDEN', 'permission'), 403);
    }

    /*
       ★ 128비트 난수. 추측할 수 없어야 한다 — 추측되면 state 검증이 무의미하다.
    */
    const state = randomBytes(24).toString('base64url');

    await d.pool.query(
      `INSERT INTO kucoin_oauth_states (state, user_id, session_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
      [state, a.user.id, sessionHash(c), String(STATE_TTL_MS)],
    );

    /*
       승인 화면 주소.

       ★ redirect_uri 를 인코딩하지 않는다 — KuCoin 문서가 명시한다
         ("please don't encode the redirect URL"). 인코딩하면 등록된 값과
         달라져 거부된다.
       ★ scope 는 OAUTH_CREATE_API (키 생성 권한).
    */
    const url = `${d.oauthBase}/oauth?response_type=code`
      + `&client_id=${encodeURIComponent(d.clientId)}`
      + `&redirect_uri=${d.redirectUri}`
      + '&scope=OAUTH_CREATE_API'
      + `&state=${encodeURIComponent(state)}`;

    return c.json({ url, expiresInMs: STATE_TTL_MS });
  });

  /*
     콜백.

     ★ KuCoin 이 이용자의 브라우저를 이 주소로 보낸다. 우리가 부르는 것이
       아니므로 CSRF 토큰을 받을 수 없다 — 그래서 **state 검증이 유일한 방어**다.

     ★★ state 를 검증하지 않으면 계정 탈취 경로가 된다.
       공격자가 자기 KuCoin 계정으로 인증한 뒤 그 콜백 주소를 피해자에게 열게
       하면 피해자 계정에 공격자의 키가 연결되고, 피해자가 내는 주문이 공격자
       계정에서 실행된다.

     ★ 실패해도 오류 본문을 화면에 그대로 뿌리지 않고 화면으로 되돌린다.
       이 주소는 이용자가 브라우저로 보는 곳이므로 JSON 오류를 띄우면
       "고장난 페이지" 로 보인다.
  */
  app.get('/exchanges/kucoin/oauth/callback', async (c) => {
    const back = (reason: string) =>
      c.redirect(`${returnBase}?kucoinOauth=${encodeURIComponent(reason)}${returnHash}`, 302);

    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    if (!code || !state) return back('missing_params');

    /*
       state 를 한 번에 소비한다.

       ★ 조회 후 갱신을 따로 하면 그 사이에 같은 state 로 두 번 들어올 수 있다.
         `UPDATE … WHERE used_at IS NULL … RETURNING` 으로 원자적으로 처리해
         두 번째 요청은 아무 행도 받지 못하게 한다.
    */
    const claimed = await d.pool.query(
      `UPDATE kucoin_oauth_states
          SET used_at = now()
        WHERE state = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id, session_hash`,
      [state],
    );
    const row = claimed.rows[0] as { user_id: string; session_hash: string } | undefined;
    if (!row) return back('invalid_state');

    /*
       ★ 시작한 브라우저와 같은지 확인한다.
         state 를 훔쳐 다른 브라우저에서 콜백을 열어도 통과하지 못한다.
    */
    if (row.session_hash !== sessionHash(c)) return back('session_mismatch');

    const a = await authed(c);
    if (!a || a.user.id !== row.user_id) return back('session_mismatch');

    try {
      /*
         1) 인증 코드 → 액세스 토큰 (문서 §7.2)
            ★ redirect_uri 는 시작할 때와 **같은 값**이어야 하고 인코딩하지 않는다.
      */
      const tokenUrl = `${d.oauthBase}/_oauth/access-token?grant_type=authorization_code`
        + `&code=${encodeURIComponent(code)}`
        + `&redirect_uri=${d.redirectUri}`
        + `&client_id=${encodeURIComponent(d.clientId)}`;

      const tokenRes = await fetch(tokenUrl, { method: 'GET', signal: AbortSignal.timeout(15_000) });
      const tokenBody = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
      if (!tokenRes.ok || !tokenBody?.access_token) return back('token_exchange_failed');

      /*
         2) 액세스 토큰 → API 키 발급 (문서 §4.2, v2)

            ★ 출금 권한은 false 로 고정한다(위 AUTH_GROUPS 주석 참고).
            ★ isAddressbookOnly: false — 주소록 전용 키가 아니다(거래를 해야 한다).
      */
      const keyRes = await fetch(`${d.oauthBase}${d.apiKeyPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `bearer ${tokenBody.access_token}`,
        },
        body: JSON.stringify({ authGroupMap: AUTH_GROUPS, isAddressbookOnly: false }),
        signal: AbortSignal.timeout(20_000),
      });
      const keyBody = (await keyRes.json().catch(() => null)) as {
        success?: boolean;
        data?: { apiKey?: string; secret?: string; passphrase?: string; apiName?: string };
      } | null;

      const k = keyBody?.data;
      if (!keyRes.ok || keyBody?.success !== true || !k?.apiKey || !k?.secret || !k?.passphrase) {
        /*
           문서가 밝힌 실패 사유는 두 가지다: 같은 apiName 중복, 키 개수 상한 초과.
           어느 쪽인지 응답으로 구분되지 않으므로 한 가지로 알린다 — 화면이
           "KuCoin 에서 키를 만들지 못했다" 는 사실과 대처를 안내한다.
        */
        return back('key_issue_failed');
      }

      /*
         3) 암호화 저장.

            ★ 기존 수동 등록과 **같은 저장 경로**를 쓴다(vault + credRepo).
              별도 경로를 만들면 조회·검증·삭제를 두 벌 관리해야 하고, 한쪽만
              고치는 실수가 생긴다.
            ★ memo 가 KuCoin 의 passphrase 다(우리 저장 구조의 필드 이름).
      */
      const enc = await d.vault.encrypt({
        accessKey: k.apiKey,
        secretKey: k.secret,
        memo: k.passphrase,
      });
      await d.credRepo.create(a.user.id, enc, k.apiName || 'KuCoin (Fast API)', 'kucoin');

      /*
         ★ 토큰은 여기서 버린다. 키가 있으므로 더 필요하지 않다.
           변수에만 있었으므로 저장된 곳이 없다.
      */
      return back('connected');
    } catch {
      // 네트워크·시간 초과. 키가 만들어졌는지 우리는 알 수 없으므로 그대로 알린다.
      return back('unreachable');
    }
  });

  return app;
}
