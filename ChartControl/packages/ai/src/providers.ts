import type { AiRequest, AiResponse, AiStreamEvent, AiToolCall, AiUsage, IAIProvider, IAIStreamingProvider } from './interfaces';
import { normalizeResponsesEvent, ToolCallAccumulator, type RawResponsesEvent } from './streaming';

/**
 * Providers (docs PHASE4-02). All implement the same interfaces so the orchestrator is
 * provider-agnostic. Fake = deterministic scripted events for unit tests. MockReplay = deterministic
 * canned analysis for dev/e2e. OpenAIResponses = real Responses API via an injected transport
 * (keeps this package free of the OpenAI SDK; apps/api wires the real transport).
 */

function collect(events: AiStreamEvent[]): AiResponse {
  let text = '';
  const toolCalls: AiToolCall[] = [];
  let responseId = '';
  let usage: AiUsage = { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, model: '', fallbackUsed: false };
  for (const e of events) {
    if (e.type === 'output_text.delta') text += e.delta;
    else if (e.type === 'function_call.done') toolCalls.push({ callId: e.callId, name: e.name, argumentsJson: e.args });
    else if (e.type === 'created') responseId = e.responseId;
    else if (e.type === 'completed') { usage = e.usage; responseId = e.responseId || responseId; }
  }
  return { responseId, outputText: text, toolCalls, usage, fallbackUsed: usage.fallbackUsed };
}

// ---- Fake provider (tests) ----
export class FakeProvider implements IAIProvider, IAIStreamingProvider {
  readonly kind = 'fake' as const;
  constructor(private readonly script: (req: AiRequest) => AiStreamEvent[]) {}
  async *streamResponse(req: AiRequest): AsyncIterable<AiStreamEvent> {
    for (const e of this.script(req)) {
      if (req.signal?.aborted) return;
      yield e;
    }
  }
  async createResponse(req: AiRequest): Promise<AiResponse> {
    const events: AiStreamEvent[] = [];
    for await (const e of this.streamResponse(req)) events.push(e);
    return collect(events);
  }
}

// ---- Mock replay provider (deterministic dev/e2e) ----
export class MockReplayProvider implements IAIProvider, IAIStreamingProvider {
  readonly kind = 'mock' as const;
  constructor(private readonly model = 'mock-analyst-v1') {}
  async *streamResponse(req: AiRequest): AsyncIterable<AiStreamEvent> {
    yield { type: 'created', responseId: `mock-${req.correlationId}` };
    const chunks = [
      'Analysis (mock): using read-only market tools. ',
      'This is analysis assistance, not investment advice, and no profit is guaranteed. ',
      'Data timestamps and uncertainty are shown; no order is submitted.',
    ];
    for (const c of chunks) {
      if (req.signal?.aborted) return;
      yield { type: 'output_text.delta', delta: c };
    }
    const usage: AiUsage = { inputTokens: 200, outputTokens: 60, estimatedCostMicros: 0, model: this.model, fallbackUsed: false };
    yield { type: 'completed', responseId: `mock-${req.correlationId}`, usage };
  }
  async createResponse(req: AiRequest): Promise<AiResponse> {
    const events: AiStreamEvent[] = [];
    for await (const e of this.streamResponse(req)) events.push(e);
    return collect(events);
  }
}

// ---- OpenAI Responses provider (real; transport-injected) ----
export interface OpenAiResponsesTransport {
  /** Perform the Responses API streaming call and yield RAW provider events. */
  streamRaw(payload: OpenAiResponsesPayload, signal?: AbortSignal): AsyncIterable<RawResponsesEvent>;
}

export interface OpenAiResponsesPayload {
  model: string;
  instructions: string;
  input: { role: string; content: string }[];
  tools?: { type: 'function'; name: string; description: string; parameters: Record<string, unknown>; strict: boolean }[];
  max_output_tokens: number;
  store: boolean;
  previous_response_id?: string;
}

export interface OpenAIProviderConfig {
  model: string;
  estimateCostMicros: (model: string, input: number, output: number) => number;
  fallbackUsed?: boolean;
}

export class OpenAIResponsesProvider implements IAIProvider, IAIStreamingProvider {
  readonly kind = 'openai' as const;
  constructor(private readonly transport: OpenAiResponsesTransport, private readonly cfg: OpenAIProviderConfig) {}

  private payload(req: AiRequest): OpenAiResponsesPayload {
    return {
      model: req.model,
      instructions: req.instructions,
      input: req.input.map((m) => ({ role: m.role, content: m.content })),
      tools: req.tools?.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: t.strict })),
      max_output_tokens: req.maxOutputTokens,
      store: req.store, // default false
      previous_response_id: req.previousResponseId,
    };
  }

  async *streamResponse(req: AiRequest): AsyncIterable<AiStreamEvent> {
    const acc = new ToolCallAccumulator();
    const opts = { model: req.model, estimateCostMicros: this.cfg.estimateCostMicros, fallbackUsed: this.cfg.fallbackUsed ?? false };
    for await (const raw of this.transport.streamRaw(this.payload(req), req.signal)) {
      if (req.signal?.aborted) return;
      const ev = normalizeResponsesEvent(raw, opts);
      if (!ev) continue;
      if (ev.type === 'function_call.delta') {
        acc.onDelta(ev.callId, ev.name, ev.argsDelta);
        continue;
      }
      if (ev.type === 'function_call.done') {
        const done = acc.onDone(ev.callId, ev.name, ev.args);
        if (!done) continue; // dedup
        yield { type: 'function_call.done', callId: ev.callId, name: done.name, args: done.args };
        continue;
      }
      yield ev;
    }
  }

  async createResponse(req: AiRequest): Promise<AiResponse> {
    const events: AiStreamEvent[] = [];
    for await (const e of this.streamResponse(req)) events.push(e);
    return collect(events);
  }
}
