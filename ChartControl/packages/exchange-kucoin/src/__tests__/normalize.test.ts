/**
 * 정규화 검증.
 *
 * 입력 픽스처는 모두 2026-08-04 KuCoin 실응답에서 그대로 따온 값이다.
 * 특히 캔들 필드 순서(REST vs WS)는 실측으로 확정한 것이며 여기서 회귀를 막는다.
 */

import { describe, expect, it } from 'vitest';

import {
  normalizeInstrument,
  normalizeLiveTicker,
  normalizeOrderBook,
  normalizeRestCandle,
  normalizeRestCandles,
  normalizeTickerFromContract,
  normalizeTrade,
  type KucoinContract,
} from '../normalize.js';
import { normalizeWsCandle } from '../normalize.js';
import { precisionFromStep, toDecimalString } from '../decimal.js';

/** XBTUSDTM contracts/active 실응답 발췌 */
const XBT_CONTRACT: KucoinContract = {
  symbol: 'XBTUSDTM',
  baseCurrency: 'XBT',
  quoteCurrency: 'USDT',
  multiplier: 0.001,
  tickSize: 0.1,
  lotSize: 1,
  maxLeverage: 125,
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0006,
  status: 'Open',
  lastTradePrice: 63752.2,
  markPrice: 63752.2,
  indexPrice: 63773.0,
  highPrice: 64229.2,
  lowPrice: 62415.8,
  priceChg: 1075.7,
  priceChgPct: 0.0171,
  volumeOf24h: 5804.766,
  turnoverOf24h: 368879607.0544,
  openInterest: 21328636,
  fundingFeeRate: 3.8e-5,
  nextFundingRateDateTime: 1785859200000,
};

const XBT = normalizeInstrument(XBT_CONTRACT)!;

