import { describe, it, expect } from 'vitest';
import {
  StructuredLogger, hashUserId, redactFields, sanitizeLogText,
  InMemoryTracer, NoopTracer,
  MetricsRegistry,
  AlertManager, MockNotifier, defaultAlertRules,
} from '../index';

const BASE = { service: 'api', environment: 'test', version: '0.6.0-rc', gitSha: 'abc1234' };

describe('structured logger', () => {
  it('emits all required common fields', () => {
    const rec: Record<string, unknown>[] = [];
    const log = new StructuredLogger(BASE, (r) => rec.push(r), () => 1_700_000_000_000);
    log.info('hello', { correlationId: 'c1', traceId: 't1', spanId: 's1', route: '/api/x', durationMs: 12, status: 200 });
    const r = rec[0]!;
    for (const k of ['timestamp', 'service', 'environment', 'version', 'gitSha', 'correlationId', 'traceId', 'spanId', 'route', 'durationMs', 'status', 'level', 'message']) {
      expect(r[k]).toBeDefined();
    }
    expect(r.service).toBe('api');
    expect(r.gitSha).toBe('abc1234');
  });

  it('hashes userId (never raw) and redacts secrets', () => {
    const rec: Record<string, unknown>[] = [];
    const log = new StructuredLogger(BASE, (r) => rec.push(r));
    log.info('login', { userId: 'user-123', password: 'hunter2', apiKey: 'AK', nested: { token: 'zzz' } });
    const r = rec[0]!;
    expect(r.userIdHash).toBe(hashUserId('user-123'));
    expect(r.userId).toBeUndefined();
    expect(r.password).toBe('[REDACTED]');
    expect(r.apiKey).toBe('[REDACTED]');
    expect((r.nested as Record<string, unknown>).token).toBe('[REDACTED]');
  });

  it('sanitizes log-injection newlines', () => {
    expect(sanitizeLogText('a\nb\r\nc')).not.toMatch(/[\r\n]/);
  });

  it('child logger pins fields', () => {
    const rec: Record<string, unknown>[] = [];
    const log = new StructuredLogger(BASE, (r) => rec.push(r)).child({ correlationId: 'pinned' });
    log.warn('x');
    expect(rec[0]!.correlationId).toBe('pinned');
  });

  it('redactFields truncates very long strings', () => {
    const out = redactFields({ big: 'x'.repeat(1000) });
    expect((out.big as string).length).toBeLessThanOrEqual(513);
  });
});

describe('tracing adapter', () => {
  it('InMemoryTracer records spans with parent + duration + status', () => {
    let t = 0;
    const tracer = new InMemoryTracer(() => (t += 5));
    const parent = tracer.startSpan('req', { attributes: { route: '/x' } });
    const child = tracer.startSpan('db', { parent });
    child.setAttribute('table', 'users');
    child.setStatus('ok');
    child.end();
    parent.end();
    expect(tracer.finished).toHaveLength(2);
    const dbSpan = tracer.finished.find((s) => s.name === 'db')!;
    expect(dbSpan.parentSpanId).toBe(parent.spanId);
    expect(dbSpan.traceId).toBe(parent.traceId);
    expect(dbSpan.durationMs).toBeGreaterThan(0);
    expect(dbSpan.attributes.table).toBe('users');
  });
  it('NoopTracer is inert but returns valid ids', () => {
    const s = new NoopTracer().startSpan('x');
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(() => s.end()).not.toThrow();
  });
});

describe('metrics registry', () => {
  it('counts, gauges, and computes histogram percentiles', () => {
    const reg = new MetricsRegistry();
    reg.counter('http_requests').inc();
    reg.counter('http_requests').inc(2);
    reg.gauge('active_ws').set(5);
    const h = reg.histogram('latency');
    for (let i = 1; i <= 100; i++) h.observe(i);
    expect(reg.counter('http_requests').value).toBe(3);
    expect(reg.gauge('active_ws').value).toBe(5);
    const s = h.snapshot();
    expect(s.p50).toBeGreaterThanOrEqual(50);
    expect(s.p95).toBeGreaterThanOrEqual(95);
    expect(s.p99).toBeGreaterThanOrEqual(99);
    expect(reg.expose()).toContain('http_requests 3');
  });
});

describe('alert manager', () => {
  it('fires, dedups, silences, and recovers', () => {
    let now = 0;
    const notifier = new MockNotifier();
    const mgr = new AlertManager(defaultAlertRules(), notifier, { dedupWindowMs: 60_000, now: () => now });

    // fire critical redis_down
    mgr.evaluate({ redisUp: 0 });
    expect(notifier.sent.filter((n) => n.ruleId === 'redis_down' && n.state === 'firing')).toHaveLength(1);

    // dedup within window
    now = 30_000;
    mgr.evaluate({ redisUp: 0 });
    expect(notifier.sent.filter((n) => n.ruleId === 'redis_down' && n.state === 'firing')).toHaveLength(1);

    // recovery
    now = 120_000;
    mgr.evaluate({ redisUp: 1 });
    expect(notifier.sent.some((n) => n.ruleId === 'redis_down' && n.state === 'recovered')).toBe(true);

    // silence suppresses firing
    mgr.silence('kill_switch_change', 1_000_000);
    now = 200_000;
    mgr.evaluate({ killSwitchChange: 1 });
    expect(notifier.sent.some((n) => n.ruleId === 'kill_switch_change')).toBe(false);
  });

  it('has rules for the required Phase 6 conditions', () => {
    const ids = defaultAlertRules().map((r) => r.id);
    for (const id of ['api_error_rate', 'db_pool_exhausted', 'redis_down', 'submit_unknown', 'kill_switch_change', 'mfa_attack', 'backup_failure']) {
      expect(ids).toContain(id);
    }
    // every rule has an owner + runbook
    for (const r of defaultAlertRules()) { expect(r.owner).toBeTruthy(); expect(r.runbook).toContain('PHASE6-06'); }
  });
});
