import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ExchangeListResponseSchema, ExchangeSchema } from '@quantumtrade/schemas';
import { createExchangeRouter } from '../exchanges/exchange-routes';
import {
  EXCHANGES,
  findForbiddenGrants,
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
type ListBody = { items: { id: string; referral: string }[]; total: number };
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
      expect(e.referralNote.length).toBeGreaterThan(0);
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
  it('[1] returns all catalogued exchanges with a schema-valid envelope', async () => {
    const res = await build().request('/api/v1/exchanges');
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
    const res = await build().request('/api/v1/exchanges');
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

    const avail = await asJson<ListBody>(await app.request('/api/v1/exchanges?status=available'));
    expect(avail.items.map((e) => e.id)).toEqual([
      'kucoin',
      'binance',
      'bitget',
      'bitmart',
      'okx',
      'bybit',
      'gate',
    ]);

    const beta = await asJson<ListBody>(await app.request('/api/v1/exchanges?status=beta'));
    expect(beta.items.map((e) => e.id)).toEqual(['kraken']);

    const soon = await asJson<ListBody>(await app.request('/api/v1/exchanges?status=coming-soon'));
    expect(soon.items.map((e) => e.id)).toEqual(['coinbase']);
  });

  it('[4] ?recommended= filters both ways', async () => {
    const app = build();

    const yes = await asJson<ListBody>(await app.request('/api/v1/exchanges?recommended=true'));
    expect(yes.items.map((e) => e.id)).toEqual(['kucoin', 'binance', 'bitget', 'okx', 'bybit']);

    const no = await asJson<ListBody>(await app.request('/api/v1/exchanges?recommended=false'));
    expect(no.total).toBe(4);
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
    const parsed = ExchangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`response violates schema: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.data.id).toBe('bitmart');
    expect(parsed.data.required).toContain('memo');
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
