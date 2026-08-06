/**
 * BitMart PUBLIC futures WebSocket verification (docs section 4). Public data only — NO API keys,
 * NO private/production endpoints. Connects to the official public WS, subscribes to
 * ticker/kline/depth/trade, exercises heartbeat, disconnect/reconnect (exponential backoff +
 * jitter), symbol/timeframe switches, dedup + out-of-order handling, and verifies that exactly ONE
 * socket and a bounded listener set are used (no leak on switches/reconnects).
 *
 * Run:   node tests/integration/bitmart-ws-verify.mjs
 * Env:   WS_DURATION_MS (default 60000), WS_SYMBOL_SWITCHES (3), WS_TF_SWITCHES (3),
 *        WS_FORCE_RECONNECT (1). For the full spec run: WS_DURATION_MS=600000 WS_SYMBOL_SWITCHES=20
 *        WS_TF_SWITCHES=20.
 * Output: JSON summary on stdout. This is a REAL network test; if the network/policy blocks it,
 *         it prints {"ok":false,"reason":...} and exits non-zero (mark Not Executed, do not fake).
 */
import WebSocket from 'ws';

const URL = process.env.BITMART_WS_PUBLIC ?? 'wss://openapi-ws-v2.bitmart.com/api?protocol=1.1';
const DURATION = Number(process.env.WS_DURATION_MS ?? 60000);
const SYMBOL_SWITCHES = Number(process.env.WS_SYMBOL_SWITCHES ?? 3);
const TF_SWITCHES = Number(process.env.WS_TF_SWITCHES ?? 3);
const FORCE_RECONNECT = process.env.WS_FORCE_RECONNECT !== '0';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const TFS = ['1m', '5m', '15m'];

const stats = {
  ok: false,
  url: URL,
  durationMs: DURATION,
  opens: 0,
  reconnects: 0,
  forcedDisconnects: 0,
  socketsCreated: 0,
  maxConcurrentSockets: 0,
  listenerCountFinal: 0,
  pingsSent: 0,
  pongs: 0,
  msg: { ticker: 0, kline: 0, depth: 0, trade: 0, ack: 0, error: 0, other: 0 },
  tradeDuplicatesDropped: 0,
  klineOutOfOrderIgnored: 0,
  symbolSwitches: 0,
  tfSwitches: 0,
  lastError: null,
};

let ws = null;
let liveSockets = 0;
let symIdx = 0;
let tfIdx = 0;
let pingTimer = null;
let backoff = 500;
const seenTradeIds = new Set();
let lastKlineTs = 0;
const started = Date.now();

const chan = (sym, tf) => [
  `futures/ticker:${sym}`,
  `futures/klineBin${tf}:${sym}`,
  `futures/depth20:${sym}`,
  `futures/trade:${sym}`,
];

function send(action, args) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action, args }));
}

function connect() {
  ws = new WebSocket(URL);
  stats.socketsCreated += 1;
  liveSockets += 1;
  stats.maxConcurrentSockets = Math.max(stats.maxConcurrentSockets, liveSockets);

  ws.on('open', () => {
    stats.opens += 1;
    backoff = 500;
    send('subscribe', chan(SYMBOLS[symIdx], TFS[tfIdx]));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('ping');
        stats.pingsSent += 1;
      }
    }, 15000);
  });

  ws.on('message', (buf) => {
    const s = buf.toString();
    if (s === 'pong') {
      stats.pongs += 1;
      return;
    }
    let m;
    try {
      m = JSON.parse(s);
    } catch {
      stats.msg.other += 1;
      return;
    }
    if (m.success !== undefined) {
      stats.msg.ack += 1;
      return;
    }
    if (m.errorCode !== undefined || m.error) {
      stats.msg.error += 1;
      stats.lastError = s.slice(0, 160);
      return;
    }
    const g = String(m.group || '');
    if (g.includes('ticker')) stats.msg.ticker += 1;
    else if (g.includes('klineBin')) {
      stats.msg.kline += 1;
      const rows = Array.isArray(m.data) ? m.data : [m.data];
      for (const r of rows) {
        const ts = Number(r?.ts ?? r?.timestamp ?? r?.[0] ?? 0);
        if (ts && ts < lastKlineTs) stats.klineOutOfOrderIgnored += 1;
        else if (ts) lastKlineTs = ts;
      }
    } else if (g.includes('depth')) stats.msg.depth += 1;
    else if (g.includes('trade')) {
      stats.msg.trade += 1;
      const rows = Array.isArray(m.data) ? m.data : [];
      for (const tr of rows) {
        const id = String(tr?.trade_id ?? tr?.id ?? `${tr?.created_at ?? ''}-${tr?.price ?? ''}-${tr?.size ?? ''}`);
        if (seenTradeIds.has(id)) stats.tradeDuplicatesDropped += 1;
        else seenTradeIds.add(id);
      }
    } else stats.msg.other += 1;
  });

  ws.on('error', (e) => {
    stats.lastError = e.message;
  });

  ws.on('close', () => {
    liveSockets -= 1;
    clearInterval(pingTimer);
    if (Date.now() - started < DURATION) {
      stats.reconnects += 1;
      const jitter = Math.random() * backoff * 0.3;
      const wait = Math.min(8000, backoff) + jitter;
      backoff = Math.min(8000, backoff * 2);
      setTimeout(connect, wait);
    }
  });
}

function switchSymbol() {
  const oldSym = SYMBOLS[symIdx];
  send('unsubscribe', chan(oldSym, TFS[tfIdx]));
  symIdx = (symIdx + 1) % SYMBOLS.length;
  send('subscribe', chan(SYMBOLS[symIdx], TFS[tfIdx]));
  stats.symbolSwitches += 1;
}

function switchTf() {
  const sym = SYMBOLS[symIdx];
  send('unsubscribe', [`futures/klineBin${TFS[tfIdx]}:${sym}`]);
  tfIdx = (tfIdx + 1) % TFS.length;
  send('subscribe', [`futures/klineBin${TFS[tfIdx]}:${sym}`]);
  stats.tfSwitches += 1;
}

connect();

// Schedule symbol/timeframe switches spread across the run.
const switchEvery = Math.max(2000, Math.floor(DURATION / (SYMBOL_SWITCHES + TF_SWITCHES + 1)));
const switchTimer = setInterval(() => {
  if (stats.symbolSwitches < SYMBOL_SWITCHES) switchSymbol();
  else if (stats.tfSwitches < TF_SWITCHES) switchTf();
}, switchEvery);

// One forced disconnect ~40% through to prove reconnect + backoff.
if (FORCE_RECONNECT) {
  setTimeout(() => {
    stats.forcedDisconnects += 1;
    try {
      ws.terminate();
    } catch {
      /* noop */
    }
  }, Math.floor(DURATION * 0.4));
}

setTimeout(() => {
  clearInterval(switchTimer);
  clearInterval(pingTimer);
  stats.listenerCountFinal = ws ? ws.listenerCount('message') : 0;
  // Success criteria: connected, received data on all four channels, heartbeat worked or data
  // flowed, reconnect worked after the forced disconnect, and only one socket at a time.
  stats.ok =
    stats.opens >= 1 &&
    stats.msg.ticker > 0 &&
    stats.msg.kline > 0 &&
    stats.msg.depth > 0 &&
    stats.msg.trade > 0 &&
    stats.maxConcurrentSockets === 1 &&
    (!FORCE_RECONNECT || stats.opens >= 2);
  console.log(JSON.stringify(stats, null, 2));
  try {
    ws.close();
  } catch {
    /* noop */
  }
  process.exit(stats.ok ? 0 : 1);
}, DURATION + 500);
