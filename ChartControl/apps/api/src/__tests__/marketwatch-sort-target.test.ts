import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
   **마켓와치 정렬 헤더의 클릭 영역.**

   운영자 보고: "마켓와치에서 24h 부분이 잘 클릭이 안 되는 것 같다."

   원인은 `.mw-sort { padding: 0 }` 이었다. 누를 수 있는 곳이 글자 상자뿐이어서
   브라우저 실측이 이렇게 나왔다:

     수정 전   24h  18   × 14.5 = 261 px²   ← WCAG 2.5.8(AA) 최소 24×24 미달
     수정 후   24h  30   × 24.5 = 735 px²   ← 충족 (2.8배)

   `24h` 가 특히 작았던 이유가 둘 있다.
     ① 라벨이 3글자다(가격·거래대금은 더 길다).
     ② **정렬 중이 아닐 때는 화살표가 없다.** 한 번 눌러 정렬이 켜지면 ` ↓` 가 붙어
        넓어진다 — 될 때와 안 될 때가 달라 "잘 안 된다" 로 느껴진다.

   ★ 글꼴을 키워 해결하지 않는다. 헤더가 작아야 시세 목록이 많이 보인다.
     **글자는 그대로 두고 여백으로만 넓힌다.**
*/

const ROOT = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** 규칙 본문만 떼어 온다 — 다른 규칙의 선언이 섞이면 검사가 헛돈다. */
function ruleBody(css: string, selector: string): string {
  const i = css.indexOf(selector + ' {');
  if (i < 0) return '';
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('마켓와치 정렬 헤더는 누를 수 있을 만큼 크다', () => {
  it('.mw-sort 가 글자 상자보다 큰 클릭 영역을 가진다', () => {
    const css = read('src/widgets.css');
    const body = ruleBody(css, '.mw-sort');
    expect(body, '.mw-sort 규칙을 찾지 못했다').not.toBe('');

    /* padding: 0 으로 되돌아가면 다시 글자만큼만 눌린다. */
    expect(body, 'padding 이 0 이다 — 글자 상자만 눌린다').not.toMatch(/padding:\s*0\s*[;}]/u);

    const pad = /padding:\s*([0-9]+)px\s+([0-9]+)px/u.exec(body);
    expect(pad, 'padding 을 px 로 주지 않았다').not.toBeNull();
    /* 세로 5px 이면 14.5 + 10 = 24.5 로 24 를 넘긴다. */
    expect(Number(pad![1]), '세로 여백이 작아 24px 높이에 못 미친다').toBeGreaterThanOrEqual(4);
    expect(Number(pad![2]), '가로 여백이 없다').toBeGreaterThanOrEqual(4);

    /*
       ★ 여백만으로는 부족할 수 있다(글꼴 토큰이 작아지면 다시 미달된다).
         하한을 못박는다.
    */
    const minH = /min-height:\s*([0-9]+)px/u.exec(body);
    expect(minH, 'min-height 하한이 없다').not.toBeNull();
    expect(Number(minH![1]), 'WCAG 2.5.8 최소 24px 에 못 미친다').toBeGreaterThanOrEqual(24);
  });

  it('음수 마진으로 넓히지 않는다 — 옆 열과 영역이 겹친다', () => {
    /*
       ★ 가격과 거래대금은 ` / ` 하나를 두고 **같은 칸**에 붙어 있다. 음수 마진으로
         넓히면 두 영역이 겹쳐 구분선 근처를 누를 때 엉뚱한 열이 정렬된다.
         padding 은 레이아웃을 밀어내므로 겹치지 않는다.
    */
    const body = ruleBody(read('src/widgets.css'), '.mw-sort');
    expect(body, '음수 마진으로 넓혔다 — 옆 열과 겹친다').not.toMatch(/margin:\s*-/u);
  });

  it('누를 수 있는 곳이 보인다', () => {
    /*
       ★ 전에는 hover 에 **글자색만** 바뀌어서 넓힌 영역이 눌리는지 알 수 없었다.
         영역 자체를 보여줘야 "여기를 누르면 된다" 를 알 수 있다.
    */
    const css = read('src/widgets.css');
    const hover = ruleBody(css, '.mw-sort:hover');
    expect(hover, 'hover 에 배경이 없다 — 넓힌 영역이 보이지 않는다').toMatch(/background:/u);
    /* 초점 표시는 키보드 사용자에게 필수다. 넓히면서 지우지 않았는지 본다. */
    expect(css, 'focus-visible 표시가 없다').toMatch(/\.mw-sort:focus-visible/u);
  });

  it('24h 열은 칸 전체가 눌린다 — 버튼이 하나뿐이라 가능하다', () => {
    const css = read('src/widgets.css');
    const fill = ruleBody(css, '.mw-sort--fill');
    expect(fill, '.mw-sort--fill 규칙이 없다').not.toBe('');
    expect(fill, '칸을 채우지 않는다').toMatch(/width:\s*100%/u);
    expect(fill, '블록으로 만들지 않아 width 100% 가 듣지 않는다').toMatch(/display:\s*block/u);
    /* 칸을 채우면 글자가 왼쪽으로 가므로 오른쪽 정렬을 다시 준다. */
    expect(fill, '오른쪽 정렬이 없다 — 숫자 열과 어긋난다').toMatch(/text-align:\s*right/u);

    const jsx = read('src/widgets.jsx');
    /*
       ★★ 24h 헤더에 **실제로** fill 이 붙어 있어야 한다. CSS 만 있고 안 붙이면
         아무 일도 일어나지 않는다.
    */
    expect(jsx, '24h 헤더에 fill 을 넘기지 않는다')
      .toMatch(/<Head k="chg" label="24h" fill\/>/u);
    expect(jsx, 'Head 가 fill 을 클래스로 반영하지 않는다')
      .toMatch(/fill \? ' mw-sort--fill' : ''/u);

    /*
       ★ 가격·거래대금에는 붙이면 안 된다 — 한 칸에 버튼이 둘이라 각각 100% 를
         차지하면 줄이 넘어가거나 서로를 덮는다.
    */
    expect(jsx, '가격 헤더에 fill 이 붙었다 — 한 칸에 버튼이 둘이다')
      .not.toMatch(/<Head k="price"[^/]*fill/u);
    expect(jsx, '거래대금 헤더에 fill 이 붙었다')
      .not.toMatch(/<Head k="vol"[^/]*fill/u);
  });

  it('헤더 여백을 줄여 상쇄한다 — 헤더만 두꺼워지면 목록이 밀린다', () => {
    const body = ruleBody(read('src/widgets.css'), '.mw-list-head');
    expect(body, '.mw-list-head 규칙을 찾지 못했다').not.toBe('');
    /*
       버튼이 위아래 5px 씩 가져갔으므로 헤더의 원래 여백(--sp-3 = 6px)을 줄인다.
       그러지 않으면 26.5 → 36px 가 되어 시세 한 줄이 사라진다.
    */
    expect(body, '헤더 여백을 줄이지 않아 헤더가 두꺼워진다')
      .toMatch(/padding-top:\s*var\(--sp-1\)/u);
    expect(body, '아래 여백도 줄여야 한다').toMatch(/padding-bottom:\s*var\(--sp-1\)/u);
  });
});
