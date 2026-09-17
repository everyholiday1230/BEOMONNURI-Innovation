import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * 차트 TP/SL 표시 규칙.
 *
 * ★★★ 왜 이 시험이 있는가
 *
 *   "진입가·TP·SL 가격을 캔들 위가 아니라 **오른쪽 축**에 표시" 는 운영자가 다섯 번
 *   넘게 요청한 항목이다. 커밋 두 개(7f4d942 "가격을 Y축에 표시", c1c2153 "가격은
 *   오른쪽 축으로")가 그것을 했다고 적었지만 **실제로는 되지 않았다.**
 *
 *   원인은 좌표계였다. KLineChart 오버레이의 두 콜백은 서로 다른 캔버스를 그린다
 *   (브라우저 실측, 2026-09-15):
 *
 *     createPointFigures  bounding = { width: 330, left:   0, right: 64 }  ← 캔들 패널
 *     createYAxisFigures  bounding = { width:  64, left: 330, right:  0 }  ← Y축
 *
 *   `createPointFigures` 안에서 `x = bounding.width - w` 는 **패널의 오른쪽 끝**,
 *   즉 마지막 봉들 위다. Y축은 별도 캔버스라서 그 콜백에서는 닿을 수 없다.
 *   그래서 코드에는 "오른쪽 축 알약" 이라는 주석이 있는데 화면에서는 캔들이 가려졌다.
 *
 * ★ 이 시험은 그 배치가 되돌아가는 것을 막는다. 사람이 다섯 번 말해야 하는 일을
 *   시험이 한 번에 잡는다.
 */

/** 주석을 지운 소스 — 이 저장소는 주석에 옛 코드를 예시로 남기는 규약이라 필수다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
}

/**
 * `name:` 으로 시작하는 콜백의 **본문**을 중괄호 짝을 세서 뽑는다.
 *
 * ★ 정규식으로 `\{[\s\S]*?\}` 를 쓰면 첫 닫는 괄호에서 끊긴다. 본문에 객체
 *   리터럴이 가득하므로 반드시 짝을 세야 한다.
 *
 * ★★ **`=>` 를 먼저 찾아야 한다.** 처음에는 `(` 다음의 첫 `{` 를 본문으로 삼았는데,
 *   이 콜백들은 `({ overlay, coordinates, bounding }) => {` 형태라서 그 `{` 는
 *   **구조분해 패턴**이었다. 그래서 본문 대신 파라미터 목록을 검사했고, "패널에서
 *   가격을 그리지 않는다" 시험이 **아무것도 검사하지 않은 채 통과**했다.
 *   (이 저장소의 경고 그대로다 — 시험을 넣었다 ≠ 시험이 지켜준다.)
 */
function callbackBodies(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`${name}\\s*:\\s*\\(`, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const arrow = src.indexOf('=>', m.index + m[0].length);
    if (arrow < 0) continue;
    const braceStart = src.indexOf('{', arrow);
    if (braceStart < 0) continue;
    let depth = 0;
    let i = braceStart;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(braceStart, i + 1));
  }
  return out;
}

