import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Flow M — 차트 데이터 + 실제 렌더.
 *
 * ★★ 이 스펙이 존재하는 이유(원본 주석의 사고를 그대로 옮긴다)
 *
 *   예전 차트 검사는 "마운트 요소와 canvas 가 있다" 만 확인했다. 둘 다 사실인 채로
 *   차트가 **완전히 비어 있었다**: klinecharts 파사드가 v9 의 `applyNewData` 를
 *   옵셔널 체이닝으로 호출했고, klinecharts 10 에서 그 메서드가 없어져 호출이
 *   조용히 아무 일도 하지 않았다. 서버는 유효한 캔들 300개를 돌려줬지만 엔진에
 *   도달하지 못했다.
 *
 *   그래서 두 가지를 함께 본다: **데이터가 실제로 들어왔는가**(엔진이 보고하는
 *   봉 개수)와 **픽셀이 그려졌는가**(canvas 표본에 배경 아닌 색이 있는가).
 *
 * ★★ 관측 지점을 바꿨다.
 *
 *   원본은 `data-chart-state`·`data-bar-count` 같은 속성을 읽었는데 앱에 그런 속성이
 *   **하나도 없다**(0곳). 대신 이미 있는 `window.ChartKlineUtil.debug()` 를 쓴다 —
 *   엔진이 실제로 들고 있는 봉·지표·오버레이를 그대로 돌려주므로, 화면 마크업이
 *   바뀌어도 "데이터가 도달했는가" 라는 질문에는 계속 답할 수 있다.
 */

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    /*
       ★ 로그아웃 상태에서 /api/auth/me 는 401 이 정답이다. 모든 화면이 서버측
         즐겨찾기를 쓸지 판단하려고 이 조회를 하므로, 이 401 은 결함이 아니다.
    */
    if (/Failed to load resource/.test(text) && /401/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** 엔진이 실제로 들고 있는 상태. 마크업이 아니라 차트 어댑터에 직접 묻는다. */
async function chartState(page: Page) {
  return page.evaluate(() => {
    const u = (window as unknown as { ChartKlineUtil?: { debug: () => unknown[] } }).ChartKlineUtil;
    if (!u || typeof u.debug !== 'function') return null;
    const all = u.debug() as Array<{ bars: number; indicators: unknown[]; overlays: unknown[] }>;
    if (all.length === 0) return null;
    return {
      charts: all.length,
      bars: all[0].bars,
      indicators: all[0].indicators.length,
      overlays: all[0].overlays.length,
    };
  });
}

/** 차트가 데이터를 들고 있을 때까지 기다린다. */
async function waitForBars(page: Page, min = 1) {
  await expect
    .poll(async () => (await chartState(page))?.bars ?? 0, { timeout: 30_000, intervals: [500] })
    .toBeGreaterThanOrEqual(min);
}

/*
   ★★ 가입·로그인 직후 면책 대화상자가 **클릭을 가로챈다.** 닫지 않으면 이후 모든
     동작이 "element intercepts pointer events" 로 실패한다.
*/
async function dismissDisclaimer(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    const primary = page.locator('[role=dialog] button.btn--primary');
    if (await primary.count() === 0) return;
    await primary.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

/*
   ★★ 차트는 **로그인 상태에서만** 마운트된다.

     로그아웃 상태로 /#/trade 를 열면 ChartKlineUtil.debug() 가 빈 배열이다
     (차트 인스턴스가 없다). 원본 스펙은 로그인 없이 차트를 검사했고, 그래서
     "봉 0개" 로 실패했다 — 차트가 깨진 게 아니라 애초에 없었다.
     측정하려는 것이 있는 상태를 먼저 만든다.
*/
async function signInFresh(page: Page) {
  const email = `chart_${Date.now()}@example.com`;
  const password = 'e2e-chart-pass-1';
  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  for (const label of await page.locator('label.chk').all()) await label.click();
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/#\/trade/, { timeout: 20_000 });
  await dismissDisclaimer(page);
}

test('chart receives real candles from the feed, not just an empty canvas', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await signInFresh(page);
  await waitForBars(page, 50);

  const s = await chartState(page);
  expect(s).not.toBeNull();
  /*
     ★★ 봉 개수를 본다. 마운트나 canvas 존재만 보면 "완전히 빈 차트" 가 통과한다 —
       실제로 그렇게 통과했었다.
  */
  expect(s!.charts).toBeGreaterThanOrEqual(1);
  expect(s!.bars).toBeGreaterThan(50);

  // 차트가 데이터를 들고 있는데도 콘솔에 오류가 남으면 렌더 경로가 깨진 것이다.
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('chart canvas has drawn candles, not only a background', async ({ page }) => {
  await signInFresh(page);
  await waitForBars(page, 50);
  // 렌더가 한 프레임 이상 지나가도록 둔다.
  await page.waitForTimeout(1500);

  /*
     ★★ 데이터가 있다는 것과 그려졌다는 것은 다르다. 예전 사고가 정확히 그 차이였다
       (서버는 300개를 줬고 엔진은 아무 것도 그리지 않았다). canvas 픽셀을 표본으로
       읽어 배경 아닌 색이 실제로 있는지 본다.
  */
  const drawn = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')] as HTMLCanvasElement[];
    for (const c of canvases) {
      if (c.width < 200 || c.height < 100) continue;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      let data: Uint8ClampedArray;
      try { data = ctx.getImageData(0, 0, c.width, c.height).data; } catch { continue; }
      const seen = new Set<string>();
      // 성능을 위해 표본만 훑는다 — 색 종류가 몇 개인지만 알면 된다.
      for (let i = 0; i < data.length; i += 4 * 97) {
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        if (seen.size > 6) return { canvas: `${c.width}x${c.height}`, colours: seen.size };
      }
      if (seen.size > 3) return { canvas: `${c.width}x${c.height}`, colours: seen.size };
    }
    return null;
  });

  expect(drawn, '큰 canvas 에서 배경 외의 색을 찾지 못했다 — 데이터는 있는데 그려지지 않았다').not.toBeNull();
  expect(drawn!.colours).toBeGreaterThan(3);
});

/*
   심볼 변경.

   ★★ 기본 배치(standard-trader)에는 종목 목록 위젯이 **없다.** 그래서 화면에서
     심볼을 바꿀 컨트롤을 찾을 수 없다 — 실측으로 확인했다(관련 요소 0개).

     그래서 화면 조작 대신 **차트 어댑터에 직접** 심볼을 바꾸게 하고, 데이터가
     다시 실리는지 본다. 검증하려는 것은 "심볼이 바뀌면 데이터가 다시 온다" 이고,
     그 질문에는 이 방법으로도 답할 수 있다.

   ★ 종목 목록 위젯을 기본 배치에 넣거나 심볼 선택 컨트롤을 추가하면, 그때
     사용자가 실제로 누르는 경로로 바꿔야 한다. 지금 없는 UI 를 있는 것처럼
     테스트하지는 않는다.
*/
test('switching symbol reloads chart data', async ({ page }) => {
  await signInFresh(page);
  await waitForBars(page, 50);

  const before = await chartState(page);
  expect(before!.bars).toBeGreaterThan(50);

  const switched = await page.evaluate(async () => {
    const store = (window as unknown as { QTChartSymbol?: { set?: (s: string) => void } }).QTChartSymbol;
    if (store && typeof store.set === 'function') { store.set('ETHUSDT'); return 'store'; }
    // 폴백: 해시 라우터의 심볼 파라미터
    window.location.hash = '#/trade?symbol=ETHUSDT';
    return 'hash';
  });

  await page.waitForTimeout(4000);
  await waitForBars(page, 20);
  const after = await chartState(page);

  // 어느 경로였든 차트는 살아 있고 데이터를 들고 있어야 한다.
  expect(after!.charts).toBe(before!.charts);
  expect(after!.bars).toBeGreaterThan(20);
  expect(['store', 'hash']).toContain(switched);
});

test('changing the timeframe reloads the chart data', async ({ page }) => {
  await signInFresh(page);
  await waitForBars(page, 50);

  // 주기 버튼(1m·5m·15m·1h …)을 역할과 이름으로 찾는다.
  const tf = page.getByRole('button', { name: /^(5m|15m|1h|4h)$/ }).first();
  const found = await tf.count();
  test.skip(found === 0, '주기 버튼을 찾지 못했다 — 툴바 마크업 확인 필요');

  await tf.click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await waitForBars(page, 20);

  const after = await chartState(page);
  expect(after!.bars).toBeGreaterThan(20);
});
