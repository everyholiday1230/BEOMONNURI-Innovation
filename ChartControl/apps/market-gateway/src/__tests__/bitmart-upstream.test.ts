import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import { BitMartPublicUpstream, MockReplayUpstream, type UpstreamMessage } from '../upstream';
import { buildStreamKey, parseStreamKey, symbolOf } from '../stream-key';
import { loadGatewayConfig } from '../config';

/**
 * Stream keys and the rewritten BitMart upstream.
 *
 * The old implementation could not have worked — it sent `{op:...}` instead of `{action:...}` and
 * subscribed to `spot/ticker` on a futures venue — and could not report that it wasn't working, because it
 * discarded acks and kept `connected: true`. These tests drive the upstream against a local WebSocket
 * server that speaks the BitMart frame format captured from the live endpoint, so the wire bytes are
 * asserted rather than assumed.
 */

describe('SK-01 stream keys carry the timeframe for candles', () => {
  it('[1] candles are qualified, other channels are not', () => {
    expect(buildStreamKey('candle', 'BTCUSDT', '1m')).toBe('candle@1m:BTCUSDT');
    expect(buildStreamKey('candle', 'BTCUSDT', '1h')).toBe('candle@1h:BTCUSDT');
    expect(buildStreamKey('ticker', 'BTCUSDT')).toBe('ticker:BTCUSDT');
    expect(buildStreamKey('orderbook', 'BTCUSDT')).toBe('orderbook:BTCUSDT');
  });

  it('[2] 1m and 1h produce DIFFERENT keys', () => {
    // This is the whole point: SubscriptionManager de-duplicates by key.
    expect(buildStreamKey('candle', 'BTCUSDT', '1m')).not.toBe(buildStreamKey('candle', 'BTCUSDT', '1h'));
  });

  it('[3] round-trips', () => {
    expect(parseStreamKey('candle@15m:BTCUSDT')).toEqual({ channel: 'candle', symbol: 'BTCUSDT', timeframe: '15m' });
    expect(parseStreamKey('ticker:ETHUSDT')).toEqual({ channel: 'ticker', symbol: 'ETHUSDT' });
  });

  it('[4] the symbol stays last so split(":")[1] still works for existing callers', () => {
    expect('candle@1m:BTCUSDT'.split(':')[1]).toBe('BTCUSDT');
    expect(symbolOf('candle@1m:BTCUSDT')).toBe('BTCUSDT');
    expect(symbolOf('ticker:ETHUSDT')).toBe('ETHUSDT');
  });

  it('[5] malformed keys are null, not a guess', () => {
    for (const k of ['', ':', 'candle', 'candle@:BTC', 'nope:BTCUSDT', ':BTCUSDT', 'candle@1m:']) {
      expect(parseStreamKey(k), k).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// A local stand-in for the BitMart WS endpoint, speaking the frame format captured live.
// ---------------------------------------------------------------------------------------------------

interface FakeVenue {
  url: string;
  /** Frames received from the client, parsed. */
  received: unknown[];
  /** Topics the venue will reject, with a reason. */
  reject: Set<string>;
  pushKline: (topic: string, o: string, c: string, ts: number) => void;
  pushTicker: (symbol: string, last: string, range: string) => void;
  pushRaw: (payload: string) => void;
  /** Force-close every connected socket, to exercise reconnection. */
  dropAll: () => void;
  connections: number;
  close: () => Promise<void>;
}

async function startFakeVenue(): Promise<FakeVenue> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  const sockets = new Set<WsSocket>();
  const state: FakeVenue = {
    url: '',
    received: [],
    reject: new Set(),
    connections: 0,
    pushKline: (topic, o, c, ts) => {
      const payload = JSON.stringify({
        group: topic,
        data: { symbol: topic.split(':')[1], items: [{ o, h: o, l: c, c, v: '1', ts }] },
      });
      for (const s of sockets) s.send(payload);
    },
    pushTicker: (symbol, last, range) => {
      const payload = JSON.stringify({
        group: `futures/ticker:${symbol}`,
        data: { symbol, last_price: last, range, mark_price: last, index_price: last, volume_24: '1', bid_price: last, ask_price: last },
      });
      for (const s of sockets) s.send(payload);
    },
    pushRaw: (payload) => { for (const s of sockets) s.send(payload); },
    dropAll: () => { for (const s of sockets) s.terminate(); },
    close: async () => {
      for (const s of sockets) { try { s.close(); } catch { /* ignore */ } }
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
    },
  };

  wss.on('connection', (ws) => {
    sockets.add(ws);
    state.connections += 1;
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (raw) => {
      let m: { action?: string; args?: string[] };
      try { m = JSON.parse(String(raw)); } catch { return; }
      state.received.push(m);
      if (m.action === 'ping') {
        // The real server's reply — NOT the bare "pong" the docs promise.
        ws.send(JSON.stringify({ group: 'System', data: 'pong+' + '0'.repeat(8) }));
        return;
      }
      if (m.action === 'subscribe' || m.action === 'unsubscribe') {
        for (const topic of m.args ?? []) {
          const bad = state.reject.has(topic);
          ws.send(JSON.stringify({
            action: m.action,
            group: topic,
            success: !bad,
            ...(bad ? { error: `Invalid channel: not found ${topic}` } : {}),
          }));
        }
      }
    });
  });

  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
  const addr = http.address();
  state.url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return state;
}

function cfgFor(url: string, restBase = 'http://127.0.0.1:1') {
  return { ...loadGatewayConfig({}), upstream: 'BITMART_PUBLIC' as const, bitmartWsUrl: url, bitmartRestBase: restBase };
}

const waitFor = async (pred: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
};

let venue: FakeVenue;
let up: BitMartPublicUpstream | null = null;

beforeEach(async () => { venue = await startFakeVenue(); });
afterEach(async () => {
  if (up) { await up.stop(); up = null; }
  await venue.close();
  vi.restoreAllMocks();
});

describe('BMU-01 subscription frames are what the venue accepts', () => {
  it('[1] uses `action`, never `op`', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('candle@1m:BTCUSDT');
    await waitFor(() => venue.received.length > 0);
    const first = venue.received[0] as { action?: string; op?: string; args?: string[] };
    // The old code sent {op:'subscribe'}; the venue ignores it and nothing ever arrives.
    expect(first.action).toBe('subscribe');
    expect(first.op).toBeUndefined();
  });

  it('[2] candles map to futures/klineBin with the venue casing', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('candle@1h:BTCUSDT');
    await waitFor(() => venue.received.length > 0);
    const args = (venue.received[0] as { args: string[] }).args;
    // 1h → 1H. Verified live: lowercase `klineBin1h` is rejected.
    expect(args).toEqual(['futures/klineBin1H:BTCUSDT']);
  });

  it('[3] ticker/trades/orderbook use futures channels, never spot', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BTCUSDT');
    up.open('trades:BTCUSDT');
    up.open('orderbook:BTCUSDT');
    // Subscriptions registered before the socket opens are sent as ONE batched frame, so wait on the
    // topics rather than the frame count.
    await waitFor(() => venue.received.flatMap((r) => (r as { args?: string[] }).args ?? []).length >= 3);
    const all = venue.received.flatMap((r) => (r as { args?: string[] }).args ?? []);
    expect(all).toContain('futures/ticker:BTCUSDT');
    expect(all).toContain('futures/trade:BTCUSDT');
    expect(all).toContain('futures/depth20:BTCUSDT@200ms');
    // The old implementation sent this on a futures venue and it was rejected every time.
    expect(all.some((t) => t.startsWith('spot/'))).toBe(false);
  });

  it('[4] unsubscribe is sent when the last consumer leaves', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BTCUSDT');
    await waitFor(() => venue.received.length > 0);
    up.close('ticker:BTCUSDT');
    await waitFor(() => venue.received.some((r) => (r as { action?: string }).action === 'unsubscribe'));
  });
});

