/**
 * 고객 등급 판정.
 *
 * 무엇을 정하는가
 * -------------
 * 사장님이 정한 기준으로 등급을 계산한다:
 *   · 실제로 거래한 **날 수**
 *   · 거래 **금액**
 *   · 거래 **횟수**
 *   · 우리 추천 링크로 거래소에 가입했는지 (크게 작용)
 *
 * 불변식
 * -----
 * 1. **모의 거래는 세지 않는다.** 모의 주문은 우리 서버가 즉시 체결시킨다 —
 *    등급에 넣으면 누구나 버튼을 눌러 최고 등급을 만들고, 그 등급으로 혜택을
 *    준다면 그대로 손실이다. 이 함수에 들어오는 지표는 실거래만이어야 한다.
 *
 * 2. **측정 불가와 0 을 구분한다.** 거래소 키가 없으면 거래 금액을 *알 수 없다*.
 *    그것을 0 으로 취급하면, 많이 거래한 고객이 키를 다시 연결하는 동안 등급이
 *    떨어진다. `measurable: false` 면 등급을 계산하지 않는다.
 *
 * 3. **조건은 AND 다.** 금액만 크고 거래일이 하루면 상위 등급이 아니다 —
 *    "실제로 거래한 날" 을 기준으로 삼은 이유가 그것이다.
 *
 * 4. **기준은 인자로 받는다.** 임계값을 여기 적지 않는다(표에 있다).
 *    운영 중 조정되고, 과거에 어떤 기준으로 줬는지 추적할 수 있어야 한다.
 */

/** 등급 정의 한 줄 (표에서 온다). */
export interface TierDefinition {
  code: string;
  nameKey: string;
  rank: number;
  minVolume30d: number | null;
  minTrades30d: number | null;
  minActiveDays30d: number | null;
  requiresReferral: boolean;
  benefitKey: string | null;
}

/** 계산에 쓰는 실거래 지표. */
export interface TierMetrics {
  /*
     ★★ 측정 가능했는가. false 면 아래 숫자는 **모르는 값**이다.

       거래소 키가 없거나 조회가 실패한 경우다. 0 과 섞으면 "거래를 안 했다" 는
       사실 주장이 되고, 우리는 그것을 확인하지 못했다.
  */
  measurable: boolean;
  volume30d: number | null;
  trades30d: number | null;
  activeDays30d: number | null;
  /** 우리 추천 링크로 가입이 확인됐는가. */
  referred: boolean;
}

export interface TierResult {
  /** 만족한 가장 높은 등급. 아무 조건도 만족하지 않으면 null. */
  tier: TierDefinition | null;
  /** 다음 등급과, 그 등급까지 무엇이 부족한가. */
  next: {
    tier: TierDefinition;
    missing: Array<{
      key: 'volume' | 'trades' | 'activeDays' | 'referral';
      need: number | true;
      have: number | boolean | null;
    }>;
  } | null;
  /** 측정 불가면 true — 화면이 '—' 를 쓴다. */
  unknown: boolean;
}

/** 조건 하나를 만족하는가. 기준이 없으면(NULL) 만족으로 본다. */
function meets(need: number | null, have: number | null): boolean {
  if (need === null || need === undefined) return true;
  if (have === null || have === undefined) return false;   // 모르면 만족이 아니다
  return have >= need;
}

/**
 * 등급을 판정한다.
 *
 * @param metrics  실거래 지표 (모의 제외)
 * @param defs     활성 등급 정의들
 */
export function evaluateTier(metrics: TierMetrics, defs: readonly TierDefinition[]): TierResult {
  /*
     ★★ 측정 불가면 등급을 계산하지 않는다.

       "조건을 만족하지 않는다" 와 "확인할 수 없다" 는 다르다. 후자를 최저
       등급으로 처리하면 실제로 많이 거래한 고객이 키 재연결 중에 강등된다.
  */
  if (!metrics.measurable) {
    return { tier: null, next: null, unknown: true };
  }

  const active = [...defs].sort((a, b) => b.rank - a.rank);

  const satisfies = (d: TierDefinition): boolean =>
    meets(d.minVolume30d, metrics.volume30d)
    && meets(d.minTrades30d, metrics.trades30d)
    && meets(d.minActiveDays30d, metrics.activeDays30d)
    // 추천 가입을 요구하는 등급은 확인된 고객만 받는다.
    && (!d.requiresReferral || metrics.referred);

  const tier = active.find(satisfies) ?? null;

  /*
     다음 등급과 부족한 항목.

     ★ "무엇이 부족한지" 를 밝힌다. 등급만 보여주면 이용자는 무엇을 해야
       올라가는지 알 수 없고, 우리가 임의로 정한다고 느낀다.
  */
  const ascending = [...defs].sort((a, b) => a.rank - b.rank);
  const nextDef = ascending.find((d) => (tier === null ? true : d.rank > tier.rank) && !satisfies(d));

  let next: TierResult['next'] = null;
  if (nextDef) {
    const missing: NonNullable<TierResult['next']>['missing'] = [];
    if (!meets(nextDef.minVolume30d, metrics.volume30d)) {
      missing.push({ key: 'volume', need: nextDef.minVolume30d!, have: metrics.volume30d });
    }
    if (!meets(nextDef.minTrades30d, metrics.trades30d)) {
      missing.push({ key: 'trades', need: nextDef.minTrades30d!, have: metrics.trades30d });
    }
    if (!meets(nextDef.minActiveDays30d, metrics.activeDays30d)) {
      missing.push({ key: 'activeDays', need: nextDef.minActiveDays30d!, have: metrics.activeDays30d });
    }
    if (nextDef.requiresReferral && !metrics.referred) {
      /*
         ★ 이미 거래소 계정이 있던 고객은 이 조건을 **채울 수 없다** — 추천
           귀속은 소급되지 않는다. 화면이 그 사실을 함께 말해야 한다.
      */
      missing.push({ key: 'referral', need: true, have: false });
    }
    next = { tier: nextDef, missing };
  }

  return { tier, next, unknown: false };
}
