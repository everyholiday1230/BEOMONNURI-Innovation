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
}

export type OrchestratorEvent =
  | { type: 'state'; state: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; ok: boolean }
  | { type: 'command'; command: unknown } // validated AiChartCommand
  | { type: 'signal'; signal: unknown } // validated AiSignalObject
  | { type: 'usage'; usage: AiUsage }
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
