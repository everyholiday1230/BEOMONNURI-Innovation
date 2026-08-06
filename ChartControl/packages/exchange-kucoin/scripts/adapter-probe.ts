/**
 * 어댑터를 실 KuCoin API + 실 WebSocket 에 붙여 검증한다. 목업 없음.
 *
 * 실행: cd "차트 컨트롤" && npx tsx packages/exchange-kucoin/scripts/adapter-probe.ts
 */

import WebSocket from 'ws';
import type { IMarketDataProvider, IOrderBookAdapter, ITradesAdapter } from '@quantumtrade/exchange-adapters';

import { KucoinFuturesAdapter, createNodeSocketFactory } from '../src/index.js';

const states: string[] = [];
const diagnostics: string[] = [];

const adapter = new KucoinFuturesAdapter({
  restBase: 'https://api-futures.kucoin.com',
  socketFactory: createNodeSocketFactory(WebSocket as never),
  onConnectionState: (s, d) => {
    states.push(d?.reason ? `${s}(${d.reason})` : s);
    console.log(`  [상태] ${s}${d?.attempt ? ` attempt=${d.attempt}` : ''}${d?.reason ? ` — ${d.reason}` : ''}`);
  },
  onDiagnostic: (m, meta) => {
    diagnostics.push(m);
    console.log(`  [진단] ${m}`, JSON.stringify(meta));
  },
});

// 인터페이스를 실제로 만족하는지 컴파일 타임에 못 박는다.
const asMarketData: IMarketDataProvider = adapter;
const asOrderBook: IOrderBookAdapter = adapter;
const asTrades: ITradesAdapter = adapter;

console.log('=== 1. 인터페이스 구현 확인 ===');
console.log(`  name=${asMarketData.name}`);
console.log(`  IMarketDataProvider: ${typeof asMarketData.getSymbols === 'function' && typeof asMarketData.getCandles === 'function' && typeof asMarketData.getTicker === 'function' && typeof asMarketData.getTickers === 'function' && typeof asMarketData.subscribeCandles === 'function' ? 'OK' : 'FAIL'}`);
console.log(`  IOrderBookAdapter:   ${typeof asOrderBook.getSnapshot === 'function' && typeof asOrderBook.subscribeBook === 'function' ? 'OK' : 'FAIL'}`);
console.log(`  ITradesAdapter:      ${typeof asTrades.getRecent === 'function' && typeof asTrades.subscribeTrades === 'function' ? 'OK' : 'FAIL'}`);

console.log('\n=== 2. getSymbols (계약 사양) ===');
const symbols = await asMarketData.getSymbols();
console.log(`  ${symbols.length}개 심볼`);
for (const id of ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'MATICUSDT']) {
  const s = symbols.find((x) => x.id === id);
  console.log(`  ${id.padEnd(10)} ${s ? `tick=${s.tickSize.padEnd(9)} step=${s.stepSize.padEnd(7)} pricePrec=${s.pricePrecision} qtyPrec=${s.quantityPrecision} lev=${s.maxLeverage}` : '없음'}`);
}
console.log(`  TONUSDT 지원 여부: ${adapter.isSupported('TONUSDT')} (false 여야 정상)`);

console.log('\n=== 3. getTickers (1회 호출로 전 심볼) ===');
const tickers = await asMarketData.getTickers();
const bt = tickers.find((t) => t.symbol === 'BTCUSDT')!;
console.log(`  ${tickers.length}개 티커`);
console.log(`  BTC last=${bt.last} chg=${bt.changePct.toFixed(2)}% hi=${bt.high24h} lo=${bt.low24h} vol=${bt.vol24h}`);

