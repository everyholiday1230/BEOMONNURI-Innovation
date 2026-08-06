/**
 * KuCoin 선물 공개 어댑터.
 *
 * @quantumtrade/exchange-adapters 의 세 인터페이스를 구현한다:
 *   IMarketDataProvider — 심볼 목록, 캔들, 티커, 캔들 스트림
 *   IOrderBookAdapter   — 호가 스냅샷 + 스트림
 *   ITradesAdapter      — 최근 체결 + 스트림
 *
 * 이 클래스가 있어야 apps/api 가 거래소를 갈아끼울 수 있다. BitMart 폐쇄 때처럼
 * 다시 갈아타야 할 일이 생기면 이 파일과 짝 파일들만 교체한다.
 *
 * 설계 결정 2가지:
 *
 *  1) 계약 사양(multiplier)을 캐시한다.
 *     수량을 계약 수에서 기초자산으로 바꾸려면 multiplier 가 필요하고, 그것 없이는
 *     오더북/체결/캔들의 수량을 정규화할 수 없다. 그래서 사양이 없으면 데이터를
 *     내보내지 않고, 필요 시 사양을 먼저 적재한다.
 *
 *  2) 24시간 통계는 contracts/active 한 번으로 전부 받는다.
 *     심볼별 getTicker 를 664번 도는 대신 1회 호출로 처리한다. allTickers 에는
 *     24h 필드가 없어서(실측) contracts/active 를 쓴다.
 */

import type { Timeframe } from '@quantumtrade/config';
import type {
  CandleQuery,
  IMarketDataProvider,
  IOrderBookAdapter,
  ITradesAdapter,
  Unsubscribe,
} from '@quantumtrade/exchange-adapters';
import type { Candle, OrderBook, SymbolInfo, Ticker, Trade } from '@quantumtrade/schemas';

import {
  inspectCandleContinuity,
  isContinuitySuspicious,
  mergeCandlePages,
  planKlinePages,
} from './klines.js';
import {
  normalizeInstrument,
  normalizeLiveTicker,
  normalizeOrderBook,
  normalizeRestCandles,
  normalizeTickerFromContract,
  normalizeTrade,
  normalizeTrades,
  normalizeWsCandle,
  type KucoinContract,
  type KucoinDepth,
  type KucoinInstrument,
  type KucoinTickerMsg,
  type KucoinTradeMsg,
} from './normalize.js';
import { KucoinApiError, KucoinFuturesRest, type KucoinRestConfig } from './rest.js';
import { UNSUPPORTED_SYMBOLS, toGranularity, toKucoinSymbol } from './symbols.js';
import {
  KucoinWsClient,
  createNodeSocketFactory,
  type ConnectionState,
  type SocketFactory,
} from './ws-client.js';
import { candleTopic, depth5Topic, executionTopic, tickerTopic } from './ws-protocol.js';

const DEFAULT_CANDLE_LIMIT = 220;
const MAX_CANDLE_LIMIT = 1000;

export interface KucoinAdapterConfig extends KucoinRestConfig {
  socketFactory?: SocketFactory;
  allowedWsHosts?: readonly string[];
  /** 연결 상태 변화 알림. 화면에 '실시간 여부'를 정직하게 표시하는 데 쓴다. */
  onConnectionState?: (state: ConnectionState, detail?: { attempt?: number; reason?: string }) => void;
  /** 진단 로그. 조용한 데이터 왜곡을 드러내기 위해 캔들 이상을 여기로 보낸다. */
  onDiagnostic?: (message: string, meta: Record<string, unknown>) => void;
}

export class KucoinFuturesAdapter implements IMarketDataProvider, IOrderBookAdapter, ITradesAdapter {
  readonly name = 'kucoin-futures';

  private readonly rest: KucoinFuturesRest;
  private readonly ws: KucoinWsClient | null;

  /** 내부심볼 -> 계약 사양 */
  private readonly instruments = new Map<string, KucoinInstrument>();
  /** KuCoin심볼 -> 내부심볼 */
  private readonly byExchangeSymbol = new Map<string, string>();
  /** 내부심볼 -> 최신 티커 (24h 필드 보존용) */
  private readonly tickers = new Map<string, Ticker>();

  private instrumentsLoadedAt = 0;
  private instrumentLoad: Promise<void> | null = null;

