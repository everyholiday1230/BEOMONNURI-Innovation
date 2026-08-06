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

/** Kill switch (docs PHASE5-06). Live-trading-related scopes are FAIL-CLOSED. */
export const KILL_SWITCH_SCOPES = ['global_live_trading', 'bitmart_live_trading', 'new_positions', 'user', 'credential', 'symbol', 'ai_provider', 'ai_signal_generation', 'ai_order_draft'] as const;
export type KillSwitchScope = (typeof KILL_SWITCH_SCOPES)[number];

const LIVE_TRADING_SCOPES: KillSwitchScope[] = ['global_live_trading', 'bitmart_live_trading', 'new_positions'];

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
