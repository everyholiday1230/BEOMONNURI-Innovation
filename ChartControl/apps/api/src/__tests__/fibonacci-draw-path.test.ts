/*
   피보나치가 **그려지지 않던** 결함을 잠근다.

   운영자 실측: "피보나치는 안 그려지는 것 같다." 사실이었다. 원인이 셋 겹쳐 있었다.

     ① `pointsFor` 에 `fibonacci` 분기가 없었다 → `null` → 동기화 루프가
        `if (!points) continue` 로 **조용히** 건너뛴다. 오류도 로그도 없고 AI 는
        "그렸다" 고 답한다.
     ② 스키마가 두 점과 **시각을 강제**했다. 그런데 모델에게 주는 시장 맥락에는
        봉 타임스탬프가 없다 — **모델이 낼 수 없는 것을 요구했다.**
     ③ 인자 설명이 "실제 봉 타임스탬프에서 가져와라" 였다. 모르는 것을 지시했다.

   ★ 내가 앞서 "비율선 7개 정확히 그려짐" 으로 확인했다고 적은 것은
     `chart.createOverlay({name:'fibonacciLine'})` 를 **직접** 부른 것이었다.
     라이브러리 확인이었고 **우리 경로를 지나지 않았다.**
     교훈: 확인은 고객이 지나는 경로로 한다. 우회로로 본 것은 확인이 아니다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('피보나치가 실제로 그려진다', () => {
  const kline = read('src/chart-kline.jsx');
  const copilot = read('src/ai-copilot.jsx');
  const schemas = read('packages/ai/src/schemas.ts');
  const tools = read('packages/ai/src/tools.ts');

  /* ①  좌표 변환이 없으면 아무리 명령을 만들어도 화면에 안 나온다. */
  it('pointsFor 가 fibonacci 를 변환한다', () => {
    const i = kline.indexOf('function pointsFor(ov)');
    expect(i, 'pointsFor 가 없다').toBeGreaterThan(-1);
    const body = kline.slice(i, kline.indexOf('function patchFromPoints', i));
    expect(body, 'fibonacci 분기가 없어 조용히 건너뛴다')
      .toMatch(/ov\.type === 'fibonacci'/u);
    expect(body, '두 점을 timestamp/value 로 주지 않는다')
      .toMatch(/ov\.type === 'fibonacci'[\s\S]{0,600}timestamp/u);
  });

  it('같은 시각 두 점은 그리지 않는다', () => {
    /* ★ klinecharts 가 구간을 못 정한다 — 그리면 한 점에 뭉친 도형이 남는다. */
    const i = kline.indexOf("ov.type === 'fibonacci'");
    const body = kline.slice(i, i + 700);
    expect(body, '같은 시각 방어가 없다')
      .toMatch(/out\[0\]\.timestamp === out\[1\]\.timestamp/u);
  });

  it('타입 대응표에 있다', () => {
    expect(kline, '내장 fibonacciLine 을 쓰지 않는다')
      .toMatch(/fibonacci: 'fibonacciLine'/u);
  });

  /* ②  모델이 낼 수 없는 것을 요구하지 않는다. */
  it('스키마가 points 와 time 을 강제하지 않는다', () => {
    expect(schemas, 'points 를 강제해 검증에서 떨어진다')
      .toMatch(/points: z\.tuple\(\[FibPoint, FibPoint\]\)\.optional\(\)/u);
    expect(schemas, 'time 을 강제한다 — 모델은 봉 시각을 모른다')
      .toMatch(/const FibPoint = z\.object\(\{ time: EpochMs\.optional\(\), price: DecimalString \}\)/u);
  });

  it('다른 도형은 시각을 계속 요구한다', () => {
    /*
       ★ 추세선은 두 점의 기울기가 의미를 갖는다. 시각이 없으면 화면이 임의로 정할 수
         없다. 피보나치만 완화한다 — 전부 풀면 엉뚱한 자리에 선이 생긴다.
    */
    expect(schemas, 'OverlayPoint 까지 완화되었다')
      .toMatch(/const OverlayPoint = z\.object\(\{ time: EpochMs, price: DecimalString \}\)/u);
    const i = schemas.indexOf('createTrendLine: z.object(');
    const body = schemas.slice(i, i + 300);
    expect(body, '추세선이 OverlayPoint 를 쓰지 않는다').toMatch(/z\.tuple\(\[OverlayPoint, OverlayPoint\]\)/u);
  });

  /* ③  모델에게 생략이 가능하다고 알려준다. */
  it('인자 설명이 생략 가능을 알린다', () => {
    const i = tools.indexOf('- createFibonacci:');
    const body = tools.slice(i, i + 900);
    expect(body, 'time 이 선택임을 알리지 않는다').toMatch(/`time` is OPTIONAL/u);
    expect(body, 'points 생략을 알리지 않는다').toMatch(/omit `points` entirely/u);
    /* ★ 지어내지 않게 "실제 봉 타임스탬프에서" 라는 지시를 지웠는지. */
    expect(body, '모델이 모르는 것을 여전히 요구한다')
      .not.toMatch(/from real candle timestamps/u);
  });

  /* 화면 쪽 대비: 시각을 지어내도 실제 봉으로 접는다. */
  it('지어낸 시각을 걸러 실제 봉에 붙인다', () => {
    const i = copilot.indexOf("case 'createFibonacci'");
    const body = copilot.slice(i, i + 4200);
    expect(body, '범위 검사가 없다 — 화면 밖에 그려진다').toMatch(/const usable = \(v\)/u);
    expect(body, '가격에 맞는 봉을 찾지 않는다').toMatch(/const barNearest = \(price\)/u);
    /* points 가 없을 때 최근 구간의 고점·저점을 찾는다. */
    expect(body, '스윙 자동 탐색이 없다').toMatch(/if \(Number\(c\.high\) > Number\(hi\.high\)\) hi = c/u);
    /* ★ 시간순을 지켜야 비율이 거꾸로 붙지 않는다. */
    expect(body, '스윙 방향을 시간순으로 정하지 않는다')
      .toMatch(/Number\(lo\.time\) < Number\(hi\.time\)/u);
  });

  it('봉이 갱신되면 새 구간을 쓴다', () => {
    /* ★ 의존성에서 빠지면 첫 봉 묶음에 고정되어 옛 구간에 그린다. */
    expect(copilot, 'context.candles 가 의존성에 없다')
      .toMatch(/\}, \[addOverlay, _removeOverlay, updateOverlay, anchorTime, context\.candles, t\]\)/u);
  });

  it('진단 노출은 localhost 로 제한된다', () => {
    /*
       ★ `__qtChart` 와 같은 조건이어야 한다. 프로덕션에서 열면 주입된 스크립트가
         고객 차트를 조작할 수 있다.
    */
    const i = copilot.indexOf('__qtApplyChartCommand');
    expect(i, '진단 훅이 없다 — 모델 없이 명령을 시험할 수 없다').toBeGreaterThan(-1);
    const body = copilot.slice(Math.max(0, i - 900), i + 400);
    expect(body, 'localhost 제한이 없다').toMatch(/127\.0\.0\.1/u);
    expect(body, '정리에서 지우지 않는다').toMatch(/delete window\.__qtApplyChartCommand/u);
  });
});

