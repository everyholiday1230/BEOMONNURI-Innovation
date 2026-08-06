/**
 * 마켓 서비스.
 *
 * 하나의 프로세스에서 업스트림 연결을 1개만 유지하고, 여러 브라우저 클라이언트에
 * 팬아웃한다. 브라우저가 KuCoin 을 직접 호출하면 IP 레이트리밋에 즉시 걸리고
 * 브로커 자격증명도 노출되므로, 반드시 이 계층을 통한다.
 *
 * 상태:
 *  - instruments: 계약 사양 캐시 (multiplier 등). 정규화에 필수.
 *  - tickers:     심볼별 최신 티커 (24h 통계 포함)
 *  - books:       심볼별 최신 오더북
 *  - trades:      심볼별 최근 체결 링버퍼
 *  - candles:     symbol|tf 별 캔들 캐시
 */

import { EventEmitter } from 'node:events';

import { config } from '../config.js';
import { log } from '../log.js';
import * as rest from '../exchanges/kucoin/rest.js';
import * as adapter from '../exchanges/kucoin/adapter.js';
import { KucoinWsManager, topics } from '../exchanges/kucoin/ws.js';
import {
  inspectCandleContinuity,
  mergeCandlePages,
  planKlinePages,
} from '../exchanges/kucoin/klines.js';
import {
  UNSUPPORTED,
  toGranularity,
  toKucoin,
  toInternal,
  toWsCandleSuffix,
} from '../exchanges/kucoin/symbols.js';

const TRADE_BUFFER = 100;

