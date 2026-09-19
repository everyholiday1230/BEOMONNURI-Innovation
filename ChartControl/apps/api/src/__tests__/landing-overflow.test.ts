/*
   비로그인 첫 화면이 **옆으로 밀리지 않는** 것을 잠근다.

   ★★★ 실측(2026-09-19, 프로덕션): 폭 390px 데스크톱 창에서 랜딩이 168px 가로
     스크롤됐다. 밀린 쪽은 빈 검은 화면이다. 원인은 요금제 비교표
     (`table.landing-cmp`, min-width 560px)가 `document.scrollWidth` 를 558 로
     늘린 것이었다.

   ★★ 래퍼에 `overflow-x: auto` 가 **이미 있었는데도** 그랬다. 후보를 전부 실제로
     적용해 측정한 결과 `contain: paint` 만 효과가 있었다:
        max-width:100% → 558 · width:100% → 558 · html,body overflow-x:clip → 558
        caption 숨김 → 558 · table min-width 제거 → 390 이지만 표가 찌그러진다
        contain: paint → 390, 표는 560px 유지 + 내부 스크롤  ✔

   ★ 이 증상은 **모바일 에뮬레이션에서 안 나타난다**(meta viewport 가 감춘다).
     기존 `mobile-clip-check` 가 `/` 를 검사하는데도 놓친 이유다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('랜딩 요금제 비교표가 페이지를 밀지 않는다', () => {
  const css = read('src/landing-extra.css');

  /** `.landing-cmp__wrap { ... }` 블록 안쪽만 잘라낸다 (옆 규칙까지 덮으면 헛통과한다). */
  function wrapBlock(): string {
    const i = css.indexOf('.landing-cmp__wrap {');
    expect(i, '.landing-cmp__wrap 규칙이 없다').toBeGreaterThan(-1);
    let depth = 0;
    for (let j = css.indexOf('{', i); j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') { depth -= 1; if (depth === 0) return css.slice(i, j + 1); }
    }
    throw new Error('중괄호가 닫히지 않았다');
  }

  /*
     ★★★ **주석을 지우고 본다.** 이 규칙의 설명 주석 안에 `contain: paint` 라는
       글자가 들어 있어서, 그냥 찾으면 **선언을 지워도 주석이 통과시킨다** —
       실제로 역검증에서 그렇게 헛통과했다. 이 저장소에서 반복되는 함정이다.
  */
  const stripComments = (x: string) => x.replace(/\/\*[\s\S]*?\*\//gu, '');

  it('래퍼가 페이지 폭을 지킨다', () => {
    const b = stripComments(wrapBlock());
    expect(b, 'contain: paint 가 없으면 페이지가 옆으로 밀린다').toMatch(/contain:\s*paint/u);
    /* ★ 내부 가로 스크롤도 함께 있어야 한다 — 없으면 표가 잘려 읽을 수 없다. */
    expect(b, '내부 가로 스크롤이 없으면 표가 잘린다').toMatch(/overflow-x:\s*auto/u);
  });

  /*
     ★★ 표를 찌그러뜨리는 것으로 "고치면" 비교가 불가능해진다. min-width 를 지킨다.
       (측정: min-width 제거 시 표가 560 → 380px)
  */
  it('표의 최소 폭을 지킨다', () => {
    const i = css.indexOf('.landing-cmp {');
    expect(i, '.landing-cmp 규칙이 없다').toBeGreaterThan(-1);
    const b = stripComments(css.slice(i, css.indexOf('}', i) + 1));
    expect(b, '최소 폭이 없으면 좁은 화면에서 표가 찌그러진다').toMatch(/min-width:\s*(5[0-9]{2}|[6-9][0-9]{2})px/u);
  });

  it('왜 이렇게 고쳤는지 기록돼 있다', () => {
    /* ★ 근거가 없으면 다음 사람이 "auto 있으니 contain 은 군더더기" 라며 지운다. */
    expect(css, '다른 방법이 통하지 않았다는 측정 기록이 없다')
      .toMatch(/다른 방법은 듣지 않았다/u);
    expect(css, '접근성 부작용 확인 기록이 없다').toMatch(/접근성 트리에 그대로 남는다/u);
  });
});

describe('좁은 데스크톱 창을 검사한다', () => {
  const tool = read('tools/mobile-clip-check.mjs');

  /*
     ★★★ 사각지대였다. 이 도구는 `/` 를 검사 목록에 넣고 있었지만 전부
       `isMobile: true` 로 돌았고, 모바일 에뮬레이션은 페이지 가로 스크롤을
       감춘다. 그래서 168px 밀리는 것을 한 번도 잡지 못했다.
  */
  it('isMobile 없이 좁은 폭을 한 번 더 본다', () => {
    expect(tool, '좁은 데스크톱 검사가 없다').toMatch(/좁은 \*\*데스크톱\*\* 창에서 페이지가 옆으로 밀리는지/u);
    expect(tool, '공개 라우트 목록이 없다').toMatch(/PUBLIC_ROUTES/u);
    expect(tool, '여러 폭을 보지 않는다').toMatch(/const WIDTHS = \[/u);
  });

  /*
     ★★ 판정을 `scrollWidth` 비교로 하면 내부 스크롤 컨테이너 때문에 오탐이 난다.
       **실제로 밀리는가**(scrollTo 후 scrollX)로 판정해야 한다.
  */
  it('실제로 밀리는지로 판정한다', () => {
    const i = tool.indexOf('좁은 **데스크톱** 창에서');
    const block = tool.slice(i, i + 3400);
    expect(block, 'scrollX 로 판정하지 않는다').toMatch(/window\.scrollX/u);
    expect(block, '원인 요소를 알려주지 않는다').toMatch(/culprit/u);
  });

  it('밀리면 실패로 센다', () => {
    const i = tool.indexOf('좁은 **데스크톱** 창에서');
    const block = tool.slice(i, i + 3400);
    expect(block, '경고로만 남기면 아무도 고치지 않는다').toMatch(/failures \+= hits\.length/u);
  });
});
