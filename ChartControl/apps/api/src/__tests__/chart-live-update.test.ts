import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');

/**
 * 차트 실시간 갱신 — **시세 1틱에 1000봉을 다시 싣지 않는다** (TODO §3-2).
 *
 * ★★★ 무엇이 문제였나
 *
 *   `app.jsx` 의 `candles` useMemo 가 `market.price` 에 의존하므로 시세 1틱마다 새
 *   배열이 만들어지고 마지막 봉의 종가가 달라진다. 그때마다 `resetData()` 를 불렀다.
 *   `resetData` 는 데이터를 통째로 버리고 **데이터 로더를 다시 호출한다.**
 *
 *   실측(틱 10회 시뮬레이션, 수정 전):
 *     resetData 8회 · getBars init 8회(1000봉 전량) · getBars backward 8회
 *   수정 후:
 *     resetData 0회 · getBars init 0회 · 마지막 봉은 매 틱 정확히 갱신
 *
 * ★★ 왜 오래 안 고쳐졌나 — 층이 다른 API 를 같은 것으로 봤다.
 *
 *   예전 주석은 "이 KLineCharts 버전에는 부분 갱신 API 가 없다" 고 단정했다.
 *   **인스턴스 메서드**는 실제로 없다(updateData/appendData 없음, 실측 확인).
 *   그런데 **데이터 로더**에는 실시간 경로가 있었다 — `subscribeBar` 다.
 *   없는 것을 확인한 범위와 결론의 범위가 달랐다.
 */
