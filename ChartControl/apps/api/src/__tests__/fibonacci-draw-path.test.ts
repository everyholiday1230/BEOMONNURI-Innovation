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

  /*
     화면 쪽 대비: 시각을 지어내도 실제 봉으로 접는다.

     ★ 이 검사들은 **공용 헬퍼**(`usableTime`·`barNearest`)에 있다 — 피보나치·추세선·
       마커가 같은 것을 쓴다. 처음에는 피보나치 case 안에 있었는데, 마커·추세선에
       같은 결함이 남아 있는 것을 실측으로 발견해 밖으로 뺐다.
  */
  it('지어낸 시각을 걸러 실제 봉에 붙인다', () => {
    expect(copilot, '범위 검사가 없다 — 화면 밖에 그려진다')
      .toMatch(/const usableTime = useCallback/u);
    expect(copilot, '가격에 맞는 봉을 찾지 않는다')
      .toMatch(/const barNearest = useCallback/u);
    /* points 가 없을 때 최근 구간의 고점·저점을 찾는다. */
    const i = copilot.indexOf("case 'createFibonacci'");
    const body = copilot.slice(i, i + 3000);
    expect(body, '스윙 자동 탐색이 없다').toMatch(/if \(Number\(c\.high\) > Number\(hi\.high\)\) hi = c/u);
    /* ★ 시간순을 지켜야 비율이 거꾸로 붙지 않는다. */
    expect(body, '스윙 방향을 시간순으로 정하지 않는다').toMatch(/const loFirst = Number\(lo\.time\) < Number\(hi\.time\)/u);
  });

  it('봉이 갱신되면 새 구간을 쓴다', () => {
    /* ★ 의존성에서 빠지면 첫 봉 묶음에 고정되어 옛 구간에 그린다. */
    expect(copilot, 'context.candles 가 의존성에 없다')
      .toMatch(/anchorTime, resolvePoints, context\.candles, t\]\)/u);
    /* 헬퍼 자신도 봉을 의존성으로 가져야 한다. */
    expect(copilot, 'barNearest 가 봉 갱신을 반영하지 않는다')
      .toMatch(/\}, \[context\.candles, anchorTime\]\)/u);
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

