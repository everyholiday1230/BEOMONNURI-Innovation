/* ============================================================
   KuCoin 현물(Spot) 시세 어댑터
   ------------------------------------------------------------
   왜 별도 어댑터인가 — 선물 코드를 재사용할 수 없는 이유

   ★★ 현물과 선물은 **다른 API 이고 다른 데이터 모형**이다.

     선물                                  현물
     ────────────────────────────────────  ─────────────────────────────────
     api-futures.kucoin.com                api.kucoin.com
     심볼 XBTUSDTM (BTC 는 XBT)             심볼 BTC-USDT (하이픈)
     수량 = 계약 수 × multiplier            수량 = 기초자산 그대로
     레버리지·증거금·펀딩 있음               없음
     kline: [ms, o,h,l,c, volContracts…]   candles: [sec, o,c,h,l, vol, turnover]

     특히 **캔들 배열의 순서가 다르다**(현물은 o,c,h,l — close 가 두 번째다).
     선물 파서를 그대로 쓰면 고가·저가·종가가 뒤섞인 차트가 그려지고, 그것은
     "값이 조금 이상한" 정도가 아니라 이용자가 그 차트를 보고 주문을 낸다.

   ★ 현물은 **응답이 최신 순(내림차순)** 이다. 선물은 오름차순이다.
     정렬을 맞추지 않으면 차트가 좌우로 뒤집힌다.

   ★ 현물에는 승수(multiplier)가 없다. 그래서 "승수를 모르면 주문을 보내지
     않는다" 는 선물의 불변식이 현물에는 적용되지 않는다 — 대신 stepSize/minQty 를
     지켜야 한다.

   범위
     이 파일은 **시세만** 다룬다(심볼·캔들·티커). 주문은 별도 어댑터가 필요하고,
     그때까지 현물 주문 경로는 열지 않는다. 시세만 되는 상태를 "현물 지원" 이라고
     말하지 않기 위해, 모드 정의에서 주문 경로는 계속 null 로 둔다.
   ============================================================ */

import {
  CandleSchema,
  SymbolSchema,
  TickerSchema,
  type Candle,
  type SymbolInfo,
  type Ticker,
} from '@quantumtrade/schemas';

/*
   현물 REST 기준 주소는 브로커 정산 클라이언트와 같은 도메인이다.
   두 곳에 같은 상수를 두면 한쪽만 고쳐서 어긋난다 — 한 곳에서 가져온다.
*/
import { DEFAULT_KUCOIN_SPOT_REST } from './broker-rest.js';
import { KucoinWsClient, type SocketFactory } from './ws-client.js';
import {
  createSpotBulletProvider,
  parseSpotBook,
  parseSpotCandle,
  parseSpotTicker,
  parseSpotTrade,
  spotCandleTopic,
  spotDepth5Topic,
  spotMatchTopic,
  spotTickerTopic,
} from './spot-ws.js';

export { DEFAULT_KUCOIN_SPOT_REST };

/**
 * 우리 표기(BTCUSDT) ↔ KuCoin 현물 표기(BTC-USDT).
 *
 * ★ 선물의 XBT 치환을 여기서 하면 안 된다. 현물은 BTC 를 그대로 쓴다.
 *   두 시장의 심볼 규칙을 한 함수에 섞으면 어느 쪽이 틀렸는지 알 수 없게 된다.
 */
export function toSpotSymbol(id: string): string {
  const s = String(id).toUpperCase().replace(/[-_]/g, '');
  // 뒤에서부터 알려진 견적통화를 떼어 낸다 (USDT 가 USD 보다 먼저 검사되어야 한다).
  for (const quote of ['USDT', 'USDC', 'BTC', 'ETH', 'KCS', 'TRX', 'DAI', 'EUR', 'USD']) {
    if (s.length > quote.length && s.endsWith(quote)) {
      return `${s.slice(0, s.length - quote.length)}-${quote}`;
    }
  }
  return s;
}

