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
    const els = [
      ...document.querySelectorAll<HTMLElement>('button,a,[role=button]'),
    ].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
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
  test(`[VIS-OCC-${vp.width}] 차트 툴바 버튼이 다른 요소에 가려지지 않는다`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/#/trade');
    await page.waitForTimeout(1500); // 위젯 마운트 + 첫 시세

    const bad = await census(page);
    // eslint-disable-next-line no-console
    console.log(`[VIS-OCC ${vp.width}x${vp.height}] 가려진 조작 요소 ${bad.length}건:`);
    for (const b of bad) console.log(`  대상=${b.label}  ←덮개=${b.cover}`);

    const toolbarHits = bad.filter((b) => /chart-toolbar/.test(b.label));
    expect(toolbarHits, `차트 툴바가 가려짐: ${toolbarHits.map((h) => `${h.label} ← ${h.cover}`).join(' | ')}`).toEqual([]);
  });
}
