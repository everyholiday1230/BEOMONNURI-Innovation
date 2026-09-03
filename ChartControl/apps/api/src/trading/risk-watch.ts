import type { INotificationRepo } from '../db/notification-repo';

/**
 * 청산 위험 감시 (서버).
 *
 * 왜 필요한가
 * ---------
 * 지금은 **화면이 열려 있을 때만** 청산 경고가 계산된다(`src/risk-alerts.js`).
 * 그래서 사용자가 탭을 닫거나 자는 동안 가격이 청산가에 접근해도 알 방법이 없다.
 * 선물 거래에서 그것은 자금 손실로 직결된다.
 *
 * 설계 원칙
 * -------
 * ★★ **거래소가 계산한 청산가만 쓴다.** 우리가 증거금률로 청산가를 추정하면
 *   거래소의 실제 계산(수수료·펀딩·유지증거금률 단계)과 어긋난다. 어긋난 값으로
 *   "안전하다" 고 알리는 것이 경고가 없는 것보다 나쁘다.
 *
 * ★★ **같은 위험을 반복해서 알리지 않는다.** 2분마다 같은 문구를 보내면
 *   사용자가 알림을 끄고, 그러면 진짜 급한 경고도 못 본다. 등급이 나빠질 때만
 *   다시 알린다(warning → critical).
 *
 * ★ **조회 실패를 '안전'으로 해석하지 않는다.** 거래소가 응답하지 않으면 위험
 *   여부를 모르는 것이다. 그 상태를 조용히 넘기면 감시가 죽은 것을 아무도 모른다.
 *
 * ★ 실주문이 닫혀 있으면 감시 대상이 0명이므로 부하도 0이다. 실주문을 켜는
 *   순간 자동으로 동작한다.
 */

