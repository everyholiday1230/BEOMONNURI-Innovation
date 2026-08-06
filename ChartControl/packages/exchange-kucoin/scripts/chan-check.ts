/** 4채널이 실제로 콜백을 부르는지 개별 확인. */
import WebSocket from 'ws';
import { KucoinFuturesAdapter, createNodeSocketFactory } from '../src/index.js';

const a = new KucoinFuturesAdapter({ socketFactory: createNodeSocketFactory(WebSocket as never) });
// 계약 사양을 먼저 적재한다. 없으면 handleWsData 가 프레임을 전부 버린다.
await a.getSymbols();
await a.startStreaming();
await new Promise((r) => setTimeout(r, 3000));

const n = { ticker: 0, book: 0, trade: 0, candle: 0 };
const errs: string[] = [];
const tryIt = (label: string, fn: () => () => void) => {
  try { return fn(); } catch (e) { errs.push(`${label}: ${(e as Error).message}`); return () => {}; }
};

const u1 = tryIt('ticker', () => (a as never as { subscribeTicker: Function }).subscribeTicker('BTCUSDT', () => { n.ticker += 1; }));
const u2 = tryIt('book', () => a.subscribeBook('BTCUSDT', () => { n.book += 1; }));
const u3 = tryIt('trade', () => a.subscribeTrades('BTCUSDT', () => { n.trade += 1; }));
const u4 = tryIt('candle', () => a.subscribeCandles('BTCUSDT', '1m', () => { n.candle += 1; }));

await new Promise((r) => setTimeout(r, 12000));
console.log('  수신 횟수:', JSON.stringify(n));
console.log('  구독 오류:', errs.length ? errs : '없음');
const st = a.getStatus() as { stream: { topics: number; activeTopics: number } };
console.log(`  토픽: 요청=${st.stream.topics} 활성=${st.stream.activeTopics}`);
[u1,u2,u3,u4].forEach(u=>u());
a.stopStreaming(); process.exit(0);
