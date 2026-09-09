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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'ACTIVE', nextBillingAt: '2026-10-09T00:00:00Z' }),
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
      getSubscription: async () => ({ lookupOk: false, ok: false, status: 'http_500' }),
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'CANCELLED' }),
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'ACTIVE' }),
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'APPROVAL_PENDING' }),
    };
    const out = await reconcilePendingOnce(repo, provider, { activate: async () => {} });
    expect(out[0]?.action).toBe('still_pending');
    expect(statusCalls).toHaveLength(0);
  });

  it('너무 오래된 대기는 정리한다', async () => {
    /* ★ 승인하지 않고 떠난 흔적을 영원히 남기면 대조 대상이 계속 늘어난다. */
    const { repo, statusCalls } = fakeRepo([row({ pendingSince: Date.now() - 8 * 24 * 3600 * 1000 })]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'APPROVAL_PENDING' }),
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
        if (ref === 'I-2') return { lookupOk: false, ok: false, status: 'http_503' };
        return { lookupOk: true, ok: true, status: 'ACTIVE' };
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'ACTIVE', nextBillingAt: nextAt }),
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'ACTIVE', nextBillingAt: new Date(prevEnd).toISOString() }),
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'ACTIVE', nextBillingAt: new Date(prevEnd - DAY).toISOString() }),
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'ACTIVE' }),
    };
    let extended = 0;
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => { extended++; } });
    expect(out[0]?.action).toBe('no_billing_date');
    expect(extended).toBe(0);
  });

  it('SUSPENDED(결제 실패)는 연장하지 않는다 — 유예기간을 임의로 만들지 않는다', async () => {
    const { repo, statusCalls } = renewRepo([rowNow()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'SUSPENDED', nextBillingAt: new Date(Date.now() + 30 * DAY).toISOString() }),
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'CANCELLED' }),
    };
    const out = await reconcileRenewalsOnce(repo, provider, { extend: async () => {} });
    expect(out[0]?.action).toBe('ended');
    expect(statusCalls[0]).toEqual({ userId: 'u1', status: 'canceled' });
  });

  it('조회 실패로 구독을 끊지 않는다', async () => {
    const { repo, statusCalls } = renewRepo([rowNow()]);
    const provider: ReconcileProvider = { getSubscription: async () => ({ lookupOk: false, ok: false, status: 'http_502' }) };
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
      getSubscription: async () => ({ lookupOk: true, ok: true, status: 'ACTIVE', nextBillingAt: new Date(prevEnd + 30 * DAY).toISOString() }),
    };
    const out = await reconcileRenewalsOnce(repo, provider, {
      extend: async () => { throw new Error('DB 실패'); },
    });
    expect(out[0]?.action).toBe('extend_failed');
    expect(statusCalls).toHaveLength(0);
  });
});

