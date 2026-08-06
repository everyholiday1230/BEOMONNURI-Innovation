// Phase 6 §8 — browser launch capability probe. Attempts to launch each engine and render a page,
// recording per-browser Passed/Failed so downstream E2E status is honest (WebKit ≠ Safari-on-device).
import { chromium, firefox, webkit } from '@playwright/test';

const engines = { chromium, firefox, webkit };
const results = {};
for (const [name, type] of Object.entries(engines)) {
  try {
    const browser = await type.launch();
    const page = await browser.newPage();
    await page.setContent('<h1 id="t">ok</h1>');
    const text = await page.textContent('#t');
    await browser.close();
    results[name] = text === 'ok' ? 'Passed(launch+render)' : 'Failed(render)';
  } catch (e) {
    results[name] = `Failed(launch): ${(e.message || String(e)).split('\n')[0]}`;
  }
}
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
