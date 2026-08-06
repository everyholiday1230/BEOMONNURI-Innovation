/**
 * 브라우저용 WebSocket 게이트웨이.
 *
 * 왜 필요한가
 * ----------
 * apps/api 는 SSE(`/api/stream/market`)만 갖고 있었다. 그건 연결 하나가
 * 심볼·타임프레임 하나만 담당하고, 오더북·체결 스트림이 없다. 디자이너 화면은
 * 한 화면에서 티커·오더북·체결·캔들을 동시에 보여주므로 SSE 로는 기능이 줄어든다.
 * 그래서 다중 구독이 가능한 WS 게이트웨이를 둔다.
 *
 * 프로토콜 (JSON)
 * --------------
 *   클라이언트 → 서버
 *     { op:'subscribe',   symbols:['BTCUSDT'], candles:[{symbol,tf}] }
 *     { op:'unsubscribe', symbols:[...], candles:[...] }
 *     { op:'ping' }
 *   서버 → 클라이언트
 *     { ch:'hello',      data:{ connection, unsupported, timeframes } }
 *     { ch:'ticker',     data:<UI 티커> }
 *     { ch:'orderbook',  data:<UI 오더북> }
 *     { ch:'trade',      data:<UI 체결> }
 *     { ch:'candle',     data:{ symbol, timeframe, candle } }
 *     { ch:'connection', data:{ state } }
 *     { ch:'pong' }
 *     { ch:'error',      data:{ message } }
 *
 * 구독하지 않은 심볼의 데이터는 보내지 않는다. 664개 심볼을 전부 흘리면
 * 브라우저가 JSON 파싱만 하다 멈춘다.
 *
 * 인증
 * ----
 * 공개 시세만 전송하므로 이 엔드포인트에는 인증이 없다.
 * ★ 사용자별 데이터(잔고/주문/포지션)를 이 채널로 흘리려면 반드시 세션 인증을
 *   먼저 붙여야 한다. 지금은 그런 데이터가 흐르지 않는다.
 */

import type { Server } from 'node:http';

import type { Timeframe } from '@quantumtrade/config';
import type { Candle, OrderBook, Ticker, Trade } from '@quantumtrade/schemas';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

import type { MarketProviders } from './providers';

/**
 * 클라이언트 1개가 붙을 수 있는 상한.
 *
 * 상한이 없으면 한 탭이 664개 심볼을 구독해 업스트림 토픽을 폭발시킬 수 있다.
 * KuCoin 은 연결당 토픽 수를 제한하므로, 그 한도를 한 사용자가 다 써버리면
 * 다른 사용자의 구독이 실패한다.
 */
const MAX_SYMBOLS_PER_CLIENT = 40;
const MAX_CANDLES_PER_CLIENT = 12;
/** 8KB. 정상 구독 메시지는 수백 바이트다. */
const MAX_MESSAGE_BYTES = 8 * 1024;

/** 심볼 표기를 대문자로 통일한다. 프론트가 소문자로 보낼 수도 있다. */
function normSymbol(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : '';
}

/**
 * 타임프레임을 정규 표기로.
 *
 * 디자이너 차트 버튼은 '1H','4H','1D' 대문자를 쓴다. 백엔드 스키마는 소문자다.
 * 여기서 흡수하지 않으면 대문자 구독이 조용히 무시된다.
 */
