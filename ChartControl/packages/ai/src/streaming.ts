import type { AiStreamEvent, AiUsage } from './interfaces';

/**
 * Normalizes OpenAI Responses API streaming events (docs PHASE4-04) into our typed AiStreamEvent
 * union. Handles: response.created, response.output_text.delta, response.function_call_arguments
 * .delta/.done, response.completed, response.failed, error. Unknown events are ignored (forward-safe).
 */
export interface RawResponsesEvent {
  type: string;
  response?: { id?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { code?: string; message?: string } };
  delta?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  code?: string;
  message?: string;
}

export interface StreamNormalizeOptions {
  model: string;
  estimateCostMicros: (model: string, input: number, output: number) => number;
  fallbackUsed: boolean;
}

export function normalizeResponsesEvent(raw: RawResponsesEvent, opts: StreamNormalizeOptions): AiStreamEvent | null {
  switch (raw.type) {
    case 'response.created':
      return { type: 'created', responseId: raw.response?.id ?? '' };
    case 'response.output_text.delta':
      return { type: 'output_text.delta', delta: raw.delta ?? '' };
    case 'response.function_call_arguments.delta':
      return { type: 'function_call.delta', callId: raw.call_id ?? raw.item_id ?? '', name: raw.name ?? '', argsDelta: raw.delta ?? '' };
    case 'response.function_call_arguments.done':
      return { type: 'function_call.done', callId: raw.call_id ?? raw.item_id ?? '', name: raw.name ?? '', args: raw.arguments ?? '' };
    case 'response.completed': {
      const input = raw.response?.usage?.input_tokens ?? 0;
      const output = raw.response?.usage?.output_tokens ?? 0;
      const usage: AiUsage = { inputTokens: input, outputTokens: output, estimatedCostMicros: opts.estimateCostMicros(opts.model, input, output), model: opts.model, fallbackUsed: opts.fallbackUsed };
      return { type: 'completed', responseId: raw.response?.id ?? '', usage };
    }
    case 'response.failed':
      return { type: 'failed', code: raw.response?.error?.code ?? 'failed', message: raw.response?.error?.message ?? 'response failed' };
    case 'error':
      return { type: 'error', message: raw.message ?? 'stream error' };
    default:
      return null; // unknown/other event → ignored
  }
}

/**
 * Accumulates streamed function-call argument deltas by callId so a complete, parseable JSON string
 * is available at `function_call.done`. Also dedups repeated done events per callId.
 */
export class ToolCallAccumulator {
  private buffers = new Map<string, { name: string; args: string }>();
  private done = new Set<string>();

  onDelta(callId: string, name: string, argsDelta: string): void {
    const cur = this.buffers.get(callId) ?? { name, args: '' };
    cur.args += argsDelta;
    if (name) cur.name = name;
    this.buffers.set(callId, cur);
  }

  /** Returns the finalized {name,args} once per callId; null if duplicate. */
  onDone(callId: string, name: string, args: string): { name: string; args: string } | null {
    if (this.done.has(callId)) return null; // dedup
    this.done.add(callId);
    const buffered = this.buffers.get(callId);
    const finalArgs = args && args.length > 0 ? args : (buffered?.args ?? '');
    return { name: name || buffered?.name || '', args: finalArgs };
  }
}

/** Parse an SSE line stream ("data: {json}\n\n") into RawResponsesEvent objects. */
export function parseSseChunk(buffer: string): { events: RawResponsesEvent[]; rest: string } {
  const events: RawResponsesEvent[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        events.push(JSON.parse(payload) as RawResponsesEvent);
      } catch {
        // malformed SSE line → skip (caller may surface an error event)
      }
    }
  }
  return { events, rest };
}
