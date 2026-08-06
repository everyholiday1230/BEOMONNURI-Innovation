/**
 * Minimal metrics registry (Phase 6 §5): counters, gauges, histograms with p50/p95/p99. Prometheus-
 * style text exposition is provided so a scraper/OTel meter can be wired without changing call sites.
 */
export class Counter {
  private v = 0;
  constructor(readonly name: string, readonly help = '') {}
  inc(n = 1): void { this.v += n; }
  get value(): number { return this.v; }
}

export class Gauge {
  private v = 0;
  constructor(readonly name: string, readonly help = '') {}
  set(n: number): void { this.v = n; }
  inc(n = 1): void { this.v += n; }
  dec(n = 1): void { this.v -= n; }
  get value(): number { return this.v; }
}

export class Histogram {
  private samples: number[] = [];
  constructor(readonly name: string, readonly help = '', private readonly cap = 10_000) {}
  observe(v: number): void {
    this.samples.push(v);
    if (this.samples.length > this.cap) this.samples.shift();
  }
  get count(): number { return this.samples.length; }
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx]!;
  }
  snapshot(): { count: number; p50: number; p95: number; p99: number } {
    return { count: this.count, p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99) };
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  counter(name: string, help?: string): Counter {
    let c = this.counters.get(name);
    if (!c) { c = new Counter(name, help); this.counters.set(name, c); }
    return c;
  }
  gauge(name: string, help?: string): Gauge {
    let g = this.gauges.get(name);
    if (!g) { g = new Gauge(name, help); this.gauges.set(name, g); }
    return g;
  }
  histogram(name: string, help?: string): Histogram {
    let h = this.histograms.get(name);
    if (!h) { h = new Histogram(name, help); this.histograms.set(name, h); }
    return h;
  }

  /** Prometheus text exposition. */
  expose(): string {
    const lines: string[] = [];
    for (const c of this.counters.values()) lines.push(`# TYPE ${c.name} counter`, `${c.name} ${c.value}`);
    for (const g of this.gauges.values()) lines.push(`# TYPE ${g.name} gauge`, `${g.name} ${g.value}`);
    for (const h of this.histograms.values()) {
      const s = h.snapshot();
      lines.push(`# TYPE ${h.name} summary`,
        `${h.name}{quantile="0.5"} ${s.p50}`,
        `${h.name}{quantile="0.95"} ${s.p95}`,
        `${h.name}{quantile="0.99"} ${s.p99}`,
        `${h.name}_count ${s.count}`);
    }
    return lines.join('\n') + '\n';
  }
}
