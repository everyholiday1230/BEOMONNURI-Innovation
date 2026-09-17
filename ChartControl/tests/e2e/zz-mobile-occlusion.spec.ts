import { test, expect } from '@playwright/test';

/**
 * [VIS-OCC] 모바일 조작 요소 가림 측정 — TODO-2026-09-10 §3-1.
 *
 * 증상(기록됨): 모바일 뷰포트에서 차트 툴바의 Compare / Lock drawings 버튼 중심점이
 * `.app-sidebar-v2__scroll` 에 가려져 누를 수 없고, 관심종목 별표 2개가 테이블
 * 헤더(`th`) 아래에 깔린다.
 *
 * 방법: 화면의 모든 button/a/[role=button] 중심에서 elementFromPoint 를 때려
 * 자기 자신(또는 자손·조상)이 돌아오지 않으면 "가려진 것"이다. 이 스펙은
 * (1) 가려진 요소와 그 덮개를 결과에 나열해 수정 대상을 특정하고,
 * (2) 차트 툴바 버튼이 가려지면 실패시킨다(회귀 고정).
 */

interface Occluded {
  label: string;
  cover: string;
}

async function census(page: import('@playwright/test').Page): Promise<Occluded[]> {
  return page.evaluate(() => {
    const desc = (el: Element): string => {
      const c = el as HTMLElement;
      const id = c.id ? `#${c.id}` : '';
      const cls = typeof c.className === 'string' && c.className
        ? `.${c.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
      const text = (c.textContent ?? '').trim().slice(0, 24);
      return `${c.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
    };

    /**
     * ★★★ **스크롤 컨테이너에 잘려 화면에 없는 요소는 "가려진 것"이 아니다.**
     *
     *   `getBoundingClientRect()` 는 **잘림(clip)을 반영하지 않는다.** 스크롤 목록의
     *   50번째 행도 레이아웃상의 좌표를 그대로 돌려주므로, 그 좌표에서
     *   `elementFromPoint` 를 때리면 당연히 다른 것(그 자리에 실제로 그려진 것)이 나온다.
     *
     *   그래서 예전 판정은 **관심종목 목록의 스크롤된 행 12개를 "가려짐" 으로 셌다.**
     *   실측: 목록 컨테이너 clientHeight 71px 인데 scrollHeight 840px — 즉 그 행들은
     *   잘려서 화면에 아예 없다. 화면에 없는 것은 가려진 것이 아니고, 스크롤하면 눌린다.
     *
     *   이 오탐을 고치지 않으면 진짜 결함(사이드바가 차트 툴바를 덮는 것 같은)이
     *   숫자에 묻힌다. 실제로 그랬다 — 39건 중 무엇이 진짜인지 구분되지 않았다.
     *
     * ★ 그래서 조상 중 스크롤 가능한 요소의 보이는 영역 안에 있는지 먼저 확인한다.
     */
    const visibleInScrollers = (el: HTMLElement, r: DOMRect): boolean => {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const scrolls = /(auto|scroll|hidden)/.test(cs.overflowY) || /(auto|scroll|hidden)/.test(cs.overflowX);
        if (!scrolls) continue;
        const nr = n.getBoundingClientRect();
        if (cx < nr.left || cx > nr.right || cy < nr.top || cy > nr.bottom) return false;
      }
      /* 뷰포트 밖도 같은 이유로 제외한다 — 스크롤하면 닿는다. */
      return cy >= 0 && cy <= window.innerHeight && cx >= 0 && cx <= window.innerWidth;
    };

    const els = [
      ...document.querySelectorAll<HTMLElement>('button,a,[role=button]'),
    ].filter((e) => {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(e);
      /* 숨긴 것·포인터를 받지 않는 것은 애초에 누를 대상이 아니다. */
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return false;
      return visibleInScrollers(e, r);
    });
    const bad: Occluded[] = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && !el.contains(top) && !top.contains(el)) {
        bad.push({ label: desc(el), cover: desc(top) });
      }
    }
    return bad;
  });
}

