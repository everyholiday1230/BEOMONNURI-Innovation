/*
   비로그인 첫 화면 테마(`src/landing-claude.css`) 를 잠근다.

   운영자 요청(2026-09-19): "로그인 전 페이지 디자인 좀 예쁘게 해줘."

   ★★★ 가장 큰 위험은 **이 테마가 앱으로 새는 것**이다. 거래 화면은 어두운
     institutional 테마를 쓴다 — 차트·호가·손익을 오래 보는 화면이고, 밝은
     배경으로 바뀌면 눈이 피로하고 롱/숏 색 판별도 달라진다. 토큰을 전역에
     풀어놓으면 그 일이 조용히 일어난다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (x: string) => x.replace(/\/\*[\s\S]*?\*\//gu, '');

describe('랜딩 테마가 앱으로 새지 않는다', () => {
  const css = stripComments(read('src/landing-claude.css'));

  /** 최상위 선택자 목록 (@media 안쪽까지 펼친다). */
  function selectors(): string[] {
    const out: string[] = [];
    /* @media 블록을 먼저 벗겨 낸다 — 안쪽 규칙도 같은 기준으로 봐야 한다. */
    const flat = css.replace(/@media[^{]*\{/gu, '').replace(/\}\s*\}/gu, '}');
    for (const m of flat.matchAll(/([^{}]+)\{[^{}]*\}/gu)) {
      /* ★ noUncheckedIndexedAccess 때문에 m[1] 이 undefined 일 수 있다고 본다.
           캡처 그룹이 필수이므로 실제로는 항상 있지만, 단정하지 않고 건너뛴다. */
      const group = m[1];
      if (!group) continue;
      for (const sel of group.split(',')) {
        const s = sel.trim();
        if (s && !s.startsWith('@')) out.push(s);
      }
    }
    return out;
  }

  /*
     ★★ 허용되는 뿌리는 **로그인 전 화면 두 개**뿐이다: 랜딩(`.landing-shell`) 과
       로그인·가입(`.auth-shell`). 경계는 로그인 전/후다.
     ★ `:root` 나 `body` 같은 전역 선택자가 하나라도 들어오면 거래 화면이 밝아진다.
  */
  const ALLOWED_ROOTS = ['.landing-shell', '.auth-shell'];

  it('모든 규칙이 로그인 전 화면 안쪽으로 한정된다', () => {
    const bad = selectors().filter((s) => !ALLOWED_ROOTS.some((r) => s.includes(r)));
    expect(bad, `앱까지 번지는 선택자: ${bad.join(' | ')}`).toEqual([]);
  });

  it('전역 선택자를 쓰지 않는다', () => {
    const globals = selectors().filter((s) => /^(:root|html|body|\*)\b/u.test(s.trim()));
    expect(globals, `전역 선택자: ${globals.join(' | ')}`).toEqual([]);
  });

  /*
     ★★★ 처음에 배경 토큰을 4개만 덮었더니 `.landing-step` 이 쓰는
       `--color-bg-panel` 이 어두운 채로 남아, 종이 위에 남색 카드가 뜨고
       그 안 글자 대비가 **2.23:1** 이 됐다. 눈으로만 봤으면 넘어갈 수 있었다.
     ★ 그래서 앱이 쓰는 배경 토큰을 **하나도 빠뜨리지 않는지** 확인한다.
  */
  it('앱이 쓰는 배경 토큰을 하나도 빠뜨리지 않는다', () => {
    const tokens = stripComments(read('src/tokens.css'));
    /* 어두운 테마(:root) 블록에서 선언된 배경 토큰 이름을 모은다. */
    const root = tokens.slice(0, tokens.indexOf('[data-theme="light"]'));
    const need = [...new Set([...root.matchAll(/(--color-bg-[a-z-]+)\s*:/gu)].map((m) => m[1]))];
    expect(need.length, '배경 토큰을 찾지 못했다').toBeGreaterThan(3);
    const missing = need.filter((t) => !new RegExp(`${t}\\s*:`, 'u').test(css));
    expect(missing, `덮지 않은 배경 토큰: ${missing.join(', ')}`).toEqual([]);
  });

  it('글자 토큰도 전부 덮는다', () => {
    for (const t of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary']) {
      expect(css, `${t} 를 덮지 않았다`).toMatch(new RegExp(`${t}\\s*:`, 'u'));
    }
  });
});

