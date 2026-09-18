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

describe('규칙이 새로고침 뒤에도 남는다 (자동 저장)', () => {
  const inds = read('src/chart-indicators.jsx');

  /*
     ★★★ **자동 저장이 지표 패널에서만 돌았다.** 그래서 AI 나 `ChartKlineUtil` 로 규칙을
       만들어도 저장되지 않았고 **새로고침하면 사라졌다**(실측: localStorage 에 저장본이
       아예 없었다). 지표는 남고 규칙만 없어지는 것은 일관되지 않다 —
       "켠 것은 계정에 남는다" 는 원칙이 이미 있다.
  */
  it('규칙을 추가·제거하면 자동 저장이 돈다', () => {
    expect(inds, '규칙 전용 저장 함수가 없다').toMatch(/window\.QTSaveSignalRules = function/u);
    expect(kline, '규칙 추가 시 저장하지 않는다')
      .toMatch(/_signalRules\.set[\s\S]{0,400}QTSaveSignalRules\(\)/u);
    expect(kline, '규칙 제거 시 저장하지 않아 새로고침에 되살아난다')
      .toMatch(/_signalRules\.delete[\s\S]{0,300}QTSaveSignalRules\(\)/u);
  });

  it('저장본은 전체 상태다 — 규칙만 담지 않는다', () => {
    /*
       ★ 규칙만 바뀌었어도 지표 이름·배치를 다시 읽어 함께 담아야 한다. 일부만 담으면
         다음 복원에서 지표가 사라진다.
    */
    const i = inds.indexOf('window.QTSaveSignalRules');
    const body = inds.slice(i, i + 1400);
    expect(body, '지표를 다시 읽지 않는다').toMatch(/listIndicators\(\)/u);
    expect(body, '기기 저장을 하지 않는다').toMatch(/saveAutoLocal\(names, panes, rules\)/u);
    expect(body, '서버 저장을 하지 않는다').toMatch(/saveAutoServer\(names, panes, rules\)/u);
    /* ★ SIG_ 는 이름으로 저장하지 않는다 — 식으로 복원한다. */
    expect(body, 'SIG_ 를 이름으로 저장한다').toMatch(/nm\.startsWith\('SIG_'\)/u);
  });

  it('기기·서버 저장 모두 규칙을 담는다', () => {
    expect(inds, '기기 저장에 규칙이 없다').toMatch(/signalRules: Array\.isArray\(rules\)/u);
    expect(inds, '서버 payload 에 규칙이 없다').toMatch(/payload: \{ indicators: names, panes: panes, auto: true, signalRules: signalRules \}/u);
    /* ★ 규칙만 바뀌었을 때도 저장되도록 서명에 넣는다. */
    expect(inds, '규칙이 저장 서명에 없어 규칙만 바뀌면 저장을 건너뛴다')
      .toMatch(/const sig = JSON\.stringify\(\{ names: names, panes: panes, signalRules: signalRules \}\)/u);
  });

  it('복원은 식으로 다시 등록한다 — 같은 이름은 중복하지 않는다', () => {
    expect(inds, '규칙 복원 함수가 없다').toMatch(/function applySavedSignalRules\(rules\)/u);
    const i = inds.indexOf('function applySavedSignalRules');
    const body = inds.slice(i, i + 1400);
    expect(body, 'addSignalRule 로 등록하지 않는다').toMatch(/U\.addSignalRule\(\{/u);
    expect(body, '이미 있는 규칙을 다시 넣어 두 번 그린다').toMatch(/have\.has\(r\.name\)/u);
    /* ★ 실패를 완전히 삼키지 않는다 — 원인을 모르면 고칠 수 없다. */
    expect(body, '복원 실패를 로그로도 남기지 않는다').toMatch(/console\.warn/u);
  });

  it('옛 저장본을 읽을 때 터지지 않는다', () => {
    expect(inds, '옛 기기 저장본 방어가 없다')
      .toMatch(/if \(!Array\.isArray\(raw\.signalRules\)\) raw\.signalRules = \[\]/u);
    expect(inds, '옛 서버 저장본 방어가 없다')
      .toMatch(/signalRules: Array\.isArray\(payload\.signalRules\) \? payload\.signalRules : \[\]/u);
  });
});

describe('저장 목록 화면', () => {
  const more = read('src/pages-more.jsx');
  const app = read('src/app.jsx');

  it('신호 규칙 종류를 고를 수 있다', () => {
    expect(more, 'signal 종류가 없다').toMatch(/<option value="signal">/u);
  });

  /*
     ★★★ 예전에는 `config: {}` 를 보냈다 — 저장은 되는데 규칙이 비어 있어서
       **불러와도 아무것도 안 나온다.**
  */
  it('규칙 식을 저장한다 — 빈 config 를 보내지 않는다', () => {
    expect(more, '식을 config 에 담지 않는다').toMatch(/config = \{ rule: expr/u);
    expect(more, '식이 없어도 저장한다').toMatch(/us_rule_required/u);
  });

  /*
     ★★ 포인트가 차감된 뒤 틀린 식을 알게 되면 고객은 돈을 내고 못 쓰는 것을 갖는다.
  */
  it('저장 전에 식을 검증한다', () => {
    const i = more.indexOf('const create = async');
    const body = more.slice(i, more.indexOf('const remove = async', i));
    expect(body, '저장 전 파싱을 하지 않는다').toMatch(/F\.parse\(expr\)/u);
    expect(body, '검증 실패를 알리지 않는다').toMatch(/us_rule_invalid/u);
    /*
       검증이 차감보다 먼저여야 한다.

       ★ `createUserStrategy` 는 위쪽 가드 문장(`if (!api || !api.createUserStrategy)`)
         에도 나온다. 그것과 비교하면 항상 실패한다(실제로 그렇게 틀렸다).
         **실제 호출 지점**과 비교한다.
    */
    expect(body.indexOf('F.parse(expr)'), '차감 뒤에 검증한다')
      .toBeLessThan(body.indexOf('api.createUserStrategy({'));
  });

  it('저장된 식을 목록에 보여준다', () => {
    expect(more, '식을 보여주지 않아 무엇을 저장했는지 알 수 없다')
      .toMatch(/it\.config\.rule/u);
  });

  /*
     ★ 이 화면에는 차트가 없다. 규칙을 넘겨 두고 차트로 보낸다.
       URL 에 담지 않는다 — 식이 길고, 주소창에 남아 공유될 때 의도치 않게 적용된다.
  */
  it('차트에서 열기가 규칙을 넘긴다', () => {
    expect(more, '넘기는 동작이 없다').toMatch(/sessionStorage\.setItem\('qt\.pendingSignalRule'/u);
    expect(more, '차트로 이동하지 않는다').toMatch(/window\.location\.hash = '#\/trade'/u);
  });

  it('차트가 넘겨받아 적용하고 한 번만 쓴다', () => {
    expect(app, '차트가 대기 규칙을 읽지 않는다')
      .toMatch(/sessionStorage\.getItem\('qt\.pendingSignalRule'\)/u);
    /*
       ★★ **한 번만 적용하고 지운다.** 남겨 두면 이후 모든 차트 진입에서 다시 붙어,
         고객이 지웠는데 되살아나는 것으로 보인다.
    */
    expect(app, '대기값을 지우지 않아 매번 다시 붙는다')
      .toMatch(/sessionStorage\.removeItem\('qt\.pendingSignalRule'\)/u);
    /* 지우는 것이 적용보다 먼저여야 한다 — 적용이 실패해도 무한 반복되지 않는다. */
    const i = app.indexOf("sessionStorage.getItem('qt.pendingSignalRule')");
    const body = app.slice(i, i + 900);
    expect(body.indexOf('removeItem'), '적용 뒤에 지운다 — 실패하면 매번 반복된다')
      .toBeLessThan(body.indexOf('addSignalRule'));
  });

  it('문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const KEYS = ['us_kind_signal', 'us_rule_ph', 'us_direction', 'us_dir_none',
      'us_rule_required', 'us_rule_invalid', 'us_rule_examples', 'us_open_in_chart'];
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s2 = readFileSync(join(dir, f), 'utf8');
      if (!s2.includes('us_kind_indicator')) continue;
      for (const k of KEYS) if (!s2.includes(k)) missing.push(`${f} ${k}`);
    }
    expect(missing, `문구가 빠진 사전:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('차트에서 규칙을 저장한다', () => {
  const copilot = read('src/ai-copilot.jsx');
  const more = read('src/pages-more.jsx');

  /*
     ★★★ 운영자: "그 트레이드탭에서 저장해야 하는 거 아닌가?" **맞다.**
       규칙은 차트에서 대화로 만들어진다. 그런데 저장은 다른 화면에서 **식을 다시
       타이핑**해야 했다. AI 가 만들어 준 식을 사람이 옮겨 적는 것은 앞뒤가 바뀐 것이다.
  */
  it('규칙을 만든 대화에서 바로 저장할 수 있다', () => {
    expect(copilot, '규칙 저장 종류가 없다').toMatch(/kind: 'signal-rule'/u);
    const i = copilot.indexOf("const isRule = ev.command.command === 'addSignalRule'");
    expect(i, '규칙 명령을 구분하지 않는다').toBeGreaterThan(-1);
    const body = copilot.slice(i, i + 700);
    /* ★ 식이 없으면 불러와도 아무것도 안 나온다. */
    expect(body, '식을 담지 않는다').toMatch(/rule: String\(a\.rule\)/u);
    /* ★ 이름은 고객이 지은 규칙 이름 — 도구 결과 문구를 쓰면 목록이 다 비슷해진다. */
    expect(body, '규칙 이름을 쓰지 않는다').toMatch(/name: String\(a\.name\)/u);
  });

  /*
     ★★★ 저장 장치가 두 개다: `savedCreate`(저장된 항목)와 `createUserStrategy`(내 규칙).
       규칙을 저장된 항목에 넣으면 **내 규칙 화면에 안 나온다** — 고객이 찾아보는
       화면은 내 규칙이다.
  */
  it('규칙은 내 규칙 쪽으로 저장된다', () => {
    const i = copilot.indexOf("if (savable.kind === 'signal-rule') {");
    expect(i, '종류별 분기가 없다').toBeGreaterThan(-1);
    const body = copilot.slice(i, i + 900);
    expect(body, 'createUserStrategy 를 쓰지 않는다').toMatch(/api\.createUserStrategy\(\{/u);
    expect(body, "kind 를 signal 로 보내지 않는다").toMatch(/kind: 'signal'/u);
    expect(body, 'config 에 식을 담지 않는다').toMatch(/config: savable\.payload/u);
  });

  it('가드가 규칙 저장을 막지 않는다', () => {
    /*
       ★ 예전 가드는 `savedCreate` 하나만 봤다. 신호 규칙은 `createUserStrategy` 를
         쓰므로 그 가드에서 **조용히 막혔다.**
    */
    expect(copilot, '종류에 맞는 API 를 보지 않는다')
      .toMatch(/savable\.kind === 'signal-rule' \? api\.createUserStrategy : api\.savedCreate/u);
    expect(copilot, 'savedCreate 를 무조건 요구한다')
      .not.toMatch(/if \(!api \|\| !api\.savedCreate \|\| !savable\) return;/u);
  });

  /*
     ★★★ **이름만 저장하고 포인트를 받는 종류가 있었다.**
       `strategy` 300점 · `indicator` 100점인데 `config` 가 비어 있어 불러올 것이 없다.
       운영자가 직접 겪었다 — 이름 "d" 로 저장했더니 이름만 남았다.
       포인트를 받으면서 아무 일도 하지 않는 것이 가장 나쁘다.
  */
  it('아무것도 안 되는 종류를 팔지 않는다', () => {
    const i = more.indexOf("<select aria-label={t('a11y_kind')}");
    const body = more.slice(i, more.indexOf('</select>', i));
    expect(body, 'strategy 를 여전히 팔고 있다').not.toMatch(/value="strategy"/u);
    expect(body, 'indicator 를 여전히 팔고 있다').not.toMatch(/value="indicator"/u);
    expect(body, 'signal 이 없다').toMatch(/value="signal"/u);
  });

  it('기본값이 실제로 동작하는 종류다', () => {
    /* ★ 예전 기본값(`strategy`)은 이름만 저장했다 — 처음 쓰는 사람이 그것을 고른다. */
    expect(more, '기본값이 signal 이 아니다').toMatch(/React\.useState\(\{ kind: 'signal'/u);
  });

  it('차트에서 만드는 길을 안내한다', () => {
    expect(more, '차트로 가는 안내가 없다').toMatch(/us_chart_hint/u);
    expect(more, '차트로 가는 버튼이 없다').toMatch(/window\.location\.hash = '#\/trade'/u);
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s2 = readFileSync(join(dir, f), 'utf8');
      if (!s2.includes('us_kind_signal')) continue;
      for (const k of ['us_chart_hint', 'us_go_chart']) if (!s2.includes(k)) missing.push(`${f} ${k}`);
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('불러오는 곳은 하나다', () => {
  const copilot = read('src/ai-copilot.jsx');

  /*
     ★★★ 운영자: "저장을 두 개로 나누는 게 너무 헷갈린다. save 는 어디서 불러오고
       마이룰에 저장한 건 어디서 불러와?" 정당한 지적이었다.

       저장소가 둘이면 **불러오는 곳도 둘**이 된다. Saved 는 차트 안에서 한 번 누르면
       되는데, 내 규칙은 다른 화면에 갔다 와야 했다 — 내가 규칙을 내 규칙으로 보내면서
       불러오기를 **더 불편하게** 만들었다.

     ★ 저장 위치는 그대로 둔다(규칙은 만료 없는 곳). **보이는 곳만 합친다.**
       고객에게 중요한 것은 "어디에 들어갔는지" 가 아니라 "어디서 다시 꺼내는지" 다.
  */
  it('차트 목록이 내 규칙도 함께 읽는다', () => {
    expect(copilot, '내 규칙을 읽지 않는다').toMatch(/api\.myUserStrategies\('signal'\)/u);
    expect(copilot, '두 목록을 함께 기다리지 않는다').toMatch(/Promise\.all\(\[api\.savedList\(\), rulesP\]\)/u);
    /* ★ 규칙 조회가 실패해도 Saved 목록은 보여준다 — 하나 때문에 둘 다 못 보게 하지 않는다. */
    expect(copilot, '규칙 조회 실패가 목록 전체를 막는다').toMatch(/myUserStrategies\('signal'\)[\s\S]{0,140}catch\(\(\) => \[\]\)/u);
  });

  it('식이 없는 옛 항목은 목록에 넣지 않는다', () => {
    /* ★ 불러와도 아무것도 안 되는 항목을 보여주면 눌러보고 고장으로 오해한다. */
    expect(copilot, '식 없는 항목을 걸러내지 않는다')
      .toMatch(/\.filter\(\(x\) => x && x\.config && x\.config\.rule\)/u);
  });

  it('규칙은 식으로 되살린다', () => {
    const i = copilot.indexOf('if (it.__rule) {');
    expect(i, '규칙 분기가 없다').toBeGreaterThan(-1);
    const body = copilot.slice(i, i + 700);
    /* ★ payload 적용이 아니다 — 새로고침하면 지표 등록이 사라지므로 다시 등록해야 한다. */
    expect(body, 'addSignalRule 로 되살리지 않는다').toMatch(/U\.addSignalRule\(\{/u);
    expect(body, '방향을 옮기지 않는다').toMatch(/it\.__rule\.direction/u);
  });

  it('규칙은 이 목록에서 지우지 않는다', () => {
    /*
       ★ 다른 저장소다. 여기서 `savedDelete` 를 부르면 **없는 항목을 지우려 해
         아무 일도 안 일어난다** — 고장으로 보인다.
    */
    expect(copilot, '규칙에도 지우기 버튼이 붙는다')
      .toMatch(/it\.__rule \? null : \(/u);
  });

  /*
     ★★★ Saved 는 30일 뒤 사라지고 내 규칙은 안 사라진다. 같은 목록에 섞어 놓고
       그 차이를 안 알려주면 **"저장한 게 없어졌다"** 고 생각한다.
  */
  it('만료가 있는 것과 없는 것을 구별해 보여준다', () => {
    expect(copilot, '규칙 배지가 없다').toMatch(/it\.__rule \? t\('sv_badge_rule'\)/u);
    expect(copilot, '만료 여부를 설명하지 않는다')
      .toMatch(/it\.__rule \? t\('sv_badge_rule_hint'\) : t\('sv_badge_saved_hint'\)/u);
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s2 = readFileSync(join(dir, f), 'utf8');
      if (!s2.includes('sv_kind_signal')) continue;
      for (const k of ['sv_badge_rule', 'sv_badge_rule_hint', 'sv_badge_saved_hint']) {
        if (!s2.includes(k)) missing.push(`${f} ${k}`);
      }
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});