console.log('\n=== 4. getCandles (페이징 220개) ===');
const candles = await asMarketData.getCandles({ symbol: 'BTCUSDT', timeframe: '15m', limit: 220 });
const f = candles[0]!, l = candles[candles.length - 1]!;
console.log(`  ${candles.length}개  ${new Date(f.time).toISOString().slice(5, 16)} ~ ${new Date(l.time).toISOString().slice(5, 16)}`);
console.log(`  마지막 캔들 지연 ${((Date.now() - l.time) / 60000).toFixed(1)}분`);
const badOhlc = candles.filter((c) => !(Number(c.high) >= Math.max(Number(c.open), Number(c.close)) && Number(c.low) <= Math.min(Number(c.open), Number(c.close))));
console.log(`  OHLC 위반 ${badOhlc.length}개 / 십진문자열 준수 ${candles.every((c) => /^-?\d+(\.\d+)?$/.test(c.close)) ? 'OK' : 'FAIL'}`);

console.log('\n=== 5. 미지원 심볼/타임프레임은 명시적으로 실패 ===');
for (const [sym, tf] of [['TONUSDT', '15m'], ['BTCUSDT', '3m']] as const) {
  try {
    await asMarketData.getCandles({ symbol: sym, timeframe: tf as never, limit: 10 });
    console.log(`  ${sym} ${tf} -> FAIL (거부해야 하는데 통과했다)`);
  } catch (e) {
    console.log(`  ${sym} ${tf} -> 거부됨: ${(e as Error).message}`);
  }
}

console.log('\n=== 6. getSnapshot / getRecent ===');
const book = await asOrderBook.getSnapshot('BTCUSDT', 5);
const spread = Number(book.asks[0]![0]) - Number(book.bids[0]![0]);
console.log(`  오더북 ${book.bids.length}x${book.asks.length} bestBid=${book.bids[0]![0]} bestAsk=${book.asks[0]![0]} 스프레드=${spread.toFixed(4)} ${spread > 0 ? 'OK' : 'FAIL'}`);
console.log(`  수량 단위 확인: ${book.bids[0]![1]} (계약수가 아니라 BTC 여야 함)`);
const recent = await asTrades.getRecent('BTCUSDT', 3);
recent.forEach((t) => console.log(`  체결 ${new Date(t.ts).toISOString().slice(11, 19)} ${t.side.padEnd(4)} ${t.price} x ${t.size}`));

console.log('\n=== 7. 실 WebSocket 스트리밍 ===');
await adapter.startStreaming();

const counts = { ticker: 0, book: 0, trade: 0, candle: 0 };
const samples: Record<string, string> = {};

const offTicker = adapter.subscribeTicker('BTCUSDT', (t) => { counts.ticker++; samples.ticker ??= `last=${t.last}`; });
const offBook = asOrderBook.subscribeBook('BTCUSDT', (b) => { counts.book++; samples.book ??= `bid=${b.bids[0]?.[0]} ask=${b.asks[0]?.[0]}`; });
const offTrade = asTrades.subscribeTrades('BTCUSDT', (t) => { counts.trade++; samples.trade ??= `${t.side} ${t.price} x ${t.size}`; });
const offCandle = asMarketData.subscribeCandles('BTCUSDT', '1m', (c) => { counts.candle++; samples.candle ??= `O=${c.open} H=${c.high} L=${c.low} C=${c.close} closed=${c.closed}`; });

await new Promise((r) => setTimeout(r, 25000));

console.log('  수신 건수:', JSON.stringify(counts));
for (const [k, v] of Object.entries(samples)) console.log(`  ${k}: ${v}`);
console.log('  스트림 상태:', JSON.stringify(adapter.getStatus().stream));

console.log('\n=== 8. 마지막 구독자 해제 시 업스트림도 닫히는가 ===');
const before = adapter.getStatus().stream!.topics;
offTicker(); offBook(); offTrade(); offCandle();
const after = adapter.getStatus().stream!.topics;
console.log(`  구독 토픽 ${before} -> ${after} ${after === 0 ? 'OK' : 'FAIL (누수)'}`);

adapter.stopStreaming();
console.log('\n=== 요약 ===');
console.log(`  상태 전이: ${states.join(' -> ')}`);
console.log(`  진단 메시지 ${diagnostics.length}건`);
const ok = counts.ticker > 0 && counts.book > 0 && counts.candle > 0 && after === 0 && badOhlc.length === 0 && spread > 0;
console.log(`  전체 판정: ${ok ? 'OK' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
