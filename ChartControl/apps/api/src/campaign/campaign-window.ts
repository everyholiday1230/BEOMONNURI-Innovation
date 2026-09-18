/**
 * KuCoin 공동 캠페인 창 판정.
 *
 * 왜 별도 모듈인가
 * ----------------
 * 캠페인 혜택은 **두 곳**에서 쓴다 — 신호 규칙 저장 무료(user-strategy-routes)와
 * 웰컴 포인트 지급(자격 검증 경로). 각자 날짜를 비교하면 한쪽만 고쳐져 **한 혜택은
 * 살아 있고 다른 혜택은 끝난** 상태가 된다. 판정을 한 곳에 둔다.
 *
 * ★★★ **기본값은 꺼짐이다.** 값이 비어 있으면 캠페인이 아니다. 기본으로 켜 두면
 *   신청서 없이도 포인트가 나가고, 그것은 되돌릴 수 없다(원장에 남는다).
 *
 * ★★ 종료일은 **그 날의 끝까지** 포함한다. `2026-10-31` 로 적어 놓고 그 날 아침에
 *   끊기면 고객은 약속받은 날에 혜택을 못 받는다. 신청서에 "~ 31 October" 라고
 *   썼으므로 31일 23:59:59.999 까지가 약속이다.
 *
 * ★ 시각 기준은 UTC 다. 서버가 어느 지역에 있든 같은 판정을 하려면 기준이 하나여야
 *   한다. 신청서의 날짜도 UTC 로 읽는다.
 *
 * 상세: CAMPAIGN-KUCOIN-2026-10.md
 */

export interface CampaignConfig {
  campaignStart: string;
  campaignEnd: string;
  campaignWelcomePoints: number;
  campaignFreeSignalSaves: number;
}

/** `YYYY-MM-DD` → 그 날 00:00:00.000 UTC. 형식이 아니면 null. */
function startOfDayUtc(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(day || '').trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * 지금이 캠페인 기간인가.
 *
 * @param now 판정 시각(ms). 시험이 시각을 넘길 수 있게 인자로 받는다 —
 *            `Date.now()` 를 안에서 부르면 기간 경계를 시험할 수 없다.
 */
export function campaignActive(cfg: CampaignConfig, now: number = Date.now()): boolean {
  const from = startOfDayUtc(cfg.campaignStart);
  const to = startOfDayUtc(cfg.campaignEnd);
  if (from === null || to === null) return false;
  /* ★ 시작일이 종료일보다 늦으면 설정 오류다 — 켜지 않는다. */
  if (from > to) return false;
  /* 종료일 그 날의 끝까지 포함(+1일). */
  return now >= from && now < to + 24 * 60 * 60 * 1000;
}

/**
 * 신호 규칙 저장이 무료인가.
 *
 * ★ 캠페인 중이고, **신호 규칙**이고, 이 이용자가 이미 저장한 신호 규칙 수가
 *   무료 횟수보다 적을 때만 무료다. 지표·전략은 대상이 아니다 — 신청서가
 *   "signal rules" 라고 썼다.
 */
export function signalSaveIsFree(
  cfg: CampaignConfig,
  kind: string,
  alreadySaved: number,
  now: number = Date.now(),
): boolean {
  if (kind !== 'signal') return false;
  if (cfg.campaignFreeSignalSaves <= 0) return false;
  if (!campaignActive(cfg, now)) return false;
  return alreadySaved < cfg.campaignFreeSignalSaves;
}
