import type { MarketProviders } from './providers';

/**
 * 실 거래소 피드로 인정되는 데이터 출처.
 *
 * 이 집합에 없으면 주문 신선도 게이트가 STALE 로 판정해 실주문을 막는다.
 * 거래소를 추가할 때 providers.ts 의 source 값을 여기에도 넣어야 한다.
 * (테스트: apps/api/src/__tests__/market-source-live.test.ts)
 */
export const LIVE_MARKET_SOURCES = new Set(['kucoin_public', 'bitmart_public']);

/**
 * 시세가 실제로 살아 있다고 인정할 최대 무소식 시간.
 *
 * KuCoin 은 ticker 를 초당 수 회 보낸다. 30초간 아무 메시지도 없으면 연결이
 * 살아 있다고 보고돼도 데이터는 멈춘 것이다. 환경변수로 조정 가능하게 두되
 * 기본값은 보수적으로 잡는다.
 */
export const DEFAULT_MARKET_STALE_LIMIT_MS = 30_000;

/**
 * 호출 시점에 읽는다. 모듈 로드 시점에 고정하면 배포 후 값을 바꿀 수 없고
 * 테스트에서 임계값을 다르게 줄 수도 없다.
 */
function staleLimitMs(): number {
  const n = Number(process.env.MARKET_STALE_LIMIT_MS);
  // 0 이나 음수를 허용하면 항상 STALE 이 되어 주문이 영구 차단된다.
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MARKET_STALE_LIMIT_MS;
  return n;
}

/** providers.streaming.status() 가 반환하는 모양 중 우리가 판정에 쓰는 부분. */
interface StreamStatusShape {
  breaker?: string;
  stream?: {
    state?: string;
    staleMs?: number | null;
    /** 실데이터 기준 경과. pong 은 포함되지 않는다. */
    dataStaleMs?: number | null;
    /** 실제로 데이터가 흐르고 있는 토픽 수. */
    activeTopics?: number;
    /** 구독 요청된 토픽 수. */
    topics?: number;
  };
}

/**
 * 주문 신선도 게이트에 넘길 시세 상태를 계산한다.
 *
 * 출처가 실 거래소인 것만으로는 부족하다 — WS 가 끊기거나 회로차단기가 열린
 * 상태에서 LIVE 로 보고하면, 오래된 가격으로 실주문이 나간다. 그래서
 *   ① 출처가 실 거래소여야 하고
 *   ② 스트림 상태가 live 여야 하고
 *   ③ 마지막 메시지가 임계값 안이어야
 * LIVE 로 인정한다. 판단이 불가능하면 STALE 로 떨어뜨린다 (fail-safe).
 */
export function computeMarketDataStatus(p: MarketProviders): 'LIVE' | 'STALE' {
  if (!LIVE_MARKET_SOURCES.has(p.source)) return 'STALE';

  // 스트리밍을 노출하지 않는 어댑터(BitMart)는 REST 신선도를 따로 알 수 없다.
  // 기존 동작을 유지해 출처 기준으로 판정한다.
  if (!p.streaming) return 'LIVE';

  try {
    const st = p.streaming.status() as StreamStatusShape;
    if (st?.breaker === 'open') return 'STALE';
    if (st?.stream?.state !== 'live') return 'STALE';

    // 연결 자체의 신선도. pong 이 18초마다 갱신하므로 소켓이 죽으면 여기서 잡힌다.
    const staleMs = st.stream.staleMs;
    // null 은 "메시지를 한 번도 못 받았다"는 뜻이다. 0 으로 오해하면 안 된다.
    if (staleMs === null || staleMs === undefined) return 'STALE';
    if (staleMs > staleLimitMs()) return 'STALE';

    // 데이터 흐름의 신선도.
    //
    // 구독이 없으면(topics=0) 데이터가 안 오는 것이 정상이다 — 아무도 차트를
    // 보지 않는 시간대에 주문을 차단하면 안 된다. 이때는 연결 상태만으로 판정한다.
    //
    // 구독이 있으면 데이터가 흘러야 한다. pong 만 오고 시세가 멈춘 상태를
    // LIVE 로 인정하면 오래된 가격으로 주문이 나간다.
    const topics = st.stream.topics ?? 0;
    if (topics > 0) {
      const dataStaleMs = st.stream.dataStaleMs;
      // 구독했는데 한 건도 못 받았다면 아직 시세를 신뢰할 수 없다.
      if (dataStaleMs === null || dataStaleMs === undefined) return 'STALE';
      if (dataStaleMs > staleLimitMs()) return 'STALE';
    }

    return 'LIVE';
  } catch {
    // 상태를 읽을 수 없으면 살아 있다고 가정하지 않는다.
    return 'STALE';
  }
}
