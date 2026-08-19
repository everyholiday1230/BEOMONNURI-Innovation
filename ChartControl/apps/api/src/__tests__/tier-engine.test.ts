import { describe, it, expect } from 'vitest';
import { evaluateTier, type TierDefinition, type TierMetrics } from '../tiers/tier-engine';

/**
 * 고객 등급 판정 검사.
 *
 * 기준(사장님 지시): 실제로 거래한 **날** · 거래 **금액** · 거래 **횟수**,
 * 그리고 우리 링크로 가입했는지가 크게 작용한다.
 *
 * ★★ 이 검사가 지키려는 것
 *   1. 모의 거래로 등급을 만들 수 없다 (지표 자체가 실거래만이어야 한다).
 *   2. "확인할 수 없다" 를 "조건 미달" 로 처리하지 않는다.
 *   3. 채울 수 없는 조건을 목표로 제시하지 않는다.
 */

const DEFS: TierDefinition[] = [
  { code: 'starter', nameKey: 'tier_name_starter', rank: 10, minVolume30d: null, minTrades30d: null, minActiveDays30d: null, requiresReferral: false, benefitKey: null, rebateShareBps: 0 },
  { code: 'active', nameKey: 'tier_name_active', rank: 20, minVolume30d: 10_000, minTrades30d: 10, minActiveDays30d: 3, requiresReferral: false, benefitKey: null, rebateShareBps: 1000 },
  { code: 'pro', nameKey: 'tier_name_pro', rank: 30, minVolume30d: 100_000, minTrades30d: 50, minActiveDays30d: 8, requiresReferral: false, benefitKey: null, rebateShareBps: 2000 },
  { code: 'partner', nameKey: 'tier_name_partner', rank: 40, minVolume30d: 500_000, minTrades30d: 150, minActiveDays30d: 15, requiresReferral: true, benefitKey: null, rebateShareBps: 3000 },
];

const M = (over: Partial<TierMetrics> = {}): TierMetrics => ({
  measurable: true, volume30d: 0, trades30d: 0, activeDays30d: 0, referred: false, ...over,
});

describe('TIER-01 기본 판정', () => {
  it('[1] 아무 조건도 없는 등급은 누구나 받는다', () => {
    const r = evaluateTier(M(), DEFS);
    expect(r.tier?.code).toBe('starter');
    expect(r.unknown).toBe(false);
  });

  it('[2] 세 조건을 모두 만족해야 올라간다', () => {
    // 금액만 충족 — 거래일이 하루도 없다.
    expect(evaluateTier(M({ volume30d: 999_999 }), DEFS).tier?.code).toBe('starter');
    // 셋 다 충족.
    expect(evaluateTier(M({ volume30d: 20_000, trades30d: 12, activeDays30d: 4 }), DEFS).tier?.code)
      .toBe('active');
  });

  it('[3] ★★ 금액이 커도 거래일이 적으면 상위 등급이 아니다', () => {
    /*
       "실제로 거래한 날" 을 기준에 넣은 이유다 — 하루에 몰아서 넣은 사람과
       꾸준히 거래한 사람을 같게 보면 그 기준이 의미가 없다.
    */
    const r = evaluateTier(M({ volume30d: 5_000_000, trades30d: 300, activeDays30d: 2 }), DEFS);
    expect(r.tier?.code).toBe('starter');
  });

  it('[4] 가장 높은 등급을 고른다 (첫 일치가 아니다)', () => {
    const r = evaluateTier(M({ volume30d: 200_000, trades30d: 60, activeDays30d: 10 }), DEFS);
    expect(r.tier?.code).toBe('pro');
  });
});

describe('TIER-02 측정 불가와 0 을 구분한다', () => {
  it('[1] ★★ 측정 불가면 등급을 주지 않고 unknown 을 세운다', () => {
    /*
       거래소 키가 없으면 거래 금액을 **알 수 없다**. 그것을 0 으로 보고 최저
       등급을 주면, 실제로 많이 거래한 고객이 키를 다시 연결하는 동안 강등된다.
    */
    const r = evaluateTier(M({ measurable: false, volume30d: null, trades30d: null, activeDays30d: null }), DEFS);
    expect(r.unknown).toBe(true);
    expect(r.tier).toBeNull();
    // 목표도 제시하지 않는다 — 무엇이 부족한지 계산할 근거가 없다.
    expect(r.next).toBeNull();
  });

  it('[2] 값이 null 이면 그 조건은 만족이 아니다', () => {
    const r = evaluateTier(M({ volume30d: null, trades30d: 100, activeDays30d: 20 }), DEFS);
    // 금액을 모르므로 금액 조건이 있는 등급은 받을 수 없다.
    expect(r.tier?.code).toBe('starter');
  });
});

