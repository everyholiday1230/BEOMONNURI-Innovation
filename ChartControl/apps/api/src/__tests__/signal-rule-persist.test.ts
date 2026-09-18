import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
   **신호 규칙 저장·불러오기** — 운영자 요청: "AI로 만든 거 저장이랑 다시 불러오는 것도."

   ★★★ 왜 특별한 처리가 필요한가

     신호 규칙은 우리가 런타임에 `registerIndicator` 로 만든 지표다. 그래서:
       · **DSL 식이 계산 클로저 안에만 있다.** `chart.getIndicators()` 로는
         `SIG_MACD_______U9NTX` 라는 키만 보이고 규칙을 복원할 수 없다
       · **새로고침하면 등록이 사라진다.** 저장본에 `SIG_*` 를 일반 지표로 적어 두면
         복원할 때 등록되지 않은 이름으로 `createIndicator` 를 부르게 되어 조용히 실패한다

     그래서 두 가지를 한다:
       ① `ChartKlineUtil` 이 **장부**(`_signalRules`)에 이름·식·방향을 기억한다
       ② 템플릿 저장에서 `SIG_*` 를 일반 지표 목록에서 **빼고**, `signalRules` 로
          따로 담아 복원 시 `addSignalRule` 로 다시 등록한다

   브라우저 실측(2026-09-18): 규칙 2개 저장 → **진짜 새로고침**(등록 소실 확인: 규칙 [])
     → 복원 2/2 성공, 22건·62건 재계산, pageerror 0.
*/

const ROOT = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const kline = read('src/chart-kline.jsx');
const settings = read('src/chart-settings.jsx');

describe('규칙 장부', () => {
  /*
     ★★★ 장부가 없으면 **저장할 것이 없다.** 차트는 DSL 식을 기억하지 않는다.
  */
  it('이름·식·방향을 기억한다', () => {
    expect(kline, '장부가 없다').toMatch(/_signalRules: new Map\(\)/u);
    expect(kline, '식을 기억하지 않는다')
      .toMatch(/_signalRules\.set\(name, \{ name, expression: expr, direction \}\)/u);
    expect(kline, '목록을 내보내지 않는다').toMatch(/listSignalRules\(\)/u);
  });

  it('성공한 규칙만 기억한다', () => {
    /*
       ★ 실패한 것을 남기면 복원이 그리지 못하는 규칙을 되살리려 하고 매번 실패한다.
    */
    expect(kline, '실패한 규칙도 장부에 넣는다').toMatch(/if \(applied\) this\._signalRules\.set/u);
  });

  it('제거하면 장부에서도 지운다', () => {
    /* ★ 남겨 두면 저장본에 없는 규칙이 되살아난다. */
    const i = kline.indexOf('removeSignalRule(name) {');
    expect(i, 'removeSignalRule 이 없다').toBeGreaterThan(0);
    const body = kline.slice(i, i + 700);
    expect(body, '장부에서 지우지 않는다').toMatch(/_signalRules\.delete/u);
  });
});

describe('템플릿 저장', () => {
  /*
     ★★★ `SIG_*` 를 일반 지표로 저장하면 **불러올 때 조용히 실패한다.**
       새로고침 후에는 그 이름이 등록돼 있지 않다.
  */
  it('SIG_ 지표를 일반 지표 목록에서 뺀다', () => {
    expect(settings, 'SIG_ 를 걸러내지 않는다')
      .toMatch(/\.filter\(\(i\) => !String\(i\.name \|\| ''\)\.startsWith\('SIG_'\)\)/u);
  });

  it('규칙을 식과 함께 따로 담는다', () => {
    expect(settings, 'capture 가 규칙을 담지 않는다').toMatch(/listSignalRules\(\)/u);
    expect(settings, '서버 payload 에 규칙이 없다').toMatch(/signalRules: Array\.isArray\(item\.signalRules\)/u);
    /* ★ 옛 저장본에는 없다 — 빈 배열로 읽어야 한다. */
    expect(settings, '옛 저장본을 읽을 때 방어가 없다')
      .toMatch(/signalRules: Array\.isArray\(p\.signalRules\) \? p\.signalRules : \[\]/u);
  });
});

describe('템플릿 복원', () => {
  it('addSignalRule 로 다시 등록한다 — createIndicator 로는 안 된다', () => {
    const i = settings.indexOf('const doApply');
    expect(i, 'doApply 를 찾지 못했다').toBeGreaterThan(0);
    const body = settings.slice(i, settings.indexOf('const doDelete', i));
    expect(body, '규칙을 다시 등록하지 않는다').toMatch(/U\.addSignalRule\(\{/u);
    expect(body, '식을 넘기지 않는다').toMatch(/expression: r\.expression/u);
    /* ★ 방향은 있을 때만 넘긴다 — 없는 방향을 채우면 우리가 방향을 발신한 것이 된다. */
    expect(body, '방향이 없을 때도 넘긴다')
      .toMatch(/\.\.\.\(r\.direction \? \{ direction: r\.direction \} : \{\}\)/u);
  });

  it('적용 전에 지금 규칙을 치운다 — 템플릿이 곧 상태다', () => {
    const i = settings.indexOf('const doApply');
    const body = settings.slice(i, settings.indexOf('const doDelete', i));
    expect(body, '기존 규칙을 치우지 않아 겹친다').toMatch(/U\.removeSignalRule\(cur\.name\)/u);
  });

  /*
     ★★★ 복원 실패를 **조용히 넘기지 않는다.** 식이 옛 문법이거나 함수가 사라졌으면
       복원되지 않는데, 아무 말도 없으면 고객은 규칙이 살아 있다고 믿는다.
  */
  it('복원 실패 개수를 세어 알린다', () => {
    const i = settings.indexOf('const doApply');
    const body = settings.slice(i, settings.indexOf('const doDelete', i));
    expect(body, '성공·실패를 세지 않는다').toMatch(/ruleFail/u);
    expect(body, '실패가 있어도 성공이라고 말한다')
      .toMatch(/ruleFail > 0[\s\S]{0,200}template_rules_partial/u);
    expect(body, "실패 시에도 variant 가 success 다").toMatch(/variant: 'warning'/u);
  });

  it('안내 문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('template_applied')) continue;
      if (!s.includes('template_rules_partial')) missing.push(f);
    }
    expect(missing, `문구가 빠진 사전:\n${missing.join('\n')}`).toEqual([]);
  });
});
