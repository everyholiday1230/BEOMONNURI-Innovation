/**
 * 시세 신선도 판정 검증 — 주문 안전 게이트.
 *
 * 왜 이 테스트가 중요한가
 * ----------------------
 * packages/domain/src/risk-gates.ts 의 freshness 게이트는 marketDataStatus 가
 * 'LIVE' 가 아니면 주문 제출을 차단한다. 즉 이 함수가 잘못 'LIVE' 를 반환하면
 * 멈춘 시세(예: WS 가 30분 전에 끊긴 상태)의 오래된 가격으로 실주문이 나간다.
 *
 * "죽은 시세를 live 로 보여주는 것"이 이 시스템에서 가장 위험한 실패 모드다.
 * 따라서 판정 규칙 전부를 여기서 고정한다.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MARKET_STALE_LIMIT_MS,
  LIVE_MARKET_SOURCES,
  computeMarketDataStatus,
} from '../market-freshness';
import type { MarketProviders } from '../providers';

/** 판정에 쓰이는 부분만 갖춘 가짜 provider. 네트워크를 타지 않는다. */
function fakeProviders(
  source: MarketProviders['source'],
  streamStatus?: unknown | (() => never),
): MarketProviders {
  const base = { market: {}, book: {}, trades: {}, source } as unknown as MarketProviders;
  if (streamStatus === undefined) return base;
  return {
    ...base,
    streaming: {
      start: async () => {},
      stop: () => {},
      status: typeof streamStatus === 'function' ? (streamStatus as () => never) : () => streamStatus,
    },
  };
}

function liveStream(staleMs: number | null = 1_000) {
  // 구독 없는 건강한 연결. 데이터가 안 오는 것이 정상인 상태.
  return { breaker: 'closed', stream: { state: 'live', staleMs, topics: 0, activeTopics: 0 } };
}

/** 구독이 있는 연결. dataStaleMs 로 실데이터 흐름을 표현한다. */
function subscribedStream(dataStaleMs: number | null, staleMs = 1_000) {
  return {
    breaker: 'closed',
    stream: { state: 'live', staleMs, dataStaleMs, topics: 4, activeTopics: 4 },
  };
}

afterEach(() => {
  delete process.env.MARKET_STALE_LIMIT_MS;
});

describe('출처 기준 판정', () => {
  it('목업 출처는 스트림이 건강해도 STALE 이다', () => {
    // 목업이 LIVE 로 인정되면 픽스처 가격으로 주문이 나간다.
    expect(computeMarketDataStatus(fakeProviders('mock_replay', liveStream()))).toBe('STALE');
  });

  it('알 수 없는 출처는 STALE 이다 (fail-safe)', () => {
    const p = fakeProviders('something_new' as MarketProviders['source'], liveStream());
    expect(computeMarketDataStatus(p)).toBe('STALE');
  });

  it('LIVE_MARKET_SOURCES 에 현재 운영 거래소가 들어 있다', () => {
    expect(LIVE_MARKET_SOURCES.has('kucoin_public')).toBe(true);
  });
});

describe('스트림 상태 기준 판정 (핵심)', () => {
  it('실 거래소 + 스트림 live + 최근 메시지 → LIVE', () => {
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', liveStream(1_000)))).toBe('LIVE');
  });

  it('회로차단기가 열려 있으면 STALE — REST 가 막힌 상태다', () => {
    const p = fakeProviders('kucoin_public', { breaker: 'open', stream: { state: 'live', staleMs: 100 } });
    expect(computeMarketDataStatus(p)).toBe('STALE');
  });

  it.each(['lost', 'connecting', 'idle', 'closed', ''])(
    'stream.state=%s 는 STALE 이다',
    (state) => {
      const p = fakeProviders('kucoin_public', { breaker: 'closed', stream: { state, staleMs: 10 } });
      expect(computeMarketDataStatus(p)).toBe('STALE');
    },
  );

  it('메시지를 한 번도 못 받았으면(staleMs=null) STALE 이다', () => {
    // null 을 0 으로 오해하면 "방금 받았다"로 잘못 판정된다.
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', liveStream(null)))).toBe('STALE');
  });

  it('staleMs 가 없어도 STALE 이다', () => {
    const p = fakeProviders('kucoin_public', { breaker: 'closed', stream: { state: 'live' } });
    expect(computeMarketDataStatus(p)).toBe('STALE');
  });

  it('임계값을 넘으면 STALE — 연결은 살아 있지만 데이터가 멈춘 경우', () => {
    const over = DEFAULT_MARKET_STALE_LIMIT_MS + 1;
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', liveStream(over)))).toBe('STALE');
  });

  it('임계값 경계값은 LIVE 다 (초과일 때만 차단)', () => {
    const p = fakeProviders('kucoin_public', liveStream(DEFAULT_MARKET_STALE_LIMIT_MS));
    expect(computeMarketDataStatus(p)).toBe('LIVE');
  });

  it('status() 가 던지면 STALE 이다 — 읽을 수 없으면 살아 있다고 가정하지 않는다', () => {
    const p = fakeProviders('kucoin_public', () => {
      throw new Error('boom');
    });
    expect(computeMarketDataStatus(p)).toBe('STALE');
  });

  it('status() 가 null 을 주면 STALE 이다', () => {
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', null))).toBe('STALE');
  });
});