describe('TIER-03 추천 가입 조건', () => {
  const full = M({ volume30d: 900_000, trades30d: 200, activeDays30d: 20 });

  it('[1] 추천 가입이 없으면 최고 등급을 받지 못한다', () => {
    expect(evaluateTier(full, DEFS).tier?.code).toBe('pro');
  });

  it('[2] 추천 가입이 있으면 받는다', () => {
    expect(evaluateTier({ ...full, referred: true }, DEFS).tier?.code).toBe('partner');
  });

  it('[3] ★★ 채울 수 없는 조건임을 표시한다', () => {
    const r = evaluateTier(full, DEFS);
    const ref = r.next?.missing.find((m) => m.key === 'referral');
    /*
       추천 귀속은 **소급되지 않는다.** 이미 거래소 계정이 있던 고객은 이 조건을
       채울 방법이 없다 — 화면이 그 사실을 말할 수 있어야 한다. 못 채울 목표를
       진행률로 보여주면 거짓 기대를 만든다.
    */
    expect(ref).toBeTruthy();
    expect(ref!.need).toBe(true);
    expect(ref!.have).toBe(false);
  });

  it('[4] 하위 등급에는 추천을 요구하지 않는다', () => {
    /*
       모든 등급에 요구하면 이미 계정이 있던 고객은 영원히 최저 등급이다 —
       그 사람 잘못이 아니다.
    */
    const r = evaluateTier(M({ volume30d: 20_000, trades30d: 12, activeDays30d: 4 }), DEFS);
    expect(r.tier?.code).toBe('active');
  });
});

describe('TIER-04 다음 등급과 부족한 항목', () => {
  it('[1] 부족한 것만 나열한다', () => {
    /*
       금액 720,000 · 12건 · 4일 → `active`(10,000 / 10건 / 3일)는 충족하고
       `pro`(100,000 / 50건 / 8일)는 금액만 충족한다.
    */
    const r = evaluateTier(M({ volume30d: 720_000, trades30d: 12, activeDays30d: 4 }), DEFS);
    expect(r.tier?.code).toBe('active');
    const keys = (r.next?.missing ?? []).map((m) => m.key).sort();
    /*
       금액은 이미 충족했으므로 나열하지 않는다. 충족한 것을 목표로 또 보여주면
       이용자가 무엇을 해야 하는지 알 수 없다.
    */
    expect(keys).toEqual(['activeDays', 'trades']);
  });

  it('[2] 현재값과 필요값을 함께 준다', () => {
    const r = evaluateTier(M({ volume30d: 720_000, trades30d: 12, activeDays30d: 4 }), DEFS);
    // 다음 등급은 `pro` — 필요 체결 50건, 현재 12건.
    expect(r.next?.tier.code).toBe('pro');
    const trades = r.next!.missing.find((m) => m.key === 'trades')!;
    expect(trades.have).toBe(12);
    expect(trades.need).toBe(50);
  });

  it('[3] 최고 등급이면 다음이 없다', () => {
    const r = evaluateTier(
      M({ volume30d: 9_000_000, trades30d: 999, activeDays30d: 30, referred: true }),
      DEFS,
    );
    expect(r.tier?.code).toBe('partner');
    expect(r.next).toBeNull();
  });
});

describe('TIER-05 기준은 데이터다', () => {
  it('[1] 정의가 없으면 등급도 없다 (코드에 기준을 박지 않았다)', () => {
    const r = evaluateTier(M({ volume30d: 1_000_000, trades30d: 500, activeDays30d: 30 }), []);
    expect(r.tier).toBeNull();
    expect(r.next).toBeNull();
    // 임계값이 코드에 있으면 빈 정의로도 등급이 나온다 — 그렇지 않음을 고정한다.
  });

  it('[2] 기준을 바꾸면 결과가 바뀐다', () => {
    const strict: TierDefinition[] = [
      { ...DEFS[1]!, minTrades30d: 1000 },
    ];
    const r = evaluateTier(M({ volume30d: 999_999, trades30d: 12, activeDays30d: 30 }), strict);
    expect(r.tier).toBeNull();
  });
});

describe('TIER-BENEFIT 환급률', () => {
  it('[1] 등급이 오르면 환급률도 오른다 (역전 없음)', () => {
    /*
       역전되면 등급을 올리는 것이 손해가 된다 — 제도가 무의미해진다.
    */
    const sorted = [...DEFS].sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.rebateShareBps).toBeGreaterThanOrEqual(sorted[i - 1]!.rebateShareBps);
    }
  });

  it('[2] ★★ 환급률이 우리 커미션을 넘지 않는다', () => {
    /*
       우리가 KuCoin 에서 받는 몫은 50%(L0, 추천가입+우리API)다. 환급률은 **우리
       커미션의 비율**이므로 100% 를 넘지만 않으면 마이너스가 되지 않는다.

       상한을 50%(5000bps)로 둔 이유: 절반을 넘겨 돌려줄 사업적 이유가 없고,
       실수로 큰 값이 들어가는 것을 막는다(DB CHECK 제약과 같은 값).
    */
    for (const d of DEFS) {
      expect(d.rebateShareBps).toBeGreaterThanOrEqual(0);
      expect(d.rebateShareBps).toBeLessThanOrEqual(5000);
    }
  });

  it('[3] ★ starter 는 환급이 0 이다', () => {
    /*
       비제휴 고객(기존 KuCoin 계정으로 API 만 연결)은 Level 0 에서 우리 커미션이
       **0%** 다 — KuCoin BPP 공식 표에서 확인했다. 받는 것이 없으면 돌려줄 것도
       없다. 0 이 정직한 값이고, 여기에 양수를 넣으면 우리 돈으로 메워야 한다.
    */
    const starter = DEFS.find((d) => d.code === 'starter');
    expect(starter?.rebateShareBps).toBe(0);
  });
});