describe('BMU-02 rejections and unsupported streams are reported, not swallowed', () => {
  it('[1] a rejected topic appears in diagnostics', async () => {
    venue.reject.add('futures/ticker:BADSYM');
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BADSYM');
    await waitFor(() => up!.diagnostics().rejected.length > 0);
    const r = up.diagnostics().rejected[0]!;
    expect(r.topic).toBe('futures/ticker:BADSYM');
    expect(r.error).toContain('Invalid channel');
  });

  it('[2] an open socket whose every topic was rejected is NOT reported connected', async () => {
    venue.reject.add('futures/ticker:BADSYM');
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BADSYM');
    await waitFor(() => up!.diagnostics().rejected.length > 0);
    // The old code returned connected:true here — the exact reason the spot/futures bug went unnoticed.
    expect(up.status().connected).toBe(false);
  });

  it('[3] an accepted topic does report connected', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    expect(up.status().connected).toBe(true);
  });

  it('[4] a 3m candle is recorded as unsupported and never subscribed', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('candle@3m:BTCUSDT');
    await waitFor(() => up!.diagnostics().unsupported.length > 0);
    const u = up.diagnostics().unsupported[0]!;
    expect(u.key).toBe('candle@3m:BTCUSDT');
    // BitMart has no klineBin3m (verified live), so the reason must say so rather than substituting 1m.
    expect(u.reason).toMatch(/no kline channel for 3m/u);
    expect(venue.received).toHaveLength(0);
    // Exposed so the gateway can warn the client instead of acking a stream that never delivers.
    expect(up.unsupportedReason('candle@3m:BTCUSDT')).toMatch(/3m/u);
    expect(up.unsupportedReason('candle@1m:BTCUSDT')).toBeNull();
  });

  it('[5] an unparseable key is recorded, not thrown', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    expect(() => up!.open('garbage')).not.toThrow();
    expect(up.diagnostics().unsupported[0]!.reason).toMatch(/unparseable/u);
  });
});

