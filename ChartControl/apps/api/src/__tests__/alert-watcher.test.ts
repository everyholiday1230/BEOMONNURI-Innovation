import { describe, it, expect } from 'vitest';
import { crossed, runAlertSweep } from '../alerts/alert-watcher';
import type { ActiveAlert } from '../db/price-alert-repo';

describe('가격 알림 — 조건 판정 (crossed)', () => {
  it('above: 가격이 목표 이상이면 참', () => {
    expect(crossed('above', 100, 100)).toBe(true);
    expect(crossed('above', 101, 100)).toBe(true);
    expect(crossed('above', 99, 100)).toBe(false);
  });
  it('below: 가격이 목표 이하이면 참', () => {
    expect(crossed('below', 100, 100)).toBe(true);
    expect(crossed('below', 99, 100)).toBe(true);
    expect(crossed('below', 101, 100)).toBe(false);
  });
  it('가격이 없거나 0 이하면 발동하지 않는다 (지어내지 않는다)', () => {
    expect(crossed('above', NaN, 100)).toBe(false);
    expect(crossed('below', 0, 100)).toBe(false);
    expect(crossed('above', -5, 100)).toBe(false);
  });
});

/** 가짜 저장소 — listActive/markTriggered 를 흉내낸다. */
function fakeRepo(active: ActiveAlert[]) {
  const triggered = new Set<string>();
  return {
    triggered,
    async listActive() { return active.filter((a) => !triggered.has(a.id)); },
    async markTriggered(id: string) {
      if (triggered.has(id)) return false; // 이미 발동 — 중복 방지
      triggered.add(id);
      return true;
    },
  } as unknown as import('../db/price-alert-repo').PgPriceAlertRepo & { triggered: Set<string> };
}

const A = (over: Partial<ActiveAlert>): ActiveAlert => ({
  id: 'a1', userId: 'u1', userEmail: 'u@e.com', symbol: 'BTCUSDT',
  direction: 'above', targetPrice: 100, notifyEmail: true, ...over,
});

describe('가격 알림 — 스윕 (runAlertSweep)', () => {
  it('조건 충족 시 발동하고 앱 알림 + 이메일을 보낸다', async () => {
    const repo = fakeRepo([A({ id: 'a1', direction: 'above', targetPrice: 100 })]);
    const notified: unknown[] = [];
    const mailed: unknown[] = [];
    const fired = await runAlertSweep({
      repo,
      getPrice: async () => 105,
      notify: async (x) => { notified.push(x); },
      sendEmail: async (x) => { mailed.push(x); },
    });
    expect(fired).toBe(1);
    expect(notified).toHaveLength(1);
    expect(mailed).toHaveLength(1);
  });

  it('★ 이미 발동한 알림은 다시 울리지 않는다 (중복 방지)', async () => {
    const repo = fakeRepo([A({ id: 'a1', targetPrice: 100 })]);
    let count = 0;
    const run = () => runAlertSweep({ repo, getPrice: async () => 105, notify: async () => { count += 1; } });
    await run();
    await run(); // 두 번째 스윕
    expect(count).toBe(1);
  });

  it('시세가 없으면 발동하지 않는다', async () => {
    const repo = fakeRepo([A({ id: 'a1', targetPrice: 100 })]);
    const fired = await runAlertSweep({ repo, getPrice: async () => null, notify: async () => {} });
    expect(fired).toBe(0);
  });

  it('notifyEmail=false 면 이메일은 보내지 않지만 앱 알림은 남긴다', async () => {
    const repo = fakeRepo([A({ id: 'a1', targetPrice: 100, notifyEmail: false })]);
    const mailed: unknown[] = [];
    let notified = 0;
    await runAlertSweep({
      repo, getPrice: async () => 105,
      notify: async () => { notified += 1; },
      sendEmail: async (x) => { mailed.push(x); },
    });
    expect(notified).toBe(1);
    expect(mailed).toHaveLength(0);
  });

  it('below 방향도 동작한다', async () => {
    const repo = fakeRepo([A({ id: 'a1', direction: 'below', targetPrice: 100 })]);
    const fired = await runAlertSweep({ repo, getPrice: async () => 95, notify: async () => {} });
    expect(fired).toBe(1);
  });
});
