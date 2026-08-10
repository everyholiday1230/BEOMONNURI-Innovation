/**
 * 청산 위험 감시 테스트.
 *
 * ★ 이 기능은 **자금 손실을 막는 것**이 목적이다. 잘못 동작하는 방식이 셋 있고
 *   각각이 실제 손해로 이어진다:
 *     1. 경고를 안 보낸다        → 사용자가 청산당한다
 *     2. 같은 경고를 반복한다    → 사용자가 알림을 끄고 진짜 경고도 못 본다
 *     3. 모르는 것을 안전이라 한다 → 감시가 죽은 걸 아무도 모른다
 *   셋을 모두 테스트로 못 박는다.
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryAlertState,
  assessPosition,
  watchUserPositions,
  type PositionRisk,
} from '../trading/risk-watch';
import { RiskWatchLoop } from '../trading/risk-watch-loop';

/** 알림 저장소 대역. 만들어진 알림을 기록한다. */
function fakeNotifications() {
  const created: { userId: string; type: string; severity: string; message: string }[] = [];
  return {
    created,
    repo: {
      create: async (i: { userId: string; type: string; severity: string; message: string }) => {
        created.push(i);
        return { id: String(created.length) } as never;
      },
      list: async () => ({ items: [], total: 0, unreadCount: 0 }) as never,
      markRead: async () => ({ found: true, changed: true }),
      markAllRead: async () => ({ changed: 0 }),
    },
  };
}

const pos = (over: Partial<PositionRisk> = {}): PositionRisk => ({
  symbol: 'BTCUSDT',
  side: 'long',
  markPrice: 100,
  liquidationPrice: 90,
  ...over,
});