/** 경고 등급. 숫자가 클수록 위험하다. */
export const RISK_LEVELS = ['warning', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const LEVEL_RANK: Record<RiskLevel, number> = { warning: 1, critical: 2 };

/**
 * 청산까지 거리로 등급을 정한다.
 *
 * ★ 임계값을 코드에 두는 이유: 사용자가 정하는 값이 아니고, 바꾸려면 그 근거를
 *   함께 검토해야 한다. 설정으로 열면 누군가 1% 로 낮추고 경고가 무의미해진다.
 *
 * · 12% 이내 — 하루 변동으로 닿을 수 있는 거리다.
 * · 5% 이내  — 몇 분 만에 닿을 수 있다.
 */
const THRESHOLDS: { level: RiskLevel; maxDistancePct: number }[] = [
  { level: 'critical', maxDistancePct: 5 },
  { level: 'warning', maxDistancePct: 12 },
];

export interface PositionRisk {
  symbol: string;
  side: string;
  /** 거래소가 계산한 청산가. 없으면 판단하지 않는다. */
  liquidationPrice: number | null;
  /** 현재 표시가. 없으면 판단하지 않는다. */
  markPrice: number | null;
}

export interface RiskVerdict {
  level: RiskLevel;
  distancePct: number;
}

/**
 * 한 포지션의 위험 등급.
 *
 * ★ 청산가나 표시가를 모르면 `null` 이다 — "안전" 이 아니다. 호출자가 그 둘을
 *   구분해야 한다.
 */
export function assessPosition(p: PositionRisk): RiskVerdict | null {
  const liq = p.liquidationPrice;
  const mark = p.markPrice;
  if (liq === null || mark === null) return null;
  if (!Number.isFinite(liq) || !Number.isFinite(mark)) return null;
  // 청산가가 0 이면 거래소가 아직 계산하지 않은 것이다(신규 포지션 등).
  if (liq <= 0 || mark <= 0) return null;

  const distancePct = (Math.abs(mark - liq) / mark) * 100;
  for (const t of THRESHOLDS) {
    if (distancePct <= t.maxDistancePct) return { level: t.level, distancePct };
  }
  return null;
}

/** 마지막으로 알린 등급. 중복 알림을 막는 근거다. */
export interface AlertState {
  get(key: string): RiskLevel | undefined;
  set(key: string, level: RiskLevel): void;
  delete(key: string): void;
  keys(): Iterable<string>;
}

/** 메모리 상태. 재시작하면 초기화된다 — 그때 한 번 더 알리는 편이 안전하다. */
export class MemoryAlertState implements AlertState {
  private readonly map = new Map<string, RiskLevel>();
  get(k: string) { return this.map.get(k); }
  set(k: string, v: RiskLevel) { this.map.set(k, v); }
  delete(k: string) { this.map.delete(k); }
  keys() { return this.map.keys(); }
}

export interface RiskWatchDeps {
  notifications: INotificationRepo;
  state?: AlertState;
  /** 테스트용 시계. */
  now?: () => number;
  /*
     청산 경고 이메일 발송.

     ★★ 왜 필요한가: 인앱 알림만으로는 **자고 있는 고객에게 닿지 않는다.**
       청산은 고객이 화면을 보고 있지 않을 때도 진행되고, 그때가 정확히 알려야
       할 순간이다. 이 감시 기능의 주석이 걱정한 상황("사용자가 자는 동안")을
       인앱 알림으로는 해결할 수 없다.

     ★ 없으면(undefined) 인앱 알림만 만든다 — 메일 설정이 없는 배포에서 감시가
       멈추면 안 된다.

     ★ 실패해도 던지지 않는다. 메일 발송 실패가 감시 루프를 멈추면 다른 고객의
       경고까지 사라진다.
  */
  emailAlert?: (input: {
    userId: string;
    symbol: string;
    side: 'long' | 'short';
    level: RiskLevel;
    distancePct: number;
    markPrice: string;
    liquidationPrice: string;
  }) => Promise<void>;
}

export interface WatchResult {
  /** 새로 알린 건수. */
  notified: number;
  /** 위험하지만 이미 같은 등급으로 알린 건수. */
  suppressed: number;
  /** 청산가·표시가를 몰라 판단하지 못한 건수. */
  unknown: number;
  /** 위험이 해소돼 상태를 지운 건수. */
  cleared: number;
}

/**
 * 사용자 포지션을 검사하고 필요하면 알림을 만든다.
 *
 * ★ 이 함수는 **거래소를 호출하지 않는다.** 포지션 목록을 받아서 판단만 한다 —
 *   조회 방식(주기·인증·rate limit)과 판단 로직을 분리해야 각각 테스트할 수 있다.
 */
export async function watchUserPositions(
  d: RiskWatchDeps,
  userId: string,
  positions: PositionRisk[],
): Promise<WatchResult> {
  const state = d.state ?? new MemoryAlertState();
  const out: WatchResult = { notified: 0, suppressed: 0, unknown: 0, cleared: 0 };

  /* 이번에 본 포지션 키. 사라진 포지션의 상태를 지우는 데 쓴다. */
  const seen = new Set<string>();

  for (const p of positions) {
    const key = `${userId}:${p.symbol}:${p.side}`;
    seen.add(key);

    const verdict = assessPosition(p);
    if (!verdict) {
      /*
         ★ 판단 불가를 '안전' 으로 처리하지 않는다.

           청산가를 모르는 상태가 계속되면 감시가 사실상 꺼진 것이다. 개수를
           돌려줘서 호출자가 로그·지표로 남길 수 있게 한다.
      */
      out.unknown += 1;
      continue;
    }

    const last = state.get(key);
    /*
       ★★ 등급이 나빠질 때만 다시 알린다.

         같은 등급을 반복하면 사용자가 알림을 끄고, 그러면 정말 급한 경고도
         못 본다. warning → critical 은 알리고, critical → warning(호전)은
         알리지 않는다 — 좋아진 소식으로 사용자를 깨울 이유가 없다.
    */
    if (last && LEVEL_RANK[verdict.level] <= LEVEL_RANK[last]) {
      out.suppressed += 1;
      continue;
    }

    await d.notifications.create({
      userId,
      type: 'risk_alert',
      severity: verdict.level === 'critical' ? 'critical' : 'warning',
      /*
         ★ 메시지에 숫자를 담는다. "위험합니다" 만 보내면 사용자가 화면을 열어
           확인해야 하고, 그 사이에 청산될 수 있다.
         ★ 평문만 쓴다. 화면이 텍스트 노드로 렌더한다.
      */
      message: `${p.symbol} ${p.side === 'short' ? 'SHORT' : 'LONG'} — ${verdict.distancePct.toFixed(1)}% away from liquidation`,
      correlationId: `${p.symbol}:${p.side}`,
      at: d.now ? d.now() : undefined,
    });
    /*
       ★★ 이메일도 보낸다 — 인앱 알림만으로는 자고 있는 고객에게 닿지 않는다.

         등급이 나빠진 이 지점에서만 보낸다. 위 억제 로직을 그대로 타므로
         같은 등급이 반복될 때 메일이 쌓이지 않는다. 그게 중요한 이유: 메일이
         흔해지면 고객이 규칙을 만들어 걸러버리고, 그러면 정말 급한 경고도
         못 본다.

       ★ await 하되 실패는 삼킨다. 메일 실패가 루프를 멈추면 **다른 고객의
         경고까지** 사라진다 — 한 명의 메일 문제로 전체 감시를 잃을 수 없다.
    */
    if (d.emailAlert) {
      try {
        await d.emailAlert({
          userId,
          symbol: p.symbol,
          side: p.side === 'short' ? 'short' : 'long',
          level: verdict.level,
          distancePct: verdict.distancePct,
          /*
             ★ 숫자를 문자열로 넘긴다. 메일 본문에 그대로 들어가는 값이고,
               여기서 반올림해 버리면 고객이 거래소에서 보는 값과 어긋난다.
          */
          markPrice: p.markPrice === null ? '' : String(p.markPrice),
          liquidationPrice: p.liquidationPrice === null ? '' : String(p.liquidationPrice),
        });
      } catch {
        /* 메일은 최선의 노력이다. 인앱 알림은 이미 만들어졌다. */
      }
    }
    state.set(key, verdict.level);
    out.notified += 1;
  }

  /*
     사라진 포지션의 상태를 지운다.

     ★ 지우지 않으면 같은 심볼로 다시 진입했을 때 "이미 알렸다" 로 판단해
       경고를 건너뛴다. 청산됐거나 청산한 포지션은 상태도 없어야 한다.
  */
  for (const key of [...state.keys()]) {
    if (key.startsWith(`${userId}:`) && !seen.has(key)) {
      state.delete(key);
      out.cleared += 1;
    }
  }

  return out;
}
