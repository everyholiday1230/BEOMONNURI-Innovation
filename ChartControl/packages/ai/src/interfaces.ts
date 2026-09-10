import type { AiFollowUp } from './followups';
import type { z } from 'zod';

/**
 * Phase 4 AI provider-adapter interfaces (docs PHASE4-01). The application depends on these
 * abstractions, never on a concrete provider — so OpenAI can be swapped/extended and Mock/Fake
 * providers drive deterministic tests. LLM output is never trusted or executed directly.
 */

export type AiProviderKind = 'openai' | 'bedrock' | 'mock' | 'fake';

export interface AiModelConfig {
  primary: string;
  fallback: string;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  store: boolean; // default false — no provider-side retention of financial/account data
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/** A typed streaming event emitted by a provider (normalized from the OpenAI Responses API). */
export type AiStreamEvent =
  | { type: 'created'; responseId: string }
  | { type: 'output_text.delta'; delta: string }
  | { type: 'function_call.delta'; callId: string; name: string; argsDelta: string }
  | { type: 'function_call.done'; callId: string; name: string; args: string }
  | { type: 'completed'; responseId: string; usage: AiUsage }
  | { type: 'failed'; code: string; message: string }
  | { type: 'error'; message: string };

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** estimated cost in micro-USD (integer) to avoid float money. */
  estimatedCostMicros: number;
  model: string;
  fallbackUsed: boolean;
}

export interface AiRequest {
  conversationId: string;
  userId: string;
  model: string;
  instructions: string; // system prompt (from the registry)
  input: AiMessage[];
  tools?: AiToolDefinition[];
  maxOutputTokens: number;
  store: boolean;
  previousResponseId?: string;
  signal?: AbortSignal;
  correlationId: string;
}

export interface AiResponse {
  responseId: string;
  outputText: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  fallbackUsed: boolean;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (strict, additionalProperties:false). */
  parameters: Record<string, unknown>;
  strict: boolean;
}

export interface AiToolCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface AiToolResult {
  callId: string;
  name: string;
  ok: boolean;
  /** JSON-serializable result (read-only market/context data) or error info. */
  output: unknown;
}

/** 1) Non-streaming provider. */
export interface IAIProvider {
  readonly kind: AiProviderKind;
  createResponse(req: AiRequest): Promise<AiResponse>;
}

/** 2) Streaming provider (typed events). */
export interface IAIStreamingProvider {
  readonly kind: AiProviderKind;
  streamResponse(req: AiRequest): AsyncIterable<AiStreamEvent>;
}

/** 3) Orchestrator — runs the full validated pipeline (context → prompt → provider → tools → validate). */
export interface IAIOrchestrator {
  run(input: OrchestratorInput): AsyncIterable<OrchestratorEvent>;
}

export interface OrchestratorInput {
  conversationId: string;
  userId: string;
  userMessage: string;
  /**
   * 이전 대화 내용(오래된 것부터). 없으면 이 요청은 첫 대화로 취급된다.
   *
   * ★★★ **이것이 없어서 AI 가 매번 처음부터 시작했다.**
   *
   *   실제 대화(고객 sunnysinn1):
   *     11:25 "macd로 진입 매수매도 신호 좀 만들어줘"
   *     11:26 "웅 골든크로스데드크로스해줘"
   *     11:26 "macd켰어"
   *     11:27 "macd로 진입신호만들어달라고"
   *     11:28 "신호를 만들어달라고 신호못만들어? 차트에말이야."
   *     11:29 "내가승인하테니까 롱신호만들어줘.ㅡㅡ 몇번말해"
   *
   *   같은 요청을 여섯 번 반복했다. 모델은 **앞의 대화를 전혀 모른 채** 매번
   *   "MACD 가 화면에 없다" 를 처음 설명했다. 고객이 "몇번말해" 라고 한 것이 당연하다.
   *
   * ★ 길이를 서버가 자른다. 전부 넣으면 토큰이 폭증하고(비용은 고객 포인트다) 오래된
   *   맥락이 현재 판단을 흐린다.
   */
  history?: { role: 'user' | 'assistant'; content: string }[];
  symbol: string;
  timeframe: string;
  mode: 'copilot' | 'chart-analysis' | 'signal';
  language: 'ko' | 'en';
  signal?: AbortSignal;
  correlationId: string;
  /**
   * Server-built, grounded market snapshot (decimal strings, timestamps). Injected into the prompt as
   * UNTRUSTED MARKET_DATA. When present, price-bearing proposals are allowed; when absent, the model
   * must not emit a level (no fabrication). Built by `buildAiMarketContext` in the route.
   */
  marketData?: string;
  /** Identifier of the data snapshot the proposal is grounded in (provenance). */
  dataSnapshotId?: string;
  /** Contract type for provenance on proposed commands. Defaults to 'perpetual'. */
  marketType?: 'futures' | 'perpetual';
  /**
   * 후속 제안을 고르는 데 쓰는 화면 상태.
   *
   * ★ UNTRUSTED — 브라우저가 보낸 값이다. 제안 문구를 고르는 데만 쓰고 권한 판단에는
   *   절대 쓰지 않는다. 틀려도 최악의 결과가 "덜 알맞은 제안" 이어야 한다.
   */
  followUp?: {
    indicators?: string[];
    drawingTypes?: string[];
    positionCount?: number | null;
    openOrderCount?: number | null;
    hasTradeHistory?: boolean | null;
  };
}

