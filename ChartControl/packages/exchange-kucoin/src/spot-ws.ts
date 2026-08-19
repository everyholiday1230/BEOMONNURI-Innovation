/* ============================================================
   KuCoin 현물(Spot) 실시간 스트림
   ------------------------------------------------------------
   왜 별도 파일인가 — 선물 WS 를 그대로 쓸 수 없는 이유

   ★★ 토픽 접두어가 다르다.

     선물  /contractMarket/ticker:XBTUSDTM
     현물  /market/ticker:BTC-USDT

     그리고 **호가만 접두어가 또 다르다**(`/spotMarket/level2Depth5:`).
     한 곳에서 분기하면 어느 시장의 토픽을 보냈는지 알기 어렵고, 잘못된 토픽은
     오류가 아니라 **조용한 무응답**으로 나타난다 — 화면은 실시간이라고 믿으며
     영원히 기다린다.

   ★ bullet(접속 토큰) 주소도 다르다.

     선물 api-futures.kucoin.com, 현물 api.kucoin.com. 선물 토큰으로 현물
     엔드포인트에 붙으면 연결은 되지만 구독이 되지 않는다.

   ★★ 캔들 배열 순서가 REST 와 또 다르다.

     현물 REST candles   [sec, open, close, high, low, volume, turnover]
     현물 WS   candles   [sec, open, close, high, low, volume, turnover]  ← 같다
     선물 WS   limitCandle [sec, open, close, high, low, turnover, volume] ← 뒤 두 개가 반대

     현물은 REST 와 WS 가 같은 순서라 다행이지만, 그 사실을 확인하고 쓰는 것과
     가정하고 쓰는 것은 다르다. 이 파일은 확인한 순서를 명시한다.

   ★ 이 스트림은 **시세 전용**이다. 주문·잔고 같은 개인 데이터는 별도 인증
     채널이 필요하고, 여기서 다루지 않는다.
   ============================================================ */

import { CandleSchema, TickerSchema, type Candle, type Ticker } from '@quantumtrade/schemas';

import { toSpotSymbol, fromSpotSymbol } from './spot-adapter.js';
import { DEFAULT_KUCOIN_SPOT_REST } from './broker-rest.js';

/* ---------------------------------------------------------------
   토픽
   --------------------------------------------------------------- */

/** 현물 시세 토픽 접두어. 호가만 다른 접두어를 쓴다(KuCoin 문서 확인). */
const MARKET = '/market/';
const SPOT_MARKET = '/spotMarket/';

export function spotTickerTopic(symbol: string): string {
  return `${MARKET}ticker:${toSpotSymbol(symbol)}`;
}

/** 체결. 현물은 'match' 다(선물은 'execution'). */
export function spotMatchTopic(symbol: string): string {
  return `${MARKET}match:${toSpotSymbol(symbol)}`;
}

/** 호가 5단. 접두어가 /spotMarket/ 이다 — /market/ 로 보내면 조용히 아무것도 오지 않는다. */
export function spotDepth5Topic(symbol: string): string {
  return `${SPOT_MARKET}level2Depth5:${toSpotSymbol(symbol)}`;
}

/**
 * 시간대 → 현물 WS 캔들 접미어.
 *
 * ★ REST 와 같은 표기(`15min`)를 쓴다. 선물 WS 는 분 숫자(`15min` 이 아니라
 *   `15min` 이 아닌 형식)를 쓰므로 표를 공유하면 한쪽이 조용히 실패한다.
 */
const WS_TF: Record<string, string> = {
  '1m': '1min', '3m': '3min', '5m': '5min', '15m': '15min', '30m': '30min',
  '1h': '1hour', '1H': '1hour', '2h': '2hour', '4h': '4hour', '4H': '4hour',
  '6h': '6hour', '8h': '8hour', '12h': '12hour',
  '1d': '1day', '1D': '1day', '1w': '1week', '1W': '1week',
};

/** 캔들 토픽. 지원하지 않는 주기면 null — 임의 주기로 구독하면 응답이 없다. */
export function spotCandleTopic(symbol: string, timeframe: string): string | null {
  const suffix = WS_TF[String(timeframe)];
  return suffix ? `${MARKET}candles:${toSpotSymbol(symbol)}_${suffix}` : null;
}

/* ---------------------------------------------------------------
   프레임 해석
   --------------------------------------------------------------- */

/** 토픽에서 심볼을 되돌린다. `/market/ticker:BTC-USDT` → `BTCUSDT` */
export function symbolFromSpotTopic(topic: string): string | null {
  const m = /:([A-Z0-9-]+)(?:_|$)/i.exec(String(topic ?? ''));
  return m ? fromSpotSymbol(m[1]!) : null;
}

