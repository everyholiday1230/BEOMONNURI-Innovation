import { describe, it, expect } from 'vitest';
import { TIMEFRAMES } from '@quantumtrade/config';
import {
  FUTURES_WS_PUBLIC_URL,
  REST_KLINE_STEP,
  STREAMABLE_TIMEFRAMES,
  WS_IDLE_DISCONNECT_MS,
  WS_PING_INTERVAL_MS,
  bookTickerTopic,
  depthTopic,
  isStreamableTimeframe,
  klineTopic,
  parseFrame,
  parseRestKlines,
  pingFrame,
  ratioToPercent,
  restKlineUrl,
  subscribeFrame,
  tickerTopic,
  tradeTopic,
} from '../futures-ws';

/**
 * BitMart futures WS protocol.
 *
 * The payloads below are **verbatim captures from the live endpoint** (2026-08-03), not transcriptions of
 * the documentation — the docs are wrong about the kline shape and the ping reply, and the previous
 * gateway implementation failed silently because of it. Pinning real bytes is what stops that recurring.
 */

describe('WSF-01 topic construction', () => {
  it('[1] kline channels use UPPERCASE hour/day/week suffixes', () => {
    // Verified live: `futures/klineBin1h` is rejected with `Invalid channel: not found`.
    expect(klineTopic('BTCUSDT', '1h')).toBe('futures/klineBin1H:BTCUSDT');
    expect(klineTopic('BTCUSDT', '4h')).toBe('futures/klineBin4H:BTCUSDT');
    expect(klineTopic('BTCUSDT', '1d')).toBe('futures/klineBin1D:BTCUSDT');
    expect(klineTopic('BTCUSDT', '1w')).toBe('futures/klineBin1W:BTCUSDT');
    // Minutes stay lowercase.
    expect(klineTopic('BTCUSDT', '1m')).toBe('futures/klineBin1m:BTCUSDT');
    expect(klineTopic('BTCUSDT', '30m')).toBe('futures/klineBin30m:BTCUSDT');
  });

  it('[2] 3m has no channel and returns null rather than a nearby interval', () => {
    // Verified live: futures/klineBin3m → "Invalid channel: not found". Substituting 1m or 5m would give
    // a subscriber a chart that looks correct and is not.
    expect(klineTopic('BTCUSDT', '3m')).toBeNull();
    expect(isStreamableTimeframe('3m')).toBe(false);
    expect(STREAMABLE_TIMEFRAMES).not.toContain('3m');
    expect(STREAMABLE_TIMEFRAMES).toHaveLength(TIMEFRAMES.length - 1);
  });

  it('[3] every other internal timeframe is streamable', () => {
    for (const tf of TIMEFRAMES) {
      if (tf === '3m') continue;
      expect(klineTopic('X', tf), tf).not.toBeNull();
      expect(isStreamableTimeframe(tf), tf).toBe(true);
    }
  });

  it('[4] non-kline topics', () => {
    expect(tickerTopic('BTCUSDT')).toBe('futures/ticker:BTCUSDT');
    expect(tradeTopic('BTCUSDT')).toBe('futures/trade:BTCUSDT');
    expect(bookTickerTopic('BTCUSDT')).toBe('futures/bookticker:BTCUSDT');
    expect(depthTopic('BTCUSDT')).toBe('futures/depth20:BTCUSDT@200ms');
    expect(depthTopic('BTCUSDT', 50, '100ms')).toBe('futures/depth50:BTCUSDT@100ms');
  });

  it('[5] the subscribe frame uses `action`, not `op`', () => {
    const f = JSON.parse(subscribeFrame(['futures/ticker:BTCUSDT']));
    // The previous gateway sent {op:'subscribe'} and every subscription was ignored.
    expect(f).toEqual({ action: 'subscribe', args: ['futures/ticker:BTCUSDT'] });
    expect(f.op).toBeUndefined();
    expect(JSON.parse(pingFrame())).toEqual({ action: 'ping' });
  });

  it('[6] the public URL is the production endpoint, not demo', () => {
    expect(FUTURES_WS_PUBLIC_URL).toBe('wss://openapi-ws-v2.bitmart.com/api?protocol=1.1');
    expect(FUTURES_WS_PUBLIC_URL).not.toContain('demo');
  });

  it('[7] the ping interval stays inside the server idle timeout', () => {
    // The server closes after 20s without data; pinging at or past that races the disconnect.
    expect(WS_PING_INTERVAL_MS).toBeLessThan(WS_IDLE_DISCONNECT_MS);
  });
});