describe('CHART-LIVE — 시세 틱에 전체 재적재를 하지 않는다', () => {
  const ck = stripComments(read('src/chart-kline.jsx'));

  it('[1] ★ klinecharts 번들이 실시간 구독을 지원한다', () => {
    /*
       ★ 라이브러리를 올리거나 바꿀 때 이 경로가 사라지면 조용히 resetData 로
         되돌아간다(우리 코드는 콜백이 없으면 폴백한다). 그러면 성능이 되돌아가고
         아무도 모른다. 그래서 번들에 심볼이 있는지부터 본다.
    */
    const bundle = read('vendor/klinecharts/klinecharts.min.js');
    expect(bundle, 'klinecharts 번들에 subscribeBar 가 없다 — 실시간 부분 갱신 경로가 사라졌다')
      .toContain('subscribeBar');
    expect(bundle).toContain('unsubscribeBar');
  });

  it('[2] 데이터 로더가 subscribeBar·unsubscribeBar 를 제공한다', () => {
    const m = /setDataLoader\(\{([\s\S]*?)\n {6}\}\);/u.exec(ck);
    expect(m, 'setDataLoader 호출을 찾지 못했다').toBeTruthy();
    const body = m![1]!;
    expect(body, 'subscribeBar 를 제공하지 않는다 — 매 틱 전체 재적재로 돌아간다')
      .toMatch(/subscribeBar:/u);
    expect(body, 'unsubscribeBar 가 없다 — 콜백이 남아 옛 차트를 갱신할 수 있다')
      .toMatch(/unsubscribeBar:/u);
    /* 콜백을 ref 에 담아야 한다 — resetData 후 재구독 때 최신 것으로 바뀐다. */
    expect(body).toMatch(/liveBarRef\.current = callback/u);
    expect(body).toMatch(/unsubscribeBar:\s*\(\)\s*=>\s*\{\s*liveBarRef\.current = null/u);
  });

  it('[3] ★★ 마지막 봉만 바뀌면 부분 갱신으로 보내고 resetData 를 건너뛴다', () => {
    /* 판정과 푸시가 같은 자리에 있어야 한다 — 떨어져 있으면 한쪽만 고쳐진다. */
    expect(ck, 'onlyLastBarChanged 판정이 없다').toMatch(/const onlyLastBarChanged = sameKey/u);
    expect(ck, '새 봉 하나 추가를 처리하지 않는다').toMatch(/const appendedOneBar = sameKey/u);

    const branch = /if \(\(onlyLastBarChanged \|\| appendedOneBar\) && typeof liveBarRef\.current === 'function'\) \{([\s\S]*?)\n {6}\}/u
      .exec(ck);
    expect(branch, '부분 갱신 분기를 찾지 못했다').toBeTruthy();
    const body = branch![1]!;
    expect(body, '콜백을 부르지 않는다').toMatch(/liveBarRef\.current\(\{/u);
    /* 보내는 값이 봉 한 개여야 한다 — 배열을 보내면 init 처리가 된다. */
    for (const k of ['timestamp', 'open', 'high', 'low', 'close', 'volume']) {
      expect(body, `봉에 ${k} 가 없다`).toContain(`${k}:`);
    }
    expect(body, '푸시 후 빠져나오지 않는다 — 아래 resetData 까지 실행된다').toMatch(/return;/u);
  });

  it('[4] 부분 갱신이 실패하면 전체 경로로 떨어진다 (갱신을 잃지 않는다)', () => {
    /*
       ★ "봉이 갱신되지 않는 것" 이 "전체 재적재" 보다 나쁘다. 그래서 조용히
         삼키지 않고 폴백한다 — 다만 이유는 콘솔에 남긴다.
    */
    const branch = /if \(\(onlyLastBarChanged \|\| appendedOneBar\)[\s\S]*?\n {6}\}/u.exec(ck);
    expect(branch![0]!).toMatch(/catch \(e\)/u);
    expect(branch![0]!, '실패를 조용히 넘긴다').toMatch(/console\.warn/u);
  });

  it('[5] 옛 단정("부분 갱신 API 가 없다")이 그대로 남아 있지 않다', () => {
    /*
       ★★ 주석이 틀린 채로 남으면 다음 사람이 같은 결론을 다시 내린다. 실제로
         그래서 이 결함이 오래 남았다. 인스턴스에 없다는 사실은 유지하되,
         **로더에는 있다**는 것이 함께 적혀 있어야 한다.
    */
    const raw = read('src/chart-kline.jsx');
    expect(raw, 'subscribeBar 를 설명하는 주석이 없다').toMatch(/subscribeBar/u);
    /* "부분 갱신 API 가 없다" 만 남고 로더 경로 언급이 없으면 실패시킨다. */
    const claimsNone = /부분 갱신 (API|메서드)\s*가?\s*없다/u.test(raw);
    if (claimsNone) {
      expect(raw, '"부분 갱신 API 가 없다" 고만 적혀 있다 — 로더의 실시간 경로를 함께 적을 것')
        .toMatch(/로더[\s\S]{0,200}실시간|실시간[\s\S]{0,200}로더/u);
    }
  });

  it('[6] 과거를 볼 때 갱신을 미루는 경로는 폴백으로만 남는다', () => {
    /*
       ★ 예전에는 뷰가 튀는 것을 막으려고 과거를 보는 동안 최신 봉 갱신을 **아예
         미뤘다**(pendingLiveRef). 부분 갱신은 뷰를 움직이지 않으므로 미룰 이유가 없다.
         실측: 가시범위 890..919 → 890..919 그대로이면서 마지막 봉은 6번 갱신됐다.

       ★★ 그 폴백 자체는 남겨 둔다 — 콜백을 못 받은 상황에서는 여전히 최선이다.
         다만 **부분 갱신 분기보다 뒤에** 있어야 한다. 앞에 있으면 폴백이 항상 이긴다.
    */
    const pushAt = ck.indexOf("if ((onlyLastBarChanged || appendedOneBar) && typeof liveBarRef.current === 'function')");
    const deferAt = ck.indexOf('if (onlyLastBarChanged && anchorTs != null)');
    expect(pushAt, '부분 갱신 분기를 찾지 못했다').toBeGreaterThan(-1);
    expect(deferAt, '미루기 폴백을 찾지 못했다').toBeGreaterThan(-1);
    expect(deferAt, '미루기 폴백이 부분 갱신보다 먼저 온다 — 부분 갱신이 절대 실행되지 않는다')
      .toBeGreaterThan(pushAt);
  });
});
