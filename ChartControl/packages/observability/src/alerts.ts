/**
 * Alerting / incident rule engine (Phase 6 §6). Evaluates metric/event conditions into alerts with
 * severity, dedup, silence windows, and recovery notifications. The notifier is an injectable adapter
 * (PagerDuty/Slack in prod); a MockNotifier is used for verification when no real channel is wired
 * (recorded as Not Executed for live delivery).
 */
export type Severity = 'critical' | 'warning' | 'info';

export interface AlertRule {
  id: string;
  description: string;
  severity: Severity;
  runbook: string;
  owner: string;
  /** true → firing. */
  condition: (ctx: Record<string, number>) => boolean;
}

export interface AlertNotification {
  ruleId: string;
  severity: Severity;
  state: 'firing' | 'recovered';
  description: string;
  runbook: string;
  owner: string;
  atMs: number;
}

export interface Notifier {
  send(n: AlertNotification): void;
}

export class MockNotifier implements Notifier {
  readonly sent: AlertNotification[] = [];
  send(n: AlertNotification): void { this.sent.push(n); }
}

export interface AlertManagerConfig {
  dedupWindowMs: number; // suppress duplicate firing within window
  now: () => number;
}

export class AlertManager {
  private firing = new Map<string, number>(); // ruleId → lastFiredMs
  private silenced = new Map<string, number>(); // ruleId → silencedUntilMs
  constructor(
    private readonly rules: AlertRule[],
    private readonly notifier: Notifier,
    private readonly cfg: AlertManagerConfig,
  ) {}

  silence(ruleId: string, untilMs: number): void { this.silenced.set(ruleId, untilMs); }

  /** Evaluate all rules against a metric context; emits firing/recovery with dedup + silence. */
  evaluate(ctx: Record<string, number>): AlertNotification[] {
    const now = this.cfg.now();
    const emitted: AlertNotification[] = [];
    for (const rule of this.rules) {
      const active = rule.condition(ctx);
      const lastFired = this.firing.get(rule.id);
      const silencedUntil = this.silenced.get(rule.id) ?? 0;
      if (active) {
        if (silencedUntil > now) continue; // silenced
        if (lastFired !== undefined && now - lastFired < this.cfg.dedupWindowMs) continue; // dedup
        this.firing.set(rule.id, now);
        const n: AlertNotification = { ruleId: rule.id, severity: rule.severity, state: 'firing', description: rule.description, runbook: rule.runbook, owner: rule.owner, atMs: now };
        this.notifier.send(n); emitted.push(n);
      } else if (lastFired !== undefined) {
        this.firing.delete(rule.id);
        const n: AlertNotification = { ruleId: rule.id, severity: rule.severity, state: 'recovered', description: rule.description, runbook: rule.runbook, owner: rule.owner, atMs: now };
        this.notifier.send(n); emitted.push(n); // recovery notification
      }
    }
    return emitted;
  }
}

/** Default Phase 6 alert rules (thresholds are illustrative and configurable). */
export function defaultAlertRules(): AlertRule[] {
  const r = (id: string, description: string, severity: Severity, owner: string, condition: AlertRule['condition']): AlertRule =>
    ({ id, description, severity, owner, runbook: `docs/PHASE6-06-ALERTING.md#${id}`, condition });
  return [
    r('api_error_rate', 'API error rate high', 'critical', 'oncall-backend', (c) => (c.errorRate ?? 0) > 0.05),
    r('api_latency_p95', 'API p95 latency high', 'warning', 'oncall-backend', (c) => (c.p95Ms ?? 0) > 1000),
    r('db_pool_exhausted', 'PostgreSQL pool exhausted', 'critical', 'oncall-backend', (c) => (c.dbPoolAvailable ?? 1) <= 0),
    r('redis_down', 'Redis unavailable', 'critical', 'oncall-backend', (c) => (c.redisUp ?? 1) === 0),
    r('bitmart_ws_reconnects', 'BitMart WS repeated reconnects', 'warning', 'oncall-market', (c) => (c.wsReconnectsPerMin ?? 0) > 10),
    r('stale_market_data', 'Stale market data', 'warning', 'oncall-market', (c) => (c.staleFeeds ?? 0) > 0),
    r('dropped_messages', 'Dropped messages increasing', 'warning', 'oncall-market', (c) => (c.droppedPerMin ?? 0) > 100),
    r('reconciliation_mismatch', 'Reconciliation mismatch', 'critical', 'oncall-trading', (c) => (c.reconMismatch ?? 0) > 0),
    r('submit_unknown', 'SUBMIT_UNKNOWN orders present', 'critical', 'oncall-trading', (c) => (c.submitUnknown ?? 0) > 0),
    r('openai_errors', 'OpenAI 429/5xx elevated', 'warning', 'oncall-ai', (c) => (c.openaiErrorRate ?? 0) > 0.1),
    r('cost_budget', 'AI cost budget exceeded', 'warning', 'oncall-ai', (c) => (c.costOverBudget ?? 0) === 1),
    r('login_attack', 'Login brute-force detected', 'critical', 'oncall-security', (c) => (c.loginFailPerMin ?? 0) > 50),
    r('mfa_attack', 'MFA brute-force detected', 'critical', 'oncall-security', (c) => (c.mfaFailPerMin ?? 0) > 20),
    r('admin_role_change', 'Admin role change', 'info', 'oncall-security', (c) => (c.adminRoleChange ?? 0) > 0),
    r('kill_switch_change', 'Kill switch changed', 'critical', 'oncall-security', (c) => (c.killSwitchChange ?? 0) > 0),
    r('secret_read_failure', 'Secret read failure', 'critical', 'oncall-security', (c) => (c.secretReadFail ?? 0) > 0),
    r('backup_failure', 'Backup failed', 'critical', 'oncall-backend', (c) => (c.backupFail ?? 0) > 0),
  ];
}
