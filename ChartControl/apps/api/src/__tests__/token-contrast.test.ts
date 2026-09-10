/**
 * 디자인 토큰 명암비 — WCAG AA (본문 4.5:1).
 *
 * ★★★ **왜 이 파일이 필요한가**
 *
 *   이 저장소의 색은 전부 `oklch()` 다. 그런데 흔한 명암비 검사 도구는 rgb 만 이해한다.
 *   그래서 `oklch(58% 0.008 240)` 의 숫자를 RGB(58, 0.008, 240)로 읽고 엉뚱한 값을 낸다.
 *
 *   실제로 **두 번 틀렸다**:
 *     · 감사 보고서의 "322건" — 방향은 맞았지만 수치 근거가 없었다
 *     · 그것을 확인하려던 첫 측정도 같은 방식으로 틀려서, 흰 글씨/검은 배경을
 *       "비율 1.0 미달" 로 보고했다
 *
 *   그리고 세 번째 함정이 있었다: **알파를 무시하면 안 된다.** 12% 투명 배경을
 *   불투명으로 계산해 "미달 483건" 이 나왔는데, 알파를 합성하니 실제로는 22건이었다.
 *
 * ★★ 그래서 여기서 oklch → sRGB 변환을 **직접 구현**한다. 브라우저 없이 CI 에서 돌아야
 *   하기 때문이다. 구현이 맞는지는 아래 [0] 시험이 **브라우저 실측값과 대조**해 지킨다 —
 *   변환이 틀리면 나머지 시험 전부가 의미 없는 숫자가 된다.
 *
 * ★ 이 시험은 **토큰 조합**만 본다. 화면의 실제 요소는 브라우저로 재야 하고(그건 배포 후
 *   확인한다), 여기서는 "토큰을 그렇게 조합하면 반드시 미달" 인 경우를 막는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Rgb = [number, number, number];

/**
 * oklch(L% C H) → sRGB 0..255.
 *
 * OKLab → 선형 LMS → 선형 sRGB → 감마 보정. 계수는 Björn Ottosson 의 정의를 쓴다.
 */
function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  /* OKLab → LMS(비선형) */
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  /* LMS → 선형 sRGB */
  const lr = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const lb = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;

  /* 감마 보정 + 클램프. ★ 색역 밖 값은 잘린다 — 브라우저도 같게 동작한다. */
  const enc = (v: number) => {
    const x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, x)) * 255);
  };
  return [enc(lr), enc(lg), enc(lb)];
}

/** `oklch(58% 0.008 240)` / `oklch(0.58 0.008 240 / 0.75)` 를 파싱한다. */
function parseOklch(src: string): { rgb: Rgb; alpha: number } | null {
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/i.exec(src);
  if (!m) return null;
  const lRaw = Number(m[1]);
  const l = m[2] === '%' ? lRaw / 100 : lRaw;
  return {
    rgb: oklchToRgb(l, Number(m[3]), Number(m[4])),
    alpha: m[5] === undefined ? 1 : Number(m[5]),
  };
}

const relLum = (v: Rgb): number => {
  const lin = (x: number) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]);
};

