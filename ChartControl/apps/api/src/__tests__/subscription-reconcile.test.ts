/**
 * 승인 대기 대조 — 고객이 돈을 내고 아무것도 못 받는 경우를 막는다.
 *
 * ★★★ 무엇을 막는가
 *
 *   구독 흐름은 checkout → (PayPal 승인) → confirm 이다. confirm 은 **고객의
 *   브라우저가 돌아와야** 실행된다. 탭을 닫거나, 모바일에서 앱 전환 중 세션이
 *   끊기거나, 리디렉트가 실패하면 돌아오지 못한다. 그때:
 *
 *     · PayPal 쪽 구독은 ACTIVE 이고 **요금이 청구된다**
 *     · 우리 DB 는 'pending' → 접근권이 없다
 *
 *   예전에는 provider_ref 조차 저장하지 않아 **수동 복구도 불가능했다.**
 */
import { describe, it, expect } from 'vitest';
import {
  judgePaypalStatus,
  reconcilePendingOnce,
  reconcileRenewalsOnce,
  type ReconcileProvider,
  type ReconcileActivator,
} from '../subscriptions/subscription-reconcile';
import type { PgSubscriptionRepo } from '../subscriptions/subscription-repo';
import { readFileSync } from 'node:fs';

type PendingRow = { userId: string; planCode: string; providerRef: string; pendingSince: number };

/** 저장소 대역. listPending / setStatus 만 쓴다. */
function fakeRepo(pending: PendingRow[]) {
  const statusCalls: Array<{ userId: string; status: string }> = [];
  const repo = {
    listPending: async () => pending,
    setStatus: async (userId: string, status: string) => {
      statusCalls.push({ userId, status });
      return true;
    },
  } as unknown as PgSubscriptionRepo;
  return { repo, statusCalls };
}

const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  userId: 'u1',
  planCode: 'pro',
  providerRef: 'I-SUB-1',
  pendingSince: Date.now() - 30 * 60_000,
  ...over,
});

describe('judgePaypalStatus — 모르는 상태를 활성으로 보지 않는다', () => {
  it('ACTIVE 만 활성이다', () => {
    expect(judgePaypalStatus('ACTIVE')).toBe('active');
    expect(judgePaypalStatus('active')).toBe('active');
  });

  it('CANCELLED·EXPIRED 는 끝난 것이다', () => {
    expect(judgePaypalStatus('CANCELLED')).toBe('dead');
    expect(judgePaypalStatus('EXPIRED')).toBe('dead');
  });

  it('SUSPENDED 는 끝난 것이 아니다 — PayPal 이 다시 시도할 수 있다', () => {
    /* ★ 결제가 밀린 상태다. 만료로 지우면 되살아날 결제를 버린다. */
    expect(judgePaypalStatus('SUSPENDED')).toBe('wait');
  });

  it('★ 모르는 값은 대기다 — 활성으로 오해하면 결제 없이 유료 기능이 열린다', () => {
    /*
       ★★ PayPal 이 새 상태를 추가했을 때 그것을 ACTIVE 로 오해하면 돈을 내지 않은
         사람에게 권한이 열린다. 모르면 대기로 남기고 사람이 로그에서 본다.
    */
    expect(judgePaypalStatus('SOMETHING_NEW')).toBe('wait');
    expect(judgePaypalStatus('')).toBe('wait');
    expect(judgePaypalStatus('APPROVAL_PENDING')).toBe('wait');
  });
});

