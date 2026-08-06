/**
 * 브라우저용 WebSocket 게이트웨이.
 *
 * 프로토콜 (JSON):
 *   클라이언트 -> 서버
 *     { op:'subscribe',   symbols:['BTCUSDT'], candles:[{symbol,tf}] }
 *     { op:'unsubscribe', symbols:[...], candles:[...] }
 *     { op:'ping' }
 *   서버 -> 클라이언트
 *     { ch:'hello',      data:{...} }
 *     { ch:'ticker',     data:{...} }
 *     { ch:'orderbook',  data:{...} }
 *     { ch:'trade',      data:{...} }
 *     { ch:'candle',     data:{symbol,timeframe,candle} }
 *     { ch:'connection', data:{state} }
 *     { ch:'pong' }
 *     { ch:'error',      data:{message} }
 *
 * 클라이언트가 구독하지 않은 심볼의 데이터는 보내지 않는다. 대역폭 낭비와
 * 브라우저 CPU 소모를 막기 위함.
 *
 * 인증: 공개 시세만 전송하므로 이 엔드포인트에는 인증이 없다.
 * 사용자별 데이터(잔고/주문/포지션)를 이 채널로 흘리려면 반드시 세션 인증을
 * 먼저 붙여야 한다. 지금은 그런 데이터가 흐르지 않는다.
 */

import { WebSocketServer, WebSocket } from 'ws';

import { config } from '../config.js';
import { log } from '../log.js';
import { marketService } from '../market/service.js';

const MAX_SYMBOLS_PER_CLIENT = 40;
const MAX_CANDLES_PER_CLIENT = 12;
const MAX_MESSAGE_BYTES = 8 * 1024;

