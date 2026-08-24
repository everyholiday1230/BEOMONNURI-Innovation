import type { PgPriceAlertRepo, ActiveAlert } from '../db/price-alert-repo';

/*
   가격 알림 감시기.

   ★ 주기적으로 활성 알림을 읽고, 각 심볼의 실제 시세를 조회해 조건이 충족되면
     한 번만 발동시킨다(markTriggered 가 status=active 일 때만 바꾸므로 중복 방지).
     발동 시 앱 알림을 남기고, notifyEmail 이면 이메일도 보낸다.

   ★★ 가격을 지어내지 않는다. 시세 조회가 실패하거나 값이 없으면 그 심볼은 건너뛴다
     (다음 주기에 다시 본다). 없는 가격으로 알림을 울리면 거짓 신호가 된다.
*/

/** 조건 충족 여부 — 순수 함수(테스트 대상). */
export function crossed(direction: 'above' | 'below', price: number, target: number): boolean {
  if (!Number.isFinite(price) || price <= 0) return false;
  return direction === 'above' ? price >= target : price <= target;
}

export interface WatcherDeps {
  repo: PgPriceAlertRepo;
  /** 심볼의 현재가를 돌려준다. 없으면 null. */
  getPrice: (symbol: string) => Promise<number | null>;
  /** 앱 알림 생성. */
  notify: (input: { userId: string; symbol: string; direction: 'above' | 'below'; target: number; price: number }) => Promise<void>;
  /** 이메일 발송(선택). notifyEmail=true 인 알림에만. */
  sendEmail?: (input: { to: string; symbol: string; direction: 'above' | 'below'; target: number; price: number }) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * 한 주기 실행. 발동된 알림 수를 돌려준다(테스트·로깅용).
 */
export async function runAlertSweep(d: WatcherDeps): Promise<number> {
  let active: ActiveAlert[];
  try {
    active = await d.repo.listActive();
  } catch (e) {
    d.log?.(`[alerts] 활성 알림 조회 실패: ${(e as Error).message}`);
    return 0;
  }
  if (active.length === 0) return 0;

  /* 심볼별 시세를 한 번만 조회해 재사용한다(같은 심볼 알림이 여러 개일 수 있다). */
  const priceCache = new Map<string, number | null>();
  const priceFor = async (symbol: string): Promise<number | null> => {
    if (priceCache.has(symbol)) return priceCache.get(symbol) ?? null;
    let p: number | null = null;
    try { p = await d.getPrice(symbol); } catch { p = null; }
    priceCache.set(symbol, p);
    return p;
  };

  let fired = 0;
  for (const alert of active) {
    const price = await priceFor(alert.symbol);
    if (price == null) continue; // 시세 없음 — 지어내지 않고 건너뛴다
    if (!crossed(alert.direction, price, alert.targetPrice)) continue;

    /* markTriggered 가 true 를 주면 '이번에 처음 발동' 이므로 통지한다(중복 방지). */
    let firstTrigger = false;
    try {
      firstTrigger = await d.repo.markTriggered(alert.id, price);
    } catch (e) {
      d.log?.(`[alerts] markTriggered 실패(${alert.id}): ${(e as Error).message}`);
      continue;
    }
    if (!firstTrigger) continue;

    fired += 1;
    try {
      await d.notify({ userId: alert.userId, symbol: alert.symbol, direction: alert.direction, target: alert.targetPrice, price });
    } catch (e) {
      d.log?.(`[alerts] 앱 알림 생성 실패(${alert.id}): ${(e as Error).message}`);
    }
    if (alert.notifyEmail && d.sendEmail && alert.userEmail) {
      try {
        await d.sendEmail({ to: alert.userEmail, symbol: alert.symbol, direction: alert.direction, target: alert.targetPrice, price });
      } catch (e) {
        d.log?.(`[alerts] 이메일 발송 실패(${alert.id}): ${(e as Error).message}`);
      }
    }
  }
  return fired;
}
