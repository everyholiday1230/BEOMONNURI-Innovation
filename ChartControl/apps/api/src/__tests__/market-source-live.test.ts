/**
 * 시세 출처와 "실피드" 판정 검증.
 *
 * 왜 테스트가 필요한가
 * -------------------
 * apps/api/src/index.ts 의 marketDataStatus 게이트는 시세가 LIVE 일 때만
 * 실주문을 허용한다. 거래소를 추가하면서 이 판정에 새 출처를 넣는 것을 잊으면
 *  - 실피드인데 STALE 로 판정되어 주문이 조용히 막히거나
 *  - 반대로 목업이 LIVE 로 인정되어 가짜 가격으로 주문이 나갈 수 있다.
 * 두 경우 모두 돈이 걸린 실패이므로 판정 규칙을 테스트로 고정한다.
 */

import { describe, expect, it } from 'vitest';
import { DATA_MODES, TRADING_MODES } from '@quantumtrade/config';

import { selectProviders } from '../providers';
import { loadEnv } from '../env';

/** index.ts 의 LIVE_MARKET_SOURCES 와 반드시 같은 내용이어야 한다. */
const LIVE_MARKET_SOURCES = new Set(['kucoin_public', 'bitmart_public']);

function envWith(overrides: Record<string, string>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return loadEnv();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('데이터 모드 정의', () => {
  it('KUCOIN_PUBLIC 이 등록되어 있다 (현재 운영 모드)', () => {
    expect(DATA_MODES).toContain('KUCOIN_PUBLIC');
  });

  it('BITMART_PUBLIC 을 지우지 않았다 (기존 어댑터·테스트 보존)', () => {
    expect(DATA_MODES).toContain('BITMART_PUBLIC');
  });

  it('MOCK_REPLAY 가 남아 있다 (오프라인 개발·테스트)', () => {
    expect(DATA_MODES).toContain('MOCK_REPLAY');
  });

  it('KUCOIN_LIVE 주문 모드가 등록되어 있다', () => {
    expect(TRADING_MODES).toContain('KUCOIN_LIVE');
  });
});

describe('provider 선택', () => {
  it('KUCOIN_PUBLIC 은 캔들·오더북·체결을 모두 같은 실 어댑터로 제공한다', () => {
    const p = selectProviders(envWith({ DATA_MODE: 'KUCOIN_PUBLIC' }));
    expect(p.source).toBe('kucoin_public');
    // BitMart 모드는 오더북/체결이 목업이었다. KuCoin 은 하나의 어댑터가 셋을 다 구현한다.
    expect(p.book).toBe(p.market);
    expect(p.trades).toBe(p.market);
    expect(p.market.name).toBe('kucoin-futures');
  });

  it('KUCOIN_PUBLIC 은 스트리밍 제어 표면을 노출한다', () => {
    const p = selectProviders(envWith({ DATA_MODE: 'KUCOIN_PUBLIC' }));
    expect(p.streaming).toBeDefined();
    expect(typeof p.streaming!.start).toBe('function');
    expect(typeof p.streaming!.stop).toBe('function');
    expect(typeof p.streaming!.status).toBe('function');
  });

  it('MOCK_REPLAY 는 스트리밍을 노출하지 않는다', () => {
    const p = selectProviders(envWith({ DATA_MODE: 'MOCK_REPLAY' }));
    expect(p.source).toBe('mock_replay');
    expect(p.streaming).toBeUndefined();
  });

  it('알 수 없는 DATA_MODE 는 목업으로 떨어진다 (fail-safe)', () => {
    const p = selectProviders(envWith({ DATA_MODE: 'SOMETHING_ELSE' }));
    expect(p.source).toBe('mock_replay');
  });
});

describe('실피드 판정 (주문 신선도 게이트)', () => {
  it('실 거래소 출처는 LIVE 로 인정된다', () => {
    for (const mode of ['KUCOIN_PUBLIC', 'BITMART_PUBLIC']) {
      const p = selectProviders(envWith({ DATA_MODE: mode }));
      expect(LIVE_MARKET_SOURCES.has(p.source), `${mode} → ${p.source}`).toBe(true);
    }
  });

  it('목업은 LIVE 로 인정되지 않는다 — 가짜 가격으로 주문이 나가면 안 된다', () => {
    const p = selectProviders(envWith({ DATA_MODE: 'MOCK_REPLAY' }));
    expect(LIVE_MARKET_SOURCES.has(p.source)).toBe(false);
  });

  it('모든 DATA_MODE 가 판정 대상에 빠짐없이 분류된다', () => {
    // 새 모드를 추가하고 판정에서 잊는 것을 막는다.
    for (const mode of DATA_MODES) {
      const p = selectProviders(envWith({ DATA_MODE: mode }));
      const isLive = LIVE_MARKET_SOURCES.has(p.source);
      const expectLive = mode !== 'MOCK_REPLAY';
      expect(isLive, `${mode} → ${p.source} (live=${isLive})`).toBe(expectLive);
    }
  });
});

describe('KuCoin 레이트리밋 설정', () => {
  it('기본값은 KuCoin 문서 한도(12회/2초) 안에 있다', () => {
    const env = envWith({ DATA_MODE: 'KUCOIN_PUBLIC' });
    expect(env.kucoinRestMaxRps).toBeLessThanOrEqual(6);
    expect(env.kucoinRestMaxRps).toBeGreaterThan(0);
  });

  it('범위를 벗어난 값은 안전한 범위로 강제된다 (IP 차단 방지)', () => {
    const tooHigh = envWith({ DATA_MODE: 'KUCOIN_PUBLIC', KUCOIN_REST_MAX_RPS: '9999' });
    expect(tooHigh.kucoinRestMaxRps).toBeLessThanOrEqual(12);

    const tooLow = envWith({ DATA_MODE: 'KUCOIN_PUBLIC', KUCOIN_REST_MAX_RPS: '-5' });
    expect(tooLow.kucoinRestMaxRps).toBeGreaterThanOrEqual(1);

    const garbage = envWith({ DATA_MODE: 'KUCOIN_PUBLIC', KUCOIN_REST_MAX_RPS: 'abc' });
    expect(garbage.kucoinRestMaxRps).toBe(5);
  });
});

describe('브로커 자격증명', () => {
  it('설정하지 않으면 빈 문자열이다 (부분 설정으로 400201 을 유발하지 않는다)', () => {
    const env = envWith({ DATA_MODE: 'KUCOIN_PUBLIC' });
    expect(env.kucoinBrokerPartner).toBe('');
    expect(env.kucoinBrokerKey).toBe('');
    expect(env.kucoinBrokerName).toBe('');
  });

  it('공백만 있는 값은 빈 문자열로 정리된다', () => {
    const env = envWith({
      DATA_MODE: 'KUCOIN_PUBLIC',
      KUCOIN_BROKER_PARTNER: '   ',
      KUCOIN_BROKER_KEY: '\t',
      KUCOIN_BROKER_NAME: ' ',
    });
    expect(env.kucoinBrokerPartner).toBe('');
    expect(env.kucoinBrokerKey).toBe('');
    expect(env.kucoinBrokerName).toBe('');
  });
});
