/**
 * Bitget FastApi (OAuth) — 거래소 키 연결.
 *
 * ═══ KuCoin 과 무엇이 다른가 ═══
 *
 * KuCoin: 브라우저가 `code` 를 들고 돌아오고, **우리가** 토큰을 교환해 키를 만든다.
 * Bitget: **Bitget 이 우리 콜백으로 API 키를 직접 POST 한다.** 브라우저 복귀는
 *         성공/실패만 알려주는 별개 경로다.
 *
 * ★★★ 그래서 위험 지점이 다르다.
 *
 *   콜백은 **서버 대 서버**다 — 세션 쿠키가 없다. 즉 "이 요청이 정말 Bitget 이
 *   보낸 것인가" 를 판정할 근거가 **서명뿐**이다. 그리고 그 서명은 우리가 시작
 *   단계에서 만든 `serialNo` 를 되돌려주는 형태다.
 *
 *   여기서 실수하면 **계정 탈취**가 된다. 공격자가 자기 Bitget 계정으로 인증한 뒤
 *   콜백 본문의 `clientUserId` 만 피해자 것으로 바꿔 보내면, 피해자 계정에 공격자의
 *   거래소 키가 연결되고 피해자가 내는 주문이 공격자 계정에서 실행된다.
 *
 *   그래서 콜백은 네 가지를 모두 통과해야 한다:
 *     1) `sign` 을 우리 개인키로 복호 → `serialNo` 와 문자열 일치
 *     2) `serialNo` 가 우리 표에 있고 **아직 사용되지 않았고** 만료되지 않았다
 *     3) 그 `serialNo` 에 묶인 `user_id` 가 본문의 `clientUserId` 와 일치
 *     4) `timestamp` 가 현재와 5분 이내 (FastApi 문서 명시)
 *
 * ★★ 암호 규격은 Bitget 의 Java 예시를 그대로 따라야 한다.
 *   · 서명   `MD5withRSA` — 키를 **정렬**해 `key+value` 를 이어붙인 문자열에 서명
 *   · 암복호 `RSA/ECB/PKCS1Padding` (Java `Cipher.getInstance("RSA")` 의 기본값)
 *
 *   ★★★ Node 의 기본 패딩은 **OAEP** 다. 명시하지 않으면 **조용히 복호 실패**한다.
 *     그래서 모든 호출에 `RSA_PKCS1_PADDING` 을 박아 둔다.
 *
 *   MD5 는 약한 해시다. Bitget 이 그것으로 검증하므로 우리가 바꿀 수 없다.
 *
 * ★ Bitget 문서의 예시 RSA 키는 쓰지 않는다 — 문서에 **개인키 전문**이 실려 있고,
 *   공개 문서에 실린 키는 전 세계가 가진 키다. 우리 키쌍을 따로 만들었다.
 */
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  constants as cryptoConstants, createHash, createPrivateKey, privateDecrypt, randomBytes, sign as cryptoSign,
} from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthService } from '@quantumtrade/auth';
import { verifyCsrf, originAllowed, hasPermission } from '@quantumtrade/auth';
import type { CredentialVault } from './trading/credential-vault';
import type { CredentialStore } from './db/trading-repos';

/**
 * `serialNo` 유효 시간. FastApi 문서 권고가 10분이다.
 *
 * ★ 짧을수록 안전하지만, 고객이 Bitget 로그인·2FA·약관 확인을 하는 시간을 줘야 한다.
 *   문서 권고값을 그대로 쓴다.
 */
const SERIAL_TTL_MS = 10 * 60 * 1000;

/**
 * 콜백 `timestamp` 허용 오차. 문서가 5분을 명시한다.
 *
 * ★★ 양방향으로 본다. 미래 시각도 거부해야 한다 — 시계를 앞당긴 위조 요청을
 *   통과시키면 만료 검사가 무의미해진다.
 */
const CALLBACK_SKEW_MS = 5 * 60 * 1000;

/** Bitget 이 요구하는 성공 응답. 이 형태가 아니면 재시도할 수 있다. */
const BITGET_OK = { code: '00000', msg: 'success' } as const;

