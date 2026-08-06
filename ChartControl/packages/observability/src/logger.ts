import { createHash } from 'node:crypto';

/**
 * Structured logging (Phase 6 §5). Every record carries the required common fields; sensitive values
 * are redacted before emission. The sink is injectable (default stdout JSON) so a collector/OTel
 * exporter can be wired without changing call sites.
 */
export interface LogBaseContext {
  service: string;
  environment: string;
  version: string;
  gitSha: string;
}

export interface LogFields {
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string; // hashed before emission (never raw)
  route?: string;
  durationMs?: number;
  status?: number;
  errorCode?: string;
  [k: string]: unknown;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (record: Record<string, unknown>) => void;

const SENSITIVE = /(password|passwordHash|secret|secretKey|memo|token|csrf|authorization|apiKey|api_key|openai|kms|dataKey|sessionToken|wrappedDek|cookie|set-cookie|bearer)/i;

/** Deterministic non-reversible user id hash for correlation without exposing identity. */
export function hashUserId(userId: string, salt = 'qt'): string {
  return createHash('sha256').update(`${salt}:${userId}`).digest('hex').slice(0, 16);
}

export function redactFields(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE.test(k)) { out[k] = '[REDACTED]'; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 6) {
      out[k] = redactFields(v as Record<string, unknown>, depth + 1);
    } else if (typeof v === 'string' && v.length > 512) {
      out[k] = v.slice(0, 512) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Neutralize CRLF / control chars in free-text to prevent log injection. */
export function sanitizeLogText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\r\n\t\u0000-\u001f]/g, ' ').slice(0, 2000);
}

export class StructuredLogger {
  constructor(
    private readonly base: LogBaseContext,
    private readonly sink: LogSink = (r) => process.stdout.write(JSON.stringify(r) + '\n'),
    private readonly now: () => number = Date.now,
    private readonly pinned: LogFields = {},
  ) {}

  private emit(level: LogLevel, message: string, fields: LogFields = {}): Record<string, unknown> {
    const { userId, ...rest } = { ...this.pinned, ...fields };
    const record: Record<string, unknown> = {
      timestamp: new Date(this.now()).toISOString(),
      level,
      message: sanitizeLogText(message),
      service: this.base.service,
      environment: this.base.environment,
      version: this.base.version,
      gitSha: this.base.gitSha,
      ...(userId !== undefined ? { userIdHash: hashUserId(String(userId)) } : {}),
      ...redactFields(rest),
    };
    this.sink(record);
    return record;
  }

  debug(m: string, f?: LogFields) { return this.emit('debug', m, f); }
  info(m: string, f?: LogFields) { return this.emit('info', m, f); }
  warn(m: string, f?: LogFields) { return this.emit('warn', m, f); }
  error(m: string, f?: LogFields) { return this.emit('error', m, f); }

  /** Child logger with pinned fields (e.g. correlationId/traceId per request). */
  child(pinned: LogFields): StructuredLogger {
    return new StructuredLogger(this.base, this.sink, this.now, { ...this.pinned, ...pinned });
  }
}