describe('assessPosition', () => {
  it('청산가에서 멀면 경고하지 않는다', () => {
    // 100 → 50 은 50% 거리. 하루 변동으로 닿지 않는다.
    expect(assessPosition(pos({ liquidationPrice: 50 }))).toBeNull();
  });

  it('12% 이내면 warning 이다', () => {
    const v = assessPosition(pos({ markPrice: 100, liquidationPrice: 90 }));
    expect(v?.level).toBe('warning');
    expect(v?.distancePct).toBeCloseTo(10, 6);
  });

  it('5% 이내면 critical 이다', () => {
    const v = assessPosition(pos({ markPrice: 100, liquidationPrice: 97 }));
    expect(v?.level).toBe('critical');
    expect(v?.distancePct).toBeCloseTo(3, 6);
  });

  it('숏 포지션도 거리로 판단한다', () => {
    // 숏은 청산가가 위에 있다. 부호가 아니라 거리를 본다.
    const v = assessPosition(pos({ side: 'short', markPrice: 100, liquidationPrice: 104 }));
    expect(v?.level).toBe('critical');
  });

  /*
     ★★ 모르는 것을 '안전' 으로 처리하지 않는다.

       거래소가 청산가를 주지 않으면 위험 여부를 모르는 것이다. null 을 돌려주고
       호출자가 그것을 따로 센다.
  */
  it('청산가를 모르면 판단하지 않는다', () => {
    expect(assessPosition(pos({ liquidationPrice: null }))).toBeNull();
  });

  it('표시가를 모르면 판단하지 않는다', () => {
    expect(assessPosition(pos({ markPrice: null }))).toBeNull();
  });

  it('청산가가 0 이면 판단하지 않는다', () => {
    // 신규 포지션은 거래소가 아직 계산하지 않았을 수 있다.
    expect(assessPosition(pos({ liquidationPrice: 0 }))).toBeNull();
  });

  it('숫자가 아니면 판단하지 않는다', () => {
    expect(assessPosition(pos({ liquidationPrice: Number.NaN }))).toBeNull();
    expect(assessPosition(pos({ markPrice: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});

describe('watchUserPositions', () => {
  it('위험한 포지션에 알림을 만든다', async () => {
    const n = fakeNotifications();
    const r = await watchUserPositions({ notifications: n.repo as never }, 'u1', [
      pos({ liquidationPrice: 97 }),
    ]);
    expect(r.notified).toBe(1);
    expect(n.created[0]!.type).toBe('risk_alert');
    expect(n.created[0]!.severity).toBe('critical');
    // 숫자를 담아야 한다 — "위험합니다" 만으로는 사용자가 판단할 수 없다.
    expect(n.created[0]!.message).toMatch(/3\.0%/);
  });

  it('안전한 포지션에는 알리지 않는다', async () => {
    const n = fakeNotifications();
    const r = await watchUserPositions({ notifications: n.repo as never }, 'u1', [
      pos({ liquidationPrice: 50 }),
    ]);
    expect(r.notified).toBe(0);
    expect(n.created).toHaveLength(0);
  });

  /*
     ★★ 같은 등급을 반복해서 알리지 않는다.

       2분마다 같은 문구를 받으면 사용자가 알림을 끈다. 그러면 정말 급한 경고도
       못 본다.
  */
  it('같은 등급은 다시 알리지 않는다', async () => {
    const n = fakeNotifications();
    const state = new MemoryAlertState();
    const p = [pos({ liquidationPrice: 90 })]; // warning

    const first = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', p);
    const second = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', p);

    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    expect(second.suppressed).toBe(1);
    expect(n.created).toHaveLength(1);
  });

  it('등급이 나빠지면 다시 알린다', async () => {
    const n = fakeNotifications();
    const state = new MemoryAlertState();

    await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ liquidationPrice: 90 }), // warning (10%)
    ]);
    const worse = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ liquidationPrice: 97 }), // critical (3%)
    ]);

    expect(worse.notified).toBe(1);
    expect(n.created).toHaveLength(2);
    expect(n.created[1]!.severity).toBe('critical');
  });

  it('위험이 줄어들면 알리지 않는다', async () => {
    /*
       ★ 좋아진 소식으로 사용자를 깨울 이유가 없다. critical → warning 은
         조용히 지나간다.
    */
    const n = fakeNotifications();
    const state = new MemoryAlertState();

    await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ liquidationPrice: 97 }), // critical
    ]);
    const better = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ liquidationPrice: 90 }), // warning
    ]);

    expect(better.notified).toBe(0);
    expect(n.created).toHaveLength(1);
  });

  it('포지션이 사라지면 상태를 지운다', async () => {
    /*
       ★★ 지우지 않으면 같은 심볼로 다시 진입했을 때 "이미 알렸다" 로 판단해
         경고를 건너뛴다 — 새 포지션이 위험한데 조용하다.
    */
    const n = fakeNotifications();
    const state = new MemoryAlertState();

    await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ liquidationPrice: 97 }),
    ]);
    // 청산되거나 직접 닫았다.
    const gone = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', []);
    expect(gone.cleared).toBe(1);

    // 다시 진입하면 새로 알려야 한다.
    const again = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ liquidationPrice: 97 }),
    ]);
    expect(again.notified).toBe(1);
  });

  it('다른 사용자의 상태를 지우지 않는다', async () => {
    const n = fakeNotifications();
    const state = new MemoryAlertState();

    await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [pos({ liquidationPrice: 97 })]);
    await watchUserPositions({ notifications: n.repo as never, state }, 'u2', [pos({ liquidationPrice: 97 })]);
    // u2 의 포지션이 사라져도 u1 의 상태는 남아야 한다.
    await watchUserPositions({ notifications: n.repo as never, state }, 'u2', []);

    const u1Again = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ liquidationPrice: 97 }),
    ]);
    expect(u1Again.suppressed).toBe(1);
  });

  it('판단 불가를 따로 센다', async () => {
    const n = fakeNotifications();
    const r = await watchUserPositions({ notifications: n.repo as never }, 'u1', [
      pos({ liquidationPrice: null }),
      pos({ symbol: 'ETHUSDT', markPrice: null }),
    ]);
    // 안전으로 세지 않는다. 이 값이 계속 늘면 감시가 사실상 꺼진 것이다.
    expect(r.unknown).toBe(2);
    expect(r.notified).toBe(0);
  });

  it('심볼과 방향을 함께 구분한다', async () => {
    // 같은 심볼의 롱·숏은 다른 포지션이다. 한쪽만 알리면 안 된다.
    const n = fakeNotifications();
    const state = new MemoryAlertState();
    const r = await watchUserPositions({ notifications: n.repo as never, state }, 'u1', [
      pos({ side: 'long', liquidationPrice: 97 }),
      pos({ side: 'short', markPrice: 100, liquidationPrice: 103 }),
    ]);
    expect(r.notified).toBe(2);
  });
});