describe('★★★ 조회 성공과 "구독이 유효한가" 를 섞지 않는다', () => {
  const src = readFileSync(new URL('../payments/providers.ts', import.meta.url), 'utf-8');

  it('provider 가 lookupOk 를 따로 돌려준다', () => {
    /*
       ★★★ provider 의 `ok` 는 "ACTIVE 인가" 를 뜻한다. 나는 그것을 "조회 성공" 으로
         가정하고 대조 작업을 만들었다. 그래서 승인 전(APPROVAL_PENDING)·취소됨
         (CANCELLED)·정지됨(SUSPENDED)이 **전부 '조회 실패' 로 묶였다.**

         결과가 안전한 쪽(활성화 안 함)이라 눈에 잘 띄지 않았다. 그러나
           · 취소된 구독이 영원히 정리되지 않는다
           · 승인 전 구독마다 오류 로그가 쌓여 **진짜 실패를 가린다**

         샌드박스로 실제 호출해서 발견했다 — PayPal 은 HTTP 200 + APPROVAL_PENDING 을
         정상 반환하는데 우리가 ok:false 로 바꾸고 있었다. 단위 테스트만으로는
         절대 못 찾는 종류의 버그다(대역이 내 가정을 그대로 따라했으므로).
    */
    expect(src, 'lookupOk 가 없다').toContain('lookupOk');
    const at = src.indexOf('async getSubscription');
    expect(at).toBeGreaterThan(-1);
    const seg = src.slice(at, at + 2600);
    /* 통신 실패 경로 */
    expect(seg).toContain('lookupOk: false');
    /* 조회 성공 경로 */
    expect(seg).toContain('lookupOk: true');
    /* ok 의 기존 뜻은 유지한다 — confirm 라우트가 그 의미로 쓴다. */
    expect(seg).toContain("ok: body.status === 'ACTIVE'");
  });

  it('대조 작업은 lookupOk 로 판단한다 — ok 로 판단하면 상태 처리가 죽는다', () => {
    const rec = readFileSync(new URL('../subscriptions/subscription-reconcile.ts', import.meta.url), 'utf-8');
    expect(rec).toContain('if (!got.lookupOk)');
    /* ★ `if (!got.ok)` 로 되돌아가면 취소·정지가 다시 조회 실패로 묶인다. */
    expect(rec, 'ok 로 판단하는 코드가 남아 있다').not.toMatch(/if \(!got\.ok\)/);
  });

  it('취소된 구독은 조회 실패가 아니라 종료로 처리된다', async () => {
    /* ★ 이것이 위 버그의 실제 증상이었다. */
    const { repo, statusCalls } = fakeRepo([row()]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ lookupOk: true, ok: false, status: 'CANCELLED' }),
    };
    const out = await reconcilePendingOnce(repo, provider, { activate: async () => {} });
    expect(out[0]?.action, '취소를 조회 실패로 처리했다').toBe('expired');
    expect(statusCalls[0]?.status).toBe('expired');
  });

  it('승인 전 구독은 조회 실패가 아니라 대기로 처리된다', async () => {
    const { repo, statusCalls } = fakeRepo([row({ pendingSince: Date.now() - 20 * 60_000 })]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({ lookupOk: true, ok: false, status: 'APPROVAL_PENDING' }),
    };
    const out = await reconcilePendingOnce(repo, provider, { activate: async () => {} });
    expect(out[0]?.action, '승인 대기를 조회 실패로 처리했다').toBe('still_pending');
    expect(statusCalls).toHaveLength(0);
  });
});

describe('★★ confirm 은 두 번 불러도 포인트를 두 번 주지 않는다', () => {
  const src = readFileSync(new URL('../subscriptions/subscription-routes.ts', import.meta.url), 'utf-8');

  it('이미 활성이면 기간을 다시 쓰지 않는다', () => {
    /*
       ★★★ 샌드박스 실측에서 **실제로 두 번 지급됐다** — 같은 사용자에게 30,000pt 가
         7초 간격으로(원장 ref_id 가 서로 달랐다).

         원인: 매 호출이 `periodStart: now` 로 upsert 했다. claimMonthlyGrant 는
         `last_grant_period <> current_period_start` 로 중복을 막는데, period_start 가
         매번 바뀌면 새 주기로 오해해 또 지급한다.

         이 경로는 실제로 두 번 불린다 — 복귀 화면 새로고침, 프런트엔드 재시도,
         sessionStorage 와 URL 양쪽에서 단서를 찾아 각각 호출.

       ★ 고침: 이미 이 구독으로 활성이면 아무것도 하지 않고 현재 상태를 돌려준다.
         실측(승인 후 confirm 3회): granted 150000 → 0 → 0.
    */
    const at = src.indexOf('const existing = await d.repo.findByProviderRef(ref);');
    expect(at, '멱등 검사가 없다').toBeGreaterThan(-1);
    const seg = src.slice(at, at + 900);
    expect(seg).toContain("existing.status === 'active'");
    expect(seg, '소유자 대조가 없다').toContain('existing.userId === a.user.id');
    expect(seg, '이미 처리됨을 알리지 않는다').toContain('alreadyActive: true');
    expect(seg, '지급 0 을 명시하지 않는다').toContain('granted: 0');
  });

  it('멱등 검사가 upsert 보다 앞에 있다', () => {
    /* ★ 뒤에 있으면 이미 기간을 덮어쓴 뒤라 의미가 없다. */
    const guard = src.indexOf('const existing = await d.repo.findByProviderRef(ref);');
    const upsert = src.indexOf('const ok = await d.repo.upsert({');
    expect(guard).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(-1);
    expect(guard, '멱등 검사가 upsert 뒤에 있다').toBeLessThan(upsert);
  });
});

