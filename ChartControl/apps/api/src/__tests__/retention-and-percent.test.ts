/*
   운영자가 짚은 항목들을 잠근다 (2026-09-18 두 번째 묶음).

     · 처음 저장 500pt ("처음저장은 500pt로해줘")
     · 연장은 **원래 만료에 100일을 더한다**
     · 만료되어도 서버에는 보관 (학습용)
     · 종료 확인창이 무조건 `1×` 로 나오던 결함
     · 차트와 포지션 패널의 `+-%` 불일치
     · 히스토리에 손익 표시
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('처음 저장 500포인트', () => {
  it('두 저장소가 같은 값이다', () => {
    /*
       ★ 저장 화면이 둘을 한 목록으로 합쳤다. 같은 목록에 있는 것들의 값이 다르면
         고객이 왜 다른지 알 수 없다.
    */
    expect(read('apps/api/src/user-strategy-routes.ts'), '내 규칙이 500 이 아니다')
      .toMatch(/\{ strategy: 500, indicator: 500, signal: 500 \}/u);
    expect(read('apps/api/src/saved-routes.ts'), '저장 항목이 500 이 아니다')
      .toMatch(/\{ symbol: 500, global: 500 \}/u);
  });

  /*
     ★★★ **돈이 걸린 문구는 서버 값이어야 한다.**
       `scope === 'global' ? 300 : 100` 이 박혀 있었다. 서버가 500 으로 올렸는데
       확인창은 "100 포인트가 차감됩니다" 라고 물었다 — 고객은 100 인 줄 알고
       눌렀다가 500 이 나간다.
  */
  it('확인창 비용을 화면에 박지 않는다', () => {
    const copilot = read('src/ai-copilot.jsx');
    const i = copilot.indexOf('const scope = savable.scope');
    const body = copilot.slice(i, i + 1400);
    expect(body, '비용이 박혀 있다').not.toMatch(/scope === 'global' \? 300 : 100;/u);
    expect(body, '서버 값을 쓰지 않는다').toMatch(/Number\(saveCost && saveCost\[scope\]\)/u);
    expect(copilot, '서버 응답에서 비용을 읽지 않는다').toMatch(/setSaveCost\(r\.saveCost\)/u);
  });

  it('화면 기본값이 서버와 같다', () => {
    /* ★ 응답이 늦어도 틀린 수를 보여주지 않는다. */
    expect(read('src/ai-copilot.jsx')).toMatch(/useState\(\{ symbol: 500, global: 500 \}\)/u);
    expect(read('src/pages-more.jsx')).toMatch(/\{ strategy: 500, indicator: 500, signal: 500 \}/u);
  });
});

describe('연장은 원래 만료에 100일을 더한다', () => {
  const strategyRepo = read('apps/api/src/db/user-strategy-repo.ts');
  const savedRepo = read('apps/api/src/db/saved-item-repo.ts');

  it('남은 기간이 있으면 거기에 더한다', () => {
    /*
       `GREATEST(now(), COALESCE(expires_at, now())) + 100일`
         · 아직 안 지난 항목 → `expires_at` 이 now 보다 크므로 **원래 만료 + 100일**
           (실측: 70일 남은 것을 연장 → 170일)
         · 이미 지난 항목 → now 부터 100일 (지난 시각에 더하면 95일이 된다)
    */
    for (const [name, src] of [['내 규칙', strategyRepo], ['저장 항목', savedRepo]] as const) {
      expect(src, `${name} 연장 산식이 다르다`)
        .toMatch(/GREATEST\(now\(\), COALESCE\(expires_at, now\(\)\)\) \+ \(\$3 \|\| ' days'\)::interval/u);
    }
  });
});

