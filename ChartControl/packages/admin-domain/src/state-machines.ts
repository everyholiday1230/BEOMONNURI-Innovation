import { normalizeRole } from '@quantumtrade/auth';

/** Incident lifecycle (docs PHASE5-07). */
export const INCIDENT_STATES = ['OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED'] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];
export const INCIDENT_SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
const INC_T: Record<IncidentState, IncidentState[]> = {
  OPEN: ['INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED'],
  INVESTIGATING: ['MITIGATED', 'RESOLVED', 'CLOSED'],
  MITIGATED: ['RESOLVED', 'INVESTIGATING', 'CLOSED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  CLOSED: [],
};
export function canTransitionIncident(from: IncidentState, to: IncidentState): boolean {
  return INC_T[from]?.includes(to) ?? false;
}
export function isHighSeverity(sev: IncidentSeverity): boolean {
  return sev === 'SEV1' || sev === 'SEV2';
}

/** Release-gate status (docs PHASE5-08). */
export const RELEASE_GATE_STATES = ['NOT_STARTED', 'NOT_EXECUTED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'WAIVED', 'BLOCKED'] as const;
export type ReleaseGateStatus = (typeof RELEASE_GATE_STATES)[number];

export interface ReleaseGateUpdate {
  actorRole: string;
  current: ReleaseGateStatus;
  next: ReleaseGateStatus;
  hasEvidence: boolean;
  productionRequired: boolean;
  reason?: string;
  expiresAt?: number;
  now: number;
}

/**
 * A gate can only become PASSED with evidence (NO fake pass). WAIVED requires SUPER_ADMIN + reason +
 * expiry; a production-required gate cannot be permanently waived (must have a future expiry).
 */
export function evaluateReleaseGateUpdate(u: ReleaseGateUpdate): { allowed: boolean; reason?: string } {
  const role = normalizeRole(u.actorRole);
  if (!role || (role !== 'ADMIN' && role !== 'SUPER_ADMIN')) return { allowed: false, reason: 'insufficient role' };
  if (u.next === 'PASSED' && !u.hasEvidence) return { allowed: false, reason: 'cannot mark PASSED without evidence (no fake pass)' };
  if (u.next === 'WAIVED') {
    if (role !== 'SUPER_ADMIN') return { allowed: false, reason: 'only SUPER_ADMIN may waive a gate' };
    if (!u.reason || u.reason.trim().length < 8) return { allowed: false, reason: 'waiver requires a reason' };
    if (!u.expiresAt || u.expiresAt <= u.now) return { allowed: false, reason: 'waiver requires a future expiry' };
    if (u.productionRequired) {
      // Not a permanent waive: cap enforced (≤ 30 days) so a prod-required gate cannot be waived forever by one approver.
      if (u.expiresAt - u.now > 30 * 24 * 60 * 60 * 1000) return { allowed: false, reason: 'production-required gate waiver cannot exceed 30 days' };
    }
  }
  return { allowed: true };
}

/*
   Kill switch (docs PHASE5-06). Live-trading-related scopes are FAIL-CLOSED.

   ★★ `exchange_live_trading` 은 `bitmart_live_trading` 을 대체하는 **거래소 중립**
     이름이다. 옛 이름은 두 가지 이유로 남긴다:
       · 프로덕션 DB 에 그 이름의 행이 이미 있다(지우면 시드가 다시 만들고, 그
         사이 상태를 잃는다).
       · 옛 이름이 켜져 있는 배포를 새 코드가 무시하면 **차단이 조용히 풀린다.**
     그래서 둘 다 읽고, **하나라도 켜져 있으면 막는다**(fail-closed).

   ★★ 그리고 옛 스코프는 지금까지 **아무도 검사하지 않았다.** 관리자 화면에서 켤 수
     있었지만 주문 경로는 global_live_trading·new_positions 만 봤다. 즉 운영자가
     거래를 멈췄다고 믿는 동안 주문이 계속 나갔다. 새 이름은 실제로 강제된다.

   ★ 거래소를 더 붙이면(BitGet 등) 이 스코프는 "지금 연결된 거래소" 를 뜻한다.
     거래소별로 나눠야 할 때가 오면 그때 scope 에 거래소 id 를 붙인다 —
     지금 없는 거래소를 위해 미리 쪼개지 않는다.
*/
export const KILL_SWITCH_SCOPES = ['global_live_trading', 'exchange_live_trading', 'bitmart_live_trading', 'new_positions', 'user', 'credential', 'symbol', 'ai_provider', 'ai_signal_generation', 'ai_order_draft'] as const;
export type KillSwitchScope = (typeof KILL_SWITCH_SCOPES)[number];

const LIVE_TRADING_SCOPES: KillSwitchScope[] = ['global_live_trading', 'exchange_live_trading', 'bitmart_live_trading', 'new_positions'];

/**
 * 실주문을 막는 스코프 목록. 주문 경로가 **이 목록을 근거로** 검사해야 한다.
 *
 * ★★ 예전에는 주문 경로가 스코프 이름을 직접 나열했고(global_live_trading /
 *   new_positions), 그래서 bitmart_live_trading 이 목록에서 빠진 채 시드만 됐다.
 *   목록을 한 곳에서 내보내면 다음에 스코프를 추가할 때 강제 경로도 함께 따라온다.
 */
export const ORDER_BLOCKING_KILL_SCOPES: readonly KillSwitchScope[] = [
  'global_live_trading',
  'exchange_live_trading',
  'bitmart_live_trading',
  'new_positions',
];

/** Safe default when the kill-switch store is unavailable: live-trading scopes default to BLOCKED (active). */
export function killSwitchDefaultOnError(scope: KillSwitchScope): { active: boolean } {
  return { active: LIVE_TRADING_SCOPES.includes(scope) };
}

/** Feature flag change requires a reason + write permission (checked at API). Pure state helper. */
export interface FeatureFlagChange { enabled: boolean; reason?: string; }
export function isValidFlagChange(c: FeatureFlagChange): boolean {
  return typeof c.enabled === 'boolean' && !!c.reason && c.reason.trim().length >= 4;
}

/** Prompt-change lifecycle (docs PHASE5-05/08): no direct edit-to-production. */
export const PROMPT_CHANGE_STATES = ['DRAFT', 'REVIEW', 'APPROVED', 'STAGED', 'ACTIVE', 'ROLLED_BACK'] as const;
export type PromptChangeState = (typeof PROMPT_CHANGE_STATES)[number];
const PC_T: Record<PromptChangeState, PromptChangeState[]> = {
  DRAFT: ['REVIEW'],
  REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['STAGED', 'DRAFT'],
  STAGED: ['ACTIVE', 'ROLLED_BACK'],
  ACTIVE: ['ROLLED_BACK'],
  ROLLED_BACK: [],
};
export function canTransitionPromptChange(from: PromptChangeState, to: PromptChangeState): boolean {
  return PC_T[from]?.includes(to) ?? false;
}