describe('WSF-02 kline frames (live capture)', () => {
  // Captured verbatim from futures/klineBin1m:BTCUSDT.
  const LIVE_1M =
    '{"group":"futures/klineBin1m:BTCUSDT","data":{"symbol":"BTCUSDT","items":[{"o":"63090.9","h":"63090.9","l":"63075.2","c":"63075.2","v":"19672","ts":1785727320}]}}';

  it('[1] parses the real `items[]` shape', () => {
    const f = parseFrame(LIVE_1M);
    expect(f.kind).toBe('kline');
    if (f.kind !== 'kline') return;
    expect(f.symbol).toBe('BTCUSDT');
    expect(f.timeframe).toBe('1m');
    expect(f.candles).toHaveLength(1);
    expect(f.candles[0]).toEqual({
      // ts 1785727320 seconds → milliseconds
      time: 1785727320000,
      open: '63090.9',
      high: '63090.9',
      low: '63075.2',
      close: '63075.2',
      volume: '19672',
      closed: false,
    });
  });

  it('[2] the documented flat shape is also accepted', () => {
    // The docs show {symbol,o,h,l,c,v,ts} directly on `data`. Not what the server sends, but harmless to
    // support in case it ever does.
    const f = parseFrame(
      '{"group":"futures/klineBin5m:ETHUSDT","data":{"symbol":"ETHUSDT","o":"1","h":"2","l":"0.5","c":"1.5","v":"9","ts":1785727320}}',
    );
    expect(f.kind).toBe('kline');
    if (f.kind !== 'kline') return;
    expect(f.timeframe).toBe('5m');
    expect(f.candles[0]!.close).toBe('1.5');
  });

  it('[3] uppercase-suffix groups map back to lowercase timeframes', () => {
    const f = parseFrame(
      '{"group":"futures/klineBin1H:ETHUSDT","data":{"symbol":"ETHUSDT","items":[{"o":"1863.12","h":"1864.86","l":"1861.55","c":"1862.5","v":"9985502","ts":1785726000}]}}',
    );
    expect(f.kind).toBe('kline');
    if (f.kind !== 'kline') return;
    expect(f.timeframe).toBe('1h');
  });

  it('[4] streamed bars are marked not-closed', () => {
    const f = parseFrame(LIVE_1M);
    if (f.kind !== 'kline') throw new Error('expected kline');
    // The pushed bar is the in-progress one; treating it as closed would freeze the last candle.
    expect(f.candles[0]!.closed).toBe(false);
  });

  it('[5] prices are kept as strings, never numbers', () => {
    const f = parseFrame(LIVE_1M);
    if (f.kind !== 'kline') throw new Error('expected kline');
    for (const k of ['open', 'high', 'low', 'close', 'volume'] as const) {
      expect(typeof f.candles[0]![k], k).toBe('string');
    }
  });

  it('[6] unparseable rows are dropped, not zero-filled', () => {
    const f = parseFrame(
      '{"group":"futures/klineBin1m:BTCUSDT","data":{"symbol":"BTCUSDT","items":[{"o":"1","h":"2","l":"1","c":"2","v":"1","ts":1785727320},{"o":null,"ts":1785727380},{"h":"9"}]}}',
    );
    expect(f.kind).toBe('kline');
    if (f.kind !== 'kline') return;
    // A candle at 0 would render as a spike to the bottom of the chart.
    expect(f.candles).toHaveLength(1);
  });

  it('[7] a frame with no usable rows is unknown, not an empty kline', () => {
    const f = parseFrame('{"group":"futures/klineBin1m:BTCUSDT","data":{"symbol":"BTCUSDT","items":[]}}');
    expect(f.kind).toBe('unknown');
  });

  it('[8] an unknown suffix is not silently attributed to a timeframe', () => {
    const f = parseFrame(
      '{"group":"futures/klineBin7m:BTCUSDT","data":{"symbol":"BTCUSDT","items":[{"o":"1","h":"1","l":"1","c":"1","v":"1","ts":1}]}}',
    );
    expect(f.kind).toBe('unknown');
  });
});

describe('WSF-03 ping reply', () => {
  it('[1] the real System frame is recognised as a pong', () => {
    // Captured live. The docs promise a bare "pong" string; a client checking for that never sees a reply
    // and tears down a healthy socket on every ping interval.
    const f = parseFrame('{"group":"System","data":"pong+8f0547ab-3f55-455f-90d5-602ca741517e"}');
    expect(f.kind).toBe('pong');
  });

  it('[2] the documented bare string is also accepted', () => {
    expect(parseFrame('pong').kind).toBe('pong');
    expect(parseFrame('"pong"').kind).toBe('pong');
  });

  it('[3] an unrelated System frame is not a pong', () => {
    expect(parseFrame('{"group":"System","data":"maintenance"}').kind).toBe('unknown');
  });
});

