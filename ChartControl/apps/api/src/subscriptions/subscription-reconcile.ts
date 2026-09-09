/**
 * 승인 대기 구독을 PayPal 에 대조한다.
 *
 * ★★★ 왜 필요한가 — 고객이 돈을 내고 아무것도 못 받는 경우를 막는다
 *
 *   구독 흐름은 checkout → (PayPal 승인) → confirm 이다. confirm 은 **고객의
 *   브라우저가 돌아와야** 실행된다. 돌아오지 못하면:
 *
 *     · PayPal 쪽 구독은 ACTIVE 이고 요금이 청구된다
 *     · 우리 DB 는 'pending' 에 머문다 → 접근권이 없다
 *     · 고객은 "돈 냈는데 왜 안 되냐" 고 문의한다
 *
 *   브라우저가 돌아오지 않는 이유는 흔하다 — 결제 후 탭을 닫는다, 모바일에서 앱
 *   전환 중 세션이 끊긴다, 네트워크가 바뀐다, PayPal 이 리디렉트에 실패한다.
 *
 * ★ 그래서 **서버가 스스로 물어본다.** 웹훅과 달리 PayPal 쪽 설정이 전혀 필요 없다.
 *   우리가 만든 구독 id 를 이미 저장해 두었으므로(markPending) 그것으로 조회한다.
 *
 * ★★ 웹훅이 있어도 이 작업은 남겨 둔다. 웹훅은 유실될 수 있고(등록 누락, 서명 실패,
 *   우리 쪽 장애 중 재시도 소진) 그때 마지막으로 고객을 구제하는 것이 이 경로다.
 *   "둘 중 하나면 된다" 가 아니라 **둘 다 있어야 새는 곳이 없다.**
 */
import type { PgSubscriptionRepo } from './subscription-repo';
import type { PlanCode } from './plans';

/**
 * PayPal 조회에 필요한 최소 인터페이스. 테스트에서 가짜를 넣는다.
 *
 * ★ 실제 provider 는 던지지 않고 `ok: false` 를 돌려준다(providers.ts). 그것을
 *   "구독이 없다" 로 오해하면 일시적 장애에 유효한 결제를 만료로 지운다. 그래서
 *   ok 를 반드시 본다.
 */
export interface ReconcileProvider {
  getSubscription(providerRef: string): Promise<{
    /**
     * ★★ **조회 자체가 됐는가.** 구독이 유효한가가 아니다.
     *
     *   provider 의 `ok` 는 "ACTIVE 인가" 를 뜻한다. 그것을 조회 성공으로 오해하면
     *   승인 전(APPROVAL_PENDING)·취소됨(CANCELLED)이 전부 "조회 실패" 가 되어
     *   **상태 처리가 전혀 동작하지 않는다.** 실제로 그 버그를 샌드박스에서 겪었다.
     */
    lookupOk: boolean;
    status: string;
    planId?: string;
    nextBillingAt?: string;
    customId?: string;
  }>;
}

/** 활성화될 때 할 일(기간 반영 + 포인트 지급). 라우터의 confirm 과 같은 처리다. */
export interface ReconcileActivator {
  activate(input: {
    userId: string;
    planCode: PlanCode;
    providerRef: string;
    nextBillingAt?: string;
  }): Promise<void>;
}

export interface ReconcileOutcome {
  providerRef: string;
  /** 무엇을 했는가. 로그와 테스트가 이 값을 본다. */
  action: 'activated' | 'expired' | 'still_pending' | 'lookup_failed' | 'activate_failed';
  status?: string;
  error?: string;
}

export interface RenewOutcome {
  providerRef: string;
  action: 'extended' | 'not_advanced' | 'ended' | 'lookup_failed' | 'extend_failed' | 'no_billing_date';
  status?: string;
  /** 새 기간 끝(연장했을 때). */
  periodEnd?: number;
  error?: string;
}

/**
 * PayPal 상태 문자열 → 우리 판단.
 *
 * ★ 모르는 값은 **활성으로 보지 않는다.** PayPal 이 새 상태를 추가했을 때 그것을
 *   ACTIVE 로 오해하면 결제 없이 유료 기능이 열린다. 모르면 대기로 남긴다 —
 *   다음 회차에 다시 물어보고, 사람이 로그에서 본다.
 */