describe('만료되어도 서버에는 보관한다', () => {
  const strategyRepo = read('apps/api/src/db/user-strategy-repo.ts');
  const savedRepo = read('apps/api/src/db/saved-item-repo.ts');

  /*
     ★★★ 운영 지시: "고객한테는 만료되어도 우리 서버에는 계속 저장되게 해줘.
       대화든 거래기록이든 뭐든 우리가 나중에 다 학습시킬 거라서."

     ★ 만료는 **보이지 않게 하는 것**이다. 지우는 것이 아니다.
       실측: 만료 처리 후 고객에게 1개 / 서버에 2개.
  */
  it('만료를 이유로 지우지 않는다', () => {
    for (const [name, src] of [['내 규칙', strategyRepo], ['저장 항목', savedRepo]] as const) {
      expect(src, `${name} 이 만료된 행을 삭제한다`)
        .not.toMatch(/DELETE FROM \w+[\s\S]{0,120}expires_at\s*<\s*now\(\)/u);
    }
  });

  it('만료된 것은 목록에서만 빠진다', () => {
    for (const src of [strategyRepo, savedRepo]) {
      expect(src, '목록이 만료를 걸러내지 않는다').toMatch(/expires_at IS NULL OR expires_at > now\(\)/u);
    }
  });

  /*
     ★★★ **계약이 바뀌었다(2026-09-18 재지시).**

       처음에는 "고객이 직접 지운 것은 실제로 지운다" 였다. 개인정보 문서가
       "삭제할 때까지" 를 약속하고 있었기 때문이다. 그런데 운영 지시가 바뀌었다:
       "만료든 고객이 삭제하든 우리 서버에는 항상 저장되어야 해. 우리가 다 학습시킬 거야."

     ★ 그래서 **삭제도 표시만 한다**(`deleted_at`). 고객 화면에서는 즉시 사라지고
       서버에는 남는다. 개인정보 문서 §6 도 그렇게 고쳤다(v1.5) — 문서와 동작이
       어긋나면 안 된다.
     ★★ **거래소 API 키는 예외다.** 그 검사는 `retain-and-timeframes.test.ts` 에 있다.
  */
  it('고객이 지운 것도 서버에는 남는다', () => {
    expect(strategyRepo, '규칙을 실제로 지운다 — 학습 자료가 사라진다')
      .toMatch(/UPDATE user_strategies SET deleted_at = now\(\)/u);
    expect(savedRepo, '저장 항목을 실제로 지운다')
      .toMatch(/UPDATE saved_items SET deleted_at = now\(\)/u);
  });

  /*
     ★★★ **약관 자기모순을 없앤다.**
       개인정보 문서가 "저장한 분석·그림·지표 세트 — 삭제할 때까지" 라고 적고 있었다.
       그런데 100일 뒤 화면에서 사라진다 — 고객이 지우지 않았는데 못 보게 된다.
       법 해석과 무관하게 **우리 문서가 우리 동작과 다른 것**이 문제다.
  */
  it('개인정보 문서가 100일과 보관을 밝힌다', () => {
    const files = readdirSync(join(ROOT, 'docs/legal')).filter((f) => /^privacy-(en|ja|zh)\.md$/u.test(f));
    expect(files.length, '개인정보 문서가 3개가 아니다').toBe(3);
    for (const f of files) {
      const s = readFileSync(join(ROOT, 'docs/legal', f), 'utf8');
      expect(s, `${f}: 저장물 보관기간이 '삭제할 때까지' 로 남아 있다`)
        .toMatch(/100 (days|天)|100日/u);
      /* 대화도 학습 대상임을 밝혀야 한다 — 문서에 없던 항목이다. */
      expect(s, `${f}: AI 대화 보관·학습을 밝히지 않는다`)
        .toMatch(/AI (assistant|アシスタント)|AI 助手/u);
    }
  });
});

