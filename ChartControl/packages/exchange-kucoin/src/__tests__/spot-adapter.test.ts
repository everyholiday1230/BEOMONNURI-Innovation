/*
   KuCoin 현물 시세 어댑터 — 선물과 섞이면 안 되는 지점들
   ------------------------------------------------------------
   ★★ 이 검사의 목적은 "현물과 선물의 규칙이 서로 새지 않는지" 확인하는 것이다.

     두 시장은 심볼 표기·캔들 배열 순서·수량 의미가 모두 다르다. 한쪽 파서를
     다른 쪽에 쓰면 **오류가 나지 않고 값이 틀린다.** 고가·저가가 뒤바뀐 차트는
     정상처럼 보이고, 이용자는 그것을 보고 주문을 낸다. 그래서 실패가 조용한
     지점만 골라 고정한다.
*/

import { describe, it, expect } from 'vitest';
import { KucoinSpotAdapter, toSpotSymbol, fromSpotSymbol } from '../spot-adapter';

describe('SPOT-SYM 심볼 표기', () => {
  it('[1] 우리 표기 → KuCoin 현물 표기', () => {
    expect(toSpotSymbol('BTCUSDT')).toBe('BTC-USDT');
    expect(toSpotSymbol('ETHUSDT')).toBe('ETH-USDT');
    expect(toSpotSymbol('MATICUSDT')).toBe('MATIC-USDT');
  });

  it('[2] ★★ 현물은 BTC 를 XBT 로 바꾸지 않는다', () => {
    /*
       선물은 BTC 를 XBTUSDTM 으로 쓴다. 그 치환을 현물에 적용하면 KuCoin 이
       XBT-USDT 라는 없는 심볼을 받고 404 를 준다 — 그러면 화면은 "데이터 없음"
       으로 보이고, 원인이 심볼 규칙이라는 것을 알기 어렵다.
    */
    expect(toSpotSymbol('BTCUSDT')).not.toContain('XBT');
    expect(toSpotSymbol('BTCUSDT')).toBe('BTC-USDT');
  });

  it('[3] 견적통화가 겹칠 때 긴 것을 먼저 떼어 낸다', () => {
    // USDT 를 USD 로 먼저 자르면 'BTCUSD' + 'T' 가 되어 심볼이 깨진다.
    expect(toSpotSymbol('BTCUSDT')).toBe('BTC-USDT');
    expect(toSpotSymbol('BTCUSDC')).toBe('BTC-USDC');
  });

  it('[4] 되돌리기', () => {
    expect(fromSpotSymbol('BTC-USDT')).toBe('BTCUSDT');
    expect(fromSpotSymbol('btc-usdt')).toBe('BTCUSDT');
  });
});

/** KuCoin 응답을 흉내내는 fetch. 네트워크 없이 파싱 규칙만 검사한다. */
function fakeFetch(payload: unknown, code = '200000') {
  return async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ code, data: payload }),
    }) as unknown as Response;
}

describe('SPOT-CANDLE 캔들 파싱', () => {
  /*
     실제 응답 한 줄 (2026-08 확인):
       ["1786708800","62861.1","62773.8","62902.1","62767.8","15.16689057","952853.32"]
        time(초)    open      close     high      low       volume       turnover

     ★★ 선물은 [ms, open, high, low, close, …] 다. close 와 high 의 자리가 다르다.
   */
  const ROW = ['1786708800', '62861.1', '62773.8', '62902.1', '62767.8', '15.16689057', '952853.32'];

  it('[1] ★★ o,c,h,l 순서를 지킨다', async () => {
    const a = new KucoinSpotAdapter({ fetchImpl: fakeFetch([ROW]) as unknown as typeof fetch });
    const cs = await a.getCandles({ symbol: 'BTCUSDT', timeframe: '15m', limit: 1 });
    const c = cs[0]!;
    expect(c.open).toBe('62861.1');
    expect(c.close).toBe('62773.8');
    expect(c.high).toBe('62902.1');
    expect(c.low).toBe('62767.8');
    // 선물 순서로 읽었다면 close 가 62902.1(고가)이 되어 있을 것이다.
    expect(c.close).not.toBe('62902.1');
  });

  it('[2] 초 단위 시각을 ms 로 바꾼다', async () => {
    const a = new KucoinSpotAdapter({ fetchImpl: fakeFetch([ROW]) as unknown as typeof fetch });
    const cs = await a.getCandles({ symbol: 'BTCUSDT', timeframe: '15m', limit: 1 });
    const c = cs[0]!;
    expect(c.time).toBe(1786708800000);
  });

  it('[3] ★ 최신 순으로 온 응답을 오래된 순으로 정렬한다', async () => {
    /*
       현물 응답은 내림차순이다. 정렬하지 않으면 차트가 좌우로 뒤집힌다 —
       그 상태로도 그림은 그려지므로 눈으로 알아채기 어렵다.
    */
    const older = ['1786708800', '1', '2', '3', '0.5', '1'];
    const newer = ['1786709700', '2', '3', '4', '1.5', '1'];
    const a = new KucoinSpotAdapter({ fetchImpl: fakeFetch([newer, older]) as unknown as typeof fetch });
    const cs = await a.getCandles({ symbol: 'BTCUSDT', timeframe: '15m', limit: 2 });
    expect(cs.map((c) => c.time)).toEqual([1786708800000, 1786709700000]);
  });

  it('[4] 지원하지 않는 주기는 거부한다', async () => {
    const a = new KucoinSpotAdapter({ fetchImpl: fakeFetch([]) as unknown as typeof fetch });
    await expect(a.getCandles({ symbol: 'BTCUSDT', timeframe: '7m' })).rejects.toThrow(/timeframe/);
  });
});