/** KuCoin 현물 표기(BTC-USDT) → 우리 표기(BTCUSDT). */
export function fromSpotSymbol(symbol: string): string {
  return String(symbol).toUpperCase().replace('-', '');
}

/**
 * 시간대 → KuCoin 현물 `type` 값.
 *
 * ★ 현물은 분 단위 문자열을 쓴다(`15min`), 선물은 분 숫자를 쓴다(`15`).
 *   같은 표를 공유하면 한쪽이 조용히 400 을 받는다.
 */
const SPOT_TF: Record<string, string> = {
  '1m': '1min',
  '3m': '3min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1hour',
  '1H': '1hour',
  '2h': '2hour',
  '4h': '4hour',
  '4H': '4hour',
  '6h': '6hour',
  '8h': '8hour',
  '12h': '12hour',
  '1d': '1day',
  '1D': '1day',
  '1w': '1week',
  '1W': '1week',
};

/** 시간대의 길이(초). `startAt` 을 계산할 때 쓴다. */
const TF_SECONDS: Record<string, number> = {
  '1min': 60,
  '3min': 180,
  '5min': 300,
  '15min': 900,
  '30min': 1800,
  '1hour': 3600,
  '2hour': 7200,
  '4hour': 14400,
  '6hour': 21600,
  '8hour': 28800,
  '12hour': 43200,
  '1day': 86400,
  '1week': 604800,
};

export interface KucoinSpotAdapterOptions {
  restBase?: string;
  /** 요청 타임아웃(ms). 느린 응답을 무한히 기다리면 화면이 영원히 로딩 상태가 된다. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * WS 소켓 구현. 주입하지 않으면 **스트리밍을 제공하지 않는다.**
   *
   * ★ 없을 때 조용히 아무것도 하지 않는 구독을 돌려주면, 화면은 실시간이라고
   *   믿으며 영원히 기다린다. 그래서 supportsStreaming 이 이 값의 유무를 그대로
   *   반영한다.
   */
  socketFactory?: SocketFactory;
  /** 연결 상태 변화 알림(진단·로그용). */
  onConnectionState?: (state: string, detail?: unknown) => void;
}

interface SpotSymbolRow {
  symbol?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  baseIncrement?: string;
  priceIncrement?: string;
  baseMinSize?: string;
  enableTrading?: boolean;
}

interface SpotStatsRow {
  symbol?: string;
  last?: string | null;
  changeRate?: string | null;
  high?: string | null;
  low?: string | null;
  vol?: string | null;
  volValue?: string | null;
}

/** 소수 자릿수. '0.00001' → 5. 정밀도 규칙이 주문 검증의 근거이므로 정확해야 한다. */
function decimalsOf(increment: string | undefined): number {
  const v = String(increment ?? '').trim();
  if (!v || !v.includes('.')) return 0;
  const frac = v.split('.')[1] ?? '';
  // 뒤쪽 0 은 자릿수가 아니다 ('0.10' 은 1자리).
  return frac.replace(/0+$/, '').length;
}

export class KucoinSpotAdapter {
  readonly name = 'kucoin_spot';

  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  /** 심볼 캐시. 목록은 자주 바뀌지 않는데 매 요청마다 받으면 한도를 태운다. */
  private symbolCache: { at: number; rows: SymbolInfo[] } | null = null;
  private static readonly SYMBOL_TTL_MS = 10 * 60 * 1000;

