/**
 * 수평선 도구 — 가격 입력을 **도구를 켤 때만** 보여준다.
 *
 * ★★ 무엇이 문제였나
 *
 *   가격 입력창(84px)과 추가 버튼이 툴바에 **항상** 있었다. 그래서 수평선 도구가
 *   두 개 있는 것처럼 보였다 — 3번째 아이콘(클릭해서 긋기)과 이 버튼(가격 넣어 긋기).
 *   실제로 운영자가 "뭐가 다르냐, 하나 지워라" 고 물었다.
 *
 *   그리고 좁은 화면에서 그 84px 때문에 도구 아이콘들이 밀렸다.
 *
 * ★ 기능은 지우지 않았다. 도구를 켜면 두 방법을 다 쓸 수 있다:
 *     · 차트를 클릭 → 그 자리에 (눈으로 찍기)
 *     · 가격을 입력 → 정확한 값에 (BTC 80,000 처럼)
 *   클릭으로는 정확한 값을 맞출 수 없다. 실측에서 방금 그린 선이
 *   78503.24188750003 이었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../../src/app.jsx', import.meta.url), 'utf-8');

describe('수평선 가격 입력 — 도구를 켤 때만', () => {
  it('입력창이 activeTool 조건 안에 있다', () => {
    /*
       ★ 조건이 없으면 툴바에 항상 남아, 수평선 도구가 둘로 보인다.
    */
    expect(src, '조건부 렌더가 아니다').toContain("activeTool === 'horizontal' && (() =>");
    expect(src, '구분선도 함께 숨겨야 한다').toContain("activeTool === 'horizontal' && <div className=\"chart-drawtool-sep\"/>");
  });

  it('도구를 켜면 바로 타이핑할 수 있다', () => {
    /* ★ 입력창이 보이는데 한 번 더 클릭해야 하면 "왜 안 써지나" 가 된다. */
    /*
       ★ `chart-hline-input` 문자열은 Esc 핸들러에도 있다(중복 실행 방지용). 그래서
         **입력창 마크업**을 가리키는 className 속성으로 찾는다 — 첫 등장으로 찾으면
         엉뚱한 곳을 검사한다(실제로 그렇게 틀린 실패가 났다).
    */
    const at = src.indexOf('className="chart-hline-input"');
    expect(at, '입력창 마크업을 찾지 못했다').toBeGreaterThan(-1);
    const seg = src.slice(at, at + 1800);
    expect(seg, 'autoFocus 가 없다').toContain('autoFocus');
  });

  it('Enter 로 선을 만들고 Esc 로 도구를 끈다', () => {
    const at = src.indexOf('className="chart-hline-input"');
    const seg = src.slice(at, at + 1800);
    expect(seg).toContain("e.key === 'Enter'");
    expect(seg).toContain("e.key === 'Escape'");
  });

  it('★ Esc 가 입력창 밖에서도 동작한다', () => {
    /*
       ★★ 입력창에만 걸면 **포커스가 있을 때만** 동작한다. 차트를 클릭한 뒤 Esc 를
         누르면 아무 일도 없고, 도구가 켜진 채 남아 다음 클릭이 의도하지 않은 선을
         만든다(실측으로 확인했다).
       ★ 커서 도구일 때는 걸지 않는다 — 다른 화면의 Esc(모달 닫기)를 가로채면 안 된다.
    */
    const at = src.indexOf("if (activeTool === 'cursor') return undefined;");
    expect(at, '문서 수준 Esc 처리가 없다').toBeGreaterThan(-1);
    const seg = src.slice(at, at + 900);
    expect(seg).toContain("window.addEventListener('keydown'");
    expect(seg).toContain("removeEventListener('keydown'");
    expect(seg, '중복 실행을 막지 않는다').toContain('chart-hline-input');
    expect(seg, '도구를 커서로 되돌리지 않는다').toContain("setActiveTool('cursor')");
  });

  it('도구를 바꾸면 이전 입력이 남지 않는다', () => {
    /*
       ★ 남겨 두면 나중에 수평선 도구를 다시 켰을 때 예전 값이 채워져 있고, 그대로
         Enter 를 누르면 의도하지 않은 가격에 선이 생긴다.
    */
    const at = src.indexOf('const pickTool = useCallback');
    expect(at).toBeGreaterThan(-1);
    const seg = src.slice(at, at + 700);
    expect(seg).toContain("setHlinePrice('')");
  });

  it('0 이하·숫자 아닌 값으로는 선을 만들지 않는다', () => {
    /* ★ 가격이 0 이면 선이 축 밖으로 나가 사라진 것처럼 보인다. */
    const at = src.indexOf('const drawAtPrice');
    expect(at).toBeGreaterThan(-1);
    const seg = src.slice(at, at + 700);
    expect(seg).toContain('Number.isFinite');
    expect(seg).toMatch(/price <= 0/);
  });

  it('쉼표를 허용한다', () => {
    const at = src.indexOf('const drawAtPrice');
    const seg = src.slice(at, at + 700);
    expect(seg).toMatch(/replace\(\/,\/g, ''\)/);
  });
});