describe('종료 확인창이 모르는 레버리지를 적지 않는다', () => {
  const app = read('src/app.jsx');

  /*
     ★★★ 운영자: "1×이거 주문 클로즈할 때 무조건 레버리지가 1로 나오는 것 같은데?
       아무튼 난 1이 아닌데."

       종료 경로가 값이 없으면 1 을 넘긴다(reduceOnly 에서 안전한 값). 그런데 확인창이
       그 1 을 **"1× · 표준 범위"** 로 적었다 — 30배로 들어간 고객에게 1배라고 말한다.
     ★ KuCoin 은 크로스 포지션에 `realLeverage` 를 주지 않는다.
  */
  it('모른다는 사실을 함께 보낸다', () => {
    expect(app, '레버리지를 모른다는 표시가 없다')
      .toMatch(/leverageUnknown: !\(Number\(pos\.leverage\) > 0\)/u);
  });

  it('모르면 검사 줄을 넣지 않는다', () => {
    /* ★ 종료는 레버리지를 정하는 행위가 아니다. 없는 줄이 틀린 줄보다 낫다. */
    expect(app, '모를 때도 레버리지를 적는다')
      .toMatch(/if \(!order\.leverageUnknown\) \{[\s\S]{0,400}risk_leverage/u);
  });

  it('아는 값은 그대로 보여준다', () => {
    /* 고배율 경고가 필요할 수 있다. */
    expect(app, '고배율 경고가 사라졌다').toMatch(/leverage > 50 \? 'warn' : 'ok'/u);
  });
});

describe('차트와 포지션 패널의 손익%가 같다', () => {
  const live = read('src/chart-overlay-live.js');
  const widgets = read('src/widgets.jsx');

  /*
     ★★★ 운영자: "현재 포지션 차트에 나오는 거랑 포지션 패널에 나오는 거랑 +-%가
       조금 다른데 왜 그럴까?"

       차트는 `가격 변동% × 레버리지`, 패널은 `평가손익 ÷ 증거금` 을 썼다.
       어긋나는 이유: 거래소 손익에는 **수수료·펀딩비**가 들어 있고, 부분 체결·승수
       때문에 `진입가 × 수량 ÷ 레버리지` 가 실제 증거금과 다르다.
     ★ **거래소가 준 값이 사실이다.**
  */
  it('차트가 실제 손익÷증거금으로 계산한다', () => {
    const i = live.indexOf("if (live.kind === 'position')");
    const body = live.slice(i, i + 2600);
    expect(body, 'ROE 를 손익÷증거금으로 계산하지 않는다')
      .toMatch(/\(pn \/ mg\) \* 100/u);
    /* 값이 없을 때만 옛 방식으로 근사한다. */
    expect(body, '대체 경로가 없다').toMatch(/chg \* lev/u);
    /* ★ 1배로 가정해 손실을 작게 보여주지 않는다. */
    expect(body, '모를 때도 ROE 를 적는다').toMatch(/roePct === null \? '' :/u);
  });

  it('패널과 같은 근거를 쓴다', () => {
    expect(widgets, '패널이 손익÷증거금을 쓰지 않는다')
      .toMatch(/const roe = marginBase === null \? null : \(pnl \/ marginBase\) \* 100/u);
  });

  it('차트의 금액과 %가 서로 맞는다', () => {
    /* ★ 근사 금액도 위에서 정한 ROE 와 같은 근거를 써야 한다. */
    expect(live, '근사 금액이 다른 근거를 쓴다').toMatch(/const approx = margin \* roePct \/ 100/u);
  });
});

describe('히스토리에 실현손익이 나온다', () => {
  const widgets = read('src/widgets.jsx');

  /*
     ★★★ 운영자: "오더히스토리랑 트레이드 히스토리에 +- % 랑 다 나와야 하는 거 아닌가?"

     ★ 거래소는 **체결(fill)에 손익을 주지 않는다.** 손익은 포지션이 닫힐 때 확정되고
       원장(`REALIZED_PNL`)에만 있다. 체결을 짝지어 우리가 계산하면 거래소 값과
       어긋나고, 고객은 어느 쪽을 믿어야 할지 알 수 없다(이 파일의 기존 주석과 같은 원칙).
     ★ 그래서 **계산하지 않고 원장 값을 맞춰 보여준다.**
  */
  it('원장에서 실현손익을 찾아 보여준다', () => {
    expect(widgets, '실현손익 열이 없다').toMatch(/col_realized_pnl/u);
    expect(widgets, '원장을 보지 않는다').toMatch(/x\.kind === 'REALIZED_PNL'/u);
    expect(widgets, '종목을 맞추지 않는다')
      .toMatch(/String\(x\.symbol \|\| ''\)\.toUpperCase\(\) === String\(f\.symbol \|\| ''\)\.toUpperCase\(\)/u);
  });

  it('시간 창을 좁게 잡는다', () => {
    /* ★★ 창을 넓게 잡으면 **다른 거래의 손익이 붙는다** — 그것이 가장 나쁘다. */
    expect(widgets, '시간 창이 없거나 넓다')
      .toMatch(/Math\.abs\(Number\(x\.time\) - Number\(f\.time\)\) <= 10_000/u);
  });

  it('맞는 것이 없으면 비운다', () => {
    /* ★ 진입 체결에는 손익이 없다 — 그때는 아직 확정된 것이 없다. */
    expect(widgets, '없을 때 0 을 보여준다').toMatch(/rp === null \? '—'/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('col_side')) continue;
      if (!s.includes('col_realized_pnl')) missing.push(f);
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});