  /**
   * 채널별 구독자. 같은 심볼을 여러 소비자가 봐도 업스트림 구독은 1개다.
   * 키는 심볼(캔들은 `심볼|타임프레임`), 값은 리스너 집합.
   */
  private readonly candleListeners = new Map<string, Set<(c: Candle) => void>>();
  private readonly bookListeners = new Map<string, Set<(b: OrderBook) => void>>();
  private readonly tradeListeners = new Map<string, Set<(t: Trade) => void>>();
  private readonly tickerListeners = new Map<string, Set<(t: Ticker) => void>>();
  /** `채널:키` -> 업스트림 구독 해제 함수 */
  private readonly upstreamReleases = new Map<string, () => void>();

  constructor(private readonly cfg: KucoinAdapterConfig) {
    this.rest = new KucoinFuturesRest(cfg);

    const socketFactory = cfg.socketFactory;
    this.ws = socketFactory
      ? new KucoinWsClient({
          rest: this.rest,
          socketFactory,
          allowedHosts: cfg.allowedWsHosts,
          events: {
            onData: (frame) => this.handleWsData(frame),
            onState: (state, detail) => cfg.onConnectionState?.(state, detail),
            onUpstreamError: (code, message) =>
              cfg.onDiagnostic?.('KuCoin WS 오류', { code, message }),
          },
        })
      : null;
  }

  /** WS 를 쓰려면 명시적으로 시작한다. REST 만 쓰는 경로에서는 호출하지 않는다. */
  async startStreaming(): Promise<void> {
    if (!this.ws) {
      throw new Error('socketFactory 가 주입되지 않아 스트리밍을 시작할 수 없다');
    }
    await this.ws.start();
  }

  stopStreaming(): void {
    this.ws?.stop();
  }

  /**
   * 캐시된 계약 사양을 돌려준다. 네트워크를 타지 않는다.
   *
   * 계정 어댑터가 포지션 수량을 계약수 → 기초자산으로 바꿀 때 multiplier 가
   * 필요하다. 사양을 따로 조회하면 레이트리밋을 두 번 쓰고, 두 값이 어긋날
   * 수 있다. 이미 664심볼을 캐시하고 있으므로 그걸 공유한다.
   *
   * 아직 적재되지 않았으면 undefined 다 — 0 이나 1 을 돌려주면 수량이
   * 조용히 틀린다 (BTC 1계약 = 0.001 BTC).
   */
  getCachedSymbol(internalSymbol: string): KucoinInstrument | undefined {
    return this.instruments.get(internalSymbol);
  }

  getStatus() {
    return {
      exchange: this.name,
      instruments: this.instruments.size,
      instrumentsAgeMs: this.instrumentsLoadedAt ? Date.now() - this.instrumentsLoadedAt : null,
      breaker: this.rest.breakerState,
      stream: this.ws?.getStatus() ?? null,
      unsupported: [...UNSUPPORTED_SYMBOLS],
    };
  }

  // -------------------------------------------------------------------------
  // 계약 사양
  // -------------------------------------------------------------------------

  /**
   * 계약 사양을 적재한다. 동시에 여러 번 불려도 업스트림 호출은 1회로 합친다.
   * @param maxAgeMs 이보다 최근에 적재했다면 재사용한다.
   */
  private async ensureInstruments(maxAgeMs = 60_000, signal?: AbortSignal): Promise<void> {
    if (this.instruments.size > 0 && Date.now() - this.instrumentsLoadedAt < maxAgeMs) return;
    if (this.instrumentLoad) return this.instrumentLoad;

    this.instrumentLoad = (async () => {
      try {
        const raw = (await this.rest.getActiveContracts(signal)) as KucoinContract[];
        let added = 0;
        for (const contract of raw ?? []) {
          const instrument = normalizeInstrument(contract);
          if (!instrument) continue;
          if (!this.instruments.has(instrument.symbol)) added += 1;
          this.instruments.set(instrument.symbol, instrument);
          this.byExchangeSymbol.set(instrument.exchangeSymbol, instrument.symbol);

          const ticker = normalizeTickerFromContract(contract);
          if (!ticker) continue;
          // 실시간 last 는 WS 가 더 최신일 수 있으므로 24h 필드만 갱신한다.
          const prev = this.tickers.get(ticker.symbol);
          this.tickers.set(ticker.symbol, prev ? { ...ticker, last: prev.last } : ticker);
        }
        this.instrumentsLoadedAt = Date.now();
        if (added > 0) {
          this.cfg.onDiagnostic?.('KuCoin 계약 사양 적재', {
            total: this.instruments.size,
            added,
          });
        }
      } finally {
        this.instrumentLoad = null;
      }
    })();

    return this.instrumentLoad;
  }