for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  test(`[VIS-OCC-${vp.width}] 조작 요소가 다른 요소에 가려지지 않는다`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/#/trade');
    await page.waitForTimeout(1500); // 위젯 마운트 + 첫 시세

    const bad = await census(page);
    // eslint-disable-next-line no-console
    console.log(`[VIS-OCC ${vp.width}x${vp.height}] 가려진 조작 요소 ${bad.length}건:`);
    for (const b of bad) console.log(`  대상=${b.label}  ←덮개=${b.cover}`);

    /*
       ★★ **`.qt-prov-badge` 는 localhost 전용 개발 오버레이다** — 제외한다.

         `src/provenance.js:326` 이 `/localhost|127\.0\.0\.1/` 일 때만 기본으로 켠다.
         프로덕션 도메인에서 실제로 0개인 것을 확인했다. 개발 화면에만 있는 것을
         고객 영향 결함으로 세면, 진짜 결함이 그 숫자에 묻힌다.
    */
    const real = bad.filter((b) => !/qt-prov-badge/.test(b.cover));

    /*
       ★★★ 왜 툴바만 보지 않고 **전부** 보는가

         예전에는 `chart-toolbar` 만 실패 조건으로 두었다. 그래서 훨씬 큰 결함이
         통과했다 — 모바일에서 **사이드바가 차트 툴바와 그리기 도구 전체를 덮고
         있었다**(실측 39건). 셸·사이드바 클래스 조합이 네 가지인데 모바일 서랍
         규칙이 두 가지만 처리해서 `/trade` 가 빠졌기 때문이다.

       ★ 조건을 좁혀 두면 "그 좁힌 것만" 지켜진다. 가려진 조작 요소는 종류를 가리지
         않고 결함이므로 전부 본다.
    */
    expect(
      real,
      `가려진 조작 요소: ${real.map((h) => `${h.label} ← ${h.cover}`).join(' | ')}`,
    ).toEqual([]);
  });

  /*
     ★★ 사이드바가 흐름에서 빠져 서랍이 되었는지 **구조로** 확인한다.

       가려짐 0 만 보면 우연히 통과할 수 있다(예: 사이드바가 빈 화면 위에 있을 때).
       모바일에서 사이드바는 반드시 `position: fixed` 이고 닫혀 있어야 한다.
  */
  test(`[VIS-OCC-${vp.width}] 모바일 사이드바는 서랍이다 (흐름을 차지하지 않는다)`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/#/trade');
    await page.waitForTimeout(1200);

    const geo = await page.evaluate(() => {
      const sb = document.querySelector('.app-sidebar-v2, .app-sidebar') as HTMLElement | null;
      const main = document.querySelector('.app-main, .page-main') as HTMLElement | null;
      if (!sb || !main) return null;
      const cs = getComputedStyle(sb);
      return {
        position: cs.position,
        drawer: document.documentElement.getAttribute('data-qt-drawer'),
        mainWidth: Math.round(main.getBoundingClientRect().width),
        viewport: window.innerWidth,
      };
    });
    expect(geo, '사이드바나 본문을 찾지 못했다').not.toBeNull();
    expect(geo!.position, '사이드바가 흐름에 남아 있다 — 본문을 밀어내고 차트를 덮는다').toBe('fixed');
    /*
       ★ 본문이 화면 폭을 거의 다 써야 한다. 예전에는 390px 화면에서 본문이 **123px**
         뿐이었다(사이드바가 암시적 그리드 열을 차지했다).
    */
    expect(geo!.mainWidth, `본문이 화면 폭을 못 쓴다: ${geo!.mainWidth}/${geo!.viewport}`)
      .toBeGreaterThan(geo!.viewport * 0.9);
  });

  /*
     ★★ 차트 툴바는 **가로 스크롤**이어야 한다.

       `overflow-x: auto` 는 넘칠 때만 스크롤을 만든다. flex 자식이 `flex-shrink: 1`
       기본값으로 찌그러지면 넘치지 않으므로 스크롤도 생기지 않고, 대신 자식들이
       서로 겹쳐 **다른 버튼이 눌린다.** 실측: 타임프레임 15m 자리에 Templates 가 있었다.
  */
  test(`[VIS-OCC-${vp.width}] 차트 툴바가 찌그러지지 않고 가로 스크롤된다`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/#/trade');
    await page.waitForTimeout(1500);

    const tb = await page.evaluate(() => {
      const el = document.querySelector('.chart-toolbar') as HTMLElement | null;
      if (!el) return null;
      const kids = [...el.children].map((k) => ({
        cls: String(k.className).trim().slice(0, 24),
        w: Math.round(k.getBoundingClientRect().width),
        shrink: getComputedStyle(k as HTMLElement).flexShrink,
      }));
      return { scrollW: el.scrollWidth, clientW: el.clientWidth, overflowX: getComputedStyle(el).overflowX, kids };
    });
    expect(tb, '차트 툴바를 찾지 못했다').not.toBeNull();
    expect(tb!.overflowX, '가로 스크롤이 꺼져 있다').toMatch(/auto|scroll/);
    /* 자식이 줄어들지 않아야 한다 — 줄어들면 안의 버튼이 밖으로 넘쳐 겹친다. */
    const shrinking = tb!.kids.filter((k) => k.shrink !== '0');
    expect(shrinking, `툴바 자식이 찌그러진다: ${shrinking.map((k) => `${k.cls}(shrink=${k.shrink})`).join(', ')}`)
      .toEqual([]);
    /* 내용이 실제로 넘쳐야 스크롤이 의미가 있다(모바일 폭에서는 반드시 넘친다). */
    expect(tb!.scrollW, `툴바가 넘치지 않는다 — 자식이 찌그러졌을 수 있다 (${tb!.scrollW}/${tb!.clientW})`)
      .toBeGreaterThan(tb!.clientW);
  });
}