export function judgePaypalStatus(status: string): 'active' | 'dead' | 'wait' {
  const s = String(status || '').toUpperCase();
  if (s === 'ACTIVE') return 'active';
  /*
     ★ CANCELLED·EXPIRED 는 끝난 것이다. SUSPENDED 는 결제가 밀린 상태로, PayPal 이
       다시 시도할 수 있으므로 끝난 것으로 보지 않는다(대기).
  */
  if (s === 'CANCELLED' || s === 'EXPIRED') return 'dead';
  return 'wait';
}

/**
 * 한 번 대조한다.
 *
 * @param olderThanMs 이보다 오래된 대기 건만 본다. 방금 만든 것을 건드리면 고객이
 *   PayPal 화면에서 결제하는 중에 상태가 바뀐다.
 * @param giveUpAfterMs 이보다 오래 대기면 만료로 정리한다. 승인하지 않고 떠난
 *   흔적을 영원히 남기면 대조 대상이 계속 늘어난다.
 */
export async function reconcilePendingOnce(
  repo: PgSubscriptionRepo,
  provider: ReconcileProvider,
  activator: ReconcileActivator,
  opts: { olderThanMs?: number; giveUpAfterMs?: number; limit?: number } = {},
): Promise<ReconcileOutcome[]> {
  const olderThanMs = opts.olderThanMs ?? 10 * 60_000;
  const giveUpAfterMs = opts.giveUpAfterMs ?? 7 * 24 * 60 * 60 * 1000;
  const rows = await repo.listPending(olderThanMs, opts.limit ?? 50);
  const out: ReconcileOutcome[] = [];

  for (const row of rows) {
    let status: string;
    let nextBillingAt: string | undefined;
    try {
      const got = await provider.getSubscription(row.providerRef);
      /*
         ★★ ok:false 는 **조회 실패**다. 상태 문자열(http_500 등)을 그대로 판정에
           넣으면 'wait' 로 떨어져 조용히 넘어가고, 오래되면 만료로 지워진다.
           고객의 유효한 결제를 장애 때문에 버리는 셈이다. 명시적으로 실패 처리한다.
      */
      if (!got.lookupOk) {
        out.push({ providerRef: row.providerRef, action: 'lookup_failed', status: got.status });
        continue;
      }
      status = got.status;
      nextBillingAt = got.nextBillingAt;
    } catch (e) {
      /*
         ★ 조회 실패를 "없는 구독" 으로 보지 않는다. 그러면 일시적인 장애에
           고객의 유효한 결제를 만료로 지워버린다. 대기로 남기고 다음에 다시 본다.
      */
      out.push({ providerRef: row.providerRef, action: 'lookup_failed', error: (e as Error).message });
      continue;
    }

    const verdict = judgePaypalStatus(status);

    if (verdict === 'active') {
      try {
        await activator.activate({
          userId: row.userId,
          planCode: row.planCode as PlanCode,
          providerRef: row.providerRef,
          nextBillingAt,
        });
        out.push({ providerRef: row.providerRef, action: 'activated', status });
      } catch (e) {
        /*
           ★★ 활성화가 실패하면 pending 으로 **남긴다.** 여기서 상태를 바꿔버리면
             다음 회차가 이 건을 보지 못하고, 고객은 결제한 채로 방치된다.
        */
        out.push({ providerRef: row.providerRef, action: 'activate_failed', status, error: (e as Error).message });
      }
      continue;
    }

    if (verdict === 'dead') {
      await repo.setStatus(row.userId, 'expired');
      out.push({ providerRef: row.providerRef, action: 'expired', status });
      continue;
    }

    /* 대기 — 너무 오래됐으면 정리한다. */
    if (Date.now() - row.pendingSince > giveUpAfterMs) {
      await repo.setStatus(row.userId, 'expired');
      out.push({ providerRef: row.providerRef, action: 'expired', status });
      continue;
    }
    out.push({ providerRef: row.providerRef, action: 'still_pending', status });
  }

  return out;
}

export interface ReconcileHandle { stop(): void }

/**
 * 주기 실행.
 *
 * ★ 부팅 직후에 돌리지 않는다(기본 90초 뒤). 부팅 시점에는 마이그레이션과 플랜
 *   검증이 아직 끝나지 않았을 수 있다.
 */