function normTimeframe(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

// ---------------------------------------------------------------
// 정규 스키마 → UI 형태 변환
// ---------------------------------------------------------------

/*
   백엔드 내부는 문자열 십진수(DecimalString)를 쓴다. 디자이너 UI 는 숫자를 쓴다.
   REST 쪽 변환은 src/api-client.js 가 담당하고, WS 쪽은 여기서 한다.
   **같은 형태로 맞춰야 한다** — 형태가 갈리면 REST 로 시딩한 값과 WS 로 갱신한
   값이 서로 다른 타입이 되어, 정렬·비교가 조용히 틀어진다.
*/

function num(v: unknown, fallback: number | undefined = undefined): number | undefined {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toUiTicker(t: Ticker): Record<string, unknown> {
  return {
    symbol: t.symbol,
    last: num(t.last, 0),
    bid: num((t as { bid?: string }).bid),
    ask: num((t as { ask?: string }).ask),
    mark: num(t.markPrice),
    index: num(t.indexPrice),
    high24h: num(t.high24h),
    low24h: num(t.low24h),
    chg24hPct: num(t.changePct),
    vol24hQuote: num(t.vol24h),
    fundingRate: num(t.fundingRate),
    nextFundingTime: num(t.nextFundingAt),
    ts: num((t as { asOf?: number }).asOf, Date.now()),
  };
}

function toUiBook(b: OrderBook, rows = 20): Record<string, unknown> | null {
  const side = (levels: readonly (readonly [string, string])[]) => {
    const out: { price: number; amount: number; cumulative: number }[] = [];
    let cum = 0;
    for (const lv of levels) {
      const price = num(lv[0]);
      const amount = num(lv[1]);
      if (price === undefined || amount === undefined) continue;
      cum += amount;
      out.push({ price, amount, cumulative: Math.round(cum * 1e6) / 1e6 });
      if (out.length >= rows) break;
    }
    return out;
  };

  const bids = side(b.bids);
  const asks = side(b.asks);
  // 한쪽이 비면 mid/spread 를 만들 수 없다. 0 으로 채우면 화면에 가짜 가격이 뜬다.
  if (!bids.length || !asks.length) return null;

  return {
    symbol: b.symbol,
    bids,
    asks,
    mid: (bids[0]!.price + asks[0]!.price) / 2,
    spread: asks[0]!.price - bids[0]!.price,
    ts: b.asOf,
    sequence: b.sequence,
  };
}

function toUiTrade(t: Trade, symbol: string): Record<string, unknown> {
  return {
    symbol,
    id: t.id,
    time: t.ts,
    price: num(t.price, 0),
    amount: num(t.size, 0),
    // side 는 taker 방향이다. 거래소가 명시하므로 추론하지 않는다.
    side: t.side === 'sell' ? 'sell' : 'buy',
  };
}

// ---------------------------------------------------------------
// 세션
// ---------------------------------------------------------------

interface Subscriptions {
  symbols: Set<string>;
  /** `SYMBOL|tf` */
  candles: Set<string>;
}

function candleKey(symbol: string, tf: string): string {
  return `${symbol}|${tf}`;
}

export interface WsGatewayOptions {
  path?: string;
  /** 지원 타임프레임. hello 프레임으로 알려준다. */
  timeframes?: readonly string[];
  onDiagnostic?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface WsGatewayHandle {
  /** 현재 접속자 수. */
  clientCount: () => number;
  /** 업스트림 구독 현황 (진단용). */
  status: () => { clients: number; symbols: number; candles: number };
  close: () => Promise<void>;
}

/**
 * HTTP 서버에 WS 게이트웨이를 붙인다.
 *
 * @param server @hono/node-server 가 만든 Node HTTP 서버
 * @param providers 시세 제공자 (KuCoin 어댑터 등)
 */
export function attachWsGateway(
  server: Server,
  providers: MarketProviders,
  opts: WsGatewayOptions = {},
): WsGatewayHandle {
  const path = opts.path ?? '/ws';
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_MESSAGE_BYTES });
  const diag = opts.onDiagnostic ?? (() => {});

  interface Session {
    ws: WebSocket;
    subs: Subscriptions;
    /** 업스트림 구독 해제 함수들. `채널|키` → unsubscribe */
    releases: Map<string, () => void>;
    alive: boolean;
  }

  const sessions = new Set<Session>();

  function send(s: Session, ch: string, data?: unknown): void {
    if (s.ws.readyState !== WebSocket.OPEN) return;
    try {
      s.ws.send(JSON.stringify(data === undefined ? { ch } : { ch, data }));
    } catch (e) {
      diag('WS 전송 실패', { error: (e as Error).message });
    }
  }

  /**
   * 심볼 하나에 대해 티커·오더북·체결을 구독한다.
   *
   * 세션별로 업스트림을 따로 잡는다. 어댑터가 내부에서 같은 토픽을 참조 계수로
   * 공유하므로(마지막 구독자가 떠날 때만 업스트림 해제), 여기서 중복 관리를
   * 하지 않아도 업스트림 연결이 늘어나지 않는다.
   */
  function subscribeSymbol(s: Session, symbol: string): void {
    if (s.subs.symbols.has(symbol)) return;
    if (s.subs.symbols.size >= MAX_SYMBOLS_PER_CLIENT) {
      send(s, 'error', { message: `symbol subscription limit reached (${MAX_SYMBOLS_PER_CLIENT})` });
      return;
    }
    s.subs.symbols.add(symbol);

    try {
      // subscribeTicker 는 IMarketDataProvider 표준 메서드가 아니다.
      // KuCoin 어댑터가 추가로 제공한다. 없는 어댑터(목업 등)에서도 나머지
      // 채널은 정상 동작해야 하므로 존재 여부를 확인한 뒤 붙인다.
      const tickerCapable = providers.market as {
        subscribeTicker?: (symbol: string, cb: (t: Ticker) => void) => () => void;
      };
      if (typeof tickerCapable.subscribeTicker === 'function') {
        s.releases.set(
          `ticker|${symbol}`,
          tickerCapable.subscribeTicker(symbol, (t: Ticker) => send(s, 'ticker', toUiTicker(t))),
        );
      }
      s.releases.set(
        `book|${symbol}`,
        providers.book.subscribeBook(symbol, (b: OrderBook) => {
          const ui = toUiBook(b);
          if (ui) send(s, 'orderbook', ui);
        }),
      );
      s.releases.set(
        `trade|${symbol}`,
        providers.trades.subscribeTrades(symbol, (t: Trade) => send(s, 'trade', toUiTrade(t, symbol))),
      );
    } catch (e) {
      // 미지원 심볼 등. 연결을 끊지 않고 알려만 준다 — 다른 심볼은 계속 흘러야 한다.
      s.subs.symbols.delete(symbol);
      send(s, 'error', { message: `${symbol}: ${(e as Error).message}` });
    }
  }

  function unsubscribeSymbol(s: Session, symbol: string): void {
    if (!s.subs.symbols.delete(symbol)) return;
    for (const ch of ['ticker', 'book', 'trade']) {
      const key = `${ch}|${symbol}`;
      const release = s.releases.get(key);
      if (release) {
        try { release(); } catch { /* 이미 해제됨 */ }
        s.releases.delete(key);
      }
    }
  }

  function subscribeCandle(s: Session, symbol: string, tf: string): void {
    const key = candleKey(symbol, tf);
    if (s.subs.candles.has(key)) return;
    if (s.subs.candles.size >= MAX_CANDLES_PER_CLIENT) {
      send(s, 'error', { message: `candle subscription limit reached (${MAX_CANDLES_PER_CLIENT})` });
      return;
    }
    s.subs.candles.add(key);

    try {
      s.releases.set(
        `candle|${key}`,
        providers.market.subscribeCandles(symbol, tf as Timeframe, (candle: Candle) =>
          send(s, 'candle', { symbol, timeframe: tf, candle }),
        ),
      );
    } catch (e) {
      s.subs.candles.delete(key);
      send(s, 'error', { message: `${symbol} ${tf}: ${(e as Error).message}` });
    }
  }

  function unsubscribeCandle(s: Session, symbol: string, tf: string): void {
    const key = candleKey(symbol, tf);
    if (!s.subs.candles.delete(key)) return;
    const release = s.releases.get(`candle|${key}`);
    if (release) {
      try { release(); } catch { /* 이미 해제됨 */ }
      s.releases.delete(`candle|${key}`);
    }
  }

  function teardown(s: Session): void {
    for (const release of s.releases.values()) {
      try { release(); } catch { /* noop */ }
    }
    s.releases.clear();
    s.subs.symbols.clear();
    s.subs.candles.clear();
    sessions.delete(s);
  }

  // --- 업스트림 연결 상태를 접속자 전원에게 알린다 ---
  //
  // 이 통지가 없으면 시세가 멈췄는데 화면은 '실시간'을 표시한다.
  // 죽은 시세를 live 로 보여주는 것이 가장 위험한 실패 모드다.
  let lastUpstreamState = 'connecting';
  const upstreamPoll = setInterval(() => {
    const st = providers.streaming?.status() as
      | { stream?: { state?: string } }
      | undefined;
    const state = st?.stream?.state ?? 'unknown';
    if (state === lastUpstreamState) return;
    lastUpstreamState = state;
    for (const s of sessions) send(s, 'connection', { state });
  }, 1_000);

  wss.on('connection', (ws: WebSocket) => {
    const session: Session = {
      ws,
      subs: { symbols: new Set(), candles: new Set() },
      releases: new Map(),
      alive: true,
    };
    sessions.add(session);

    const st = providers.streaming?.status() as
      | { stream?: { state?: string }; unsupported?: string[] }
      | undefined;

    send(session, 'hello', {
      connection: st?.stream?.state ?? 'unknown',
      // 미지원 심볼을 미리 알려주면 프론트가 그 심볼에 대해 실데이터를 기다리지 않는다.
      unsupported: st?.unsupported ?? [],
      timeframes: opts.timeframes ?? [],
      source: providers.source,
    });

    ws.on('message', (raw: RawData) => {
      let msg: { op?: string; symbols?: unknown; candles?: unknown };
      try {
        msg = JSON.parse(String(raw)) as typeof msg;
      } catch {
        send(session, 'error', { message: 'malformed JSON' });
        return;
      }

      const symbols = Array.isArray(msg.symbols) ? msg.symbols.map(normSymbol).filter(Boolean) : [];
      const candles = Array.isArray(msg.candles)
        ? (msg.candles as { symbol?: unknown; tf?: unknown; timeframe?: unknown }[])
            .map((c) => ({
              symbol: normSymbol(c?.symbol),
              tf: normTimeframe(c?.tf ?? c?.timeframe),
            }))
            .filter((c) => c.symbol && c.tf)
        : [];

      switch (msg.op) {
        case 'subscribe':
          for (const sym of symbols) subscribeSymbol(session, sym);
          for (const c of candles) subscribeCandle(session, c.symbol, c.tf);
          break;

        case 'unsubscribe':
          for (const sym of symbols) unsubscribeSymbol(session, sym);
          for (const c of candles) unsubscribeCandle(session, c.symbol, c.tf);
          break;

        case 'ping':
          // 프론트가 왕복시간으로 지연을 측정한다. 즉시 답한다.
          send(session, 'pong');
          break;

        default:
          send(session, 'error', { message: `unknown op: ${String(msg.op)}` });
      }
    });

    ws.on('pong', () => { session.alive = true; });
    ws.on('close', () => teardown(session));
    ws.on('error', (e: Error) => {
      diag('WS 클라이언트 오류', { error: e.message });
      teardown(session);
    });
  });

  /**
   * 죽은 연결 청소.
   *
   * 브라우저 탭이 강제 종료되면 TCP FIN 이 오지 않아 서버가 연결을 계속
   * 살아있다고 본다. 그러면 업스트림 구독이 영구히 남는다.
   */
  const heartbeat = setInterval(() => {
    for (const s of sessions) {
      if (!s.alive) {
        s.ws.terminate();
        teardown(s);
        continue;
      }
      s.alive = false;
      try { s.ws.ping(); } catch { /* 곧 close 이벤트가 온다 */ }
    }
  }, 30_000);

  return {
    clientCount: () => sessions.size,
    status: () => {
      let symbols = 0;
      let candles = 0;
      for (const s of sessions) {
        symbols += s.subs.symbols.size;
        candles += s.subs.candles.size;
      }
      return { clients: sessions.size, symbols, candles };
    },
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        clearInterval(upstreamPoll);
        for (const s of sessions) {
          teardown(s);
          try { s.ws.close(1001, 'server shutting down'); } catch { /* noop */ }
        }
        wss.close(() => resolve());
      }),
  };
}