describe('★ 복귀 URL 에서도 구독 id 를 읽는다', () => {
  const ui = readFileSync(new URL('../../../../src/pages-points.jsx', import.meta.url), 'utf-8');

  it('sessionStorage 가 비어도 subscription_id 로 확인한다', () => {
    /*
       ★★ 예전에는 sessionStorage 만 봤다. 그런데 PayPal 은 복귀 URL 에
         `?subscription_id=I-...` 를 붙여 준다. sessionStorage 는 새 탭·모바일 앱
         전환·시크릿 모드에서 비어 있다. 그러면 **결제는 됐는데 확인이 안 된다.**
       ★ URL 값을 믿어도 안전하다 — confirm 이 PayPal 에 물어 ACTIVE 를 확인하고
         custom_id 로 소유자까지 대조한다(NOT_YOURS).
    */
    expect(ui).toContain("q.get('subscription_id')");
    const at = ui.indexOf("sessionStorage.getItem(REF_KEY)");
    expect(at).toBeGreaterThan(-1);
    const seg = ui.slice(at, at + 900);
    expect(seg, 'URL 대체 경로가 없다').toContain('subscription_id');
  });
});

describe('★★★ 해지는 PayPal 쪽 정기결제까지 멈춘다', () => {
  const src = readFileSync(new URL('../subscriptions/subscription-routes.ts', import.meta.url), 'utf-8');
  const cancelAt = src.indexOf("app.post('/me/subscription/cancel'");
  const seg = src.slice(cancelAt, cancelAt + 4200);

  it('cancelSubscription 을 실제로 부른다', () => {
    /*
       ★★★ 예전에는 우리 DB 만 'canceled' 로 바꾸고 `providerStopRequired: true` 를
         돌려줬다. 즉 고객이 해지를 눌러도 **PayPal 은 매달 계속 청구한다.**
         화면은 "결제사에서도 멈추세요" 라고 안내했지만 그 부담을 고객에게 넘기는
         것이고 대부분은 하지 않는다 → "해지했는데 또 결제됐다" → 분쟁·차지백.

         provider 에 cancelSubscription 은 이미 구현돼 있었다. 라우터가 부르지
         않았을 뿐이다(인터페이스에는 선언돼 있었다 — 그래서 눈에 안 띄었다).
    */
    expect(cancelAt, '해지 라우트를 찾지 못했다').toBeGreaterThan(-1);
    expect(seg, 'PayPal 해지를 호출하지 않는다').toContain('d.paypal.cancelSubscription(');
  });

  it('★ PayPal 을 먼저 멈추고 그 다음 우리 기록을 바꾼다', () => {
    /*
       ★★ 순서가 뒤집히면 **고객이 해지됐다고 믿는데 청구가 계속된다.**
           · PayPal 성공 → DB 실패 : 청구는 멈췄고 대조 작업이 정리한다. 안전.
           · DB 성공 → PayPal 실패 : 최악. 절대 이 순서로 두면 안 된다.
    */
    const stopAt = seg.indexOf('d.paypal.cancelSubscription(');
    const dbAt = seg.indexOf('await d.repo.cancel(a.user.id)');
    expect(stopAt).toBeGreaterThan(-1);
    expect(dbAt).toBeGreaterThan(-1);
    expect(stopAt, 'DB 해지가 PayPal 정지보다 먼저다').toBeLessThan(dbAt);
  });

  it('PayPal 정지가 실패하면 성공이라고 답하지 않는다', () => {
    /* ★ 조용히 넘기면 청구가 계속되는 것을 아무도 모른다. */
    expect(seg).toContain('PROVIDER_STOP_FAILED');
    expect(seg, '실패를 크게 남기지 않는다').toMatch(/console\.error[^;]*정지 실패/);
  });

  it('고객에게 추가 조치를 요구하지 않는다', () => {
    /* ★ 우리가 멈췄으므로 providerStopRequired 는 항상 false 여야 한다. */
    expect(seg).toContain('providerStopRequired: false');
    expect(seg).toContain('providerStopped');
  });

  it('provider_ref 조회 실패를 "없음"으로 다루지 않는다', () => {
    /*
       ★★ 없다고 판단하면 PayPal 해지를 **건너뛴다.** 그러면 고객은 해지했다고
         믿는데 청구가 계속된다. 그래서 저장소가 던지고 라우터가 503 으로 막는다.
    */
    const repo = readFileSync(new URL('../subscriptions/subscription-repo.ts', import.meta.url), 'utf-8');
    const at = repo.indexOf('async providerRefOf');
    expect(at).toBeGreaterThan(-1);
    expect(repo.slice(at, at + 900)).toContain('throw new Error');
  });
});

