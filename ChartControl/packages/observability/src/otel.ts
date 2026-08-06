import { randomBytes } from 'node:crypto';

/**
 * Tracing adapter (Phase 6 §5). Provider-agnostic interface so OpenTelemetry (or any exporter) is
 * wired behind an adapter. Ships a Noop tracer (prod default until a collector is configured) and an
 * InMemory tracer for tests. W3C-style 16-byte trace / 8-byte span ids.
 */
export interface SpanHandle {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: 'ok' | 'error', message?: string): void;
  end(endMs?: number): void;
}

export interface Tracer {
  startSpan(name: string, opts?: { parent?: SpanHandle; attributes?: Record<string, string | number | boolean> }): SpanHandle;
}

export function newTraceId(): string { return randomBytes(16).toString('hex'); }
export function newSpanId(): string { return randomBytes(8).toString('hex'); }

export class NoopTracer implements Tracer {
  startSpan(name: string, opts?: { parent?: SpanHandle }): SpanHandle {
    return {
      traceId: opts?.parent?.traceId ?? newTraceId(),
      spanId: newSpanId(),
      ...(opts?.parent ? { parentSpanId: opts.parent.spanId } : {}),
      name,
      startMs: 0,
      setAttribute() {},
      setStatus() {},
      end() {},
    };
  }
}

export interface FinishedSpan {
  traceId: string; spanId: string; parentSpanId?: string; name: string;
  startMs: number; endMs: number; durationMs: number;
  attributes: Record<string, string | number | boolean>; status: 'ok' | 'error'; statusMessage?: string;
}

/** In-memory tracer for assertions/tests and an offline export target. */
export class InMemoryTracer implements Tracer {
  readonly finished: FinishedSpan[] = [];
  constructor(private readonly now: () => number = Date.now) {}
  startSpan(name: string, opts?: { parent?: SpanHandle; attributes?: Record<string, string | number | boolean> }): SpanHandle {
    const attributes: Record<string, string | number | boolean> = { ...(opts?.attributes ?? {}) };
    const span: SpanHandle = {
      traceId: opts?.parent?.traceId ?? newTraceId(),
      spanId: newSpanId(),
      ...(opts?.parent ? { parentSpanId: opts.parent.spanId } : {}),
      name,
      startMs: this.now(),
      setAttribute(k, v) { attributes[k] = v; },
      setStatus(status, message) { (span as unknown as { _status: string })._status = status; if (message) (span as unknown as { _msg?: string })._msg = message; },
      end: (endMs?: number) => {
        const e = endMs ?? this.now();
        this.finished.push({
          traceId: span.traceId, spanId: span.spanId, ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
          name: span.name, startMs: span.startMs, endMs: e, durationMs: e - span.startMs,
          attributes, status: ((span as unknown as { _status?: 'ok' | 'error' })._status) ?? 'ok',
          ...((span as unknown as { _msg?: string })._msg ? { statusMessage: (span as unknown as { _msg?: string })._msg } : {}),
        });
      },
    };
    return span;
  }
}