export interface BitgetOauthDeps {
  service: AuthService;
  vault: CredentialVault;
  /**
   * ★ 구현이 아니라 **계약**에 의존한다. KuCoin 라우트에서 `SqliteCredentialRepo` 를
   *   직접 요구해 Postgres 판을 주입할 수 없었던 문제를 되풀이하지 않는다.
   */
  credRepo: CredentialStore;
  /** 연결 확정 알림(초대 단계 기록 등). 실패해도 연결을 막지 않는다. */
  onExchangeVerified?: (userId: string) => Promise<void>;
  pool: Pool;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  csrfCookieName: string;
  /** Bitget 이 발급하는 우리 식별자. 없으면 라우터를 등록하지 않는다. */
  clientId: string;
  /** PKCS8 개인키 (base64, 헤더 없음). Bitget 에 준 공개키와 한 쌍이다. */
  rsaPrivateKey: string;
  /** Bitget 이 브라우저를 되돌려보낼 우리 주소. */
  redirectUri: string;
  /** 인증 페이지. 기본 `https://www.bitget.com/en/account/oauth`. */
  oauthBase: string;
  /**
   * 추천 코드(`vipCode`). 선택이지만 **없으면 리베이트가 0 이다.**
   *
   * ★★ Bitget BD 확인(2026-09-13): 리베이트는 "users registered through your
   *   referral code" 에만 붙는다. 이 값을 URL 에 실어야 가입 화면에 코드가
   *   자동 입력되고, 그렇게 가입한 고객의 거래량이 우리 실적이 된다.
   */
  vipCode?: string;
  /** 추가 채널 코드(선택). BD 가 별도로 줄 수 있다. */
  channelCode?: string;
  /** 브라우저 복귀 후 앱 안에서 보낼 곳. */
  appReturnPath?: string;
  appReturnHash?: string;
}

/**
 * 설정이 갖춰졌는가.
 *
 * ★★★ 하나라도 없으면 **라우터를 아예 등록하지 않는다.** 반쯤 동작하는 연결 흐름은
 *   고객이 인증까지 하고 실패하는 것을 뜻하고, 그 시점에 이미 Bitget 쪽에는 키가
 *   만들어져 있다 — 우리가 받지 못한 키가 떠돌게 된다.
 */
export function isBitgetOauthConfigured(env: {
  bitgetOauthClientId: string;
  bitgetOauthRsaPrivateKey: string;
  bitgetOauthRedirectUri: string;
}): boolean {
  return Boolean(
    env.bitgetOauthClientId.trim()
    && env.bitgetOauthRsaPrivateKey.trim()
    && env.bitgetOauthRedirectUri.trim(),
  );
}

