import { describe, it, expect } from 'vitest';
import { SimOrderEngine } from '../sim/order-engine';
import { MockAIProvider } from '../ai/mock-ai-provider';
import type { SymbolInfo } from '@quantumtrade/schemas';

const BTC: SymbolInfo = {
  id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual',
  pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001', minQty: '0.001', maxLeverage: 125,
};

const validDraft = {
  symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68200.0',
  quantity: '0.5', leverage: 20, clientOrderId: 'cid-1', aiGenerated: true,
};

describe('SimOrderEngine confirmation gate + idempotency', () => {
  it('creates a draft with a Decimal-computed preview', () => {
    const eng = new SimOrderEngine();
    const r = eng.createDraft(validDraft, BTC);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preview.positionValue).toBe('34100');
      expect(r.preview.isSimulated).toBe(true);
    }
  });

  it('rejects a draft violating symbol precision', () => {
    const eng = new SimOrderEngine();
    const r = eng.createDraft({ ...validDraft, price: '68200.07' }, BTC);
    expect(r.ok).toBe(false);
  });

  it('REFUSES submit without explicit confirmation (AI cannot bypass the gate)', () => {
    const eng = new SimOrderEngine();
    const d = eng.createDraft(validDraft, BTC);
    if (!d.ok) throw new Error('draft failed');
    const token = eng.getConfirmationToken(d.draftId)!;
    // userConfirmed=false -> forbidden
    const bad = eng.confirmAndSubmit({ draftId: d.draftId, clientOrderId: 'cid-1', confirmationToken: token, userConfirmed: false });
    expect(bad.ok).toBe(false);
    // wrong token -> forbidden
    const bad2 = eng.confirmAndSubmit({ draftId: d.draftId, clientOrderId: 'cid-1', confirmationToken: 'wrong', userConfirmed: true });
    expect(bad2.ok).toBe(false);
  });

  it('submits (simulated) only with correct token + explicit confirmation', () => {
    const eng = new SimOrderEngine();
    const d = eng.createDraft(validDraft, BTC);
    if (!d.ok) throw new Error('draft failed');
    const token = eng.getConfirmationToken(d.draftId)!;
    const ok = eng.confirmAndSubmit({ draftId: d.draftId, clientOrderId: 'cid-1', confirmationToken: token, userConfirmed: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.order.status).toBe('FILLED');
      expect(ok.order.isSimulated).toBe(true);
    }
  });

  it('is idempotent by clientOrderId (no double submit)', () => {
    const eng = new SimOrderEngine();
    const d = eng.createDraft(validDraft, BTC);
    if (!d.ok) throw new Error('draft failed');
    const token = eng.getConfirmationToken(d.draftId)!;
    const a = eng.confirmAndSubmit({ draftId: d.draftId, clientOrderId: 'cid-1', confirmationToken: token, userConfirmed: true });
    const b = eng.confirmAndSubmit({ draftId: d.draftId, clientOrderId: 'cid-1', confirmationToken: token, userConfirmed: true });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.order.id).toBe(b.order.id);
    expect(eng.listOrders()).toHaveLength(1);
  });
});

describe('MockAIProvider structured output', () => {
  it('emits only allowlisted validated commands + a validated signal, and never an order submission', async () => {
    const ai = new MockAIProvider();
    const abort = new AbortController();
    const events = [];
    for await (const ev of ai.analyze(
      { symbol: 'BTCUSDT', timeframe: '15m', prompt: 'analyze', dataAsOf: Date.now(), lastPrice: 68000 },
      abort.signal,
    )) {
      events.push(ev);
    }
    const commands = events.filter((e) => e.type === 'command');
    expect(commands.length).toBeGreaterThan(0);
    const allowed = ['createEntryZone', 'createStopLoss', 'createTakeProfit'];
    for (const c of commands) {
      if (c.type === 'command') expect(allowed).toContain(c.command.command);
    }
    // No command may be an order submission; createOrderDraft (if present) is a draft only.
    for (const c of commands) {
      if (c.type === 'command') expect(c.command.command).not.toBe('submitOrder');
    }
    expect(events.some((e) => e.type === 'signal')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('stops and yields error when aborted', async () => {
    const ai = new MockAIProvider();
    const abort = new AbortController();
    abort.abort();
    const events = [];
    for await (const ev of ai.analyze(
      { symbol: 'BTCUSDT', timeframe: '15m', prompt: 'x', dataAsOf: Date.now(), lastPrice: 68000 },
      abort.signal,
    )) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});
