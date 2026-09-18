/**
 * Bitget 공개 시장 데이터 어댑터 (USDT 무기한).
 *
 * ★★★ **읽기만 한다.** 주문·자금 이동 경로가 이 파일에 없다. 새 거래소를 붙일 때
 *   읽기부터 가는 이유는 단순하다 — 틀려도 고객 돈이 움직이지 않는다.
 */
import { SymbolSchema, type Candle, type SymbolInfo, type Ticker } from '@quantumtrade/schemas';
import type { Timeframe } from '@quantumtrade/config';
import type { CandleQuery, IMarketDataProvider, Unsubscribe } from '@quantumtrade/exchange-adapters';
import { BitgetPublicRest, type BitgetRestOptions } from './rest.js';
import { normalizeCandles, normalizeTickers } from './normalize.js';
import { PRODUCT_TYPE, toGranularity } from './symbols.js';

/** Bitget 이 한 번에 주는 봉 수 상한(문서·실측). */
const MAX_CANDLES_PER_CALL = 1000;

export class BitgetMarketData implements IMarketDataProvider {
  readonly name = 'bitget-futures';

  private readonly rest: BitgetPublicRest;

  constructor(opts: BitgetRestOptions = {}) {
    this.rest = new BitgetPublicRest(opts);
  }

  /**
   * 거래 가능한 종목과 **정밀도 규칙**.
   *
   * ★★★ 정밀도는 주문 검증이 전부 의존하는 값이다. 틀리면 거래소가 주문을 거절하거나
   *   (그건 그나마 낫다) **의도와 다른 수량**이 나간다.
   *
   * ★★ 실측 필드(2026-09-18): `pricePlace`(가격 소수 자리) · `volumePlace`(수량 소수
   *   자리) · `priceEndStep`(가격 최소 단위를 `10^-pricePlace` 의 배수로 표현) ·
   *   `minTradeNum`(최소 수량) · `maxLever`.
   *   예: BTCUSDT → pricePlace 1, priceEndStep 1, volumePlace 4, minTradeNum 0.0001
   *   → 틱 0.1, 스텝 0.0001
   */
  async getSymbols(signal?: AbortSignal): Promise<SymbolInfo[]> {
    const raw = await this.rest.get<unknown[]>(
      '/api/v2/mix/market/contracts',
      { productType: PRODUCT_TYPE },
      signal,
    );
    const out: SymbolInfo[] = [];
    for (const row of Array.isArray(raw) ? raw : []) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      /*
         ★ 무기한만 받는다. Bitget 은 `symbolType` 으로 구분한다 — 만기물이 섞이면
           화면이 만기를 모른 채 무기한처럼 보여준다.
      */
      if (String(r.symbolType ?? '') !== 'perpetual') continue;
      const pricePlace = Number(r.pricePlace);
      const volumePlace = Number(r.volumePlace);
      const endStep = Number(r.priceEndStep);
      if (!Number.isFinite(pricePlace) || !Number.isFinite(volumePlace)) continue;
      /*
         ★★ 틱 크기 = `priceEndStep × 10^-pricePlace`. `priceEndStep` 만 쓰면
           BTCUSDT 의 틱이 1 이 되어(실제 0.1) 주문 가격이 어긋난다.
         ★ 지수 표기가 되지 않게 `toFixed` 로 만든다 — `1e-7` 같은 문자열은
           우리 십진 스키마가 거부한다.
      */
      const tick = Number.isFinite(endStep) && endStep > 0
        ? (endStep * 10 ** -pricePlace).toFixed(pricePlace)
        : (10 ** -pricePlace).toFixed(pricePlace);
      const step = (10 ** -volumePlace).toFixed(volumePlace);
      const parsed = SymbolSchema.safeParse({
        id: String(r.symbol ?? ''),
        base: String(r.baseCoin ?? ''),
        quote: String(r.quoteCoin ?? ''),
        contractType: 'perpetual',
        pricePrecision: pricePlace,
        quantityPrecision: volumePlace,
        tickSize: tick,
        stepSize: step,
        minQty: String(r.minTradeNum ?? step),
        maxLeverage: Number(r.maxLever) > 0 ? Number(r.maxLever) : 20,
      });
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  /**
   * 봉.
   *
   * ★★★ 지원하지 않는 주기는 **명시적으로 실패한다.** 가까운 주기로 대체하면
   *   고객은 맞아 보이는데 틀린 차트를 본다. Bitget 에는 `8h` 가 없다(실측:
   *   `Parameter verification failed`).
   */
  async getCandles(query: CandleQuery): Promise<Candle[]> {
    const g = toGranularity(query.timeframe as Timeframe);
    if (g === null) {
      throw new Error(`bitget: 지원하지 않는 타임프레임: ${String(query.timeframe)}`);
    }
    const limit = Math.min(MAX_CANDLES_PER_CALL, Math.max(1, query.limit ?? 200));
    const raw = await this.rest.get<unknown[]>(
      '/api/v2/mix/market/candles',
      {
        symbol: query.symbol,
        productType: PRODUCT_TYPE,
        granularity: g,
        limit,
        /* ★ 페이지 넘김. Bitget 은 `endTime` 이전 봉을 준다. */
        endTime: query.before,
      },
      query.signal,
    );
    return normalizeCandles(raw);
  }

  /**
   * 한 종목 시세.
   *
   * ★ Bitget 은 `symbol` 을 주면 그 종목만 배열로 돌려준다. 첫 항목을 쓴다.
   */
  async getTicker(symbol: string, signal?: AbortSignal): Promise<Ticker> {
    const raw = await this.rest.get<unknown[]>(
      '/api/v2/mix/market/tickers',
      { symbol, productType: PRODUCT_TYPE },
      signal,
    );
    const list = normalizeTickers(raw);
    const hit = list.find((t) => t.symbol === symbol) ?? list[0];
    if (!hit) throw new Error(`bitget: 시세를 얻지 못했다: ${symbol}`);
    return hit;
  }

  /**
   * 전 종목 시세 — **한 번의 호출**로.
   *
   * ★ 종목마다 부르면 797번이다. 거래소가 한 번에 주는 것을 나눠 부를 이유가 없다.
   */
  async getTickers(signal?: AbortSignal): Promise<Ticker[]> {
    const raw = await this.rest.get<unknown[]>(
      '/api/v2/mix/market/tickers',
      { productType: PRODUCT_TYPE },
      signal,
    );
    return normalizeTickers(raw);
  }

  /**
   * 실시간 봉.
   *
   * ★★★ **아직 없다.** WebSocket 을 붙이지 않았으므로 **구독한 척하지 않는다** —
   *   빈 함수를 돌려주면 호출자는 구독됐다고 믿고 갱신을 기다린다. 그래서 던진다.
   * ★ 호출자는 폴링으로 대체할 수 있다(`getCandles`). 지금 단계는 읽기 전용이고,
   *   비트겟을 시세 원천으로 쓰지 않는다 — 고객 계정 조회용이다.
   */
  subscribeCandles(_symbol: string, _timeframe: Timeframe, _onCandle: (c: Candle) => void): Unsubscribe {
    throw new Error('bitget: 실시간 봉 구독은 아직 없다 — getCandles 로 폴링할 것');
  }
}
