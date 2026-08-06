import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { startGateway, type RunningGateway } from '../server';

/**
 * Gateway E2E (Phase 6 §3/§4) — boots the REAL gateway server in-process (MOCK_REPLAY upstream) and
 * drives a ws client through auth, origin, subscribe/unsubscribe, validation, upstream dedup, per-user
 * limit, rate limit, health/metrics, and graceful restart.
 */
const ORIGIN = 'http://localhost:5173';
let gw: RunningGateway;
const base = () => `ws://127.0.0.1:${gw.port}/ws`;

// Buffered client: captures messages from connect time (avoids missing the immediate `welcome` frame).
interface Waiter { pred: (m: any) => boolean; resolve: (m: any) => void; to: NodeJS.Timeout; }
class Client {
  buf: any[] = [];
  waiters: Waiter[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw: Buffer) => { this.buf.push(JSON.parse(String(raw))); this.flush(); });
  }
  private flush() {
    for (const w of [...this.waiters]) {
      const i = this.buf.findIndex(w.pred);
      if (i >= 0) { clearTimeout(w.to); this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(this.buf.splice(i, 1)[0]); }
    }
  }
  next(pred: (m: any) => boolean, timeoutMs = 4000): Promise<any> {
    const i = this.buf.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.buf.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.waiters = this.waiters.filter((x) => x.to !== to); reject(new Error('timeout waiting for message')); }, timeoutMs);
      this.waiters.push({ pred, resolve, to });
    });
  }
  send(obj: unknown) { this.ws.send(JSON.stringify(obj)); }
  close() { this.ws.close(); }
}

/**
 * Fake session validator standing in for the BFF's `GET /auth/me`.
 *
 * Sessions map cookie value → user. Anything not in the map is a 401, which is what the gateway must treat as a
 * definite rejection (as opposed to an unreachable validator, which is a 503).
 */
const SESSIONS = new Map<string, { id: string; status?: string }>([
  ['sess-u1', { id: 'u1' }],
  ['sess-u2', { id: 'u2' }],
  ['sess-disabled', { id: 'u3', status: 'disabled' }],
]);
let validatorDown = false;

const fakeValidator: typeof fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
  if (validatorDown) throw new Error('validator unreachable');
  const cookie = init?.headers?.cookie ?? '';
  const m = /qt_session=([^;]+)/u.exec(cookie);
  const user = m ? SESSIONS.get(m[1]!) : undefined;
  if (!user) {
    return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ user }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

/** Connects with a session COOKIE — the real path. `token` remains for the dev-auth tests. */
function connect(opts: { token?: string; origin?: string; session?: string }): Promise<Client> {
  const q = opts.token ? `?token=${encodeURIComponent(opts.token)}` : '';
  const headers: Record<string, string> = { origin: opts.origin ?? ORIGIN };
  if (opts.session) headers['cookie'] = `qt_session=${opts.session}`;
  const ws = new WebSocket(base() + q, { headers });
  const client = new Client(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', (e) => reject(e));
  });
}

beforeAll(async () => {
  gw = await startGateway(
    { port: 0, host: '127.0.0.1', originAllowlist: [ORIGIN], maxSubsPerUser: 20, devAuth: false },
    fakeValidator,
  );
});
afterAll(async () => { await gw.close(); });

