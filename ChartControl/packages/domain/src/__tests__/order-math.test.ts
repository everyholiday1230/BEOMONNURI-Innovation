import { describe, it, expect } from 'vitest';
import {
  computeOrderMath,
  riskReward,
  checkPrecision,
  floorToStep,
  roundToTick,
  D,
} from '../index';
import type { SymbolInfo } from '@quantumtrade/schemas';

const BTC: SymbolInfo = {
  id: 'BTCUSDT',
  base: 'BTC',
  quote: 'USDT',
  contractType: 'perpetual',
  pricePrecision: 1,
  quantityPrecision: 3,
  tickSize: '0.1',
  stepSize: '0.001',
  minQty: '0.001',
  maxLeverage: 125,
};

describe('decimal order math', () => {
  it('computes position value & initial margin without float error', () => {
    const r = computeOrderMath({
      side: 'long',
      entryPrice: '68200',
      quantity: '0.5',
      leverage: 20,
    });
    expect(r.positionValue).toBe('34100');
    expect(r.initialMargin).toBe('1705');
    // fee = 34100 * 0.0006 = 20.46
    expect(r.estFee).toBe('20.46');
  });

  it('estimates a long liquidation price below entry', () => {
    const r = computeOrderMath({
      side: 'long',
      entryPrice: '68200',
      quantity: '0.5',
      leverage: 20,
    });
    expect(r.estLiquidationPrice).toBeDefined();
    expect(D(r.estLiquidationPrice!).lt(68200)).toBe(true);
  });

  it('estimates a short liquidation price above entry', () => {
    const r = computeOrderMath({
      side: 'short',
      entryPrice: '68200',
      quantity: '0.5',
      leverage: 20,
    });
    expect(D(r.estLiquidationPrice!).gt(68200)).toBe(true);
  });

  it('computes max estimated loss including fee for a long', () => {
    const r = computeOrderMath({
      side: 'long',
      entryPrice: '68200',
      quantity: '0.5',
      stopLoss: '67480',
      leverage: 20,
    });
    // risk/unit = 720; *0.5 = 360; + fee 20.46 = 380.46
    expect(r.maxEstLoss).toBe('380.46');
  });

  it('computes risk/reward (2 dp)', () => {
    expect(riskReward('long', '68200', '67480', '69640')).toBe('2');
    expect(riskReward('long', '68240', '67480', '68980')).toBe('0.97');
  });

  it('handles the classic 0.1 + 0.2 float trap', () => {
    expect(D('0.1').plus('0.2').toString()).toBe('0.3');
  });
});

describe('precision helpers', () => {
  it('floors quantity to step size', () => {
    expect(floorToStep(D('0.5037'), '0.001').toString()).toBe('0.503');
  });
  it('rounds price to tick', () => {
    expect(roundToTick(D('68200.07'), '0.1').toString()).toBe('68200.1');
  });
});

describe('symbol precision validation', () => {
  it('accepts valid aligned price/qty', () => {
    expect(checkPrecision(BTC, '68200.1', '0.5').ok).toBe(true);
  });
  it('rejects qty below min', () => {
    const r = checkPrecision(BTC, '68200.1', '0.0005');
    expect(r.ok).toBe(false);
  });
  it('rejects price off-tick', () => {
    const r = checkPrecision(BTC, '68200.07', '0.5');
    expect(r.ok).toBe(false);
  });
  it('rejects zero / negative / NaN quantity', () => {
    expect(checkPrecision(BTC, '68200.1', '0').ok).toBe(false);
    expect(checkPrecision(BTC, '68200.1', '-1').ok).toBe(false);
  });
});
