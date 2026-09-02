import { describe, it, expect } from 'vitest';
import {
  KILL_SWITCH_SCOPES,
  ORDER_BLOCKING_KILL_SCOPES,
  killSwitchDefaultOnError,
  type KillSwitchScope,
} from '@quantumtrade/admin-domain';

/*
   ============================================================
   KILL-NEUTRAL — 거래소 중립 킬스위치.

   ★★ 왜 이 검사가 필요한가

     `bitmart_live_trading` 은 관리자 화면에서 켤 수 있었지만 **주문 경로가 검사하지
     않았다.** 주문 경로는 스코프 이름을 직접 나열했고(global_live_trading /
     new_positions) 그 목록에서 빠져 있었다. 즉 운영자가 "거래를 멈췄다" 고 믿는
     동안 실주문이 그대로 나갔다. 실주문이 열린 서비스에서 가장 위험한 종류의
     거짓 표시다.

     이제 강제 대상을 ORDER_BLOCKING_KILL_SCOPES 한 곳에서 내보내고 주문 경로가
     그것을 근거로 검사한다. 아래 검사들은 그 목록이 다시 어긋나는 것을 막는다.
   ============================================================ */

describe('KILL-NEUTRAL 거래소 중립 킬스위치', () => {
  it('[1] 거래소 중립 스코프가 존재한다', () => {
    expect(KILL_SWITCH_SCOPES).toContain('exchange_live_trading');
  });

  it('[2] ★★ 옛 이름을 지우지 않았다 — 지우면 이미 켜둔 차단이 조용히 풀린다', () => {
    expect(KILL_SWITCH_SCOPES).toContain('bitmart_live_trading');
  });

  it('[3] ★★ 새 스코프가 주문을 실제로 막는 목록에 있다', () => {
    expect(ORDER_BLOCKING_KILL_SCOPES).toContain('exchange_live_trading');
  });

  it('[4] ★★ 옛 스코프도 주문을 막는다 — 예전에는 아무도 검사하지 않았다', () => {
    expect(ORDER_BLOCKING_KILL_SCOPES).toContain('bitmart_live_trading');
  });

  it('[5] 전역 차단과 신규포지션 차단도 그대로 목록에 있다', () => {
    expect(ORDER_BLOCKING_KILL_SCOPES).toContain('global_live_trading');
    expect(ORDER_BLOCKING_KILL_SCOPES).toContain('new_positions');
  });

  it('[6] 막는 목록의 모든 스코프는 유효한 스코프다', () => {
    for (const s of ORDER_BLOCKING_KILL_SCOPES) {
      expect(KILL_SWITCH_SCOPES).toContain(s);
    }
  });

  it('[7] ★★ 조회 실패 시 실거래 스코프는 차단이 기본값이다 (fail-closed)', () => {
    for (const s of ['global_live_trading', 'exchange_live_trading', 'bitmart_live_trading', 'new_positions'] as KillSwitchScope[]) {
      expect(killSwitchDefaultOnError(s).active).toBe(true);
    }
  });

  it('[8] 실거래와 무관한 스코프는 조회 실패 시 차단하지 않는다', () => {
    for (const s of ['ai_provider', 'user', 'symbol'] as KillSwitchScope[]) {
      expect(killSwitchDefaultOnError(s).active).toBe(false);
    }
  });

  /*
     ★★ 주문 경로는 new_positions 를 **따로** 다룬다(감소 주문은 허용해야 하므로
       전면 차단과 의미가 다르다). 그래서 killSwitchActive 로 접히는 대상에서는
       제외되어야 한다. 이 구분이 깨지면 포지션을 줄이지도 못하게 된다.
  */
  it('[9] 전면 차단 스코프와 신규포지션 차단은 구분된다', () => {
    const fullStop = ORDER_BLOCKING_KILL_SCOPES.filter((s) => s !== 'new_positions');
    expect(fullStop).toEqual(['global_live_trading', 'exchange_live_trading', 'bitmart_live_trading']);
    expect(fullStop).not.toContain('new_positions');
  });
});
