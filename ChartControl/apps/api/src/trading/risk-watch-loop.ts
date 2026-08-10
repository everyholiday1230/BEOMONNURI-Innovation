import type { INotificationRepo } from '../db/notification-repo';
import {
  MemoryAlertState,
  watchUserPositions,
  type AlertState,
  type PositionRisk,
} from './risk-watch';

/**
 * 청산 위험 감시 루프.
 *
 * 무엇을 하는가
 * -----------
 * 주기적으로 **거래소 키가 검증된 사용자**의 포지션을 조회하고, 청산가에
 * 가까우면 알림을 만든다. 화면이 닫혀 있어도 동작한다.
 *
 * 왜 이렇게 나눴는가
 * ----------------
 * 판단 로직(`risk-watch.ts`)과 조회 루프(이 파일)를 분리했다. 판단은 순수
 * 함수라 테스트가 쉽고, 루프는 rate limit·인증·주기 같은 운영 관심사를 다룬다.
 *
 * 안전 장치
 * -------
 * ★★ **한 번에 한 사용자씩 순차 조회한다.** 동시에 던지면 거래소 rate limit 에
 *   걸려 전체가 실패하고, 그러면 감시가 조용히 죽는다.
 *
 * ★★ **실주문이 닫혀 있으면 대상이 0명이다.** 검증된 키가 없으면 조회할 것이
 *   없으므로 부하도 0이다. 실주문을 켜는 순간 자동으로 동작한다.
 *
 * ★ **조회 실패를 삼키지 않는다.** 연속 실패가 임계값을 넘으면 로그에 남긴다 —
 *   감시가 멈춘 것을 운영자가 알아야 한다.
 *
 * ★ 기본값은 **꺼짐**이다. 환경변수로 명시적으로 켠다 — 실주문이 없는 배포에서
 *   불필요하게 거래소를 호출하지 않는다.
 */

export interface RiskWatchLoopDeps {
  notifications: INotificationRepo;
  /**
   * 감시 대상과 각자의 포지션을 가져온다.
   *
   * ★ 거래소 호출을 이 콜백 뒤로 숨긴다. 루프는 "누구를, 얼마나 자주" 만 알면
   *   되고, 어떤 거래소인지·어떻게 인증하는지는 몰라도 된다.
   */
  listWatchTargets: () => Promise<{ userId: string; positions: PositionRisk[] }[]>;
  /** 검사 주기(ms). 기본 2분. */
  intervalMs?: number;
  state?: AlertState;
  log?: (msg: string) => void;
}

export class RiskWatchLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private consecutiveFailures = 0;
  private readonly state: AlertState;
  private readonly intervalMs: number;
  private readonly log: (msg: string) => void;

  /** 마지막 실행 결과. 운영 화면이 감시 상태를 확인하는 근거다. */
  lastRun: {
    at: number;
    targets: number;
    notified: number;
    suppressed: number;
    unknown: number;
    error: string | null;
  } | null = null;

  constructor(private readonly d: RiskWatchLoopDeps) {
    /*
       ★ 기본 2분.

         더 짧게 하면 거래소 rate limit 에 가까워지고, 더 길게 하면 급락 때
         경고가 늦다. 선물은 몇 분 만에 청산까지 갈 수 있으므로 5분은 늦다.
    */
    this.intervalMs = Math.max(30_000, d.intervalMs ?? 120_000);
    this.state = d.state ?? new MemoryAlertState();
    this.log = d.log ?? ((m) => console.log(m));
  }

  start(): void {
    if (this.timer) return;
    this.log(`[risk-watch] 시작 — 주기 ${Math.round(this.intervalMs / 1000)}초`);
    // 즉시 한 번 돌린다. 재시작 직후의 위험을 다음 주기까지 기다릴 이유가 없다.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // 프로세스 종료를 막지 않는다.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log('[risk-watch] 중단');
  }

  /**
   * 한 주기 실행.
   *
   * ★ 이전 실행이 아직 끝나지 않았으면 건너뛴다. 겹쳐 돌면 같은 위험을 두 번
   *   알리고 거래소 호출도 두 배가 된다.
   */
  async tick(): Promise<void> {
    if (this.running) {
      this.log('[risk-watch] 이전 주기가 끝나지 않아 건너뜀');
      return;
    }
    this.running = true;
    const started = Date.now();
    let notified = 0;
    let suppressed = 0;
    let unknown = 0;
    let targets = 0;

    try {
      const list = await this.d.listWatchTargets();
      targets = list.length;

      /*
         ★ 순차 처리다. Promise.all 로 동시에 던지면 사용자가 늘어날 때 거래소
           rate limit 에 걸리고, 그러면 **전체 감시가 실패한다.**
      */
      for (const target of list) {
        const r = await watchUserPositions(
          { notifications: this.d.notifications, state: this.state },
          target.userId,
          target.positions,
        );
        notified += r.notified;
        suppressed += r.suppressed;
        unknown += r.unknown;
      }

      this.consecutiveFailures = 0;
      this.lastRun = { at: started, targets, notified, suppressed, unknown, error: null };

      // 알린 것이 있을 때만 로그를 남긴다 — 조용한 주기가 대부분이다.
      if (notified > 0) {
        this.log(`[risk-watch] 경고 ${notified}건 발송 (대상 ${targets}명, 억제 ${suppressed}, 판단불가 ${unknown})`);
      }
    } catch (e) {
      this.consecutiveFailures += 1;
      const msg = (e as Error).message ?? 'unknown';
      this.lastRun = { at: started, targets, notified, suppressed, unknown, error: msg };

      /*
         ★★ 실패를 조용히 넘기지 않는다.

           감시가 죽은 것을 아무도 모르면, 사용자는 경고가 오지 않는 이유를
           "위험하지 않아서" 로 오해한다. 연속 실패를 세서 로그로 알린다.
      */
      this.log(`[risk-watch] 실패 ${this.consecutiveFailures}회 연속: ${msg.slice(0, 200)}`);
      if (this.consecutiveFailures >= 3) {
        this.log('[risk-watch] ★ 연속 3회 실패 — 청산 경고가 발송되지 않고 있습니다. 확인이 필요합니다.');
      }
    } finally {
      this.running = false;
    }
  }

  /** 운영 화면용 상태. */
  status(): {
    running: boolean;
    intervalMs: number;
    consecutiveFailures: number;
    lastRun: RiskWatchLoop['lastRun'];
  } {
    return {
      running: this.timer !== null,
      intervalMs: this.intervalMs,
      consecutiveFailures: this.consecutiveFailures,
      lastRun: this.lastRun,
    };
  }
}