  private requireInstrument(symbol: string): KucoinInstrument {
    const instrument = this.instruments.get(symbol.toUpperCase());
    if (!instrument) {
      throw new KucoinApiError(`계약 사양 미적재: ${symbol}`, { code: 'INSTRUMENT_UNKNOWN' });
    }
    return instrument;
  }

  /** 해당 심볼이 KuCoin 선물에서 지원되는지. */
  isSupported(symbol: string): boolean {
    const s = symbol.toUpperCase();
    return !UNSUPPORTED_SYMBOLS.has(s) && toKucoinSymbol(s) !== null;
  }

  // -------------------------------------------------------------------------
  // IMarketDataProvider
  // -------------------------------------------------------------------------

  async getSymbols(signal?: AbortSignal): Promise<SymbolInfo[]> {
    await this.ensureInstruments(60_000, signal);
    return [...this.instruments.values()].map((i) => i.info);
  }

  /**
   * 전 심볼 티커를 1회 업스트림 호출로 받는다.
   * 검증 실패한 행은 버리고 나머지를 반환한다 — 한 심볼의 이상 응답이
   * 마켓 화면 전체를 비우지 않게 하기 위함.
   */
  async getTickers(signal?: AbortSignal): Promise<Ticker[]> {
    // 티커는 자주 바뀌므로 짧은 TTL 로 강제 갱신한다.
    await this.ensureInstruments(5_000, signal);
    return [...this.tickers.values()];
  }

