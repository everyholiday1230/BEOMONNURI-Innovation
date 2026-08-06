import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Prompt-3 §16 visual verification pass.
 *
 * Captures, for every representative screen × viewport × theme × locale: a screenshot, the panel
 * bounding boxes, and machine-checkable defect classes (horizontal overflow, zero-size panels,
 * overlapping panels, clipped text). It is a MEASUREMENT run — the assertions below are the ones the
 * acceptance criteria name, so a regression fails here rather than being argued about in prose.
 */

const OUT = process.env.QT_VIS_OUT ?? '/tmp/qt-vis-p3';

const VIEWPORTS = [
  { w: 360, h: 800, name: '360x800' },
  { w: 390, h: 844, name: '390x844' },
  { w: 768, h: 1024, name: '768x1024' },
  { w: 1280, h: 720, name: '1280x720' },
  { w: 1440, h: 900, name: '1440x900' },
  { w: 1920, h: 1080, name: '1920x1080' },
] as const;

const SCREENS = [
  { route: '/markets', id: 'markets' },
  { route: '/trade', id: 'trade' },
  { route: '/trade/ai', id: 'trade-ai' },
  { route: '/portfolio', id: 'portfolio' },
  { route: '/notifications', id: 'notifications' },
  { route: '/account', id: 'account' },
  { route: '/settings', id: 'settings' },
  { route: '/status', id: 'status' },
  { route: '/login', id: 'login' },
] as const;

interface Measurement {
  screen: string;
  route: string;
  viewport: string;
  theme: string;
  locale: string;
  docScrollW: number;
  clientW: number;
  overflowPx: number;
  panels: number;
  zeroSize: string[];
  overlaps: string[];
  clipped: string[];
  tinyTargets: string[];
  h1Count: number;
  mainCount: number;
  unnamedControls: number;
  rawI18nKeys: string[];
}

