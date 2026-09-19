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

  it('모든 규칙이 .landing-shell 안쪽으로 한정된다', () => {
    const bad = selectors().filter((s) => !s.includes('.landing-shell'));
    expect(bad, `앱까지 번지는 선택자: ${bad.join(' | ')}`).toEqual([]);
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
