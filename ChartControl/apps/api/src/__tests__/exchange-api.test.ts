import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  ExchangeListItemSchema,
  ExchangeListResponseSchema,
  ExchangeSchema,
} from '@quantumtrade/schemas';
import { createExchangeRouter } from '../exchanges/exchange-routes';
import {
  CONNECTABLE_EXCHANGE_IDS,
  EXCHANGES,
  findForbiddenGrants,
  getConfirmedReferrals,
  getExchange,
} from '../exchanges/exchange-catalog';

/**
 * G1 exchange catalogue — route contract over real HTTP.
 *
 * The router is mounted exactly as `index.ts` mounts it (`app.route('/api', ...)`), so the full
 * `/api/v1/exchanges` path the frontend calls is what gets exercised. Response bodies are validated
 * against the published Zod schema rather than spot-checked field by field, so a handler that drops or
 * renames a field the UI reads fails here.
 */

const FIXED_NOW = 1_700_000_000_000;

function build() {
  const app = new Hono();
  app.route('/api', createExchangeRouter({ now: () => FIXED_NOW }));
  return app;
}

/** `Response.json()` is `unknown` under strict mode; assert the shape once at the call site. */
type ListBody = {
  items: { id: string; referral: string; connectable: boolean }[];
  total: number;
  hiddenNotConnectable: number;
};
type ErrBody = { error: { code: string; message: string; correlationId: string } };
const asJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** The 8 ids the design handoff commits to (`team_delivery/README.md`). */
/**
 * 카탈로그 순서와 구성. 목록을 느슨하게 검사하지 않는 이유:
 * referral 링크가 매출과 직결되므로 거래소가 조용히 빠지거나 추가되는 것을
 * 반드시 실패로 드러내야 한다.
 *
 * kucoin 이 첫 자리인 것은 현재 브로커 계약 거래소이기 때문이다.
 * bitmart 는 2026-08-26 거래 종료지만 목록에서 지우지 않았다 — 사용자가 이미
 * 연결해 둔 키가 있을 수 있고, 화면에서 항목이 사라지면 그 사실조차 알 수 없다.
 */
const EXPECTED_IDS = [
  'kucoin',
  'binance',
  'bitget',
  'bitmart',
  'okx',
  'bybit',
  'gate',
  'kraken',
  'coinbase',
];