export type OrchestratorEvent =
  | { type: 'state'; state: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; ok: boolean }
  | { type: 'command'; command: unknown } // validated AiChartCommand
  | { type: 'signal'; signal: unknown } // validated AiSignalObject
  | { type: 'usage'; usage: AiUsage }
  /**
   * 답변이 끝난 뒤 제시할 후속 질문들. 서버가 규칙으로 고른다(모델이 만들지 않는다 —
   * 없는 기능이나 투자권유를 제안할 수 있다). 토큰을 쓰지 않는다.
   */
  | { type: 'suggestions'; items: AiFollowUp[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

/** 4) Tool registry — read-only tools only; strict schemas; execution is server-side + validated. */
export interface IAIToolRegistry {
  list(): AiToolDefinition[];
  has(name: string): boolean;
  execute(name: string, argsJson: string, ctx: ToolExecContext): Promise<AiToolResult>;
}

export interface ToolExecContext {
  userId: string;
  symbol: string;
  timeframe: string;
  correlationId: string;
}

/** 5) Prompt registry — versioned, checksummed, no scattered string literals. */
export interface IAIPromptRegistry {
  get(id: string, opts?: { language?: 'ko' | 'en'; mode?: string }): PromptRecord;
  active(id: string): PromptRecord;
  all(): PromptRecord[];
}

export interface PromptRecord {
  promptId: string;
  version: string;
  language: 'ko' | 'en' | 'any';
  mode: string;
  createdAt: number;
  checksum: string;
  active: boolean;
  testDatasetVersion: string;
  template: string;
}

/** 6) Conversation repository — user-isolated persistence; NO raw chain-of-thought. */
export interface IAIConversationRepository {
  createConversation(userId: string, title: string): Promise<{ id: string }>;
  getOwned(userId: string, conversationId: string): Promise<{ id: string; userId: string } | null>;
  appendMessage(userId: string, conversationId: string, msg: { role: string; content: string; redactedReasoningSummary?: string }): Promise<{ id: string }>;
  listMessages(userId: string, conversationId: string): Promise<Array<{ role: string; content: string }>>;
  softDelete(userId: string, conversationId: string): Promise<boolean>;
  /** 사용자 본인의 대화 목록(최근순). 기기가 바뀌어도 서버에서 이어받게 한다. */
  listConversations?(userId: string, limit?: number): Promise<Array<{ id: string; title: string; updatedAt: number }>>;
  /** 오래된 대화를 정리한다(성능). 최근 keep 개만 남기고 나머지는 소프트 삭제. 삭제 개수를 돌려준다. */
  pruneOldConversations?(userId: string, keep: number): Promise<number>;
}

/** 7) Usage repository — token/cost accounting per user. */
export interface IAIUsageRepository {
  record(userId: string, usage: AiUsage & { conversationId: string; correlationId: string }): Promise<void>;
  dailyTokens(userId: string): Promise<number>;
  dailyCostMicros(userId: string): Promise<number>;
}

/** 8) Evaluation service — dataset-driven quality metrics (no vibes). */
export interface IAIEvaluationService {
  run(datasetVersion: string): Promise<EvaluationReport>;
}

export interface EvaluationReport {
  datasetVersion: string;
  total: number;
  schemaValidityRate: number;
  toolCallSuccessRate: number;
  hallucinationRate: number;
  unsafeActionRate: number;
  signalDirectionValidity: number;
  staleDataRejectionRate: number;
  refusalCorrectness: number;
  noAutoTradeCompliance: number;
  cases: Array<{ id: string; pass: boolean; note: string }>;
}

/** 9) Safety policy — enforced on every request/response. */
export interface IAISafetyPolicy {
  screenUserInput(text: string): SafetyVerdict;
  screenToolOutput(text: string): SafetyVerdict;
  screenModelOutput(text: string, ctx: { hasMarketToolResult: boolean; marketDataStale: boolean }): SafetyVerdict;
}

export interface SafetyVerdict {
  allowed: boolean;
  violations: string[]; // e.g. 'prompt-injection', 'profit-guarantee', 'unsourced-price', 'auto-trade'
  sanitizedText?: string;
}

/** 10) Cost controller — rate/token/cost/budget limits + circuit breaker + fallback decision. */
export interface IAICostController {
  checkAllowed(userId: string): Promise<CostDecision>;
  estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number;
  onProviderFailure(): void;
  onProviderSuccess(): void;
  breakerOpen(): boolean;
}

export interface CostDecision {
  allowed: boolean;
  reason?: 'rate-limited' | 'daily-token-exceeded' | 'daily-cost-exceeded' | 'concurrency-exceeded' | 'system-budget-exceeded';
  retryAfterMs?: number;
}

export type ZodSchema = z.ZodTypeAny;
