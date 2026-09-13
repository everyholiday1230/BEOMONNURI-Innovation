/*
   ═══ Bitget FastApi (OAuth) ═══

   ★★★ 이 흐름의 위험은 **콜백에 있다.**

     Bitget 은 우리 콜백으로 **API 키를 직접 POST 한다**(서버 대 서버). 세션 쿠키가
     없으므로 "이 요청이 정말 Bitget 이 보낸 것인가" 를 판정할 근거가 **RSA 서명뿐**이다.

     실수하면 계정 탈취다. 공격자가 자기 Bitget 계정으로 인증한 뒤 콜백 본문의
     `clientUserId` 만 피해자 것으로 바꿔 보내면, **피해자 계정에 공격자의 거래소
     키가 연결되고** 피해자가 내는 주문이 공격자 계정에서 실행된다.

   ★ 그래서 여기서는 **거부되어야 하는 경우**를 하나하나 확인한다. 성공 경로 하나만
     보는 시험은 이 종류의 결함을 못 잡는다.
*/
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, publicEncrypt, constants as cc, randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import {
  buildSignData, signPayload, decryptRsa, parseIssuedKey,
  isBitgetOauthConfigured, createBitgetOauthRouter, looksLikeSerial,
} from '../bitget-oauth-routes';

/** PEM → Bitget 이 쓰는 base64(헤더 없음). */
const toB64 = (pem: string) => pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const PRIV_B64 = toB64(privateKey);

/** Bitget 이 우리 공개키로 암호화하는 것을 흉내낸다(PKCS#1 v1.5). */
const encForUs = (plain: string) =>
  publicEncrypt({ key: publicKey, padding: cc.RSA_PKCS1_PADDING }, Buffer.from(plain)).toString('base64');