  /*
     WS 클라이언트. socketFactory 를 주입하지 않으면 만들지 않는다 —
     "스트리밍이 있다" 고 말할 수 없는 상태를 코드로 보장한다.
  */
  private ws: KucoinWsClient | null = null;
  /** 심볼 → 티커 구독자. 여러 화면이 같은 심볼을 봐도 업스트림 구독은 하나다. */
  private readonly tickerSubs = new Map<string, Set<(t: Partial<Ticker> & { symbol: string }) => void>>();
  /** `심볼|주기` → 캔들 구독자. */
  private readonly candleSubs = new Map<string, Set<(c: Candle) => void>>();
  /** 심볼 → 호가 구독자. */
  private readonly bookSubs = new Map<string, Set<(b: unknown) => void>>();
  /** 심볼 → 체결 구독자. */
  private readonly tradeSubs = new Map<string, Set<(t: unknown) => void>>();
  /** topic → 업스트림 해제 함수. */
  private readonly releases = new Map<string, () => void>();

  constructor(opts: KucoinSpotAdapterOptions = {}) {
    this.base = (opts.restBase ?? DEFAULT_KUCOIN_SPOT_REST).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.doFetch = opts.fetchImpl ?? fetch;

    if (opts.socketFactory) {
      this.ws = new KucoinWsClient({
        /*
           ★ bullet 은 **현물 도메인**에서 받아야 한다. 선물 토큰으로 현물
             엔드포인트에 붙으면 연결은 되지만 구독이 되지 않는다 — 화면은
             실시간이라고 믿으며 아무것도 받지 못한다.
        */
        rest: createSpotBulletProvider({ restBase: this.base, fetchImpl: this.doFetch }) as never,
        socketFactory: opts.socketFactory,
        events: {
          onData: (frame) => this.routeFrame(frame.topic, frame.data),
          onState: (state, detail) => opts.onConnectionState?.(state, detail),
          onUpstreamError: (code, message) => opts.onConnectionState?.('upstream_error', { code, message }),
        },
      });
    }
  }

  /** 프레임을 구독자에게 전달한다. 파싱 실패는 조용히 버린다(한 프레임이 스트림을 끊지 않는다). */
  private routeFrame(topic: string, data: unknown): void {
    if (topic.includes('/candles:')) {
      const parsed = parseSpotCandle(data);
      if (!parsed) return;
      // 토픽의 주기 접미어로 어느 구독인지 정한다.
      const suffix = topic.split('_')[1] ?? '';
      for (const [key, subs] of this.candleSubs) {
        const [sym, tf] = key.split('|');
        if (sym !== parsed.symbol) continue;
        if (spotCandleTopic(sym!, tf!) !== topic && !topic.endsWith(`_${suffix}`)) continue;
        subs.forEach((fn) => { try { fn(parsed.candle); } catch { /* 한 구독자 오류가 나머지를 막지 않는다 */ } });
      }
      return;
    }
    if (topic.includes('/ticker:')) {
      const parsed = parseSpotTicker(topic, data);
      if (!parsed) return;
      const subs = this.tickerSubs.get(parsed.symbol);
      subs?.forEach((fn) => { try { fn(parsed); } catch { /* noop */ } });
      return;
    }
    if (topic.includes('level2Depth')) {
      const parsed = parseSpotBook(topic, data);
      if (!parsed) return;
      const subs = this.bookSubs.get(parsed.symbol);
      subs?.forEach((fn) => { try { fn(parsed); } catch { /* noop */ } });
      return;
    }
    if (topic.includes('/match:')) {
      const parsed = parseSpotTrade(topic, data);
      if (!parsed) return;
      const subs = this.tradeSubs.get(parsed.symbol);
      subs?.forEach((fn) => { try { fn(parsed); } catch { /* noop */ } });
    }
  }

  /**
   * 구독자 집합을 관리하는 공통 부분.
   *
   * ★ 여러 화면이 같은 심볼을 봐도 업스트림 구독은 하나다. 화면마다 구독하면
   *   KuCoin 한도를 금방 태우고, 마지막 화면이 닫힐 때 끊는 시점을 알 수 없다.
   */
  private addSub<T>(
    store: Map<string, Set<(v: T) => void>>,
    key: string,
    topic: string,
    cb: (v: T) => void,
  ): () => void {
    if (!this.ws) return () => {};
    if (!store.has(key)) store.set(key, new Set());
    store.get(key)!.add(cb);
    if (!this.releases.has(topic)) this.releases.set(topic, this.ws.subscribe(topic));
    return () => {
      const set = store.get(key);
      set?.delete(cb);
      if (set && set.size === 0) {
        store.delete(key);
        // 마지막 구독자가 떠나면 업스트림도 끊는다.
        const release = this.releases.get(topic);
        if (release) { try { release(); } catch { /* noop */ } this.releases.delete(topic); }
      }
    };
  }