describe('WSF-04 subscription acks', () => {
  it('[1] success', () => {
    const f = parseFrame(
      '{"action":"subscribe","group":"futures/klineBin1m:BTCUSDT","success":true,"request":{"action":"subscribe","args":["futures/klineBin1m:BTCUSDT"]}}',
    );
    expect(f).toEqual({
      kind: 'ack',
      action: 'subscribe',
      group: 'futures/klineBin1m:BTCUSDT',
      success: true,
      error: null,
    });
  });

  it('[2] failure carries the reason', () => {
    // This is exactly what the previous gateway's `spot/ticker:BTCUSDT` produced — on a futures platform.
    const f = parseFrame(
      '{"action":"subscribe","group":"spot/ticker:BTCUSDT","success":false,"error":"Invalid channel: not found spot/ticker:BTCUSDT"}',
    );
    expect(f.kind).toBe('ack');
    if (f.kind !== 'ack') return;
    expect(f.success).toBe(false);
    expect(f.error).toContain('Invalid channel');
  });
});

describe('WSF-05 ticker frames', () => {
  const LIVE =
    '{"group":"futures/ticker:BTCUSDT","data":{"symbol":"BTCUSDT","last_price":"63075.2","volume_24":"28626726","range":"-0.0067632789384093","mark_price":"63079.05778261","index_price":"63100.02847826","ask_price":"63075.3","ask_vol":"21269","bid_price":"63075.1","bid_vol":"428"}}';

  it('[1] `range` is a ratio and is converted to percent', () => {
    const f = parseFrame(LIVE);
    expect(f.kind).toBe('ticker');
    if (f.kind !== 'ticker') return;
    // -0.00676... is -0.68%, not -0.0068%. Treating it as a percent understates every move by 100x.
    expect(f.ticker.changePct).toBeCloseTo(-0.6763, 4);
    expect(f.ticker.last).toBe('63075.2');
    expect(f.ticker.markPrice).toBe('63079.05778261');
    expect(f.ticker.bid).toBe('63075.1');
  });

  it('[2] ratioToPercent rounds to 4dp and rejects junk', () => {
    expect(ratioToPercent('0.004')).toBe(0.4);
    expect(ratioToPercent('-0.0067632789384093')).toBe(-0.6763);
    expect(ratioToPercent(0)).toBe(0);
    expect(ratioToPercent('')).toBeNull();
    expect(ratioToPercent(null)).toBeNull();
    expect(ratioToPercent('abc')).toBeNull();
  });

  it('[3] a ticker without a last price is unknown rather than a zero quote', () => {
    expect(parseFrame('{"group":"futures/ticker:BTCUSDT","data":{"symbol":"BTCUSDT"}}').kind).toBe('unknown');
  });
});

describe('WSF-06 book ticker and trades', () => {
  it('[1] bookticker uses ms_t already in milliseconds', () => {
    const f = parseFrame(
      '{"group":"futures/bookticker:BTCUSDT","data":{"symbol":"BTCUSDT","best_bid_price":"63065.7","best_bid_vol":"20638","best_ask_price":"63065.8","best_ask_vol":"21844","ms_t":1785728207021}}',
    );
    expect(f.kind).toBe('bookticker');
    if (f.kind !== 'bookticker') return;
    // Not multiplied by 1000 — unlike kline `ts`, this field is already ms.
    expect(f.book.ts).toBe(1785728207021);
    expect(f.book.bid).toBe('63065.7');
    expect(f.book.askVol).toBe('21844');
  });

  it('[2] trade data is an ARRAY, unlike every other channel', () => {
    const f = parseFrame(
      '{"group":"futures/trade:BTCUSDT","data":[{"trade_id":3000001703796731,"symbol":"BTCUSDT","deal_price":"63065.7","deal_vol":"2","way":5,"m":true,"created_at":"2026-08-03T03:36:46.854049505Z"}]}',
    );
    expect(f.kind).toBe('trade');
    if (f.kind !== 'trade') return;
    expect(f.trades).toHaveLength(1);
    expect(f.trades[0]!.price).toBe('63065.7');
    expect(f.trades[0]!.buyerIsMaker).toBe(true);
    // trade_id arrives as a NUMBER large enough to lose precision as a float; kept as a string.
    expect(f.trades[0]!.tradeId).toBe('3000001703796731');
    // created_at is RFC3339 with nanoseconds, not an epoch.
    expect(f.trades[0]!.ts).toBe(Date.parse('2026-08-03T03:36:46.854Z'));
  });

  it('[3] a trade object instead of an array is not silently accepted', () => {
    expect(parseFrame('{"group":"futures/trade:BTCUSDT","data":{"deal_price":"1"}}').kind).toBe('unknown');
  });
});