describe('CHART-TPSL — 가격은 오른쪽 축, 손익은 캔들 오른쪽 여백', () => {
  const raw = read('src/chart-kline.jsx');
  const src = stripComments(raw);

  it('[1] 가격 배지를 그리는 함수는 축 좌표계 전용이다', () => {
    /*
       ★ 이름이 의도를 말해야 한다. 예전 이름은 `priceLabelFigures` 였고 주석에만
         "오른쪽 축" 이라고 적혀 있어서, 패널 콜백에서 부르는 실수를 막지 못했다.
    */
    expect(src, 'axisPriceFigures 가 없다 — 축에 가격을 그리는 함수가 사라졌다')
      .toMatch(/function\s+axisPriceFigures\s*\(/u);
    expect(src, '패널 좌표계용 옛 함수가 되살아났다').not.toMatch(/function\s+priceLabelFigures\s*\(/u);
  });

  it('[2] ★ createPointFigures 안에서는 가격 배지를 그리지 않는다 (캔들을 가린다)', () => {
    const bodies = callbackBodies(src, 'createPointFigures');
    expect(bodies.length, 'createPointFigures 를 찾지 못했다 — 검사가 헛돌고 있다').toBeGreaterThanOrEqual(4);

    const offenders: string[] = [];
    bodies.forEach((body, i) => {
      if (/axisPriceFigures\s*\(/u.test(body)) offenders.push(`createPointFigures[${i}] 가 axisPriceFigures 를 부른다`);
      /*
         패널 콜백에서 `bounding.width - <무언가>` 위치에 **채워진 사각형**을 그리면
         그것이 캔들 위의 가격 배지다. 예전 구현의 형태를 그대로 막는다.
      */
      if (/toFixed\(\s*decimals\s*\)/u.test(body) && /bounding\.width\s*-/u.test(body)) {
        offenders.push(`createPointFigures[${i}] 가 패널 오른쪽 끝에 가격을 그리는 형태다`);
      }
    });
    expect(offenders, `가격이 다시 캔들 위에 그려진다:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('[3] 가격 배지는 createYAxisFigures 안에서만 그린다', () => {
    const axisBodies = callbackBodies(src, 'createYAxisFigures');
    expect(axisBodies.length, 'createYAxisFigures 가 없다 — 축에 아무것도 안 그린다').toBeGreaterThanOrEqual(3);

    const drawing = axisBodies.filter((b) => /axisPriceFigures\s*\(/u.test(b));
    expect(drawing.length, 'createYAxisFigures 가 있는데 가격을 그리지 않는다').toBeGreaterThanOrEqual(3);

    /* 축 콜백 밖에서 부르는 곳이 없어야 한다(정의 자리는 제외). */
    const totalCalls = (src.match(/axisPriceFigures\s*\(/gu) || []).length;
    const inAxis = axisBodies.reduce((n, b) => n + (b.match(/axisPriceFigures\s*\(/gu) || []).length, 0);
    /* +1 은 `function axisPriceFigures(` 정의 자체 */
    expect(totalCalls, '축 콜백 밖에서 축 전용 함수를 부른다').toBe(inAxis + 1);
  });

  it('[4] 우리가 축에 그리는 오버레이는 기본 축 도형을 끈다 (배지 중복 방지)', () => {
    /*
       기본 도형은 축 텍스트 색을 쓴다. 켜 두면 TP·SL 이 같은 색 배지로 두 번 겹쳐
       그려지고, 색으로 방향을 알리는 규칙이 무너진다.
    */
    expect(src, 'needDefaultYAxisFigure: true 가 남아 있다')
      .not.toMatch(/needDefaultYAxisFigure:\s*true/u);
  });

  it('[5] 손익 라벨은 패널 오른쪽 끝에 붙인다 — 왼쪽(x=8)이 아니다', () => {
    expect(src, 'tagFiguresRight 가 없다').toMatch(/function\s+tagFiguresRight\s*\(/u);
    const bodies = callbackBodies(src, 'createPointFigures');
    const usesRight = bodies.filter((b) => /tagFiguresRight\s*\(/u.test(b));
    expect(usesRight.length, '오른쪽 정렬 라벨을 쓰는 곳이 없다').toBeGreaterThanOrEqual(2);
  });

  it('[6] 라벨 폭은 마지막 봉 오른쪽의 실제 여백에서 구한다', () => {
    /*
       ★ 예전에는 `paneW - 8 - 60 - 12`(패널 폭의 거의 전부)를 허용했다. 라벨을
         오른쪽으로 옮긴 뒤에도 그 값을 쓰면 라벨이 여백을 넘어 캔들 위로 뻗는다.
         그래서 폭을 차트에 물어본다.
    */
    expect(src, 'rightGapPx 가 없다 — 여백을 재지 않는다').toMatch(/function\s+rightGapPx\s*\(/u);
    expect(src, 'rightGapPx 가 마지막 봉 좌표를 구하지 않는다').toMatch(/convertToPixel/u);
    expect(src, '패널 폭을 라벨 폭 예산으로 되돌렸다').not.toMatch(/paneW\s*-\s*8\s*-\s*60\s*-\s*12/u);
  });
});

/**
 * 손익 라벨 문구 — **%와 금액이 함께 남아야 한다.**
 *
 * 운영자 요청(2026-09-15): "지금 가격 나오는 위치에(캔들보다 더 오른쪽 공간에)
 * %랑 금액 나오게."
 *
 * ★ 여백은 실측 77px 다. 한 줄로는 `-1.50% · ROE -15.00% · -513.24`(약 165px)가
 *   들어가지 않는다. 그래서 세로로 쌓고, 좁으면 ROE 부터 버린다.
 */
describe('CHART-TPSL — 손익 라벨 문구', () => {
  /* 브라우저 전역에 붙는 IIFE 다. window 를 만들어 주고 그대로 불러온다. */
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  g.window = {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(join(ROOT, 'src', 'chart-overlay-live.js'));
  const LV = (g.window as { QTOverlayLive: {
    setPrice: (s: string, p: number) => void;
    labelFor: (ov: unknown, price?: number, opts?: { maxPx?: number }) => string;
    labelLinesFor: (ov: unknown, price?: number, opts?: { maxPx?: number; maxLines?: number }) => string[];
  } }).QTOverlayLive;

  const ENTRY = 68432.5;
  const bracket = (price: number) => ({
    label: '', symbol: 'BTCUSDT',
    live: { kind: 'bracket', symbol: 'BTCUSDT', entry: ENTRY, price, side: 'long', leverage: 10, size: 0.5 },
  });

  it('[7] 헬퍼가 줄 단위 라벨을 제공한다', () => {
    expect(typeof LV.labelLinesFor).toBe('function');
  });

  it('[8] ★ 좁은 여백(77px)에서도 %와 금액이 모두 남는다', () => {
    for (const [name, ov] of [['SL', bracket(ENTRY * 0.985)], ['TP', bracket(ENTRY * 1.02)]] as const) {
      const lines = LV.labelLinesFor(ov, undefined, { maxPx: 77, maxLines: 2 });
      const joined = lines.join(' ');
      expect(lines.length, `${name}: 줄 수가 2를 넘는다 — ${JSON.stringify(lines)}`).toBeLessThanOrEqual(2);
      expect(joined, `${name}: 퍼센트가 없다 — ${JSON.stringify(lines)}`).toMatch(/[+-]\d+\.\d{2}%/u);
      /* 금액은 % 가 아닌 숫자다. 통화 기호 없이 부호+숫자로 적는다. */
      expect(
        lines.some((l) => /^[+-]\d/u.test(l) && !l.includes('%')),
        `${name}: 금액이 빠졌다 — ${JSON.stringify(lines)}`,
      ).toBe(true);
    }
  });

  it('[9] 좁을 때 먼저 버리는 것은 ROE 다 (금액이 아니다)', () => {
    const lines = LV.labelLinesFor(bracket(ENTRY * 0.985), undefined, { maxPx: 77, maxLines: 2 });
    expect(lines.join(' '), 'ROE 가 남고 금액이 사라졌다').not.toMatch(/ROE/u);
  });

  it('[10] 자리가 넓으면 ROE 까지 한 줄로 보여준다', () => {
    const lines = LV.labelLinesFor(bracket(ENTRY * 1.02), undefined, { maxPx: 250, maxLines: 2 });
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/ROE/u);
  });

  it('[11] 숫자를 잘라서 줄이지 않는다 — 잘린 금액은 틀린 금액이다', () => {
    /* 아주 좁게 주어도 남은 문구의 숫자는 온전해야 한다. */
    const lines = LV.labelLinesFor(bracket(ENTRY * 1.02), undefined, { maxPx: 20, maxLines: 2 });
    for (const l of lines) {
      expect(l, `잘린 숫자처럼 보인다: ${l}`).not.toMatch(/\d\.\d$/u);
      expect(l).not.toMatch(/\.\.\.|…/u);
    }
  });

  /*
     ★★ **한 줄 경로도 같은 우선순위여야 한다.**

       `labelLinesFor` 는 자체적으로 줄을 나누므로 `labelFor` 의 축약 순서와 독립이다.
       그런데 다른 차트 엔진(`src/chart-canvas.jsx`)은 여전히 `labelFor` 한 줄을 쓴다.
       두 곳의 우선순위가 다르면 같은 화면에서 엔진에 따라 금액이 보이거나 사라진다.

     ★ 역검증으로 확인한 것: 이 시험이 없으면 `bracketLabel` 의 순서를 되돌려도
       아무 시험도 실패하지 않았다. 폭 100px 가 두 동작이 갈리는 지점이다 —
       `% · ROE`(약 112px)는 안 들어가고 `% · 금액`(약 90px)은 들어간다.
  */
  it('[12] 한 줄 라벨도 ROE 보다 금액을 먼저 지킨다', () => {
    const one = LV.labelFor(bracket(ENTRY * 0.985), undefined, { maxPx: 100 });
    expect(one, `금액이 빠졌다: ${one}`).toMatch(/[+-]\d+\.\d{2}(?!%)/u);
    expect(one, `ROE 가 금액보다 먼저 남았다: ${one}`).not.toMatch(/ROE/u);
  });
});

/**
 * 차트에서 클릭으로 TP/SL 을 **설정**하는 기능.
 *
 * ★★ 왜 필요했나: 예전에는 주문 패널에 값을 **먼저 입력해야** 선이 나타났고
 *   (`visibleOverlays` 의 `mk()` 가 값이 없으면 선을 만들지 않는다), 그 뒤에만
 *   끌어서 옮길 수 있었다. 즉 드래그로 **옮기기**는 됐지만 **설정**은 안 됐다.
 *
 * ★ 기본값(±2% 같은 것)을 만들지 않는다는 원칙은 유지한다 — 여기 들어오는 값은
 *   이용자가 차트에서 직접 찍은 가격이다.
 */
describe('CHART-TPSL — 차트에서 클릭으로 TP/SL 설정', () => {
  const actionsRaw = read('src/chart-actions.js');
  const actions = stripComments(actionsRaw);
  const appRaw = read('src/app.jsx');
  const app = stripComments(appRaw);

  it('[13] tp·sl 이 가격 찍기 도구로 등록되어 있다', () => {
    expect(actions).toMatch(/PRICE_PICK_TOOLS\s*=\s*\[[^\]]*'tp'[^\]]*'sl'[^\]]*\]/u);
    /*
       ★ 오버레이 매핑에 넣으면 안 된다. 넣으면 `isDrawToolAvailable` 이
         klinecharts 지원 목록에서 찾다가 실패해 버튼이 비활성으로 보인다.
    */
    expect(actions, 'tp 를 DRAW_TOOL_OVERLAY 에 넣었다').not.toMatch(/DRAW_TOOL_OVERLAY\s*=\s*\{[^}]*\btp\s*:/u);
    /* 가격 찍기 도구는 오버레이 지원 여부와 무관하게 사용 가능해야 한다. */
    expect(actions).toMatch(/isDrawToolAvailable[\s\S]{0,400}PRICE_PICK_TOOLS\.includes/u);
  });

  it('[14] ★ 클릭 리스너를 컨테이너에 붙인다 — 캔버스가 아니다', () => {
    /*
       ★★★ KLineChart 는 패널마다 캔버스를 **여러 장 겹쳐** 놓는다(실측: 캔들 패널 2장).
         캔버스 하나에 붙이면 클릭이 맨 위 캔버스로 가고 형제인 그 캔버스에는
         capture 로도 오지 않는다(capture 는 조상 사슬만 탄다).
         실제로 그렇게 붙였다가 클릭이 **한 번도 잡히지 않았다.**
    */
    const m = /armPricePick\s*\(kind\)\s*\{([\s\S]*?)\n {6}\},/u.exec(actions);
    expect(m, 'armPricePick 을 찾지 못했다').toBeTruthy();
    const body = m![1]!;
    expect(body, '리스너를 컨테이너에 붙이지 않는다').toMatch(/container\.addEventListener\(\s*'click'/u);
    expect(body, '캔버스에 직접 리스너를 붙였다 — 겹친 캔버스에 가로막힌다')
      .not.toMatch(/(canvas|target)\.addEventListener\(\s*'click'/u);
    /* 좌표는 캔들 패널 rect 기준으로 계산해야 한다. */
    expect(body).toMatch(/convertFromPixel/u);
    /* 한 번만 받고 스스로 해제한다 — 켜진 채 두면 다음 클릭이 값을 덮어쓴다. */
    expect(body, 'one-shot 해제가 없다').toMatch(/off\s*\(\s*\)/u);
  });

  it('[15] 찍은 가격을 orderBracket 에 넣고 브래킷을 켠다', () => {
    expect(app).toMatch(/addEventListener\(\s*'qt:price-pick'/u);
    expect(app, "orderBracket 에 on: true 로 넣지 않는다")
      .toMatch(/setOrderBracket\(\(prev\)\s*=>\s*\(\{\s*\.\.\.prev,\s*on:\s*true,\s*\[d\.kind\]/u);
    /* 주문을 내지 않는다 — 값만 채운다. */
    const m = /addEventListener\('qt:price-pick'[\s\S]{0,200}/u.exec(app);
    expect(m).toBeTruthy();
  });

  it('[16] ★★ cancelPricePick 이 Esc 처리부보다 먼저 선언된다 (TDZ 방어)', () => {
    /*
       ★★★ 이 시험이 있는 이유

         `useEffect` 의 **의존성 배열은 렌더 중에 평가된다.** 그래서 배열에서 쓰는
         이름이 아래에 `const` 로 선언돼 있으면 TDZ 에 걸려
         `ReferenceError: Cannot access 'X' before initialization` 이 나고
         **화면 전체가 죽는다.**

         이 저장소에서 같은 사고가 이미 한 번 있었다(`placeOrder`, 프로덕션 흰 화면).
         이번 작업에서도 처음에 같은 실수를 했다. **eslint 도 typecheck 도 잡지 못한다** —
         브라우저를 열어야 보인다. 그래서 순서를 시험으로 고정한다.
    */
    const decl = app.indexOf('const cancelPricePick');
    expect(decl, 'cancelPricePick 선언을 찾지 못했다').toBeGreaterThan(-1);

    /* 의존성 배열에서 쓰는 모든 지점이 선언보다 뒤에 있어야 한다. */
    const uses = [...app.matchAll(/\}, \[[^\]]*cancelPricePick[^\]]*\]\)/gu)].map((m) => m.index!);
    expect(uses.length, '의존성 배열에서 쓰는 곳이 없다 — 검사가 헛돌고 있다').toBeGreaterThan(0);
    for (const u of uses) {
      expect(u, `의존성 배열(${u})이 선언(${decl})보다 위에 있다 — 렌더가 ReferenceError 로 죽는다`)
        .toBeGreaterThan(decl);
    }
  });

  it('[17] 드래그 결과를 원본 float 그대로 입력칸·주문에 넣지 않는다', () => {
    /*
       ★ 드래그 좌표는 소수 12자리까지 나온다. 실측에서 `68744.93908239005` 가
         입력칸에 들어갔다. 읽을 수 없고, 그 값으로 확정하면 거래소가 tickSize
         위반으로 거부한다. 수평선 도구에서 이미 같은 것을 겪었다.

       ★★ 같은 변환이 **두 곳**에 있다: 작성 중 TP/SL 과 보유 포지션 보호주문 확정.
         후자는 실제 주문이 거래소로 나가는 자리다. 한 함수로 묶여 있는지 본다 —
         따로 두면 한쪽만 고치고 다른 쪽에서 새어 나간다.
    */
    expect(app, 'String(price) 폴백이 되살아났다 — 소수 12자리가 들어간다')
      .not.toMatch(/decimals === null \? String\(price\)/u);
    expect(app, '공통 자리수 정규화 함수가 없다').toMatch(/function\s+priceTextFor\s*\(/u);

    /* 두 경로가 모두 그 함수를 쓰는가. */
    const calls = (app.match(/priceTextFor\(/gu) || []).length;
    expect(calls, `priceTextFor 호출이 ${calls}곳뿐이다 — 정의 + 두 경로 = 3 이어야 한다`)
      .toBeGreaterThanOrEqual(3);
  });

  it('[18] 도구를 바꾸거나 Esc 를 누르면 가격 찍기가 해제된다', () => {
    /*
       ★ 해제하지 않으면 커서 도구로 보이는데 차트를 클릭하면 TP 가 바뀐다 —
         이용자가 원인을 알 수 없는 종류의 오작동이다.
    */
    const pick = /const pickTool = useCallback\(\(toolId\) => \{([\s\S]*?)\n {4}\}, \[/u.exec(app);
    expect(pick, 'pickTool 을 찾지 못했다').toBeTruthy();
    expect(pick![1]!, '도구를 바꿀 때 해제하지 않는다').toMatch(/cancelPricePick\(\)/u);

    /* Esc 처리부에도 있어야 한다. */
    const esc = /if \(e\.key !== 'Escape'\) return;([\s\S]{0,400})/u.exec(app);
    expect(esc, 'Esc 처리부를 찾지 못했다').toBeTruthy();
    expect(esc![1]!, 'Esc 에서 해제하지 않는다').toMatch(/cancelPricePick\(\)/u);
  });
});

/**
 * 수평선을 **선 어디서나** 잡아 끌기.
 *
 * ★ KLineChart 는 오버레이 점(손잡이)만 끌 수 있다. 손잡이는 화면 한 곳(마지막 봉 x)에만
 *   있어서 이용자는 "선이 보이는데 안 잡힌다" 를 겪는다. 그래서 몸통 드래그를 직접 만들었다.
 */
describe('CHART-TPSL — 선 몸통 드래그', () => {
  const ck = stripComments(read('src/chart-kline.jsx'));

  it('[19] 리스너를 호스트에 capture 로 붙인다 — 캔버스가 아니다', () => {
    /*
       ★★ KLineChart 는 패널마다 캔버스를 여러 장 겹쳐 둔다. 캔버스에 붙이면 맨 위
         캔버스가 먼저 받고 형제에게는 오지 않는다. TP/SL 클릭 설정에서 이미 밟은 함정이다.
    */
    expect(ck).toMatch(/host\.addEventListener\('pointerdown',\s*onDown,\s*true\)/u);
    expect(ck).toMatch(/host\.addEventListener\('pointermove',\s*onMove,\s*true\)/u);
    expect(ck).toMatch(/host\.addEventListener\('pointerup',\s*finish,\s*true\)/u);
    expect(ck, 'pointercancel 처리가 없다 — 드래그가 매달린 채 남는다')
      .toMatch(/host\.addEventListener\('pointercancel'/u);
    expect(ck, '캔버스에 직접 붙였다').not.toMatch(/canvas\.addEventListener\('pointerdown'/u);
  });

  it('[20] ★★ 드래그 효과를 매 렌더 재부착하지 않는다 (최신 값은 ref 로 읽는다)', () => {
    /*
       ★★★ 이 시험이 있는 이유

         처음에는 의존성을 `[overlays, onOverlayChange, activeTool]` 로 두었다. 그런데
         상위가 `onOverlayChange={(id, ov) => updateOverlay(id, ov)}` 처럼 **인라인
         화살표**를 넘기므로 매 렌더 새 함수가 되고, 효과가 매 렌더 해제·재부착됐다.
         그 해제가 **진행 중인 드래그 상태를 지웠다.**

         시세는 초당 여러 번 들어오므로 렌더도 그만큼 일어난다. 결과: 드래그가 산발적으로
         먹지 않았고, "왼쪽은 안 되고 가운데는 된다" 처럼 **위치 문제로 보였다** —
         실제로는 타이밍이었다. 실측으로 같은 지점이 한 번은 되고 다음엔 안 됐다.
    */
    expect(ck, '최신 overlays 를 ref 로 읽지 않는다').toMatch(/overlaysRef\.current/u);
    expect(ck, '최신 콜백을 ref 로 읽지 않는다').toMatch(/onOverlayChangeRef\.current/u);
    expect(ck, '최신 도구를 ref 로 읽지 않는다').toMatch(/activeToolRef\.current/u);

    /* 드래그 효과의 정리부가 드래그 상태를 지우면 안 된다. */
    const seg = /host\.addEventListener\('pointerdown'[\s\S]*?\n {4}\}, \[/u.exec(ck);
    expect(seg, '드래그 효과의 끝을 찾지 못했다').toBeTruthy();
    expect(seg![0]!, '정리부가 진행 중인 드래그를 지운다 — 재부착 때 드래그가 끊긴다')
      .not.toMatch(/removeEventListener[\s\S]*lineDragRef\.current = null/u);
    /* 의존성이 비어 있어야 한다(값은 ref 로 읽으므로). */
    expect(seg![0]!.endsWith('}, [')).toBe(true);
    const after = ck.slice(ck.indexOf(seg![0]!) + seg![0]!.length, ck.indexOf(seg![0]!) + seg![0]!.length + 4);
    expect(after.trim().startsWith(']'), `의존성이 비어 있지 않다: [${after}`).toBe(true);
  });

  it('[21] 동기화 효과가 끌고 있는 선을 되쓰지 않는다', () => {
    /*
       ★ 되쓰면 시세 틱 한 번에 선이 **손가락 아래에서 원래 자리로 튕긴다.**
         확정은 손을 뗄 때 한 번만 한다.
    */
    expect(ck).toMatch(/if \(lineDragRef\.current && lineDragRef\.current\.ourId === ov\.id\) continue;/u);
  });

  it('[22] 그리기 도구가 켜져 있으면 선을 가로채지 않는다', () => {
    const down = /const onDown = \(e\) => \{([\s\S]*?)\n {6}\};/u.exec(ck);
    expect(down, 'onDown 을 찾지 못했다').toBeTruthy();
    const body = down![1]!;
    expect(body, '커서 도구 여부를 보지 않는다').toMatch(/tool !== 'cursor'\) return;/u);
    /* 왼쪽 버튼만. 가운데 버튼·Shift 는 차트 팬이다. */
    expect(body, '버튼·수정키를 가리지 않는다').toMatch(/e\.button !== 0 \|\| e\.shiftKey/u);
  });

  it('[23] 잠긴 선·숨긴 선은 끌 수 없다', () => {
    const d = /const draggable = \(ov\) => ov([\s\S]*?);\n/u.exec(ck);
    expect(d, 'draggable 을 찾지 못했다').toBeTruthy();
    expect(d![1]!).toMatch(/!ov\.hidden/u);
    expect(d![1]!).toMatch(/!ov\.locked/u);
    expect(d![1]!, '수평선만 대상이어야 한다').toMatch(/ov\.type === 'horizontal'/u);
  });

  it('[24] 움직이지 않았으면 확정하지 않는다', () => {
    /* ★ 선을 살짝 누른 것만으로 주문 값이 바뀌면 안 된다. */
    expect(ck).toMatch(/if \(!d\.moved \|\| d\.value === null \|\| !notify\) return;/u);
  });

  it('[25] 확정은 기존 onOverlayChange 경로로 보낸다 — 주문 반영을 새로 만들지 않는다', () => {
    /*
       ★ draft-tp/draft-sl 은 주문 패널 값이 되고, posbr-* 는 옮기기만 되고,
         나머지는 오버레이 상태가 된다. 그 판단은 app.jsx handleOverlayChange 가
         이미 하고 있다. 여기서 또 판단하면 두 곳이 갈린다.
    */
    expect(ck).toMatch(/notify\(d\.ourId, patched\)/u);
    /* 손잡이 근처는 KLineChart 에 양보한다 — 둘이 함께 반응하면 값이 두 번 바뀐다. */
    expect(ck, '손잡이 회피가 없다').toMatch(/HANDLE_KEEPOUT/u);
  });

  it('[26] activeTool 을 실제로 받는다 (예전엔 이름이 달라 무시됐다)', () => {
    /*
       ★★ 예전 시그니처는 `_activeTool` 이었다. 상위는 `activeTool` 을 넘기고 있었으므로
         **전달되지 않고 항상 기본값 'cursor'** 였다. 그 상태로는 "그리기 도구 중에는
         선을 잡지 않는다" 를 판단할 수 없다.
    */
    expect(ck, 'activeTool 을 받지 않는다').toMatch(/^\s*activeTool = 'cursor',/mu);
    expect(ck, '_activeTool 로 되돌아갔다').not.toMatch(/_activeTool/u);
  });
});