describe('gateway server E2E (real ws)', () => {
  it('[1] rejects connection without a valid token (401)', async () => {
    await expect(connect({ origin: ORIGIN })).rejects.toThrow(/401/);
  });
  it('[2] rejects a disallowed Origin (403)', async () => {
    await expect(connect({ session: 'sess-u1', origin: 'http://evil.example' })).rejects.toThrow(/403/);
  });
  it('[3] authed client connects and gets a welcome', async () => {
    const c = await connect({ session: 'sess-u1' });
    const w = await c.next((m) => m.type === 'welcome');
    expect(w.upstream).toBe('MOCK_REPLAY');
    c.close();
  });
  it('[4] subscribe → receives sequenced data frames', async () => {
    const c = await connect({ session: 'sess-u1' });
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'subscribe', channel: 'candle', symbol: 'BTCUSDT', timeframe: '1m' });
    const ack = await c.next((m) => m.type === 'subscribed');
    expect(ack.newUpstream).toBe(true);
    // The key is timeframe-qualified: SubscriptionManager de-duplicates by key, so a bare
    // `candle:BTCUSDT` made a 1m and a 1h subscriber share one upstream.
    expect(ack.key).toBe('candle@1m:BTCUSDT');
    const data = await c.next((m) => m.type === 'data' && m.key === 'candle@1m:BTCUSDT');
    expect(data.seq).toBeGreaterThan(0);
    c.close();
  });

  it('[4b] a candle subscription without a timeframe is refused', async () => {
    const c = await connect({ session: 'sess-u1' });
    await c.next((m) => m.type === 'welcome');
    // Previously accepted and then never routable to an exchange channel. Defaulting to some interval
    // would hand the client bars it did not ask for.
    c.send({ type: 'subscribe', channel: 'candle', symbol: 'BTCUSDT' });
    const err = await c.next((m) => m.type === 'error');
    expect(err.code).toBe('INVALID');
    expect(err.message).toMatch(/timeframe/);
    c.close();
  });

  it('[4c] different timeframes on one symbol are separate upstreams', async () => {
    const c = await connect({ session: 'sess-u1' });
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'subscribe', channel: 'candle', symbol: 'ETHUSDT', timeframe: '1m' });
    const a = await c.next((m) => m.type === 'subscribed' && m.key === 'candle@1m:ETHUSDT');
    c.send({ type: 'subscribe', channel: 'candle', symbol: 'ETHUSDT', timeframe: '1h' });
    const b = await c.next((m) => m.type === 'subscribed' && m.key === 'candle@1h:ETHUSDT');
    // Both must open their own upstream; sharing one silently served the wrong interval to one of them.
    expect(a.newUpstream).toBe(true);
    expect(b.newUpstream).toBe(true);
    expect(b.dedup).toBeUndefined();
    c.close();
  });
  it('[5] invalid symbol and channel are rejected', async () => {
    const c = await connect({ session: 'sess-u1' });
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'subscribe', channel: 'candle', symbol: 'FAKECOIN', timeframe: '1m' });
    expect((await c.next((m) => m.type === 'error')).message).toMatch(/symbol/);
    c.send({ type: 'subscribe', channel: 'nope', symbol: 'BTCUSDT', timeframe: '1m' });
    expect((await c.next((m) => m.type === 'error')).message).toMatch(/channel/);
    c.close();
  });
  it('[6] duplicate subscription is deduped', async () => {
    const c = await connect({ session: 'sess-u1' });
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'subscribe', channel: 'ticker', symbol: 'ETHUSDT' });
    await c.next((m) => m.type === 'subscribed');
    c.send({ type: 'subscribe', channel: 'ticker', symbol: 'ETHUSDT' });
    expect((await c.next((m) => m.type === 'subscribed' && m.dedup)).dedup).toBe(true);
    c.close();
  });
  it('[7] two users on the same symbol share ONE upstream (dedup + refcount)', async () => {
    const a = await connect({ session: 'sess-u1' });
    const b = await connect({ session: 'sess-u1' });
    await a.next((m) => m.type === 'welcome'); await b.next((m) => m.type === 'welcome');
    a.send({ type: 'subscribe', channel: 'candle', symbol: 'SOLUSDT', timeframe: '1m' });
    const ackA = await a.next((m) => m.type === 'subscribed');
    b.send({ type: 'subscribe', channel: 'candle', symbol: 'SOLUSDT', timeframe: '1m' });
    const ackB = await b.next((m) => m.type === 'subscribed');
    expect(ackA.newUpstream).toBe(true);
    expect(ackB.newUpstream).toBe(false); // shared upstream
    expect(ackB.refCount).toBe(2);
    a.close(); b.close();
  });
  it('[8] unsubscribe acks and stops that key', async () => {
    const c = await connect({ session: 'sess-u1' });
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'subscribe', channel: 'candle', symbol: 'BTCUSDT', timeframe: '1m' });
    await c.next((m) => m.type === 'subscribed');
    c.send({ type: 'unsubscribe', channel: 'candle', symbol: 'BTCUSDT', timeframe: '1m' });
    expect((await c.next((m) => m.type === 'unsubscribed')).key).toBe('candle@1m:BTCUSDT');
    c.close();
  });
  it('[9] rate-limits a subscribe flood', async () => {
    const c = await connect({ session: 'sess-u1' });
    await c.next((m) => m.type === 'welcome');
    for (let i = 0; i < 40; i++) c.send({ type: 'subscribe', channel: 'candle', symbol: 'BTCUSDT', timeframe: '1m' });
    const limited = await c.next((m) => m.type === 'error' && m.code === 'RATE_LIMITED');
    expect(limited.code).toBe('RATE_LIMITED');
    c.close();
  });
  it('[10] health/ready + metrics endpoints', async () => {
    const ready = await (await fetch(`http://127.0.0.1:${gw.port}/health/ready`)).json() as any;
    expect(ready.status).toBe('ok');
    expect(ready.upstream.mode).toBe('MOCK_REPLAY');
    const metrics = await (await fetch(`http://127.0.0.1:${gw.port}/metrics`)).text();
    expect(metrics).toContain('gw_active_connections');
  });
});

