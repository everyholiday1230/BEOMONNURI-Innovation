/**
 * 킬스위치 fail-open 을 막는 테스트.
 *
 * ★★ 무엇이 문제였나
 *
 *   `killActive()` 는 상태를 **한 번도 읽지 못했을 때 false(차단 아님)** 를 돌려줬다.
 *   그래서 운영자가 관리자 화면에서 `global_live_trading` 을 걸어 뒀는데도 주문이 계속
 *   나가는 상태가 가능했다. 부팅 로그에 흔적은 남았지만 **강제는 없었다.**
 *
 *   두 번째 구멍도 있었다. `controls` 는 admin 초기화 try 블록 안에서 만들어져 조건부로
 *   주입된다. 마이그레이션 미적용 등으로 그 블록이 던지면 `controls` 가 아예 없고,
 *   `d.controls?.killActive(sc) ?? false` → 차단 없음이 됐다. 즉 **관리자 기능이 깨진
 *   상태가 곧 모든 킬스위치 해제**였다.
 *
 * 여기서 고정하는 것:
 *   1. 상태를 모르면(controlsUnknown) 주문이 거부된다.
 *   2. 사유가 킬스위치와 **구분된다** — 운영자가 "내가 걸었나 / 못 읽었나" 를 알아야 한다.
 *   3. 한 번이라도 읽었으면 막지 않는다 (가용성 우선).
 */
import { describe, it, expect } from 'vitest';
import { evaluateLiveTradingGate } from '@quantumtrade/exchange-core';

/** 모든 보호를 통과하는 입력. 여기서 한 항목만 바꿔 검증한다. */
const pass = {
  mode: 'LIVE_TRADE' as const,
  liveTradingEnabled: true,
  emergencyKillSwitch: false,
  controlsUnknown: false,
  credentialStatus: 'VERIFIED',
  futureTradePermissionVerified: true,
  userStatus: 'active',
  riskCheckPassed: true,
  previewExpired: false, previewTokenValid: true,
  confirmationTokenValid: true,
  idempotencyKeyValid: true,
  marketDataStale: false,
  exchangeConnectivityHealthy: true,
  symbol: 'BTCUSDT',
  allowedSymbols: ['*'],
};

describe('킬스위치 — 상태를 모르면 막는다', () => {
  it('기준 입력은 통과한다 (테스트 자체가 항상 막히면 의미가 없다)', () => {
    const r = evaluateLiveTradingGate(pass);
    expect(r.allowed).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('상태를 못 읽었으면 거부한다', () => {
    const r = evaluateLiveTradingGate({ ...pass, controlsUnknown: true });
    expect(r.allowed).toBe(false);
  });

  it('사유가 킬스위치와 구분된다 — 운영자가 원인을 알아야 한다', () => {
    const unknown = evaluateLiveTradingGate({ ...pass, controlsUnknown: true });
    const switched = evaluateLiveTradingGate({ ...pass, emergencyKillSwitch: true });
    expect(unknown.reasons.join()).toMatch(/never read/i);
    expect(switched.reasons.join()).toMatch(/kill switch active/i);
    /* 두 사유가 같으면 로그에서 구분할 수 없다. */
    expect(unknown.reasons).not.toEqual(switched.reasons);
  });

  it('한 번이라도 읽었으면 막지 않는다 — 일시 장애로 주문을 세우지 않는다', () => {
    expect(evaluateLiveTradingGate({ ...pass, controlsUnknown: false }).allowed).toBe(true);
  });

  it('킬스위치가 켜져 있고 상태도 모르면 둘 다 사유로 남는다', () => {
    const r = evaluateLiveTradingGate({ ...pass, controlsUnknown: true, emergencyKillSwitch: true });
    expect(r.allowed).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe('OperationalControls.controlsUnknown()', () => {
  it('한 번도 읽지 못하면 true, 읽으면 false', async () => {
    const { OperationalControls } = await import('../ops/operational-controls.js');
    /* 항상 실패하는 저장소 — 첫 refresh 가 던진다. */
    const failing = new OperationalControls({
      listFlags: async () => { throw new Error('relation does not exist'); },
      listKill: async () => { throw new Error('relation does not exist'); },
    } as never, 60_000);
    /* start() 가 첫 refresh 를 돌린다. 던져도 부팅은 계속돼야 하므로 잡아낸다. */
    await failing.start().catch(() => {});
    failing.stop();
    expect(failing.controlsUnknown()).toBe(true);
    /*
       ★ 이게 예전 버그의 핵심이다 — 못 읽었는데 killActive 는 '차단 아님' 을 말한다.
         그래서 controlsUnknown() 을 따로 봐야 한다.
    */
    expect(failing.killActive('global_live_trading')).toBe(false);

    const ok = new OperationalControls({
      listFlags: async () => [],
      listKill: async () => [{ scope: 'global_live_trading', active: true }],
    } as never, 60_000);
    await ok.start();
    ok.stop();
    expect(ok.controlsUnknown()).toBe(false);
    expect(ok.killActive('global_live_trading')).toBe(true);
  });
});