/**
 * 현물 ticker 프레임 → 정규 Ticker.
 *
 * ★★ 현물 ticker 는 **변동률을 주지 않는다.**
 *
 *   `/market/ticker` 의 payload 는 최우선 매수/매도·최근 체결가·크기만 담는다.
 *   24시간 변동률은 `/market/snapshot` 이나 REST stats 에서 온다. 그래서 여기서
 *   changePct 를 0 으로 채우면 **모든 종목이 "변동 없음" 으로 보인다.** 값을
 *   만들지 않고, 호출자가 기존 값을 유지하도록 undefined 로 남긴다.
 */
export function parseSpotTicker(topic: string, data: unknown): (Partial<Ticker> & { symbol: string }) | null {
  const symbol = symbolFromSpotTopic(topic);
  if (!symbol || !data || typeof data !== 'object') return null;
  const d = data as { price?: string; bestBid?: string; bestAsk?: string; size?: string; time?: number };
  const last = d.price;
  if (last === undefined || last === null || last === '') return null;
  // 최소 형태만 검증한다. 변동률은 여기서 오지 않으므로 스키마 전체를 쓰지 않는다.
  const parsed = TickerSchema.pick({ symbol: true, last: true }).safeParse({ symbol, last: String(last) });
  if (!parsed.success) return null;
  return {
    symbol,
    last: String(last),
    ...(d.bestBid ? { bid: String(d.bestBid) } : {}),
    ...(d.bestAsk ? { ask: String(d.bestAsk) } : {}),
  } as Partial<Ticker> & { symbol: string };
}

/**
 * 현물 candles 프레임 → 정규 Candle.
 *
 * ★★ 배열 순서: [sec, open, close, high, low, volume, turnover]
 *
 *   REST 와 같은 순서다(실제 응답으로 확인). close 가 두 번째, high 가 네 번째다.
 *   선물 순서로 읽으면 몸통과 꼬리가 뒤바뀐 캔들이 그려지고, 오류는 나지 않는다.
 */
export function parseSpotCandle(data: unknown): { symbol: string; candle: Candle } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { symbol?: string; candles?: string[]; time?: number };
  const row = d.candles;
  if (!Array.isArray(row) || row.length < 6) return null;
  const symbol = d.symbol ? fromSpotSymbol(d.symbol) : null;
  if (!symbol) return null;

  const parsed = CandleSchema.safeParse({
    time: Number(row[0]) * 1000,
    open: String(row[1]),
    close: String(row[2]),
    high: String(row[3]),
    low: String(row[4]),
    volume: String(row[5]),
    /*
       ★ 진행 중인 캔들이다. closed:false 로 표시해야 화면이 마지막 봉을
         "확정된 값" 으로 오해하지 않는다.
    */
    closed: false,
  });
  return parsed.success ? { symbol, candle: parsed.data } : null;
}

/* ---------------------------------------------------------------
   bullet(접속 토큰) 발급
   --------------------------------------------------------------- */

/**
 * 현물 WS 접속 토큰.
 *
 * ★ 현물 도메인(api.kucoin.com)에서 받아야 한다. 선물 토큰으로 현물
 *   엔드포인트에 붙으면 연결은 되지만 구독이 되지 않는다 — 화면은 실시간이라고
 *   믿으며 아무것도 받지 못한다.
 */
export interface SpotBulletProvider {
  createPublicBullet(signal?: AbortSignal): Promise<{
    token: string;
    instanceServers: Array<{ endpoint: string; pingInterval?: number; pingTimeout?: number }>;
  }>;
}