export function startSubscriptionReconciler(
  repo: PgSubscriptionRepo,
  provider: ReconcileProvider,
  activator: ReconcileActivator,
  opts: {
    intervalMs?: number;
    firstDelayMs?: number;
    /** 활성 구독 기간 연장. 없으면 갱신 확인을 하지 않는다(그러면 2회차에 끊긴다). */
    renewer?: {
      extend(input: {
        userId: string; planCode: PlanCode; providerRef: string;
        periodStart: number; periodEnd: number;
      }): Promise<void>;
    };
  } = {},
): ReconcileHandle {
  const intervalMs = opts.intervalMs ?? 15 * 60_000;
  const firstDelayMs = opts.firstDelayMs ?? 90_000;

  const runNow = async () => {
    try {
      const res = await reconcilePendingOnce(repo, provider, activator);
      const activated = res.filter((r) => r.action === 'activated');
      const failed = res.filter((r) => r.action === 'activate_failed' || r.action === 'lookup_failed');
      if (activated.length > 0) {
        /*
           ★ 이것은 **고객을 구제한 기록**이다. 반드시 남긴다 — 몇 명이 이 경로로
             살아났는지 알아야 confirm 흐름을 더 고쳐야 하는지 판단할 수 있다.
        */
        console.log(`[subscription] 승인 대조: ${activated.length}건을 활성화했다 (브라우저가 돌아오지 않은 결제).`);
      }
      for (const f of failed) {
        /* ★ 실패는 크게 남긴다. 돈이 걸린 경로다. */
        console.error(`[subscription] 승인 대조 실패 ref=${f.providerRef} action=${f.action}: ${f.error ?? ''}`);
      }
    } catch (e) {
      console.error(`[subscription] 승인 대조 작업 자체가 실패했다: ${(e as Error).message}`);
    }

    /*
       ★★ 갱신 확인. 이것이 없으면 **2회차부터 모든 구독자가** 돈만 내고 접근권을
         잃는다. 승인 대조(브라우저가 돌아오지 않은 경우)보다 영향이 크다.
    */
    if (!opts.renewer) return;
    try {
      const res = await reconcileRenewalsOnce(repo, provider, opts.renewer);
      const extended = res.filter((r) => r.action === 'extended');
      const ended = res.filter((r) => r.action === 'ended');
      const bad = res.filter((r) => r.action === 'extend_failed' || r.action === 'lookup_failed' || r.action === 'no_billing_date');
      if (extended.length > 0) {
        console.log(`[subscription] 갱신 반영: ${extended.length}건의 기간을 연장했다.`);
      }
      if (ended.length > 0) {
        console.log(`[subscription] PayPal 쪽에서 종료된 구독 ${ended.length}건 — 남은 기간까지 유효하게 둔다.`);
      }
      for (const f of bad) {
        /*
           ★ 돈이 걸린 경로다. 특히 no_billing_date 는 고객이 결제 중인데 우리가
             연장하지 못한 상태이므로 반드시 사람이 봐야 한다.
        */
        console.error(`[subscription] ★ 갱신 확인 문제 ref=${f.providerRef} action=${f.action} status=${f.status ?? ''}: ${f.error ?? ''}`);
      }
    } catch (e) {
      console.error(`[subscription] 갱신 확인 작업 자체가 실패했다: ${(e as Error).message}`);
    }
  };

  const first = setTimeout(() => { void runNow(); }, firstDelayMs);
  const timer = setInterval(() => { void runNow(); }, intervalMs);
  if (typeof first.unref === 'function') first.unref();
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop() { clearTimeout(first); clearInterval(timer); },
  };
}


/**
 * 활성 구독의 기간을 PayPal 기준으로 연장한다.
 *
 * ★★★ 이것이 없으면 **2회차부터 고객이 돈만 내고 접근권을 잃는다.**
 *
 *   PayPal 구독은 매달 자기가 알아서 청구한다. 우리 쪽에서 기간을 갱신하는 곳은
 *   confirm(가입 시 1회)과 승인 대조(pending 전용)뿐이었다. 활성 구독을 다시 보는
 *   경로가 없었으므로, 가입 한 달 뒤 PayPal 은 정상 청구하는데 우리 기간은 지나
 *   있어 entitled 가 false 가 된다.
 *
 *   승인 대조와 달리 이것은 **모든 구독자에게 반드시** 일어난다.
 *
 * ★★ 멱등해야 한다 — 15분마다 돌기 때문이다.
 *
 *   기간이 **실제로 앞으로 나아갔을 때만** 기록한다(nextEnd > prevEnd). 매번
 *   now() 로 periodStart 를 새로 쓰면 claimMonthlyGrant 가 "새 주기" 로 오해해
 *   **폴링마다 포인트를 지급한다.** 그래서 periodStart 는 **이전 기간의 끝**으로
 *   둔다 — 주기 경계라서 한 주기에 정확히 한 번만 바뀐다.
 *
 * ★ PayPal 이 ACTIVE 라고 하면 결제가 정상이라는 뜻이다. SUSPENDED(결제 실패)면
 *   연장하지 않는다 — 기간이 끝나면 자연히 만료된다. 유예기간을 우리가 임의로
 *   만들지 않는다. 결제 없이 기능을 여는 판단을 코드가 대신하면 안 된다.
 */
