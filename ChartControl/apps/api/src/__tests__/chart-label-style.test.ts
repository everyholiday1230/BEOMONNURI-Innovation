import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');

/**
 * 차트 라벨 그리기 — **라이브러리 기본값이 새어 나오지 않게 한다.**
 *
 * ★★★ 운영자 보고(2026-09-17): "현재 포지션 금액·% 는 좋은데 **파란색 배경**이 있다."
 *
 *   원인은 우리 색이 아니라 **klinecharts 기본값**이었다. `text` 도형은 그리기 직전에
 *   배경 사각형을 한 장 깐다:
 *
 *       he(ctx, rects, { ...style, color: style.backgroundColor })
 *
 *   즉 배경색으로 `backgroundColor` 를 쓰는데, 우리가 그 값을 주지 않으면 병합된
 *   기본 스타일의 `#1677ff`(라이브러리 기본 파랑)가 들어간다. 캔버스 채우기를 추적해
 *   확인했다 — 글자마다 앞에 `fill #1677ff` 가 한 번씩 있었다.
 *
 * ★ 교훈: **주지 않은 스타일 값은 "없음" 이 아니라 "라이브러리 기본값" 이다.**
 *   우리 색만 확인하고 넘어가면 이런 것을 놓친다.
 */
describe('CHART-LABEL — 라이브러리 기본 스타일이 새지 않는다', () => {
  const raw = read('src/chart-kline.jsx');
  const src = stripComments(raw);

  /** `type: 'text'` 도형의 `styles: { … }` 블록을 뽑는다. */
  const textFigureStyles = (() => {
    const out: string[] = [];
    const re = /type:\s*'text'/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      /* 이 도형 객체 안에서 styles 블록을 찾는다(다음 `},` 로 닫히는 범위). */
      const seg = src.slice(m.index, m.index + 700);
      const sm = /styles:\s*\{([\s\S]*?)\}/u.exec(seg);
      out.push(sm ? sm[1]! : '(styles 없음)');
    }
    return out;
  })();

  it('[1] 텍스트 도형을 실제로 찾아냈다 (검사가 헛돌지 않는다)', () => {
    expect(textFigureStyles.length, `type:'text' 도형을 ${textFigureStyles.length}개 찾았다`)
      .toBeGreaterThanOrEqual(3);
  });

  it('[2] ★★★ 모든 텍스트 도형이 backgroundColor 를 명시한다', () => {
    /*
       ★ 주지 않으면 `#1677ff` 파란 배경이 글자 뒤에 깔린다. 우리 상자는 이미 `rect`
         도형으로 그리므로 글자 배경은 **없어야** 맞다.
       ★ 새 텍스트 라벨을 추가하는 사람이 이 값을 빠뜨리면 같은 증상이 재발한다.
    */
    const missing: string[] = [];
    textFigureStyles.forEach((s, i) => {
      if (!/backgroundColor/u.test(s)) missing.push(`text[${i}]: ${s.trim().slice(0, 60)}`);
    });
    expect(missing, `backgroundColor 를 주지 않은 텍스트 도형 — 라이브러리 기본 파랑이 깔린다:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('[3] backgroundColor 는 투명이다 (색을 새로 칠하지 않는다)', () => {
    for (const s of textFigureStyles) {
      const m = /backgroundColor:\s*([^,\n}]+)/u.exec(s);
      expect(m, `backgroundColor 값을 읽지 못했다: ${s.slice(0, 60)}`).toBeTruthy();
      expect(m![1]!.trim(), '투명이 아니면 글자 뒤에 판이 깔린다')
        .toMatch(/'transparent'/u);
    }
  });
});

/**
 * 손익 라벨이 **지표 레전드를 가리지 않는다.**
 *
 * ★ 레전드는 캔버스가 아니라 HTML(`div.chart-legend__item`)이고 차트 오른쪽 위에 있다.
 *   실측(패널 좌표): MA20 y=10 · MA60 y=29 · MA120 y=47 · VOL y=66 (각 높이 15).
 *   우리 손익 라벨도 오른쪽 정렬이라 선이 위쪽에 있으면 그 자리에서 만난다.
 *   운영자 화면에서 라벨 위에 `VOL` 이 겹쳐 보인 것이 이것이다.
 *
 * ★ 레전드를 옮기지 않는다 — 고정 UI 다. **라벨이 선 아래로 비킨다.**
 */
describe('CHART-LABEL — 손익 라벨이 지표 레전드를 피한다', () => {
  const src = stripComments(read('src/chart-kline.jsx'));

  it('[4] 레전드 위치를 실측하는 함수가 있다', () => {
    expect(src, 'legendBoxOf 가 없다').toMatch(/function\s+legendBoxOf\s*\(/u);
    /* HTML 요소를 찾아야 한다 — 캔버스에는 레전드가 없다. */
    expect(src).toMatch(/\.chart-legend/u);
  });

  it('[5] ★★ 겹치면 선 아래로 내려간다', () => {
    const m = /function tagFiguresRight\([^)]*\) \{([\s\S]*?)\n {2}\}/u.exec(src);
    expect(m, 'tagFiguresRight 를 찾지 못했다').toBeTruthy();
    const body = m![1]!;
    expect(body, 'legendBox 를 받지 않는다').toMatch(/legendBox/u);
    /* 세로·가로 둘 다 봐야 한다 — 세로만 보면 좁은 레전드에도 불필요하게 내려간다. */
    expect(body, '세로 겹침을 보지 않는다').toMatch(/overlapsV\s*=/u);
    expect(body, '가로 겹침을 보지 않는다').toMatch(/overlapsH\s*=/u);
    /*
       ★★ **겹침 판정의 결과로** 위치를 바꾸는지 본다.

         처음에는 `top = y + 3` 이 본문에 있는지만 봤는데, 그 문장은 아래쪽
         "화면 밖 방어" 에도 있다. 그래서 실제 회피 코드를 지워도 시험이 통과했다
         (역검증으로 잡았다). 두 값을 함께 쓰는 문장을 확인한다.
    */
    expect(body, '겹침 판정 결과로 선 아래로 옮기지 않는다')
      .toMatch(/if\s*\(\s*overlapsV\s*&&\s*overlapsH\s*\)\s*top\s*=\s*y\s*\+/u);
  });

  it('[6] 아래로 내려도 화면을 벗어나면 다시 위로 둔다', () => {
    /* ★ 화면 밖은 겹침보다 나쁘다 — 아무것도 보이지 않는다. */
    const m = /function tagFiguresRight\([^)]*\) \{([\s\S]*?)\n {2}\}/u.exec(src);
    expect(m![1]!, '패널 위쪽으로 벗어나는 경우를 처리하지 않는다').toMatch(/if \(top < 0\)/u);
  });

  it('[7] 레전드를 못 찾으면 예전처럼 선 위에 그린다', () => {
    /*
       ★ 레전드가 없는 배포에서 라벨이 이유 없이 아래로 내려가면 그것도 이상하다.
         `legendBoxOf` 는 못 찾으면 null 을 돌려주고, 호출부는 null 이면 비키지 않는다.
    */
    const m = /function legendBoxOf\([^)]*\) \{([\s\S]*?)\n {2}\}/u.exec(src);
    expect(m, 'legendBoxOf 를 찾지 못했다').toBeTruthy();
    expect(m![1]!, '못 찾을 때 null 을 돌려주지 않는다').toMatch(/return null/u);
  });
});
