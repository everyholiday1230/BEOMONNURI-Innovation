/*
   현물 실시간 스트림 — 토픽과 프레임 해석
   ------------------------------------------------------------
   ★★ 이 검사가 막으려는 사고

     1) 접두어가 달라 프레임이 조용히 버려지는 것
        현물은 `/market/`, 선물은 `/contractMarket/`, 호가만 `/spotMarket/` 이다.
        파서가 접두어를 모르면 **연결도 되고 ack 도 오는데 데이터가 전부 버려진다.**
        화면은 "실시간 연결됨" 을 표시하면서 값이 갱신되지 않는다.
        실제로 그 상태를 겪었다(어댑터 수신 0건 → parseTopic 이 현물 접두어를
        몰랐기 때문).

     2) 캔들 배열 순서를 선물과 혼동하는 것
        현물 WS 는 [sec, open, close, high, low, volume, turnover] 다.
        선물 순서로 읽으면 몸통과 꼬리가 뒤바뀐 캔들이 그려지고 오류는 없다.

     3) 티커에 없는 변동률을 0 으로 채우는 것
        현물 ticker 프레임에는 24시간 변동률이 없다(실제 프레임으로 확인:
        price·bestBid·bestAsk·size 뿐). 0 으로 채우면 **모든 종목이 "변동 없음"**
        으로 보인다.
*/

import { describe, it, expect } from 'vitest';
import {
  spotTickerTopic,
  spotCandleTopic,
  spotDepth5Topic,
  spotMatchTopic,
  symbolFromSpotTopic,
  parseSpotTicker,
  parseSpotCandle,
  parseSpotBook,
  parseSpotTrade,
} from '../spot-ws';
import { parseTopic } from '../ws-protocol';

describe('SPOT-WS 토픽', () => {
  it('[1] 현물 접두어와 심볼 표기를 쓴다', () => {
    expect(spotTickerTopic('BTCUSDT')).toBe('/market/ticker:BTC-USDT');
    expect(spotMatchTopic('ETHUSDT')).toBe('/market/match:ETH-USDT');
    expect(spotCandleTopic('BTCUSDT', '15m')).toBe('/market/candles:BTC-USDT_15min');
  });

  it('[2] ★ 호가만 /spotMarket/ 접두어다', () => {
    /*
       KuCoin 이 그렇게 나눠 두었다. /market/ 로 보내면 오류가 아니라
       **아무 응답도 오지 않는다** — 화면은 영원히 기다린다.
    */
    expect(spotDepth5Topic('BTCUSDT')).toBe('/spotMarket/level2Depth5:BTC-USDT');
  });

  it('[3] 지원하지 않는 주기는 구독하지 않는다', () => {
    // 임의 주기로 구독하면 KuCoin 이 아무것도 주지 않는다.
    expect(spotCandleTopic('BTCUSDT', '7m')).toBeNull();
  });

  it('[4] 토픽에서 심볼을 되돌린다', () => {
    expect(symbolFromSpotTopic('/market/ticker:BTC-USDT')).toBe('BTCUSDT');
    expect(symbolFromSpotTopic('/market/candles:ETH-USDT_1min')).toBe('ETHUSDT');
  });
});

describe('SPOT-WS 프레임 파서가 현물 접두어를 안다', () => {
  it('[1] ★★ /market/ 토픽이 버려지지 않는다', () => {
    /*
       이 검사가 없었을 때: parseTopic 이 null 을 돌려주고 parseFrame 이
       'unknown' 으로 처리해 **모든 현물 프레임이 조용히 사라졌다.**
    */
    const t = parseTopic('/market/ticker:BTC-USDT');
    expect(t).not.toBeNull();
    expect(t!.channel).toBe('ticker');
    expect(t!.exchangeSymbol).toBe('BTC-USDT');
  });

  it('[2] /spotMarket/ 토픽도 안다', () => {
    const t = parseTopic('/spotMarket/level2Depth5:BTC-USDT');
    expect(t).not.toBeNull();
    expect(t!.channel).toBe('level2Depth5');
  });

  it('[3] 선물 토픽은 그대로 동작한다 (회귀 방지)', () => {
    const t = parseTopic('/contractMarket/ticker:XBTUSDTM');
    expect(t).not.toBeNull();
    expect(t!.exchangeSymbol).toBe('XBTUSDTM');
  });

  it('[4] 모르는 접두어는 여전히 거부한다', () => {
    expect(parseTopic('/somethingElse/ticker:BTC-USDT')).toBeNull();
  });
});