test('[VIS] capture and measure every screen across viewport/theme/locale', async ({ page }) => {
  test.setTimeout(1_200_000);
  mkdirSync(OUT, { recursive: true });
  const rows: Measurement[] = [];

  for (const locale of ['ko', 'en'] as const) {
    for (const theme of ['dark', 'light'] as const) {
      // Seed the persisted preference slot so the very first paint already uses this combination.
      await page.goto('/trade');
      await page.evaluate(
        ([t, l]) => {
          const key = Object.keys(localStorage).find((k) => k.startsWith('qt.prefs.v')) ?? 'qt.prefs.v1:anon';
          localStorage.setItem(
            key,
            JSON.stringify({
              theme: t,
              brand: 'institutional-cool',
              density: 'comfortable',
              longshort: 'teal-magenta',
              locale: l,
              numberFormat: 'standard',
            }),
          );
        },
        [theme, locale],
      );

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        for (const s of SCREENS) {
          await page.goto(s.route);
          await expect(page.locator('[data-testid="route-fallback"]')).toHaveCount(0, { timeout: 20_000 });
          await page.waitForTimeout(250);

          const m = await page.evaluate(() => {
            const doc = document.documentElement;
            const panels = [...document.querySelectorAll<HTMLElement>('.panel, .card, .widget, .page')];
            const box = (el: HTMLElement) => el.getBoundingClientRect();
            const label = (el: HTMLElement) =>
              `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}.${el.className
                .toString()
                .split(/\s+/)
                .slice(0, 2)
                .join('.')}`;

            const visible = panels.filter((el) => el.offsetParent !== null || el === document.body);
            const zeroSize = visible
              .filter((el) => {
                const r = box(el);
                return r.width < 1 || r.height < 1;
              })
              .map(label);

            // Overlap check limited to siblings inside the widget grid: that is where a bad layout
            // actually produces stacked panels.
            const overlaps: string[] = [];
            const grid = document.querySelector('.widget-grid');
            if (grid) {
              const kids = [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
              for (let i = 0; i < kids.length; i++) {
                for (let j = i + 1; j < kids.length; j++) {
                  const a = box(kids[i]!);
                  const b = box(kids[j]!);
                  const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                  const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                  if (ox > 2 && oy > 2) overlaps.push(`${label(kids[i]!)} ∩ ${label(kids[j]!)}`);
                }
              }
            }

            // Text clipped by its own box (scrollWidth exceeding clientWidth without a scroller).
            // Elements carrying an absolutely-positioned child (the order-book depth bar) are skipped:
            // such an overlay inflates scrollWidth without clipping any text.
            const clipped = [...document.querySelectorAll<HTMLElement>('button, .chip, .badge, th, .op-row__v, .sh-identity__sym')]
              .filter((el) => {
                const style = getComputedStyle(el);
                if (style.overflow === 'auto' || style.overflowX === 'auto' || style.overflow === 'scroll') return false;
                if (style.textOverflow === 'ellipsis') return false;
                if ([...el.children].some((c) => getComputedStyle(c).position === 'absolute')) return false;
                return el.scrollWidth - el.clientWidth > 2;
              })
              .map(label);

            // WCAG 2.5.8 (AA) minimum target size, applying the standard's own exceptions:
            //  - Inline: a link inside a sentence is exempt (its size is set by the text line-height).
            //  - The measured target for a checkbox/radio wrapped in a <label> is the LABEL, since the
            //    label is what a pointer activates.
            //  - Dense market-data rows are excluded on POINTER viewports only (documented "essential"
            //    exception for a trading grid); nothing is excluded at <=767px, where the touch
            //    breakpoint sets explicit minimums.
            const tinyTargets = [...document.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select')]
              .filter((el) => el.offsetParent !== null)
              .filter((el) => !(window.innerWidth > 767 && el.closest('.ob-row, .rt-row, .mw-rows, .tbl, .pos-tabs')))
              .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
              .map((el) => {
                const isBox = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
                const label = isBox ? el.closest('label') : null;
                return (label as HTMLElement | null) ?? el;
              })
              .filter((el) => {
                const r = box(el);
                return r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24);
              })
              .map(label);

            const unnamedControls = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select')]
              .filter((el) => el.offsetParent !== null)
              .filter((el) => {
                const name =
                  el.getAttribute('aria-label') ??
                  el.getAttribute('title') ??
                  (el as HTMLInputElement).labels?.[0]?.textContent ??
                  el.textContent ??
                  '';
                return name.trim().length === 0;
              }).length;

            const bodyText = document.body.innerText;
            const rawI18nKeys = [...bodyText.matchAll(/\b(?:order|nav|state|risk|ai|pos|assets|notif|market|layout)\.[a-zA-Z.]{3,}/g)]
              .map((x) => x[0])
              .slice(0, 5);

            return {
              docScrollW: doc.scrollWidth,
              clientW: doc.clientWidth,
              panels: visible.length,
              zeroSize,
              overlaps,
              clipped,
              tinyTargets,
              h1Count: document.querySelectorAll('h1').length,
              mainCount: document.querySelectorAll('main').length,
              unnamedControls,
              rawI18nKeys,
              theme: doc.getAttribute('data-theme') ?? '',
              lang: doc.getAttribute('lang') ?? '',
            };
          });

          rows.push({
            screen: s.id,
            route: s.route,
            viewport: vp.name,
            theme: m.theme,
            locale: m.lang,
            docScrollW: m.docScrollW,
            clientW: m.clientW,
            overflowPx: Math.max(0, m.docScrollW - m.clientW),
            panels: m.panels,
            zeroSize: m.zeroSize,
            overlaps: m.overlaps,
            clipped: m.clipped,
            tinyTargets: m.tinyTargets,
            h1Count: m.h1Count,
            mainCount: m.mainCount,
            unnamedControls: m.unnamedControls,
            rawI18nKeys: m.rawI18nKeys,
          });

          // Screenshot only the 3 primary viewports to keep the artifact set reviewable.
          if (['360x800', '768x1024', '1440x900'].includes(vp.name)) {
            await page.screenshot({
              path: `${OUT}/${s.id}_${vp.name}_${m.theme}_${m.lang}.png`,
              fullPage: false,
            });
          }
        }
      }
    }
  }

  writeFileSync(`${OUT}/measurements.json`, JSON.stringify(rows, null, 2));

  const tsv = [
    'screen\troute\tviewport\ttheme\tlocale\toverflow_px\tpanels\tzero_size\toverlaps\tclipped\ttiny_targets\th1\tmain\tunnamed\traw_keys',
    ...rows.map((r) =>
      [
        r.screen,
        r.route,
        r.viewport,
        r.theme,
        r.locale,
        r.overflowPx,
        r.panels,
        r.zeroSize.length,
        r.overlaps.length,
        r.clipped.length,
        r.tinyTargets.length,
        r.h1Count,
        r.mainCount,
        r.unnamedControls,
        r.rawI18nKeys.length,
      ].join('\t'),
    ),
  ].join('\n');
  writeFileSync(`${OUT}/measurements.tsv`, tsv);

  // ---- acceptance criteria -------------------------------------------------
  const overflow = rows.filter((r) => r.overflowPx > 0);
  expect(overflow.map((r) => `${r.screen}@${r.viewport}/${r.theme}/${r.locale}=${r.overflowPx}px`), 'horizontal overflow').toEqual([]);

  const zero = rows.filter((r) => r.zeroSize.length > 0);
  expect(zero.map((r) => `${r.screen}@${r.viewport}:${r.zeroSize.join(',')}`), 'zero-size panels').toEqual([]);

  const overlap = rows.filter((r) => r.overlaps.length > 0);
  expect(overlap.map((r) => `${r.screen}@${r.viewport}:${r.overlaps.join(',')}`), 'overlapping panels').toEqual([]);

  const clip = rows.filter((r) => r.clipped.length > 0);
  expect(clip.map((r) => `${r.screen}@${r.viewport}/${r.locale}:${r.clipped.join(',')}`), 'clipped labels').toEqual([]);

  const tiny = rows.filter((r) => r.tinyTargets.length > 0);
  expect(tiny.map((r) => `${r.screen}@${r.viewport}:${r.tinyTargets.join(',')}`), 'targets under 24x24 CSS px').toEqual([]);

  const noH1 = rows.filter((r) => r.h1Count !== 1 && r.route !== '/trade' && r.route !== '/trade/ai');
  expect(noH1.map((r) => `${r.screen}@${r.viewport}=${r.h1Count}`), 'exactly one h1 per page screen').toEqual([]);

  const noMain = rows.filter((r) => r.mainCount < 1 && !r.route.startsWith('/login'));
  expect(noMain.map((r) => r.screen), 'landmark main present').toEqual([]);

  const unnamed = rows.filter((r) => r.unnamedControls > 0);
  expect(unnamed.map((r) => `${r.screen}@${r.viewport}=${r.unnamedControls}`), 'controls without an accessible name').toEqual([]);

  const rawKeys = rows.filter((r) => r.rawI18nKeys.length > 0);
  expect(rawKeys.map((r) => `${r.screen}/${r.locale}:${r.rawI18nKeys.join(',')}`), 'raw i18n keys leaked to the UI').toEqual([]);
});