export function attachWsGateway(server, path = '/ws') {
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_MESSAGE_BYTES });

  /** @type {Set<ClientSession>} */
  const clients = new Set();

  // 서비스 이벤트 -> 관심 있는 클라이언트에게만 팬아웃
  const forward = (channel, symbolOf) => (payload) => {
    const symbol = symbolOf(payload);
    for (const session of clients) {
      if (session.wantsSymbol(symbol, channel)) session.send(channel, payload);
    }
  };

  const onTicker = forward('ticker', (t) => t.symbol);
  const onBook = forward('orderbook', (b) => b.symbol);
  const onTrade = forward('trade', (t) => t.symbol);

  const onCandle = (payload) => {
    for (const session of clients) {
      if (session.wantsCandle(payload.symbol, payload.timeframe)) session.send('candle', payload);
    }
  };

  const onConnection = (state) => {
    for (const session of clients) session.send('connection', state);
  };

  marketService.on('ticker', onTicker);
  marketService.on('orderbook', onBook);
  marketService.on('trade', onTrade);
  marketService.on('candle', onCandle);
  marketService.on('connection', onConnection);

  class ClientSession {
    constructor(ws, ip) {
      this.ws = ws;
      this.ip = ip;
      this.alive = true;
      /** 내부심볼 -> 업스트림 해제 함수 */
      this.symbols = new Map();
      /** `${symbol}|${tf}` -> 해제 함수 */
      this.candles = new Map();
    }

    wantsSymbol(symbol) {
      return symbol ? this.symbols.has(symbol) : false;
    }

    wantsCandle(symbol, tf) {
      return this.candles.has(`${symbol}|${tf}`);
    }

    send(ch, data) {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(JSON.stringify({ ch, data }));
      } catch {
        /* 소켓이 막 닫힘 */
      }
    }

    subscribeSymbols(list) {
      for (const raw of list) {
        const symbol = String(raw || '').toUpperCase();
        if (!symbol || this.symbols.has(symbol)) continue;
        if (this.symbols.size >= MAX_SYMBOLS_PER_CLIENT) {
          this.send('error', { message: `심볼 구독 상한 ${MAX_SYMBOLS_PER_CLIENT} 초과` });
          break;
        }
        if (!marketService.isSupported(symbol)) {
          this.send('error', { message: `미지원 심볼: ${symbol}`, symbol });
          continue;
        }
        this.symbols.set(symbol, marketService.subscribeSymbol(symbol));

        // 구독 즉시 현재 스냅샷을 보내 화면이 비지 않게 한다.
        this.sendSnapshot(symbol);

        // 첫 구독이라 스냅샷이 아직 비어 있을 수 있다. primeSnapshot 이 끝나면
        // 한 번 더 보낸다. (그러지 않으면 첫 체결이 올 때까지 오더북이 빈다)
        if (!marketService.getOrderBook(symbol)) {
          marketService
            .primeSnapshot(symbol)
            .then(() => {
              if (this.symbols.has(symbol)) this.sendSnapshot(symbol);
            })
            .catch(() => {});
        }
      }
    }

    sendSnapshot(symbol) {
      const t = marketService.getTicker(symbol);
      if (t) this.send('ticker', t);
      const b = marketService.getOrderBook(symbol);
      if (b) this.send('orderbook', b);
      const trades = marketService.getTrades(symbol, 60);
      if (trades.length) this.send('trades', { symbol, trades });
    }

    unsubscribeSymbols(list) {
      for (const raw of list) {
        const symbol = String(raw || '').toUpperCase();
        const release = this.symbols.get(symbol);
        if (release) {
          release();
          this.symbols.delete(symbol);
        }
      }
    }

    subscribeCandles(list) {
      for (const item of list) {
        const symbol = String(item?.symbol || '').toUpperCase();
        const tf = String(item?.tf || item?.timeframe || '');
        if (!symbol || !tf) continue;
        const key = `${symbol}|${tf}`;
        if (this.candles.has(key)) continue;
        if (this.candles.size >= MAX_CANDLES_PER_CLIENT) {
          this.send('error', { message: `캔들 구독 상한 ${MAX_CANDLES_PER_CLIENT} 초과` });
          break;
        }
        this.candles.set(key, marketService.subscribeCandles(symbol, tf));
      }
    }

    unsubscribeCandles(list) {
      for (const item of list) {
        const symbol = String(item?.symbol || '').toUpperCase();
        const tf = String(item?.tf || item?.timeframe || '');
        const key = `${symbol}|${tf}`;
        const release = this.candles.get(key);
        if (release) {
          release();
          this.candles.delete(key);
        }
      }
    }

    dispose() {
      for (const release of this.symbols.values()) release();
      for (const release of this.candles.values()) release();
      this.symbols.clear();
      this.candles.clear();
    }
  }

  wss.on('connection', (ws, req) => {
    if (clients.size >= config.ws.maxClients) {
      ws.close(1013, 'server busy');
      return;
    }

    const ip = config.trustProxy
      ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
      : req.socket.remoteAddress;

    const session = new ClientSession(ws, ip);
    clients.add(session);

    session.send('hello', {
      exchange: config.exchange,
      connection: marketService.connectionState,
      unsupported: marketService.listUnsupported(),
      serverTime: Date.now(),
    });

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        session.send('error', { message: 'JSON 파싱 실패' });
        return;
      }

      switch (msg.op) {
        case 'subscribe':
          if (Array.isArray(msg.symbols)) session.subscribeSymbols(msg.symbols);
          if (Array.isArray(msg.candles)) session.subscribeCandles(msg.candles);
          break;
        case 'unsubscribe':
          if (Array.isArray(msg.symbols)) session.unsubscribeSymbols(msg.symbols);
          if (Array.isArray(msg.candles)) session.unsubscribeCandles(msg.candles);
          break;
        case 'ping':
          session.send('pong', { serverTime: Date.now() });
          break;
        default:
          session.send('error', { message: `알 수 없는 op: ${msg.op}` });
      }
    });

    ws.on('pong', () => {
      session.alive = true;
    });

    const cleanup = () => {
      session.dispose();
      clients.delete(session);
    };
    ws.on('close', cleanup);
    ws.on('error', (err) => {
      log.debug('브라우저 WS 오류', { error: String(err?.message || err) });
      cleanup();
    });
  });

  // 죽은 연결 정리. 응답 없는 소켓은 구독을 잡고 있으므로 반드시 회수한다.
  const heartbeat = setInterval(() => {
    for (const session of clients) {
      if (!session.alive) {
        session.ws.terminate();
        continue;
      }
      session.alive = false;
      try {
        session.ws.ping();
      } catch {
        /* noop */
      }
    }
  }, config.ws.heartbeatMs);
  heartbeat.unref?.();

  return {
    wss,
    clientCount: () => clients.size,
    close() {
      clearInterval(heartbeat);
      marketService.off('ticker', onTicker);
      marketService.off('orderbook', onBook);
      marketService.off('trade', onTrade);
      marketService.off('candle', onCandle);
      marketService.off('connection', onConnection);
      for (const session of clients) {
        session.dispose();
        try {
          session.ws.close(1001, 'server shutdown');
        } catch {
          /* noop */
        }
      }
      clients.clear();
      wss.close();
    },
  };
}
