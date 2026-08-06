import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Prompt-3 §21 control re-evaluation.
 *
 * The Prompt-2 User Control Inventory (248 IDs) was a report-only artifact and is no longer on disk,
 * so rather than trusting a remembered number this spec RE-DERIVES the inventory from the running
 * app: every route is visited, every interactive control is enumerated, and each one is recorded with
 * the evidence needed to judge whether it is wired up (accessible name, disabled state, dead-link
 * shape, cross-origin href, testid).
 *
 * It is a measurement run, not a gate — the acceptance assertions live in the other specs. Output is
 * written to QT_CTRL_OUT for the report.
 */

const OUT = process.env.QT_CTRL_OUT ?? '/tmp/qt-ctrl-p3';

const ROUTES = [
  '/login',
  '/signup',
  '/markets',
  '/trade',
  '/trade/ai',
  '/trade/layout',
  '/portfolio',
  '/notifications',
  '/account',
  '/account/security',
  '/settings',
  '/design-system',
  '/status',
  '/no-such-route',
] as const;

interface RawControl {
  tag: string;
  role: string;
  testid: string;
  name: string;
  disabled: boolean;
  deadLink: boolean;
  externalOrigin: string;
  type: string;
}

interface Control extends RawControl {
  route: string;
  viewport: string;
  id: string;
}

/** Snapshot every visible interactive control currently in the DOM. */
function collect(page: Page): Promise<RawControl[]> {
  return page.evaluate(() => {
    const SEL =
      'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="link"], [role="menuitem"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
    const origin = location.origin;
    const seen = new Set<Element>();
    return Array.from(document.querySelectorAll(SEL))
      .filter((n) => {
        if (seen.has(n)) return false;
        seen.add(n);
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || r.height > 0);
      })
      .map((n) => {
        const el = n as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const href = el.getAttribute('href') ?? '';
        const labelledby = el.getAttribute('aria-labelledby');
        const label =
          el.getAttribute('aria-label') ??
          (labelledby ? (document.getElementById(labelledby)?.textContent ?? '') : '');
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
        let externalOrigin = '';
        if (/^[a-z]+:\/\//i.test(href)) {
          try {
            const u = new URL(href);
            if (u.origin !== origin) externalOrigin = u.origin;
          } catch {
            externalOrigin = 'unparseable';
          }
        }
        return {
          tag,
          role: el.getAttribute('role') ?? '',
          testid: el.getAttribute('data-testid') ?? '',
          name:
            label ||
            text ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') ||
            el.getAttribute('name') ||
            (el as HTMLInputElement).value ||
            '',
          disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
          deadLink: tag === 'a' && (href === '' || href === '#'),
          externalOrigin,
          type: (el as HTMLInputElement).type ?? '',
        };
      });
  });
}

test('[CTRL] enumerate every user interactive control per route', async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  const all: Control[] = [];

  const push = (route: string, viewport: string, raw: RawControl[], scope: string) => {
    raw.forEach((c, i) => {
      const slug = c.testid || `${c.role || c.tag}${c.type ? `:${c.type}` : ''}#${scope}${i}`;
      all.push({ ...c, route, viewport, id: `USR${route.replace(/\//g, '-')}::${slug}` });
    });
  };

  for (const viewport of [
    { w: 1440, h: 900, name: '1440x900' },
    { w: 360, h: 800, name: '360x800' },
  ]) {
    await page.setViewportSize({ width: viewport.w, height: viewport.h });

    for (const route of ROUTES) {
      await page.goto(route);
      // NOTE: deliberately NOT waitForLoadState('networkidle'). This app keeps market polling/WS
      // traffic open, so networkidle never settles and every route would burn the step timeout.
      await page
        .locator('main, form, body')
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => undefined);
      await page.waitForTimeout(400);

      // Reveal controls behind collapsed surfaces so the inventory is not biased toward whatever
      // happens to be open on first paint.
      for (const opener of ['[data-testid="mobile-nav-toggle"]', '[data-testid="account-menu-toggle"]']) {
        const el = page.locator(opener).first();
        if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
          await el.click({ timeout: 1500 }).catch(() => undefined);
          await page.waitForTimeout(150);
          push(route, viewport.name, await collect(page), 'open');
          await page.keyboard.press('Escape').catch(() => undefined);
        }
      }

      push(route, viewport.name, await collect(page), 'base');

      // Walk each tab strip so tab-panel controls are counted too. Bounded on purpose: a click that
      // does not settle quickly is not worth blocking the whole inventory on.
      const tabs = page.locator('[role="tab"]');
      const tabCount = Math.min(await tabs.count(), 8);
      for (let i = 0; i < tabCount; i += 1) {
        await tabs
          .nth(i)
          .click({ timeout: 1500, noWaitAfter: true })
          .catch(() => undefined);
        await page.waitForTimeout(250);
        push(route, viewport.name, await collect(page), `tab${i}-`);
      }
    }
  }

  const unique = new Map<string, Control>();
  for (const c of all) if (!unique.has(c.id)) unique.set(c.id, c);
  const list = [...unique.values()];

  const summary = {
    totalControlInstances: all.length,
    uniqueControlIds: list.length,
    perRoute: ROUTES.map((r) => ({ route: r, unique: list.filter((c) => c.route === r).length })),
    namedControls: list.filter((c) => c.name).length,
    unnamed: list.filter((c) => !c.name).map((c) => c.id),
    deadLinks: list.filter((c) => c.deadLink).map((c) => c.id),
    externalOrigins: list.filter((c) => c.externalOrigin).map((c) => `${c.id} -> ${c.externalOrigin}`),
    disabledCount: list.filter((c) => c.disabled).length,
  };

  writeFileSync(`${OUT}/controls.json`, JSON.stringify({ summary, controls: list }, null, 2));
  writeFileSync(
    `${OUT}/controls.tsv`,
    ['id\troute\tviewport\ttag\trole\tname\tdisabled\tdeadLink']
      .concat(
        list.map((c) =>
          [c.id, c.route, c.viewport, c.tag, c.role, c.name, String(c.disabled), String(c.deadLink)].join('\t'),
        ),
      )
      .join('\n'),
  );
  console.log('[CTRL]', JSON.stringify(summary, null, 2));
});
