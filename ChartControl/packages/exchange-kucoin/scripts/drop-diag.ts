/**
 * 원시 WS 프레임 수와 정규화 통과 수를 비교한다.
 * 정규화가 조용히 데이터를 버리고 있는지 확인하기 위한 진단.
 */

import WebSocket from 'ws';

import { normalizeInstrument, normalizeTrade, normalizeOrderBook, normalizeWsCandle, normalizeLiveTicker } from '../src/normalize.js';
import { KucoinFuturesRest } from '../src/rest.js';
import { parseFrame } from '../src/ws-protocol.js';

const rest = new KucoinFuturesRest({ restBase: 'https://api-futures.kucoin.com' });
const contracts = (await rest.getActiveContracts()) as never[];
const xbt = contracts.map(normalizeInstrument).find((i) => i?.symbol === 'BTCUSDT')!;

const bullet = await rest.createPublicBullet();
const server = bullet.instanceServers[0]!;
const ws = new WebSocket(`${server.endpoint}?token=${encodeURIComponent(bullet.token)}&connectId=diag`);

const raw: Record<string, number> = {};
const normalized: Record<string, number> = {};
const dropped: Array<{ channel: string; data: string }> = [];

ws.on('open', () => {
  for (const t of [
    '/contractMarket/ticker:XBTUSDTM',
    '/contractMarket/level2Depth5:XBTUSDTM',
    '/contractMarket/execution:XBTUSDTM',
    '/contractMarket/limitCandle:XBTUSDTM_1min',
  ]) {
    ws.send(JSON.stringify({ id: t, type: 'subscribe', topic: t, response: true }));
  }
});

ws.on('message', (buf) => {
  const frame = parseFrame(String(buf));
  if (frame.kind !== 'data') return;
  raw[frame.channel] = (raw[frame.channel] ?? 0) + 1;

  let ok = false;
  switch (frame.channel) {
    case 'ticker':
      ok = normalizeLiveTicker(frame.data as never) !== null;
      break;
    case 'level2Depth5':
      ok = normalizeOrderBook(frame.data as never, xbt) !== null;
      break;
    case 'execution':
      ok = normalizeTrade(frame.data as never, xbt) !== null;
      break;
    case 'limitCandle': {
      const row = (frame.data as { candles?: Array<number | string> })?.candles;
      ok = Array.isArray(row) && normalizeWsCandle(row, xbt) !== null;
      break;
    }
  }
  if (ok) normalized[frame.channel] = (normalized[frame.channel] ?? 0) + 1;
  else if (dropped.length < 5) dropped.push({ channel: frame.channel, data: JSON.stringify(frame.data).slice(0, 260) });
});

setTimeout(() => {
  console.log('채널          원시수신  정규화통과  버려짐');
  const channels = new Set([...Object.keys(raw), ...Object.keys(normalized)]);
  let anyDropped = false;
  for (const ch of channels) {
    const r = raw[ch] ?? 0;
    const n = normalized[ch] ?? 0;
    if (r !== n) anyDropped = true;
    console.log(`  ${ch.padEnd(14)} ${String(r).padStart(6)} ${String(n).padStart(10)} ${String(r - n).padStart(7)}`);
  }
  if (dropped.length) {
    console.log('\n버려진 샘플:');
    dropped.forEach((d) => console.log(`  [${d.channel}] ${d.data}`));
  }
  console.log(`\n판정: ${anyDropped ? '정규화가 데이터를 버리고 있다 — 조사 필요' : '버려진 프레임 없음'}`);
  ws.close();
  process.exit(anyDropped ? 1 : 0);
}, 30000);