describe('예쁘게 만들면서 읽기 쉬움을 잃지 않는다', () => {
  const css = stripComments(read('src/landing-claude.css'));

  /*
     ★★★ clay(#D97757 계열) 바탕에 흰 글자는 대비가 3.2:1 로 AA(4.5) 미달이다.
       주 버튼은 **잉크색**이어야 한다. 예쁘게 하려고 읽기 어려운 버튼을 만들 수 없다.
  */
  it('주 버튼이 잉크색이다 (clay 바탕이 아니다)', () => {
    const i = css.indexOf('.landing-shell .btn--primary {');
    expect(i, '주 버튼 규칙이 없다').toBeGreaterThan(-1);
    const block = css.slice(i, css.indexOf('}', i));
    expect(block, '주 버튼 배경이 잉크색이 아니다')
      .toMatch(/background:\s*var\(--color-text-primary\)/u);
    expect(block, 'clay 를 버튼 배경으로 쓰면 대비가 부족하다')
      .not.toMatch(/background:\s*var\(--color-brand\)/u);
  });

  /*
     ★★ 작은 글자용으로 더 진한 clay 를 따로 둔다. 하나만 두면 누군가
       10px 라벨에 밝은 clay 를 쓰고 대비가 3:1 로 떨어진다.
  */
  it('작은 글자용 진한 clay 를 따로 둔다', () => {
    expect(css, '--color-brand-strong 이 없다').toMatch(/--color-brand-strong\s*:/u);
  });

  /*
     ★★★ 상단 고지 띠는 법적 고지다. 예쁘게 만들려고 흐리게 하는 것은 숨기는 것이다.
       투명도로 지우지 않았는지 본다.
  */
  it('상단 고지 띠를 흐리게 하지 않는다', () => {
    const i = css.indexOf('.landing-shell .sim-stripe {');
    expect(i, '고지 띠 규칙이 없다').toBeGreaterThan(-1);
    const block = css.slice(i, css.indexOf('}', i));
    expect(block, '고지 띠를 opacity 로 흐리게 했다').not.toMatch(/opacity\s*:/u);
    expect(block, '고지 띠를 숨겼다').not.toMatch(/display\s*:\s*none/u);
  });

  /*
     ★ sticky 머리말 때문에 섹션으로 뛰어가면 제목이 가려진다. 스크롤 컨테이너에
       여유를 준다(스크롤되는 것은 body 가 아니라 `.landing-shell` 이다).
  */
  it('앵커 이동 시 제목이 머리말에 가려지지 않는다', () => {
    expect(css, 'scroll-padding-top 이 없다').toMatch(/scroll-padding-top\s*:\s*\d+px/u);
  });

  it('움직임 줄이기 설정을 존중한다', () => {
    expect(css, 'prefers-reduced-motion 처리가 없다').toMatch(/prefers-reduced-motion/u);
  });
});

