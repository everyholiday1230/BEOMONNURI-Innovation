import {
  ChartCommandSchema,
  SignalObjectSchema,
  ALLOWED_CHART_COMMANDS,
  validate,
  type ChartCommand,
  type SignalObject,
} from '@quantumtrade/schemas';
import { riskReward } from '@quantumtrade/domain';

export interface AnalyzeRequest {
  symbol: string;
  timeframe: SignalObject['timeframe'];
  marketType?: SignalObject['marketType'];
  prompt: string;
  dataAsOf: number;
  /**
   * Reference price. MUST be a real, positive price obtained server-side (see ai/market-context.ts).
   * There is deliberately no default: an analysis without a price is refused, not guessed.
   */
  lastPrice: number;
  /** Provenance of the context the analysis is based on, when the caller assembled one. */
  context?: {
    source: string;
    asOf: number;
    stale: boolean;
    tradingMode: string;
    liveTradingEnabled: boolean;
    killSwitchActive: boolean;
  };
}

export type AnalyzeEvent =
  | { type: 'token'; text: string }
  | { type: 'command'; command: ChartCommand }
  | { type: 'signal'; signal: SignalObject }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface AIProvider {
  readonly name: string;
  analyze(req: AnalyzeRequest, signal: AbortSignal): AsyncGenerator<AnalyzeEvent>;
}

/**
 * MockAIProvider — deterministic, provider-swappable (an OpenAI-compatible adapter implements the
 * same AIProvider interface). It emits ONLY allowlisted, Zod-validated ChartCommands and a
 * validated SignalObject. It can NEVER emit an order submission (ADR-0004). Every emitted command
 * passes a permission check before leaving the provider.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock-analyst-v1';

  async *analyze(req: AnalyzeRequest, abort: AbortSignal): AsyncGenerator<AnalyzeEvent> {
    // Fail closed. The previous `req.lastPrice || 68000` turned a missing price into a confident
    // analysis of a fictional Bitcoin level — the single most misleading thing this provider could do.
    if (!Number.isFinite(req.lastPrice) || req.lastPrice <= 0) {
      yield { type: 'error', message: 'no reference price: refusing to analyse without a real price' };
      return;
    }
    const p = req.lastPrice;
    const entryLo = round(p * 0.999);
    const entryHi = round(p * 1.002);
    const stop = round(p * 0.99);
    const tp1 = round(p * 1.012);
    const tp2 = round(p * 1.025);

    const narrative = [
      `${req.symbol} ${req.timeframe} 분석을 시작합니다. `,
      `최근 추세와 지지/저항을 확인합니다. `,
      `${entryLo}–${entryHi} 구간에서 롱 진입을 고려할 수 있습니다. `,
      `무효화 조건은 ${stop} 이탈입니다.`,
    ];
    for (const chunk of narrative) {
      if (abort.aborted) {
        yield { type: 'error', message: 'aborted' };
        return;
      }
      yield { type: 'token', text: chunk };
    }

    // Structured, allowlisted chart commands — each validated + permission-checked.
    const commands: unknown[] = [
      { command: 'createEntryZone', priceLo: String(entryLo), priceHi: String(entryHi), label: 'AI Entry' },
      { command: 'createStopLoss', price: String(stop) },
      { command: 'createTakeProfit', price: String(tp1), index: 0 },
      { command: 'createTakeProfit', price: String(tp2), index: 1 },
    ];
    for (const raw of commands) {
      const checked = this.permitAndValidate(raw);
      if (checked) yield { type: 'command', command: checked };
    }

    const rr = riskReward('long', String(entryHi), String(stop), String(tp1));
    const signalCandidate = {
      id: `sig-${req.symbol}-${req.dataAsOf}`,
      symbol: req.symbol,
      marketType: req.marketType ?? 'futures',
      timeframe: req.timeframe,
      direction: 'long' as const,
      generatedAt: Date.now(),
      dataAsOf: req.dataAsOf,
      analysis: narrative.join(''),
      evidence: ['지지 재확인', '오더북 매수벽', 'RSI 다이버전스 부재'],
      confidence: 68,
      invalidationCondition: `${req.timeframe} 종가 기준 ${stop} 이탈`,
      entryZone: [String(entryLo), String(entryHi)],
      stopLoss: String(stop),
      takeProfits: [String(tp1), String(tp2)],
      riskReward: rr,
      timeHorizon: '4~12h',
      assumptions: ['변동성 정상 범위', '주요 뉴스 이벤트 없음'],
      warnings: ['시뮬레이션 데이터', 'AI 생성 신호 — 반드시 사용자 검토 필요'],
      aiGenerated: true,
      status: 'PROPOSED',
    };
    const v = validate(SignalObjectSchema, signalCandidate);
    if (v.ok) yield { type: 'signal', signal: v.data };
    else yield { type: 'error', message: `signal validation failed: ${v.error}` };

    yield { type: 'done' };
  }

  /** Permission check + schema validation. Rejects anything not on the command allowlist. */
  private permitAndValidate(raw: unknown): ChartCommand | null {
    const cmd = (raw as { command?: string }).command;
    if (!cmd || !(ALLOWED_CHART_COMMANDS as readonly string[]).includes(cmd)) return null;
    // An AI provider must never produce an order submission; createOrderDraft is a draft only.
    const v = validate(ChartCommandSchema, raw);
    return v.ok ? v.data : null;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