describe('reconcilePendingOnce', () => {
  it('★ PayPal 이 ACTIVE 면 활성화한다 — 브라우저가 돌아오지 않아도 구제된다', async () => {
    const { repo } = fakeRepo([row()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'ACTIVE', nextBillingAt: '2026-10-09T00:00:00Z' }),
    };
    const activated: unknown[] = [];
    const activator: ReconcileActivator = { activate: async (i) => { activated.push(i); } };
    const out = await reconcilePendingOnce(repo, provider, activator);
    expect(out[0]?.action).toBe('activated');
    expect(activated).toHaveLength(1);
    expect((activated[0] as { nextBillingAt?: string }).nextBillingAt).toBe('2026-10-09T00:00:00Z');
  });

  it('★★ 조회 실패를 "구독 없음"으로 보지 않는다', async () => {
    /*
       ★★★ 이것이 가장 위험한 실수다. 일시적 장애(HTTP 500, 타임아웃)를 "없는 구독"
         으로 처리하면 고객의 **유효한 결제를 만료로 지운다.** 돈은 나갔는데 권한이
         사라지고, 우리 기록에는 정상 처리로 남는다.
    */
    const { repo, statusCalls } = fakeRepo([row()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: false, status: 'http_500' }),
    };
    const activator: ReconcileActivator = { activate: async () => { throw new Error('불려서는 안 된다'); } };
    const out = await reconcilePendingOnce(repo, provider, activator);
    expect(out[0]?.action).toBe('lookup_failed');
    expect(statusCalls, '조회 실패인데 상태를 바꿨다').toHaveLength(0);
  });

  it('던지는 예외도 조회 실패로 다룬다', async () => {
    const { repo, statusCalls } = fakeRepo([row()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => { throw new Error('network'); },
    };
    const activator: ReconcileActivator = { activate: async () => {} };
    const out = await reconcilePendingOnce(repo, provider, activator);
    expect(out[0]?.action).toBe('lookup_failed');
    expect(statusCalls).toHaveLength(0);
  });

  it('CANCELLED 면 만료로 정리한다', async () => {
    const { repo, statusCalls } = fakeRepo([row()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'CANCELLED' }),
    };
    const out = await reconcilePendingOnce(repo, provider, { activate: async () => {} });
    expect(out[0]?.action).toBe('expired');
    expect(statusCalls[0]).toEqual({ userId: 'u1', status: 'expired' });
  });

  it('★ 활성화가 실패하면 pending 으로 남긴다 — 다음 회차가 다시 시도해야 한다', async () => {
    /*
       ★★ 여기서 상태를 바꿔버리면 다음 회차가 이 건을 보지 못하고, 고객은 결제한 채로
         영구히 방치된다.
    */
    const { repo, statusCalls } = fakeRepo([row()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'ACTIVE' }),
    };
    const activator: ReconcileActivator = {
      activate: async () => { throw new Error('DB 기록 실패'); },
    };
    const out = await reconcilePendingOnce(repo, provider, activator);
    expect(out[0]?.action).toBe('activate_failed');
    expect(statusCalls, 'pending 을 유지해야 한다').toHaveLength(0);
  });

  it('아직 승인 중이면 그대로 둔다', async () => {
    const { repo, statusCalls } = fakeRepo([row({ pendingSince: Date.now() - 20 * 60_000 })]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'APPROVAL_PENDING' }),
    };
    const out = await reconcilePendingOnce(repo, provider, { activate: async () => {} });
    expect(out[0]?.action).toBe('still_pending');
    expect(statusCalls).toHaveLength(0);
  });

  it('너무 오래된 대기는 정리한다', async () => {
    /* ★ 승인하지 않고 떠난 흔적을 영원히 남기면 대조 대상이 계속 늘어난다. */
    const { repo, statusCalls } = fakeRepo([row({ pendingSince: Date.now() - 8 * 24 * 3600 * 1000 })]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'APPROVAL_PENDING' }),
    };
    const out = await reconcilePendingOnce(repo, provider, { activate: async () => {} });
    expect(out[0]?.action).toBe('expired');
    expect(statusCalls[0]?.status).toBe('expired');
  });

  it('여러 건을 하나씩 처리하고 한 건의 실패가 나머지를 막지 않는다', async () => {
    const { repo } = fakeRepo([
      row({ userId: 'u1', providerRef: 'I-1' }),
      row({ userId: 'u2', providerRef: 'I-2' }),
      row({ userId: 'u3', providerRef: 'I-3' }),
    ]);
    const provider: ReconcileProvider = {
      getSubscription: async (ref) => {
        if (ref === 'I-2') return { ok: false, status: 'http_503' };
        return { ok: true, status: 'ACTIVE' };
      },
    };
    const done: string[] = [];
    const out = await reconcilePendingOnce(repo, provider, {
      activate: async (i) => { done.push(i.providerRef); },
    });
    expect(out.map((o) => o.action)).toEqual(['activated', 'lookup_failed', 'activated']);
    expect(done, '중간 실패가 뒤의 건을 막았다').toEqual(['I-1', 'I-3']);
  });
});

