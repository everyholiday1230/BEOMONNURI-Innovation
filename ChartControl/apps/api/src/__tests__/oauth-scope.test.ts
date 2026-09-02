import { describe, it, expect } from 'vitest';
import { authGroupsFor, normalizeMarkets } from '../kucoin-oauth-routes';

/*
   ============================================================
   OAUTH-SCOPE — 고객이 고른 시장만 권한을 요구한다.

   ★★ 왜 이 검사가 필요한가

     예전에는 API_COMMON·API_SPOT·API_FUTURES 를 **항상 함께** 요구했다. KuCoin 은
     요청한 권한이 이용자가 승인한 것과 맞아야 하고, API_FUTURES 는 그 계정에 선물
     거래가 먼저 활성화돼 있어야 내준다. 안 맞으면 code=40503 으로 키 발급이
     실패한다 — 프로덕션 로그에 이 실패가 6건 남아 있었다(계정 3개).

     즉 현물만 쓰려는 고객이 **쓰지도 않을 권한 때문에** 연결을 못 했다.

   ★★ 그리고 권한은 넓어지는 방향으로 틀리면 안 된다. 우리 서버가 침해될 때
     고객 계정에서 할 수 있는 일이 곧 피해 범위다. 특히 출금은 어떤 경로로도
     켜지지 않아야 한다 — 우리는 입출금을 취급하지 않는다.
   ============================================================ */

describe('OAUTH-SCOPE 고객 선택에 따른 권한', () => {
  it('[1] ★★ 출금 권한은 어떤 선택에서도 꺼져 있다', () => {
    for (const m of ['spot', 'futures', 'both'] as const) {
      expect(authGroupsFor(m).API_WITHDRAW_OAUTH).toBe(false);
    }
  });

  it('[2] 쓰지 않는 권한은 모두 꺼져 있다 (마진·예치·이체)', () => {
    for (const m of ['spot', 'futures', 'both'] as const) {
      const g = authGroupsFor(m);
      expect(g.API_MARGIN).toBe(false);
      expect(g.API_EARN).toBe(false);
      expect(g.API_TRANSFER).toBe(false);
    }
  });

  it('[3] 조회 권한은 항상 필요하다 — 없으면 잔고·포지션을 못 띄운다', () => {
    for (const m of ['spot', 'futures', 'both'] as const) {
      expect(authGroupsFor(m).API_COMMON).toBe(true);
    }
  });

  it('[4] ★★ 현물만 고르면 선물 권한을 요구하지 않는다 (40503 의 실제 원인)', () => {
    const g = authGroupsFor('spot');
    expect(g.API_SPOT).toBe(true);
    expect(g.API_FUTURES).toBe(false);
  });

  it('[5] 선물만 고르면 현물 권한을 요구하지 않는다', () => {
    const g = authGroupsFor('futures');
    expect(g.API_FUTURES).toBe(true);
    expect(g.API_SPOT).toBe(false);
  });

  it('[6] 둘 다 고르면 둘 다 요구한다', () => {
    const g = authGroupsFor('both');
    expect(g.API_SPOT).toBe(true);
    expect(g.API_FUTURES).toBe(true);
  });

  it('[7] 알려진 값은 그대로 통과한다', () => {
    expect(normalizeMarkets('spot')).toBe('spot');
    expect(normalizeMarkets('futures')).toBe('futures');
    expect(normalizeMarkets('both')).toBe('both');
    expect(normalizeMarkets(' BOTH ')).toBe('both');
  });

  it('[8] ★★ 모르는 값은 가장 좁은 선택으로 떨어진다 — 권한이 조용히 넓어지면 안 된다', () => {
    for (const bad of ['', '  ', undefined, null, 'all', 'margin', 'FUTURE', 123, {}]) {
      expect(normalizeMarkets(bad)).toBe('spot');
    }
  });

  it('[9] 어떤 선택도 KuCoin 이 모르는 권한 이름을 만들지 않는다', () => {
    const known = new Set([
      'API_COMMON', 'API_SPOT', 'API_FUTURES', 'API_MARGIN',
      'API_EARN', 'API_TRANSFER', 'API_WITHDRAW_OAUTH',
    ]);
    for (const m of ['spot', 'futures', 'both'] as const) {
      for (const k of Object.keys(authGroupsFor(m))) expect(known.has(k)).toBe(true);
    }
  });
});