describe('십진 문자열 변환', () => {
  it('지수 표기를 고정소수점으로 펼친다 (DecimalString 정규식이 지수를 거부하므로)', () => {
    expect(toDecimalString(1e-5)).toBe('0.00001');
    expect(toDecimalString(1e-7)).toBe('0.0000001');
    expect(toDecimalString(1e-8)).toBe('0.00000001');
    // 모든 결과가 DecimalString 정규식을 통과해야 한다.
    for (const v of [1e-5, 1e-7, 1e-8, 0.1, 63752.2, 1, 0]) {
      expect(toDecimalString(v)).toMatch(/^-?\d+(\.\d+)?$/u);
    }
  });

  it('불필요한 끝자리 0 을 없앤다', () => {
    expect(toDecimalString('0.10000')).toBe('0.1');
    expect(toDecimalString('5.000')).toBe('5');
    expect(toDecimalString(-0)).toBe('0');
  });

  it('유한하지 않은 값은 null 을 반환한다 (조용히 0 으로 바꾸지 않는다)', () => {
    expect(toDecimalString(Number.NaN)).toBeNull();
    expect(toDecimalString(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toDecimalString('abc')).toBeNull();
  });

  it('step 으로부터 자리수를 구한다', () => {
    expect(precisionFromStep(0.1)).toBe(1);
    expect(precisionFromStep(0.001)).toBe(3);
    expect(precisionFromStep(1e-5)).toBe(5);
    expect(precisionFromStep(1)).toBe(0);
  });
});

describe('계약 사양 정규화', () => {
  it('XBT 를 BTC 로 되돌리고 정규 SymbolInfo 를 만든다', () => {
    expect(XBT.symbol).toBe('BTCUSDT');
    expect(XBT.exchangeSymbol).toBe('XBTUSDTM');
    expect(XBT.info.id).toBe('BTCUSDT');
    expect(XBT.info.base).toBe('BTC'); // XBT 가 아님
    expect(XBT.info.quote).toBe('USDT');
    expect(XBT.info.tickSize).toBe('0.1');
    expect(XBT.info.pricePrecision).toBe(1);
    expect(XBT.info.maxLeverage).toBe(125);
    expect(XBT.multiplier).toBe(0.001);
    expect(XBT.tradable).toBe(true);
  });

  it('stepSize 는 lotSize * multiplier (기초자산 기준 최소 증분)', () => {
    // lotSize=1, multiplier=0.001 -> 0.001 BTC
    expect(XBT.info.stepSize).toBe('0.001');
    expect(XBT.info.quantityPrecision).toBe(3);
  });

  it('status 가 Open 이 아니면 tradable=false', () => {
    const paused = normalizeInstrument({ ...XBT_CONTRACT, status: 'Pause' })!;
    expect(paused.tradable).toBe(false);
  });

  it('multiplier 가 없거나 0 이면 거부한다 (수량 변환이 불가능하므로)', () => {
    expect(normalizeInstrument({ ...XBT_CONTRACT, multiplier: 0 })).toBeNull();
    expect(normalizeInstrument({ ...XBT_CONTRACT, multiplier: undefined })).toBeNull();
  });

  it('USDTM 이 아닌 심볼은 거부한다', () => {
    expect(normalizeInstrument({ ...XBT_CONTRACT, symbol: 'XBTUSDM' })).toBeNull();
  });

  it('아주 작은 tickSize 도 지수 표기 없이 처리한다', () => {
    const tiny = normalizeInstrument({ ...XBT_CONTRACT, symbol: 'PEPEUSDTM', tickSize: 1e-8, multiplier: 1000 })!;
    expect(tiny.info.tickSize).toBe('0.00000001');
    expect(tiny.info.pricePrecision).toBe(8);
  });
});

describe('티커 정규화', () => {
  it('priceChgPct 비율을 퍼센트로 변환한다', () => {
    const t = normalizeTickerFromContract(XBT_CONTRACT)!;
    // 0.0171 (비율) -> 1.71 (%)
    expect(t.changePct).toBeCloseTo(1.71, 10);
    expect(t.high24h).toBe('64229.2');
    expect(t.low24h).toBe('62415.8');
    expect(t.last).toBe('63752.2');
  });

  it('vol24h 는 USDT 명목가치(turnover)를 쓴다', () => {
    const t = normalizeTickerFromContract(XBT_CONTRACT)!;
    expect(t.vol24h).toBe('368879607.0544');
  });

  it('펀딩 정보를 전달한다', () => {
    const t = normalizeTickerFromContract(XBT_CONTRACT)!;
    expect(t.fundingRate).toBeCloseTo(3.8e-5, 12);
    expect(t.nextFundingAt).toBe(1785859200000);
  });

  it('실시간 ticker 는 24h 필드를 이전 값에서 보존한다', () => {
    const base = normalizeTickerFromContract(XBT_CONTRACT)!;
    const live = normalizeLiveTicker(
      { symbol: 'XBTUSDTM', price: '63999.9', ts: 1785841375712000000 },
      base,
    )!;
    expect(live.last).toBe('63999.9');
    // WS 에는 24h 통계가 없으므로 이전 값이 남아야 한다.
    expect(live.high24h).toBe('64229.2');
    expect(live.changePct).toBeCloseTo(1.71, 10);
  });
});

describe('오더북 정규화', () => {
  it('계약 수를 multiplier 로 기초자산 수량으로 변환한다', () => {
    const book = normalizeOrderBook(
      {
        symbol: 'XBTUSDTM',
        sequence: 1,
        timestamp: 1785841052100,
        bids: [[63738.2, 454], [63736.6, 28]],
        asks: [[63738.3, 508], [63738.4, 129]],
      },
      XBT,
    )!;
    // 454 계약 * 0.001 = 0.454 BTC
    expect(book.bids[0]!).toEqual(['63738.2', '0.454']);
    expect(book.asks[0]!).toEqual(['63738.3', '0.508']);
    expect(book.symbol).toBe('BTCUSDT');
    expect(book.asOf).toBe(1785841052100);
  });

  it('bids 내림차순 / asks 오름차순으로 재정렬한다', () => {
    const book = normalizeOrderBook(
      {
        symbol: 'XBTUSDTM',
        bids: [[98, 1], [100, 1], [99, 1]],
        asks: [[103, 1], [101, 1], [102, 1]],
      },
      XBT,
    )!;
    expect(book.bids.map((b) => b[0]!)).toEqual(['100', '99', '98']);
    expect(book.asks.map((a) => a[0]!)).toEqual(['101', '102', '103']);
  });

  it('수량 0 또는 가격 0 호가를 제거한다', () => {
    const book = normalizeOrderBook(
      { symbol: 'XBTUSDTM', bids: [[100, 0], [99, 5]], asks: [[0, 5], [101, 5]] },
      XBT,
    )!;
    expect(book.bids).toHaveLength(1);
    expect(book.bids[0]![0]).toBe('99');
    expect(book.asks).toHaveLength(1);
    expect(book.asks[0]![0]).toBe('101');
  });

  it('한쪽이 비어도 실패하지 않는다', () => {
    const book = normalizeOrderBook({ symbol: 'XBTUSDTM', bids: [], asks: [[101, 5]] }, XBT)!;
    expect(book).not.toBeNull();
    expect(book.bids).toHaveLength(0);
  });
});

describe('체결 정규화', () => {
  it('taker side 를 그대로 쓰고 수량을 변환한다', () => {
    const t = normalizeTrade(
      {
        symbol: 'XBTUSDTM',
        tradeId: '1939870872382',
        ts: 1785841369694000000, // 나노초
        size: 31,
        price: '63748',
        side: 'sell',
      },
      XBT,
    )!;
    expect(t.id).toBe('1939870872382');
    expect(t.ts).toBe(1785841369694); // 밀리초로 변환
    expect(t.price).toBe('63748');
    expect(t.size).toBe('0.031'); // 31 * 0.001
    expect(t.side).toBe('sell');
  });

  it('side 가 buy/sell 이 아니면 버린다 (추측하지 않는다)', () => {
    for (const side of [undefined, null, '', 'unknown'] as unknown[]) {
      expect(
        normalizeTrade({ symbol: 'XBTUSDTM', tradeId: '1', size: 1, price: '1', side: side as string }, XBT),
      ).toBeNull();
    }
    expect(normalizeTrade({ symbol: 'XBTUSDTM', tradeId: '1', size: 1, price: '1', side: 'buy' }, XBT)?.side).toBe('buy');
  });
});

describe('캔들 정규화 — REST 와 WS 의 필드 순서가 다르다', () => {
  it('REST 순서는 [tMs, o, h, l, c, volContracts, turnover]', () => {
    // 실응답 1행
    const row = [1785000600000, 64242.7, 64287.4, 64225.0, 64259.8, 9486, 609487.4003];
    const c = normalizeRestCandle(row, XBT)!;

    expect(c.time).toBe(1785000600000);
    expect(c.open).toBe('64242.7');
    expect(c.high).toBe('64287.4');
    expect(c.low).toBe('64225');
    expect(c.close).toBe('64259.8');
    expect(c.volume).toBe('9.486'); // 9486 * 0.001
    expect(c.closed).toBe(true);
  });

  it('WS 순서는 [tSec, o, c, h, l, turnover, volContracts] — REST 와 다르다', () => {
    // 실측 WS 1행: open=63735.8, close=63745, high=63748.1, low=63732.1
    const row = [1785841080, 63735.8, 63745, 63748.1, 63732.1, 9815.4693, 154];
    const c = normalizeWsCandle(row, XBT)!;

    expect(c.time).toBe(1785841080000); // 초 -> 밀리초
    expect(c.open).toBe('63735.8');
    expect(c.close).toBe('63745');
    expect(c.high).toBe('63748.1');
    expect(c.low).toBe('63732.1');
    expect(c.volume).toBe('0.154'); // 154 * 0.001
    // WS 캔들은 진행 중이므로 미확정이다.
    expect(c.closed).toBe(false);
  });

  it('REST 파서로 WS 행을 읽으면 스키마가 거부한다 (심층 방어)', () => {
    const wsRow = [1785841080, 63735.8, 63745, 63748.1, 63732.1, 9815.4693, 154];
    const correct = normalizeWsCandle(wsRow, XBT)!;
    expect(correct.time).toBeGreaterThan(1e12); // 초 -> 밀리초 승격

    // REST 파서는 [t,o,h,l,c] 로 읽으므로 low=63748.1, close=63732.1 이 되어
    // low <= min(open, close) 불변식이 깨진다. CandleSchema 의 refine 이 이를
    // 잡아내 null 을 반환한다. 즉 파서를 혼용하면 조용히 왜곡되는 대신
    // 데이터가 아예 버려지므로, 잘못된 차트가 그려지지 않는다.
    expect(normalizeRestCandle(wsRow, XBT)).toBeNull();
  });

  it('반대로 WS 파서로 REST 행을 읽으면 값이 뒤바뀐다 (그래서 혼용 금지)', () => {
    const restRow = [1785000600000, 64242.7, 64287.4, 64225.0, 64259.8, 9486, 609487.4003];
    const correct = normalizeRestCandle(restRow, XBT)!;
    const wrong = normalizeWsCandle(restRow, XBT)!;

    // WS 파서는 [t,o,c,h,l] 로 읽으므로 close 자리에 REST 의 high 가 들어간다.
    expect(correct.close).toBe('64259.8');
    expect(wrong.close).toBe('64287.4'); // 잘못된 종가
    expect(wrong.close).not.toBe(correct.close);
    // 거래량도 다른 열에서 읽어 완전히 달라진다.
    expect(wrong.volume).not.toBe(correct.volume);
  });

  it('OHLC 불변식을 방어적으로 강제한다', () => {
    // high < open 인 행이 와도 CandleSchema 에 거부당하지 않게 보정한다.
    const c = normalizeWsCandle([1785841080, 100, 110, 90, 95, 0, 0], XBT)!;
    expect(Number(c.high)).toBeGreaterThanOrEqual(Math.max(Number(c.open), Number(c.close)));
    expect(Number(c.low)).toBeLessThanOrEqual(Math.min(Number(c.open), Number(c.close)));
  });

  it('REST 캔들 배열은 시간 오름차순 정렬 + 중복 제거된다', () => {
    const rows = [
      [3000, 3, 4, 2, 3.5, 10, 1],
      [1000, 1, 2, 0.5, 1.5, 10, 1],
      [2000, 2, 3, 1.5, 2.5, 10, 1],
      [2000, 2, 3, 1.5, 2.5, 10, 1], // 중복
      [0, 0, 0, 0, 0, 0, 0], // 불량
    ];
    const out = normalizeRestCandles(rows, XBT);
    expect(out.map((c) => c.time)).toEqual([1000, 2000, 3000]);
  });

  it('빈 입력에 안전하다', () => {
    expect(normalizeRestCandles(undefined, XBT)).toEqual([]);
    expect(normalizeRestCandles([], XBT)).toEqual([]);
    expect(normalizeRestCandle([], XBT)).toBeNull();
    expect(normalizeWsCandle([], XBT)).toBeNull();
  });
});