export async function reconcileRenewalsOnce(
  repo: PgSubscriptionRepo,
  provider: ReconcileProvider,
  renewer: {
    extend(input: {
      userId: string;
      planCode: PlanCode;
      providerRef: string;
      periodStart: number;
      periodEnd: number;
    }): Promise<void>;
  },
  opts: { withinMs?: number; limit?: number } = {},
): Promise<RenewOutcome[]> {
  const withinMs = opts.withinMs ?? 2 * 24 * 60 * 60 * 1000;
  const rows = await repo.listRenewable(withinMs, opts.limit ?? 50);
  const out: RenewOutcome[] = [];

  for (const row of rows) {
    let got: Awaited<ReturnType<ReconcileProvider['getSubscription']>>;
    try {
      got = await provider.getSubscription(row.providerRef);
    } catch (e) {
      out.push({ providerRef: row.providerRef, action: 'lookup_failed', error: (e as Error).message });
      continue;
    }
    /*
       ★ ok:false 는 조회 실패다. "구독이 없다" 로 보면 장애 때 유효한 구독을 끊는다.
    */
    if (!got.lookupOk) {
      out.push({ providerRef: row.providerRef, action: 'lookup_failed', status: got.status });
      continue;
    }

    const verdict = judgePaypalStatus(got.status);

    if (verdict === 'dead') {
      /*
         ★ PayPal 쪽이 끝났다. 남은 기간까지는 쓸 수 있어야 하므로 'canceled' 로 둔다
           — 이미 낸 몫을 빼앗지 않는다. 기간이 지나면 entitled 가 저절로 false 다.
      */
      await repo.setStatus(row.userId, 'canceled');
      out.push({ providerRef: row.providerRef, action: 'ended', status: got.status });
      continue;
    }

    if (verdict !== 'active') {
      /* SUSPENDED 등 — 연장하지 않는다. 기간이 끝나면 만료된다. */
      out.push({ providerRef: row.providerRef, action: 'not_advanced', status: got.status });
      continue;
    }

    const nextMs = got.nextBillingAt ? Date.parse(got.nextBillingAt) : NaN;
    if (!Number.isFinite(nextMs)) {
      /*
         ★★ ACTIVE 인데 다음 청구일을 읽을 수 없다. 임의로 연장하면 결제 없이 기능이
           열릴 수 있으므로 연장하지 않고 **크게 남긴다.** 고객이 끊기면 이 로그로
           원인을 찾는다.
      */
      out.push({ providerRef: row.providerRef, action: 'no_billing_date', status: got.status });
      continue;
    }

    /*
       ★ 앞으로 나아갔을 때만 기록한다. 같은 값으로 다시 쓰면 주기가 바뀐 것으로
         오해해 포인트를 또 지급한다.
    */
    if (!(nextMs > row.periodEnd)) {
      out.push({ providerRef: row.providerRef, action: 'not_advanced', status: got.status, periodEnd: row.periodEnd });
      continue;
    }

    try {
      await renewer.extend({
        userId: row.userId,
        planCode: row.planCode as PlanCode,
        providerRef: row.providerRef,
        /* ★ 주기 경계. now() 를 쓰면 폴링마다 값이 바뀌어 포인트가 중복 지급된다. */
        periodStart: row.periodEnd,
        periodEnd: nextMs,
      });
      out.push({ providerRef: row.providerRef, action: 'extended', status: got.status, periodEnd: nextMs });
    } catch (e) {
      out.push({ providerRef: row.providerRef, action: 'extend_failed', status: got.status, error: (e as Error).message });
    }
  }

  return out;
}