export function createSpotBulletProvider(opts: {
  restBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): SpotBulletProvider {
  const base = (opts.restBase ?? DEFAULT_KUCOIN_SPOT_REST).replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return {
    async createPublicBullet(signal?: AbortSignal) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        const res = await doFetch(`${base}/api/v1/bullet-public`, {
          method: 'POST',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`spot bullet → HTTP ${res.status}`);
        const body = (await res.json()) as {
          code?: string;
          msg?: string;
          data?: { token?: string; instanceServers?: Array<{ endpoint?: string; pingInterval?: number; pingTimeout?: number }> };
        };
        /*
           HTTP 200 에 code 로 실패를 알린다. code 를 보지 않으면 토큰 없이
           연결을 시도하고, 그 실패가 "네트워크 문제" 로 오해된다.
        */
        if (body.code && body.code !== '200000') {
          throw new Error(`spot bullet → code ${body.code} ${body.msg ?? ''}`.trim());
        }
        const token = body.data?.token;
        const servers = body.data?.instanceServers;
        if (!token || !Array.isArray(servers) || servers.length === 0) {
          throw new Error('spot bullet → token 또는 instanceServers 가 없다');
        }
        return {
          token,
          instanceServers: servers.map((s) => ({
            endpoint: String(s.endpoint ?? ''),
            ...(s.pingInterval !== undefined ? { pingInterval: Number(s.pingInterval) } : {}),
            ...(s.pingTimeout !== undefined ? { pingTimeout: Number(s.pingTimeout) } : {}),
          })),
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/* ---------------------------------------------------------------
   호가 · 체결 프레임
   --------------------------------------------------------------- */

/**
 * 현물 호가(level2Depth5) 프레임 → 정규 OrderBook.
 *
 * 실제 프레임 (2026-08 확인):
 *   { asks: [[price, size], …], bids: [[price, size], …], timestamp: ms }
 *
 * ★★ 선물과 다른 점
 *
 *   선물 level2Depth5 는 `sequence` 를 준다. 현물은 **주지 않는다.**
 *   그래서 순서 검증을 할 수 없다. 스냅샷만 오는 채널이므로 매 프레임을
 *   완전한 스냅샷으로 다루면 되고, 우리는 시퀀스를 만들어 넣지 않는다 —
 *   없는 번호를 채우면 "순서가 맞다" 는 근거 없는 주장이 된다.
 *
 * ★ bids 는 내림차순, asks 는 오름차순으로 온다(확인). 정렬을 다시 하지 않는다 —
 *   거래소 순서를 신뢰하되, 뒤집혀 오면 화면에서 드러난다.
 */
export function parseSpotBook(
  topic: string,
  data: unknown,
): { symbol: string; bids: Array<[string, string]>; asks: Array<[string, string]>; asOf: number } | null {
  const symbol = symbolFromSpotTopic(topic);
  if (!symbol || !data || typeof data !== 'object') return null;
  const d = data as { bids?: unknown; asks?: unknown; timestamp?: number };
  if (!Array.isArray(d.bids) || !Array.isArray(d.asks)) return null;

  const level = (row: unknown): [string, string] | null => {
    if (!Array.isArray(row) || row.length < 2) return null;
    const p = String(row[0]);
    const s = String(row[1]);
    // 값이 숫자가 아니면 그 줄만 버린다. 한 줄 때문에 호가창을 비우지 않는다.
    if (!Number.isFinite(Number(p)) || !Number.isFinite(Number(s))) return null;
    return [p, s];
  };

  const bids = d.bids.map(level).filter((x): x is [string, string] => x !== null);
  const asks = d.asks.map(level).filter((x): x is [string, string] => x !== null);
  if (bids.length === 0 && asks.length === 0) return null;

  return {
    symbol,
    bids,
    asks,
    asOf: Number(d.timestamp) > 0 ? Number(d.timestamp) : Date.now(),
  };
}

/**
 * 현물 체결(match) 프레임 → 정규 Trade.
 *
 * 실제 프레임 (2026-08 확인):
 *   { price, size, side: 'buy'|'sell', time: '1786760454831000000', tradeId, symbol, … }
 *
 * ★★ `time` 은 **나노초 문자열**이다.
 *
 *   그대로 ms 로 쓰면 시각이 5천만 년 뒤가 된다. 화면이 "몇 초 전" 을 계산하면
 *   음수가 나오거나 정렬이 뒤집힌다. 1e6 으로 나눠야 ms 다.
 *   (선물 execution 도 나노초다 — 두 시장이 같은 함정을 공유한다)
 *
 * ★ side 는 **테이커 방향**이다. 'buy' 면 매수 테이커가 호가를 쳤다는 뜻이고,
 *   화면의 빨강/초록이 여기에 달려 있다. 반대로 읽으면 시장 압력을 거꾸로 본다.
 */
export function parseSpotTrade(
  topic: string,
  data: unknown,
): { symbol: string; id: string; price: string; size: string; side: 'buy' | 'sell'; ts: number } | null {
  const symbol = symbolFromSpotTopic(topic);
  if (!symbol || !data || typeof data !== 'object') return null;
  const d = data as { price?: string; size?: string; side?: string; time?: string | number; tradeId?: string; sequence?: string };
  const price = d.price;
  const size = d.size;
  if (price === undefined || size === undefined) return null;
  if (!Number.isFinite(Number(price)) || !Number.isFinite(Number(size))) return null;

  /*
     나노초 → ms. 값의 자릿수로 단위를 판별한다 — KuCoin 이 채널마다 단위를
     달리 쓰기 때문에, 하나로 가정하면 어느 한쪽이 조용히 틀린다.
  */
  const raw = Number(d.time);
  let ts = Date.now();
  if (Number.isFinite(raw) && raw > 0) {
    if (raw > 1e17) ts = Math.floor(raw / 1e6);        // 나노초
    else if (raw > 1e14) ts = Math.floor(raw / 1e3);   // 마이크로초
    else if (raw > 1e11) ts = raw;                     // 밀리초
    else ts = raw * 1000;                              // 초
  }

  return {
    symbol,
    id: String(d.tradeId ?? d.sequence ?? `${ts}`),
    price: String(price),
    size: String(size),
    side: d.side === 'sell' ? 'sell' : 'buy',
    ts,
  };
}