describe('보이지 않는 오버레이를 만들지 않는다 (근본 대책)', () => {
  const kline = read('src/chart-kline.jsx');
  const copilot = read('src/ai-copilot.jsx');
  const schemas = read('packages/ai/src/schemas.ts');

  /*
     ★★★ 시각이 `NaN`/`null` 이면 klinecharts 는 오버레이를 **만들고 아무것도 그리지
       않는다.** 오류도 로그도 없다. 실측으로 **피보나치·마커·추세선 셋 다** 이 상태였고
       "그렸다" 는 답만 돌아왔다.

     ★ 각 분기에서 따로 막으면 새 도형을 추가할 때 또 빠뜨린다 — 실제로 피보나치를
       추가할 때 빠뜨렸다. **한 곳에서** 검사한다.
  */
  it('좌표가 불완전하면 그리지 않는다', () => {
    const i = kline.indexOf('function pointsFor(ov)');
    const body = kline.slice(i, kline.indexOf('function pointsForRaw', i) + 40);
    expect(body, '검사 관문이 없다').toMatch(/Number\.isFinite\(Number\(p\.timestamp\)\)/u);
    expect(body, 'value 결손을 통과시킨다').toMatch(/p\.value == null/u);
    /* ★ 조용히 버리지 않는다 — 원인을 모르면 고칠 수 없다. */
    expect(body, '걸러낸 사실을 로그로 남기지 않는다').toMatch(/console\.warn/u);
  });

  it('관문이 변환보다 뒤에 오지 않는다', () => {
    /* pointsFor 가 pointsForRaw 를 감싸야 모든 타입이 관문을 지난다. */
    expect(kline, '변환 함수를 감싸지 않는다').toMatch(/const out = pointsForRaw\(ov\)/u);
    expect(kline.indexOf('function pointsFor(ov)'), '관문이 원본 뒤에 있다')
      .toBeLessThan(kline.indexOf('function pointsForRaw(ov)'));
  });

  /* 세 도형이 같은 헬퍼를 쓴다 — 각자 구현하면 갈린다. */
  it('시각 확정을 한 헬퍼로 공유한다', () => {
    expect(copilot, '공용 헬퍼가 없다').toMatch(/const resolvePoints = useCallback/u);
    for (const c of ['createTrendLine', 'createFibonacci']) {
      const i = copilot.indexOf(`case '${c}'`);
      const body = copilot.slice(i, i + 2600);
      expect(body, `${c} 가 공용 헬퍼를 쓰지 않는다`).toMatch(/resolvePoints\(/u);
    }
    const mk = copilot.indexOf("case 'createShortMarker'");
    expect(copilot.slice(mk, mk + 1400), '마커가 공용 헬퍼를 쓰지 않는다')
      .toMatch(/resolvePoints\(\[a\.point\]\)/u);
  });

  it('헬퍼가 의존성에 있다', () => {
    expect(copilot, 'resolvePoints 가 의존성에 없어 옛 봉을 쓴다')
      .toMatch(/anchorTime, resolvePoints, context\.candles, t\]\)/u);
  });

  /* 마커: 시각·문구 강제가 그리기를 막았다. */
  it('마커가 시각과 문구를 강제하지 않는다', () => {
    expect(schemas, '마커 전용 점이 없다')
      .toMatch(/const MarkerPoint = z\.object\(\{ time: EpochMs\.optional\(\), price: DecimalString \}\)/u);
    /*
       ★ **두 명령을 각각 확인한다.** 처음에는 `createLongMarker` 부터 260자만 봤는데,
         그 범위가 `createShortMarker` 줄까지 덮어서 **long 을 필수로 되돌려도 통과했다**
         (역검증이 잡아냈다). 명령별로 그 줄만 본다.
    */
    for (const cmd of ['createLongMarker', 'createShortMarker']) {
      const i = schemas.indexOf(`${cmd}: z.object(`);
      expect(i, `${cmd} 가 없다`).toBeGreaterThan(-1);
      const line = schemas.slice(i, schemas.indexOf('\n', i));
      expect(line, `${cmd} 가 시각을 강제한다`).toMatch(/point: MarkerPoint/u);
      /* ★ 문구가 없어서 표시가 아예 안 나오는 것이 훨씬 나쁘다. */
      expect(line, `${cmd} 가 text 를 강제한다`).toMatch(/text: z\.string\(\)\.max\(120\)\.optional\(\)/u);
    }
  });

  it('가격이 없으면 그리지 않고 말한다', () => {
    /* ★ 어디를 가리키는지 모르는 표시는 고객을 헷갈리게 한다. */
    const i = copilot.indexOf("case 'createShortMarker'");
    expect(copilot.slice(i, i + 1200), '가격 없이도 그린다')
      .toMatch(/return t\('ai_marker_needs_price'\)/u);
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s2 = readFileSync(join(dir, f), 'utf8');
      if (!s2.includes('ai_fib_needs_two')) continue;
      if (!s2.includes('ai_marker_needs_price')) missing.push(f);
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });

  /* 추세선: 한 점으로 뭉치면 선이 아니다. */
  it('추세선 두 점이 같은 봉이면 그리지 않는다', () => {
    const i = copilot.indexOf("case 'createTrendLine'");
    const body = copilot.slice(i, i + 1400);
    expect(body, '같은 봉 방어가 없어 선이 한 점으로 뭉친다')
      .toMatch(/pts\[0\]\.time === pts\[1\]\.time/u);
    expect(body, '두 점이 아닐 때도 그린다').toMatch(/pts\.length !== 2/u);
  });

  it('모델에게 봉 시각을 요구하지 않는다', () => {
    const tools = read('packages/ai/src/tools.ts');
    /*
       ★ 모델은 봉 시각을 모른다. 요구하면 지어내고, 지어낸 값은 화면 밖으로 간다.
         마커·피보나치 설명에서 그 지시를 지웠는지 확인한다.
    */
    expect(tools, '마커가 여전히 실제 봉 시각을 요구한다')
      .not.toMatch(/`time` must be a real candle timestamp/u);
    const i = tools.indexOf('- createLongMarker:');
    expect(tools.slice(i, i + 400), '마커 시각 생략을 알리지 않는다')
      .toMatch(/`point\.time` and `text` are OPTIONAL/u);
    /* ★ 예시에 시각을 넣으면 모델이 따라 지어낸다. */
    expect(tools.slice(i, i + 200), '마커 예시에 시각이 남아 모델이 지어낸다')
      .not.toMatch(/"time":\s*17/u);
  });
});