describe('랜딩은 연결 가능한 거래소만 센다', () => {
  const jsx = read('src/pages-auth.jsx');

  /*
     ★★★ `/api/v1/exchanges` 는 기본값으로 `connectable:false` 여도 **막힌 이유가
       붙은** 거래소를 함께 준다(연결 화면이 이유를 말하기 위해서다). 그것을 그대로
       쓰니 랜딩이 BitMart 를 "Supported exchanges" 로 보여주고 숫자도 3 으로 적었다.
       BitMart 는 2026-08-26 로 거래를 종료했다.
     ★★ 비로그인 방문자는 그 카드에서 이유를 볼 방법이 없다. 첫 화면에서 "3개 지원"
       을 읽고 가입한 뒤 2개인 것을 알면 그건 약속을 어긴 것이다.
  */
  it('connectable 이 참인 것만 남긴다', () => {
    const i = jsx.indexOf('const landingExchanges =');
    expect(i, 'landingExchanges 를 찾지 못했다').toBeGreaterThan(-1);
    const block = jsx.slice(i, i + 260);
    expect(block, '연결 가능 여부로 걸러내지 않는다')
      .toMatch(/filter\(\(e\) => e\.connectable === true\)/u);
  });

  /*
     ★ 히어로의 강조 구절이 인라인 style 이면 테마가 색을 조정할 수 없다.
       큰 글자라도 대비 여유가 없어서 테마 쪽에서 더 진한 값을 써야 할 수 있다.
  */
  it('히어로 강조 구절이 인라인 style 이 아니다', () => {
    const i = jsx.indexOf('landing-hero__title');
    const block = jsx.slice(i, i + 1400);
    expect(block, '인라인 style 로 색을 박아 두면 테마가 손댈 수 없다')
      .not.toMatch(/<span style=\{\{color:/u);
    expect(block, '강조 구절 클래스가 없다').toMatch(/className="is-accent"/u);
  });
});

describe('그라데이션이 회색을 거치지 않는다', () => {
  /*
     ★★★ `transparent` 는 `rgba(0, 0, 0, 0)` 이다. 그라데이션의 끝점으로 쓰면
       **검정을 거쳐** 보간되어, 밝은 배경에서 회색 얼룩이 생긴다.

     실측(2026-09-19): 로그인 화면 소개 패널이 종이색인데 가운데·아래가 지저분한
     청회색이었다. 원인은 두 가지였다:
       · `.auth-hero-bg` 의 파란 발광(hue 220) — 어두운 테마용
       · 그 위의 남색 오버레이 `oklch(14% 0.012 240 / 0.5)`
     둘을 따뜻한 색으로 바꾸고, 끝점을 **같은 색의 알파 0** 으로 두어 색조를 지켰다.

     ★ 이 함정은 다크→라이트 전환에서 반복된다. 종이 테마 파일 안에서는
       `transparent` 를 아예 쓰지 않도록 잠근다.
  */
  const css = stripComments(read('src/landing-claude.css'));

  it('종이 테마에서 transparent 끝점을 쓰지 않는다', () => {
    const hits = [...css.matchAll(/gradient\([^;]*?\btransparent\b[^;]*?\)/gsu)].map((m) => m[0].slice(0, 90));
    expect(hits, `transparent 로 끝나는 그라데이션: ${hits.join(' | ')}`).toEqual([]);
  });

  /*
     ★★ 어두운 테마용 파란/남색 레이어가 **그라데이션에** 남아 있으면 종이 위에서
       넓은 회색 얼룩으로 보인다. 그래서 그라데이션 안쪽만 본다.
     ★ 반대로 `--color-info` 같은 **의미가 있는 단색**은 파랑이어야 한다. 정보색을
       따뜻하게 바꾸면 경고색과 구별되지 않는다 — 처음에 이것까지 막았다가
       시험이 지나치게 엄격하다는 것을 알았다.
  */
  it('그라데이션에 차가운 색조를 쓰지 않는다', () => {
    const cold: string[] = [];
    for (const g of css.matchAll(/(?:radial|linear)-gradient\([^;]*?\)(?=\s*[,;])/gsu)) {
      for (const c of g[0].matchAll(/oklch\([^)]*?\s(2[0-9]{2}|3[0-9]{2})(?:\.[0-9]+)?\s*[/)]/gu)) {
        cold.push(c[0]);
      }
    }
    expect(cold, `그라데이션에 차가운 색조가 남아 있다: ${cold.join(' | ')}`).toEqual([]);
  });
});

describe('로그인·가입 화면도 같은 숫자를 말한다', () => {
  const jsx = read('src/pages-auth.jsx');

  /*
     ★★★ 랜딩만 고쳤다가 가입 화면이 "3 CHART DATA SOURCES" 로 남으면, **같은
       방문자가 두 화면에서 다른 숫자를 본다.** 숫자가 서로 다르면 둘 다 못 믿는다.
  */
  it('가입 화면도 연결 가능한 거래소만 센다', () => {
    const i = jsx.indexOf('const heroExCount');
    expect(i, 'heroExCount 를 찾지 못했다').toBeGreaterThan(-1);
    const block = jsx.slice(i, i + 220);
    expect(block, '연결 가능 여부로 걸러내지 않는다')
      .toMatch(/filter\(\(e\) => e\.connectable === true\)/u);
  });
});
