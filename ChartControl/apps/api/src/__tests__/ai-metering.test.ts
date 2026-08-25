import { describe, it, expect } from 'vitest';
import { computeRunPoints, AI_BASE_POINTS, AI_MIN_BALANCE } from '../points/ai-metering';

describe('AI metering (hybrid: base + output overage)', () => {
  it('charges only the base for typical/short runs (<=1.5K output)', () => {
    expect(computeRunPoints(0)).toBe(300);
    expect(computeRunPoints(1000)).toBe(300);
    expect(computeRunPoints(1500)).toBe(300);
  });

  it('adds 200pt per 1K output beyond 1.5K (rounded up)', () => {
    expect(computeRunPoints(2000)).toBe(300 + 200);   // 0.5K over -> ceil -> 1 unit
    expect(computeRunPoints(2500)).toBe(300 + 200);   // 1.0K over
    expect(computeRunPoints(3000)).toBe(300 + 400);   // 1.5K over -> 2 units
    expect(computeRunPoints(4500)).toBe(300 + 600);   // 3.0K over -> 3 units
  });

  it('handles junk input safely', () => {
    expect(computeRunPoints(NaN)).toBe(300);
    expect(computeRunPoints(-100)).toBe(300);
    expect(computeRunPoints(undefined as unknown as number)).toBe(300);
  });

  it('10,000 points ~= 30 uses at the base rate', () => {
    expect(Math.floor(10_000 / AI_BASE_POINTS)).toBe(33); // 일반 분석 기준; 긴 분석 섞이면 ~30
    expect(AI_MIN_BALANCE).toBe(300);
  });
});