const contrast = (fg: Rgb, bg: Rgb): number => {
  const a = relLum(fg);
  const b = relLum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const TOKENS = readFileSync(resolve(__dirname, '../../../../src/tokens.css'), 'utf-8');

/*
   ★★★ **테마 범위(scope)별로 나눠 읽는다.**

     처음엔 `--color-bg-surface` 의 **모든** 정의를 배경 후보로 썼다. 그런데 tokens.css 에는
     `[data-theme="light"]` 가 있고 거기서 surface 는 **흰색**이다. 그래서 다크 테마의 밝은
     글씨색을 흰 배경과 짝지어 "미달" 이라고 판정했다 — 실제로는 함께 쓰이지 않는 조합이다.

   ★ 같은 범위 안에서만 짝짓는다. 범위에 없는 토큰은 `:root` 값을 상속한다(CSS 와 같다).
*/
type Scope = { name: string; vars: Map<string, string> };

function parseScopes(cssRaw: string): Scope[] {
  /*
     ★★ **주석을 먼저 지운다.** 주석 안의 `=====` 장식과 주석 닫는 기호가 선택자로 잡혀서
       `:root` 를 하나도 못 찾았다(실제로 그렇게 실패했다). 이 저장소는 주석이 많아
       소스를 정규식으로 읽을 때마다 같은 문제가 난다 — 다른 소스 검사 시험에서도
       같은 이유로 주석을 먼저 지운다.
  */
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
  const scopes: Scope[] = [];
  /* 선택자 { ... } 블록만 본다. @media 안의 :root 는 선택자 이름에 포함돼 구분된다. */
  const re = /(^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const sel = (m[2] ?? '').trim();
    const body = m[3] ?? '';
    if (!sel || !body.includes('--')) continue;
    const vars = new Map<string, string>();
    for (const v of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars.set(v[1]!, v[2]!.trim());
    if (vars.size) scopes.push({ name: sel, vars });
  }
  return scopes;
}

const SCOPES = parseScopes(TOKENS);
const ROOT = SCOPES.find((s) => s.name === ':root');

/** 범위 안에서 토큰을 푼다. var(--x) 는 따라간다. 범위에 없으면 :root 로 내려간다. */
function resolve1(scope: Scope, name: string, depth = 0): string | null {
  if (depth > 4) return null;
  const raw = scope.vars.get(name) ?? ROOT?.vars.get(name);
  if (!raw) return null;
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  return ref ? resolve1(scope, ref[1]!, depth + 1) : raw;
}

const colorIn = (scope: Scope, name: string): { rgb: Rgb; alpha: number } | null => {
  const raw = resolve1(scope, name);
  return raw ? parseOklch(raw) : null;
};

describe('디자인 토큰 명암비 (oklch)', () => {
  it('[0] ★★★ oklch → sRGB 변환이 브라우저 실측값과 일치한다', () => {
    /*
       ★★★ 이 시험이 무너지면 아래 전부가 의미 없는 숫자다.

         기준값은 프로덕션 크롬에서 canvas + getImageData 로 읽은 실측값이다
         (`ctx.fillStyle = 색; fillRect; getImageData`).

       ★ ±1 을 허용한다 — 반올림 경계에서 한 단계 차이는 명암비 판정에 영향이 없다.
    */
    const cases: [string, Rgb][] = [
      ['oklch(97% 0.002 240)', [244, 245, 246]],
      ['oklch(58% 0.008 240)', [118, 123, 127]],
      ['oklch(14% 0.012 240)', [5, 10, 14]],
    ];
    for (const [src, expected] of cases) {
      const got = parseOklch(src);
      expect(got, `${src} 를 파싱하지 못했다`).toBeTruthy();
      for (let i = 0; i < 3; i += 1) {
        expect(
          Math.abs((got!.rgb[i] ?? -1) - (expected[i] ?? -1)),
          `${src} → 계산 ${got!.rgb.join(',')} vs 브라우저 ${expected.join(',')}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  /*
     배경 후보. ★ base/surface/elevated 만 보다가 **hover(28%) 를 놓쳐** 4건이 남았다.
       목록에 있는 것만 확인하면 목록에 없는 것에서 실패한다 — 그래서 여기에 전부 적는다.
  */
  const BG_TOKENS = [
    'color-bg-app', 'color-bg-surface', 'color-bg-panel', 'color-bg-elevated', 'color-bg-input',
    'color-bg-hover', 'color-bg-active',
  ];
  /*
     ★★ 토큰 **이름을 추측하면 안 된다.** 처음에 `--color-bg-base` 라고 적었는데 그런
       토큰은 없다(실제 이름은 --color-bg-app). 존재하지 않는 이름은 조용히 건너뛰어져
       "검사했다" 는 착각만 남는다 — 그래서 아래에서 **이름이 실제로 있는지** 먼저 본다.
  */
  it('[0b] 검사 대상 배경 토큰이 실제로 존재한다', () => {
    const missing = BG_TOKENS.filter((t) => !ROOT?.vars.has(t));
    expect(missing, `tokens.css 에 없는 이름을 검사하려 했다: ${missing.join(', ')}`).toEqual([]);
  });

  /* 검사할 범위: :root(기본 다크) + 브랜드 테마 + 라이트 테마. */
  const TARGET_SCOPES = SCOPES.filter((sc) => sc.name === ':root' || /^\[data-(brand|theme)=/.test(sc.name));

  const pairs = (fgToken: string): { scope: string; bg: string; fg: Rgb; bgRgb: Rgb }[] => {
    const out: { scope: string; bg: string; fg: Rgb; bgRgb: Rgb }[] = [];
    for (const sc of TARGET_SCOPES) {
      const fg = colorIn(sc, fgToken);
      if (!fg || fg.alpha < 0.99) continue;
      /*
         ★★★ **알파를 합성한다.** --color-bg-hover 는 알파 0.6, --color-bg-active 는 0.7 이다.
           예전 측정은 알파를 무시해 12% 투명 배경을 불투명으로 계산했고, 그래서
           "미달 483건" 이 나왔다 — 합성하니 실제로는 22건이었다. 알파를 건너뛰면(skip)
           **가장 밝은 배경을 검사하지 않게 되고**, 실제로 그렇게 4건을 놓쳤다.
      */
      const baseBg = colorIn(sc, 'color-bg-app');
      if (!baseBg) continue;
      for (const bgName of BG_TOKENS) {
        const bg = colorIn(sc, bgName);
        if (!bg) continue;
        const composited: Rgb = bg.alpha > 0.99
          ? bg.rgb
          : ([0, 1, 2].map((i) => Math.round((bg.rgb[i] ?? 0) * bg.alpha + (baseBg.rgb[i] ?? 0) * (1 - bg.alpha))) as Rgb);
        out.push({ scope: sc.name, bg: bgName, fg: fg.rgb, bgRgb: composited });
      }
    }
    return out;
  };

  const assertAll = (token: string, minPairs: number) => {
    const ps = pairs(token);
    expect(ps.length, `--${token} 조합을 못 만들었다 — 시험이 낡았다`).toBeGreaterThanOrEqual(minPairs);
    for (const p2 of ps) {
      const r = contrast(p2.fg, p2.bgRgb);
      expect(
        r,
        `${p2.scope} 안에서 --${token}(${p2.fg.join(',')}) on --${p2.bg}(${p2.bgRgb.join(',')}) = ${r.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  };

  it('[1] 보조 텍스트(--n-500)가 모든 배경·테마에서 4.5:1 이상이다', () => {
    /*
       ★★ 이 토큰이 명암비 미달의 **단일 최대 원인**이었다. 실측(로그인 후 8개 화면):
         텍스트 1,093개 중 미달 483개 → 그중 340개가 이 토큰 하나.
         58% 일 때 surface 위에서 4.47 — **기준에 간발의 차로** 미달했고,
         그래서 눈으로는 "좀 흐린 정도" 로만 보였다.

       ★ --color-text-tertiary 와 --chart-axis-text 가 이 토큰이다. 보조 문구와 차트 축
         라벨 — 양이 많고 글씨가 작아 접근성 영향이 가장 크다.
    */
    assertAll('n-500', 5);
  });

  it('[2] ★ 브랜드 색이 모든 테마에서 4.5:1 이상이다', () => {
    /*
       ★★ 기본 테마만 고치면 **테마를 바꾼 이용자는 그대로 미달**이다.
         실측: 기본 시안 3.95, quantum-violet 3.97 (둘 다 hover 배경 위).
         브랜드 색은 링크성 문구에 쓰인다("Connect a key →", 활성 탭) — 눌러야 할 것을
         못 보면 기능이 없는 것과 같다.

       ★ 색조·채도는 건드리지 않고 명도만 올렸다 — 브랜드 색상 자체는 유지된다.
    */
    assertAll('brand-primary-500', 10);
  });

  it('[3] 본문 텍스트 토큰이 몰래 낮아지지 않는다', () => {
    /* ★ 위 두 시험은 원인이 된 토큰을 콕 집어 지킨다. 이 시험은 나머지를 지킨다 —
         새 토큰이 추가되거나 기존 값이 조정될 때가 위험하다. */
    for (const t of ['color-text-primary', 'color-text-secondary', 'color-text-tertiary']) {
      assertAll(t, 5);
    }
  });
});