describe('SPOT-TICKER 티커 파싱', () => {
  it('[1] ★ changeRate 는 비율이므로 100 을 곱한다', async () => {
    const a = new KucoinSpotAdapter({
      fetchImpl: fakeFetch({ symbol: 'BTC-USDT', last: '62765.6', changeRate: '-0.0122', high: '1', low: '1', volValue: '5' }) as unknown as typeof fetch,
    });
    const t = await a.getTicker('BTCUSDT');
    // 100 을 곱하지 않으면 -1.22% 가 -0.0122% 로 보인다.
    expect(t.changePct).toBeCloseTo(-1.22, 6);
    expect(t.symbol).toBe('BTCUSDT');
  });

  it('[2] ★ 거래대금은 volValue(견적통화 금액)를 쓴다', async () => {
    /*
       vol 은 기초자산 수량이다. 그것으로 정렬하면 가격이 낮은 종목이 거래대금
       1위로 올라간다 — 화면의 '24H VOLUME' 은 금액으로 읽히므로 거짓이 된다.
    */
    const a = new KucoinSpotAdapter({
      fetchImpl: fakeFetch({ symbol: 'BTC-USDT', last: '100', changeRate: '0', vol: '1737', volValue: '109957658' }) as unknown as typeof fetch,
    });
    const t = await a.getTicker('BTCUSDT');
    expect(t.vol24h).toBe('109957658');
  });
});

describe('SPOT-ERR 실패를 데이터 없음으로 위장하지 않는다', () => {
  it('[1] ★★ HTTP 200 + code 오류를 예외로 올린다', async () => {
    /*
       KuCoin 은 실패를 HTTP 200 본문의 code 로 알린다. code 를 보지 않으면
       빈 데이터로 오해해 "종목이 없다"·"캔들이 없다" 로 화면에 그린다.
       조회 실패를 빈 배열로 위장하지 않는다는 불변식과 같은 이야기다.
    */
    const a = new KucoinSpotAdapter({
      fetchImpl: fakeFetch(null, '400100') as unknown as typeof fetch,
    });
    await expect(a.getTickers()).rejects.toThrow(/400100/);
  });
});

describe('SPOT-SYMBOLS 심볼 목록', () => {
  it('[1] 거래 불가 종목은 제외하고 정밀도를 자릿수로 바꾼다', async () => {
    const a = new KucoinSpotAdapter({
      fetchImpl: fakeFetch([
        { symbol: 'BTC-USDT', baseCurrency: 'BTC', quoteCurrency: 'USDT', baseIncrement: '0.00000001', priceIncrement: '0.1', baseMinSize: '0.00001', enableTrading: true },
        { symbol: 'DEAD-USDT', baseCurrency: 'DEAD', quoteCurrency: 'USDT', baseIncrement: '1', priceIncrement: '1', baseMinSize: '1', enableTrading: false },
      ]) as unknown as typeof fetch,
    });
    const rows = await a.getSymbols();
    expect(rows.map((r) => r.id)).toEqual(['BTCUSDT']);
    const btc = rows[0]!;
    expect(btc.contractType).toBe('spot');
    expect(btc.quantityPrecision).toBe(8);
    expect(btc.pricePrecision).toBe(1);
    /*
       ★ 현물에는 레버리지가 없다. 스키마가 양수를 요구하므로 1(=레버리지 없음)이다.
         선물 기본값 20 이 새어 들어오면 화면이 20배 주문을 제안한다.
    */
    expect(btc.maxLeverage).toBe(1);
  });

  it('[2] ★ 한 종목의 형식 오류가 목록 전체를 비우지 않는다', async () => {
    const a = new KucoinSpotAdapter({
      fetchImpl: fakeFetch([
        { symbol: 'BAD', baseCurrency: '', quoteCurrency: '', enableTrading: true },
        { symbol: 'ETH-USDT', baseCurrency: 'ETH', quoteCurrency: 'USDT', baseIncrement: '0.0001', priceIncrement: '0.01', baseMinSize: '0.001', enableTrading: true },
      ]) as unknown as typeof fetch,
    });
    const rows = await a.getSymbols();
    expect(rows.map((r) => r.id)).toEqual(['ETHUSDT']);
  });

  it('[3] 스트리밍을 지원한다고 말하지 않는다', () => {
    /*
       현물 WS 는 아직 구현하지 않았다. supportsStreaming 이 true 면 화면이
       실시간이라고 표시하고, 이용자는 멈춘 가격을 최신이라고 믿는다.
    */
    const a = new KucoinSpotAdapter();
    expect(a.supportsStreaming).toBe(false);
  });
});