  /**
   * 호가 구독.
   *
   * ★★ 5단만 온다(level2Depth5). 화면이 18행을 그리는 자리에 5행이 오면 나머지가
   *   비는데, **빈 줄을 0 으로 채우면 "그 가격에 물량이 없다" 는 거짓**이 된다.
   *   호출자가 받은 만큼만 그려야 한다.
   */
  subscribeBook(symbol: string, cb: (b: unknown) => void): () => void {
    const key = String(symbol).toUpperCase();
    return this.addSub(this.bookSubs, key, spotDepth5Topic(key), cb);
  }

  /** 체결 구독. side 는 테이커 방향이다. */
  subscribeTrades(symbol: string, cb: (t: unknown) => void): () => void {
    const key = String(symbol).toUpperCase();
    return this.addSub(this.tradeSubs, key, spotMatchTopic(key), cb);
  }

  /** 스트림을 시작한다. socketFactory 가 없으면 아무것도 하지 않는다. */
  async startStreaming(): Promise<void> {
    if (this.ws) await this.ws.start();
  }

  stopStreaming(): void {
    this.ws?.stop();
    this.releases.forEach((r) => { try { r(); } catch { /* noop */ } });
    this.releases.clear();
  }

  /**
   * 티커 구독.
   *
   * ★★ 현물 ticker 프레임에는 **24시간 변동률이 없다.** 그래서 부분 갱신
   *   (last/bid/ask)만 전달한다. 호출자가 이것을 전체 티커로 덮어쓰면 변동률이
   *   사라져 모든 종목이 "변동 없음" 으로 보인다.
   */
  subscribeTicker(symbol: string, cb: (t: Partial<Ticker> & { symbol: string }) => void): () => void {
    const key = String(symbol).toUpperCase();
    if (!this.tickerSubs.has(key)) this.tickerSubs.set(key, new Set());
    this.tickerSubs.get(key)!.add(cb);

    const topic = spotTickerTopic(key);
    if (this.ws && !this.releases.has(topic)) {
      this.releases.set(topic, this.ws.subscribe(topic));
    }
    return () => {
      const set = this.tickerSubs.get(key);
      set?.delete(cb);
      if (set && set.size === 0) {
        this.tickerSubs.delete(key);
        // 마지막 구독자가 떠나면 업스트림도 끊는다(쓰지 않는 토픽을 유지하지 않는다).
        const release = this.releases.get(topic);
        if (release) { try { release(); } catch { /* noop */ } this.releases.delete(topic); }
      }
    };
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    /*
       호출자의 취소와 우리 타임아웃을 함께 존중한다. 호출자 신호만 보면 응답이
       오지 않는 경우를 못 끊고, 우리 것만 보면 화면을 떠난 뒤에도 계속 받는다.
    */
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await this.doFetch(`${this.base}${path}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`kucoin spot ${path} → HTTP ${res.status}`);
      const body = (await res.json()) as { code?: string; data?: T; msg?: string };
      /*
         KuCoin 은 HTTP 200 에 code 로 실패를 알린다. code 를 보지 않으면
         실패를 빈 데이터로 오해해 "종목이 없다" 로 화면에 그린다.
      */
      if (body.code && body.code !== '200000') {
        throw new Error(`kucoin spot ${path} → code ${body.code} ${body.msg ?? ''}`.trim());
      }
      if (body.data === undefined || body.data === null) {
        throw new Error(`kucoin spot ${path} → empty data`);
      }
      return body.data;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * 거래 가능한 USDT 현물 심볼 목록.
   *
   * ★ `enableTrading === false` 는 제외한다. 거래할 수 없는 종목을 목록에 넣으면
   *   이용자가 고른 뒤에야 주문이 거부된다.
   */
  async getSymbols(signal?: AbortSignal): Promise<SymbolInfo[]> {
    const now = Date.now();
    if (this.symbolCache && now - this.symbolCache.at < KucoinSpotAdapter.SYMBOL_TTL_MS) {
      return this.symbolCache.rows;
    }
    const rows = await this.get<SpotSymbolRow[]>('/api/v2/symbols', signal);
    const out: SymbolInfo[] = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || r.enableTrading === false) continue;
      const base = String(r.baseCurrency ?? '').toUpperCase();
      const quote = String(r.quoteCurrency ?? '').toUpperCase();
      if (!base || !quote) continue;
      const parsed = SymbolSchema.safeParse({
        id: `${base}${quote}`,
        base,
        quote,
        contractType: 'spot',
        pricePrecision: decimalsOf(r.priceIncrement),
        quantityPrecision: decimalsOf(r.baseIncrement),
        tickSize: String(r.priceIncrement ?? '0'),
        stepSize: String(r.baseIncrement ?? '0'),
        minQty: String(r.baseMinSize ?? '0'),
        /*
           현물에는 레버리지가 없다. 스키마가 양수를 요구하므로 1 을 쓴다 —
           "1배" 는 레버리지 없음과 같은 뜻이고, 0 은 스키마가 거부한다.
        */
        maxLeverage: 1,
      });
      // 한 종목의 형식 오류가 목록 전체를 비우지 않게 한다.
      if (parsed.success) out.push(parsed.data);
    }
    this.symbolCache = { at: now, rows: out };
    return out;
  }

  async getCandles(query: {
    symbol: string;
    timeframe: string;
    limit?: number;
    before?: number;
  }): Promise<Candle[]> {
    const type = SPOT_TF[String(query.timeframe)];
    if (!type) throw new Error(`unsupported spot timeframe ${query.timeframe}`);
    const limit = Math.min(Math.max(Number(query.limit ?? 300), 1), 1500);
    const sec = TF_SECONDS[type] ?? 60;

    /*
       KuCoin 현물은 startAt/endAt(초)로 구간을 받고 최대 1500개를 준다.
       개수만 주는 파라미터가 없어서, 원하는 개수에서 구간을 계산한다.
    */
    const endAt = Math.floor((query.before ? Number(query.before) : Date.now()) / 1000);
    const startAt = endAt - sec * limit;
    const sym = toSpotSymbol(query.symbol);
    const rows = await this.get<string[][]>(
      `/api/v1/market/candles?type=${type}&symbol=${encodeURIComponent(sym)}`
      + `&startAt=${startAt}&endAt=${endAt}`,
    );

    const out: Candle[] = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      /*
         ★★ 현물 배열 순서: [time(초), open, close, high, low, volume, turnover]

           선물은 [ms, open, high, low, close, …] 다. close 와 high 의 자리가
           다르다. 이 순서를 틀리면 캔들의 몸통과 꼬리가 뒤바뀐 차트가 그려지고,
           이용자는 그 차트를 보고 주문을 낸다.
      */
      if (!Array.isArray(r) || r.length < 6) continue;
      const parsed = CandleSchema.safeParse({
        time: Number(r[0]) * 1000,
        open: String(r[1]),
        close: String(r[2]),
        high: String(r[3]),
        low: String(r[4]),
        volume: String(r[5]),
        closed: true,
      });
      if (parsed.success) out.push(parsed.data);
    }
    /*
       ★ 현물 응답은 최신 순이다. 차트는 오래된 것부터 필요하다.
         정렬하지 않으면 좌우가 뒤집힌 차트가 나온다.
    */
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  async getTicker(symbol: string, signal?: AbortSignal): Promise<Ticker> {
    const sym = toSpotSymbol(symbol);
    const d = await this.get<SpotStatsRow>(
      `/api/v1/market/stats?symbol=${encodeURIComponent(sym)}`,
      signal,
    );
    const t = this.toTicker(d, fromSpotSymbol(sym));
    if (!t) throw new Error(`kucoin spot ticker ${sym} → invalid payload`);
    return t;
  }

  /** 전체 티커를 한 번에. 종목마다 요청하면 한도를 금방 태운다. */
  async getTickers(signal?: AbortSignal): Promise<Ticker[]> {
    const d = await this.get<{ ticker?: SpotStatsRow[] }>('/api/v1/market/allTickers', signal);
    const rows = Array.isArray(d?.ticker) ? d.ticker : [];
    const out: Ticker[] = [];
    for (const r of rows) {
      const id = fromSpotSymbol(String(r.symbol ?? ''));
      const t = this.toTicker(r, id);
      if (t) out.push(t);
    }
    return out;
  }

  private toTicker(r: SpotStatsRow | undefined, id: string): Ticker | null {
    if (!r || !id) return null;
    const last = r.last;
    if (last === null || last === undefined || last === '') return null;
    /*
       changeRate 는 비율(0.0123)이다. 화면은 퍼센트를 쓴다.
       100 을 곱하지 않으면 1.23% 가 0.0123% 로 보인다.
    */
    const rate = Number(r.changeRate);
    const parsed = TickerSchema.safeParse({
      symbol: id,
      last: String(last),
      changePct: Number.isFinite(rate) ? rate * 100 : 0,
      high24h: r.high ? String(r.high) : undefined,
      low24h: r.low ? String(r.low) : undefined,
      /*
         현물의 vol 은 기초자산 수량, volValue 는 견적통화 금액이다.
         화면은 금액으로 비교하므로 volValue 를 쓴다 — 수량을 쓰면
         가격이 낮은 종목이 거래대금 1위로 올라간다.
      */
      vol24h: r.volValue ? String(r.volValue) : undefined,
    });
    return parsed.success ? parsed.data : null;
  }

  /**
   * 실시간 캔들 스트림.
   *
   * ★ 지원하지 않는 주기면 **구독하지 않고** 빈 해제 함수를 돌려준다. 임의 주기로
   *   구독하면 KuCoin 이 아무 응답도 주지 않고, 화면은 실시간이라고 믿으며 기다린다.
   */
  subscribeCandles(symbol: string, timeframe: string, onCandle: (c: Candle) => void): () => void {
    const sym = String(symbol).toUpperCase();
    const topic = spotCandleTopic(sym, timeframe);
    if (!topic || !this.ws) return () => {};

    const key = `${sym}|${timeframe}`;
    if (!this.candleSubs.has(key)) this.candleSubs.set(key, new Set());
    this.candleSubs.get(key)!.add(onCandle);
    if (!this.releases.has(topic)) this.releases.set(topic, this.ws.subscribe(topic));

    return () => {
      const set = this.candleSubs.get(key);
      set?.delete(onCandle);
      if (set && set.size === 0) {
        this.candleSubs.delete(key);
        const release = this.releases.get(topic);
        if (release) { try { release(); } catch { /* noop */ } this.releases.delete(topic); }
      }
    };
  }

  /**
   * 스트리밍 지원 여부. 화면이 "실시간" 이라고 표시할지 판단하는 근거다.
   *
   * ★ socketFactory 를 주입하지 않으면 false 다. 값을 고정하지 않는 이유:
   *   소켓 구현이 없는 환경(테스트·일부 배포)에서 true 라고 말하면 화면이
   *   오지 않는 데이터를 기다린다.
   */
  get supportsStreaming(): boolean {
    return this.ws !== null;
  }
}