describe('내 규칙 화면에 들어갈 수 있다', () => {
  const gallery = read('src/pages-user.jsx');
  const routes = read('apps/api/src/strategy-routes.ts');

  /*
     ★★★ **문이 없었다.** `/ai-strategies/my` 는 라우터에 있고 저장·불러오기도
       동작하는데 **화면 어디에도 링크가 없었다.** 사이드바에도 갤러리만 있다.
       만들 수 있게 만들어 놓고 들어가는 길을 안 냈다.
  */
  it('갤러리에서 내 규칙으로 갈 수 있다', () => {
    expect(gallery, '내 규칙 화면으로 가는 링크가 없다')
      .toMatch(/window\.location\.hash = '#\/ai-strategies\/my'/u);
  });

  it('버튼이 준비중으로 잠겨 있지 않다', () => {
    const i = gallery.indexOf("hash = '#/ai-strategies/my'");
    const body = gallery.slice(Math.max(0, i - 700), i + 400);
    expect(body, '버튼이 disabled 다').not.toMatch(/disabled/u);
    expect(body, "'준비중' 딱지가 남아 있다").not.toMatch(/qt-pending-mark/u);
  });

  /* 서버가 없는 기능이라고 하면 화면이 버튼을 숨긴다. */
  it('서버가 사용자 작성을 없는 기능으로 알리지 않는다', () => {
    const i = routes.indexOf('unavailable: [');
    const body = routes.slice(i, i + 200);
    expect(body, 'userAuthoredStrategies 가 남아 있다')
      .not.toMatch(/userAuthoredStrategies/u);
    /* ★ 나머지 둘은 실제로 없다 — 없는 것을 있다고 하지 않는다. */
    expect(body, '없는 기능을 있다고 한다').toMatch(/subscriptionTiers/u);
    expect(body, '없는 기능을 있다고 한다').toMatch(/liveTrackRecord/u);
  });

  it('버튼 문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('strat_builtin_only')) continue;
      if (!s.includes('strat_my_open')) missing.push(f);
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});
