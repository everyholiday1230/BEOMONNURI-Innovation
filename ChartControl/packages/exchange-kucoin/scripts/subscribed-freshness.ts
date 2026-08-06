/**
 * 구독이 있는 상태에서 신선도 판정이 어떻게 나오는지 실 KuCoin 으로 확인한다.
 * 단위테스트는 가짜 소켓을 쓰므로, 실제 데이터 흐름에서 dataStaleMs 가
 * 갱신되는지는 여기서만 검증할 수 있다.
 */
import WebSocket from 'ws';
import { KucoinFuturesAdapter, createNodeSocketFactory } from '@quantumtrade/exchange-kucoin';
import { computeMarketDataStatus } from '../../../apps/api/src/market-freshness.js';

const a = new KucoinFuturesAdapter({
  socketFactory: createNodeSocketFactory(WebSocket as never),
  onConnectionState: (s, d) => console.log("  [state]", s, d?.reason ?? ""),
});

const providers = {
  market: a, book: a, trades: a, source: 'kucoin_public' as const,
  streaming: { start: () => a.startStreaming(), stop: () => a.stopStreaming(), status: () => a.getStatus() },
};

const show = (label: string) => {
  const st = a.getStatus() as any;
  console.log(`  ${label.padEnd(22)} status=${computeMarketDataStatus(providers as any).padEnd(5)} ` +
    `topics=${st.stream.topics} active=${st.stream.activeTopics} ` +
    `dataStaleMs=${st.stream.dataStaleMs} staleMs=${st.stream.staleMs}`);
};

await a.startStreaming();
await new Promise((r) => setTimeout(r, 4000));
show('구독 전');

const unsub = a.subscribeTicker('BTCUSDT', () => {});
await new Promise((r) => setTimeout(r, 6000));
show('구독 + 데이터 수신');

unsub();
await new Promise((r) => setTimeout(r, 2000));
show('구독 해제 후');

a.stopStreaming();
process.exit(0);