describe('★ 승인 대기는 접근권을 주지 않는다 — 결제 없이 유료 기능이 열리면 안 된다', () => {
  const src = readFileSync(new URL('../subscriptions/subscription-repo.ts', import.meta.url), 'utf-8');

  it('entitled 는 허용 목록으로 판단한다', () => {
    /*
       ★★★ 예전에는 `status !== 'expired'` 였다(블랙리스트). 그 방식이면 새로 생긴
         상태가 **자동으로 접근권을 얻는다.** 'pending' 을 추가하면서 실제로 그
         구멍이 열렸다 — 기간(period_end)이 현재와 같아서 우연히 막혔을 뿐,
         규칙이 막은 것이 아니었다.

       ★ 새 상태를 추가할 때 목록에 넣지 않으면 접근권이 없다. 그것이 안전한
         기본값이다.
    */
    expect(src, '허용 목록이 없다').toContain('PAID_STATUSES');
    expect(src, '블랙리스트 방식이 남아 있다').not.toContain("status !== 'expired' && end > now");
  });

  it('허용 목록은 active 와 canceled 뿐이다', () => {
    const m = /PAID_STATUSES[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(src);
    expect(m, 'PAID_STATUSES 정의를 찾지 못했다').toBeTruthy();
    const listed = (m![1] ?? '').split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(listed.sort()).toEqual(['active', 'canceled']);
    /* ★ pending 이 들어가면 결제 전에 유료 기능이 열린다. */
    expect(listed, 'pending 이 허용 목록에 있다').not.toContain('pending');
  });

  it('markPending 은 이미 active 인 구독을 덮지 않는다', () => {
    /*
       ★★ 플랜을 바꾸려고 결제를 시작했다가 그만둔 경우, 쓰고 있던 구독을 pending 으로
         덮으면 **멀쩡한 접근권을 빼앗는다.** 실측으로 확인했다(elite/active 유지).
    */
    const at = src.indexOf('async markPending');
    expect(at).toBeGreaterThan(-1);
    const seg = src.slice(at, at + 1600);
    expect(seg, 'active 를 제외하는 조건이 없다').toContain("WHERE subscriptions.status <> 'active'");
  });

  it('웹훅 중복검사가 실패하면 처리하지 않는다', () => {
    /*
       ★ 중복 방지를 보장할 수 없는데 처리하면 포인트를 두 번 줄 수 있다.
         PayPal 이 재시도하므로 다음 기회가 있다.
    */
    const at = src.indexOf('async claimWebhookEvent');
    expect(at).toBeGreaterThan(-1);
    const seg = src.slice(at, at + 1400);
    expect(seg).toContain('return false');
    expect(seg).toContain('ON CONFLICT (event_id) DO NOTHING');
  });
});

type RenewRow = { userId: string; planCode: string; providerRef: string; periodEnd: number };

function renewRepo(rows: RenewRow[]) {
  const statusCalls: Array<{ userId: string; status: string }> = [];
  const repo = {
    listRenewable: async () => rows,
    setStatus: async (userId: string, status: string) => { statusCalls.push({ userId, status }); return true; },
  } as unknown as PgSubscriptionRepo;
  return { repo, statusCalls };
}

const DAY = 24 * 3600 * 1000;

describe('★★ 월 갱신 — 이것이 없으면 2회차부터 돈만 내고 접근권을 잃는다', () => {
  const rowNow = (over: Partial<RenewRow> = {}): RenewRow => ({
    userId: 'u1', planCode: 'pro', providerRef: 'I-R1',
    periodEnd: Date.now() + 3600_000,
    ...over,
  });

  it('PayPal 이 다음 청구일을 앞으로 옮겼으면 기간을 연장한다', async () => {
    const prevEnd = Date.now() + 3600_000;
    const { repo } = renewRepo([rowNow({ periodEnd: prevEnd })]);
    const nextAt = new Date(prevEnd + 30 * DAY).toISOString();
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'ACTIVE', nextBillingAt: nextAt }),
    };
    const calls: unknown[] = [];
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async (i) => { calls.push(i); } });
    expect(out[0]?.action).toBe('extended');
    const c = calls[0] as { periodStart: number; periodEnd: number };
    /* ★ periodStart 는 이전 기간의 끝 — 주기 경계여야 한다. */
    expect(c.periodStart).toBe(prevEnd);
    expect(c.periodEnd).toBe(Date.parse(nextAt));
  });

  it('★★★ 같은 값으로 다시 돌리면 아무 것도 하지 않는다 — 포인트 중복 지급 방지', async () => {
    /*
       ★★ 15분마다 도는 작업이다. periodStart 를 now() 로 쓰거나 값이 같아도 기록하면
         claimMonthlyGrant 가 "새 주기" 로 오해해 **폴링마다 포인트를 지급한다.**
         하루면 96번이다. 그래서 앞으로 나아갔을 때만 기록한다.
    */
    const prevEnd = Date.now() + 10 * DAY;
    const { repo } = renewRepo([rowNow({ periodEnd: prevEnd })]);
    const provider: ReconcileProvider = {
      /* PayPal 이 아직 같은 청구일을 준다(청구 전). */
      getSubscription: async () => ({ ok: true, status: 'ACTIVE', nextBillingAt: new Date(prevEnd).toISOString() }),
    };
    let extended = 0;
    for (let i = 0; i < 5; i++) {
      const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => { extended++; } });
      expect(out[0]?.action).toBe('not_advanced');
    }
    expect(extended, '기간이 안 바뀌었는데 기록했다 — 포인트가 중복 지급된다').toBe(0);
  });

  it('과거 날짜로는 연장하지 않는다', async () => {
    const prevEnd = Date.now() + 5 * DAY;
    const { repo } = renewRepo([rowNow({ periodEnd: prevEnd })]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'ACTIVE', nextBillingAt: new Date(prevEnd - DAY).toISOString() }),
    };
    let extended = 0;
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => { extended++; } });
    expect(out[0]?.action).toBe('not_advanced');
    expect(extended).toBe(0);
  });

  it('★ ACTIVE 인데 청구일을 못 읽으면 연장하지 않고 크게 남긴다', async () => {
    /*
       ★★ 임의로 연장하면 **결제 없이 기능이 열린다.** 연장하지 않고 눈에 띄게 남긴다.
         고객이 끊기면 그 로그로 원인을 찾는다.
    */
    const { repo } = renewRepo([rowNow()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'ACTIVE' }),
    };
    let extended = 0;
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => { extended++; } });
    expect(out[0]?.action).toBe('no_billing_date');
    expect(extended).toBe(0);
  });

  it('SUSPENDED(결제 실패)는 연장하지 않는다 — 유예기간을 임의로 만들지 않는다', async () => {
    const { repo, statusCalls } = renewRepo([rowNow()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'SUSPENDED', nextBillingAt: new Date(Date.now() + 30 * DAY).toISOString() }),
    };
    let extended = 0;
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => { extended++; } });
    expect(out[0]?.action).toBe('not_advanced');
    expect(extended, '결제가 실패했는데 기간을 늘렸다').toBe(0);
    expect(statusCalls, 'SUSPENDED 는 아직 끝난 것이 아니다').toHaveLength(0);
  });

  it('PayPal 쪽에서 해지되면 canceled — 남은 기간은 살려 둔다', async () => {
    /* ★ 이미 낸 몫을 빼앗지 않는다. 기간이 지나면 entitled 가 저절로 false 다. */
    const { repo, statusCalls } = renewRepo([rowNow()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'CANCELLED' }),
    };
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => {} });
    expect(out[0]?.action).toBe('ended');
    expect(statusCalls[0]).toEqual({ userId: 'u1', status: 'canceled' });
  });

  it('조회 실패로 구독을 끊지 않는다', async () => {
    const { repo, statusCalls } = renewRepo([rowNow()]);
    const provider: ReconcileProvider = { getSubscription: async () => ({ ok: false, status: 'http_502' }) };
    let extended = 0;
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => { extended++; } });
    expect(out[0]?.action).toBe('lookup_failed');
    expect(statusCalls, '장애 때 유효한 구독을 끊었다').toHaveLength(0);
    expect(extended).toBe(0);
  });

  it('연장 기록이 실패하면 상태를 바꾸지 않는다 — 다음 회차가 다시 시도한다', async () => {
    const prevEnd = Date.now() + 3600_000;
    const { repo, statusCalls } = renewRepo([rowNow({ periodEnd: prevEnd })]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ ok: true, status: 'ACTIVE', nextBillingAt: new Date(prevEnd + 30 * DAY).toISOString() }),
    };
    const out = await reconcileRenewalsOnce(repo, provider, {
      extend: async () => { throw new Error('DB 실패'); },
    });
    expect(out[0]?.action).toBe('extend_failed');
    expect(statusCalls).toHaveLength(0);
  });
});
