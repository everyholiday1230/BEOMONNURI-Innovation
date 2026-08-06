import { describe, it, expect } from 'vitest';
import {
  overlaps,
  hasCollision,
  findFreeSpot,
  migrateLegacyLayout,
  loadLayoutSafe,
} from '../index';
import { LayoutSchema, type Layout } from '@quantumtrade/schemas';

const FALLBACK: Layout = LayoutSchema.parse({
  id: 'fallback',
  name: 'Fallback',
  widgets: [{ id: 'chart', type: 'chart', x: 0, y: 0, width: 24, height: 16 }],
});

// A verbatim prototype preset (standard-trader) in legacy {w,h} form.
const LEGACY_STANDARD = {
  id: 'standard-trader',
  name: 'Standard Trader',
  cols: 24,
  widgets: [
    { id: 'market', type: 'marketWatch', x: 0, y: 0, w: 4, h: 16, minW: 3, minH: 8 },
    { id: 'chart', type: 'chart', x: 4, y: 0, w: 12, h: 11, minW: 8, minH: 6 },
    { id: 'orderbook', type: 'orderBook', x: 16, y: 0, w: 4, h: 11, minW: 3, minH: 6 },
  ],
};

describe('collision detection', () => {
  it('detects overlapping boxes', () => {
    expect(overlaps({ x: 0, y: 0, w: 4, h: 4 }, { x: 2, y: 2, w: 4, h: 4 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 })).toBe(false);
  });
  it('ignores hidden widgets and self', () => {
    const ws = [{ id: 'a', x: 0, y: 0, w: 4, h: 4, hidden: true }];
    expect(hasCollision(ws, { id: 'b', x: 0, y: 0, w: 4, h: 4 })).toBe(false);
  });
  it('finds a free spot that does not collide', () => {
    const ws = [{ id: 'a', x: 0, y: 0, w: 24, h: 4 }];
    const spot = findFreeSpot(ws, 4, 4);
    expect(spot.y).toBeGreaterThanOrEqual(4);
    expect(hasCollision(ws, { id: 'p', ...spot, w: 4, h: 4 })).toBe(false);
  });
});

describe('layout migration', () => {
  it('migrates a legacy {w,h} preset to the full Widget contract', () => {
    const migrated = migrateLegacyLayout(LEGACY_STANDARD);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.widgets).toHaveLength(3);
    const chart = migrated.widgets.find((w) => w.id === 'chart')!;
    expect(chart.width).toBe(12);
    expect(chart.height).toBe(11);
    expect(chart.visible).toBe(true);
    expect(chart.settings).toEqual({});
    // Must satisfy the strict current schema.
    expect(LayoutSchema.safeParse(migrated).success).toBe(true);
  });
});

describe('corrupted-data recovery', () => {
  it('returns fallback for unparseable data (never throws)', () => {
    expect(loadLayoutSafe('not json object', FALLBACK)).toBe(FALLBACK);
    expect(loadLayoutSafe({ garbage: true }, FALLBACK)).toBe(FALLBACK);
    expect(loadLayoutSafe(null, FALLBACK)).toBe(FALLBACK);
  });
  it('accepts an already-current layout', () => {
    const current = LayoutSchema.parse({
      id: 'x',
      name: 'X',
      widgets: [{ id: 'c', type: 'chart', x: 0, y: 0, width: 12, height: 8 }],
    });
    expect(loadLayoutSafe(current, FALLBACK).id).toBe('x');
  });
  it('migrates legacy data through the safe loader', () => {
    const out = loadLayoutSafe(LEGACY_STANDARD, FALLBACK);
    expect(out.id).toBe('standard-trader');
    expect(out.widgets).toHaveLength(3);
  });
});
