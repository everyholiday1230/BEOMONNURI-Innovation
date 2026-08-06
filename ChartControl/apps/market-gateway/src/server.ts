import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  SubscriptionManager, SequenceTracker, CandleCache, OrderBook, BoundedQueue, PerUserRateLimiter,
  CircuitBreaker, type UpstreamController,
} from '@quantumtrade/market-gateway';
import { MetricsRegistry, StructuredLogger } from '@quantumtrade/observability';
import { corsOriginAllowed } from '@quantumtrade/security';
import { RedisPubSub, type PubSub } from '@quantumtrade/cluster';
import { loadGatewayConfig, CHANNELS, type GatewayConfig, type Channel } from './config';
import { createUpstream, BitMartPublicUpstream, type Upstream, type UpstreamMessage } from './upstream';
import { buildStreamKey, parseStreamKey } from './stream-key';

interface Client { id: string; userId: string; ws: WebSocket; subs: Set<string>; queue: BoundedQueue<string>; corr: string; }

export interface RunningGateway { close: () => Promise<void>; port: number; metrics: MetricsRegistry; }

/** Central Market Data Gateway server (Phase 6 §3). Browsers connect here (never to BitMart directly). */
export function startGateway(
  cfgOverride: Partial<GatewayConfig> = {},
  /** Injected so tests can drive session validation without a live BFF. */
  fetchImpl: typeof fetch = fetch,
): Promise<RunningGateway> {
  const cfg = { ...loadGatewayConfig(), ...cfgOverride };
  const instanceId = randomUUID().slice(0, 8);
  const log = new StructuredLogger({ service: 'market-gateway', environment: process.env.NODE_ENV ?? 'dev', version: cfg.gitSha, gitSha: cfg.gitSha });
  const metrics = new MetricsRegistry();
  const mConns = metrics.gauge('gw_active_connections');
  const mMsgs = metrics.counter('gw_messages_out');
  const mDropped = metrics.counter('gw_dropped_messages');
  const mUpstream = metrics.gauge('gw_upstream_connections');
  const mGaps = metrics.counter('gw_gaps_detected');
  const latency = metrics.histogram('gw_fanout_ms');
  const mAuthRejected = metrics.counter('gw_auth_rejected');
  const mAuthUnavailable = metrics.counter('gw_auth_validator_unavailable');

  const upstream: Upstream = createUpstream(cfg);
  const breaker = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 5000 });
  const rateLimiter = new PerUserRateLimiter(30, 5); // 30 subscribe ops burst, refill 5/s
  const keyClients = new Map<string, Set<string>>(); // key -> clientIds (fan-out)
  const clients = new Map<string, Client>();
  const userSubCount = new Map<string, number>();
  const seqTrackers = new Map<string, SequenceTracker>();
  const candleCache = new CandleCache();
  const books = new Map<string, OrderBook>();
  let pubsub: PubSub | null = null;

  // Upstream controller: SubscriptionManager opens ONE upstream per key regardless of client count.
  const controller: UpstreamController = {
    open: (key) => { void Promise.resolve(upstream.open(key)); mUpstream.set(upstream.status().upstreamConnections); },
    close: (key) => { void Promise.resolve(upstream.close(key)); seqTrackers.delete(key); books.delete(key); mUpstream.set(upstream.status().upstreamConnections); },
  };
  const subs = new SubscriptionManager(controller);

  function deliver(key: string, framePayload: string): void {
    const set = keyClients.get(key);
    if (!set) return;
    const t0 = Date.now();
    for (const cid of set) {
      const c = clients.get(cid);
      if (!c) continue;
      // Backpressure: if the socket is congested, enqueue with bounded drop (slow-consumer isolation).
      if (c.ws.bufferedAmount > 1_000_000) { if (!c.queue.push(framePayload)) mDropped.inc(); continue; }
      try { c.ws.send(framePayload); mMsgs.inc(); } catch { mDropped.inc(); }
    }
    latency.observe(Date.now() - t0);
  }

  function processUpstream(m: UpstreamMessage): void {
    let tracker = seqTrackers.get(m.key);
    if (!tracker) { tracker = new SequenceTracker(15_000); seqTrackers.set(m.key, tracker); }
    const outcome = tracker.accept(m.seq, m.ts);
    if (outcome.kind === 'duplicate') return;
    if (outcome.kind === 'gap') {
      mGaps.inc();
      void upstream.restGapFill(m.key, outcome.from, outcome.to).then((filled) => {
        for (const f of filled) deliver(f.key, JSON.stringify({ type: 'data', key: f.key, seq: f.seq, gapFill: true, mtype: f.type, data: f.data }));
      });
    }
    if (m.type === 'candle') {
      // The timeframe comes from the key. It was hardcoded to '1m', so a 1h stream was cached as 1m.
      const pk = parseStreamKey(m.key);
      if (pk) candleCache.upsert(pk.symbol, pk.timeframe ?? '1m', m.data as never);
    }
    if (m.type === 'orderbook_snapshot' || m.type === 'orderbook_delta') {
      let book = books.get(m.key); if (!book) { book = new OrderBook(); books.set(m.key, book); }
      if (m.type === 'orderbook_snapshot') book.applySnapshot({ seq: m.seq, ...(m.data as { bids: never; asks: never }) });
      else {
        const r = book.applyDelta({ ...(m.data as { prevSeq: number; seq: number; bids: never; asks: never }) });
        if (r.kind === 'resync_required') deliver(m.key, JSON.stringify({ type: 'resync', key: m.key }));
      }
    }
    breaker.onSuccess();
    deliver(m.key, JSON.stringify({ type: 'data', key: m.key, seq: m.seq, mtype: m.type, data: m.data }));
    if (pubsub) void pubsub.publish('gw:relay', JSON.stringify({ from: instanceId, key: m.key, seq: m.seq, mtype: m.type, data: m.data })).catch(() => {});
  }
  upstream.onMessage(processUpstream);

  /** The channel portion of a stream key, e.g. `candle@1m`. SubscriptionManager keys on this. */
  function keyChannel(key: string): Channel {
    return key.slice(0, key.indexOf(':')) as Channel;
  }

  /** Sends recent REST history for a candle subscription to one client. Best-effort. */
  async function seedHistory(client: Client, key: string): Promise<void> {
    if (!(upstream instanceof BitMartPublicUpstream)) return;
    const pk = parseStreamKey(key);
    if (!pk || pk.channel !== 'candle' || pk.timeframe === undefined) return;
    try {
      const candles = await upstream.fetchCandles(pk.symbol, pk.timeframe as never, 200);
      if (candles.length === 0 || client.ws.readyState !== client.ws.OPEN) return;
      client.ws.send(JSON.stringify({ type: 'history', key, count: candles.length, data: candles }));
    } catch { /* the live stream still works without history */ }
  }

  function validate(channel: string, symbol: string, timeframe?: string): string | null {
    if (!(CHANNELS as readonly string[]).includes(channel)) return 'invalid channel';
    if (!cfg.allowedSymbols.includes(symbol)) return 'invalid symbol';
    if (timeframe && !cfg.allowedTimeframes.includes(timeframe)) return 'invalid timeframe';
    // A candle stream without a timeframe cannot be routed to an exchange channel, and would previously
    // have been accepted and then never delivered anything.
    if (channel === 'candle' && !timeframe) return 'candle requires a timeframe';
    return null;
  }

  const wss = new WebSocketServer({ noServer: true });
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/health/ready')) {
      // Diagnostics included so a rejected upstream topic is visible rather than silent.
      const diagnostics = upstream instanceof BitMartPublicUpstream ? upstream.diagnostics() : undefined;
      return json(res, 200, { status: 'ok', version: cfg.gitSha, upstream: upstream.status(), circuit: breaker.current, ...(diagnostics ? { diagnostics } : {}) });
    }
    if (url.startsWith('/health/live')) return json(res, 200, { status: 'ok' });
    if (url.startsWith('/health')) return json(res, 200, { status: 'ok', uptimeMs: Math.round(process.uptime() * 1000) });
    if (url.startsWith('/metrics')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(metrics.expose()); }
    json(res, 404, { error: 'not found' });
  });

  // WS upgrade: Origin allowlist + auth BEFORE accepting the socket.
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!(req.url ?? '').startsWith('/ws')) return socket.destroy();
    const origin = req.headers.origin;
    if (!corsOriginAllowed(origin, cfg.originAllowlist)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    // Async now: the session is validated against the BFF before the socket is accepted.
    void authenticate(req, cfg, fetchImpl).then((r) => {
      if ('error' in r) {
        // 503 vs 401 so an operator can tell a credential rejection from a validator outage.
        const line = r.error === 'validator-unavailable'
          ? 'HTTP/1.1 503 Service Unavailable'
          : 'HTTP/1.1 401 Unauthorized';
        if (r.error === 'validator-unavailable') mAuthUnavailable.inc();
        else mAuthRejected.inc();
        try { socket.write(`${line}\r\n\r\n`); } catch { /* already gone */ }
        return socket.destroy();
      }
      wss.handleUpgrade(req, socket, head, (ws) => acceptClient(ws, r.userId));
    });
  });

  function acceptClient(ws: WebSocket, userId: string): void {
    const id = randomUUID();
    const client: Client = { id, userId, ws, subs: new Set(), queue: new BoundedQueue<string>(2000), corr: randomUUID().slice(0, 8) };
    clients.set(id, client);
    mConns.set(clients.size);
    ws.on('message', (raw) => handleClientMsg(client, String(raw)));
    ws.on('close', () => {
      for (const key of client.subs) { const set = keyClients.get(key); set?.delete(id); if (set && set.size === 0) keyClients.delete(key); }
      void subs.dropConsumer(id);
      userSubCount.set(userId, Math.max(0, (userSubCount.get(userId) ?? 0) - client.subs.size));
      clients.delete(id); mConns.set(clients.size); mUpstream.set(upstream.status().upstreamConnections);
    });
    ws.send(JSON.stringify({ type: 'welcome', corr: client.corr, upstream: upstream.status().mode }));
  }

  async function handleClientMsg(client: Client, raw: string): Promise<void> {
    let msg: { type?: string; channel?: string; symbol?: string; timeframe?: string };
    try { msg = JSON.parse(raw); } catch { return client.ws.send(JSON.stringify({ type: 'error', code: 'BAD_JSON' })); }
    if (msg.type === 'subscribe') {
      if (!rateLimiter.allow(client.userId)) return client.ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED' }));
      const err = validate(msg.channel ?? '', msg.symbol ?? '', msg.timeframe);
      if (err) return client.ws.send(JSON.stringify({ type: 'error', code: 'INVALID', message: err }));
      if ((userSubCount.get(client.userId) ?? 0) >= cfg.maxSubsPerUser) return client.ws.send(JSON.stringify({ type: 'error', code: 'SUB_LIMIT' }));
      // Timeframe-qualified for candles: SubscriptionManager de-duplicates by key, so without it a 1m and
      // a 1h subscriber would share one upstream and one of them would silently get the other's interval.
      const key = buildStreamKey(msg.channel as Channel, msg.symbol!, msg.timeframe);
      const subChannel = keyChannel(key);
      if (client.subs.has(key)) return client.ws.send(JSON.stringify({ type: 'subscribed', key, dedup: true }));
      client.subs.add(key);
      let set = keyClients.get(key); if (!set) { set = new Set(); keyClients.set(key, set); } set.add(client.id);
      userSubCount.set(client.userId, (userSubCount.get(client.userId) ?? 0) + 1);
      const opened = await subs.subscribe(client.id, msg.symbol!, subChannel);
      client.ws.send(JSON.stringify({ type: 'subscribed', key, newUpstream: opened, refCount: subs.refCount(msg.symbol!, subChannel) }));
      // A subscription the exchange cannot stream is acked (history may still be available over REST) but
      // the client is told, so it does not present a stalled chart as live.
      if (upstream instanceof BitMartPublicUpstream) {
        const reason = upstream.unsupportedReason(key);
        if (reason !== null) client.ws.send(JSON.stringify({ type: 'stream_unavailable', key, reason }));
      }
      // Seed with recent history so a new subscriber sees bars immediately. klineBin pushes only on
      // change, so a 1d subscriber would otherwise stare at an empty chart for a long time.
      void seedHistory(client, key);
    } else if (msg.type === 'unsubscribe') {
      const key = buildStreamKey(msg.channel as Channel, msg.symbol!, msg.timeframe);
      if (!client.subs.delete(key)) return;
      keyClients.get(key)?.delete(client.id);
      userSubCount.set(client.userId, Math.max(0, (userSubCount.get(client.userId) ?? 0) - 1));
      await subs.unsubscribe(client.id, msg.symbol!, keyChannel(key));
      client.ws.send(JSON.stringify({ type: 'unsubscribed', key }));
    }
  }

  // Optional multi-instance relay via Redis pub/sub (deliver messages produced by OTHER instances).
  if (cfg.redisUrl) {
    try {
      const url = new URL(cfg.redisUrl);
      pubsub = new RedisPubSub({ host: url.hostname, port: Number(url.port || 6379) });
      void pubsub.subscribe('gw:relay', (payload) => {
        try { const m = JSON.parse(payload); if (m.from === instanceId) return; deliver(m.key, JSON.stringify({ type: 'data', key: m.key, seq: m.seq, mtype: m.mtype, data: m.data, relayed: true })); } catch { /* ignore */ }
      }).catch(() => { pubsub = null; });
    } catch { pubsub = null; }
  }

  return new Promise((resolve) => {
    server.listen(cfg.port, cfg.host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
      log.info('gateway listening', { route: `${cfg.host}:${port}`, status: 200 });
      resolve({
        port, metrics,
        close: async () => {
          for (const c of clients.values()) { try { c.ws.close(1001, 'shutdown'); } catch { /* ignore */ } }
          await upstream.stop();
          if (pubsub) await pubsub.close();
          await new Promise<void>((r) => wss.close(() => r()));
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

/** Reads one cookie value from a raw Cookie header without building a RegExp from the name. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const raw = part.trim();
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    if (raw.slice(0, eq) !== name) continue;
    return raw.slice(eq + 1);
  }
  return undefined;
}

/**
 * Authenticates a WebSocket upgrade.
 *
 * The session cookie is forwarded to the BFF's `GET /auth/me`, which is the same validation every other
 * authenticated request goes through — so a revoked session, a disabled account or an expired token is
 * rejected here for free, with no second implementation to keep in sync.
 *
 * The previous implementation trusted `?token=user:<id>` verbatim: any client could claim any user id by
 * editing a query parameter, and the value landed in access logs and `Referer` headers on the way. That path
 * now requires `GATEWAY_DEV_AUTH=true` explicitly AND a non-production NODE_ENV, and is opt-in rather than
 * the default.
 */
async function authenticate(
  req: IncomingMessage,
  cfg: GatewayConfig,
  fetchImpl: typeof fetch,
): Promise<{ userId: string } | { error: 'unauthenticated' | 'validator-unavailable' }> {
  const cookie = req.headers.cookie;
  const session = readCookie(cookie, cfg.sessionCookieName);

  if (session !== undefined && session !== '') {
    try {
      const res = await fetchImpl(cfg.sessionValidateUrl, {
        headers: { cookie: `${cfg.sessionCookieName}=${session}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { user?: { id?: unknown; status?: unknown } };
        const id = body.user?.id;
        // A disabled account must not hold a live stream even if its cookie is still valid.
        if (typeof id === 'string' && id !== '' && body.user?.status !== 'disabled') {
          return { userId: id };
        }
      }
      // 401 from the validator is a definite "no", not an outage.
      if (res.status === 401 || res.status === 403) return { error: 'unauthenticated' };
    } catch {
      // The validator is unreachable. Reported distinctly so an outage is not logged as a credential problem —
      // and still refused, because we cannot authenticate without it (fail closed).
      return { error: 'validator-unavailable' };
    }
  }

  if (cfg.devAuth) {
    const url = new URL(req.url ?? '/', 'http://gw');
    const token = url.searchParams.get('token') ?? (req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '');
    if (token.startsWith('user:') && token.length > 5) return { userId: token.slice(5) };
  }
  return { error: 'unauthenticated' };
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