  async getTicker(symbol: string, signal?: AbortSignal): Promise<Ticker> {
    const s = symbol.toUpperCase();
    await this.ensureInstruments(5_000, signal);

    const exchangeSymbol = toKucoinSymbol(s);
    if (!exchangeSymbol) {
      throw new KucoinApiError(`KuCoin 선물 미상장 심볼: ${s}`, { code: 'SYMBOL_UNSUPPORTED' });
    }

    const cached = this.tickers.get(s);
    // 실시간 체결가로 last 를 갱신한다. 24h 필드는 cached 에서 보존된다.
    try {
      const raw = (await this.rest.getTicker(exchangeSymbol, signal)) as KucoinTickerMsg;
      const merged = normalizeLiveTicker(raw, cached);
      if (merged) {
        this.tickers.set(s, merged);
        return merged;
      }
    } catch (err) {
      if (!cached) throw err;
      this.cfg.onDiagnostic?.('KuCoin 실시간 티커 조회 실패 — 24h 스냅샷 사용', {
        symbol: s,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (cached) return cached;
    throw new KucoinApiError(`티커를 만들 수 없음: ${s}`, { code: 'TICKER_UNAVAILABLE' });
  }

  /**
   * 캔들 조회.
   *
   * KuCoin 은 from 기준 앞쪽 200행만 주고 to 를 무시한다. 그래서 200행 이하로
   * 쪼개 과거 방향으로 페이징한다. 자세한 근거는 klines.ts 주석 참조.
   */
  async getCandles(query: CandleQuery): Promise<Candle[]> {
    const symbol = query.symbol.toUpperCase();
    const limit = Math.min(MAX_CANDLE_LIMIT, Math.max(1, query.limit ?? DEFAULT_CANDLE_LIMIT));

    const exchangeSymbol = toKucoinSymbol(symbol);
    if (!exchangeSymbol) {
      throw new KucoinApiError(`KuCoin 선물 미상장 심볼: ${symbol}`, { code: 'SYMBOL_UNSUPPORTED' });
    }

    const granularity = toGranularity(query.timeframe);
    if (granularity === null) {
      // 5분봉을 3분봉이라고 돌려주지 않는다. 명시적으로 실패시킨다.
      throw new KucoinApiError(`KuCoin 이 지원하지 않는 타임프레임: ${query.timeframe}`, {
        code: 'TIMEFRAME_UNSUPPORTED',
      });
    }

    await this.ensureInstruments(300_000, query.signal);
    const instrument = this.requireInstrument(symbol);

    // `before` 가 오면 그 시점 이전 구간을 가져온다 (무한 스크롤 페이지네이션).
    const anchor = query.before && query.before > 0 ? query.before : Date.now();
    const pages = planKlinePages(granularity, limit, anchor);

    const results: Candle[][] = [];
    for (const page of pages) {
      try {
        const rows = await this.rest.getKlines(
          exchangeSymbol,
          granularity,
          page.from,
          page.to,
          query.signal,
        );
        const parsed = normalizeRestCandles(rows, instrument);
        // 상장 이전 구간에 도달하면 더 과거를 요청할 이유가 없다.
        if (parsed.length === 0) break;
        results.push(parsed);
      } catch (err) {
        // 첫 페이지 실패는 치명적이다. 이후 페이지 실패는 과거 구간만 짧아진다.
        if (results.length === 0) throw err;
        this.cfg.onDiagnostic?.('KuCoin 캔들 페이지 실패 — 받은 구간까지 사용', {
          symbol,
          timeframe: query.timeframe,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }

    const candles = mergeCandlePages(results, limit);

    // 페이징이 어긋나면 차트가 조용히 왜곡된다. 감지해서 드러낸다.
    const health = inspectCandleContinuity(candles, granularity);
    if (isContinuitySuspicious(health, candles.length, granularity)) {
      this.cfg.onDiagnostic?.('KuCoin 캔들 연속성 이상', {
        symbol,
        timeframe: query.timeframe,
        count: candles.length,
        gaps: health.gaps.length,
        maxGap: health.maxGap,
        totalMissing: health.totalMissing,
        staleMinutes: health.staleMs === null ? null : Math.round(health.staleMs / 60000),
      });
    }

    return candles;
  }

  subscribeCandles(symbol: string, timeframe: Timeframe, onCandle: (candle: Candle) => void): Unsubscribe {
    const s = symbol.toUpperCase();
    const exchangeSymbol = toKucoinSymbol(s);
    const topic = exchangeSymbol ? candleTopic(exchangeSymbol, timeframe) : null;
    if (!topic) return noop;
    return this.attach('candle', this.candleListeners, `${s}|${timeframe}`, topic, onCandle);
  }

  // -------------------------------------------------------------------------
  // IOrderBookAdapter
  // -------------------------------------------------------------------------

  async getSnapshot(symbol: string, depth = 20, signal?: AbortSignal): Promise<OrderBook> {
    const s = symbol.toUpperCase();
    const exchangeSymbol = toKucoinSymbol(s);
    if (!exchangeSymbol) {
      throw new KucoinApiError(`KuCoin 선물 미상장 심볼: ${s}`, { code: 'SYMBOL_UNSUPPORTED' });
    }

    await this.ensureInstruments(300_000, signal);
    const instrument = this.requireInstrument(s);

    const raw = (await (depth > 20
      ? this.rest.getDepth100(exchangeSymbol, signal)
      : this.rest.getDepth20(exchangeSymbol, signal))) as KucoinDepth;

    const book = normalizeOrderBook(raw, instrument, { isSnapshot: true });
    if (!book) {
      throw new KucoinApiError(`오더북 정규화 실패: ${s}`, { code: 'ORDERBOOK_INVALID' });
    }
    return {
      ...book,
      bids: book.bids.slice(0, depth),
      asks: book.asks.slice(0, depth),
    };
  }

  subscribeBook(symbol: string, onUpdate: (book: OrderBook) => void): Unsubscribe {
    const s = symbol.toUpperCase();
    const exchangeSymbol = toKucoinSymbol(s);
    if (!exchangeSymbol) return noop;
    return this.attach('book', this.bookListeners, s, depth5Topic(exchangeSymbol), onUpdate);
  }

  // -------------------------------------------------------------------------
  // ITradesAdapter
  // -------------------------------------------------------------------------

  async getRecent(symbol: string, limit = 60, signal?: AbortSignal): Promise<Trade[]> {
    const s = symbol.toUpperCase();
    const exchangeSymbol = toKucoinSymbol(s);
    if (!exchangeSymbol) {
      throw new KucoinApiError(`KuCoin 선물 미상장 심볼: ${s}`, { code: 'SYMBOL_UNSUPPORTED' });
    }

    await this.ensureInstruments(300_000, signal);
    const instrument = this.requireInstrument(s);

    const raw = (await this.rest.getTradeHistory(exchangeSymbol, signal)) as KucoinTradeMsg[];
    return normalizeTrades(raw, instrument)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, Math.max(1, limit));
  }

  subscribeTrades(symbol: string, onTrade: (trade: Trade) => void): Unsubscribe {
    const s = symbol.toUpperCase();
    const exchangeSymbol = toKucoinSymbol(s);
    if (!exchangeSymbol) return noop;
    return this.attach('trade', this.tradeListeners, s, executionTopic(exchangeSymbol), onTrade);
  }

  /** 심볼의 실시간 체결가 스트림. 헤더 가격 표시에 쓴다. */
  subscribeTicker(symbol: string, onTicker: (ticker: Ticker) => void): Unsubscribe {
    const s = symbol.toUpperCase();
    const exchangeSymbol = toKucoinSymbol(s);
    if (!exchangeSymbol) return noop;
    return this.attach('ticker', this.tickerListeners, s, tickerTopic(exchangeSymbol), onTicker);
  }

  // -------------------------------------------------------------------------
  // 구독 배선
  // -------------------------------------------------------------------------

  /**
   * 리스너를 등록하고 필요 시 업스트림 구독을 연다.
   * 마지막 리스너가 떠나면 업스트림 구독도 닫는다 — 안 그러면 아무도 보지 않는
   * 심볼의 트래픽이 계속 흘러 레이트리밋과 CPU 를 낭비한다.
   */
  private attach<T>(
    channel: 'candle' | 'book' | 'trade' | 'ticker',
    registry: Map<string, Set<(v: T) => void>>,
    key: string,
    topic: string,
    listener: (v: T) => void,
  ): Unsubscribe {
    const releaseKey = `${channel}:${key}`;

    let entry = registry.get(key);
    if (!entry) {
      entry = new Set();
      registry.set(key, entry);
      const release = this.ws?.subscribe(topic);
      if (release) this.upstreamReleases.set(releaseKey, release);
    }
    entry.add(listener);

    let released = false;
    return () => {
      if (released) return;
      released = true;

      const set = registry.get(key);
      if (!set) return;
      set.delete(listener);
      if (set.size > 0) return;

      registry.delete(key);
      const release = this.upstreamReleases.get(releaseKey);
      if (release) {
        release();
        this.upstreamReleases.delete(releaseKey);
      }
    };
  }

  // -------------------------------------------------------------------------
  // WS 데이터 라우팅
  // -------------------------------------------------------------------------

  private handleWsData(frame: {
    channel: string;
    exchangeSymbol: string;
    timeframe: Timeframe | null;
    data: unknown;
  }): void {
    const symbol = this.byExchangeSymbol.get(frame.exchangeSymbol);
    if (!symbol) return;
    const instrument = this.instruments.get(symbol);
    if (!instrument) return;

    switch (frame.channel) {
      case 'ticker': {
        const merged = normalizeLiveTicker(frame.data as KucoinTickerMsg, this.tickers.get(symbol));
        if (!merged) return;
        this.tickers.set(symbol, merged);
        emitAll(this.tickerListeners.get(symbol), merged);
        break;
      }
      case 'level2Depth5':
      case 'level2Depth50': {
        const book = normalizeOrderBook(frame.data as KucoinDepth, instrument);
        if (book) emitAll(this.bookListeners.get(symbol), book);
        break;
      }
      case 'execution': {
        const trade = normalizeTrade(frame.data as KucoinTradeMsg, instrument);
        if (trade) emitAll(this.tradeListeners.get(symbol), trade);
        break;
      }
      case 'limitCandle': {
        if (!frame.timeframe) return;
        const row = (frame.data as { candles?: Array<number | string> })?.candles;
        if (!Array.isArray(row)) return;
        const candle = normalizeWsCandle(row, instrument);
        if (candle) emitAll(this.candleListeners.get(`${symbol}|${frame.timeframe}`), candle);
        break;
      }
      default:
        break;
    }
  }
}

function emitAll<T>(listeners: Set<(v: T) => void> | undefined, value: T): void {
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      // 한 소비자의 예외가 다른 소비자에게 전파되지 않게 한다.
    }
  }
}

const noop: Unsubscribe = () => {};

export { createNodeSocketFactory };