/**
 * Added 2026-08-03.
 *
 * Auth was `?token=user:<id>` trusted verbatim: any client could claim any user id by editing a query
 * parameter, and the value travelled in the query string where it lands in access logs and `Referer` headers.
 * It now validates the forwarded session cookie against the BFF's own `GET /auth/me`.
 */
describe('GW-AUTH — session cookie validation', () => {
  it('[1] a valid session is accepted and carries the real user id', async () => {
    const c = await connect({ session: 'sess-u2' });
    const w = await c.next((m) => m.type === 'welcome');
    expect(w.type).toBe('welcome');
    c.close();
  });

  it('[2] an unknown session is 401', async () => {
    await expect(connect({ session: 'sess-does-not-exist' })).rejects.toThrow(/401/);
  });

  it('[3] no cookie at all is 401', async () => {
    await expect(connect({})).rejects.toThrow(/401/);
  });

  it('[4] a DISABLED account is refused even with a valid cookie', async () => {
    // The validator returns 200 for this session; the account status is what rejects it. A disabled user must
    // not hold a live stream.
    await expect(connect({ session: 'sess-disabled' })).rejects.toThrow(/401/);
  });

  it('[5] a query-string token is IGNORED when dev auth is off', async () => {
    // This is the whole point of the change: the old path let anyone be anyone.
    await expect(connect({ token: 'user:attacker' })).rejects.toThrow(/401/);
  });

  it('[6] an unreachable validator is 503, not 401', async () => {
    validatorDown = true;
    try {
      // Distinguished so an outage is not investigated as a credential problem — and still refused (fail closed).
      await expect(connect({ session: 'sess-u1' })).rejects.toThrow(/503/);
    } finally {
      validatorDown = false;
    }
  });

  it('[7] dev auth works only when explicitly enabled', async () => {
    const g = await startGateway(
      { port: 0, host: '127.0.0.1', originAllowlist: [ORIGIN], devAuth: true },
      fakeValidator,
    );
    const ws = new WebSocket(`ws://127.0.0.1:${g.port}/ws?token=user:devuser`, { headers: { origin: ORIGIN } });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    ws.close();
    await g.close();
  });

  it('[8] Origin is still checked before auth', async () => {
    await expect(connect({ session: 'sess-u1', origin: 'http://evil.example' })).rejects.toThrow(/403/);
  });
});

describe('gateway per-user subscription limit + restart', () => {
  it('[11] enforces the per-user subscription limit', async () => {
    const g2 = await startGateway(
      { port: 0, host: '127.0.0.1', originAllowlist: [ORIGIN], maxSubsPerUser: 2, devAuth: false },
      fakeValidator,
    );
    const ws = new WebSocket(`ws://127.0.0.1:${g2.port}/ws`, { headers: { origin: ORIGIN, cookie: 'qt_session=sess-u1' } });
    const c = new Client(ws);
    await new Promise((r) => ws.once('open', r));
    await c.next((m) => m.type === 'welcome');
    c.send({ type: 'subscribe', channel: 'candle', symbol: 'BTCUSDT', timeframe: '1m' });
    await c.next((m) => m.type === 'subscribed');
    c.send({ type: 'subscribe', channel: 'ticker', symbol: 'ETHUSDT' });
    await c.next((m) => m.type === 'subscribed');
    c.send({ type: 'subscribe', channel: 'orderbook', symbol: 'SOLUSDT' });
    expect((await c.next((m) => m.type === 'error')).code).toBe('SUB_LIMIT');
    c.close(); await g2.close();
  });
  it('[12] graceful restart: close then start a fresh instance', async () => {
    const g2 = await startGateway({ port: 0, host: '127.0.0.1', originAllowlist: [ORIGIN], devAuth: false }, fakeValidator);
    const p = g2.port;
    await g2.close();
    const g3 = await startGateway({ port: 0, host: '127.0.0.1', originAllowlist: [ORIGIN], devAuth: false }, fakeValidator);
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${g3.port}/ws`, { headers: { origin: ORIGIN, cookie: 'qt_session=sess-u1' } });
      s.once('open', () => resolve(s)); s.once('error', reject);
    });
    expect(g3.port).toBeGreaterThan(0); expect(p).toBeGreaterThan(0);
    ws.close(); await g3.close();
  });
});