describe('BMU-03 inbound frames are typed and routed correctly', () => {
  it('[1] a kline frame is emitted as type candle, not ticker', async () => {
    const got: UpstreamMessage[] = [];
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.onMessage((m) => got.push(m));
    up.open('candle@1m:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    venue.pushKline('futures/klineBin1m:BTCUSDT', '63090.9', '63075.2', 1785727320);

    await waitFor(() => got.length > 0);
    // The old code labelled every frame 'ticker', so candles could never reach the candle cache.
    expect(got[0]!.type).toBe('candle');
    expect(got[0]!.key).toBe('candle@1m:BTCUSDT');
    expect(got[0]!.data).toMatchObject({ time: 1785727320000, open: '63090.9', close: '63075.2', closed: false });
  });

  it('[2] the key is recovered from the topic, so the symbol is never empty', async () => {
    const got: UpstreamMessage[] = [];
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.onMessage((m) => got.push(m));
    up.open('ticker:ETHUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    venue.pushTicker('ETHUSDT', '1862.5', '0.004');

    await waitFor(() => got.length > 0);
    // The old code read data[0].symbol on an object payload, producing the key `ticker:`.
    expect(got[0]!.key).toBe('ticker:ETHUSDT');
    expect(got[0]!.type).toBe('ticker');
    // `range` is a ratio: 0.004 → 0.4%.
    expect(got[0]!.data).toMatchObject({ symbol: 'ETHUSDT', last: '1862.5', changePct: 0.4 });
  });

  it('[3] two timeframes on one symbol stay separated', async () => {
    const got: UpstreamMessage[] = [];
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.onMessage((m) => got.push(m));
    up.open('candle@1m:BTCUSDT');
    up.open('candle@1h:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length >= 2);

    venue.pushKline('futures/klineBin1m:BTCUSDT', '1', '2', 1785727320);
    venue.pushKline('futures/klineBin1H:BTCUSDT', '10', '20', 1785726000);
    await waitFor(() => got.length >= 2);

    const byKey = new Map(got.map((m) => [m.key, m.data as { open: string }]));
    expect(byKey.get('candle@1m:BTCUSDT')!.open).toBe('1');
    expect(byKey.get('candle@1h:BTCUSDT')!.open).toBe('10');
  });

  it('[4] sequence numbers are per-key and monotonic', async () => {
    const got: UpstreamMessage[] = [];
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.onMessage((m) => got.push(m));
    up.open('candle@1m:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    venue.pushKline('futures/klineBin1m:BTCUSDT', '1', '2', 1);
    venue.pushKline('futures/klineBin1m:BTCUSDT', '2', '3', 2);
    await waitFor(() => got.length >= 2);
    expect(got[0]!.seq).toBe(1);
    expect(got[1]!.seq).toBe(2);
  });

  it('[5] frames for topics we did not subscribe to are ignored', async () => {
    const got: UpstreamMessage[] = [];
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.onMessage((m) => got.push(m));
    up.open('ticker:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    venue.pushTicker('SOMETHINGELSE', '1', '0');
    await new Promise((r) => setTimeout(r, 120));
    expect(got).toHaveLength(0);
  });

  it('[6] unrecognised frames are counted, not fatal', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    venue.pushRaw('this is not json');
    venue.pushRaw('{"group":"futures/unknownchannel:BTCUSDT","data":{}}');
    await waitFor(() => up!.diagnostics().unknownFrames >= 2);
    expect(up.status().connected).toBe(true);
  });

  it('[7] depth arrives side-tagged and marked partial', async () => {
    const got: UpstreamMessage[] = [];
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.onMessage((m) => got.push(m));
    up.open('orderbook:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    venue.pushRaw(JSON.stringify({
      group: 'futures/depth20:BTCUSDT@200ms',
      data: { symbol: 'BTCUSDT', way: 2, depths: [{ price: '63065.8', vol: '1' }], ms_t: 1785728207021 },
    }));
    await waitFor(() => got.length > 0);
    // BitMart pushes ONE side per message; a consumer must not treat this as a full book.
    expect(got[0]!.data).toMatchObject({ side: 'ask', partial: true });
  });
});

describe('BMU-04 keepalive and reconnection', () => {
  it('[1] pings and accepts the real System pong without tearing down', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    // The interval is 8s, so drive one ping directly rather than waiting.
    venue.received.length = 0;
    up['send'](JSON.stringify({ action: 'ping' }));
    await waitFor(() => venue.received.some((r) => (r as { action?: string }).action === 'ping'));
    await new Promise((r) => setTimeout(r, 100));
    // A client that expected the documented bare "pong" would treat this as a dead link.
    expect(up.status().connected).toBe(true);
    expect(up.diagnostics().unknownFrames).toBe(0);
  });

  it('[2] reconnects after the venue drops the socket and re-subscribes', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    expect(venue.connections).toBe(1);

    venue.dropAll();
    // The old implementation set connected=false and stopped there, permanently.
    await waitFor(() => venue.connections >= 2, 6000);
    await waitFor(() => up!.diagnostics().reconnects >= 1);
    // Topics must be re-sent on the new socket, or the stream is dead despite being connected.
    await waitFor(() => up!.diagnostics().acked.includes('futures/ticker:BTCUSDT'), 6000);
  });

  it('[3] stop() prevents further reconnects', async () => {
    up = new BitMartPublicUpstream(cfgFor(venue.url));
    up.open('ticker:BTCUSDT');
    await waitFor(() => up!.diagnostics().acked.length > 0);
    await up.stop();
    const before = venue.connections;
    venue.dropAll();
    await new Promise((r) => setTimeout(r, 800));
    expect(venue.connections).toBe(before);
    up = null;
  });
});