describe('SPOT-WS ticker 프레임', () => {
  /* 실제 프레임 (2026-08 확인) */
  const DATA = {
    bestAsk: '62706.4', bestAskSize: '0.24652816',
    bestBid: '62706.3', bestBidSize: '0.51648768',
    price: '62706.4', sequence: '35563078532', size: '0.05855799', time: 1786720479796,
  };

  it('[1] 최근가·최우선 호가를 읽는다', () => {
    const t = parseSpotTicker('/market/ticker:BTC-USDT', DATA);
    expect(t).toMatchObject({ symbol: 'BTCUSDT', last: '62706.4', bid: '62706.3', ask: '62706.4' });
  });

  it('[2] ★★ 변동률을 만들어 넣지 않는다', () => {
    /*
       프레임에 없는 값이다. 0 으로 채우면 모든 종목이 "변동 없음" 으로 보이고,
       이용자는 시장이 멈춘 줄 안다. 호출자가 기존 값을 유지하도록 비워 둔다.
    */
    const t = parseSpotTicker('/market/ticker:BTC-USDT', DATA) as Record<string, unknown>;
    expect(t.changePct).toBeUndefined();
    expect(t.high24h).toBeUndefined();
    expect(t.vol24h).toBeUndefined();
  });

  it('[3] 가격이 없으면 버린다', () => {
    expect(parseSpotTicker('/market/ticker:BTC-USDT', { bestBid: '1' })).toBeNull();
  });
});

describe('SPOT-WS candles 프레임', () => {
  /* 실제 프레임 (2026-08 확인) */
  const DATA = {
    symbol: 'BTC-USDT',
    candles: ['1786720440', '62700.9', '62706.3', '62706.4', '62700.9', '0.40513234', '25403.388720301'],
    time: 1786720494054716000,
  };

  it('[1] ★★ o,c,h,l 순서를 지킨다', () => {
    const r = parseSpotCandle(DATA);
    expect(r).not.toBeNull();
    expect(r!.symbol).toBe('BTCUSDT');
    expect(r!.candle.open).toBe('62700.9');
    expect(r!.candle.close).toBe('62706.3');
    expect(r!.candle.high).toBe('62706.4');
    expect(r!.candle.low).toBe('62700.9');
    // 선물 순서로 읽었다면 close 가 high 값이 되어 있을 것이다.
    expect(r!.candle.close).not.toBe('62706.4');
  });

  it('[2] 초 → ms 로 바꾼다', () => {
    expect(parseSpotCandle(DATA)!.candle.time).toBe(1786720440000);
  });

  it('[3] ★ 진행 중인 캔들로 표시한다', () => {
    /*
       WS 로 오는 마지막 봉은 아직 확정되지 않았다. closed:true 로 두면 화면이
       그 값을 최종 종가로 다루고, 지표 계산도 확정된 봉으로 취급한다.
    */
    expect(parseSpotCandle(DATA)!.candle.closed).toBe(false);
  });

  it('[4] 형식이 어긋나면 버린다 (스트림을 끊지 않는다)', () => {
    expect(parseSpotCandle({ symbol: 'BTC-USDT', candles: ['1'] })).toBeNull();
    expect(parseSpotCandle({ candles: DATA.candles })).toBeNull();
  });
});

