import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * 모바일 레이아웃 — **조작 요소를 덮지 않는 구조**를 소스에서 지킨다.
 *
 * ★ 실제 판정은 `tests/e2e/zz-mobile-occlusion.spec.ts` 가 브라우저에서 픽셀로 한다.
 *   그 스펙은 API 서버·빌드가 필요해 무겁다. 이 파일은 **같은 결함을 값싸게** 잡는다 —
 *   `pnpm -r test` 로 매번 돌아가므로 되돌림이 커밋을 통과하지 못한다.
 */
describe('MOBILE-LAYOUT — 사이드바·툴바가 조작 요소를 덮지 않는다', () => {
  const css = read('src/mobile.css');
  /* 주석에 옛 선택자가 예시로 남아 있으므로 반드시 지운다. */
  const code = css.replace(/\/\*[\s\S]*?\*\//gu, '');

  it('[1] ★★ 셸 2종 × 사이드바 2종 = 네 조합을 모두 서랍으로 만든다', () => {
    /*
       ★★★ 왜 네 조합인가

         셸이 둘(`.app-shell`, `.page-shell`), 사이드바가 둘(`.app-sidebar`,
         `.app-sidebar-v2`) 인데 규칙이 **대각선으로만** 있었다:

           .app-shell  > .app-sidebar      ✔
           .app-shell  > .app-sidebar-v2   ✘  ← /trade 가 이 조합이다
           .page-shell > .app-sidebar-v2   ✔
           .page-shell > .app-sidebar      ✘

         그래서 `/trade` 는 모바일에서 사이드바가 흐름에 남았다. 실측(390×844):
         본문이 **123px**, 사이드바가 267px 로 차트 위에 겹쳐 그려져
         **조작요소 39개가 눌리지 않았다**(차트 툴바 전체 + 그리기 도구 전부).

       ★★ 선택자가 파일 어딘가에 있는 것으로는 부족하다 — **서랍으로 만드는 규칙
         (position: fixed + transform)** 안에 있어야 한다. 처음에 `toContain` 으로만
         검사했더니, 선택자를 그 규칙에서 지워도 아래 `pointer-events` 규칙에 남아
         있어서 **시험이 통과했다.** 역검증으로 잡았다.
    */
    const blocks = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .map((m) => ({ sel: m[1]!, body: m[2]! }));

    const drawer = blocks.filter((b) => /position:\s*fixed/u.test(b.body) && /translateX\(-100%\)/u.test(b.body));
    expect(drawer.length, '사이드바를 서랍으로 만드는 규칙(position:fixed + translateX(-100%))을 찾지 못했다')
      .toBeGreaterThan(0);
    const drawerSel = drawer.map((b) => b.sel).join(' ');

    for (const shell of ['.app-shell', '.page-shell']) {
      for (const bar of ['.app-sidebar', '.app-sidebar-v2']) {
        const sel = `${shell} > ${bar}`;
        expect(drawerSel, `서랍 규칙에 ${sel} 가 없다 — 그 조합의 화면은 사이드바가 본문을 덮는다`)
          .toContain(sel);
      }
    }

    /* 열림 규칙에도 같은 네 조합이 있어야 한다 — 없으면 서랍이 열리지 않는다. */
    const open = blocks.filter((b) => /translateX\(0\)/u.test(b.body)).map((b) => b.sel).join(' ');
    for (const shell of ['.app-shell', '.page-shell']) {
      for (const bar of ['.app-sidebar', '.app-sidebar-v2']) {
        expect(open, `열림 규칙에 ${shell} > ${bar} 가 없다 — 서랍이 열리지 않는다`)
          .toContain(`${shell} > ${bar}`);
      }
    }
  });

  it('[2] 닫힌 서랍은 포인터를 받지 않는다', () => {
    /* 화면 밖에 있어도 요소는 살아 있어서 경계에 걸친 조작 요소를 가로챌 수 있다. */
    expect(code).toMatch(/html:not\(\[data-qt-drawer='open'\]\)[\s\S]{0,400}pointer-events:\s*none/u);
  });

  it('[3] ★★ 차트 툴바 자식이 찌그러지지 않는다 (flex-shrink: 0)', () => {
    /*
       ★★★ `overflow-x: auto` 는 **넘칠 때만** 스크롤을 만든다.

         툴바에는 이미 `overflow-x: auto` 가 있었는데 동작하지 않았다. flex 기본값
         `flex-shrink: 1` 때문에 컨테이너들이 12~16px 로 찌그러졌고(실측), 그 안의
         버튼은 자기 크기를 유지하며 밖으로 넘쳐 **서로 겹쳤다.**
         결과: 타임프레임 `15m` 자리를 누르면 `Templates` 가 눌렸다.

       ★ 두 속성은 함께 있어야 의미가 있다. 하나만 있으면 조용히 아무 일도 하지 않는다.
    */
    const m = /\.chart-toolbar > \*[\s\S]{0,220}?\{([\s\S]*?)\}/u.exec(code);
    expect(m, '.chart-toolbar > * 규칙이 없다 — 자식이 찌그러져 버튼이 겹친다').toBeTruthy();
    expect(m![1]!, 'flex-shrink 를 0 으로 두지 않는다').toMatch(/flex:\s*0\s+0\s+auto|flex-shrink:\s*0/u);

    /* 안쪽 그룹들도 같이 고정해야 한다 — 그룹만 고정하면 그 안의 버튼이 찌그러진다. */
    for (const g of ['.chart-tf > *', '.chart-tool-wrap > *', '.chart-drawtools > *']) {
      expect(code, `${g} 가 빠졌다`).toContain(g);
    }
  });

  it('[4] 툴바는 가로 스크롤로 둔다 — 넘친 버튼을 숨기지 않는다', () => {
    /*
       ★ 커밋 db3ebd2 에서 "숨기지 말고 넘치게 두자" 고 했는데, 넘친 버튼이 사이드바
         아래로 들어가 아예 못 눌리게 됐다. 숨긴 것보다 나쁘다 — 보이는데 안 눌리면
         고장으로 읽는다. 가로 스크롤이면 모든 버튼에 닿는다.
    */
    expect(code).toMatch(/\.trade-body > \.widget \.chart-tf[\s\S]{0,200}overflow-x:\s*auto/u);
    /* 숨기는 방식으로 되돌아가지 않았는지. */
    expect(code, '툴바를 display:none 으로 숨긴다').not.toMatch(/\.chart-toolbar\s*\{[^}]*display:\s*none/u);
  });

  it('[5] 측정 프로브가 스크롤로 잘린 요소를 가려짐으로 세지 않는다', () => {
    /*
       ★★★ `getBoundingClientRect()` 는 **잘림을 반영하지 않는다.** 스크롤 목록의
         50번째 행도 레이아웃 좌표를 그대로 돌려주므로, 그 자리에서 elementFromPoint
         를 때리면 당연히 다른 것이 나온다.

         그래서 예전 판정은 관심종목 목록의 스크롤된 행 12개를 "가려짐" 으로 셌다
         (컨테이너 clientHeight 71px / scrollHeight 840px). 화면에 없는 것은 가려진
         것이 아니다. 이 오탐 때문에 진짜 결함이 숫자에 묻혔다 — 39건 중 무엇이
         진짜인지 구분되지 않았다.
    */
    const spec = read('tests/e2e/zz-mobile-occlusion.spec.ts');
    expect(spec, '스크롤 조상 판정이 없다 — 잘린 요소를 가려짐으로 센다')
      .toMatch(/visibleInScrollers/u);
    expect(spec, 'localhost 전용 개발 오버레이를 제외하지 않는다')
      .toMatch(/qt-prov-badge/u);
    /* 툴바만 보던 좁은 조건으로 돌아가면 큰 결함이 다시 통과한다. */
    expect(spec, '실패 조건이 chart-toolbar 로만 좁혀졌다')
      .not.toMatch(/const toolbarHits[\s\S]{0,200}expect\(toolbarHits/u);
  });
});