describe('WSF-07 depth frames', () => {
  it('[1] way=1 is the bid side, way=2 the ask side', () => {
    // The server pushes ONE side per message; assuming both would build a half-empty book.
    const bid = parseFrame(
      '{"group":"futures/depth20:BTCUSDT@200ms","data":{"symbol":"BTCUSDT","way":1,"depths":[{"price":"63065.7","vol":"20638"},{"price":"63065.6","vol":"1013"}],"ms_t":1785728207021}}',
    );
    expect(bid.kind).toBe('depth');
    if (bid.kind !== 'depth') return;
    expect(bid.depth.side).toBe('bid');
    expect(bid.depth.levels).toEqual([
      { price: '63065.7', volume: '20638' },
      { price: '63065.6', volume: '1013' },
    ]);

    const ask = parseFrame(
      '{"group":"futures/depth20:BTCUSDT@200ms","data":{"symbol":"BTCUSDT","way":2,"depths":[{"price":"63065.8","vol":"1"}],"ms_t":1}}',
    );
    if (ask.kind !== 'depth') throw new Error('expected depth');
    expect(ask.depth.side).toBe('ask');
  });

  it('[2] levels missing a price are dropped', () => {
    const f = parseFrame(
      '{"group":"futures/depth20:BTCUSDT@200ms","data":{"symbol":"BTCUSDT","way":1,"depths":[{"price":"1","vol":"2"},{"vol":"3"}],"ms_t":1}}',
    );
    if (f.kind !== 'depth') throw new Error('expected depth');
    expect(f.depth.levels).toHaveLength(1);
  });
});

describe('WSF-08 malformed input never throws', () => {
  it('[1] junk becomes unknown', () => {
    for (const raw of ['', 'not json', '[]', 'null', '{}', '{"group":"futures/ticker:X"}', '123']) {
      expect(() => parseFrame(raw)).not.toThrow();
      expect(parseFrame(raw).kind, raw).toBe('unknown');
    }
  });
});

describe('WSF-09 REST kline for history and gap-fill', () => {
  it('[1] the URL uses minute steps and SECOND timestamps', () => {
    const url = restKlineUrl('https://api-cloud-v2.bitmart.com', 'BTCUSDT', '1h', 1785700000, 1785727320);
    expect(url).toContain('/contract/public/kline?');
    // step is minutes, not the WS suffix: 1h → 60.
    expect(url).toContain('step=60');
    expect(url).toContain('start_time=1785700000');
    expect(url).toContain('end_time=1785727320');
    expect(url).not.toContain('1H');
  });

  it('[2] step mapping covers every timeframe including 3m', () => {
    // 3m cannot be streamed but CAN be fetched, so the REST map must be complete.
    for (const tf of TIMEFRAMES) expect(REST_KLINE_STEP[tf], tf).toBeGreaterThan(0);
    expect(REST_KLINE_STEP['3m']).toBe(3);
    expect(REST_KLINE_STEP['1w']).toBe(10080);
  });

  it('[3] a trailing slash on the base does not double up', () => {
    expect(restKlineUrl('https://x.com/', 'S', '1m', 1, 2)).toContain('https://x.com/contract/public/kline?');
  });

  it('[4] REST rows use *_price names and are marked closed', () => {
    const c = parseRestKlines({
      code: 1000,
      data: [
        { timestamp: 1662518160, open_price: '100', close_price: '120', high_price: '130', low_price: '90', volume: '941008' },
      ],
    });
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({
      time: 1662518160000,
      open: '100',
      high: '130',
      low: '90',
      close: '120',
      volume: '941008',
      // Historical bars are complete, unlike streamed ones.
      closed: true,
    });
  });

  it('[5] a non-array body yields no candles rather than throwing', () => {
    expect(parseRestKlines(null)).toEqual([]);
    expect(parseRestKlines({})).toEqual([]);
    expect(parseRestKlines({ data: 'x' })).toEqual([]);
    expect(parseRestKlines({ code: 40038, message: 'The k-line step is invalid' })).toEqual([]);
  });
});
