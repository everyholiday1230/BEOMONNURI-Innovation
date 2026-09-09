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
    ok: boolean;
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
      if (!got.ok) {
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
  opts: { intervalMs?: number; firstDelayMs?: number } = {},
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
  };

  const first = setTimeout(() => { void runNow(); }, firstDelayMs);
  const timer = setInterval(() => { void runNow(); }, intervalMs);
  if (typeof first.unref === 'function') first.unref();
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop() { clearTimeout(first); clearInterval(timer); },
  };
}
