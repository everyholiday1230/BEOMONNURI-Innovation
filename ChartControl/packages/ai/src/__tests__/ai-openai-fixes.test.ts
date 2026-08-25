import { describe, expect, it } from 'vitest';
import { normalizeResponsesEvent, type RawResponsesEvent } from '../streaming';
import { validateChartCommandArgs } from '../schemas';

/*
   Regression tests for the OpenAI copilot fixes:
   1) response.output_item.added seeds the function-call NAME (delta/done events don't carry it).
   2) chart-command args tolerate numeric prices, a `type`→`kind` alias, and extra keys.
*/

const opts = { model: 'gpt-5.4-mini', estimateCostMicros: () => 0, fallbackUsed: false };

describe('normalizeResponsesEvent — function-call name seeding', () => {
  it('emits a function_call.delta carrying the name from output_item.added', () => {
    const raw = {
      type: 'response.output_item.added',
      item: { id: 'fc_1', type: 'function_call', name: 'propose_chart_command', call_id: 'call_1' },
    } as unknown as RawResponsesEvent;
    const ev = normalizeResponsesEvent(raw, opts);
    expect(ev).toEqual({ type: 'function_call.delta', callId: 'fc_1', name: 'propose_chart_command', argsDelta: '' });
  });

  it('ignores non-function output items', () => {
    const raw = { type: 'response.output_item.added', item: { id: 'm_1', type: 'message' } } as unknown as RawResponsesEvent;
    expect(normalizeResponsesEvent(raw, opts)).toBeNull();
  });
});

describe('validateChartCommandArgs — LLM tolerance', () => {
  it('accepts a numeric price (coerced to string)', () => {
    const r = validateChartCommandArgs('createSupportResistance', { price: 65000, kind: 'support' });
    expect(r.ok).toBe(true);
  });

  it('accepts `type` as an alias for `kind` and strips extra keys', () => {
    const r = validateChartCommandArgs('createSupportResistance', { price: '64000', type: 'resistance', reason: 'swing high', timeframe: '15m' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.value as { kind: string }).kind).toBe('resistance');
      expect((r.value as Record<string, unknown>).reason).toBeUndefined();
    }
  });

  it('accepts numeric stop-loss price', () => {
    expect(validateChartCommandArgs('createStopLoss', { price: 63000 }).ok).toBe(true);
  });

  it('still rejects a missing required level', () => {
    expect(validateChartCommandArgs('createSupportResistance', { kind: 'support' }).ok).toBe(false);
  });
});