describe('EXG-01 catalogue integrity', () => {
  it('[1] contains exactly the expected exchanges, in order', () => {
    expect(EXCHANGES.map((e) => e.id)).toEqual(EXPECTED_IDS);
  });

  it('[2] every entry satisfies the published schema', () => {
    // The catalogue module validates at load time and throws; this asserts that guarantee explicitly
    // so a future change that swaps the throw for a log does not go unnoticed.
    for (const e of EXCHANGES) {
      expect(ExchangeSchema.safeParse(e).success).toBe(true);
    }
  });

  it('[3] Withdraw is forbidden on every exchange that offers it (absolute rule §5.4)', () => {
    const offering = EXCHANGES.filter((e) => e.permissions.includes('Withdraw'));
    // Guard the guard: if the catalogue stopped listing Withdraw anywhere, this test would pass
    // vacuously and stop protecting the rule.
    expect(offering.length).toBeGreaterThan(0);
    for (const e of offering) {
      expect(e.forbiddenPermissions).toContain('Withdraw');
    }
  });

  it('[4] no exchange requires Withdraw, and all require Read + Trade', () => {
    for (const e of EXCHANGES) {
      expect(e.requiredPermissions).not.toContain('Withdraw');
      expect(e.requiredPermissions).toEqual(expect.arrayContaining(['Read', 'Trade']));
    }
  });

  it('[5] referral URL is present and https for every exchange', () => {
    for (const e of EXCHANGES) {
      expect(e.referral.startsWith('https://')).toBe(true);
      /*
         ★ 문장이 아니라 번역 키를 검사한다. 서버가 한국어 문장을 담으면
           다국어 화면에 그대로 새어 나온다(그래서 키로 바꿨다).
      */
      expect(e.referralNoteKey.length).toBeGreaterThan(0);
      expect(e.referralNoteKey).toMatch(/^[a-z0-9_]+$/);
      expect(e).not.toHaveProperty('referralNote');
    }
  });

  it('[5b] ★★ the confirmed KuCoin referral uses the broker path and matches its code', () => {
    /*
       왜 이것을 검사로 묶는가

       ★★ `/r/rf/` 와 `/r/broker/` 는 둘 다 같은 코드를 받고, 브라우저에서
          똑같이 정상 동작한다. 그런데 `/r/rf/` 는 일반 개인 추천이라
          **브로커 계정에 귀속되지 않는다.** 경로를 잘못 쓰면 가입은 계속
          일어나고 리베이트만 0 이 된다 — 화면에 오류가 없으니 아무도
          알아채지 못한다. 실제로 이 카탈로그에 `/r/rf/QUANTUM-KURI` 라는
          자리표시자가 들어 있었다.

       ★ 링크와 코드가 어긋나면 가입 경로에 따라 귀속이 갈린다. 링크로 들어온
         사람과 앱에서 코드를 입력한 사람이 서로 다른 계정에 붙는다.
    */
    const kucoin = getExchange('kucoin');
    expect(kucoin).toBeDefined();
    expect(kucoin?.referralConfirmed).toBe(true);
    expect(kucoin?.referral).toMatch(/^https:\/\/www\.kucoin\.com\/r\/broker\//u);
    expect(kucoin?.referral).not.toMatch(/\/r\/rf\//u);
    // 자리표시자가 다시 들어오는 것을 막는다.
    expect(kucoin?.referral).not.toMatch(/QUANTUM/iu);
    expect(kucoin?.referralCode).not.toMatch(/QUANTUM/iu);
    // 링크 끝의 코드와 referralCode 가 같아야 한다.
    expect(kucoin?.referral.endsWith(String(kucoin?.referralCode))).toBe(true);
  });

  it('[5c] only confirmed referrals become UI defaults', () => {
    /*
       확인되지 않은 거래소의 자리표시자 링크가 화면 기본값으로 새어 나가면,
       그쪽으로 가입한 사람은 정상 가입되고 수익만 0 이 된다. 그래서 기본값은
       referralConfirmed 인 항목만이어야 한다.
    */
    const { urls, codes } = getConfirmedReferrals();
    const confirmed = EXCHANGES.filter((e) => e.referralConfirmed === true).map((e) => e.id);
    expect(Object.keys(urls).sort()).toEqual([...confirmed].sort());
    for (const id of Object.keys(urls)) {
      expect(urls[id]).toMatch(/^https:\/\//u);
      expect(urls[id]).not.toMatch(/QUANTUM/iu);
    }
    for (const id of Object.keys(codes)) {
      expect(codes[id]).toMatch(/^[A-Za-z0-9_-]{2,32}$/u);
    }
  });

  it('[6] ids are unique', () => {
    expect(new Set(EXCHANGES.map((e) => e.id)).size).toBe(EXCHANGES.length);
  });

  it('[7] the catalogue is frozen against mutation by a request handler', () => {
    expect(Object.isFrozen(EXCHANGES)).toBe(true);
  });

  it('[8] credential fields match each exchange\u2019s real auth scheme', () => {
    // Transcribed from the handoff; a silent change here would break the connect wizard.
    expect(getExchange('bitmart')?.required).toEqual(['apiKey', 'apiSecret', 'memo']);
    expect(getExchange('okx')?.required).toEqual(['apiKey', 'apiSecret', 'passphrase']);
    expect(getExchange('bitget')?.required).toEqual(['apiKey', 'apiSecret', 'passphrase']);
    expect(getExchange('kraken')?.required).toEqual(['apiKey', 'privateKey']);
    expect(getExchange('binance')?.required).toEqual(['apiKey', 'apiSecret']);
    // KuCoin 은 passphrase 없이는 서명을 만들 수 없다. 마법사가 세 필드를 다 받아야 한다.
    expect(getExchange('kucoin')?.required).toEqual(['apiKey', 'apiSecret', 'passphrase']);
  });
});

describe('EXG-02 GET /api/v1/exchanges', () => {
  /* ★ `include=all` 을 붙인다. 기본 응답은 **연결 가능한 거래소만** 준다
       (어댑터 없는 거래소를 available 로 내보내면 사용자가 동작하지 않는 키를
       등록한다). 이 테스트가 검증하려는 것은 카탈로그 전체의 형태이므로
       전체를 요청한다. */
  it('[1] returns all catalogued exchanges with a schema-valid envelope', async () => {
    const res = await build().request('/api/v1/exchanges?include=all');
    expect(res.status).toBe(200);
    const body = await res.json();

    const parsed = ExchangeListResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`response violates schema: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.data.total).toBe(EXPECTED_IDS.length);
    expect(parsed.data.items.map((e) => e.id)).toEqual(EXPECTED_IDS);
    expect(parsed.data.asOf).toBe(FIXED_NOW);
    expect(parsed.data.source).toBe('static-catalogue');
  });

  it('[2] every item carries the referral link the UI renders', async () => {
    const res = await build().request('/api/v1/exchanges?include=all');
    const body = await asJson<ListBody>(res);
    expect(body.items).toHaveLength(EXPECTED_IDS.length);
    for (const item of body.items) {
      expect(item.referral).toMatch(/^https:\/\//u);
    }
    // Spot-check that the operator's own code survives serialization rather than being stripped.
    expect(body.items.find((e) => e.id === 'binance')?.referral).toContain('QUANTUM-KURI');
  });

  it('[3] ?status= filters', async () => {
    const app = build();

    const avail = await asJson<ListBody>(await app.request('/api/v1/exchanges?status=available&include=all'));
    expect(avail.items.map((e) => e.id)).toEqual([
      'kucoin',
      'binance',
      'bitget',
      'bitmart',
      'okx',
      'bybit',
      'gate',
    ]);

    /* ★ beta·coming-soon 거래소는 어댑터가 없으므로 기본 목록에서 빠진다.
         필터 자체가 동작하는지는 include=all 로 확인하고, 기본 목록에서
         비는 것도 함께 확인한다 — 둘 다 의도된 계약이다. */
    const beta = await asJson<ListBody>(await app.request('/api/v1/exchanges?status=beta&include=all'));
    expect(beta.items.map((e) => e.id)).toEqual(['kraken']);
    const betaDefault = await asJson<ListBody>(await app.request('/api/v1/exchanges?status=beta'));
    expect(betaDefault.items).toEqual([]);
    expect(betaDefault.hiddenNotConnectable).toBe(1);

    const soon = await asJson<ListBody>(await app.request('/api/v1/exchanges?status=coming-soon&include=all'));
    expect(soon.items.map((e) => e.id)).toEqual(['coinbase']);
  });

  it('[4] ?recommended= filters both ways', async () => {
    const app = build();

    const yes = await asJson<ListBody>(await app.request('/api/v1/exchanges?recommended=true&include=all'));
    expect(yes.items.map((e) => e.id)).toEqual(['kucoin', 'binance', 'bitget', 'okx', 'bybit']);

    const no = await asJson<ListBody>(await app.request('/api/v1/exchanges?recommended=false&include=all'));
    expect(no.total).toBe(4);

    /* ★ 추천이어도 연결할 수 없으면 기본 목록에 넣지 않는다 — 연결되지 않는
         거래소를 "추천" 으로 강조하면 사용자가 먼저 그것을 고른다. */
    const yesDefault = await asJson<ListBody>(await app.request('/api/v1/exchanges?recommended=true'));
    expect(yesDefault.items.map((e) => e.id)).toEqual(['kucoin']);
  });

  it('[5] an unknown query parameter is a 400, not a silently unfiltered list', async () => {
    const res = await build().request('/api/v1/exchanges?statuss=available');
    expect(res.status).toBe(400);
    const body = await asJson<ErrBody>(res);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.correlationId).toBeTruthy();
  });

  it('[6] an invalid enum value is a 400 and the rejected input is not echoed back', async () => {
    const res = await build().request('/api/v1/exchanges?status=' + encodeURIComponent('<script>'));
    expect(res.status).toBe(400);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('<script>');
  });

  it('[7] the response is publicly cacheable', async () => {
    const res = await build().request('/api/v1/exchanges');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });
});

describe('EXG-03 GET /api/v1/exchanges/:id', () => {
  it('[1] returns one schema-valid exchange', async () => {
    const res = await build().request('/api/v1/exchanges/bitmart');
    expect(res.status).toBe(200);
    const body = await res.json();
    /* 응답에는 런타임 사실인 `connectable` 이 더해진다 — 확장 스키마로 검증한다. */
    const parsed = ExchangeListItemSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`response violates schema: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.data.id).toBe('bitmart');
    expect(parsed.data.required).toContain('memo');
    expect(parsed.data.connectable).toBe(true);
  });

  it('[2] an unknown id is a 404 with a correlation id', async () => {
    const res = await build().request('/api/v1/exchanges/does-not-exist');
    expect(res.status).toBe(404);
    const body = await asJson<ErrBody>(res);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.correlationId).toBeTruthy();
  });
});

describe('EXG-04 findForbiddenGrants — server-side Withdraw refusal', () => {
  it('[1] flags a granted Withdraw scope', () => {
    expect(findForbiddenGrants('binance', ['Read', 'Trade', 'Withdraw'])).toEqual(['Withdraw']);
  });

  it('[2] accepts a Read + Trade key', () => {
    expect(findForbiddenGrants('binance', ['Read', 'Trade'])).toEqual([]);
  });

  it('[3] is case-insensitive — exchanges spell scopes inconsistently', () => {
    expect(findForbiddenGrants('okx', ['read', 'trade', 'withdraw'])).toEqual(['Withdraw']);
    expect(findForbiddenGrants('okx', ['READ', 'WITHDRAW'])).toEqual(['Withdraw']);
  });

  it('[4] returns nothing for an exchange with no forbidden scope', () => {
    expect(findForbiddenGrants('kraken', ['Read', 'Trade'])).toEqual([]);
  });

  it('[5] an unknown exchange yields no findings (caller handles existence separately)', () => {
    expect(findForbiddenGrants('nope', ['Withdraw'])).toEqual([]);
  });
});

/*
   연결 가능한 거래소만 기본 노출 — 실제로 겪은 문제를 고정한다.

   ★★ 카탈로그 9개가 모두 `status:'available'` 로 나가고 있었지만 어댑터는
     2개(KuCoin·BitMart)뿐이다. 사용자는 연결된다고 믿고 거래소에서 키를 만들어
     등록하고, 아무것도 조회되지 않는 이유를 알 수 없다.
*/
describe('exchange catalogue — connectable filtering', () => {
  const app = new Hono();
  app.route('/api', createExchangeRouter({ now: () => 1_700_000_000_000 }));
  const get = (path: string) => app.request(`http://local${path}`);

  it('[1] 기본 목록은 어댑터가 있는 거래소만 준다', async () => {
    const body = (await (await get('/api/v1/exchanges')).json()) as {
      items: { id: string; connectable: boolean }[];
    };
    expect(body.items.map((e) => e.id).sort()).toEqual([...CONNECTABLE_EXCHANGE_IDS].sort());
    expect(body.items.every((e) => e.connectable)).toBe(true);
  });

  it('[2] 감춘 개수를 밝힌다 — 목록이 짧은 이유를 화면이 설명할 수 있다', async () => {
    const body = (await (await get('/api/v1/exchanges')).json()) as {
      hiddenNotConnectable: number;
    };
    expect(body.hiddenNotConnectable).toBe(EXCHANGES.length - CONNECTABLE_EXCHANGE_IDS.length);
    expect(body.hiddenNotConnectable).toBeGreaterThan(0);
  });

  it('[3] include=all 은 전부 주고 각 항목에 연결 가능 여부를 붙인다', async () => {
    const body = (await (await get('/api/v1/exchanges?include=all')).json()) as {
      items: { id: string; connectable: boolean }[];
      hiddenNotConnectable: number;
    };
    expect(body.items).toHaveLength(EXCHANGES.length);
    expect(body.hiddenNotConnectable).toBe(0);
    for (const e of body.items) {
      expect(e.connectable).toBe(CONNECTABLE_EXCHANGE_IDS.includes(e.id));
    }
  });

  it('[4] 개별 조회도 연결 가능 여부를 밝힌다 — 404 로 감추지 않는다', async () => {
    /* "없는 거래소" 와 "아직 연결 못 하는 거래소" 는 다른 사실이다.
       404 로 감추면 운영자가 카탈로그에서 사라진 줄로 오해한다. */
    const res = await get('/api/v1/exchanges/binance');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; connectable: boolean };
    expect(body.id).toBe('binance');
    expect(body.connectable).toBe(false);

    const ok = (await (await get('/api/v1/exchanges/kucoin')).json()) as { connectable: boolean };
    expect(ok.connectable).toBe(true);
  });

  it('[5] 잘못된 include 값은 400 — 오타가 조용히 전체 노출로 떨어지면 안 된다', async () => {
    expect((await get('/api/v1/exchanges?include=every')).status).toBe(400);
  });

  it('[6] 연결 목록의 모든 id 가 카탈로그에 실제로 존재한다', () => {
    /* 오타('kukoin')가 있으면 조용히 0개가 노출되고 아무도 거래소를 연결할 수
       없다. 카탈로그 모듈이 기동 시 throw 하지만, 그 계약을 테스트로도 고정한다. */
    for (const id of CONNECTABLE_EXCHANGE_IDS) {
      expect(EXCHANGES.some((e) => e.id === id)).toBe(true);
    }
  });
});