describe('SPOT-WS 호가 프레임', () => {
  /* 실제 프레임 (2026-08 확인) */
  const DATA = {
    asks: [['63077.1', '0.24289917'], ['63078.4', '0.03595539']],
    bids: [['63077', '0.65317555'], ['63076.4', '0.04541569']],
    timestamp: 1786760452057,
  };

  it('[1] 매수·매도 단계를 읽는다', () => {
    const r = parseSpotBook('/spotMarket/level2Depth5:BTC-USDT', DATA);
    expect(r).not.toBeNull();
    expect(r!.symbol).toBe('BTCUSDT');
    expect(r!.bids[0]).toEqual(['63077', '0.65317555']);
    expect(r!.asks[0]).toEqual(['63077.1', '0.24289917']);
    expect(r!.asOf).toBe(1786760452057);
  });

  it('[2] ★ 시퀀스를 만들어 넣지 않는다', () => {
    /*
       선물 level2Depth5 는 sequence 를 주지만 현물은 주지 않는다. 없는 번호를
       채우면 "순서가 맞다" 는 근거 없는 주장이 된다.
    */
    const r = parseSpotBook('/spotMarket/level2Depth5:BTC-USDT', DATA) as Record<string, unknown>;
    expect(r.sequence).toBeUndefined();
  });

  it('[3] 숫자가 아닌 줄만 버리고 나머지는 살린다', () => {
    const r = parseSpotBook('/spotMarket/level2Depth5:BTC-USDT', {
      ...DATA,
      bids: [['x', 'y'], ['63076.4', '0.045']],
    });
    // 한 줄 때문에 호가창을 비우지 않는다.
    expect(r!.bids).toEqual([['63076.4', '0.045']]);
  });

  it('[4] 양쪽이 모두 비면 버린다', () => {
    expect(parseSpotBook('/spotMarket/level2Depth5:BTC-USDT', { bids: [], asks: [], timestamp: 1 })).toBeNull();
  });
});

describe('SPOT-WS 체결 프레임', () => {
  /* 실제 프레임 (2026-08 확인) — time 이 나노초 문자열이다 */
  const DATA = {
    price: '63077.1', size: '0.0001825', side: 'buy',
    time: '1786760454831000000', tradeId: '23926104641519616', symbol: 'BTC-USDT',
  };

  it('[1] ★★ 나노초를 ms 로 바꾼다', () => {
    const r = parseSpotTrade('/market/match:BTC-USDT', DATA);
    expect(r).not.toBeNull();
    /*
       그대로 쓰면 시각이 5천만 년 뒤가 된다. 화면이 "몇 초 전" 을 계산하면
       음수가 나오거나 정렬이 뒤집힌다.
    */
    expect(r!.ts).toBe(1786760454831);
    expect(r!.ts).toBeLessThan(Date.now() + 60_000);
  });

  it('[2] ★ side 는 테이커 방향을 그대로 쓴다', () => {
    expect(parseSpotTrade('/market/match:BTC-USDT', DATA)!.side).toBe('buy');
    expect(parseSpotTrade('/market/match:BTC-USDT', { ...DATA, side: 'sell' })!.side).toBe('sell');
  });

  it('[3] 단위가 다른 시각도 처리한다', () => {
    // KuCoin 이 채널마다 단위를 달리 쓴다. 하나로 가정하면 어느 한쪽이 조용히 틀린다.
    expect(parseSpotTrade('/market/match:BTC-USDT', { ...DATA, time: 1786760454831 })!.ts).toBe(1786760454831);
    expect(parseSpotTrade('/market/match:BTC-USDT', { ...DATA, time: 1786760454 })!.ts).toBe(1786760454000);
  });

  it('[4] 가격·수량이 없으면 버린다', () => {
    expect(parseSpotTrade('/market/match:BTC-USDT', { side: 'buy' })).toBeNull();
  });
});
