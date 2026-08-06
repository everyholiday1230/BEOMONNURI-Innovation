import { describe, it, expect } from 'vitest';
import {
  ChartCommandSchema,
  SignalObjectSchema,
  OrderDraftSchema,
  WidgetSchema,
  CandleSchema,
  validate,
} from '../index';

describe('ChartCommand allowlist', () => {
  it('accepts an allowlisted createEntryZone command', () => {
    const r = validate(ChartCommandSchema, {
      command: 'createEntryZone',
      priceLo: '68120',
      priceHi: '68360',
      label: 'entry',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a non-allowlisted command (arbitrary action)', () => {
    const r = validate(ChartCommandSchema, {
      command: 'executeJavaScript',
      code: 'while(true){}',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects createTrendLine with malformed points', () => {
    const r = validate(ChartCommandSchema, {
      command: 'createTrendLine',
      points: [{ time: 1, price: 'abc' }],
    });
    expect(r.ok).toBe(false);
  });

  it('createOrderDraft is a draft only (no submit fields accepted to bypass gate)', () => {
    const r = validate(ChartCommandSchema, { command: 'createOrderDraft', signalId: 'sig-1' });
    expect(r.ok).toBe(true);
  });
});

describe('SignalObject', () => {
  const base = {
    id: 'sig-btc-01',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    direction: 'long',
    generatedAt: Date.now(),
    dataAsOf: Date.now(),
    analysis: 'uptrend intact',
    confidence: 74,
    invalidationCondition: '15m close < 67480',
    entryZone: ['68120', '68360'],
    stopLoss: '67480',
    takeProfits: ['68980', '69640'],
    riskReward: '2.8',
  };

  it('accepts a valid signal and defaults aiGenerated=true', () => {
    const r = validate(SignalObjectSchema, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.aiGenerated).toBe(true);
  });

  it('rejects entryZone where lo > hi', () => {
    const r = validate(SignalObjectSchema, { ...base, entryZone: ['69000', '68000'] });
    expect(r.ok).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const r = validate(SignalObjectSchema, { ...base, confidence: 140 });
    expect(r.ok).toBe(false);
  });
});

describe('OrderDraft', () => {
  const base = {
    symbol: 'BTCUSDT',
    side: 'long',
    orderType: 'limit',
    price: '68200',
    quantity: '0.5',
    leverage: 20,
    clientOrderId: 'cid-123',
  };
  it('accepts a valid limit draft and forces isSimulated=true', () => {
    const r = validate(OrderDraftSchema, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.isSimulated).toBe(true);
  });
  it('rejects a limit order missing a price', () => {
    const r = validate(OrderDraftSchema, { ...base, orderType: 'limit', price: undefined });
    expect(r.ok).toBe(false);
  });
  it('accepts a market order without price', () => {
    const r = validate(OrderDraftSchema, { ...base, orderType: 'market', price: undefined });
    expect(r.ok).toBe(true);
  });
  it('rejects non-positive quantity', () => {
    const r = validate(OrderDraftSchema, { ...base, quantity: '0' });
    expect(r.ok).toBe(false);
  });
});

describe('Widget contract defaults', () => {
  it('fills required contract fields with safe defaults', () => {
    const r = validate(WidgetSchema, {
      id: 'chart',
      type: 'chart',
      x: 0,
      y: 0,
      width: 12,
      height: 11,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.visible).toBe(true);
      expect(r.data.settings).toEqual({});
      expect(r.data.schemaVersion).toBe(1);
    }
  });
});

describe('Candle OHLC validation', () => {
  it('rejects a candle where high < low', () => {
    const r = validate(CandleSchema, {
      time: 1,
      open: '10',
      high: '5',
      low: '20',
      close: '12',
      volume: '100',
    });
    expect(r.ok).toBe(false);
  });
  it('rejects NaN-like non-decimal strings', () => {
    const r = validate(CandleSchema, {
      time: 1,
      open: 'NaN',
      high: '5',
      low: '1',
      close: '3',
      volume: '10',
    });
    expect(r.ok).toBe(false);
  });
});
