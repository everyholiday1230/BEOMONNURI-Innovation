import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { PLANS, PLAN_BY_CODE, PLAN_AI_RUN_POINTS, isPlanCode, DEFAULT_PLAN, planIncludes, FEATURE_SAVES, FEATURE_TOPUP } from '../subscriptions/plans';
import { AI_BASE_POINTS } from '../points/ai-metering';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p: string) => existsSync(join(ROOT, p));

/*
   구독 요금제.

   ★★ 이 검사들이 막는 것

     1. **없는 기능을 파는 것.** 요금제에 적힌 것을 고객은 돈을 내고 사고, 없다는 것을
        나중에 안다. 상시 감시 에이전트·종목 스캐너·자동 주문·데이터 내보내기는 없거나
        하지 않기로 한 것이므로 문구에 들어가면 안 된다.

     2. **금액이 두 곳에 적히는 것.** 화면과 서버가 갈라지면 고객은 화면에 적힌 것과
        다른 금액을 결제한다. 서버가 유일한 진상이어야 한다.

     3. **되지 않는 결제를 되는 것처럼 보이는 것.** 정기결제 연동이 아직 없다.
        그 사실을 감추고 결제 버튼을 띄우면 고객이 돈을 보낼 방법을 찾는다.
*/

describe('SUBSCRIPTION-PLANS — 실제 있는 기능만 판다', () => {
  it('[1] 플랜을 실제로 읽었다', () => {
    /* ★★ 빈 배열이면 아래 검사가 "검사할 것이 없어서" 통과한다. */
    expect(PLANS.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(PLAN_BY_CODE).length).toBe(PLANS.length);
    expect(isPlanCode(DEFAULT_PLAN)).toBe(true);
  });

  it('[2] AI 1회 비용이 계량 코드와 일치한다', () => {
    /*
       ★★ 같은 숫자가 두 곳에 있다. 갈라지면 "월 30회" 라고 팔면서 실제로는 다른
         횟수를 주게 된다.
    */
    expect(PLAN_AI_RUN_POINTS).toBe(AI_BASE_POINTS);
  });

  it('[3] 포함 횟수와 포인트가 서로 맞는다', () => {
    /*
       ★ "월 30회" 라고 적고 9,000pt 를 주는데 1회가 300pt 면 맞다. 어긋나면 고객이
         광고된 횟수를 쓸 수 없다.
    */
    for (const p of PLANS) {
      if (p.monthlyPoints === 0) {
        expect(p.approxAiRuns, `${p.code}: 포인트 0 인데 횟수를 약속한다`).toBe(0);
        continue;
      }
      expect(
        Math.floor(p.monthlyPoints / PLAN_AI_RUN_POINTS),
        `${p.code}: ${p.monthlyPoints}pt 로는 ${p.approxAiRuns}회를 쓸 수 없다`,
      ).toBeGreaterThanOrEqual(p.approxAiRuns);
    }
  });

  it('[4] 무료 플랜은 값이 0 이고, 유료 기능은 포함하지 않는다', () => {
    /*
       ★★ 무료 플랜도 매달 포인트를 준다(운영자 결정: 1,000pt = 분석 3회).

         ★ 그 대신 **유료 기능은 반드시 제외돼야 한다.** 무료로 전부 주면 올릴 이유가
           없다. 저장과 추가 구매가 제외인지 검사한다 — 요금제 문구와 서버 게이트가
           같은 정의를 읽으므로, 여기서 참이면 게이트도 막는다.

         ★ 남용 위험은 기록해 둔다: 매달 무료 지급은 계정을 여러 개 만드는 길이 된다.
           지금 막는 것은 이메일 중복뿐이다.
    */
    expect(PLAN_BY_CODE.free.priceUsd).toBe('0');
    expect(PLAN_BY_CODE.free.monthlyPoints).toBeGreaterThan(0);
    expect(planIncludes('free', FEATURE_SAVES), '무료 플랜에 저장이 포함됐다').toBe(false);
    expect(planIncludes('free', FEATURE_TOPUP), '무료 플랜에 추가 구매가 포함됐다').toBe(false);
  });

  it('[4b] 유료 플랜은 저장과 추가 구매를 포함한다', () => {
    /* ★ 가격표에 적힌 것을 서버 게이트가 그대로 읽으므로, 여기가 곧 권한이다. */
    for (const p of PLANS.filter((x) => x.priceUsd !== '0')) {
      expect(planIncludes(p.code, FEATURE_SAVES), `${p.code}: 저장이 빠졌다`).toBe(true);
      expect(planIncludes(p.code, FEATURE_TOPUP), `${p.code}: 추가 구매가 빠졌다`).toBe(true);
    }
  });

  it('[5] 유료 플랜은 값이 비싸질수록 더 준다', () => {
    const paid = PLANS.filter((p) => p.priceUsd !== '0')
      .sort((a, b) => Number(a.priceUsd) - Number(b.priceUsd));
    expect(paid.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < paid.length; i += 1) {
      expect(
        paid[i]!.monthlyPoints,
        `${paid[i]!.code} 가 ${paid[i - 1]!.code} 보다 비싼데 포인트가 더 적다`,
      ).toBeGreaterThan(paid[i - 1]!.monthlyPoints);
    }
  });

  it('[6] 없는 기능을 요금제 문구에 넣지 않았다', () => {
    /*
       ★★ 이 검사가 가장 중요하다. 아래 표현이 요금제 사전 문구에 나타나면, 우리가
         만들지 않은 것(또는 하지 않기로 한 것)을 파는 것이다.

         · 상시 감시 에이전트 / 종목 스캐너 — 미착수
         · 자동 주문 — 규제상 하지 않는다(FIU 유권해석: 자동매매는 VASP 해당 소지)
         · 데이터 내보내기 — 서버 경로가 없다
         · BitMart — 이 배포에서 연결할 수 없다
    */
    const forbidden: Array<[RegExp, string]> = [
      [/auto[- ]?trad|automatic order|places orders for you|자동\s*주문|자동매매/i, '자동 주문'],
      [/24\/7 monitor|always[- ]on monitor|watch(es)? the market for you|상시\s*감시/i, '상시 감시 에이전트'],
      [/scanner|scans all (symbols|markets)|종목\s*스캐너/i, '종목 스캐너'],
      [/export (your )?(data|csv)|내보내기/i, '데이터 내보내기'],
      [/BitMart/i, 'BitMart 연결'],
      [/guaranteed|profit is|수익\s*보장/i, '수익 보장'],
    ];
    const bad: string[] = [];
    for (const lang of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/${lang}.js`);
      for (const line of src.split('\n')) {
        /* ★ 요금제 관련 키만 본다. 다른 문구까지 막을 이유는 없다. */
        if (!/^\s*plan_[a-z_]+\s*:/.test(line)) continue;
        for (const [re, what] of forbidden) {
          if (re.test(line)) bad.push(`${lang} · ${what} · ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(bad, `없는 기능을 요금제에 넣었다:\n${bad.join('\n')}`).toEqual([]);
  });

  it('[7] 모든 요금제 문구가 3개 언어에 있다', () => {
    /*
       ★ 사전에 없으면 화면에 키 문자열이 그대로 보인다('plan_basic_name' 같은 것이
         가격표에 뜬다).
    */
    const keys = new Set<string>();
    for (const p of PLANS) {
      keys.add(p.nameKey);
      for (const f of p.features) keys.add(f.key);
    }
    for (const k of ['plan_per_month', 'plan_included_runs', 'plan_included_none',
      'plan_billing_pending', 'plan_loading', 'plan_load_failed']) keys.add(k);
    expect(keys.size).toBeGreaterThan(12);

    const missing: string[] = [];
    for (const lang of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/${lang}.js`);
      for (const k of keys) {
        if (!new RegExp(`\\b${k}\\s*:`).test(src)) missing.push(`${lang}/${k}`);
      }
    }
    expect(missing, `사전 누락:\n${missing.join('\n')}`).toEqual([]);
  });

  it('[8] 금액을 화면에 박아 두지 않았다 — 서버가 진상이다', () => {
    /*
       ★★ 랜딩 프라이싱이 /api/plans 를 읽어 그려야 한다. 금액을 JSX 에 적으면 서버와
         갈라지고, 고객은 화면에 적힌 것과 다른 금액을 결제하게 된다.
    */
    const src = read('src/pages-auth.jsx');
    const at = src.indexOf('id="pricing"');
    expect(at, 'pricing 섹션을 찾지 못했다').toBeGreaterThan(0);
    const seg = src.slice(at, at + 3000);
    expect(seg, '요금제를 서버에서 받지 않는다').toMatch(/plans\.list\.map/);
    /* ★ $19 · $49 같은 금액이 JSX 에 직접 있으면 안 된다. */
    expect(seg, '금액이 화면에 박혀 있다').not.toMatch(/\$\s*(19|49)\b/);
    expect(src, '/api/plans 를 부르지 않는다').toMatch(/\/api\/plans/);
  });

  it('[9] 결제가 되는 척하지 않고, 금액이 어긋나면 팔지 않는다', () => {
    /*
       ★★ 예전에는 정기결제가 없어서 "되는 척하지 않는가" 만 봤다. 이제 PayPal 구독을
         붙였으므로 검사할 것이 바뀌었다 — **화면 금액과 실제 청구가 어긋나지 않는가**.

         PayPal 대시보드에서 플랜 금액을 바꿀 수 있다. 그러면 화면은 $19 를 보여주고
         다른 금액이 청구된다. 고객은 화면을 보고 결제하므로 그 어긋남은 우리 책임이다.
    */
    const routes = read('apps/api/src/subscriptions/subscription-routes.ts');
    expect(routes).toMatch(/recurringAvailable/);
    /* ★ 준비되지 않았을 때는 여전히 명확히 거절해야 한다. */
    expect(routes).toMatch(/RECURRING_NOT_CONFIGURED/);
    /* ★ 플랜 id 를 화면이 보내는 값으로 정하면 $19 로 $199 권한을 살 수 있다. */
    expect(routes, '플랜 id 를 서버가 정하지 않는다').toMatch(/planIdFor\(body\.planCode\)/);
    /* ★ 승인 여부를 PayPal 에 직접 물어야 한다. return_url 만으로 켜면 무료로 열린다. */
    expect(routes, '승인 확인 경로가 없다').toMatch(/getSubscription\(ref\)/);
    expect(routes, '소유자 대조가 없다').toMatch(/NOT_YOURS/);
    /* ★ 돈을 받고 포인트를 안 주면 유료 플랜의 실체가 없다. */
    expect(routes, '구독 시작 시 포인트 충전을 하지 않는다').toMatch(/grantMonthlyPointsIfDue/);

    const idx = read('apps/api/src/index.ts');
    /* ★ 금액 대조를 통과한 플랜만 판다. 통과 집합이 비면 결제가 닫힌다. */
    expect(idx, '금액 대조 없이 결제를 연다').toMatch(/verifyPlanAmounts/);
    expect(idx, '검증된 플랜만 팔지 않는다').toMatch(/verifiedPlanIds/);
    expect(idx, '플랜 id 를 코드에 박았다 — sandbox/live 가 다르다').not.toMatch(/'P-[A-Z0-9]{10,}'/);

    const auth = read('src/pages-auth.jsx');
    expect(auth, '결제 미준비 사실을 화면이 말하지 않는다').toMatch(/plan_billing_pending/);

    const points = read('src/pages-points.jsx');
    /* ★ 화면은 서버가 준 목록만 그린다. 스스로 만들면 잠긴 플랜을 팔게 된다. */
    expect(points, '결제 가능 목록을 서버에서 받지 않는다').toMatch(/purchasablePlans/);
  });

  it('[10] 해지가 즉시 끊지 않고, 결제사 정지가 별개임을 말한다', () => {
    /*
       ★★ 이미 낸 달을 끊으면 돈을 받고 서비스를 멈추는 것이다. 그리고 우리 기록만
         바꾸면 결제사는 계속 청구한다 — 그 사실을 응답과 화면이 모두 말해야 한다.
    */
    const repo = read('apps/api/src/subscriptions/subscription-repo.ts');
    expect(repo, '해지가 상태만 바꾸지 않는다').toMatch(/status = 'canceled'/);
    /* ★ 유료 여부를 상태가 아니라 기간으로 정해야 해지 후에도 남은 기간을 쓸 수 있다. */
    expect(repo).toMatch(/end > now/);

    const routes = read('apps/api/src/subscriptions/subscription-routes.ts');
    expect(routes).toMatch(/activeUntil/);
    expect(routes).toMatch(/providerStopRequired/);

    for (const lang of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/${lang}.js`);
      expect(src, `${lang}: 결제사 정지 안내가 없다`).toMatch(/sub_canceled_provider\s*:/);
      expect(src, `${lang}: 해지 확인 문구가 없다`).toMatch(/sub_cancel_confirm\s*:/);
    }
  });

  it('[11] 월 충전이 두 번 들어가지 않는다', () => {
    /*
       ★★ 갱신 처리가 두 번 돌면 포인트가 두 배 들어간다. 표시를 먼저 선점하고
         성공한 호출만 충전하는 순서여야 한다 — 뒤집으면 중간에 죽었을 때 두 번 준다.
    */
    const repo = read('apps/api/src/subscriptions/subscription-repo.ts');
    expect(repo, '멱등 표시가 없다').toMatch(/last_grant_period/);
    expect(repo, '조건부 선점이 아니다').toMatch(/last_grant_period IS NULL OR last_grant_period <> current_period_start/);

    const routes = read('apps/api/src/subscriptions/subscription-routes.ts');
    /* ★ 원장 쪽에도 멱등 키가 있어야 한다(uq_points_ref). */
    expect(routes).toMatch(/refType: 'subscription_grant'/);
    expect(routes).toMatch(/refId: `\$\{userId\}:\$\{periodStart\}`/);
  });

  it('[12] 거래량 리베이트 등급과 섞지 않았다', () => {
    /*
       ★★ tier_definitions 는 30일 거래량 기준 리베이트 등급이다(active/pro/partner).
         이름이 비슷하다고 같은 테이블에 넣으면 돈을 낸 구독자와 거래를 많이 한 사람을
         구별할 수 없다.
    */
    expect(exists('infrastructure/postgres/0044_subscriptions.postgres.sql')).toBe(true);
    const sql = read('infrastructure/postgres/0044_subscriptions.postgres.sql');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS subscriptions/);
    /*
       ★ 주석은 제외한다. 왜 섞지 않았는지 설명하려면 그 테이블 이름을 **언급**해야
         하는데, 문자열만 찾으면 그 설명이 위반으로 잡힌다.
    */
    const ddl = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
    expect(ddl, '검사 대상 DDL 을 못 남겼다').toMatch(/CREATE TABLE/);
    expect(ddl, '리베이트 등급 테이블을 건드린다').not.toMatch(/tier_definitions/);
    expect(exists('infrastructure/postgres/0044_subscriptions.down.postgres.sql')).toBe(true);
  });
});