export class MarketService extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);

    /** @type {Map<string, import('../exchanges/kucoin/adapter.js').Instrument>} 내부심볼 -> 사양 */
    this.instruments = new Map();
    /** KuCoin심볼 -> 내부심볼 */
    this.byExchangeSymbol = new Map();

    this.tickers = new Map();
    this.books = new Map();
    this.trades = new Map();
    /** `${symbol}|${tf}` -> { candles, fetchedAt } */
    this.candles = new Map();

    this.ws = new KucoinWsManager();
    this.connectionState = 'connecting';

    /** 심볼별 업스트림 구독 해제 함수 묶음 */
    this.streamHandles = new Map();
    /** `${symbol}|${tf}` -> 해제 함수 */
    this.candleHandles = new Map();

    this.refreshTimer = null;
    this.ready = false;
  }

  // -------------------------------------------------------------------------
  // 부팅
  // -------------------------------------------------------------------------

  async start() {
    await this.refreshInstruments();

    this.ws.on('state', ({ state }) => {
      this.connectionState = state;
      this.emit('connection', { state });
    });
    this.ws.on('data', (msg) => this.handleUpstream(msg));

    await this.ws.start();

    // contracts/active 하나가 계약 사양과 24h 통계를 모두 담고 있어서
    // 타이머 하나로 둘을 함께 갱신한다. 664개 심볼이 1회 요청으로 처리된다.
    // KuCoin 레이트리밋은 IP당 12회/2초이므로 5초 주기는 여유가 크다.
    this.refreshTimer = setInterval(
      () =>
        this.refreshInstruments().catch((e) =>
          log.warn('계약 사양 갱신 실패', { error: String(e?.message || e) }),
        ),
      Math.max(3000, config.market.tickerRefreshMs),
    );
    this.refreshTimer.unref?.();

    this.ready = true;
    log.info('마켓 서비스 시작', { instruments: this.instruments.size });
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.ws.stop();
    this.ready = false;
  }

  /**
   * contracts/active 를 읽어 계약 사양과 24h 티커를 동시에 갱신한다.
   * 이 엔드포인트 하나가 multiplier/tickSize 와 high/low/chgPct/turnover 를 모두 담고 있다.
   */
  async refreshInstruments() {
    const raw = await rest.getActiveContracts();
    let added = 0;

    for (const c of raw) {
      const instrument = adapter.normalizeInstrument(c);
      if (!instrument) continue;

      if (!this.instruments.has(instrument.symbol)) added += 1;
      this.instruments.set(instrument.symbol, instrument);
      this.byExchangeSymbol.set(instrument.exchangeSymbol, instrument.symbol);

      const ticker = adapter.normalizeTickerFromContract(c);
      if (!ticker) continue;

      // WS 로 들어온 더 최신인 last/bid/ask 는 보존하고 24h 필드만 덮어쓴다.
      const prev = this.tickers.get(ticker.symbol);
      this.tickers.set(ticker.symbol, {
        ...ticker,
        last: prev?.last || ticker.last,
        prev: prev?.prev ?? ticker.last,
        bid: prev?.bid ?? 0,
        ask: prev?.ask ?? 0,
      });
    }

    if (added) log.info('계약 사양 로드', { total: this.instruments.size, added });
    return this.instruments.size;
  }

  // -------------------------------------------------------------------------
  // 조회
  // -------------------------------------------------------------------------

  getInstrument(symbol) {
    return this.instruments.get(String(symbol || '').toUpperCase()) || null;
  }

  /** 특정 심볼 목록의 티커. 지정 없으면 전체. */
  listTickers(symbols) {
    if (!symbols || symbols.length === 0) return [...this.tickers.values()];
    return symbols
      .map((s) => this.tickers.get(String(s).toUpperCase()))
      .filter(Boolean);
  }

  getTicker(symbol) {
    return this.tickers.get(String(symbol || '').toUpperCase()) || null;
  }

  getOrderBook(symbol) {
    return this.books.get(String(symbol || '').toUpperCase()) || null;
  }

  getTrades(symbol, limit = 60) {
    const list = this.trades.get(String(symbol || '').toUpperCase()) || [];
    return list.slice(0, limit);
  }

  isSupported(symbol) {
    const s = String(symbol || '').toUpperCase();
    if (UNSUPPORTED.has(s)) return false;
    return this.instruments.has(s);
  }

  /** 프론트엔드가 지원하지 않는 심볼을 구분할 수 있게 목록으로 알려준다. */
  listUnsupported() {
    return [...UNSUPPORTED];
  }

  // -------------------------------------------------------------------------
  // 캔들
  // -------------------------------------------------------------------------

  /**
   * 캔들 조회. TTL 내면 캐시를 반환한다.
   * @returns {Promise<Array>} 시간 오름차순 캔들
   */
  async fetchCandles(symbol, timeframe, limit = config.market.klineLimit) {
    const sym = String(symbol || '').toUpperCase();
    const instrument = this.getInstrument(sym);
    const exSymbol = toKucoin(sym);
    const granularity = toGranularity(timeframe);

    if (!instrument || !exSymbol || !granularity) {
      const reason = !exSymbol
        ? 'KuCoin 선물 미상장 심볼'
        : !granularity
          ? '지원하지 않는 타임프레임'
          : '계약 사양 미로드';
      const err = new Error(reason);
      err.status = 400;
      err.detail = { symbol: sym, timeframe };
      throw err;
    }

    const key = `${sym}|${timeframe}`;
    const cached = this.candles.get(key);
    if (cached && Date.now() - cached.fetchedAt < config.market.candleTtlMs) {
      return cached.candles;
    }

    // KuCoin 은 from 기준 앞쪽 200행만 주고 to 를 무시한다.
    // 넓은 범위를 한 번에 요청하면 "가장 오래된 200개"가 와서 최신 캔들이 없다.
    // 따라서 200행 이하로 쪼개 과거 방향으로 페이징한다. (klines.js 주석 참조)
    const pages = planKlinePages(granularity, limit, Date.now());
    const results = [];

    for (const page of pages) {
      let rows;
      try {
        rows = await rest.getKlines(exSymbol, granularity, page.from, page.to);
      } catch (err) {
        // 첫 페이지가 실패하면 캔들을 만들 수 없다. 그 뒤 페이지 실패는
        // 과거 구간만 짧아지는 것이므로 이미 받은 것으로 진행한다.
        if (results.length === 0) throw err;
        log.warn('캔들 페이지 요청 실패 — 받은 구간까지만 사용', {
          symbol: sym,
          timeframe,
          error: String(err?.message || err),
        });
        break;
      }

      const parsed = adapter.normalizeRestCandles(rows, instrument);
      if (parsed.length === 0) break; // 상장 이전 구간에 도달
      results.push(parsed);
    }

    const candles = mergeCandlePages(results, limit);

    // 페이징이 어긋나면 차트가 조용히 왜곡된다. 감지해서 로그로 남긴다.
    //
    // 단, 체결이 없는 구간은 거래소가 캔들을 아예 생략한다(특히 1분봉).
    // 그건 정상이므로 소수의 구멍은 경고하지 않는다. 페이징 버그는 구멍이
    // 대량으로 생기거나 마지막 캔들이 크게 뒤처지는 형태로 나타난다.
    const health = inspectCandleContinuity(candles, granularity);
    const gapBudget = Math.max(3, Math.ceil(candles.length * 0.05));
    const staleBudget = granularity * 60 * 1000 * 5;
    const suspicious =
      health.gaps.length > gapBudget ||
      (health.staleMs !== null && health.staleMs > staleBudget);

    if (suspicious) {
      log.warn('캔들 연속성 이상 — 페이징 또는 업스트림 확인 필요', {
        symbol: sym,
        timeframe,
        count: candles.length,
        gaps: health.gaps.length,
        gapBudget,
        staleMinutes: health.staleMs === null ? null : Math.round(health.staleMs / 60000),
      });
    }

    this.candles.set(key, { candles, fetchedAt: Date.now() });
    return candles;
  }

  /** WS 로 들어온 진행 중 캔들을 캐시에 병합한다. */
  mergeLiveCandle(symbol, timeframe, candle) {
    const key = `${symbol}|${timeframe}`;
    const entry = this.candles.get(key);
    if (!entry) return;

    const list = entry.candles;
    const last = list[list.length - 1];

    if (last && last.time === candle.time) {
      list[list.length - 1] = candle;
    } else if (!last || candle.time > last.time) {
      list.push(candle);
      if (list.length > config.market.klineLimit * 2) list.shift();
    }
    // 진행 중 캔들이 반영되었으므로 TTL 을 새로 잡지 않는다.
    // (확정 캔들은 다음 REST 갱신에서 정정된다)
  }

  // -------------------------------------------------------------------------
  // 스트림 구독
  // -------------------------------------------------------------------------

  /**
   * 심볼의 ticker/depth/execution 스트림을 구독한다. 참조 카운팅된다.
   * @returns {function} 해제 함수
   */
  subscribeSymbol(symbol) {
    const sym = String(symbol || '').toUpperCase();
    const exSymbol = toKucoin(sym);
    if (!exSymbol) return () => {};

    const existing = this.streamHandles.get(sym);
    if (existing) {
      existing.refs += 1;
    } else {
      const releases = [
        this.ws.subscribe(topics.ticker(exSymbol)),
        this.ws.subscribe(topics.depth5(exSymbol)),
        this.ws.subscribe(topics.execution(exSymbol)),
      ];
      this.streamHandles.set(sym, { refs: 1, releases });

      // 스냅샷을 즉시 채워 첫 화면이 비지 않게 한다.
      this.primeSnapshot(sym).catch((err) =>
        log.debug('스냅샷 초기화 실패', { symbol: sym, error: String(err?.message || err) }),
      );
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const h = this.streamHandles.get(sym);
      if (!h) return;
      h.refs -= 1;
      if (h.refs <= 0) {
        h.releases.forEach((fn) => fn());
        this.streamHandles.delete(sym);
      }
    };
  }

  /** 캔들 스트림 구독. */
  subscribeCandles(symbol, timeframe) {
    const sym = String(symbol || '').toUpperCase();
    const exSymbol = toKucoin(sym);
    const suffix = toWsCandleSuffix(timeframe);
    if (!exSymbol || !suffix) return () => {};

    const key = `${sym}|${timeframe}`;
    const existing = this.candleHandles.get(key);
    if (existing) {
      existing.refs += 1;
    } else {
      const release = this.ws.subscribe(topics.candle(exSymbol, suffix));
      this.candleHandles.set(key, { refs: 1, release });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const h = this.candleHandles.get(key);
      if (!h) return;
      h.refs -= 1;
      if (h.refs <= 0) {
        h.release();
        this.candleHandles.delete(key);
      }
    };
  }

  /** REST 스냅샷으로 오더북/체결 초기값을 채운다. */
  async primeSnapshot(symbol) {
    const instrument = this.getInstrument(symbol);
    const exSymbol = toKucoin(symbol);
    if (!instrument || !exSymbol) return;

    const [book, trades] = await Promise.allSettled([
      rest.getDepth20(exSymbol),
      rest.getTradeHistory(exSymbol),
    ]);

    if (book.status === 'fulfilled' && book.value) {
      this.books.set(symbol, adapter.normalizeOrderBook(book.value, instrument));
    }
    if (trades.status === 'fulfilled' && Array.isArray(trades.value)) {
      const list = adapter
        .normalizeTrades(trades.value, instrument)
        .sort((a, b) => b.time - a.time)
        .slice(0, TRADE_BUFFER);
      this.trades.set(symbol, list);
    }
  }

  // -------------------------------------------------------------------------
  // 업스트림 메시지 처리
  // -------------------------------------------------------------------------

  handleUpstream({ topic, data }) {
    if (!topic || !data) return;

    // topic 형태: /contractMarket/<channel>:<SYMBOL>[_<suffix>]
    const slice = topic.slice('/contractMarket/'.length);
    const colon = slice.indexOf(':');
    if (colon < 0) return;
    const channel = slice.slice(0, colon);
    const target = slice.slice(colon + 1);
    const [exSymbol, tfSuffix] = target.split('_');

    const symbol = this.byExchangeSymbol.get(exSymbol) || toInternal(exSymbol);
    if (!symbol) return;
    const instrument = this.getInstrument(symbol);
    if (!instrument) return;

    switch (channel) {
      case 'ticker':
        this.onTicker(symbol, data);
        break;
      case 'level2Depth5':
      case 'level2Depth50':
        this.onDepth(symbol, data, instrument);
        break;
      case 'execution':
        this.onExecution(symbol, data, instrument);
        break;
      case 'limitCandle':
        this.onCandle(symbol, tfSuffix, data, instrument);
        break;
      default:
        break;
    }
  }

  onTicker(symbol, data) {
    const t = adapter.normalizeWsTicker(data);
    if (!t) return;
    const prev = this.tickers.get(symbol) || {};
    const merged = {
      ...prev,
      ...t,
      // 24h 필드는 WS 에 없으므로 기존 값을 유지한다.
      high24h: prev.high24h ?? 0,
      low24h: prev.low24h ?? 0,
      chg24hPct: prev.chg24hPct ?? 0,
      vol24hQuote: prev.vol24hQuote ?? 0,
      vol24hBase: prev.vol24hBase ?? 0,
      mark: prev.mark ?? t.last,
      index: prev.index ?? t.last,
      fundingRate: prev.fundingRate ?? 0,
      nextFundingTime: prev.nextFundingTime ?? null,
      prev: prev.last ?? t.last,
    };
    this.tickers.set(symbol, merged);
    this.emit('ticker', merged);
  }

  onDepth(symbol, data, instrument) {
    const book = adapter.normalizeOrderBook(data, instrument);
    this.books.set(symbol, book);
    this.emit('orderbook', book);
  }

  onExecution(symbol, data, instrument) {
    const trade = adapter.normalizeTrade(data, instrument);
    const list = this.trades.get(symbol) || [];
    list.unshift(trade);
    if (list.length > TRADE_BUFFER) list.length = TRADE_BUFFER;
    this.trades.set(symbol, list);
    this.emit('trade', trade);
  }

  onCandle(symbol, tfSuffix, data, instrument) {
    const row = data?.candles;
    if (!Array.isArray(row)) return;
    const candle = adapter.normalizeWsCandle(row, instrument);
    const timeframe = SUFFIX_TO_TF[tfSuffix];
    if (timeframe) this.mergeLiveCandle(symbol, timeframe, candle);
    this.emit('candle', { symbol, timeframe: timeframe || tfSuffix, candle });
  }

  // -------------------------------------------------------------------------
  // 진단
  // -------------------------------------------------------------------------

  getStatus() {
    return {
      ready: this.ready,
      exchange: config.exchange,
      connection: this.connectionState,
      upstream: this.ws.getStatus(),
      instruments: this.instruments.size,
      tickers: this.tickers.size,
      streamedSymbols: [...this.streamHandles.keys()],
      streamedCandles: [...this.candleHandles.keys()],
      unsupported: this.listUnsupported(),
    };
  }
}

/** WS 캔들 접미사 -> 프론트엔드 타임프레임 역매핑 */
const SUFFIX_TO_TF = {
  '1min': '1m',
  '5min': '5m',
  '15min': '15m',
  '30min': '30m',
  '1hour': '1H',
  '2hour': '2H',
  '4hour': '4H',
  '8hour': '8H',
  '12hour': '12H',
  '1day': '1D',
  '1week': '1W',
};

export const marketService = new MarketService();
