/** 이식한 KuCoin 패키지를 실 API 에 붙여 검증한다. 목업 없음. */
import {
  KucoinFuturesRest, normalizeInstrument, normalizeTickerFromContract,
  normalizeOrderBook, normalizeTrades, normalizeRestCandles,
  planKlinePages, mergeCandlePages, inspectCandleContinuity, isContinuitySuspicious,
  toKucoinSymbol, toGranularity,
} from '../src/index.js';
import type { Candle } from '@quantumtrade/schemas';

const rest = new KucoinFuturesRest({ restBase: 'https://api-futures.kucoin.com' });

const contracts = (await rest.getActiveContracts()) as any[];
const instruments = contracts.map(normalizeInstrument).filter(Boolean) as NonNullable<ReturnType<typeof normalizeInstrument>>[];
console.log(`계약 사양: 원본 ${contracts.length}건 -> 정규화 ${instruments.length}건 (USDT 무기한만)`);

const want = ['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT','MATICUSDT','TONUSDT'];
const byId = new Map(instruments.map(i => [i.symbol, i]));
for (const s of want) {
  const i = byId.get(s);
  const k = toKucoinSymbol(s);
  if (!i) { console.log(`  ${s.padEnd(10)} 미상장 (kucoin=${k})`); continue; }
  console.log(`  ${s.padEnd(10)} -> ${i.exchangeSymbol.padEnd(10)} tick=${i.info.tickSize.padEnd(9)} step=${i.info.stepSize.padEnd(8)} mult=${i.multiplier} lev=${i.info.maxLeverage}`);
}

const btc = byId.get('BTCUSDT')!;
const tickers = contracts.map(normalizeTickerFromContract).filter(Boolean);
const bt = tickers.find(t => t!.symbol === 'BTCUSDT')!;
console.log(`\n티커: last=${bt.last} chg=${bt.changePct.toFixed(2)}% hi=${bt.high24h} lo=${bt.low24h} vol24h(USDT)=${bt.vol24h} funding=${bt.fundingRate}`);

const book = normalizeOrderBook(await rest.getDepth20(btc.exchangeSymbol) as any, btc, { isSnapshot: true })!;
console.log(`\n오더북 (${book.bids.length}x${book.asks.length}) asOf=${new Date(book.asOf).toISOString().slice(11,19)}`);
console.log('  best bid', book.bids[0], ' best ask', book.asks[0]);
const spread = Number(book.asks[0]![0]) - Number(book.bids[0]![0]);
console.log(`  스프레드 ${spread.toFixed(4)} (음수면 정렬 오류)`, spread > 0 ? 'OK' : 'FAIL');

const trades = normalizeTrades(await rest.getTradeHistory(btc.exchangeSymbol) as any, btc);
console.log(`\n체결 ${trades.length}건, 최근 3건:`);
trades.slice(0,3).forEach(t => console.log(`  ${new Date(t.ts).toISOString().slice(11,19)} ${t.side.padEnd(4)} ${t.price} x ${t.size}`));

// 페이징으로 220개 요청
const g = toGranularity('15m')!;
const pages = planKlinePages(g, 220, Date.now());
console.log(`\n캔들 페이징: ${pages.length}페이지 (${pages.map(p=>p.rows).join('+')})`);
const results: Candle[][] = [];
for (const p of pages) {
  const rows = await rest.getKlines(btc.exchangeSymbol, g, p.from, p.to);
  results.push(normalizeRestCandles(rows, btc));
}
const candles = mergeCandlePages(results, 220);
const health = inspectCandleContinuity(candles, g);
const first = candles[0]!, last = candles[candles.length-1]!;
console.log(`  결과 ${candles.length}개  ${new Date(first.time).toISOString().slice(5,16)} ~ ${new Date(last.time).toISOString().slice(5,16)}`);
console.log(`  마지막 캔들 지연 ${(health.staleMs!/60000).toFixed(1)}분 | 구멍 ${health.gaps.length}개 최대 ${health.maxGap} 총 ${health.totalMissing}`);
console.log(`  의심 판정: ${isContinuitySuspicious(health, candles.length, g)} (false 여야 정상)`);
const badOhlc = candles.filter(c => !(Number(c.high) >= Math.max(Number(c.open),Number(c.close)) && Number(c.low) <= Math.min(Number(c.open),Number(c.close))));
console.log(`  OHLC 불변식 위반 ${badOhlc.length}개`);
console.log(`  모든 가격이 십진문자열: ${candles.every(c => /^-?\d+(\.\d+)?$/.test(c.close)) ? 'OK' : 'FAIL'}`);

const bullet = await rest.createPublicBullet();
console.log(`\nWS 토큰: 발급됨 (endpoint=${bullet.instanceServers[0]!.endpoint} ping=${bullet.instanceServers[0]!.pingInterval}ms)`);
console.log(`\n회로차단기 상태: ${rest.breakerState}`);