describe('Bitget FastApi — 서명과 암복호 규격', () => {
  it('서명 대상은 키를 사전순 정렬해 key+value 로 이어붙인다', () => {
    /*
       ★★ Bitget 예시(2.1.2)는 TreeSet 정렬이다. 순서가 다르면 서명이 달라지고
         Bitget 이 거부한다. 문서 산문의 "clientUserId[]timestamp[]clientId[]" 표기와
         코드가 어긋나는데, **검증하는 쪽은 코드**이므로 코드를 따른다.
       ★ 문서의 실제 예시값으로 확인한다.
    */
    expect(buildSignData({ timestamp: '1691117744470', clientId: '1', clientUserId: '123' }))
      .toBe('clientId1clientUserId123timestamp1691117744470');
  });

  it('MD5withRSA 서명이 우리 공개키로 검증된다', async () => {
    const { verify } = await import('node:crypto');
    const params = { clientId: 'cid', clientUserId: 'uid', timestamp: '1700000000000' };
    const sig = signPayload(params, PRIV_B64);
    expect(verify('md5', Buffer.from(buildSignData(params)), publicKey, Buffer.from(sig, 'base64')))
      .toBe(true);
  });

  it('PKCS#1 v1.5 로 암호화된 값을 복호한다', () => {
    /*
       ★★★ Node 기본 패딩은 **OAEP** 다. Bitget 의 Java `Cipher.getInstance("RSA")` 는
         PKCS#1 v1.5 이므로 명시하지 않으면 복호가 실패한다. 이 시험이 그 규격을 지킨다.
    */
    const payload = JSON.stringify({ apiKey: 'bg_a', secret: 's', passphrase: 'p' });
    expect(decryptRsa(encForUs(payload), PRIV_B64)).toBe(payload);
  });

  it('★★★ 잘못된 암호문은 원문을 내주지 않는다 — 다만 쓰레기가 나올 수 있다', () => {
    /*
       ★★★ 처음에는 `toBeNull()` 을 기대했는데 **틀렸다.**

         `privateDecrypt` 는 PKCS#1 v1.5 패딩 검사를 통과하는 잘못된 암호문에
         **예외 없이 쓰레기 바이트를 돌려줄 수 있다.** 실제로 확인했다:
           Buffer.from('not-base64-rsa','base64')  // 10바이트
           → 예외 없이 32바이트 쓰레기 반환

       ★★ 그래서 **복호 성공을 신뢰하면 안 된다.** 이 사실이 실제 결함으로 이어졌다 —
         쓰레기 안의 `0x00` 을 SQL 파라미터로 넘겨 Postgres 가
         `invalid byte sequence for encoding "UTF8": 0x00` 으로 던지고 **500** 이 났다.
         `looksLikeSerial()` 로 형태를 먼저 확인하도록 고쳤다.

       ★ 이 시험이 지키는 것은 "원문이 새지 않는다" 다. null 을 요구하면 규격을
         잘못 이해한 시험이 되고, 나중에 누가 그것을 맞추려고 엉뚱한 코드를 넣는다.
    */
    const plain = 'the-real-serial-value';
    const wrong = publicEncrypt({ key: publicKey, padding: cc.RSA_PKCS1_OAEP_PADDING }, Buffer.from(plain))
      .toString('base64');
    expect(decryptRsa(wrong, PRIV_B64), 'OAEP 암호문에서 원문이 나왔다').not.toBe(plain);
  });

  it('serialNo 형태 검증이 제어문자·NUL 을 막는다', () => {
    /*
       ★★★ 이것이 500 을 막는 장치다. 복호된 쓰레기가 SQL 로 가지 못하게 한다.
       ★ 우리는 `randomBytes(24).toString('base64url')` → 32자를 만든다.
    */
    expect(looksLikeSerial(randomBytes(24).toString('base64url'))).toBe(true);
    for (const bad of ['', 'short', 'has space', 'nul\u0000byte', 'tab\there', 'a'.repeat(65), '한글값']) {
      expect(looksLikeSerial(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('키 정보는 세 값이 모두 있어야 받아들인다', () => {
    /*
       ★★ 빈 passphrase 로 저장하면 이후 모든 요청이 서명 오류로 실패하는데 화면에는
         "연결됨" 으로 보인다. 그 상태가 가장 나쁘다 — 고객은 우리 제품이 고장 났다고
         판단하고, 우리는 원인을 키에서 찾지 않는다.
    */
    expect(parseIssuedKey('{"apiKey":"a","secret":"s","passphrase":"p"}'))
      .toEqual({ apiKey: 'a', secret: 's', passphrase: 'p' });
    for (const bad of [
      '{"apiKey":"a","secret":"s"}',
      '{"apiKey":"a","secret":"s","passphrase":""}',
      '{"apiKey":"","secret":"s","passphrase":"p"}',
      'not json',
      'null',
    ]) {
      expect(parseIssuedKey(bad), bad).toBeNull();
    }
  });

  it('설정이 하나라도 없으면 라우터를 등록하지 않는다', () => {
    /*
       ★★★ 반쯤 동작하는 연결 흐름은 고객이 인증까지 하고 실패하는 것을 뜻한다.
         그 시점에 Bitget 쪽에는 **이미 키가 만들어져** 있다 — 우리가 받지 못한 키가
         고객 계정에 남는다.
    */
    const full = {
      bitgetOauthClientId: 'c',
      bitgetOauthRsaPrivateKey: 'k',
      bitgetOauthRedirectUri: 'https://x/y',
    };
    expect(isBitgetOauthConfigured(full)).toBe(true);
    for (const k of Object.keys(full) as (keyof typeof full)[]) {
      expect(isBitgetOauthConfigured({ ...full, [k]: '   ' }), k).toBe(false);
    }
  });
});

const dPg = process.env.PG_TEST_URL ? describe : describe.skip;

dPg('Bitget FastApi — 콜백은 거부되어야 할 것을 거부한다', () => {
  let pool: pg.Pool;
  let app: Hono;
  const CLIENT_ID = 'test-client';
  const REDIRECT = 'https://app.example/api/exchanges/bitget/oauth/return';

  /** 저장된 자격증명을 세기 위한 최소 구현. */
  const created: Array<{ userId: string; exchange: string }> = [];

  const mkUser = async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status)
       VALUES ($1, $2, 'x', 'USER', 'active') ON CONFLICT DO NOTHING`,
      [id, `bg-${id.slice(0, 8)}@test.local`],
    );
    return id;
  };

  /** 시작 단계를 흉내내 serialNo 를 심는다(라우트의 CSRF·세션을 우회하지 않기 위해 직접 INSERT). */
  const seedSerial = async (userId: string, opts: { expired?: boolean; used?: boolean } = {}) => {
    const serial = randomUUID();
    await pool.query(
      `INSERT INTO bitget_oauth_states (serial_no, user_id, session_hash, expires_at, used_at)
       VALUES ($1, $2, 'h', now() + ($3 || ' milliseconds')::interval, $4)`,
      [serial, userId, opts.expired ? '-60000' : '600000', opts.used ? new Date() : null],
    );
    return serial;
  };

  const post = async (body: Record<string, string>) =>
    app.request('/api/exchanges/bitget/oauth/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

  const goodBody = async (userId: string, serial: string, over: Partial<Record<string, string>> = {}) => ({
    openId: 'oid',
    clientUserId: userId,
    timestamp: String(Date.now()),
    sign: encForUs(serial),
    data: encForUs(JSON.stringify({ apiKey: 'bg_a', secret: 's', passphrase: 'p' })),
    ...over,
  });

  beforeAll(async () => {
    pool = createPool(await createIsolatedTestDatabase(process.env.PG_TEST_URL!, 'bitget_oauth'));
    await migrateUp(pool);
    app = new Hono();
    app.route('/api', createBitgetOauthRouter({
      service: { async validateSession() { return null; } } as never,
      vault: { async encrypt() { return { blob: 'enc' } as never; } } as never,
      credRepo: {
        async create(userId: string, _enc: unknown, _label: string, exchange: string) {
          created.push({ userId, exchange });
          return { id: 'cred-1' } as never;
        },
      } as never,
      pool,
      csrfKey: 'k',
      corsOrigins: ['https://app.example'],
      cookieName: 'qt_session',
      csrfCookieName: 'qt_csrf',
      clientId: CLIENT_ID,
      rsaPrivateKey: PRIV_B64,
      redirectUri: REDIRECT,
      oauthBase: 'https://www.bitget.com/en/account/oauth',
    }));
  }, 120_000);

  afterAll(async () => { await pool?.end(); });

  it('정상 콜백은 키를 저장하고 Bitget 규격으로 응답한다', async () => {
    const u = await mkUser();
    const serial = await seedSerial(u);
    const before = created.length;
    const res = await post(await goodBody(u, serial));
    expect(res.status).toBe(200);
    /* ★ Bitget 이 재시도하지 않도록 이 형태를 지켜야 한다. */
    expect(await res.json()).toMatchObject({ code: '00000', msg: 'success' });
    expect(created.length - before, '자격증명이 저장되지 않았다').toBe(1);
    expect(created[created.length - 1]).toMatchObject({ userId: u, exchange: 'bitget' });
  });

  it('★★★ 다른 사람의 clientUserId 로는 키를 심을 수 없다', async () => {
    /*
       이것이 이 파일에서 가장 중요한 시험이다. 통과하지 못하면 **계정 탈취**가 된다.
       공격자가 자기 Bitget 계정으로 인증해 얻은 serialNo·키를, 피해자의
       clientUserId 와 함께 보내는 상황이다.
    */
    const attacker = await mkUser();
    const victim = await mkUser();
    const serial = await seedSerial(attacker);       // serialNo 는 공격자에게 발급됨
    const before = created.length;
    const res = await post(await goodBody(victim, serial));  // 피해자 id 로 제출
    expect(res.status).toBe(400);
    expect(created.length, '피해자 계정에 키가 저장됐다').toBe(before);
  });

  it('같은 콜백을 두 번 보내도 한 번만 처리된다', async () => {
    /* ★ Bitget 이 재시도할 수 있다. `used_at` 을 UPDATE 조건에 넣어 원자적으로 막는다. */
    const u = await mkUser();
    const serial = await seedSerial(u);
    const body = await goodBody(u, serial);
    const first = await post(body);
    const before = created.length;
    const second = await post(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(created.length, '두 번째 요청이 또 저장했다').toBe(before);
  });

  it('만료된 serialNo 는 거부한다', async () => {
    const u = await mkUser();
    const serial = await seedSerial(u, { expired: true });
    expect((await post(await goodBody(u, serial))).status).toBe(400);
  });

  it('이미 사용된 serialNo 는 거부한다', async () => {
    const u = await mkUser();
    const serial = await seedSerial(u, { used: true });
    expect((await post(await goodBody(u, serial))).status).toBe(400);
  });

  it('존재하지 않는 serialNo 는 거부한다', async () => {
    const u = await mkUser();
    expect((await post(await goodBody(u, randomUUID()))).status).toBe(400);
  });

  it('시각이 5분을 벗어나면 거부한다 — 미래 시각도 거부한다', async () => {
    /*
       ★★ 양방향으로 본다. 미래 시각을 통과시키면 시계를 앞당긴 위조 요청이
         만료 검사를 우회한다.
    */
    for (const skew of [-6 * 60 * 1000, 6 * 60 * 1000]) {
      const u = await mkUser();
      const serial = await seedSerial(u);
      const res = await post(await goodBody(u, serial, { timestamp: String(Date.now() + skew) }));
      expect(res.status, `skew=${skew}`).toBe(400);
    }
  });

  it('★★ 서명이 쓰레기로 복호되면 400 으로 거부한다 — 500 이 아니다', async () => {
    /*
       ★★★ 이 시험이 실제 결함을 찾아냈다.

         `sign: 'not-base64-rsa'` → `privateDecrypt` 가 **예외 없이 쓰레기**를 돌려주고,
         그 안의 `0x00` 을 SQL 파라미터로 넘기니 Postgres 가
         `invalid byte sequence for encoding "UTF8": 0x00` 으로 던져 **500** 이 났다.

       ★ 왜 400 이어야 하나
         · 잘못된 요청은 우리 잘못이 아니다 — 400 이 사실이다
         · Bitget 은 5xx 를 **재시도 가능**으로 볼 수 있다. 영원히 실패할 요청을
           재시도하게 만들면 서로 자원을 낭비한다
         · 500 이면 로그가 스택 추적으로 덮여 진짜 장애를 못 본다
         · 공격자가 아무 문자열로 500 을 만들 수 있다는 것 자체가 잘못된 신호다

       ★★ 그래서 **상태 코드를 단정한다.** "400 또는 500" 처럼 느슨하게 두면
         `looksLikeSerial` 을 지워도 통과해 버린다(역검증에서 확인했다).
    */
    const u = await mkUser();
    const serial = await seedSerial(u);
    const res = await post(await goodBody(u, serial, { sign: 'not-base64-rsa' }));
    expect(res.status, '쓰레기 서명이 500 을 만들었다 — 형태 검증이 빠졌다').toBe(400);
    expect(await res.json()).toMatchObject({ code: '40001' });
  });

  it('★★ 형태 검증이 DB 호출 **앞에** 배선돼 있다', () => {
    /*
       ★★★ 왜 소스를 확인하는가 — 동작 시험으로는 **결정적으로 재현되지 않는다.**

         `not-base64-rsa` 를 복호하면 쓰레기가 나오는데, 그 바이트는 **키쌍마다
         다르다.** `0x00` 이 섞이는 경우에만 Postgres 가 던져 500 이 됐다. 즉 위
         시험은 운에 따라 통과하기도 한다 — 역검증에서 `looksLikeSerial` 을 지워도
         17건 전부 통과하는 것을 실제로 확인했다.

       ★ 그래서 **배선 자체**를 검사한다. 주석을 먼저 제거해 설명 문장이 정규식에
         걸리는 거짓 통과를 막는다.
    */
    const src = readFileSync(new URL('../bitget-oauth-routes.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

    const guard = src.indexOf('looksLikeSerial(serial)');
    const update = src.indexOf('UPDATE bitget_oauth_states');
    expect(guard, '콜백에서 looksLikeSerial 을 부르지 않는다').toBeGreaterThan(-1);
    expect(update, 'UPDATE 문을 찾지 못했다').toBeGreaterThan(-1);
    expect(guard, '형태 검증이 DB 호출 뒤에 있다 — 쓰레기가 SQL 로 간다')
      .toBeLessThan(update);

    /* ★ 복귀 경로에도 같은 검증이 있어야 한다 — 거기도 SQL 로 값을 넘긴다. */
    expect(src.match(/looksLikeSerial\(/g)?.length ?? 0, '한 경로에만 검증이 있다')
      .toBeGreaterThanOrEqual(2);
  });

  it('data 가 불완전하면 거부하고 저장하지 않는다', async () => {
    /* ★ serialNo 는 소비됐지만 저장은 하지 않는다 — 반쪽 자격증명을 만들지 않는다. */
    const u = await mkUser();
    const serial = await seedSerial(u);
    const before = created.length;
    const res = await post(await goodBody(u, serial, {
      data: encForUs(JSON.stringify({ apiKey: 'a', secret: 's' })),   // passphrase 없음
    }));
    expect(res.status).toBe(400);
    expect(created.length).toBe(before);
  });

  it('필수 항목이 빠지면 거부한다', async () => {
    const u = await mkUser();
    const serial = await seedSerial(u);
    const full = await goodBody(u, serial);
    for (const k of ['clientUserId', 'timestamp', 'sign', 'data']) {
      const body = { ...full, [k]: '' };
      expect((await post(body)).status, k).toBe(400);
    }
  });
});
