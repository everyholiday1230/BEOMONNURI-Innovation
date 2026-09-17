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
    expect(src, 'legendRectsOf 가 없다').toMatch(/function\s+legendRectsOf\s*\(/u);
    /* HTML 요소를 찾아야 한다 — 캔버스에는 레전드가 없다. */
    expect(src).toMatch(/\.chart-legend/u);
  });

  it('[5] ★★ 겹치면 선 아래로 내려간다', () => {
    const m = /function tagFiguresRight\([^)]*\) \{([\s\S]*?)\n {2}\}/u.exec(src);
    expect(m, 'tagFiguresRight 를 찾지 못했다').toBeTruthy();
    const body = m![1]!;
    expect(body, '정보 요소 위치를 받지 않는다').toMatch(/legendRects/u);

    /*
       ★★★ **하나의 큰 상자로 합치면 안 된다 — 두 번 실패한 지점이다.**

         ① 레전드만 피해 "겹치면 선 아래로" → 레전드 띠가 70px 이라 내려가도 여전히
            VOL 과 겹쳤다(실측: 선 y=50, 위 15~47 → 아래 53~85, VOL 66~81).
         ② HUD 까지 합쳐 **하나의 상자**로 → left 가 8 로 내려가 과잉 예약되고, 라벨이
            띠 전체 아래로 34px 밀리면서 이번엔 **다른 라벨(진입가)과 겹쳤다.**

         실제 모양은 ㄱ자다(HUD 는 위쪽 넓게, 레전드는 오른쪽 좁게). 그래서 **사각형
         목록**으로 두고 후보 위치마다 *그 y 띠에 걸치는 것만* 피한다.
    */
    const boxFn = src.slice(src.indexOf('function legendRectsOf'), src.indexOf('function legendRectsOf') + 1100);
    expect(boxFn, '레전드 항목을 재지 않는다').toMatch(/chart-legend__item/u);
    expect(boxFn, 'HUD 줄을 재지 않는다 — 레전드만 피하면 라벨이 OHLC 줄로 옮겨 붙는다')
      .toMatch(/chart-hud__row/u);
    expect(boxFn, '사각형 목록으로 돌려주지 않는다 — 합치면 과잉 예약된다')
      .toMatch(/rects\.push\(/u);
    expect(boxFn, '합친 상자를 돌려준다').not.toMatch(/Math\.min\(top,/u);

    /* 후보 y 띠에 **실제로 걸치는** 것만 골라야 한다. 전부 피하면 과잉 예약과 같다. */
    expect(body, '걸치는 요소만 고르지 않는다')
      .toMatch(/legendRects\.filter\(\(r\) => t < r\.bottom && \(t \+ boxH\) > r\.top\)/u);
    /* 걸치는 게 없으면 원래 오른쪽 끝을 그대로 써야 한다 — 이유 없이 밀면 안 된다. */
    expect(body, '걸침이 없을 때 원래 위치를 쓰지 않는다')
      .toMatch(/if \(!hit\.length\) return rightEdge/u);

    /*
       ★★ 세로 이동은 선 ±3 만 쓴다. 라벨이 자기 선에서 멀어지면 어느 선의 값인지
         알 수 없으므로 **세로 거리가 곧 정확도**다. 회피는 가로로 한다.
    */
    expect(body, '위 후보가 선 기준이 아니다').toMatch(/const above = y - boxH - 3/u);
    expect(body, '아래 후보가 선 기준이 아니다').toMatch(/const below = y \+ 3/u);
    expect(body, '아래 후보가 패널을 벗어나는지 보지 않는다').toMatch(/below \+ boxH <= limitH/u);
    expect(body, '오른쪽을 가장 덜 잃는 후보를 고르지 않는다')
      .toMatch(/c\.right > best\.right/u);
    /* 왼쪽으로 밀어도 상자가 화면 밖으로 나가지 않아야 한다. */
    expect(body, '왼쪽 한계를 두지 않아 라벨이 화면 밖으로 나갈 수 있다')
      .toMatch(/Math\.max\(boxW,/u);

    expect(src, '호출부가 패널 높이를 넘기지 않는다')
      .toMatch(/tagFiguresRight\([\s\S]{0,90}bounding\.height\)/u);
  });

  it('[6] 아래로 내려도 화면을 벗어나면 다시 위로 둔다', () => {
    /* ★ 화면 밖은 겹침보다 나쁘다 — 아무것도 보이지 않는다. */
    const m = /function tagFiguresRight\([^)]*\) \{([\s\S]*?)\n {2}\}/u.exec(src);
    expect(m![1]!, '패널 위쪽으로 벗어나는 경우를 처리하지 않는다').toMatch(/if \(top < 0\)/u);
  });

  it('[7] 레전드를 못 찾으면 예전처럼 선 위에 그린다', () => {
    /*
       ★ 레전드가 없는 배포에서 라벨이 이유 없이 아래로 내려가면 그것도 이상하다.
         `legendRectsOf` 는 못 찾으면 null 을 돌려주고, 호출부는 null 이면 비키지 않는다.
    */
    const m = /function legendRectsOf\([^)]*\) \{([\s\S]*?)\n {2}\}/u.exec(src);
    expect(m, 'legendRectsOf 를 찾지 못했다').toBeTruthy();
    expect(m![1]!, '못 찾을 때 null 을 돌려주지 않는다').toMatch(/return null/u);
  });
});