/** PKCS8 base64 → Node KeyObject. */
function loadPrivateKey(b64: string) {
  const clean = b64.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const pem = `-----BEGIN PRIVATE KEY-----\n${clean.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return createPrivateKey(pem);
}

/**
 * 서명 대상 문자열.
 *
 * ★★ Bitget 예시(2.1.2)는 **키를 사전순으로 정렬**해 `key + value` 를 이어붙인다.
 *   순서가 다르면 서명이 달라지고 Bitget 이 거부한다. 문서의 "clientUserId[]
 *   timestamp[]clientId[]" 표기는 형식 설명이고, 실제 코드는 TreeSet 정렬이다.
 *   **코드를 따른다** — 문서 산문과 코드가 어긋날 때 검증하는 쪽은 코드다.
 */
export function buildSignData(params: Record<string, string>): string {
  return Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
}

/** 서명 생성 (MD5withRSA, base64). */
export function signPayload(params: Record<string, string>, privateKeyB64: string): string {
  return cryptoSign('md5', Buffer.from(buildSignData(params)), loadPrivateKey(privateKeyB64)).toString('base64');
}

/**
 * 공개키로 암호화된 값을 우리 개인키로 복호한다.
 *
 * ★★★ `RSA_PKCS1_PADDING` 을 반드시 지정한다. Node 기본값은 OAEP 이고, Bitget 의
 *   Java `Cipher.getInstance("RSA")` 는 PKCS#1 v1.5 다. 지정하지 않으면 예외가
 *   나는데, 그 예외를 삼키면 "복호 실패" 가 "값 없음" 으로 조용히 바뀐다.
 *
 * ★ 실패를 `null` 로 돌려준다. 호출부가 **반드시** 실패를 구분해 거부해야 한다.
 */
export function decryptRsa(cipherB64: string, privateKeyB64: string): string | null {
  try {
    return privateDecrypt(
      { key: loadPrivateKey(privateKeyB64), padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.from(cipherB64, 'base64'),
    ).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 복호된 `serialNo` 가 **우리가 만든 형태**인지.
 *
 * ★★★ 이 검증이 없어서 500 이 났다(시험에서 발견).
 *
 *   `privateDecrypt` 는 잘못된 암호문에도 **예외 없이 쓰레기 바이트를 돌려줄 수 있다.**
 *   실제로 `Buffer.from('not-base64-rsa','base64')`(10바이트)를 넣으니 32바이트
 *   쓰레기가 나왔다. 그 안에 `0x00` 이 있었고, 그것을 그대로 SQL 파라미터로 넘기니
 *   Postgres 가 `invalid byte sequence for encoding "UTF8": 0x00` 으로 던져
 *   **처리되지 않은 예외 → 500** 이 됐다.
 *
 *   즉 공격자가 아무 문자열이나 `sign` 에 넣어 500 을 만들 수 있었다. 보안 구멍은
 *   아니지만(키는 저장되지 않는다) 잘못된 신호다 — Bitget 은 500 을 재시도로 볼 수
 *   있고, 로그는 스택 추적으로 덮인다.
 *
 * ★★ 교훈: **복호 결과를 신뢰하지 않는다.** 복호가 "성공" 해도 그것이 우리가 보낸
 *   값이라는 뜻은 아니다. 형태를 먼저 확인하고 나서 쓴다.
 *
 * ★ 우리는 `randomBytes(24).toString('base64url')` 로 만든다 → 32자, `[A-Za-z0-9_-]`.
 *   범위를 조금 넓게 두되 제어문자·NUL 은 절대 통과하지 못하게 한다.
 */
export function looksLikeSerial(v: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(v);
}

/** 콜백 `data` 를 복호해 얻는 키 정보. */
export interface BitgetIssuedKey {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * 복호된 JSON 을 검증한다.
 *
 * ★★ 세 값이 모두 비어 있지 않아야 한다. 하나라도 빈 문자열이면 저장하지 않는다 —
 *   빈 passphrase 로 저장하면 나중에 모든 요청이 서명 오류로 실패하고, 고객에게는
 *   "연결됨" 으로 보인다. 그 상태가 가장 나쁘다.
 */
export function parseIssuedKey(json: string): BitgetIssuedKey | null {
  let o: unknown;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : '';
  const secret = typeof r.secret === 'string' ? r.secret.trim() : '';
  const passphrase = typeof r.passphrase === 'string' ? r.passphrase.trim() : '';
  if (!apiKey || !secret || !passphrase) return null;
  return { apiKey, secret, passphrase };
}

export function createBitgetOauthRouter(d: BitgetOauthDeps): Hono {
  const app = new Hono();
  const sessionHash = (c: Context) =>
    createHash('sha256').update(String(getCookie(c, d.cookieName) ?? '')).digest('hex');

  /*
     ★ 기존 라우터(trading-routes · kucoin-oauth)와 같은 형태로 맞춘다 —
       `validateSession` 은 `{ user, session }` 을 주므로 csrfSecret 은 session 안에 있다.
  */
  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  /*
     ★ `verifyCsrf` 는 헤더·쿠키·세션 비밀·서버 키 **네 값**을 받는다. 헤더만
       비교하면 쿠키를 심을 수 있는 공격자가 통과한다(이중 제출 방식).
  */
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins)
    && verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, d.csrfCookieName), secret, d.csrfKey);
  const err = (code: string, message: string) => ({ error: { code, message } });

  /*
     1) 인증 시작 — 고객을 Bitget 승인 페이지로 보낼 URL 을 만든다.

     ★ URL 을 서버에서 만든다. 화면이 만들면 `clientId`·서명을 브라우저에 노출해야
       하고, 서명 대상(timestamp·clientUserId)을 고객이 고칠 수 있다.
  */
  app.post('/exchanges/bitget/oauth/start', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    if (!hasPermission(a.user.role, 'account.update.self')) {
      return c.json(err('FORBIDDEN', 'permission'), 403);
    }

    /* ★ 192비트 난수. 추측되면 serialNo 대조가 무의미하다. */
    const serialNo = randomBytes(24).toString('base64url');
    const timestamp = String(Date.now());

    await d.pool.query(
      `INSERT INTO bitget_oauth_states (serial_no, user_id, session_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
      [serialNo, a.user.id, sessionHash(c), String(SERIAL_TTL_MS)],
    );

    /*
       ★★ 서명 대상에는 문서가 정한 세 값만 넣는다 — `clientId`, `clientUserId`,
         `timestamp`. `serialNo`·`redirectUrl` 은 서명 대상이 아니다(문서 1번 표).
         임의로 넣으면 Bitget 검증이 실패한다.
    */
    const sign = signPayload(
      { clientId: d.clientId, clientUserId: a.user.id, timestamp },
      d.rsaPrivateKey,
    );

    const q = new URLSearchParams({
      clientUserId: a.user.id,
      timestamp,
      clientId: d.clientId,
      redirectUrl: d.redirectUri,
      sign,
      serialNo,
    });
    /*
       ★★★ 추천 코드. **없으면 리베이트가 0 이다**(BD 확인 2026-09-13).
         값이 없으면 붙이지 않는다 — 빈 파라미터를 보내면 Bitget 쪽에서 어떻게
         해석할지 알 수 없고, 추측으로 URL 을 만들지 않는다.
    */
    if (d.vipCode) q.set('vipCode', d.vipCode);
    if (d.channelCode) q.set('channelCode', d.channelCode);

    return c.json({
      url: `${d.oauthBase}?${q.toString()}`,
      expiresInMs: SERIAL_TTL_MS,
      /* ★ 리베이트 귀속 여부를 화면이 알 수 있게 알려준다 — 숨기지 않는다. */
      referralAttached: Boolean(d.vipCode),
    });
  });

  /*
     2) Bitget → 우리 콜백. **인증되지 않은 서버 대 서버 요청이다.**

        ★★★ 여기서 실수하면 계정 탈취가 된다. 파일 머리 주석의 네 가지 검사를
          모두 통과해야 한다. 어느 하나라도 실패하면 **저장하지 않는다.**

        ★ 실패 응답에 이유를 자세히 쓰지 않는다. 이 엔드포인트는 공개돼 있고,
          "serialNo 가 없다" 와 "사용자가 다르다" 를 구분해 알려주면 공격자가
          탐색에 쓸 수 있다. 서버 로그에는 남긴다.
  */
  app.post('/exchanges/bitget/oauth/callback', async (c) => {
    const ct = c.req.header('content-type') ?? '';
    /*
       ★★ 문서가 `application/x-www-form-urlencoded` 를 명시한다. JSON 도 함께
         받아들이는 것은 관용이 아니라 위험이다 — 파싱 경로가 둘이면 한쪽만 검증하는
         실수가 생긴다. 다만 Bitget 이 형식을 바꿀 수 있으므로 **거부하지 않고**
         두 경로를 명시적으로 처리하고, 어느 경로였는지 로그에 남긴다.
    */
    let body: Record<string, string> = {};
    try {
      if (ct.includes('application/json')) {
        const j = (await c.req.json()) as Record<string, unknown>;
        for (const [k, v] of Object.entries(j)) body[k] = typeof v === 'string' ? v : String(v ?? '');
      } else {
        const f = await c.req.parseBody();
        for (const [k, v] of Object.entries(f)) body[k] = typeof v === 'string' ? v : String(v ?? '');
      }
    } catch {
      body = {};
    }

    const clientUserId = String(body.clientUserId ?? '').trim();
    const timestamp = String(body.timestamp ?? '').trim();
    const signRaw = String(body.sign ?? '').trim();
    const dataRaw = String(body.data ?? '').trim();
    const openId = String(body.openId ?? '').trim();

    const reject = (why: string) => {
      console.warn(`[bitget-oauth] ★ 콜백 거부 — reason=${why} clientUserId=${clientUserId || '(none)'} ct=${ct}`);
      /* ★ 형식은 Bitget 규격을 지키되 코드로 실패를 알린다. */
      return c.json({ code: '40001', msg: 'invalid request', requestTime: String(Date.now()) }, 400);
    };

    if (!clientUserId || !timestamp || !signRaw || !dataRaw) return reject('missing-fields');

    /* 4) 시각 — 양방향 5분. 미래 시각도 거부한다. */
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CALLBACK_SKEW_MS) return reject('timestamp-skew');

    /* 1) sign 복호 → serialNo */
    const serialFromSign = decryptRsa(signRaw, d.rsaPrivateKey);
    if (!serialFromSign) return reject('sign-undecryptable');
    /*
       ★★★ 복호 결과의 **형태를 확인한다.** 복호가 예외 없이 쓰레기를 돌려줄 수
         있고, 그 안의 NUL 바이트를 SQL 로 넘기면 Postgres 가 던져 500 이 된다
         (시험에서 실제로 발견했다). 형태가 아니면 조용히 거부한다.
    */
    const serial = serialFromSign.trim();
    if (!looksLikeSerial(serial)) return reject('sign-malformed');

    /*
       2)+3) serialNo 를 **원자적으로 소비**한다.

       ★★ 조회 후 갱신으로 나누면 같은 콜백이 두 번 오는 경우(재시도) 두 번 처리될
         수 있다. `used_at IS NULL` 조건을 UPDATE 에 넣어 한 번만 통과하게 만든다.
       ★★★ `user_id` 일치를 **SQL 조건에 넣는다.** 애플리케이션에서 비교하면
         한 곳에서 빠뜨릴 수 있고, 그 빈틈이 곧 계정 탈취다.
    */
    let userId: string | undefined;
    try {
      const claimed = await d.pool.query<{ user_id: string }>(
        `UPDATE bitget_oauth_states
            SET used_at = now(), open_id = COALESCE($3, open_id)
          WHERE serial_no = $1
            AND user_id = $2
            AND used_at IS NULL
            AND expires_at > now()
          RETURNING user_id`,
        [serial, clientUserId, openId || null],
      );
      userId = claimed.rows[0]?.user_id;
    } catch (e) {
      /*
         ★★ 조회 실패를 "일치하지 않음" 으로 바꾸지 않는다. 둘은 다른 사실이다.
           다만 콜백은 공개 엔드포인트이므로 이유를 자세히 알려주지 않고 500 으로
           답한다 — Bitget 이 재시도하면 그때는 성공할 수 있다.
         ★ `clientUserId` 가 UUID 형식이 아닌 경우도 여기로 온다(uuid 캐스팅 오류).
           그것도 거부 대상이지만 우리 잘못이 아니므로 로그를 남기고 넘긴다.
      */
      console.warn(`[bitget-oauth] ★ serialNo 조회 실패 — ${(e as Error).message}`);
      return c.json({ code: '50000', msg: 'internal error', requestTime: String(Date.now()) }, 500);
    }
    if (!userId) return reject('serial-not-claimable');

    /* data 복호 → { apiKey, secret, passphrase } */
    const plain = decryptRsa(dataRaw, d.rsaPrivateKey);
    if (!plain) return reject('data-undecryptable');
    const key = parseIssuedKey(plain);
    if (!key) return reject('data-incomplete');

    /*
       저장. **기존 수동 등록과 같은 경로**(vault + credRepo)를 쓴다.

       ★ 별도 경로를 만들면 조회·검증·삭제를 두 벌 관리해야 하고, 한쪽만 고치는
         실수가 생긴다. KuCoin OAuth 도 같은 이유로 이 경로를 쓴다.
       ★ `memo` 가 우리 저장 구조에서 passphrase 자리다.
    */
    try {
      const enc = await d.vault.encrypt({
        accessKey: key.apiKey,
        secretKey: key.secret,
        memo: key.passphrase,
      });
      const created = await d.credRepo.create(userId, enc, 'Bitget (FastApi)', 'bitget');

      /*
         ★★ FastApi 로 만든 키는 Bitget 이 권한을 확정해 발급한 것이다. 그러나
           **VERIFIED 로 올리지 않는다.**

           BD 는 "출금 권한 제외" 를 서면으로 답했지만, KuCoin 에서 문서와 실제
           동작이 달라 프로덕션 로그에서 `40503 isAddressbookOnly mismatch` 를
           발견한 적이 있다. 그래서 실제 조회를 한 번 성공시킨 뒤에 VERIFIED 로
           올리는 것이 맞다 — 그 검증은 어댑터가 준비된 뒤에 붙인다.

         ★ 지금은 저장까지만 한다. 어댑터 없이 VERIFIED 로 표시하면 화면이
           "연결됨" 을 보여주는데 조회는 전부 실패한다 — 고객에게 거짓이 된다.
      */
      console.log(
        `[bitget-oauth] 키 저장 — user=${userId} cred=${created.id} openId=${openId ? 'yes' : 'no'}`,
      );

      if (d.onExchangeVerified) {
        try { await d.onExchangeVerified(userId); } catch { /* 알림 실패는 비치명 */ }
      }
    } catch (e) {
      console.error(`[bitget-oauth] ★ 키 저장 실패 — user=${userId}: ${(e as Error).message}`);
      /*
         ★★ 실패를 성공으로 답하지 않는다. Bitget 이 재시도하면 이미 `used_at` 이
           찍혀 통과하지 못하므로, 고객은 다시 인증해야 한다. 그것이 키를
           잃어버린 채 "성공" 이라고 답하는 것보다 낫다.
      */
      return c.json({ code: '50000', msg: 'internal error', requestTime: String(Date.now()) }, 500);
    }

    return c.json({ ...BITGET_OK, requestTime: String(Date.now()) });
  });

  /*
     3) 브라우저 복귀. Bitget 이 성공·실패와 무관하게 이 주소로 되돌려보낸다.

        ★ 여기서는 **키를 다루지 않는다.** 키는 위 콜백에서 이미 저장됐다.
          이 경로의 목적은 고객을 앱으로 돌려보내고 결과를 알려주는 것뿐이다.
        ★★ 그래서 이 경로의 판정 결과로 저장을 되돌리거나 바꾸지 않는다 — 브라우저
          쿼리는 고객이 고칠 수 있고, 저장 여부의 근거가 될 수 없다.
  */
  app.get('/exchanges/bitget/oauth/return', async (c) => {
    const path = d.appReturnPath ?? '/';
    const hash = d.appReturnHash ?? '#/wallet';
    const back = (status: string) => c.redirect(`${path}${hash}?bitget=${encodeURIComponent(status)}`, 302);

    const clientUserId = String(c.req.query('clientUserId') ?? '').trim();
    const signRaw = String(c.req.query('sign') ?? '').trim();
    const stateRaw = String(c.req.query('state') ?? '').trim();
    if (!clientUserId || !signRaw) return back('invalid');

    const serialDec = decryptRsa(signRaw, d.rsaPrivateKey);
    if (!serialDec) return back('invalid');
    /* ★ 콜백과 같은 이유로 형태를 확인한다 — 쓰레기값을 SQL 로 넘기지 않는다. */
    const serial = serialDec.trim();
    if (!looksLikeSerial(serial)) return back('invalid');

    /*
       ★ `used_at` 을 조건에 넣지 않는다. 정상 흐름에서는 콜백이 먼저 와서 이미
         소비된 상태다. 여기서 미사용을 요구하면 성공 경로가 항상 'invalid' 가 된다.
       ★★ 대신 **serialNo ↔ user_id 일치**는 확인한다. 문서도 이것을 권고한다
         ("query the clientUserId using the serialNo and verify if it matches").
    */
    const row = await d.pool.query<{ user_id: string }>(
      `SELECT user_id FROM bitget_oauth_states WHERE serial_no = $1 AND user_id = $2`,
      [serial, clientUserId],
    );
    if (!row.rows[0]) return back('invalid');

    /*
       상태는 공개키로 암호화돼 온다(문서 3.1). 복호에 실패하면 결과를 단정하지
       않는다 — 'unknown' 으로 보내고 화면이 지갑 상태를 다시 조회하게 한다.
       ★ 실패를 성공으로 바꾸지 않는 것이 핵심이다.
    */
    const state = decryptRsa(stateRaw, d.rsaPrivateKey);
    if (state === 'SUCCESS') return back('connected');
    if (state === 'FAIL') return back('declined');
    return back('unknown');
  });

  return app;
}