describe('스트리밍을 노출하지 않는 어댑터', () => {
  it('실 출처면 LIVE 로 본다 (BitMart 기존 동작 유지)', () => {
    // 스트림 표면이 없으면 신선도를 알 방법이 없다. 기존 거래소 동작을 바꾸지 않는다.
    expect(computeMarketDataStatus(fakeProviders('bitmart_public'))).toBe('LIVE');
  });

  it('목업이면 여전히 STALE 이다', () => {
    expect(computeMarketDataStatus(fakeProviders('mock_replay'))).toBe('STALE');
  });
});

describe('임계값 환경변수', () => {
  it('설정하면 반영된다', () => {
    process.env.MARKET_STALE_LIMIT_MS = '5000';
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', liveStream(6_000)))).toBe('STALE');
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', liveStream(4_000)))).toBe('LIVE');
  });

  it('0 이나 음수는 기본값으로 떨어진다 — 주문 영구 차단을 막는다', () => {
    for (const bad of ['0', '-1', 'abc', '']) {
      process.env.MARKET_STALE_LIMIT_MS = bad;
      const p = fakeProviders('kucoin_public', liveStream(1_000));
      expect(computeMarketDataStatus(p), `MARKET_STALE_LIMIT_MS=${bad}`).toBe('LIVE');
    }
  });
});

describe('데이터 흐름 기준 판정 (pong 이 죽은 구독을 가리는 것을 막는다)', () => {
  it('구독 없으면 데이터가 안 와도 LIVE — 아무도 차트를 안 볼 때 주문을 막지 않는다', () => {
    // 실측: 구독 0 상태에서 staleMs 는 ping 주기(18초)마다 리셋되며 30초를 넘지 않는다.
    const p = fakeProviders('kucoin_public', {
      breaker: 'closed',
      stream: { state: 'live', staleMs: 17_900, topics: 0, activeTopics: 0, dataStaleMs: null },
    });
    expect(computeMarketDataStatus(p)).toBe('LIVE');
  });

  it('구독이 있고 데이터가 최근이면 LIVE', () => {
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', subscribedStream(500)))).toBe('LIVE');
  });

  it('구독이 있는데 데이터가 멈추면 STALE — pong 만 오는 상태', () => {
    // 연결은 건강하다(staleMs 작음). 그런데 시세는 안 온다. 이게 가장 위험한 상태다.
    const p = fakeProviders('kucoin_public', subscribedStream(DEFAULT_MARKET_STALE_LIMIT_MS + 1, 500));
    expect(computeMarketDataStatus(p)).toBe('STALE');
  });

  it('구독했는데 한 건도 못 받았으면 STALE', () => {
    expect(computeMarketDataStatus(fakeProviders('kucoin_public', subscribedStream(null)))).toBe('STALE');
  });

  it('구독 있음 + dataStaleMs 경계값은 LIVE', () => {
    const p = fakeProviders('kucoin_public', subscribedStream(DEFAULT_MARKET_STALE_LIMIT_MS));
    expect(computeMarketDataStatus(p)).toBe('LIVE');
  });

  it('연결이 죽었으면 데이터가 최근이어도 STALE (연결 판정이 먼저다)', () => {
    const p = fakeProviders('kucoin_public', subscribedStream(100, DEFAULT_MARKET_STALE_LIMIT_MS + 1));
    expect(computeMarketDataStatus(p)).toBe('STALE');
  });
});

describe('ping 주기와 임계값의 관계', () => {
  it('기본 임계값은 KuCoin ping 주기(18초)보다 넉넉히 크다', () => {
    // 임계값이 ping 주기보다 작으면 구독 없는 건강한 연결이 주기적으로 STALE 로
    // 뒤집혀 주문이 무작위로 차단된다. 실측 최대 staleMs 는 17,997ms 였다.
    const OBSERVED_MAX_PING_GAP_MS = 18_000;
    expect(DEFAULT_MARKET_STALE_LIMIT_MS).toBeGreaterThan(OBSERVED_MAX_PING_GAP_MS);
  });
});
