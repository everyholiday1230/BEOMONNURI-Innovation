import { describe, it, expect } from 'vitest';
import { evaluateRiskGates } from '../risk-gates';
import type { SymbolInfo } from '@quantumtrade/schemas';

const SYM: SymbolInfo = {
  id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual',
  pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001',
  minQty: '0.001', maxLeverage: 125,
};

const base = {
  symbol: SYM, side: 'long' as const, orderType: 'limit' as const,
  price: '68000.0', quantity: '0.100', leverage: 20,
  stopLoss: '67000.0', takeProfit: '70000.0', riskReward: '2', maxEstLoss: '100.4',
  marketDataStatus: 'LIVE',
};

describe('risk gates', () => {
  it('passes a clean long setup (all ok/warn, no fail)', () => {
    const r = evaluateRiskGates(base);
    expect(r.pass).toBe(true);
    expect(r.failCount).toBe(0);
    expect(r.gates).toHaveLength(9);
  });

  it('FAILS when stop loss is on the wrong side (long SL above entry)', () => {
    const r = evaluateRiskGates({ ...base, stopLoss: '69000.0' });
    expect(r.pass).toBe(false);
    expect(r.gates.find((g) => g.id === 'slDir')!.status).toBe('fail');
  });

  it('FAILS when take profit is on the wrong side (long TP below entry)', () => {
    const r = evaluateRiskGates({ ...base, takeProfit: '67500.0' });
    expect(r.gates.find((g) => g.id === 'tpDir')!.status).toBe('fail');
    expect(r.pass).toBe(false);
  });

  it('FAILS on stale/offline market data (blocks submission)', () => {
    const r = evaluateRiskGates({ ...base, marketDataStatus: 'OFFLINE' });
    expect(r.gates.find((g) => g.id === 'freshness')!.status).toBe('fail');
    expect(r.pass).toBe(false);
  });

  it('FAILS below minimum quantity', () => {
    const r = evaluateRiskGates({ ...base, quantity: '0.0005' });
    expect(r.pass).toBe(false);
    // qty below minQty AND not step-aligned reported
    expect(r.gates.find((g) => g.id === 'minQty')!.status).toBe('fail');
  });

  it('FAILS on tick/step misalignment', () => {
    const r = evaluateRiskGates({ ...base, price: '68000.07', quantity: '0.1005' });
    expect(r.gates.find((g) => g.id === 'tickStep')!.status).toBe('fail');
  });

  it('WARNs (not fail) when R:R below the minimum', () => {
    const r = evaluateRiskGates({ ...base, riskReward: '0.4' });
    expect(r.gates.find((g) => g.id === 'rr')!.status).toBe('warn');
    expect(r.pass).toBe(true); // warn does not block
  });

  it('FAILS when symbol metadata is missing', () => {
    const r = evaluateRiskGates({ ...base, symbol: undefined });
    expect(r.gates.find((g) => g.id === 'metadata')!.status).toBe('fail');
    expect(r.pass).toBe(false);
  });

  it('FAILS on non-positive/NaN quantity', () => {
    const r = evaluateRiskGates({ ...base, quantity: '0' });
    expect(r.gates.find((g) => g.id === 'priceQty')!.status).toBe('fail');
    expect(r.pass).toBe(false);
  });
});