describe('★★ 플랜 변경 — 낸 만큼만 받는다', () => {
  const routes = readFileSync(new URL('../subscriptions/subscription-routes.ts', import.meta.url), 'utf-8');
  const prov = readFileSync(new URL('../payments/providers.ts', import.meta.url), 'utf-8');

  it('변경은 승인이 필요하다 — approveUrl 없으면 실패로 다룬다', () => {
    /*
       ★★ 샌드박스 실측: revise 는 approve 링크를 주고, **승인 전에는 plan_id 가
         바뀌지 않는다.** 승인 링크 없이 성공이라 답하면 "변경했다" 고 말하는데
         아무 일도 일어나지 않는다.
    */
    const at = prov.indexOf('async reviseSubscription');
    expect(at).toBeGreaterThan(-1);
    const seg = prov.slice(at, at + 3000);
    expect(seg).toContain("l.rel === 'approve'");
    expect(seg).toContain("status: 'no_approve_link'");
  });

  it('★★★ 포인트를 즉시 지급하지 않는다 — 아직 새 요금을 내지 않았다', () => {
    /*
       ★★★ 샌드박스 실측이 결정적이었다. basic($19) → elite($199) 로 변경하고
         승인한 직후:
             PayPal plan_id  = elite   (즉시 바뀐다)
             last_payment    = 19.0    (그대로 — **즉시 청구되지 않는다**)
             next_billing    = 그대로
             outstanding     = 0
         즉 지금 elite 포인트 150,000 을 주면 고객은 $19 만 내고 차액 141,000pt 를
         받고, 다음 청구 전에 해지하면 그대로 가져간다.

       ★ 그래서 변경 라우트는 포인트를 건드리지 않고, 새 플랜 포인트는 다음 결제일에
         갱신 경로가 지급한다. 화면에 그 사실을 반드시 알린다.
    */
    const at = routes.indexOf("app.post('/me/subscription/change'");
    expect(at, '변경 라우트가 없다').toBeGreaterThan(-1);
    const seg = routes.slice(at, at + 4500);
    expect(seg, '변경 라우트가 포인트를 지급한다').not.toContain('grantMonthlyPointsIfDue');
    expect(seg, '다음 결제일부터라는 안내가 없다').toContain('next billing date');
  });

  it('활성 구독이 없으면 변경이 아니라 신규 결제로 보낸다', () => {
    /* ★ 조용히 새 구독을 만들면 고객은 "변경" 을 눌렀는데 새로 결제된다. */
    const at = routes.indexOf("app.post('/me/subscription/change'");
    const seg = routes.slice(at, at + 4500);
    expect(seg).toContain('NO_ACTIVE_SUBSCRIPTION');
    expect(seg).toContain('SAME_PLAN');
  });

  it('검증되지 않은 플랜으로는 바꿀 수 없다', () => {
    /* ★ 금액이 어긋난 플랜으로 바꾸면 화면 금액과 실제 청구가 달라진다. */
    const at = routes.indexOf("app.post('/me/subscription/change'");
    const seg = routes.slice(at, at + 4500);
    expect(seg).toContain('planIdFor(wanted)');
    expect(seg).toContain('PLAN_NOT_PURCHASABLE');
  });

  it('★ 갱신 시 PayPal 의 플랜을 기준으로 포인트를 지급한다', async () => {
    /*
       ★★ 우리 DB 의 옛 플랜을 쓰면 **업그레이드한 고객이 영원히 낮은 플랜 포인트를
         받는다.** 실측으로 확인했다: basic 9,000pt → 갱신 시 elite 150,000pt.
    */
    const prevEnd = Date.now() + 3600_000;
    const { repo } = renewRepo([{ userId:'u1', planCode:'basic', providerRef:'I-UP', periodEnd: prevEnd }]);
    const provider: ReconcileProvider = {
      getSubscription: async () => ({
        lookupOk: true, ok: true, status: 'ACTIVE',
        planId: 'P-ELITE', nextBillingAt: new Date(prevEnd + 30 * DAY).toISOString(),
      }),
    };
    const seen: string[] = [];
    await reconcileRenewalsOnce(repo, provider, { extend: async (i) => { seen.push(i.planCode); } },
      { planCodeFor: (id) => (id === 'P-ELITE' ? 'elite' : null) });
    expect(seen, 'PayPal 의 플랜을 반영하지 않았다').toEqual(['elite']);
  });

  it('플랜을 알아낼 수 없으면 기존 플랜을 유지한다', () => {
    /* ★ 모르는 plan_id 를 free 나 최저 플랜으로 떨어뜨리면 고객이 낸 만큼 못 받는다. */
    const rec = readFileSync(new URL('../subscriptions/subscription-reconcile.ts', import.meta.url), 'utf-8');
    expect(rec).toContain('(paidPlan ?? row.planCode)');
  });
});