describe('BMU-05 REST history and gap-fill', () => {
  const restBody = {
    code: 1000,
    data: [
      { timestamp: 1785727260, open_price: '63000', close_price: '63050', high_price: '63100', low_price: '62950', volume: '10' },
      { timestamp: 1785727320, open_price: '63050', close_price: '63075', high_price: '63080', low_price: '63040', volume: '12' },
    ],
  };

  it('[1] fetchCandles requests minute steps and second bounds', async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (u: Parameters<typeof fetch>[0]) => {
      calls.push(String(u));
      return new Response(JSON.stringify(restBody), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    up = new BitMartPublicUpstream(cfgFor(venue.url, 'https://api-cloud-v2.bitmart.com'), fake as unknown as typeof fetch);
    const c = await up.fetchCandles('BTCUSDT', '1h', 10);

    expect(calls[0]).toContain('/contract/public/kline?');
    expect(calls[0]).toContain('step=60');
    expect(calls[0]).toContain('symbol=BTCUSDT');
    expect(c).toHaveLength(2);
    // REST bars are complete, unlike streamed ones.
    expect(c[0]).toMatchObject({ time: 1785727260000, open: '63000', close: '63050', closed: true });
  });

  it('[2] a failing REST call yields no candles instead of throwing', async () => {
    const fake = vi.fn(async () => new Response('nope', { status: 500 }));
    up = new BitMartPublicUpstream(cfgFor(venue.url), fake as unknown as typeof fetch);
    await expect(up.fetchCandles('BTCUSDT', '1m')).resolves.toEqual([]);

    const boom = vi.fn(async () => { throw new Error('network down'); });
    const up2 = new BitMartPublicUpstream(cfgFor(venue.url), boom as unknown as typeof fetch);
    await expect(up2.fetchCandles('BTCUSDT', '1m')).resolves.toEqual([]);
    await up2.stop();
  });

  it('[3] gap-fill returns candles for a candle key', async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify(restBody), { status: 200, headers: { 'content-type': 'application/json' } }));
    up = new BitMartPublicUpstream(cfgFor(venue.url), fake as unknown as typeof fetch);
    const filled = await up.restGapFill('candle@1m:BTCUSDT', 5, 7);
    expect(filled).toHaveLength(2);
    expect(filled[0]!.type).toBe('candle');
    expect(filled[0]!.key).toBe('candle@1m:BTCUSDT');
    // Sequences continue past the reported gap end rather than colliding with delivered frames.
    expect(filled[0]!.seq).toBe(8);
    expect(filled[1]!.seq).toBe(9);
  });

  it('[4] non-candle keys have no replay endpoint and return empty', async () => {
    const fake = vi.fn(async () => new Response('{}', { status: 200 }));
    up = new BitMartPublicUpstream(cfgFor(venue.url), fake as unknown as typeof fetch);
    await expect(up.restGapFill('ticker:BTCUSDT', 1, 2)).resolves.toEqual([]);
    await expect(up.restGapFill('orderbook:BTCUSDT', 1, 2)).resolves.toEqual([]);
    // No request should have been made for a channel that cannot be replayed.
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('BMU-06 the mock upstream still handles qualified keys', () => {
  it('[1] candle@1m emits candles', async () => {
    const got: UpstreamMessage[] = [];
    const m = new MockReplayUpstream(10);
    m.onMessage((x) => got.push(x));
    m.open('candle@1m:BTCUSDT');
    await waitFor(() => got.length > 0);
    // `key.split(':')[0]` would be `candle@1m`, which is not the channel — the base channel drives shape.
    expect(got[0]!.type).toBe('candle');
    await m.stop();
  });

  it('[2] orderbook still emits a snapshot first', async () => {
    const got: UpstreamMessage[] = [];
    const m = new MockReplayUpstream(10);
    m.onMessage((x) => got.push(x));
    m.open('orderbook:BTCUSDT');
    await waitFor(() => got.length > 0);
    expect(got[0]!.type).toBe('orderbook_snapshot');
    await m.stop();
  });
});