describe('RiskWatchLoop', () => {
  it('대상이 없으면 아무것도 하지 않는다', async () => {
    /*
       ★ 실주문이 닫혀 있으면 검증된 키가 없어 대상이 0명이다. 그때 거래소를
         호출하면 의미 없는 부하다.
    */
    const n = fakeNotifications();
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => [],
      log: () => {},
    });
    await loop.tick();
    expect(n.created).toHaveLength(0);
    expect(loop.status().lastRun?.targets).toBe(0);
  });

  it('여러 사용자를 순차로 검사한다', async () => {
    const n = fakeNotifications();
    const order: string[] = [];
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => {
        order.push('list');
        return [
          { userId: 'u1', positions: [pos({ liquidationPrice: 97 })] },
          { userId: 'u2', positions: [pos({ liquidationPrice: 97 })] },
        ];
      },
      log: () => {},
    });
    await loop.tick();
    expect(n.created.map((x) => x.userId)).toEqual(['u1', 'u2']);
  });

  it('조회 실패를 기록하고 삼키지 않는다', async () => {
    /*
       ★★ 감시가 죽은 것을 아무도 모르면, 사용자는 경고가 오지 않는 이유를
         "위험하지 않아서" 로 오해한다.
    */
    const n = fakeNotifications();
    const logs: string[] = [];
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => { throw new Error('exchange down'); },
      log: (m) => logs.push(m),
    });
    await loop.tick();

    expect(loop.status().consecutiveFailures).toBe(1);
    expect(loop.status().lastRun?.error).toContain('exchange down');
    expect(logs.some((l) => l.includes('실패'))).toBe(true);
  });

  it('연속 3회 실패를 강하게 알린다', async () => {
    const n = fakeNotifications();
    const logs: string[] = [];
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => { throw new Error('down'); },
      log: (m) => logs.push(m),
    });
    await loop.tick();
    await loop.tick();
    await loop.tick();
    expect(logs.some((l) => l.includes('연속 3회'))).toBe(true);
  });

  it('겹쳐 돌지 않는다', async () => {
    /*
       ★ 겹쳐 돌면 같은 위험을 두 번 알리고 거래소 호출도 두 배가 된다.
    */
    const n = fakeNotifications();
    let calls = 0;
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 50));
        return [];
      },
      log: () => {},
    });
    await Promise.all([loop.tick(), loop.tick()]);
    expect(calls).toBe(1);
  });

  it('주기를 최소값 아래로 낮추지 않는다', () => {
    // 너무 짧으면 거래소 rate limit 에 걸려 전체 감시가 실패한다.
    const n = fakeNotifications();
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => [],
      intervalMs: 100,
      log: () => {},
    });
    expect(loop.status().intervalMs).toBeGreaterThanOrEqual(30_000);
  });

  it('start 전에는 running 이 아니다', () => {
    const n = fakeNotifications();
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => [],
      log: () => {},
    });
    // 기본은 꺼짐이다 — 실주문 없는 배포에서 거래소를 호출하지 않는다.
    expect(loop.status().running).toBe(false);
  });

  it('start/stop 이 상태를 바꾼다', async () => {
    const n = fakeNotifications();
    const loop = new RiskWatchLoop({
      notifications: n.repo as never,
      listWatchTargets: async () => [],
      log: () => {},
    });
    loop.start();
    expect(loop.status().running).toBe(true);
    loop.stop();
    expect(loop.status().running).toBe(false);
  });
});
