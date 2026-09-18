/* ============================================================
   KLineChart Renderer — ChartCanvas 대체 렌더러
   ------------------------------------------------------------
   KLineChart 10.0.1 을 사용하되, ChartCanvas 와 **완전히 동일한 props 계약**을
   유지한다. 호출부(app.jsx ChartWidget)는 컴포넌트 이름만 바꾸면 된다.

   왜 교체하는가
   ------------------------------------------------------------
   1) 지표. 자체 엔진에는 SMA 하나뿐이었다. KLineChart 는 27종을 내장한다
      (MA EMA SMA BOLL MACD RSI KDJ BBI VOL OBV SAR CCI DMI WR BIAS BRAR CR
       DMA TRIX VR EMV ROC MTM PVT AO AVP PSY).
   2) 시간축 정확성. 자체 엔진은 오버레이 좌표를 "캔들 간격이 균일하다"고
      가정해 계산했다. 거래소는 체결이 없는 구간의 캔들을 주지 않으므로 이 가정이
      깨진다. 실측 결과 MATICUSDT 1분봉에서 45개 중 43개(96%)가 어긋났고
      최대 오차가 12칸(약 187px), ATOMUSDT 는 28칸(약 363px)이었다.
      KLineChart 는 Point 에 dataIndex 를 함께 관리하므로 이 오류가 구조적으로
      발생하지 않는다.
   3) 세로(가격)축 조절, 무한 스크롤, 피보나치 등 드로잉 16종이 내장이다.

   무엇을 그대로 유지하는가 (기능 손실 0 원칙)
   ------------------------------------------------------------
   · props 13개 전부 동일 (candles, timeframe, symbol, overlays, lastPrice,
     onOverlayChange, onOverlayHover, activeTool, showMA, showVolume,
     showLegend, padding, className)
   · HUD (좌상단 symbol · timeframe / O H L C Δ%) — 우리 DOM 그대로 유지.
     KLineChart 내장 툴팁은 끄고 crosshair 이벤트만 받아 채운다.
   · MA 레전드 (MA20 / MA60 / MA120 스와치) — 우리 DOM 그대로
   · 캔들/거래량/격자/축/십자선 색상 — tokens.css 의 --chart-* 토큰에서 읽음
   · 최근가 점선 + 색상 알약 라벨
   · 오버레이 4종 (horizontal, trend-line, entry-zone, signal-marker)
     source 별 색상 구분(ai-draft 점선, ai-approved, order, position-long,
     position-short, user) + 드래그 핸들 + 가격 라벨 + 태그
   · 오버레이 드래그 → onOverlayChange(id, overlay) 동일 시그니처
   ============================================================ */

(function () {
  'use strict';

  const { useEffect, useRef, useState, useMemo } = React;

  const KL = window.klinecharts;
  if (!KL) {
    console.warn('[ChartKline] klinecharts 미로드 — ChartCanvas 를 계속 사용한다');
    return;
  }

  // ---------------------------------------------------------------
  // 숫자 표기 — ChartCanvas 와 동일하게 맞춘다
  // ---------------------------------------------------------------
  const fmtPrice = (n) =>
    n >= 1000
      ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  /** 심볼의 tickSize 기반 자리수. 실데이터 연결 시 QT.MARKETS 에 채워진다. */
  function priceDecimalsFor(symbolLabel, sampleClose) {
    const fmt = window.QTFmt;
    if (fmt && typeof fmt.tickSizeFor === 'function' && typeof fmt.decimalsForTick === 'function') {
      const d = fmt.decimalsForTick(fmt.tickSizeFor(symbolLabel));
      if (d !== null && d !== undefined) return d;
    }
    const a = Math.abs(Number(sampleClose) || 0);
    return a >= 10000 ? 1 : a >= 1000 ? 2 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 6;
  }

  // ---------------------------------------------------------------
  // 로케일 — 사전(QTI18n)에서 생성한다. 언어 문자열을 여기 박지 않는다.
  // ---------------------------------------------------------------
  //
  // KLineChart 내장은 'en-US' 와 'zh-CN' 뿐이다(실측). 그 외 언어는 우리가
  // registerLocale 로 넣어야 한다. 번역문은 src/locales/*.js 사전에서
  // 가져오므로, 언어를 추가하면 이 코드를 고치지 않아도 차트까지 번역된다.

  const I18n = window.QTI18n;

  /** KLineChart Locales 가 요구하는 15개 키 <-> 우리 사전 키 대응 */
  const CHART_LOCALE_KEYS = {
    time: 'chart_time',
    open: 'chart_open',
    high: 'chart_high',
    low: 'chart_low',
    close: 'chart_close',
    volume: 'chart_volume',
    change: 'chart_change',
    turnover: 'chart_turnover',
    second: 'chart_second',
    minute: 'chart_minute',
    hour: 'chart_hour',
    day: 'chart_day',
    week: 'chart_week',
    month: 'chart_month',
    year: 'chart_year',
  };

  /** 사전에서 KLineChart 로케일 객체를 만든다. */
  function buildChartLocale(appLocale) {
    if (!I18n) return null;
    const out = {};
    for (const [klKey, dictKey] of Object.entries(CHART_LOCALE_KEYS)) {
      out[klKey] = I18n.t(dictKey, undefined, appLocale);
    }
    return out;
  }

  /**
   * 앱 언어에 대응하는 KLineChart 로케일을 보장한다.
   * 이미 등록돼 있으면 그대로 쓰고, 없으면 사전에서 만들어 등록한다.
   * 등록된 언어 목록을 하드코딩하지 않으므로 언어 추가에 자동 대응한다.
   */
  function ensureChartLocale(appLocale) {
    const tag = I18n ? I18n.bcp47Of(appLocale) : 'en-US';
    let supported = [];
    try {
      supported = KL.getSupportedLocales();
    } catch (e) {
      return 'en-US';
    }
    if (supported.includes(tag)) return tag;

    const dict = buildChartLocale(appLocale);
    if (!dict) return supported.includes('en-US') ? 'en-US' : (supported[0] || 'en-US');
    try {
      KL.registerLocale(tag, dict);
      return tag;
    } catch (e) {
      console.warn('[ChartKline] 로케일 등록 실패 — 폴백 사용', tag, e);
      return supported.includes('en-US') ? 'en-US' : (supported[0] || 'en-US');
    }
  }

  /** 현재 앱 언어. i18n 이 단일 출처다. */
  function currentAppLang() {
    if (I18n) return I18n.getLocale();
    try {
      const raw = localStorage.getItem('qt.tweaks');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.lang) return parsed.lang;
      }
    } catch (e) { /* noop */ }
    return document.documentElement.getAttribute('lang') || 'en';
  }

  // ---------------------------------------------------------------
  // 색상 토큰 — ChartCanvas.readColors 와 동일한 키를 읽는다
  // ---------------------------------------------------------------
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (k) => cs.getPropertyValue(k).trim();
    return {
      bg: g('--color-bg-panel'),
      grid: g('--chart-grid'),
      axisText: g('--chart-axis-text'),
      crosshair: g('--chart-crosshair'),
      up: g('--chart-candle-up'),
      dn: g('--chart-candle-dn'),
      volUp: g('--chart-volume-up'),
      volDn: g('--chart-volume-dn'),
      ma1: g('--chart-ma-1'),
      ma2: g('--chart-ma-2'),
      ma3: g('--chart-ma-3'),
      long: g('--color-trade-long'),
      short: g('--color-trade-short'),
      ai: g('--color-ai'),
      approved: g('--color-signal-approved'),
      pending: g('--color-order-pending'),
      textPri: g('--color-text-primary'),
      textSec: g('--color-text-secondary'),
      textTer: g('--color-text-tertiary'),
      panel: g('--color-bg-panel'),
      elevated: g('--color-bg-elevated'),
      // 알약 라벨 위의 글자색. 하드코딩(#0A0E14)이었던 것을 토큰으로 되돌렸다.
      // 라이트 테마에서 흰 글씨가 되어야 하므로 반드시 토큰을 따라가야 한다.
      textInverse: g('--color-text-inverse'),
      fontMono: g('--font-mono'),
      fontSans: g('--font-sans'),
    };
  }

  /** OKLCH 문자열에 알파를 붙인다 (ChartCanvas 와 동일 로직). */
  function withAlpha(colorStr, alpha) {
    if (!colorStr) return colorStr;
    if (colorStr.includes('oklch(')) {
      if (colorStr.includes('/')) return colorStr.replace(/\/\s*[\d.]+\)$/, `/ ${alpha})`);
      return colorStr.replace(')', ` / ${alpha})`);
    }
    return colorStr;
  }

  /** 오버레이 source -> 색상 (ChartCanvas 와 동일 규칙) */
  function colorForSource(src, colors) {
    switch (src) {
      case 'ai-approved': return colors.approved;
      case 'ai-draft': return colors.ai;
      case 'order': return colors.pending;
      /*
         ★★★ **포지션 진입가는 중립색이다 — 현재가와 구분되어야 한다.**

           예전에는 `colors.long`/`colors.short` 를 썼는데, 실측해보니 현재가 표시와
           **완전히 같은 값**이었다:

             --chart-candle-up   = oklch(72% 0.14 175)
             --color-trade-long  = oklch(72% 0.14 175)   ← 같다
             --chart-candle-dn   = oklch(68% 0.22 355)
             --color-trade-short = oklch(68% 0.22 355)   ← 같다

           즉 오른쪽 축에 현재가 배지와 진입가 배지가 **같은 색으로 나란히** 떴다.
           운영자 보고: "현재가격이랑 색상이 너무 똑같아서 구분이 안 간다." 비슷한 게
           아니라 같은 색이었으니 당연하다.

         ★ 그래서 진입가는 중립색(textPri)으로 둔다. 이것은 새로 만든 규칙이 아니다 —
           롱·숏 포지션 도구(`positionOverlay`)가 **이미** 진입선에 textPri 를 쓴다.
           두 곳의 진입가 표현이 이제 일치한다.

         ★★ 방향 정보를 잃지 않는다: 방향은 포지션 패널의 행, 라벨 손익의 부호,
           그리고 위아래에 붙는 TP(이익색)·SL(손실색)이 말해 준다. 진입가 자체는
           "얼마에 들어갔는가" 이고 거기에 방향색이 꼭 필요하지는 않다.
      */
      case 'position-long':
      case 'position-short':
        return colors.textPri;
      /*
         작성 중인 TP/SL 선. 익절=이익색, 손절=손실색이다 — 진입 방향이 아니라
         **결과**를 나타내는 색이어야 한다. 아직 거래소에 나가지 않았으므로
         점선으로 그린다(오버레이 style.dashed).
      */
      case 'draft-tp': return colors.long;
      case 'draft-sl': return colors.short;
      /*
         ★★ **거래소에 실제로 걸린** 포지션 보호주문. 색은 초안과 같지만 **실선**으로
           그린다(오버레이에 style.dashed 를 넣지 않는다) — 점선/실선이 "아직 안 나갔음"
           과 "이미 걸렸음" 을 구분하는 유일한 신호다.
      */
      case 'position-tp': return colors.long;
      case 'position-sl': return colors.short;
      case 'user': return colors.textPri;
      default: return colors.ai;
    }
  }

  // ---------------------------------------------------------------
  // 타임프레임 -> KLineChart Period
  // ---------------------------------------------------------------
  const PERIOD_MAP = {
    '1m': { type: 'minute', span: 1 },
    '3m': { type: 'minute', span: 3 },
    '5m': { type: 'minute', span: 5 },
    '15m': { type: 'minute', span: 15 },
    '30m': { type: 'minute', span: 30 },
    '1H': { type: 'hour', span: 1 },
    '2H': { type: 'hour', span: 2 },
    '4H': { type: 'hour', span: 4 },
    '1D': { type: 'day', span: 1 },
    '1W': { type: 'week', span: 1 },
  };
  function periodFor(timeframe) {
    return PERIOD_MAP[timeframe] || PERIOD_MAP['15m'];
  }

  /*
     ★★★ 타임프레임별 **한 봉의 길이(ms)**.

       왜 필요한가 — 타임프레임을 바꾸면 `timeframe` prop 은 즉시 새 값이 되는데
       `candles` prop 은 **다음 렌더에나** 새 값이 온다(부모가 비동기로 받아온다).
       그 사이에 주입 로직이 "옛 캔들"을 "새 타임프레임 키"로 도장 찍어 버려서,
       이후 검사가 '맞는 데이터' 로 오인하고 **틀린 프레임을 그대로 그린다.**
       운영자가 본 "최초에 특정 화면이 나왔다가 현재 프레임으로 바뀐다" 가 이것이다.
       (같은 프레임을 다시 누르면 이미 캐시가 있어 한 번에 맞게 나온다.)

     ★ 그래서 **데이터 자체로** 검증한다. 봉 간격은 타임프레임이 결정하므로,
       받은 캔들의 간격이 요청한 타임프레임과 다르면 그것은 다른 프레임의 데이터다.
  */
  const TF_MS = {
    '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
    '1H': 3600e3, '2H': 7200e3, '4H': 14400e3, '1D': 86400e3, '1W': 604800e3,
  };

  /**
   * 이 캔들 배열이 주어진 타임프레임의 것인가.
   *
   * ★ 간격의 **최빈값**을 본다. 평균은 거래소가 빠뜨린 봉(gap) 하나에 크게 흔들린다.
   * ★ 판단할 수 없으면 true 로 둔다 — 모른다고 화면을 비우면 볼 수 있는 차트를
   *   못 보게 된다. 확실히 다를 때만 거부한다.
   */
  function candlesMatchTimeframe(bars, timeframe) {
    const want = TF_MS[timeframe];
    if (!want || !Array.isArray(bars) || bars.length < 3) return true;
    const counts = new Map();
    for (let i = 1; i < bars.length && i < 60; i++) {
      const d = bars[i].timestamp - bars[i - 1].timestamp;
      if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
    }
    if (counts.size === 0) return true;
    let mode = 0; let best = -1;
    for (const [d, n] of counts) if (n > best) { best = n; mode = d; }
    return mode === want;
  }

  // ===============================================================
  // 커스텀 오버레이 등록 — 우리 4종을 KLineChart 오버레이로 구현
  // ---------------------------------------------------------------
  // 도형은 KLineChart 내장 primitive 만 쓴다: line, rect, text, polygon, circle.
  // extendData 에 원본 오버레이 객체를 담아 색상/라벨/점선 여부를 결정한다.
  // ===============================================================

  const REGISTERED = new Set();

  /**
   * 살아있는 차트 인스턴스 레지스트리 (진단용).
   * 브라우저 콘솔이나 자동화 테스트에서 오버레이/지표 상태를 확인할 수 있어야
   * "그려진다고 믿는 것"과 "실제로 그려진 것"을 구분할 수 있다.
   */
  const INSTANCES = new Set();

  function ensureOverlayRegistered(name, template) {
    if (REGISTERED.has(name)) return;
    KL.registerOverlay(template);
    REGISTERED.add(name);
  }

  /**
   * 마지막 봉의 오른쪽에 남은 **빈 공간의 폭(px)**.
   *
   * ★★ 왜 필요한가: 손익 라벨을 "캔들보다 더 오른쪽" 에 두라는 요청을 지키려면
   *   그 공간이 몇 px 인지 알아야 한다. 모르면 라벨이 길어질 때 캔들 위로 뻗는다 —
   *   예전에 지적받은 "라벨이 캔들을 가린다" 가 그대로 재발한다.
   *
   * ★ `bounding` 만으로는 알 수 없다. 패널 폭은 알지만 마지막 봉의 x 는 스크롤·줌에
   *   따라 바뀐다. 그래서 차트 인스턴스에 물어본다 — `createPointFigures` 파라미터에
   *   `chart` 가 들어 있다(실측으로 확인: keys = chart,overlay,coordinates,bounding,xAxis,yAxis).
   *
   * ★★ 실패하면 0 을 돌려준다. 0 은 "모른다" 이고, 호출부는 그때 축약하지 않는다 —
   *   폭을 잘못 추측해 숫자를 지우는 것보다 넘치는 편이 낫다.
   */
  function rightGapPx(chart, bounding) {
    const paneW = Number(bounding && bounding.width) || 0;
    if (!chart || paneW <= 0) return 0;
    try {
      const bars = chart.getDataList();
      if (!bars || bars.length === 0) return 0;
      const last = bars[bars.length - 1];
      const px = chart.convertToPixel({ timestamp: last.timestamp }, { paneId: 'candle_pane' });
      const x = px && Number.isFinite(px.x) ? px.x : NaN;
      if (!Number.isFinite(x)) return 0;
      /* 봉의 절반 + 여유 4px 를 빼서 봉 몸통에 닿지 않게 한다. */
      const gap = paneW - x - 8;
      return gap > 0 ? gap : 0;
    } catch (e) {
      return 0;
    }
  }

  /** 공통: extendData 에서 렌더 정보를 뽑는다. */
  /*
     ★★★ `bounding` 을 반드시 넘긴다. `ext.paneWidth` 같은 값은 오버레이 데이터에
       없다 — 처음에 그렇게 썼는데 항상 0 이 되어 **축약이 한 번도 동작하지 않았다.**
       조용히 아무 일도 안 하는 코드가 되는 오늘의 다섯 번째 사례를 피한다.
  */
  function renderInfo(overlay, bounding, chart) {
    const ext = overlay.extendData || {};
    const colors = ext.colors || readColors();
    const src = ext.source || 'user';
    const color = colorForSource(src, colors);
    const dashed = Boolean(ext.dashed) || src === 'ai-draft';
    /*
       ★★ 라벨은 **그리는 순간에** 만든다.

         진입가 선의 손익%를 오버레이 데이터에 문자열로 굳혀 두면, 그 숫자는
         값을 불러온 순간의 손익이다. 가격이 움직여도 그대로 남아 이용자는 옛
         손익을 현재 손익으로 읽는다. QTOverlayLive 가 최신가로 다시 만든다.

       ★ 헬퍼가 없으면(로드 실패) 원래 라벨을 쓴다 — 선이 사라지면 더 나쁘다.
    */
    const LV = window.QTOverlayLive;
    /*
       ★★ 그릴 수 있는 가로 폭을 넘긴다. 좁으면 헬퍼가 덜 중요한 부분을 뺀다.
         라벨은 x=8 에서 시작하고 오른쪽 가격 배지가 약 60px 을 쓰므로 그만큼 뺀다.
       ★ 폭을 모르면(0) 축약하지 않는다.
    */
    const paneW = Number(bounding && bounding.width) || 0;
    /*
       ★★ 라벨이 쓸 수 있는 폭 = **마지막 봉 오른쪽의 빈 공간**.

         예전에는 `paneW - 8 - 60 - 12` 였다. 라벨을 왼쪽(x=8)에 두던 시절의 계산으로,
         패널 폭의 거의 전부(330px 에서 250px)를 허용했다. 라벨을 오른쪽으로 옮긴
         뒤에도 그 값을 쓰면 라벨이 여백(실측 85px)을 넘어 캔들 위로 250px 뻗는다.

       ★ 공간을 모르면(0) 축약하지 않는다 — 폭을 추측해 금액을 지우지 않는다.
         `labelFor` 는 maxPx 가 0 이면 전체 문구를 돌려준다.
    */
    const gap = rightGapPx(chart, bounding);
    const maxPx = gap > 0 ? gap : 0;
    void paneW;
    /*
       ★ 레전드는 HTML 이라 차트 인스턴스로는 알 수 없다. 캔버스의 조상에서 찾는다.
         `chart.getDom()` 이 차트 컨테이너를 돌려주므로 그 안에서 레전드를 찾고,
         좌표는 **캔들 패널 캔버스** 기준으로 환산한다.
    */
    let legendRects = null;
    try {
      const dom = chart && chart.getDom ? chart.getDom() : null;
      const host = dom && dom.closest ? (dom.closest('.chart-kline-wrap') || dom.parentElement) : null;
      const paneCanvas = host
        ? [...host.querySelectorAll('canvas')]
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.height > 80 && r.width > 80)
          .sort((a, b) => (b.height * b.width) - (a.height * a.width))[0]
        : null;
      if (host && paneCanvas) legendRects = legendRectsOf(host, paneCanvas);
    } catch (e) { legendRects = null; }
    const label = LV
      ? LV.labelFor({ label: ext.label, live: ext.live, symbol: ext.symbol }, undefined, { maxPx })
      : ext.label;
    /*
       ★★ 오른쪽 여백에 넣을 **줄 목록**. 한 줄로는 %와 금액이 함께 들어가지 않는다
         (여백 실측 77px, 한 줄 문구는 약 102px). 세로로 쌓아 둘 다 남긴다.
       ★ 헬퍼가 없으면 한 줄짜리 기존 라벨을 쓴다 — 선이 사라지는 것이 더 나쁘다.
    */
    const labelLines = (LV && LV.labelLinesFor)
      ? LV.labelLinesFor({ label: ext.label, live: ext.live, symbol: ext.symbol }, undefined, { maxPx, maxLines: 2 })
      : (label ? [label] : []);
    return { ext, colors, src, color, dashed, label, labelLines, legendRects, width: ext.width || 1.5 };
  }

  /** 태그(라벨 알약). ChartCanvas drawTag 의 시각을 재현한다. */
  /*
     ★★★ **글자 폭 추정 — `length * 5.6` 은 한글에서 크게 어긋난다.**

       10px 폰트에서 ASCII 는 약 5.6px 인데 **한글·한자·가나는 약 10px** 이다.
       "현재 포지션 · 롱 0.5 · ROE +3.72%" 를 5.6 으로 계산하면 배경 상자가 실제
       글자보다 **40% 가까이 좁게** 만들어진다. 글자가 상자를 넘쳐 봉·다른 라벨과
       겹치고, 이용자에게는 **"글씨가 가려진" 것처럼** 보인다(운영자 보고).

     ★ 알려진 함정과 같은 종류다 — `String.length` 는 표시 폭이 아니다(한국어 주석
       바이트 수를 14.8% 낮게 셌던 일).
  */
  /*
     ★★★ **글자 폭을 추정하지 않고 실제로 잰다.**

       예전에는 ASCII 5.6px · 전각 10px 로 추정했다. 그런데 이 저장소는 라벨에
       **등폭 글꼴**을 쓰고, 10px 등폭의 실제 전진폭은 6.0px 다. 즉 추정이 약 7%
       작아서 글자가 상자를 넘쳤다(운영자 보고: "네모칸 밖에 조금 넘어간다").

       실측 비교:
         "-0.01%"                       추정 33.6  실제  36   (-2.4)
         "+466.25"                      추정 39.2  실제  42   (-2.8)
         "+0.12% · ROE +1.16% · +39.65" 추정 156.8 실제 168   (-11.2)

     ★ 추정 방식 자체가 틀린 접근이었다. 글꼴이 바뀌면 계수도 바뀌는데, 그것을
       따라갈 방법이 없다. `measureText` 는 지금 그려질 글꼴로 정확히 답한다.

     ★ 오프스크린 캔버스를 하나 만들어 재사용하고, 글꼴 문자열이 같으면 다시 설정하지
       않는다(설정 자체가 비용이다). 도형 하나당 몇 번씩 불리므로 결과도 캐시한다.

     ★★ 캔버스를 못 만드는 환경(테스트 등)에서는 예전 추정으로 떨어진다 — 폭을 모른다고
       라벨을 그리지 않으면 화면에서 정보가 사라진다.
  */
  let measureCtx = null;
  let measureFont = '';
  const measureCache = new Map();

  function textWidth(text, size, family, weight) {
    const s = String(text);
    if (!s) return 0;
    const px = size || 10;
    const fam = family || 'monospace';
    const wt = weight || '500';
    const font = `${wt} ${px}px ${fam}`;
    const key = `${font}\u0000${s}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) return hit;

    if (measureCtx === null) {
      try {
        measureCtx = document.createElement('canvas').getContext('2d');
      } catch (e) {
        measureCtx = false;   // 다시 시도하지 않는다
      }
    }
    if (measureCtx) {
      if (measureFont !== font) { measureCtx.font = font; measureFont = font; }
      const w = measureCtx.measureText(s).width;
      if (w > 0) {
        /* 캐시가 무한히 커지지 않게 한다 — 라벨 문구는 종류가 적다. */
        if (measureCache.size > 400) measureCache.clear();
        measureCache.set(key, w);
        return w;
      }
    }

    /*
       폴백: 예전 추정. 등폭이 아닐 수도 있으므로 전각/반각만 구분한다.
       ★ 정확하지 않다는 것을 알고 쓰는 값이다 — 그래서 위에서 먼저 재려고 한다.
    */
    const per = px / 10;
    let w = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      const wide = (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf)
        || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
        || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
        || (c >= 0xffe0 && c <= 0xffe6);
      w += (wide ? 10 : 6) * per;
    }
    return w;
  }

  function tagFigures(text, x, y, color, colors) {
    if (!text) return [];
    const paddingX = 8;
    /* ★ 그리는 글꼴로 재야 상자가 글자를 담는다(tagFiguresRight 주석 참고). */
    const approxW = textWidth(text, 10, colors.fontMono, '500') + paddingX * 2;
    return [
      {
        type: 'rect',
        attrs: { x, y: y - 9, width: approxW, height: 16 },
        styles: {
          style: 'stroke_fill',
          color: withAlpha(colors.elevated || colors.panel, 0.92),
          borderColor: color,
          borderSize: 1,
          borderRadius: 3,
        },
        ignoreEvent: true,
      },
      {
        type: 'text',
        attrs: { x: x + approxW / 2, y: y - 1, text: String(text), align: 'center', baseline: 'middle' },
        styles: {
          color, size: 10, family: colors.fontMono, weight: '500',
        /*
           ★★★ **`backgroundColor` 를 반드시 준다 — 안 주면 라이브러리 기본 파랑이 깔린다.**

             klinecharts 의 `text` 도형은 그리기 직전에 배경 사각형을 한 장 깐다:
               he(ctx, rects, { ...style, color: style.backgroundColor })
             즉 배경색으로 **`backgroundColor`** 를 쓰는데, 우리가 그 값을 주지 않으면
             병합된 기본 스타일의 `#1677ff`(라이브러리 기본 파랑)가 들어간다.

           ★ 운영자 보고(2026-09-17): "현재 포지션 금액·% 는 좋은데 **파란색 배경**이 있다."
             캔버스 채우기 추적으로 확인했다 — 글자마다 앞에 `fill #1677ff` 가 한 번씩 있었다:
               fill oklch(0.24 0.014 240 / 0.92)   ← 우리 라벨 상자(정상)
               fill #1677ff                        ← ★ 파랑
               fillText "-0.06%"
               fill #1677ff                        ← ★ 파랑
               fillText "+466.25"
             투명으로 주면 그 호출이 사라진다(채우기 8회 → 5회).

           ★ 우리 상자는 이미 `rect` 도형으로 그린다. 글자 배경은 **없어야** 맞다.
        */
        backgroundColor: 'transparent',
        },
        ignoreEvent: true,
      },
    ];
  }

  /**
   * 가격 배지 — **오른쪽 Y축 영역에** 그린다.
   *
   * ★★★ 여기가 `createPointFigures` 가 아니라 `createYAxisFigures` 전용이라는 것이
   *   핵심이다. 두 콜백의 좌표계가 **다르다.** 실측(2026-09-15):
   *
   *     createPointFigures  bounding = { width: 330, left: 0,   right: 64 }   ← 캔들 패널
   *     createYAxisFigures  bounding = { width:  64, left: 330, right:  0 }   ← Y축 캔버스
   *
   *   즉 `createPointFigures` 안에서 `x = bounding.width - w` 를 쓰면 **패널의 오른쪽
   *   끝**, 다시 말해 마지막 봉들 위에 그려진다. Y축은 애초에 **별도 캔버스**라서
   *   패널 쪽 콜백에서는 닿을 수 없다.
   *
   * ★★ 예전 구현이 정확히 그 실수를 했다. 주석에는 "가격 라벨 (오른쪽 축 위 알약)"
   *   이라고 적혀 있었지만 실제로는 패널 안에 그렸다. 그래서 "가격을 오른쪽 축에
   *   빼 달라" 는 요청이 두 번의 커밋(7f4d942, c1c2153)을 거쳐도 해결되지 않았다.
   *   코드가 아니라 **그려진 픽셀을 재서** 원인을 찾았다.
   *
   * ★ x=0 이 축의 왼쪽 경계다. 축 폭을 꽉 채우면 실시간 가격 배지와 같은 자리·같은
   *   모양이 되어, 이용자가 "현재가 선처럼" 읽는다.
   */
  function axisPriceFigures(price, y, axisBounding, color, decimals, colors) {
    if (price === null || price === undefined) return [];
    const text = Number(price).toFixed(decimals);
    const w = Math.max(0, Number(axisBounding && axisBounding.width) || 0);
    if (w <= 0) return [];
    return [
      {
        type: 'rect',
        attrs: { x: 0, y: y - 8, width: w, height: 16 },
        styles: { style: 'fill', color, borderRadius: 2 },
        ignoreEvent: true,
      },
      {
        type: 'text',
        attrs: { x: w / 2, y, text, align: 'center', baseline: 'middle' },
        styles: {
          color: colors.textInverse, size: 10, family: colors.fontMono, weight: '600',
          /* ★ 위 tagFigures 주석 참고 — 주지 않으면 라이브러리 기본 파랑이 깔린다. */
          backgroundColor: 'transparent',
        },
        ignoreEvent: true,
      },
    ];
  }

  /**
   * 차트 위에 떠 있는 **HTML 정보 요소**가 차지한 영역 — 패널 좌표로.
   *
   * ★★ 왜 필요한가: 운영자 보고에서 손익 라벨 위에 `VOL` 글자가 겹쳐 보였다.
   *   레전드·HUD 는 캔버스가 아니라 **HTML** 이고 차트 위쪽에 떠 있다. 우리 손익
   *   라벨도 오른쪽 정렬이라 선이 위쪽에 있으면 정확히 그 자리에서 만난다.
   *
   * ★ 두 종류를 함께 잡는다(실측, 패널 좌표):
   *     `.chart-legend__item`  MA20 y=10 · MA60 y=29 · MA120 y=47 · VOL y=66 (h 15)
   *     `.chart-hud__row`      심볼·주기 줄 y=8 · OHLC 줄 y=30 (h 16)
   *   처음에는 레전드만 잡았는데, 라벨을 왼쪽으로 밀자 이번엔 **OHLC 줄과 겹쳤다.**
   *   같은 성질의 요소를 하나만 피하면 다른 하나로 옮겨 붙는다.
   *
   * ★ 이 요소들을 옮기지 않는다 — 고정 UI 다. **라벨이 비킨다.**
   *
   * ★ 못 찾으면 null 을 돌려준다. 그러면 예전처럼 항상 선 위에 그린다 —
   *   이 요소들이 없는 배포에서 라벨이 이유 없이 비키면 그것도 이상하다.
   */
  function legendRectsOf(host, paneRect) {
    if (!host || !paneRect) return null;
    try {
      const items = [...host.querySelectorAll('.chart-legend__item, .chart-hud__row')];
      const rects = [];
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        rects.push({
          top: r.top - paneRect.top,
          bottom: r.bottom - paneRect.top,
          left: r.left - paneRect.left,
        });
      }
      return rects.length ? rects : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 라벨 알약을 **패널 오른쪽 끝에 붙여** 그린다 (손익 %·금액용).
   *
   * ★★ 운영자 요청: "지금 가격 나오는 위치에(캔들보다 더 오른쪽 공간에) %랑 금액".
   *   가격이 축으로 나갔으니 그 자리가 비었고, 그 자리에 손익을 넣는다.
   *
   * ★ 왼쪽(x=8)에 두던 것을 옮긴 것이다. 왼쪽은 **가장 오래된 봉** 위였다 —
   *   차트를 볼 때 눈이 가는 곳은 오른쪽 끝(최신)이므로 정보도 거기 있어야 한다.
   *
   * ★★ 오른쪽 정렬이 곧 "캔들보다 오른쪽" 인 이유: 차트는 마지막 봉과 오른쪽 경계
   *   사이에 여백을 둔다(실측 85px — 마지막 봉 x=245, 패널 폭 330). 라벨을 오른쪽
   *   경계에 붙이면 그 여백 안에 들어간다.
   *
   * ★ 여백보다 라벨이 길면 봉 위로 넘어간다. 그때는 라벨을 자르지 않고 넘긴다 —
   *   숫자를 잘라 **틀린 금액**을 보여주는 것이 더 나쁘다(QTOverlayLive 가 이미
   *   폭에 맞춰 덜 중요한 항목부터 빼 준다).
   */
  function tagFiguresRight(lines, rightEdge, y, color, colors, legendRects, paneH) {
    const rows = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map(String);
    if (rows.length === 0) return [];
    const paddingX = 8;
    const rowH = 14;
    const boxH = rows.length * rowH + 4;
    /*
       ★ 글꼴을 함께 넘겨 **실제 폭**을 잰다. 넘기지 않으면 기본 글꼴로 재서 다시
         어긋난다 — 그리는 글꼴과 재는 글꼴이 같아야 의미가 있다.
    */
    const boxW = Math.max(...rows.map((r) => textWidth(r, 10, colors.fontMono, '500'))) + paddingX * 2;
    let right = rightEdge;
    /*
       ★ 기본은 선 **위쪽**이다. 선 아래는 캔들이 이어지는 방향이라 위쪽이 덜 가린다.
    */
    let top = y - boxH - 3;
    /* 패널 높이를 모르면 아래쪽 후보를 막지 않는다 — 위쪽만 남으면 겹침을 못 피한다. */
    const limitH = Number.isFinite(paneH) ? paneH : Infinity;
    /*
       ★★★ **정보 요소(레전드·HUD)와 겹치면 비킨다.**

         이 자리를 놓고 다투는 상대는 캔버스가 아니라 **HTML** 이다(실측, 패널 좌표):
           `.chart-legend__item`  MA20 y10 · MA60 y29 · MA120 y47 · VOL y66 — x 278~ (좁다)
           `.chart-hud__row`      심볼 줄 y8 · OHLC 줄 y30 — x 8~ (넓다)
         모양이 **ㄱ자**다. 오른쪽 정렬인 우리 라벨은 선이 위쪽이면 여기서 만난다.

       ★★★ **하나의 큰 상자로 합치면 안 된다 — 두 번 실패한 지점이다.**
         ① 레전드만 피해 "선 아래로" → 띠가 70px 이라 내려가도 여전히 VOL 과 겹쳤다.
         ② HUD 까지 합쳐 하나의 상자로 → left 가 8 로 내려가 과잉 예약, 라벨이 띠 전체
            아래로 34px 밀리면서 이번엔 **다른 라벨(진입가)과 겹쳤다.**
         그래서 지금은 **사각형 목록**으로 두고, 후보 위치마다 *그 y 띠에 실제로 걸치는*
         것만 피한다. 선 아래(y+3)에서는 좁은 레전드만 걸리므로 왼쪽으로 54px 만 밀면
         된다 — 세로로 밀지 않으니 라벨이 자기 선에 붙어 있고 남의 라벨도 안 건드린다.

       ★ 세로보다 가로 이동을 택한 이유: 라벨이 자기 선에서 멀어지면 어느 선의 값인지
         알 수 없다. **세로 거리가 곧 정확도**이므로 세로는 선 ±3 만 쓴다.
    */
    if (Array.isArray(legendRects) && legendRects.length) {
      /*
         이 y 띠에 **실제로 걸치는** 요소만 모아, 그것들을 피할 수 있는 오른쪽 끝을 낸다.
         걸치는 게 없으면 원래 오른쪽 끝(rightEdge)을 그대로 쓴다.
      */
      const clearRightAt = (t) => {
        const hit = legendRects.filter((r) => t < r.bottom && (t + boxH) > r.top);
        if (!hit.length) return rightEdge;
        return Math.max(boxW, Math.min(rightEdge, Math.min(...hit.map((r) => r.left)) - 6));
      };
      const above = y - boxH - 3;
      const below = y + 3;
      const cands = [];
      if (above >= 0) cands.push({ top: above, right: clearRightAt(above) });
      if (below + boxH <= limitH) cands.push({ top: below, right: clearRightAt(below) });
      /*
         ★ 후보 중 **오른쪽을 가장 덜 잃는** 것을 고른다. 눈이 가는 곳은 오른쪽 끝(최신
           봉·가격축)이므로 라벨도 거기 있을수록 좋다. 동점이면 먼저 담은 위쪽이 남는다.
      */
      let best = null;
      for (const c of cands) if (!best || c.right > best.right) best = c;
      if (best) { top = best.top; right = best.right; }
    }
    if (top < 0) top = y + 3;
    const x = Math.max(0, right - boxW);
    const out = [
      {
        type: 'rect',
        attrs: { x, y: top, width: boxW, height: boxH },
        styles: {
          style: 'stroke_fill',
          color: withAlpha(colors.elevated || colors.panel, 0.92),
          borderColor: color,
          borderSize: 1,
          borderRadius: 3,
        },
        ignoreEvent: true,
      },
    ];
    rows.forEach((text, i) => {
      out.push({
        type: 'text',
        /*
           ★★ 상자 **가운데**에 놓는다(운영자 요청: "네모 딱 가운데에 나와야").
             왼쪽 정렬이면 줄 길이가 다를 때 들쭉날쭉해 보이고, 폭 추정이 조금만
             어긋나도 오른쪽으로 넘친다.
        */
        attrs: { x: x + boxW / 2, y: top + 2 + rowH * i + rowH / 2, text, align: 'center', baseline: 'middle' },
        styles: {
          color, size: 10, family: colors.fontMono, weight: '500',
          /* ★ 위 tagFigures 주석 참고 — 운영자가 본 "파란색 배경" 이 이것이었다. */
          backgroundColor: 'transparent',
        },
        ignoreEvent: true,
      });
    });
    return out;
  }

  function registerAllOverlays() {
    // --- 1. 수평선 (주문/포지션/손절/익절) ---
    ensureOverlayRegistered('qtHorizontal', {
      name: 'qtHorizontal',
      totalStep: 2,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      /*
         ★★ 기본 Y축 도형을 쓰지 않고 **직접 그린다.**

           기본 도형은 축 텍스트 색을 따르므로 익절·손절이 같은 색으로 나온다.
           TP=이익색 / SL=손실색 이 이 화면에서 방향을 알려주는 유일한 신호이므로
           (이름을 라벨에서 뺐다) 축 배지도 같은 색이어야 한다.
      */
      needDefaultYAxisFigure: false,
      createPointFigures: ({ overlay, coordinates, bounding, chart }) => {
        const c = coordinates[0];
        if (!c) return [];
        const { color, dashed, labelLines, colors, legendRects } = renderInfo(overlay, bounding, chart);
        return [
          {
            type: 'line',
            attrs: { coordinates: [{ x: 0, y: c.y }, { x: bounding.width, y: c.y }] },
            styles: { color, size: 1.5, style: dashed ? 'dashed' : 'solid', dashedValue: [5, 4] },
          },
          /*
             ★★ 가격은 여기서 그리지 않는다 — `createYAxisFigures` 가 오른쪽 축에 그린다.
               예전에는 이 자리에서 `bounding.width - w` 에 가격 배지를 그렸고, 그것이
               **캔들 위**였다(패널 좌표계다). 그 자리에는 손익만 남긴다.
          */
          ...tagFiguresRight(labelLines, bounding.width - 4, c.y, color, colors, legendRects, bounding.height),
        ];
      },
      /*
         ★★★ **가격을 오른쪽 축에 그린다 — 실시간 가격 배지와 같은 자리.**

           운영자가 다섯 번 넘게 요청한 항목이다. 여기가 그 요청이 실제로 실현되는
           유일한 자리다(위 axisPriceFigures 주석의 좌표계 실측 참고).
      */
      createYAxisFigures: ({ overlay, coordinates, bounding }) => {
        const c = coordinates[0];
        if (!c) return [];
        const ext = overlay.extendData || {};
        const colors = ext.colors || readColors();
        const color = colorForSource(ext.source || 'user', colors);
        const price = overlay.points?.[0]?.value;
        return axisPriceFigures(price, c.y, bounding, color, ext.decimals ?? 2, colors);
      },
    });

    // --- 2. 추세선 (2점 + 우측 투영) ---
    ensureOverlayRegistered('qtTrendLine', {
      name: 'qtTrendLine',
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ overlay, coordinates, bounding, chart }) => {
        if (coordinates.length < 2) return [];
        const [p1, p2] = coordinates;
        const { color, dashed, label, colors } = renderInfo(overlay, bounding, chart);
        const figures = [
          {
            type: 'line',
            attrs: { coordinates: [p1, p2] },
            styles: { color, size: 1.5, style: dashed ? 'dashed' : 'solid', dashedValue: [5, 4] },
          },
        ];
        // 우측 투영 (ChartCanvas 와 동일하게 얇은 점선으로 연장)
        if (p2.x < bounding.width && p2.x !== p1.x) {
          const slope = (p2.y - p1.y) / (p2.x - p1.x);
          const yEnd = p2.y + slope * (bounding.width - p2.x);
          figures.push({
            type: 'line',
            attrs: { coordinates: [p2, { x: bounding.width, y: yEnd }] },
            styles: { color, size: 1, style: 'dashed', dashedValue: [2, 4] },
            ignoreEvent: true,
          });
        }
        figures.push(...tagFigures(label, p1.x + 6, p1.y - 14, color, colors));
        return figures;
      },
    });

    // --- 3. 진입 구간 (가격 밴드) ---
    ensureOverlayRegistered('qtEntryZone', {
      name: 'qtEntryZone',
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ overlay, coordinates, bounding, chart }) => {
        if (coordinates.length < 2) return [];
        const yHi = Math.min(coordinates[0].y, coordinates[1].y);
        const yLo = Math.max(coordinates[0].y, coordinates[1].y);
        const { color, labelLines, colors, legendRects } = renderInfo(overlay, bounding, chart);
        return [
          {
            type: 'rect',
            attrs: { x: 0, y: yHi, width: bounding.width, height: Math.max(1, yLo - yHi) },
            styles: { style: 'fill', color: withAlpha(color, 0.14) },
            ignoreEvent: true,
          },
          {
            type: 'line',
            attrs: { coordinates: [{ x: 0, y: yHi }, { x: bounding.width, y: yHi }] },
            styles: { color, size: 1.5, style: 'dashed', dashedValue: [4, 3] },
          },
          {
            type: 'line',
            attrs: { coordinates: [{ x: 0, y: yLo }, { x: bounding.width, y: yLo }] },
            styles: { color, size: 1.5, style: 'dashed', dashedValue: [4, 3] },
          },
          ...tagFiguresRight(labelLines, bounding.width - 4, (yHi + yLo) / 2, color, colors, legendRects, bounding.height),
        ];
      },
      /* 가격은 오른쪽 축에 — 구간의 위·아래 두 값을 각각 그린다. */
      createYAxisFigures: ({ overlay, coordinates, bounding }) => {
        if (coordinates.length < 2) return [];
        const ext = overlay.extendData || {};
        const colors = ext.colors || readColors();
        const color = colorForSource(ext.source || 'user', colors);
        const decimals = ext.decimals ?? 2;
        const yHi = Math.min(coordinates[0].y, coordinates[1].y);
        const yLo = Math.max(coordinates[0].y, coordinates[1].y);
        const priceHi = Math.max(overlay.points[0].value, overlay.points[1].value);
        const priceLo = Math.min(overlay.points[0].value, overlay.points[1].value);
        return [
          ...axisPriceFigures(priceHi, yHi, bounding, color, decimals, colors),
          ...axisPriceFigures(priceLo, yLo, bounding, color, decimals, colors),
        ];
      },
    });

    /*
       --- 5/6. 롱·숏 포지션 도구 ---

       왜 자체 구현인가
       KLineChart 10 에는 포지션 도구가 없다(지원 오버레이 20종에 없음).
       예전에는 롱·숏 버튼을 priceChannelLine(3점 가격채널)에 연결해 두었는데,
       버튼 이름과 그려지는 도형이 달라 사용자를 오해시킨다. 트레이더가 이 도구에
       기대하는 것은 "진입가에서 목표까지 이익 구간, 손절까지 손실 구간, 그리고
       손익비" 다. 그래서 직접 만든다.

       점 3개: 1) 진입 2) 목표(TP) 3) 손절(SL)
       이익 구간은 초록, 손실 구간은 빨강. 손익비(R:R)를 함께 표시한다.

       long/short 는 색 배치가 아니라 **검증 규칙**이 다르다:
         롱  목표 > 진입 > 손절
         숏  목표 < 진입 < 손절
       거꾸로 찍으면 경고색으로 표시한다 — 조용히 반대로 그리면 손익 판단이 뒤집힌다.
    */
    function positionOverlay(name, side) {
      return {
        name,
        totalStep: 4, // 시작 + 점 3개
        needDefaultPointFigure: true,
        needDefaultXAxisFigure: false,
        /* 축 배지를 직접 그린다(createYAxisFigures) — 기본 도형은 색을 구분하지 못한다. */
        needDefaultYAxisFigure: false,
        createPointFigures: ({ overlay, coordinates, bounding, chart }) => {
          if (coordinates.length < 2) return [];
          const { colors, ext } = renderInfo(overlay, bounding, chart);
          /*
             가격 자리수. 심볼의 tickSize 에서 온다.
             이걸 쓰지 않으면 '64283.04431256001' 처럼 부동소수 오차가 그대로 보인다
             (실제로 확인했다). 자리수를 모르면 2자리로 둔다.
          */
          const decimals = ext.decimals ?? 2;
          const px = (v) => (v === null || v === undefined ? null : Number(v).toFixed(decimals));
          const long = colors.long || '#16a34a';
          const short = colors.short || '#dc2626';
          const profitColor = side === 'long' ? long : short;
          const lossColor = side === 'long' ? short : long;

          const pts = overlay.points || [];
          const entryY = coordinates[0].y;
          const entryPrice = pts[0] ? pts[0].value : null;
          const x0 = coordinates[0].x;
          // 오른쪽 끝까지 채운다. 진입 시점 이후 구간을 표현하기 때문이다.
          const xEnd = bounding.width;

          const figures = [];

          /** 구간 사각형 + 경계선. */
          const zone = (y, color, priceVal, tag) => {
            const top = Math.min(entryY, y);
            const h = Math.max(1, Math.abs(y - entryY));
            figures.push({
              type: 'rect',
              attrs: { x: x0, y: top, width: Math.max(1, xEnd - x0), height: h },
              styles: { style: 'fill', color: withAlpha(color, 0.13) },
              ignoreEvent: true,
            });
            figures.push({
              type: 'line',
              attrs: { coordinates: [{ x: x0, y }, { x: xEnd, y }] },
              styles: { color, size: 1.5, style: 'dashed', dashedValue: [4, 3] },
            });
            const shown = px(priceVal);
            if (shown !== null) {
              /*
                 ★★ 가격은 여기서 그리지 않는다 — `createYAxisFigures` 가 오른쪽 축에 그린다.
                   이름(TP/SL)만 남긴다. 이름을 오른쪽에 두면 손익 라벨과 겹치므로
                   진입선 기준 왼쪽에 그대로 둔다.
              */
              figures.push(...tagFigures(tag, x0 + 6, y - 8, color, colors));
            }
          };

          // 목표(2번째 점)
          if (coordinates[1]) {
            zone(coordinates[1].y, profitColor, pts[1] ? pts[1].value : null, 'TP');
          }
          // 손절(3번째 점)
          if (coordinates[2]) {
            zone(coordinates[2].y, lossColor, pts[2] ? pts[2].value : null, 'SL');
          }

          // 진입선
          figures.push({
            type: 'line',
            attrs: { coordinates: [{ x: x0, y: entryY }, { x: xEnd, y: entryY }] },
            styles: { color: colors.textPri || '#e6ebf2', size: 1.5, style: 'solid' },
          });
          // 진입가격은 오른쪽 축에 그린다(createYAxisFigures).

          // 손익비 + 방향 유효성
          if (pts.length >= 3 && entryPrice !== null) {
            const tp = pts[1].value;
            const sl = pts[2].value;
            const reward = Math.abs(tp - entryPrice);
            const risk = Math.abs(entryPrice - sl);
            // 위험이 0 이면 손익비를 계산할 수 없다. 무한대를 표시하지 않는다.
            const rr = risk > 0 ? (reward / risk) : null;

            const validDirection =
              side === 'long' ? tp > entryPrice && sl < entryPrice
                              : tp < entryPrice && sl > entryPrice;

            // 방향이 거꾸로면 '대기' 색을 쓴다. readColors 에 warning 이 없으므로
            // 존재하는 토큰(pending)을 재사용한다 — 없는 필드를 참조하면 undefined 가
            // 그대로 캔버스에 들어가 색이 사라진다.
            const badgeColor = validDirection ? profitColor : (colors.pending || '#d97706');
            const rrText = rr === null ? 'R:R —' : `R:R ${rr.toFixed(2)}`;
            const dirText = validDirection ? '' : ' ⚠';
            figures.push(
              ...tagFigures(
                `${side === 'long' ? 'LONG' : 'SHORT'} ${rrText}${dirText}`,
                x0 + 6,
                entryY - 8,
                badgeColor,
                colors,
              ),
            );
          }

          return figures;
        },
        /*
           ★★★ 진입·TP·SL **세 가격을 모두 오른쪽 축에** 그린다.

             패널 쪽 콜백에서는 축에 닿을 수 없다(좌표계가 다르다 — axisPriceFigures
             주석의 실측 참고). 그래서 같은 계산을 축 콜백에서 한 번 더 한다.
             색은 패널과 동일해야 한다 — 축 배지 색과 선 색이 다르면 어느 선의
             가격인지 알 수 없다.
        */
        createYAxisFigures: ({ overlay, coordinates, bounding }) => {
          if (!coordinates.length) return [];
          const ext = overlay.extendData || {};
          const colors = ext.colors || readColors();
          const decimals = ext.decimals ?? 2;
          const long = colors.long || '#16a34a';
          const short = colors.short || '#dc2626';
          const profitColor = side === 'long' ? long : short;
          const lossColor = side === 'long' ? short : long;
          const pts = overlay.points || [];

          const out = [];
          /* 진입가 — 실시간 가격 배지와 같은 중립색. */
          if (pts[0] && coordinates[0]) {
            out.push(...axisPriceFigures(
              pts[0].value, coordinates[0].y, bounding, colors.textPri || '#e6ebf2', decimals, colors));
          }
          if (pts[1] && coordinates[1]) {
            out.push(...axisPriceFigures(pts[1].value, coordinates[1].y, bounding, profitColor, decimals, colors));
          }
          if (pts[2] && coordinates[2]) {
            out.push(...axisPriceFigures(pts[2].value, coordinates[2].y, bounding, lossColor, decimals, colors));
          }
          return out;
        },
      };
    }

    ensureOverlayRegistered('qtLongPosition', positionOverlay('qtLongPosition', 'long'));
    ensureOverlayRegistered('qtShortPosition', positionOverlay('qtShortPosition', 'short'));

    // --- 4. 신호 마커 (방향 삼각형) ---
    ensureOverlayRegistered('qtSignalMarker', {
      name: 'qtSignalMarker',
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ overlay, coordinates }) => {
        const c = coordinates[0];
        if (!c) return [];
        const { color, ext } = renderInfo(overlay);
        const isLong = ext.direction === 'long';
        const coords = isLong
          ? [{ x: c.x, y: c.y + 10 }, { x: c.x - 6, y: c.y + 20 }, { x: c.x + 6, y: c.y + 20 }]
          : [{ x: c.x, y: c.y - 10 }, { x: c.x - 6, y: c.y - 20 }, { x: c.x + 6, y: c.y - 20 }];
        return [
          {
            type: 'polygon',
            attrs: { coordinates: coords },
            styles: { style: 'fill', color },
          },
        ];
      },
    });
  }

  registerAllOverlays();

  /** 우리 오버레이 타입 -> 등록된 KLineChart 오버레이 이름 */
  const OVERLAY_NAME = {
    horizontal: 'qtHorizontal',
    'trend-line': 'qtTrendLine',
    'entry-zone': 'qtEntryZone',
    'signal-marker': 'qtSignalMarker',
    /*
       ★★ 피보나치는 **KLineChart 내장**을 쓴다(2026-09-18). 비율선·편집 손잡이가
         이미 구현돼 있고, 화면 그리기 도구(`chart-actions.js` 의 `fib`)도 같은 것을
         쓴다 — AI 가 그린 것과 손으로 그린 것이 같은 도형이어야 고객이 혼란스럽지 않다.
       ★ 우리 커스텀 오버레이(qt*)로 다시 만들지 않는다. 비율 계산·손잡이를 새로
         구현할 이유가 없고, 두 구현이 갈리면 값이 어긋난다.
    */
    fibonacci: 'fibonacciLine',
  };

  // ===============================================================
  // 스타일 — tokens.css 값을 KLineChart Styles 로 변환
  // ===============================================================
  function buildStyles(colors, opts) {
    const { decimals: _decimals } = opts;
    return {
      grid: {
        show: true,
        horizontal: { show: true, color: colors.grid, size: 1, style: 'solid' },
        vertical: { show: true, color: colors.grid, size: 1, style: 'solid' },
      },
      candle: {
        type: 'candle_solid',
        bar: {
          upColor: colors.up,
          downColor: colors.dn,
          noChangeColor: colors.textTer,
          upBorderColor: colors.up,
          downBorderColor: colors.dn,
          noChangeBorderColor: colors.textTer,
          upWickColor: colors.up,
          downWickColor: colors.dn,
          noChangeWickColor: colors.textTer,
        },
        priceMark: {
          show: true,
          high: { show: false },
          low: { show: false },
          last: {
            show: true,
            upColor: colors.up,
            downColor: colors.dn,
            noChangeColor: colors.textTer,
            line: { show: true, style: 'dashed', dashedValue: [4, 3], size: 1 },
            text: {
              show: true,
              style: 'fill',
              size: 11,
              paddingLeft: 6,
              paddingRight: 6,
              paddingTop: 3,
              paddingBottom: 3,
              borderRadius: 2,
              color: colors.textInverse,
              family: colors.fontMono,
              weight: '600',
            },
          },
        },
        // 내장 툴팁을 끈다. 우리 .chart-hud DOM 이 그 역할을 하며 디자인이 이미 정해져 있다.
        tooltip: { showRule: 'none', showType: 'standard' },
      },
      indicator: {
        ohlc: { upColor: colors.volUp, downColor: colors.volDn, noChangeColor: colors.textTer },
        bars: [
          {
            style: 'fill',
            borderStyle: 'solid',
            borderSize: 1,
            borderDashedValue: [2, 2],
            upColor: colors.volUp,
            downColor: colors.volDn,
            noChangeColor: colors.textTer,
          },
        ],
        lines: [
          { style: 'solid', smooth: false, size: 1.2, dashedValue: [2, 2], color: colors.ma1 },
          { style: 'solid', smooth: false, size: 1.2, dashedValue: [2, 2], color: colors.ma2 },
          { style: 'solid', smooth: false, size: 1.2, dashedValue: [2, 2], color: colors.ma3 },
        ],
        lastValueMark: { show: false },
        // 지표 툴팁도 우리 레전드로 대체한다.
        tooltip: { showRule: 'none' },
      },
      xAxis: {
        show: true,
        axisLine: { show: true, color: colors.grid, size: 1 },
        tickText: {
          show: true,
          color: colors.axisText,
          size: 10,
          family: colors.fontMono,
          weight: 'normal',
          marginStart: 4,
          marginEnd: 4,
        },
        tickLine: { show: true, size: 1, length: 3, color: colors.grid },
      },
      yAxis: {
        show: true,
        position: 'right',
        type: 'normal',
        inside: false,
        reverse: false,
        axisLine: { show: true, color: colors.grid, size: 1 },
        tickText: {
          show: true,
          color: colors.axisText,
          size: 10,
          family: colors.fontMono,
          weight: 'normal',
          marginStart: 6,
          marginEnd: 6,
        },
        tickLine: { show: true, size: 1, length: 3, color: colors.grid },
      },
      separator: { size: 1, color: colors.grid, fill: true, activeBackgroundColor: withAlpha(colors.ai, 0.08) },
      crosshair: {
        show: true,
        horizontal: {
          show: true,
          line: { show: true, style: 'dashed', dashedValue: [3, 3], size: 1, color: colors.crosshair },
          text: {
            show: true,
            style: 'fill',
            color: colors.textInverse,
            size: 10,
            family: colors.fontMono,
            weight: 'normal',
            borderRadius: 2,
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 3,
            paddingBottom: 3,
            backgroundColor: colors.textPri,
          },
        },
        vertical: {
          show: true,
          line: { show: true, style: 'dashed', dashedValue: [3, 3], size: 1, color: colors.crosshair },
          text: {
            show: true,
            style: 'fill',
            color: colors.textInverse,
            size: 10,
            family: colors.fontMono,
            weight: 'normal',
            borderRadius: 2,
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 3,
            paddingBottom: 3,
            backgroundColor: colors.textPri,
          },
        },
      },
      overlay: {
        /*
           ★★ 손잡이(점)를 **크게** 둔다.

             KLineChart 는 오버레이 몸통(선)을 끌 수 없다 — 실측으로 확인했다:
             선을 클릭해 선택한 뒤 몸통을 끌어도 값이 바뀌지 않고, **점을 잡을 때만**
             움직인다. 그러니 TP/SL 선을 옮기는 유일한 방법이 이 점이다.

             기본 radius 4 는 마우스로도 잘 안 맞고 터치로는 거의 불가능하다
             (WCAG 2.2 §2.5.8 이 요구하는 24px 과도 한참 멀다). 그래서 넓힌다.

           ★ 색은 그대로 둔다 — 선 색이 TP(이익)·SL(손실)을 말하고, 점은 "여기를
             잡으면 옮길 수 있다" 만 알리면 된다.
        */
        point: {
          color: colors.ai,
          borderColor: withAlpha(colors.ai, 0.35),
          borderSize: 1,
          radius: 7,
          activeColor: colors.ai,
          activeBorderColor: withAlpha(colors.ai, 0.5),
          activeBorderSize: 3,
          activeRadius: 9,
        },
        line: { style: 'solid', smooth: false, color: colors.ai, size: 1.5, dashedValue: [5, 4] },
      },
    };
  }

  // ===============================================================
  // 컴포넌트
  // ===============================================================
  window.ChartKline = function ChartKline({
    candles,
    timeframe = '15m',
    symbol = 'BTC/USDT',
    overlays = [],
    lastPrice,
    onOverlayChange,
    onOverlayHover,
    /*
       ★★ 예전에는 `_activeTool` 로 받았다 — 이름이 달라서 상위가 `activeTool` 을
         넘겨도 **전달되지 않고 항상 기본값 'cursor'** 였다(app.jsx 는 넘기고 있었다).
         선 몸통 드래그가 "그리기 도구가 켜져 있으면 잡지 않는다" 를 판단해야 하므로
         실제로 받는다.
    */
    activeTool = 'cursor',
    showMA = true,
    showVolume = true,
    showLegend = true,
    _padding = { top: 20, right: 68, bottom: 44, left: 8 },
    className = '',
    /** 차트 인스턴스를 상위로 알린다. 지표 패널이 여기에 붙는다.
        (chart, generation) 형태로 호출하며 파괴 시 (null, generation) 이 온다. */
    onChartReady,
  }) {
    const hostRef = useRef(null);
    const chartRef = useRef(null);
    const dataRef = useRef([]);
    /*
       ★★ 최신가를 심볼별로 등록한다 — 오버레이 렌더러가 **그리는 순간** 읽는다.

         이렇게 하면 진입가 선의 손익%가 시세와 함께 갱신되면서도, 오버레이
         배열을 매 틱마다 새로 만들 필요가 없다(= 드래그 중에 선이 튕기지 않는다).
    */
    useEffect(() => {
      if (window.QTOverlayLive) window.QTOverlayLive.setPrice(symbol, lastPrice);
    }, [symbol, lastPrice]);
    // dataRef 가 어떤 심볼/타임프레임의 데이터인지 표시한다. 심볼 전환 시
    // 이전 심볼 캔들이 새 심볼 라벨 아래 잠깐 보이는(깜빡임) 문제를 막는다.
    const dataKeyRef = useRef('');
    /* 마지막으로 차트에 실은 데이터의 지문. 같으면 resetData 를 건너뛴다. */
    const dataFingerprintRef = useRef('');
    /*
       ★ 마지막 갱신 시점의 봉 개수와 첫 타임스탬프. "마지막 봉만 바뀌었는가" 를
         판단하는 데 쓴다 — 그 경우에만 뷰를 건드리지 않는 갱신을 쓸 수 있다.
    */
    const prevLenRef = useRef(0);
    const prevFirstTsRef = useRef(null);
    /*
       klinecharts 가 `subscribeBar` 로 넘겨준 실시간 봉 갱신 콜백.
       ★ 이것으로 마지막 봉만 밀어 넣으면 `resetData`(1000봉 재적재)를 피한다.
       ★ 없으면(구버전·구독 전) 예전 경로로 떨어진다 — 기능이 사라지지는 않는다.
    */
    const liveBarRef = useRef(null);
    /*
       ★ 과거를 보는 동안 미뤄 둔 실시간 갱신이 있는가. 사용자가 오른쪽 끝으로
         돌아왔을 때 한 번 다시 그리기 위해 기억한다 — 미뤘다는 사실을 잊으면
         돌아와도 낡은 마지막 봉이 남는다.
    */
    const pendingLiveRef = useRef(false);
    /** 우리 overlay.id -> KLineChart overlay id */
    const overlayIdsRef = useRef(new Map());
    const maPaneRef = useRef(null);
    const volPaneRef = useRef(null);
    /*
       과거 캔들 로딩 상태.

       ★ dataLoader 는 차트 생성 시 한 번만 등록되므로 그 안에서 symbol/timeframe
         같은 값을 클로저로 잡으면 심볼을 바꿘 뒤에도 옛 심볼을 조회한다. 그래서
         최신 값을 ref 로 들고 읽는다.
       ★ 같은 구간을 반복 조회하지 않도록 요청 중 플래그와 '더 없음' 표시를 둔다.
    */
    const symbolRef = useRef(symbol);
    const timeframeRef = useRef(timeframe);
    const loadingOlderRef = useRef(false);
    const noMoreOlderRef = useRef(false);
    useEffect(() => {
      symbolRef.current = symbol;
      timeframeRef.current = timeframe;
      // 심볼/주기가 바뀌면 '더 없음' 판정을 초기화한다 — 새 심볼은 과거가 있을 수 있다.
      noMoreOlderRef.current = false;
      loadingOlderRef.current = false;
    }, [symbol, timeframe]);

    const [colors, setColors] = useState(readColors);
    const [hoverCandle, setHoverCandle] = useState(null);
    /*
       수평선 가격 편집. `null` 이면 닫힌 상태다.
       { id, value, locked } — value 는 입력 중인 문자열(숫자로 강제하지 않는다).
    */
    const [priceEdit, setPriceEdit] = useState(null);
    const [priceEditError, setPriceEditError] = useState(null);

    /*
       ★ 이 컴포넌트는 `t` 를 props 로 받지 않는다. 사전에서 직접 읽고, 키가 없으면
         영어 기본값을 쓴다 — 키를 넣기 전에도 화면에 키 문자열이 보이지 않게 한다.
    */
    const tx = React.useCallback((key, fallback) => {
      const i18n = window.QTI18n;
      if (i18n && typeof i18n.t === 'function') {
        const v = i18n.t(key);
        if (v && v !== key) return v;
      }
      return fallback;
    }, []);

    /*
       입력한 가격을 오버레이에 반영한다.

       ★★ 상위(`onOverlayChange`)로 넘긴다. 여기서 KLineChart 를 직접 고치면 상위
         상태와 어긋나 다음 렌더에 되돌아간다 — 드래그 경로와 같은 통로를 쓴다.

       ★ 검증에 실패하면 창을 닫지 않는다. 닫으면 무엇이 잘못됐는지 알 수 없고,
         고객은 "적용을 눌렀는데 아무 일도 없다" 로 겪는다.
    */
    /*
       ★★ **그리기 도구로 만든 수평선**의 클릭을 받는다.

         그 선은 `chart-actions.js` 가 KLineChart 에 직접 만들기 때문에 이 컴포넌트의
         오버레이 목록(`overlays`)에 없다. 그래서 아래 `onClick` 콜백이 걸리지 않는다.
         chart-actions 가 `qt:hline-click` 이벤트를 올려보내고, 여기서 받아 같은
         편집창을 띄운다.

       ★ `klId` 를 함께 담는다. 우리 상태에 없는 선이므로 KLineChart 를 직접 고쳐야
         한다(아래 applyPriceEdit 이 두 경로를 구분한다).
    */
    useEffect(() => {
      const onHlineClick = (e) => {
        const d = (e && e.detail) || {};
        setPriceEditError(null);
        setPriceEdit({
          id: null,
          klId: d.overlayId || null,
          value: d.value != null ? String(d.value) : '',
          locked: false,
        });
      };
      window.addEventListener('qt:hline-click', onHlineClick);
      return () => window.removeEventListener('qt:hline-click', onHlineClick);
    }, []);

    const applyPriceEdit = React.useCallback(() => {
      setPriceEdit((cur) => {
        if (!cur) return cur;
        if (cur.locked) return cur;
        /* 쉼표를 허용한다 — 68,400 처럼 붙여 넣는 경우가 많다. */
        const raw = String(cur.value ?? '').replace(/,/g, '').trim();
        const n = Number(raw);
        if (!raw || !Number.isFinite(n) || n <= 0) {
          setPriceEditError(
            tx('chart_hline_bad', 'Enter a price greater than 0.'),
          );
          return cur;             // 창을 닫지 않는다
        }
        setPriceEditError(null);
        /*
           ★★ 두 경로가 있다. 섞으면 한쪽이 조용히 되돌아간다.

             1) 우리 상태의 오버레이(AI 신호·주문선 등) → 상위로 올린다. 여기서
                KLineChart 를 직접 고치면 다음 렌더에 상위 값으로 덮인다.
             2) 그리기 도구로 만든 선 → 우리 상태에 없으므로 KLineChart 를 직접 고친다.
        */
        if (cur.id && onOverlayChange) {
          /*
             ★ points[0].price 만 바꾼다. time 은 그대로 둔다 — 수평선은 가격만
               의미가 있고, time 을 지금으로 바꾸면 선이 화면 밖으로 밀릴 수 있다.
          */
          onOverlayChange(cur.id, { points: [{ price: n }] });
        } else if (cur.klId) {
          const chart = chartRef.current;
          if (!chart) {
            setPriceEditError(tx('chart_hline_bad', 'Enter a price greater than 0.'));
            return cur;
          }
          try {
            chart.overrideOverlay({ id: cur.klId, points: [{ value: n }] });
          } catch (e) {
            /* ★ 실패를 성공으로 보이게 하지 않는다. 창을 닫지 않고 이유를 남긴다. */
            console.warn('[ChartKline] 수평선 가격 적용 실패', e);
            setPriceEditError(tx('chart_hline_bad', 'Enter a price greater than 0.'));
            return cur;
          }
        }
        return null;              // 성공하면 닫는다
      });
    }, [onOverlayChange, tx]);
    const [appLang, setAppLang] = useState(currentAppLang);
    /*
       ★★ 화면에 올라간 지표 목록. 레전드가 이것을 그린다.

         예전 레전드는 MA20·MA60·MA120 이 문자열로 박혀 있었다. 그래서 RSI·MACD 를
         켜도 이름이 나오지 않았고, 내장 툴팁은 "우리 레전드로 대체한다" 며 꺼놨으니
         결과적으로 **어느 쪽도 지표 이름을 말하지 않았다.**

       ★ 차트가 게시하는 상태(QTChartState)를 구독한다. 그 게시는 이미
         publishState() 가 마운트·추가·제거 시점에 하고 있으므로, 여기서는 읽기만
         하면 된다.
    */
    const [activeIndicators, setActiveIndicators] = useState([]);
    /*
       ★★ 요청한 타임프레임의 데이터를 기다리는 중인가.

         타임프레임을 누르면 `timeframe` 은 즉시 바뀌지만 `candles` 는 다음 렌더에나
         온다. 그 사이를 **빈 화면으로 스치게 두면 고장으로 읽힌다**(운영자 신고).
         "불러오는 중" 을 명시하면 의도된 상태로 읽힌다.
    */
    const [tfLoading, setTfLoading] = useState(false);
    /*
       ★ 마지막으로 차트에 적용한 심볼·기간. 같은 값을 다시 넣으면 KLineCharts 가
         불필요하게 다시 그려서 화면이 스친다(측정: 전환 1회에 4~5회 재렌더).
    */
    const appliedSymbolRef = useRef(null);
    const appliedPeriodRef = useRef(null);

    const decimals = useMemo(
      () => priceDecimalsFor(symbol, candles?.[candles.length - 1]?.close),
      [symbol, candles],
    );

    // --- 테마/브랜드 변경 시 색상 재적용 (ChartCanvas 와 동일 동작) ---
    /*
       지표 목록 구독.

       ★ 차트가 게시한 목록을 읽어 레전드에 그린다. 값(latest)까지 오지만 레전드는
         이름과 설정값만 쓴다 — 값은 HUD 와 툴팁의 역할이고, 여기에 숫자를 넣으면
         선 색 옆에 숫자가 붙어 읽기 어려워진다.

       ★ MA 계열만 기존 색 표기를 유지한다. 다른 지표의 선 색은 라이브러리가
         내부에서 정하므로 우리가 알 수 없고, 임의 색을 붙이면 화면과 어긋난다.
    */
    useEffect(() => {
      const MA_SWATCH = ['var(--chart-ma-1)', 'var(--chart-ma-2)', 'var(--chart-ma-3)'];
      const toItems = (detail) => {
        if (!Array.isArray(detail)) return [];
        const out = [];
        for (const d of detail) {
          const name = d && d.id ? String(d.id) : '';
          if (!name) continue;
          const params = d.params && Array.isArray(d.params.calcParams) ? d.params.calcParams : null;
          /*
             ★★★ **레전드는 사람이 읽을 이름을 쓴다.**

               커스텀 지표·신호 규칙의 등록 이름(`id`)은 충돌을 피하기 위한 기계용
               키다(`SIG_MACD_______U9NTX`). 실측에서 그 문자열이 레전드에 그대로
               나왔다 — 고객이 자기가 지은 "MACD 골든크로스" 를 찾을 수 없다.
               차트가 `title`(= klinecharts shortName)을 함께 게시하므로 그것을 쓴다.

             ★ 내장 지표는 title 이 없거나 name 과 같으므로 표기가 달라지지 않는다.
          */
          const shown = d.title ? String(d.title) : name;
          const label = params && params.length ? `${shown}(${params.join(',')})` : shown;
          if (name === 'MA' && params && params.length) {
            /* MA 는 설정값마다 선이 하나씩이므로 각각 표기한다. */
            params.slice(0, 3).forEach((n, idx) => {
              out.push({ name: `MA${n}`, paneId: d.paneId || 'candle', label: `MA${n}`, swatch: MA_SWATCH[idx] });
            });
            continue;
          }
          out.push({ name, paneId: d.paneId || 'candle', label, swatch: null });
        }
        return out.slice(0, 10);
      };
      const cs = window.QTChartState;
      if (!cs) return undefined;
      if (typeof cs.getIndicatorDetail === 'function') setActiveIndicators(toItems(cs.getIndicatorDetail()));
      if (typeof cs.subscribe !== 'function') return undefined;
      return cs.subscribe(() => {
        try { setActiveIndicators(toItems(cs.getIndicatorDetail())); } catch (e) { /* noop */ }
      });
    }, []);

    useEffect(() => {
      const root = document.documentElement;
      const obs = new MutationObserver(() => {
        setColors(readColors());
        setAppLang(currentAppLang());
      });
      obs.observe(root, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-brand', 'data-longshort', 'lang'],
      });
      return () => obs.disconnect();
    }, []);

    // --- 차트 생성 / 파괴 ---
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return undefined;

      const chart = KL.init(host, {
        locale: ensureChartLocale(currentAppLang()),
        styles: buildStyles(readColors(), { showVolume, decimals }),
      });
      if (!chart) return undefined;
      chartRef.current = chart;
      /*
         ★★ 진단용 노출. 차트 내부(봉 수·보이는 구간·배율)를 페이지에서 읽을 수 없어서
           문제를 잴 때마다 사람 눈에 의존해야 했다. 실제로 타임프레임 스침의 원인을
           추측으로 두 번 짚었고 한 번 틀렸다 — 잴 수 있으면 그럴 일이 없다.

         ★ 읽기 전용 진단이다. 여기에 의존하는 기능 코드는 두지 않는다 — 그러면
           디버그 훅이 제품 동작이 되어 지우지 못한다.
      */
      /*
         ★★ 진단 노출은 **로컬에서만** 한다.

           커밋 주석에 "읽기 전용" 이라고 썼는데 **부정확했다**(감사 지적). 인스턴스에는
           setStyles·createOverlay·setSymbol·resetData 등 **상태를 바꾸는 메서드**가 함께
           달려 있다. 프로덕션에서 전역으로 열어 두면 아무 스크립트나 차트를 조작할 수
           있고, 확장 프로그램이나 주입된 코드가 고객이 보는 차트를 바꿀 수 있다.

         ★ 그리고 인스턴스가 여러 개(멀티차트)면 같은 전역을 서로 덮어쓴다. 마지막에
           만들어진 것만 남으므로 진단값이 어느 차트인지 알 수 없다.

         ★ cleanup 에서 지운다 — 아래 unmount 경로 참고. 지우지 않으면 파괴된
           인스턴스를 가리키는 전역이 남아 호출 시 터진다.
      */
      const diagAllowed = (() => {
        try {
          const h = String(window.location?.hostname || '');
          return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
        } catch (e) { void e; return false; }
      })();
      try {
        if (!diagAllowed) throw new Error('skip diagnostics');
        window.__qtChart = chart;
        window.__qtChartInfo = () => {
          try {
            const bs = chart.getBarSpace && chart.getBarSpace();
            return {
              bars: chart.getDataList ? chart.getDataList().length : null,
              visible: chart.getVisibleRange ? chart.getVisibleRange() : null,
              barSpace: typeof bs === 'number' ? bs : (bs && bs.bar) || null,
              loading: window.__qtChartLoading || null,
            };
          } catch (e) { return { error: String(e && e.message) }; }
        };
      } catch (e) { void e; }
      INSTANCES.add(chart);
      if (onChartReady) onChartReady(chart);

      /*
         데이터 공급.

         ★★ 과거 캔들 자동 로딩. 이용자가 과거로 스크롤하거나 줌아웃하면 KLineChart 가
           type:'backward' 로 더 달라고 요청한다. 전에는 여기서 빈 배열 + backward:false
           로 답해 **정해진 개수(300)에서 더 이상 과거를 볼 수 없었다.**

         ★ 캐시 앞쪽 병합은 live-market 의 loadOlderCandles 가 담당한다(중복 제거 포함).
           받은 배열은 오름차순이고, 우리 dataRef 앞에 붙여 지표 계산과 순서를 맞춘다.

         ★ 무한 요청 방지: 요청 중(loadingOlderRef)에는 즉시 빈 응답, 더 받을 게 없으면
           noMoreOlderRef 를 세워 이후 backward:false 로 답한다.
      */
      chart.setDataLoader({
        getBars: ({ type, callback }) => {
          if (type === 'init') {
            callback(dataRef.current.slice(), { forward: false, backward: !noMoreOlderRef.current });
            return;
          }
          if (type !== 'backward') { callback([], { forward: false, backward: false }); return; }

          const LM = window.QTLive;
          const first = dataRef.current[0];
          if (noMoreOlderRef.current || loadingOlderRef.current || !first
              || !LM || typeof LM.loadOlderCandles !== 'function') {
            callback([], { forward: false, backward: !noMoreOlderRef.current && !!first });
            return;
          }

          /*
             ★★ 이용자가 **실제로 과거를 보고 있을 때만** 불러온다.

               이게 없으면 무한 증식한다. 실측한 고리는 이렇다:

                 시세 1틱 → candles 배열이 새로 생김 → 아래 effect 가 resetData()
                 → resetData 직후 klinecharts 가 곧바로 backward 를 요청
                 → 300개 앞에 붙음 → 다음 틱에 또 resetData → 또 300개 …

               초당 300개씩 과거로 뻗어나가서, 20초에 3,820 → 5,020개가 됐다.
               데이터 구간이 매초 바뀌므로 Y축 범위와 오버레이(진입선·TP/SL 점선)가
               계속 튀었다 — 이용자가 본 "차트가 계속 바뀐다, 점선이 생겼다
               없어졌다" 가 바로 이 현상이다.

             ★ 판정: 보이는 구간의 시작이 데이터 앞쪽 근처(20봉 이내)일 때만
               과거를 요청한다. resetData 직후에는 최신(오른쪽 끝)을 보고 있으므로
               자동 요청이 일어나지 않는다. 이용자가 왼쪽으로 스크롤하면 걸린다.

             ★ 가시범위를 못 읽으면 **불러오지 않는다**. 모르는 상태에서 불러오면
               위 무한 고리로 되돌아간다 — 스크롤이 한 번 안 되는 것보다 나쁘다.
          */
          let nearLeftEdge = false;
          try {
            const chartNow = chartRef.current;
            const vr = chartNow && chartNow.getVisibleRange && chartNow.getVisibleRange();
            const from = vr ? (vr.from ?? vr.realFrom) : null;
            if (typeof from === 'number') nearLeftEdge = from <= 20;
          } catch (e) { /* 못 읽으면 아래에서 막는다 */ }

          if (!nearLeftEdge) {
            // 더 있다는 사실은 알려주되(스크롤하면 다시 물어본다) 지금은 주지 않는다.
            callback([], { forward: false, backward: true });
            return;
          }

          /*
             ★★ 커서는 **timestamp** 다.

               dataRef 의 캔들은 {timestamp, open, ...} 형식이다(아래 병합 effect 가
               그렇게 만든다). 전에는 여기서 `first.time` 을 읽었는데 그 필드는
               존재하지 않아 undefined 였다. loadOlderCandles 는 beforeTs 가 falsy 면
               **즉시 빈 배열**을 돌려주므로(live-market.js), 첫 backward 요청에서
               바로 "더 없음"으로 굳어 과거 로딩이 영구히 멈췄다. (사용자 제보의 원인)
          */
          loadingOlderRef.current = true;
          LM.loadOlderCandles(symbolRef.current, timeframeRef.current, first.timestamp, 300)
            .then((older) => {
              loadingOlderRef.current = false;
              const rows = Array.isArray(older) ? older : [];
              /*
                 ★ loadOlderCandles 는 {time, ...} 형식을 돌려준다. klinecharts 와
                   dataRef 는 {timestamp, ...} 를 쓴다. 여기서 변환하지 않으면
                   과거 캔들이 timestamp 없이 들어가 화면에서 사라지거나 어긋난다.
              */
              const head = rows
                .map((c) => ({
                  timestamp: Number(c.time),
                  open: Number(c.open),
                  high: Number(c.high),
                  low: Number(c.low),
                  close: Number(c.close),
                  volume: Number(c.volume) || 0,
                }))
                .filter((b) => Number.isFinite(b.timestamp) && b.timestamp < first.timestamp && Number.isFinite(b.close));

              if (!head.length) {
                // 거래소에 더 과거가 없다 — 이후로는 요청하지 않게 한다.
                noMoreOlderRef.current = true;
                callback([], { forward: false, backward: false });
                return;
              }
              // 우리 데이터 앞에 붙인다(이미 first.timestamp 보다 과거만 남겼다).
              dataRef.current = head.concat(dataRef.current);
              callback(head.slice(), { forward: false, backward: true });
            })
            .catch(() => {
              loadingOlderRef.current = false;
              // 실패를 '더 없음' 으로 굳히지 않는다 — 일시적 오류일 수 있다.
              callback([], { forward: false, backward: true });
            });
        },

        /*
           ★★★ **실시간 봉 갱신 창구 — 이것이 없어서 매 틱마다 1000봉을 다시 실었다.**

             klinecharts 는 `init` 로드가 끝나면 `subscribeBar({symbol, period, callback})`
             를 부르고, 우리가 그 `callback(bar)` 을 부르면 내부적으로
             `_addData(bar, 'update')` 가 돈다(vendor 번들에서 확인):

               bar.timestamp  >  마지막 봉  → 뒤에 **추가**
               bar.timestamp === 마지막 봉  → 마지막 봉 **교체**
               그 외                        → 무시

             그 뒤 지표만 다시 계산하고 가벼운 layout 을 한다. **데이터 재적재도,
             로더 재호출도, 뷰 이동도 없다.**

           ★★ 예전에는 이 창구를 제공하지 않아서 시세 1틱마다 `resetData()` 를 불렀다.
             실측(틱 10회 시뮬레이션): `resetData` 8회, 그때마다
             `getBars init` 8회(1000봉 전량) + `getBars backward` 8회(과거 요청).
             주석에는 "이 버전에는 부분 갱신 API 가 없다" 고 적혀 있었는데, 그것은
             **인스턴스 메서드**(updateData/appendData)를 본 것이고 — 실제로 없다 —
             로더 쪽 실시간 경로는 있었다. 층이 다른 API 를 같은 것으로 본 것이다.

           ★ 콜백을 ref 에 담는다. `resetData` 는 내부에서 unsubscribe 후 init 을 다시
             돌리며 subscribeBar 를 **다시** 부르므로, 최신 콜백으로 갱신돼야 한다.
        */
        subscribeBar: ({ callback }) => { liveBarRef.current = callback; },
        unsubscribeBar: () => { liveBarRef.current = null; },
      });

      chart.setSymbol({ ticker: symbol, pricePrecision: decimals, volumePrecision: 3 });
      chart.setPeriod(periodFor(timeframe));

      /*
         ★★ 과거 이력은 **우리가 직접** 불러온다.

           klinecharts 의 backward 콜백에만 의지하면 안 된다는 것을 실측으로
           확인했다: 이용자가 왼쪽 끝(from=0)까지 끌어도 라이브러리가 backward 를
           다시 요청하지 않아 과거가 더 붙지 않았다. (앞서 "과거 로딩이 된다" 고
           본 것은 실은 resetData ↔ backward 무한 고리가 데이터를 늘리고 있던
           것이고, 그 고리를 막자 로딩도 함께 멈춘 것이다.)

           그래서 가시 구간을 주기적으로 보고, 왼쪽 끝에 가까워지면 우리가 가져와
           앞에 붙인다. 라이브러리 내부 판단에 의존하지 않아 동작이 예측 가능하다.

         ★ 안전장치
           · 요청 중이면 겹쳐 부르지 않는다.
           · 거래소가 더 줄 게 없으면 다시 묻지 않는다.
           · 왼쪽 끝 근처가 아니면 아무 것도 하지 않는다 — 무한 증식을 막는 핵심.
           · 붙인 뒤 스크롤 위치를 되돌려 보던 자리를 유지한다.
      */
      const historyTimer = setInterval(() => {
        const ch = chartRef.current;
        const LM = window.QTLive;
        if (!ch || loadingOlderRef.current || noMoreOlderRef.current) return;
        if (!LM || typeof LM.loadOlderCandles !== 'function') return;
        const first = dataRef.current[0];
        if (!first) return;

        let from = null;
        try {
          const vr = ch.getVisibleRange && ch.getVisibleRange();
          from = vr ? (vr.from ?? vr.realFrom) : null;
        } catch (e) { return; }
        if (typeof from !== 'number' || from > 20) return;

        loadingOlderRef.current = true;
        const anchorTs = first.timestamp;
        LM.loadOlderCandles(symbolRef.current, timeframeRef.current, anchorTs, 300)
          .then((older) => {
            loadingOlderRef.current = false;
            const head = (Array.isArray(older) ? older : [])
              .map((c) => ({
                timestamp: Number(c.time),
                open: Number(c.open),
                high: Number(c.high),
                low: Number(c.low),
                close: Number(c.close),
                volume: Number(c.volume) || 0,
              }))
              .filter((b) => Number.isFinite(b.timestamp) && b.timestamp < anchorTs && Number.isFinite(b.close));

            if (!head.length) { noMoreOlderRef.current = true; return; }
            dataRef.current = head.concat(dataRef.current);
            /* 지문을 무효화한다 — 안 하면 아래 effect 가 "같다" 며 건너뛰어 화면에 안 나온다. */
            dataFingerprintRef.current = '';
            try {
              chartRef.current.resetData();
              chartRef.current.scrollToTimestamp(anchorTs, 0);
            } catch (e) { /* 복원 실패는 치명적이지 않다 */ }
          })
          .catch(() => { loadingOlderRef.current = false; });
      }, 700);


      const onCrosshair = (data) => {
        // data.dataIndex 가 있으면 그 캔들, 없으면(차트 밖) null 로 최신 캔들 표시
        const idx = data && typeof data.dataIndex === 'number' ? data.dataIndex : null;
        setHoverCandle(idx !== null && dataRef.current[idx] ? dataRef.current[idx] : null);
      };
      chart.subscribeAction('onCrosshairChange', onCrosshair);

      /*
         ─────────────────── 패널 크기 변화 따라가기 ───────────────────

         ★★ **이것이 없어서 패널을 키워도 차트가 그대로였다.**

           KLineChart 는 캔버스에 그린다. 캔버스 크기는 생성 시점의 컨테이너 크기로
           정해지고, 컨테이너가 커져도 **스스로 다시 그리지 않는다.** 그래서 패널만
           커지고 차트는 예전 크기로 남아 오른쪽·아래에 빈 공간이 생겼다.

           격자 크기 조절은 CSS 로 일어나므로 리액트 렌더가 다시 돌지 않는다 —
           그래서 렌더에 의존하는 방법으로는 잡을 수 없다. 컨테이너를 직접 관찰한다.

         ★ 프레임마다 부르지 않는다. ResizeObserver 는 드래그 중 수십 번 발화하는데,
           그때마다 resize() 를 부르면 캔버스를 계속 다시 만들어 끊긴다.
           requestAnimationFrame 으로 한 프레임에 한 번만 반영한다.

         ★ 크기가 0 이면 건너뛴다. 패널이 접히거나 탭이 숨겨지면 0 이 되는데, 그때
           resize() 를 부르면 KLineChart 가 잘못된 축을 계산해 다시 보일 때 깨진다.
      */
      let resizeRaf = 0;
      const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          const r = host.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;
          try { chart.resize(); } catch (e) { /* 파괴된 차트면 무시한다 */ }
        });
      }) : null;
      if (ro) ro.observe(host);

      return () => {
        if (ro) { try { ro.disconnect(); } catch (e) { /* noop */ } }
        if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
        // 과거 이력 폴링을 멈춘다 — 남겨두면 파괴된 차트를 계속 건드린다.
        clearInterval(historyTimer);
        try {
          chart.unsubscribeAction('onCrosshairChange', onCrosshair);
        } catch (e) { /* noop */ }
        INSTANCES.delete(chart);
        if (onChartReady) onChartReady(null);
        try {
          KL.dispose(host);
        } catch (e) { /* noop */ }
        chartRef.current = null;
        /*
           ★ 진단 전역을 지운다. 남겨 두면 파괴된 인스턴스를 가리켜 호출 시 터지고,
             멀티차트에서는 어느 차트인지도 알 수 없다.
        */
        try {
          if (window.__qtChart === chart) {
            window.__qtChart = null;
            window.__qtChartInfo = null;
          }
        } catch (e) { void e; }
        overlayIdsRef.current.clear();
        maPaneRef.current = null;
        volPaneRef.current = null;
      };
      // 심볼/타임프레임 변경은 아래 별도 effect 에서 처리한다. 여기서 재생성하면
      // 사용자의 줌/스크롤 상태가 매번 초기화된다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- 언어 변경 반영 ---
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.setLocale(ensureChartLocale(appLang));
    }, [appLang]);

    // --- 색상 변경 반영 ---
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.setStyles(buildStyles(colors, { showVolume, decimals }));
    }, [colors, showVolume, decimals]);

    // --- 데이터 주입 ---
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart || !Array.isArray(candles)) return;

      const bars = candles
        .map((c) => ({
          timestamp: Number(c.time),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume) || 0,
        }))
        .filter((b) => Number.isFinite(b.timestamp) && b.timestamp > 0 && Number.isFinite(b.close));

      if (bars.length === 0) { dataRef.current = bars; dataKeyRef.current = symbol + '|' + timeframe; return; }

      /*
         ★★★ **요청한 타임프레임의 데이터인지 먼저 확인한다.**

           `timeframe` prop 은 클릭 즉시 새 값이 되지만 `candles` 는 다음 렌더에나
           온다. 그 사이에 옛 캔들을 새 키로 도장 찍으면 아래 심볼/타임프레임
           effect 의 `stale` 검사가 '맞는 데이터' 로 오인하고 **틀린 프레임을
           그대로 그린다.** 그것이 "최초에 다른 화면이 나왔다가 바뀐다" 였다.

         ★ 여기서 거부하면 dataKeyRef 를 건드리지 않으므로, 곧 이어지는
           심볼/타임프레임 effect 가 stale 로 판단해 화면을 비운다. 즉 **틀린
           프레임이 잠깐이라도 보이지 않는다.** 올바른 데이터가 오면 그때 그린다.
      */
      /*
         ★★★ **캔들이 아직 없는 것도 "불러오는 중" 이다.**

           live-market 이 실캔들이 없을 때 목업 대신 **빈 배열**을 돌려주도록 바꿨다
           (그 목업이 장대봉의 원인이었다 — 실측 1H 최초 65,034~68,433 vs 실데이터
           77,880~79,661). 그래서 이 경로로 빈 배열이 들어온다.

         ★ 간격 검증(candlesMatchTimeframe)은 `bars.length < 3` 이면 **true** 를
           돌려준다(판단할 근거가 없으므로 통과시키는 것이 맞다). 그대로 두면 빈
           배열이 통과해 **빈 차트**가 그려진다 — 장대봉이 빈 화면으로 바뀌는 것뿐이다.

         ★ 그래서 길이를 먼저 본다. 3봉 미만이면 그릴 것이 없다.
      */
      if (!Array.isArray(bars) || bars.length < 3) {
        try { window.__qtChartLoading = symbol + '|' + timeframe; } catch (e) { void e; }
        setTfLoading(true);
        return;
      }
      if (!candlesMatchTimeframe(bars, timeframe)) {
        /*
           ★ 요청한 프레임의 데이터가 아직 아니다 = 불러오는 중이다. 화면이 그것을
             말할 수 있게 표시를 남긴다. 예전에는 조용히 빈 화면이 스쳐서 고장으로
             읽혔다(운영자: "타임프레임 누르면 스친다").
        */
        try { window.__qtChartLoading = symbol + '|' + timeframe; } catch (e) { void e; }
        setTfLoading(true);
        return;
      }
      try { window.__qtChartLoading = null; } catch (e) { void e; }
      setTfLoading(false);

      const key = symbol + '|' + timeframe;
      const sameKey = dataKeyRef.current === key;

      /*
         ★★ 과거 스크롤로 불러온 이력을 보존한다.

           candles 는 최근 구간(약 300개)만 담아 라이브로 자주 갱신된다. 전에는
           그때마다 dataRef 를 통째로 갈아끼워, 과거로 스크롤해 불러온 오래된
           캔들이 매 틱마다 지워졌다. 그래서 "과거로 계속 이동이 안 되는" 현상이
           생겼다. 현재 candles 범위보다 **오래된** 것은 그대로 이어 붙인다.
      */
      let merged = bars;
      if (sameKey && Array.isArray(dataRef.current) && dataRef.current.length) {
        const firstNewTs = bars[0].timestamp;
        const olderHistory = dataRef.current.filter((b) => b.timestamp < firstNewTs);
        if (olderHistory.length) merged = olderHistory.concat(bars);
      }
      dataRef.current = merged;
      dataKeyRef.current = key;

      /*
         ★★ 내용이 그대로면 resetData 를 부르지 않는다.

           resetData 는 데이터를 통째로 다시 싣고 뷰를 흔든다. candles 배열은 매
           틱마다 **새 배열 객체**로 만들어지지만(app.jsx 의 useMemo 가 market.price
           에 의존한다) 내용은 대개 같거나 마지막 봉만 다르다. 그런데도 매번
           resetData 를 부르면 차트가 초당 한 번씩 다시 그려지고 뷰가 튄다.

         ★ 지문으로 비교한다: 봉 개수 + 첫 타임스탬프 + 마지막 타임스탬프 +
           마지막 종가. 마지막 봉 값이 바뀌면 지문도 바뀌므로 실시간 갱신은
           그대로 반영된다. 완전히 같을 때만 건너뛴다.
      */
      const lastBar = merged[merged.length - 1];
      const fingerprint = `${merged.length}|${merged[0].timestamp}|${lastBar.timestamp}|${lastBar.close}|${lastBar.high}|${lastBar.low}|${lastBar.volume}`;
      if (sameKey && dataFingerprintRef.current === fingerprint) return;
      dataFingerprintRef.current = fingerprint;

      /*
         ★★ 사용자가 과거를 보고 있으면 스크롤 위치를 유지한다.

           resetData 는 로더에서 데이터를 다시 당겨오며 뷰를 최신(오른쪽 끝)으로
           되돌린다. 라이브 갱신마다 그러면 과거를 못 본다. 갱신 전 가시 구간의
           시작 캔들 타임스탬프를 기억해, 오른쪽 끝을 보고 있던 게 아니면 복원한다.
      */
      let anchorTs = null;
      try {
        const vr = chart.getVisibleRange && chart.getVisibleRange();
        const dl = chart.getDataList && chart.getDataList();
        if (vr && Array.isArray(dl) && dl.length) {
          const to = (vr.to ?? vr.realTo);
          const from = (vr.from ?? vr.realFrom);
          // 오른쪽 끝(최신)을 보고 있지 않을 때만 앵커를 잡는다(라이브 관찰 중엔 그대로 둔다).
          if (typeof to === 'number' && to < dl.length - 1 && typeof from === 'number' && dl[from]) {
            anchorTs = dl[from].timestamp;
          }
        }
      } catch (e) { /* 가시범위 조회 실패는 치명적이지 않다 */ }

      /*
         ★★ 과거를 보고 있으면 **resetData 를 부르지 않는다.**

           실측(가시범위를 3초 간격으로 관찰): 과거로 스크롤한 뒤 범위가
           48→86, 192→230, 84→122 로 계속 튀었다. 사용자는 차트를 읽을 수 없다.

           원인: resetData() 는 데이터를 통째로 버리고 **데이터 로더를 다시
           호출한다.** 로더는 비동기이므로, 그 직후에 scrollToTimestamp 로
           앵커를 복원해도 로더 응답이 도착하면 뷰가 다시 최신으로 밀린다.
           복원과 로더가 경쟁하면서 매 갱신마다 위치가 흔들린 것이다.

         ★ 마지막 봉만 바뀌는 경우(실시간 틱)에는 전체를 다시 실을 이유가 없다.
           그 한 봉만 갱신한다(updateData). 과거를 보는 중에도 최신 봉은 정확히
           유지되고, 뷰는 움직이지 않는다.

         ★ 봉 개수나 첫 타임스탬프가 바뀐 경우(심볼·주기 변경, 과거 추가 적재)는
           구조가 달라진 것이므로 resetData 가 맞다. 그때는 앵커를 복원한다.
      */
      const prevLen = prevLenRef.current;
      const prevFirstTs = prevFirstTsRef.current;
      prevLenRef.current = merged.length;
      prevFirstTsRef.current = merged[0].timestamp;

      const onlyLastBarChanged = sameKey
        && prevLen === merged.length
        && prevFirstTs === merged[0].timestamp;

      /*
         ★★★ **마지막 봉만 바뀌었으면 그 한 봉만 밀어 넣는다 — resetData 하지 않는다.**

           시세 1틱마다 `candles` 배열이 새로 만들어지고(app.jsx 의 useMemo 가
           `market.price` 에 의존한다) 마지막 봉의 종가가 달라진다. 예전에는 그때마다
           `resetData()` 를 불러 **1000봉을 통째로 다시 싣고 데이터 로더까지 다시
           호출했다.** 실측(틱 10회 시뮬레이션): resetData 8회 · getBars init 8회 ·
           getBars backward 8회.

           이제 로더의 실시간 창구(`subscribeBar` 콜백)로 마지막 봉만 보낸다.
           klinecharts 가 마지막 봉을 교체하고 지표만 다시 계산한다.

         ★★ 부수 효과로 **과거를 보는 중에도 최신 봉이 갱신된다.** 예전에는 뷰가 튀는
           것을 막으려고 과거를 보는 동안 갱신을 아예 미뤘다(`pendingLiveRef`).
           부분 갱신은 뷰를 움직이지 않으므로 미룰 이유가 없다.

         ★ 봉이 **하나 늘어난 경우**(새 봉 형성)도 같은 창구로 보낸다. `_addData` 가
           timestamp 가 크면 뒤에 붙인다. 첫 타임스탬프가 그대로여야 한다 — 바뀌었으면
           창이 미끄러진 것이므로 구조 변경으로 보고 resetData 한다.

         ★★ 콜백이 없으면(구독 전 등) 예전 경로로 떨어진다. 조용히 갱신을 잃지 않는다.
      */
      const appendedOneBar = sameKey
        && prevLen > 0
        && merged.length === prevLen + 1
        && prevFirstTs === merged[0].timestamp;

      if ((onlyLastBarChanged || appendedOneBar) && typeof liveBarRef.current === 'function') {
        try {
          liveBarRef.current({
            timestamp: lastBar.timestamp,
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            volume: lastBar.volume,
          });
          pendingLiveRef.current = false;
          return;
        } catch (e) {
          /*
             ★ 실패하면 아래 전체 경로로 떨어진다. 부분 갱신이 안 되는 것보다
               "봉이 갱신되지 않는 것" 이 나쁘다.
          */
          console.warn('[ChartKline] 실시간 봉 갱신 실패 — 전체 재적재로 대체:', e && e.message);
        }
      }

      /*
         ★★ 과거를 보고 있고 **마지막 봉만 바뀐 경우**에는 다시 그리지 않는다.

           위 실시간 창구를 쓸 수 없을 때의 대비책이다. 이 KLineCharts 버전의
           **인스턴스**에는 부분 갱신 메서드가 없다(실측: updateData/appendData 없음).
           그래서 콜백이 없으면 "마지막 봉만 갱신" 을 할 방법이 없고, 그때는
           과거를 보는 동안 갱신을 미루는 편이 뷰가 튀는 것보다 낫다.
      */
      if (onlyLastBarChanged && anchorTs != null) {
        pendingLiveRef.current = true;
        return;
      }

      /*
         ★★★ **확대 배율을 보존한다.**

           resetData() 는 데이터를 통째로 다시 실으면서 봉 간격(bar space)을 기본값으로
           되돌린다. 그래서 이용자가 확대해 둔 상태에서 시세가 한 번 바뀌면 배율이
           툭 되돌아간다 — 운영자가 본 "확대하면 깜빡거리고 튕긴다" 의 절반이 이것이다.
           위치(scrollToTimestamp)만 복원하고 **배율은 복원하지 않았다.**

         ★ getBarSpace/setBarSpace 는 이 KLineCharts 버전에 있다(vendor 번들에서 확인).
           예전 주석의 "부분 갱신 API 가 없다" 는 updateData 계열을 말한 것이고,
           배율 API 는 별개다.

         ★ 못 읽거나 못 쓰면 조용히 넘어간다 — 배율 복원 실패가 차트 자체를
           멈추게 하면 안 된다.
      */
      let keepBarSpace = null;
      try {
        const bs = chart.getBarSpace && chart.getBarSpace();
        /* getBarSpace 는 버전에 따라 숫자 또는 {bar,halfBar,...} 를 돌려준다. */
        const v = typeof bs === 'number' ? bs : (bs && typeof bs.bar === 'number' ? bs.bar : null);
        if (typeof v === 'number' && v > 0) keepBarSpace = v;
      } catch (e) { /* 못 읽으면 복원하지 않는다 */ }

      chart.resetData();

      if (anchorTs != null) {
        try { chart.scrollToTimestamp(anchorTs, 0); } catch (e) { /* 복원 실패는 무시 */ }
        /* ★ 위치 복원 뒤에 배율을 되돌린다. 순서가 바뀌면 배율 변경이 위치를 흔든다. */
        if (keepBarSpace != null) {
          try { if (chart.setBarSpace) chart.setBarSpace(keepBarSpace); } catch (e) { /* 무시 */ }
        }
      }
    }, [candles]);

    // --- 심볼 / 타임프레임 변경 ---
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      const key = symbol + '|' + timeframe;
      // 현재 보유 데이터가 새 심볼/타임프레임의 것이 아니면(아직 새 candles 미도착),
      // 이전 심볼 캔들이 잠깐 보이지 않도록 먼저 비운다. 새 candles 가 오면
      // 위의 데이터 주입 effect 가 resetData 로 채운다. 데이터가 이미 일치하면
      // (심볼+candles 가 같은 렌더에서 도착) 건드리지 않아 방금 채운 데이터를 지우지 않는다.
      const stale = dataKeyRef.current !== key;
      if (stale) dataRef.current = [];
      /*
         ★★★ **바뀐 것만 적용한다.** 이것이 "타임프레임 누를 때 스친다" 의 원인이었다.

           호출 횟수를 세어 보니(진단 노출로 메서드를 감싸 측정):
               타임프레임 전환 1회 → setSymbol 1 · setPeriod 1 · resetData 2~3

           심볼은 **바뀌지 않았는데도** setSymbol 이 매번 불렸다. KLineCharts 는
           setSymbol·setPeriod·resetData 각각에서 캔버스를 다시 그린다. 즉 한 번
           바뀌는데 **네다섯 번 다시 그려서** 중간 상태가 눈에 스친다.

         ★ 마지막으로 적용한 값을 기억하고 실제로 달라졌을 때만 부른다.
           타임프레임만 바꾸면 setPeriod + resetData 두 번으로 줄어든다.

         ★ decimals 만 바뀌는 경우도 있다(심볼 정밀도 갱신). 그때는 setSymbol 만
           부르고 period·데이터는 건드리지 않는다.
      */
      const symKey = symbol + '|' + decimals;
      if (appliedSymbolRef.current !== symKey) {
        appliedSymbolRef.current = symKey;
        chart.setSymbol({ ticker: symbol, pricePrecision: decimals, volumePrecision: 3 });
      }
      if (appliedPeriodRef.current !== timeframe) {
        appliedPeriodRef.current = timeframe;
        chart.setPeriod(periodFor(timeframe));
      }
      if (stale) chart.resetData();
    }, [symbol, timeframe, decimals]);

    // --- 지표: MA (showMA) ---
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;

      if (showMA) {
        if (maPaneRef.current === null) {
          // 캔들 위에 겹쳐 그린다.
          // 실측: paneId 를 3번째 인자(paneOptions)로 주면 무시되고 새 페인이 생긴다.
          // IndicatorCreate 객체 안에 paneId 를 넣어야 candle_pane 에 붙는다.
          // isStack=true: 사용자가 나중에 BOLL 등 다른 가격축 지표를 켜도
          // MA 가 교체되지 않고 함께 표시된다.
          const maParams = (window.QTChartParams && window.QTChartParams.get('MA')) || [20, 60, 120];
          const id = chart.createIndicator({
            name: 'MA',
            calcParams: maParams,
            paneId: 'candle_pane',
          }, true);
          maPaneRef.current = id ?? 'candle_pane';
        }
      } else if (maPaneRef.current !== null) {
        chart.removeIndicator({ paneId: 'candle_pane', name: 'MA' });
        maPaneRef.current = null;
      }
    }, [showMA]);

    // --- 지표: VOL (showVolume) ---
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;

      if (showVolume) {
        if (volPaneRef.current === null) {
          // calcParams: [] 로 VOL 의 기본 MA선(5/10/20)을 없앤다.
          // 디자이너 차트는 거래량 바만 그렸으므로 그 모습을 유지한다.
          const id = chart.createIndicator({ name: 'VOL', calcParams: [] }, false);
          volPaneRef.current = id;
          if (id) {
            // 거래량 페인 비율을 ChartCanvas 와 비슷하게(약 16%) 맞춘다.
            chart.setPaneOptions({ id, height: 78, minHeight: 40, dragEnabled: true });
          }
        }
        /*
           ★★ 차트가 지표를 갖춘 시점에 **스스로 게시한다.**

             예전에는 지표 패널 컴포넌트만 게시했다. 이용자가 그 패널을 열지 않으면
             AI 코파일럿에게 지표 값이 전달되지 않아, 화면에는 MA·VOL 이 보이는데
             AI 는 값을 모르는 상태가 됐다.

           ★ 계산이 한 프레임 뒤에 끝나므로 약간 늦춰 읽는다. 즉시 읽으면 result 가
             비어 있어 값 없는 목록을 게시한다.
        */
        /*
           ★★ 두 번 게시한다: 즉시, 그리고 계산이 끝난 뒤.

             계산이 한 프레임 뒤에 끝나므로 즉시 게시하면 값이 비어 있다. 반대로
             지연만 하면 지표 이름이 늦게 나타나 화면이 한 박자 밀린다(실측:
             레전드가 다음 조작 때 갱신됐다).

             이름은 즉시 필요하고 값은 조금 뒤에 온다 — 두 번 게시가 두 요구를
             모두 만족한다.
        */
        try { window.ChartKlineUtil && window.ChartKlineUtil.publishState(); } catch (e) { /* noop */ }
        setTimeout(() => {
          try { window.ChartKlineUtil && window.ChartKlineUtil.publishState(); } catch (e) { /* noop */ }
        }, 300);
      } else if (volPaneRef.current !== null) {
        chart.removeIndicator({ paneId: volPaneRef.current, name: 'VOL' });
        volPaneRef.current = null;
      }
    }, [showVolume]);

    /*
       끌고 있는 수평선. 아래 두 곳이 함께 본다 —
         · 오버레이 동기화 효과: 끌고 있는 선을 되쓰지 않는다(손가락 아래에서 튕김 방지)
         · 몸통 드래그 효과: 진행 상태를 담는다
       ★ 두 효과보다 **위에** 선언한다. 저장소에 TDZ 로 화면이 죽은 사고가 있다.
    */
    const lineDragRef = useRef(null);

    /*
       ★★★ **최신 값을 ref 로 읽는다 — 효과를 다시 붙이지 않기 위해서.**

         처음에는 이 효과의 의존성을 `[overlays, onOverlayChange, activeTool]` 로 두었다.
         그런데 상위가 `onOverlayChange={(id, ov) => updateOverlay(id, ov)}` 처럼
         **인라인 화살표**를 넘기므로 매 렌더마다 새 함수가 되고, 효과가 **매 렌더
         해제·재부착**됐다. 그 해제가 진행 중인 드래그 상태를 지웠다.

         시세는 초당 여러 번 들어오므로 렌더도 그만큼 일어난다. 결과: **드래그가
         산발적으로 먹지 않았다.** 실측에서 같은 지점이 한 번은 되고 다음엔 안 됐고,
         "왼쪽은 안 되고 가운데는 된다" 처럼 위치 문제로 보였다 — 실제로는 타이밍이었다.

       ★ 그래서 리스너는 **한 번만** 붙이고(의존성 []), 값은 ref 로 읽는다.
         렌더 중 ref 에 대입하는 것은 안전하다(읽는 시점은 이벤트 발생 후다).
    */
    const overlaysRef = useRef(overlays);
    overlaysRef.current = overlays;
    const onOverlayChangeRef = useRef(onOverlayChange);
    onOverlayChangeRef.current = onOverlayChange;
    const activeToolRef = useRef(activeTool);
    activeToolRef.current = activeTool;

    // --- 오버레이 동기화 ---
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;

      const known = overlayIdsRef.current;
      const seen = new Set();

      for (const ov of overlays) {
        if (!ov || ov.hidden) continue;
        const name = OVERLAY_NAME[ov.type];
        if (!name) continue;

        const points = pointsFor(ov);
        if (!points) continue;
        seen.add(ov.id);

        /*
           ★★★ **끌고 있는 선은 건드리지 않는다.**

             이 효과는 상태(overlays)를 차트에 되쓴다. 드래그 중에는 상태가 아직
             옛 가격이므로, 이 사이에 다른 이유로 렌더가 한 번 일어나면(시세 틱
             하나면 충분하다) 선이 **손가락 아래에서 원래 자리로 튕긴다.**

             확정은 손을 뗄 때 한 번만 한다(onPointerUp → onOverlayChange). 그때
             상태가 새 가격이 되고, 다음 동기화가 정상적으로 그 값을 그린다.
        */
        if (lineDragRef.current && lineDragRef.current.ourId === ov.id) continue;

        const extendData = {
          source: ov.source || 'user',
          label: ov.label,
          dashed: Boolean(ov.style?.dashed),
          direction: ov.direction,
          width: ov.width,
          decimals,
          colors,
          /*
             실시간 라벨용 원본. 문자열이 아니라 계산에 필요한 값만 담는다
             (위 renderInfo 주석 참고).
          */
          live: ov.live,
          symbol: ov.symbol,
        };

        const existing = known.get(ov.id);
        if (existing) {
          chart.overrideOverlay({ id: existing, points, extendData, lock: Boolean(ov.locked) });
        } else {
          const created = chart.createOverlay({
            name,
            points,
            extendData,
            lock: Boolean(ov.locked),
            // 드래그가 끝나면 상위로 통지한다 (ChartCanvas onOverlayChange 와 동일 계약).
            onPressedMoveEnd: (event) => {
              if (!onOverlayChange) return true;
              const moved = event.overlay;
              onOverlayChange(ov.id, patchFromPoints(ov, moved.points));
              return false;
            },
            /*
               ★★ 선을 클릭하면 **가격을 숫자로 입력**할 수 있게 한다.

                 마우스로 끌어 맞추면 원하는 값에 정확히 못 세운다. 지지·저항선은
                 "68,400" 같은 딱 떨어지는 값에 두고 싶은데, 드래그로는 68,412 처럼
                 어긋난다. 그러면 그 선을 기준으로 만든 주문 초안도 어긋난다.

               ★ 수평선만 대상이다. 추세선·구간은 점이 둘 이상이라 숫자 하나로
                 정할 수 없다 — 그건 별개 작업이다.
            */
            onClick: (event) => {
              if (ov.type !== 'horizontal') return false;
              const p = (event.overlay && event.overlay.points && event.overlay.points[0]) || null;
              setPriceEdit({
                id: ov.id,
                /* 지금 값을 그대로 채워 넣는다 — 빈 칸에서 시작하면 다시 입력해야 한다. */
                value: p && p.value != null ? String(p.value) : '',
                locked: Boolean(ov.locked),
              });
              return false;
            },
            onMouseEnter: () => {
              if (onOverlayHover) onOverlayHover(ov);
              return false;
            },
            onMouseLeave: () => {
              if (onOverlayHover) onOverlayHover(null);
              return false;
            },
          });
          if (typeof created === 'string') known.set(ov.id, created);
        }
      }

      // 사라진 오버레이 제거
      for (const [ourId, klId] of [...known.entries()]) {
        if (seen.has(ourId)) continue;
        try {
          chart.removeOverlay({ id: klId });
        } catch (e) { /* 이미 제거됨 */ }
        known.delete(ourId);
      }
    }, [overlays, colors, decimals, onOverlayChange, onOverlayHover]);

    /*
       ═══════════════════════════════════════════════════════════════════
       ★★★ 수평선(TP/SL·주문선)을 **선 어디서나 잡아서** 끌 수 있게 한다
       ═══════════════════════════════════════════════════════════════════

       왜 직접 만드는가 — KLineChart 는 오버레이 **점(손잡이)** 만 끌 수 있다.
       실측으로 확인했다: 선을 클릭해 선택한 뒤 몸통을 끌어도 값이 바뀌지 않고,
       손잡이(마지막 봉 x, 실측 x=245)를 잡을 때만 움직였다. 손잡이는 화면 한 곳에만
       있으므로, 이용자는 "선이 보이는데 안 잡힌다" 를 겪는다. 운영자 요청이 이것이다.

       설계 원칙
        · 기존 경로를 대체하지 않는다. 손잡이 드래그는 그대로 두고(그쪽이 활성 표시가
          더 낫다), **손잡이가 아닌 곳**만 우리가 처리한다.
        · 확정은 손을 뗄 때 한 번만, 그리고 **기존 `onOverlayChange` 로** 보낸다.
          주문 반영 로직(app.jsx handleOverlayChange)을 새로 만들지 않는다.
        · 차트의 다른 조작을 빼앗지 않는다 — 실제로 선을 잡았을 때만 이벤트를 멈춘다.

       ★★ 리스너는 **호스트(컨테이너)** 에 capture 로 붙인다.
         KLineChart 는 패널마다 캔버스를 여러 장 겹쳐 두므로 캔버스 하나에 붙이면
         맨 위 캔버스가 이벤트를 먼저 받고 형제에게는 오지 않는다(capture 는 조상
         사슬만 탄다). 이 함정은 TP/SL 클릭 설정에서 이미 한 번 밟았다.
    */
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return undefined;

      /** 캔들 패널 캔버스의 화면 사각형 — 좌표 기준. */
      const paneRect = () => {
        const best = [...host.querySelectorAll('canvas')]
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.height > 80 && r.width > 80)
          .sort((a, b) => (b.height * b.width) - (a.height * a.width))[0];
        return best || null;
      };

      /** 이 오버레이를 몸통 드래그로 옮겨도 되는가. */
      const draggable = (ov) => ov
        && ov.type === 'horizontal'
        && !ov.hidden
        && !ov.locked
        && ov.points
        && ov.points[0]
        && ov.points[0].price != null;

      /**
       * 포인터 y 에 가장 가까운 수평선을 찾는다.
       *
       * ★ 여러 선이 겹쳐 있으면 **가장 가까운 것** 하나만 잡는다. 둘을 같이 옮기면
       *   어느 것을 옮겼는지 알 수 없다.
       * ★ 손잡이 근처는 비켜 준다 — KLineChart 가 이미 처리하고, 둘이 함께 반응하면
       *   값이 두 번 바뀐다.
       */
      const TOL = 7;          // 선을 잡았다고 볼 세로 허용 오차(px)
      const HANDLE_KEEPOUT = 16;  // 손잡이 반경(7) + 여유

      const pick = (clientX, clientY, rect) => {
        const chart = chartRef.current;
        if (!chart) return null;
        /*
           ★ 잠금 판정은 **우리 모델(`ov.locked`)만** 본다.

             차트 쪽 `lock` 을 함께 보는 코드를 넣어 봤지만 아무것도 막지 못했다.
             동기화 효과가 매번 `lock: Boolean(ov.locked)` 로 되쓰기 때문이다 —
             실측: overrideOverlay({lock:true}) 직후엔 true 지만 1.5초 뒤 false 로 돌아온다.
             즉 모델이 단일 출처이고, 두 곳을 보는 것은 "막는 것처럼 보이지만 막지 않는"
             코드였다. 그래서 지웠다.
        */
        let best = null;
        for (const ov of overlaysRef.current) {
          if (!draggable(ov)) continue;
          const klId = overlayIdsRef.current.get(ov.id);
          if (!klId) continue;
          let py;
          try {
            const px = chart.convertToPixel({ value: Number(ov.points[0].price) }, { paneId: 'candle_pane' });
            py = px && Number.isFinite(px.y) ? px.y : null;
          } catch (e) { py = null; }
          if (py === null) continue;
          const dist = Math.abs((rect.top + py) - clientY);
          if (dist > TOL) continue;

          /* 손잡이 위라면 KLineChart 에 양보한다. */
          try {
            const hx = chart.convertToPixel(
              { timestamp: ov.points[0].time ?? Date.now(), value: Number(ov.points[0].price) },
              { paneId: 'candle_pane' },
            );
            if (hx && Number.isFinite(hx.x) && Math.abs((rect.left + hx.x) - clientX) <= HANDLE_KEEPOUT) return null;
          } catch (e) { /* 손잡이 위치를 모르면 그냥 우리가 처리한다 */ }

          if (!best || dist < best.dist) best = { ov, klId, dist };
        }
        return best;
      };

      const valueAt = (clientY, rect) => {
        const chart = chartRef.current;
        if (!chart) return null;
        try {
          const got = chart.convertFromPixel({ y: clientY - rect.top }, { paneId: 'candle_pane' });
          return got && Number.isFinite(got.value) && got.value > 0 ? got.value : null;
        } catch (e) { return null; }
      };

      const onDown = (e) => {
        /*
           ★ 그리기 도구가 켜져 있으면 손대지 않는다 — 그때의 클릭은 도형을 만드는
             동작이다. 커서 도구일 때만 선을 잡는다.
           ★ 왼쪽 버튼만. 가운데 버튼·Shift 드래그는 차트 팬이다.
        */
        const tool = activeToolRef.current;
        if (tool && tool !== 'cursor') return;
        if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        const rect = paneRect();
        if (!rect) return;
        if (e.clientY < rect.top || e.clientY > rect.bottom || e.clientX < rect.left || e.clientX > rect.right) return;

        const hit = pick(e.clientX, e.clientY, rect);
        if (!hit) return;

        lineDragRef.current = { ourId: hit.ov.id, klId: hit.klId, ov: hit.ov, rect, moved: false, value: null };
        /*
           ★★ 여기서만 이벤트를 멈춘다. 선을 잡지 못했으면 그대로 흘려보내 차트의
             크로스헤어·팬·손잡이 드래그가 정상 동작한다.
        */
        e.preventDefault();
        e.stopPropagation();
        try { host.setPointerCapture(e.pointerId); } catch (err) { void err; }
        host.style.cursor = 'ns-resize';
      };

      const onMove = (e) => {
        const d = lineDragRef.current;
        if (!d) return;
        const v = valueAt(e.clientY, d.rect);
        if (v === null) return;
        d.moved = true;
        d.value = v;
        e.preventDefault();
        e.stopPropagation();
        /* 화면만 먼저 옮긴다. 상태 반영은 손을 뗄 때 한 번. */
        try {
          chartRef.current.overrideOverlay({
            id: d.klId,
            points: [{ timestamp: d.ov.points[0].time ?? Date.now(), value: v }],
          });
        } catch (err) { void err; }
      };

      const finish = (e) => {
        const d = lineDragRef.current;
        if (!d) return;
        lineDragRef.current = null;
        host.style.cursor = '';
        try { host.releasePointerCapture(e.pointerId); } catch (err) { void err; }
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        /*
           ★ 움직이지 않았으면 아무것도 하지 않는다. 선을 살짝 누른 것만으로 주문
             값이 바뀌면 안 된다.
           ★★ 확정은 **기존 경로**로 보낸다 — draft-tp/draft-sl 은 주문 패널 값이 되고,
             posbr-* 는 옮기기만 되고(확정은 별도 버튼), 나머지는 오버레이 상태가 된다.
             그 판단은 app.jsx handleOverlayChange 가 이미 하고 있다.
        */
        const notify = onOverlayChangeRef.current;
        if (!d.moved || d.value === null || !notify) return;
        const patched = {
          ...d.ov,
          points: (d.ov.points || []).map((p, i) => (i === 0 ? { ...p, price: d.value } : p)),
        };
        notify(d.ourId, patched);
      };

      const onCancel = (e) => {
        const d = lineDragRef.current;
        if (!d) return;
        lineDragRef.current = null;
        host.style.cursor = '';
        try { host.releasePointerCapture(e.pointerId); } catch (err) { void err; }
        /* 취소면 화면을 상태 값으로 되돌린다. */
        try {
          chartRef.current.overrideOverlay({
            id: d.klId,
            points: [{ timestamp: d.ov.points[0].time ?? Date.now(), value: Number(d.ov.points[0].price) }],
          });
        } catch (err) { void err; }
      };

      /*
         ★ 커서 모양으로 "잡을 수 있다" 를 알린다. 선 위에 올렸을 때만 바꾼다 —
           항상 바꾸면 차트 전체가 조작 가능한 것처럼 보인다.
      */
      const onHover = (e) => {
        if (lineDragRef.current) return;
        const tool = activeToolRef.current;
        if (tool && tool !== 'cursor') return;
        const rect = paneRect();
        if (!rect) return;
        const over = pick(e.clientX, e.clientY, rect);
        host.style.cursor = over ? 'ns-resize' : '';
      };

      host.addEventListener('pointerdown', onDown, true);
      host.addEventListener('pointermove', onMove, true);
      host.addEventListener('pointerup', finish, true);
      host.addEventListener('pointercancel', onCancel, true);
      host.addEventListener('pointermove', onHover);
      return () => {
        host.removeEventListener('pointerdown', onDown, true);
        host.removeEventListener('pointermove', onMove, true);
        host.removeEventListener('pointerup', finish, true);
        host.removeEventListener('pointercancel', onCancel, true);
        host.removeEventListener('pointermove', onHover);
        /*
           ★ 진행 중인 드래그 상태를 **지우지 않는다.** 예전에 여기서 지웠고,
             효과가 매 렌더 재부착되면서 손가락이 아직 눌린 채로 드래그가 사라졌다.
             호스트 요소는 그대로이므로 재부착돼도 같은 드래그를 이어받는다.
        */
      };
      /* ★ 의존성 없음 — 값은 위 ref 로 읽는다(재부착이 드래그를 끊는다). */
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- HUD 표시용 캔들 (커서 위치 없으면 최신) ---
    const hudCandle = useMemo(() => {
      if (hoverCandle) return hoverCandle;
      const list = dataRef.current;
      return list.length ? list[list.length - 1] : null;
      // candles 변경 시 최신 캔들이 바뀌므로 의존성에 포함한다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hoverCandle, candles]);

    return (
      <div className={`chart-kline-wrap ${className}`}>
        <div
          ref={hostRef}
          className="chart-kline-host"
          style={{ position: 'absolute', inset: 0 }}
        />

        {/*
           ★★ "불러오는 중" 표시. 타임프레임을 바꾼 직후 데이터가 오기 전 구간이다.

             예전에는 그 구간에 **빈 화면이 스쳤다.** 운영자가 "타임프레임 누를 때
             스친다" 고 한 것이 이것이다. 데이터가 오는 시간을 없앨 수는 없으므로,
             **의도된 상태로 보이게** 만든다.

           ★ pointerEvents: none — 표시가 차트 조작을 막으면 안 된다.
        */}
        {tfLoading && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'var(--color-bg-panel)', opacity: 0.82,
              pointerEvents: 'none', zIndex: 3,
              fontSize: 12, color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)', letterSpacing: '0.03em',
            }}
          >
            {tx('chart_loading_tf', 'Loading candles…').replace('{tf}', timeframe)}
          </div>
        )}

        {/* HUD — ChartCanvas 와 동일한 마크업/클래스 */}
        {/*
           ─────────────── 수평선 가격 입력 ───────────────

           ★★ 드래그로는 원하는 값에 정확히 못 세운다. 지지·저항선을 "68,400" 같은
             딱 떨어지는 값에 두고 싶은데 마우스로는 68,412 처럼 어긋나고, 그 선을
             기준으로 만든 주문 초안도 함께 어긋난다.

           ★ 잠긴 선은 값을 바꾸지 못한다. 잠금은 "실수로 건드리지 않겠다" 는 뜻이므로
             숫자 입력으로 우회할 수 있으면 잠금이 무의미하다.

           ★ 빈 값·숫자가 아닌 값·0 이하는 저장하지 않는다. 가격이 0 이면 선이 축
             밖으로 나가 사라진 것처럼 보인다.
        */}
        {priceEdit && (
          <div className="chart-price-edit" role="dialog" aria-label={tx('chart_hline_price', 'Line price')}>
            <div className="chart-price-edit__title">{tx('chart_hline_price', 'Line price')}</div>
            {priceEdit.locked ? (
              <div className="chart-price-edit__note">{tx('chart_hline_locked', 'This line is locked.')}</div>
            ) : (
              <>
                <input
                  className="chart-price-edit__input"
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  aria-label={tx('chart_hline_price', 'Line price')}
                  value={priceEdit.value}
                  onChange={(e) => setPriceEdit((s2) => ({ ...s2, value: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); applyPriceEdit(); }
                    if (e.key === 'Escape') { e.preventDefault(); setPriceEdit(null); }
                  }}
                />
                <div className="chart-price-edit__row">
                  <button type="button" className="btn btn--sm btn--primary" onClick={applyPriceEdit}>
                    {tx('sv_apply', 'Apply')}
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => setPriceEdit(null)}>
                    {tx('sv_cancel', 'Cancel')}
                  </button>
                </div>
                {priceEditError && (
                  <div className="chart-price-edit__err" role="alert">{priceEditError}</div>
                )}
              </>
            )}
          </div>
        )}

        {hudCandle && (
          <div className="chart-hud">
            <div className="chart-hud__row">
              <span className="k">{symbol}</span>
              <span className="k">·</span>
              <span className="k">{timeframe}</span>
            </div>
            <div className="chart-hud__row">
              <span className="k">O</span><span className="v">{fmtPrice(hudCandle.open)}</span>
              <span className="k">H</span><span className="v" style={{color:'var(--color-trade-long)'}}>{fmtPrice(hudCandle.high)}</span>
              <span className="k">L</span><span className="v" style={{color:'var(--color-trade-short)'}}>{fmtPrice(hudCandle.low)}</span>
              <span className="k">C</span><span className="v">{fmtPrice(hudCandle.close)}</span>
              <span className="k">Δ</span>
              <span className="v" style={{color: hudCandle.close >= hudCandle.open ? 'var(--color-trade-long)' : 'var(--color-trade-short)'}}>
                {((hudCandle.close - hudCandle.open) / hudCandle.open * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        )}

        {/*
           ★★ 활성 지표를 **모두** 보여준다.

             예전에는 MA20·MA60·MA120 세 개가 문자열로 박혀 있었고, 그것도 showMA
             일 때만 나왔다. 그래서 RSI·MACD·PSY 를 켜도 화면에 이름이 없었다 —
             운영자 신고 그대로 "무슨 지표인지 모르겠다" 는 상태다.

             내장 툴팁은 껐다(`tooltip: { showRule: 'none' }`, "우리 레전드로
             대체한다"). 그런데 그 레전드가 MA 만 알고 있었으니, 대체한다고 적어
             두고 실제로는 대체하지 못한 상태였다.

           ★ 이름과 설정값을 함께 보여준다. `MA` 만으로는 20일선인지 120일선인지
             알 수 없고, 그 둘은 완전히 다른 판단이다.

           ★ 색은 지표 자체의 선 색을 쓸 수 없으므로(라이브러리가 내부에서 정한다)
             MA 계열만 기존 색 표기를 유지하고, 나머지는 이름만 보여준다 — 없는
             색을 지어내면 화면의 선 색과 어긋난다.
        */}
        {showLegend && activeIndicators.length > 0 && (
          <div className="chart-legend">
            {activeIndicators.map((ind) => (
              <div className="chart-legend__item" key={`${ind.name}-${ind.paneId}`}>
                {ind.swatch
                  ? <span className="chart-legend__swatch" style={{ background: ind.swatch }}/>
                  : null}
                {ind.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------
  // 우리 오버레이 모델 <-> KLineChart points 변환
  // ---------------------------------------------------------------

  /**
   * KLineChart Point = { timestamp, value } (dataIndex 는 KLineChart 가 채운다).
   * 이 변환이 시간축 정확성의 핵심이다. 우리가 인덱스를 계산하지 않으므로
   * 캔들 누락(거래 한산 구간)이 있어도 좌표가 어긋나지 않는다.
   */
  function pointsFor(ov) {
    if (ov.type === 'horizontal') {
      const p = ov.points?.[0];
      if (!p || p.price == null) return null;
      return [{ timestamp: p.time ?? Date.now(), value: p.price }];
    }
    if (ov.type === 'trend-line') {
      if (!ov.points || ov.points.length < 2) return null;
      return ov.points.slice(0, 2).map((p) => ({ timestamp: p.time, value: p.price }));
    }
    if (ov.type === 'entry-zone') {
      if (ov.priceHi == null || ov.priceLo == null) return null;
      const t = ov.points?.[0]?.time ?? Date.now();
      return [
        { timestamp: t, value: ov.priceHi },
        { timestamp: t, value: ov.priceLo },
      ];
    }
    if (ov.type === 'signal-marker') {
      const p = ov.points?.[0];
      if (!p || p.price == null) return null;
      return [{ timestamp: p.time ?? Date.now(), value: p.price }];
    }
    return null;
  }

  /** 드래그 결과를 우리 오버레이 모델로 되돌린다. */
  function patchFromPoints(ov, points) {
    if (!Array.isArray(points) || points.length === 0) return ov;

    if (ov.type === 'entry-zone') {
      const vals = points.map((p) => p.value).filter((v) => v != null);
      if (vals.length < 2) return ov;
      return { ...ov, priceHi: Math.max(...vals), priceLo: Math.min(...vals) };
    }

    const mapped = points.map((p, i) => ({
      ...(ov.points?.[i] || {}),
      time: p.timestamp ?? ov.points?.[i]?.time,
      price: p.value ?? ov.points?.[i]?.price,
    }));
    return { ...ov, points: mapped };
  }

  /**
   * 지표 등록 이름(키)을 만든다.
   *
   * ★★★ **한글 이름은 전부 `_` 로 바뀌어 서로 충돌한다.**
   *
   *   예전 구현은 `name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')` 만 했다. 그래서
   *   실측(2026-09-18):
   *     "MACD 골든크로스" → SIG_MACD______
   *     "MACD 데드크로스" → SIG_MACD______   ← 같은 키
   *   두 번째 규칙이 첫 번째를 **조용히 덮어썼다.** 고객은 규칙 두 개를 만들었는데
   *   하나만 남는다. 이 서비스의 이용자는 한국어 이름을 쓸 것이므로 정상 사용에서
   *   바로 밟는다.
   *
   * ★ 그래서 원본 이름의 해시를 붙인다. 읽을 수 있는 부분(ASCII)은 남겨 두어
   *   레전드·로그에서 알아볼 수 있게 한다.
   */
  function indicatorKey(prefix, name) {
    const raw = String(name || '');
    const ascii = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 10);
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
    return `${prefix}_${ascii}_${Math.abs(h).toString(36).toUpperCase().slice(0, 5)}`;
  }

  window.ChartKlineUtil = {
    fmtPrice,
    readColors,
    withAlpha,
    periodFor,
    OVERLAY_NAME,
    ensureChartLocale,
    buildChartLocale,
    currentAppLang,

    /** 살아있는 차트 인스턴스 목록. */
    instances: () => [...INSTANCES],

    /*
       AI 지표 브리지 — 코파일럿이 검증된 addIndicator/removeIndicator 명령을 실제
       차트에 적용하는 통로. 사용자가 켜는 지표(showMA/showVolume)와 충돌하지 않게
       AI 가 추가한 지표의 페인 id 만 따로 기억한다.

       가격축에 겹치는 지표(MA/EMA/BOLL/SAR/BBI)는 candle_pane 에 stack 으로, 그
       외(RSI/MACD/KDJ 등)는 별도 페인에 그린다. klinecharts 가 모르는 이름이면
       조용히 실패하지 않고 false 를 돌려줘 코파일럿이 "미지원" 을 정직히 알린다.
    */
    _aiOverlayInds: new Set(['MA', 'EMA', 'SMA', 'BOLL', 'SAR', 'BBI']),
    _aiInd: new Map(), // name(UPPER) -> paneId
    _aiAlias: { STOCH: 'KDJ' }, // 우리 enum → klinecharts 내장명
    /*
       ★★ 활성 지표와 **계산된 값**을 QTChartState 에 게시한다.

         예전에는 이 게시가 지표 패널 컴포넌트 안에만 있었다. 그래서 이용자가
         Indicators 패널을 한 번도 열지 않으면 AI 코파일럿에게 값이 전달되지
         않았다 — 화면에는 MA·VOL 이 그려져 있는데 AI 는 "지표 정보가 없다" 고
         답하는 상태다. 실측으로 확인했다(패널을 열기 전 상세 목록이 비어 있었다).

       ★ 차트가 지표의 소유자이므로 게시도 차트가 한다. 패널은 조작 도구일 뿐이다.

       ★ 값이 없으면 값 필드를 넣지 않는다. null·0 을 넣으면 모델이 그것을 값으로
         읽는다.
    */
    publishState() {
      try {
        const cs = window.QTChartState;
        if (!cs || typeof cs.publishIndicators !== 'function') return;
        const chart = [...INSTANCES][0];
        if (!chart) return;
        const list = chart.getIndicators() || [];
        cs.publishIndicators(list.map((i) => i.name));
        if (typeof cs.publishIndicatorDetail === 'function') {
          cs.publishIndicatorDetail(list.map((i) => {
            const res = Array.isArray(i.result) ? i.result : null;
            const last = res && res.length > 0 ? res[res.length - 1] : null;
            const prev = res && res.length > 1 ? res[res.length - 2] : null;
            return {
              id: i.name,
              /*
                 ★★★ **내부 키를 고객에게 보여주지 않는다.**

                   커스텀 지표·신호 규칙의 등록 이름은 `SIG_MACD_______U9NTX` 처럼
                   충돌을 피하기 위한 기계용 키다. 레전드가 `id` 를 그대로 그려서
                   실측에서 그 문자열이 화면에 나왔다. 사람이 읽을 이름을 함께 준다.

                 ★ 내장 지표(MA·VOL 등)는 name 과 shortName 이 같으므로 달라지지 않는다.
              */
              ...(i.shortName && i.shortName !== i.name ? { title: String(i.shortName) } : {}),
              ...(Array.isArray(i.calcParams) && i.calcParams.length ? { params: { calcParams: i.calcParams } } : {}),
              ...(last && typeof last === 'object' ? { latest: last } : {}),
              ...(prev && typeof prev === 'object' ? { previous: prev } : {}),
            };
          }));
        }
      } catch (e) { /* 게시 실패가 차트를 막지 않는다 */ }
    },
    /**
     * 지표를 켠다.
     *
     * ★★★ **이미 켜져 있으면 설정만 바꾼다 — 중복으로 켜지 않는다.**
     *
     *   예전에는 그냥 `createIndicator` 를 다시 불렀다. 실측(2026-09-18):
     *     addIndicator('RSI', [14]) → RSI[14]
     *     addIndicator('RSI', [7])  → RSI[14] **와** RSI[7]  ← 창이 두 개
     *     addIndicator('MA', [10,30]) → MA[20,60,120] **와** MA[10,30]
     *
     *   고객이 "RSI 를 7 로 바꿔줘" 라고 하면 설정이 바뀌는 게 아니라 지표가 하나 더
     *   생긴다. 우리 서비스는 **말로 차트를 조작하는 것**이므로 이것이 곧 오작동이다.
     *
     * ★ 설정을 주지 않고 다시 켜면 아무것도 하지 않는다(이미 켜져 있다). `applied`
     *   는 true 로 돌려준다 — 요청한 상태가 됐다는 뜻이고, AI 가 "이미 켜져 있다" 를
     *   실패로 오해해 다시 시도하지 않게 한다.
     */
    addIndicator(name, params) {
      const raw = String(name || '').toUpperCase();
      const kName = (this._aiAlias && this._aiAlias[raw]) || raw;
      const calcParams = Array.isArray(params) ? params.filter((n) => Number.isFinite(n) && n > 0) : undefined;
      let applied = false;
      for (const chart of INSTANCES) {
        try {
          const already = (chart.getIndicators() || []).some((i) => i.name === kName);
          if (already) {
            /*
               ★ 설정이 있으면 제자리에서 바꾼다. `overrideIndicator` 가 pane 을 찾아
                 갱신한다(번들에서 확인). 없으면 켜진 상태를 그대로 둔다.
            */
            if (calcParams && calcParams.length) {
              try { chart.overrideIndicator({ name: kName, calcParams }); } catch (e) { /* 무시 */ }
            }
            applied = true;
            continue;
          }
          const onPrice = this._aiOverlayInds.has(kName);
          const create = onPrice
            ? { name: kName, paneId: 'candle_pane', ...(calcParams ? { calcParams } : {}) }
            : { name: kName, ...(calcParams ? { calcParams } : {}) };
          const id = chart.createIndicator(create, onPrice);
          if (id) { this._aiInd.set(kName, onPrice ? 'candle_pane' : id); applied = true; }
        } catch (e) { /* 지원하지 않는 지표 이름 등 — applied 는 false 로 남는다 */ }
      }
      /*
         ★ 지표가 바뀌었으니 게시한다. 안 하면 AI 가 방금 추가된 지표의 값을
           모른 채 답한다.
      */
      // ★ 이름은 즉시, 값은 계산 후. 둘 다 필요하다.
      try { this.publishState(); } catch (e) { /* noop */ }
      setTimeout(() => { try { this.publishState(); } catch (e) { /* noop */ } }, 300);
      return applied;
    },

    /**
     * 켜져 있는 지표의 **설정(기간)만** 바꾼다.
     *
     * ★★★ 이 경로가 없어서 "RSI 를 7 로 바꿔줘" 가 중복 추가가 됐다. 우리 서비스는
     *   말로 차트를 조작하는 것이므로 **설정 변경은 기본 기능**이다.
     *
     * ★★ 켜져 있지 않으면 **켜지 않는다.** `{ applied: false, error: 'NOT_ON' }` 로
     *   정직하게 말한다 — 없는 지표의 설정을 바꿔 달라는 것은 대개 오해이고,
     *   조용히 켜 버리면 고객이 요청하지 않은 지표가 화면에 생긴다.
     *
     * ★ 값 검사는 addIndicator 와 같다(양의 정수만). 0 이나 음수는 klinecharts 가
     *   무한 루프에 빠질 수 있고, 그때 화면 전체가 멈춘다.
     */
    setIndicatorParams(name, params) {
      const raw = String(name || '').toUpperCase();
      const kName = (this._aiAlias && this._aiAlias[raw]) || raw;
      const calcParams = (Array.isArray(params) ? params : [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0 && n === Math.floor(n));
      if (!calcParams.length) return { applied: false, error: 'BAD_PARAMS' };

      let found = false;
      let applied = false;
      for (const chart of INSTANCES) {
        try {
          if (!(chart.getIndicators() || []).some((i) => i.name === kName)) continue;
          found = true;
          try { chart.overrideIndicator({ name: kName, calcParams }); } catch (e) { /* 아래에서 확인한다 */ }
          /*
             ★★★ **반환값을 믿지 않고 실제 상태를 다시 읽는다.**

               `overrideIndicator` 는 적용됐는데도 `false` 를 돌려주는 경우가 있다.
               실측(2026-09-18): MA 를 [10,30,60] 으로 바꿨더니 차트에는 반영됐는데
               반환은 false 였다. 그 값을 믿고 실패로 보고하면 AI 가 "바꾸지 못했다"
               고 말하는데 화면은 바뀐 상태가 된다 — 고객이 무엇을 믿어야 할지 모른다.

             ★ 그래서 `getIndicators()` 로 되읽어 설정이 정말 그 값인지 확인한다.
               라이브러리의 반환 규약이 바뀌어도 이 판정은 흔들리지 않는다.
          */
          const now = (chart.getIndicators() || []).find((i) => i.name === kName);
          const got = now && Array.isArray(now.calcParams) ? now.calcParams : null;
          if (got && got.length === calcParams.length && got.every((v, k) => Number(v) === calcParams[k])) {
            applied = true;
          }
        } catch (e) { /* 이 차트에서 실패 — 다음 차트 시도 */ }
      }
      if (!found) return { applied: false, error: 'NOT_ON' };
      try { this.publishState(); } catch (e) { /* noop */ }
      setTimeout(() => { try { this.publishState(); } catch (e) { /* noop */ } }, 300);
      return applied ? { applied: true, name: kName, params: calcParams } : { applied: false, error: 'OVERRIDE_FAILED' };
    },
    /*
       지표 제거.

       ★★ 예전에는 `paneId: this._aiInd.get(name) || 'candle_pane'` 로 지웠고,
         호출이 예외를 던지지 않으면 removed = true 를 돌려줬다.

         RSI·MACD 처럼 **별도 pane 에 올라가는 지표**는 _aiInd 에 기록이 없으면
         candle_pane 으로 지우려 하고, 그 pane 에는 그 지표가 없으므로 아무 일도
         일어나지 않는다. 그런데 예외도 나지 않아 **true 를 돌려줬다.**
         실측: addIndicator('RSI') 후 removeIndicator('RSI') → true, 그런데 RSI 는
         그대로 남아 있었다.

         AI 코파일럿이 이 함수를 쓴다. 즉 AI 가 "RSI 를 지웠습니다" 라고 답하면서
         화면에는 그대로 남는 상태였다.

       ★ 그래서 **실제 지표 목록에서 pane 을 찾아** 지우고, 지운 뒤 목록을 다시 읽어
         정말 사라졌는지로 성공을 판정한다. 요청이 아니라 결과를 보고한다.
    */
    removeIndicator(name) {
      const raw = String(name || '').toUpperCase();
      const kName = (this._aiAlias && this._aiAlias[raw]) || raw;
      for (const chart of INSTANCES) {
        let panes = [];
        try {
          panes = chart.getIndicators()
            .filter((i) => String(i.name).toUpperCase() === kName)
            .map((i) => i.paneId);
        } catch (e) { /* 목록을 못 읽으면 아래 폴백으로 시도한다 */ }
        // 기록된 pane 과 candle_pane 도 함께 시도한다(목록 조회가 실패한 경우 대비).
        const recorded = this._aiInd.get(kName);
        if (recorded && panes.indexOf(recorded) < 0) panes.push(recorded);
        if (panes.length === 0) panes = ['candle_pane'];
        for (const paneId of panes) {
          try { chart.removeIndicator({ paneId, name: kName }); } catch (e) { /* noop */ }
        }
      }
      this._aiInd.delete(kName);
      // ★ 결과 확인: 어느 차트에도 남아 있지 않을 때만 성공이다.
      let stillThere = false;
      for (const chart of INSTANCES) {
        try {
          if (chart.getIndicators().some((i) => String(i.name).toUpperCase() === kName)) stillThere = true;
        } catch (e) { stillThere = true; /* 확인 불가 → 성공이라고 말하지 않는다 */ }
      }
      // ★ 제거도 지표 변경이다. 게시하지 않으면 AI 가 지운 지표를 계속 안다.
      try { this.publishState(); } catch (e) { /* noop */ }
      setTimeout(() => { try { this.publishState(); } catch (e) { /* noop */ } }, 300);
      return !stillThere;
    },
    /*
       ★★ 커스텀 AI 지표 — 고객이 말로 요청한 지표를 그려준다.

         경로: 코파일럿(또는 사용자)이 후보 수식을 만든다 → 서버 검증
         (POST /api/ai/indicator-formula — 화이트리스트·균형·길이) → 여기서
         클라이언트 DSL(QTFmla)로 **렌더 직전 한 번 더 파싱**(이중 방어) →
         klinecharts 커스텀 지표로 등록해 그린다.

         임의 자바스크립트는 절대 평가하지 않는다 — DSL 표현식만.
         파싱이 실패하면 { applied:false, error } 로 정직하게 말한다. 가짜 선을
         그리지 않는 것은 이 코드베이스의 일관된 규칙이다.
    */
    addCustomIndicator(descriptor) {
      const d = descriptor || {};
      const name = String(d.name || '').trim();
      const expr = String(d.expression || '').trim();
      if (!name || !expr) return { applied: false, error: 'EMPTY' };
      const F = window.QTFmla;
      if (!F) return { applied: false, error: 'DSL_UNAVAILABLE' };
      const pr = F.parse(expr);
      if (!pr.ok) return { applied: false, error: pr.error || 'PARSE_FAILED' };
      const kName = indicatorKey('CUST', name);
      let applied = false;
      for (const chart of INSTANCES) {
        try {
          // 같은 이름이 이미 있으면 먼저 지운다(수식 갱신 = 교체).
          try { chart.removeIndicator({ name: kName }); } catch (e) { /* 없으면 무시 */ }
          window.klinecharts.registerIndicator({
            name: kName,
            shortName: String(d.shortName || name).slice(0, 8),
            calcParams: [],
            figures: [{ key: 'value', title: kName, type: 'line' }],
            /*
               ★★★ **klinecharts 의 calc 서명은 `(dataList, indicator)` 다.**

                 예전 코드는 `(params, bars)` 로 받아 **두 번째 인자를 캔들로** 썼다.
                 두 번째는 지표 객체이므로 `F.compute(expr, indicatorObject)` 가 되어
                 `bars.length` 가 undefined → 빈 배열을 돌려줬다.

                 결과: 커스텀 지표가 등록은 되는데 **한 번도 계산되지 않았다.**
                 실측(2026-09-18): MA·VOL 의 result 는 1000개인데
                 `CUST_*` 는 0개였다. 선이 그려지지 않으므로 AI 가 "지표를 만들었다"
                 고 말해도 화면에는 아무것도 없다. 오류도 나지 않아 조용히 실패했다.

                 번들에서 확인: `this.calc(t, this)` — t 가 dataList 다.
            */
            calc: (dataList) => {
              const bars = Array.isArray(dataList) ? dataList : [];
              const r = F.compute(expr, bars);
              if (!r.ok) return bars.map(() => ({ value: NaN }));
              return r.values.map((v) => ({ value: Number.isFinite(v) ? v : NaN }));
            },
          });
          const separate = d.pane !== 'price';
          const id = chart.createIndicator(separate ? { name: kName } : { name: kName, paneId: 'candle_pane' }, !separate);
          if (id || separate) { this._aiInd.set(kName, separate ? id : 'candle_pane'); applied = true; }
        } catch (e) { /* 이 차트에서 실패 — 다음 차트 시도 */ }
      }
      try { this.publishState(); } catch (e) { /* noop */ }
      setTimeout(() => { try { this.publishState(); } catch (e) { /* noop */ } }, 300);
      return applied ? { applied: true, name: kName } : { applied: false, error: 'CREATE_FAILED' };
    },
    removeCustomIndicator(name) {
      const kName = indicatorKey('CUST', name);
      let removed = false;
      for (const chart of INSTANCES) {
        try {
          chart.removeIndicator({ name: kName });
          removed = true;
        } catch (e) { /* noop */ }
      }
      this._aiInd.delete(kName);
      try { this.publishState(); } catch (e) { /* noop */ }
      return removed;
    },

    /*
       ═══════════════════════════════════════════════════════════════════
       고객이 만든 **신호 규칙**을 캔들 위에 표시한다
       ═══════════════════════════════════════════════════════════════════

       운영 결정(2026-09-18): 매매 신호는 우리가 주는 것이 아니라 **고객이 만든다.**
       고객이 조건을 쓰고(`CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))`),
       여기서 그 조건이 성립한 봉에 표시만 한다. 주문은 발생하지 않는다.

       ★★★ **라벨에 규칙 이름을 반드시 함께 적는다.** 표시만 있고 근거가 없으면
         고객은 그것을 "우리가 사라고 한 것" 으로 읽는다. 무엇이 성립했는지 보이면
         그것은 감지이고, 감지는 예측이 아니다(약관 제4조2호·리스크 제6조).

       ★★★ **오버레이로 만들지 않는다.** 기존 `qtSignalMarker` 오버레이는 마커 하나에
         오버레이 하나다. 규칙 하나가 수십~수백 봉에서 성립하므로 오버레이가 그만큼
         생기고, 동기화 효과(overlays)가 매번 그것을 되쓰게 된다. 그래서 **지표**로
         등록하고 `draw` 훅에서 보이는 구간만 직접 그린다.
         (klinecharts 는 `draw({ctx, chart, indicator, bounding, xAxis, yAxis})` 를
          제공하고, truthy 를 돌려주면 기본 도형 렌더를 건너뛴다 — 번들에서 확인)

       ★★ 방향을 우리가 정하지 않는다. 고객이 규칙에 방향을 붙였으면 그 모양(▲/▼)으로
         그리고, 붙이지 않았으면 **중립 표시(◆)** 로 둔다. 없는 방향을 채워 넣으면
         그 순간 우리가 방향을 발신한 것이 된다.
    */
    /*
       ═══════════════════════════════════════════════════════════════════
       적용된 신호 규칙 장부
       ═══════════════════════════════════════════════════════════════════

       ★★★ **규칙 식을 따로 기억해야 한다.** klinecharts 는 지표 이름과 계산 결과만
         들고 있고, 우리가 넣은 **DSL 식**은 `calc` 클로저 안에만 있다. 즉
         `getIndicators()` 로는 "SIG_MACD_______U9NTX" 라는 키만 알 수 있고 그것으로
         규칙을 복원할 수 없다.

         저장·불러오기가 필요한 이유가 그것이다 — 운영자 요청("AI로 만든 거 저장이랑
         다시 불러오는 것도"). 식을 기억하지 않으면 저장할 것이 없다.

       ★ 키가 아니라 **사람이 지은 이름**을 열쇠로 쓴다. 같은 이름을 다시 추가하면
         덮어쓰는 것이 자연스럽고, 저장본과 대조할 때도 이름으로 맞춘다.
    */
    _signalRules: new Map(),

    /** 지금 차트에 적용된 신호 규칙. 저장·복원이 이것을 쓴다. */
    listSignalRules() {
      return [...this._signalRules.values()].map((r) => ({ ...r }));
    },

    addSignalRule(descriptor) {
      const d = descriptor || {};
      const name = String(d.name || '').trim();
      const expr = String(d.expression || d.rule || '').trim();
      if (!name || !expr) return { applied: false, error: 'EMPTY' };
      const F = window.QTFmla;
      if (!F) return { applied: false, error: 'DSL_UNAVAILABLE' };
      /* ★ 렌더 직전 한 번 더 파싱한다 — 서버 검증과 이중 방어. */
      const pr = F.parse(expr);
      if (!pr.ok) return { applied: false, error: pr.error || 'PARSE_FAILED' };

      const direction = d.direction === 'long' || d.direction === 'short' ? d.direction : null;
      const kName = indicatorKey('SIG', name);
      const label = name.slice(0, 24);
      let applied = false;

      for (const chart of INSTANCES) {
        try {
          try { chart.removeIndicator({ name: kName }); } catch (e) { /* 없으면 무시 */ }
          window.klinecharts.registerIndicator({
            name: kName,
            shortName: label,
            calcParams: [],
            /*
               ★★★ **figures 를 비워 둔다 — 값이 가격축 범위에 들어가면 차트가 망가진다.**

                 처음에는 `figures: [{ key: 'fired', type: 'line' }]` 를 두었다.
                 그러자 klinecharts 가 캔들 패널의 y축 범위를 계산할 때 그 값(0/1)을
                 함께 넣어서 **축이 0~80,000 이 되고 캔들이 위쪽 얇은 띠로 눌렸다**
                 (실측 스크린샷으로 확인). 신호 규칙 하나를 켜면 차트를 못 보게 된다.

               ★ 표시는 `draw` 훅에서 직접 한다. 그래서 figures 가 필요 없다.
                 우리 레전드는 `name`·`shortName`·`result` 로 만들므로 figures 와
                 무관하게 이름이 나온다(실측: 비운 뒤에도 레전드에 그대로 나온다).
            */
            figures: [],
            /* ★ 서명은 `(dataList, indicator)` — 위 addCustomIndicator 주석 참고. */
            calc: (dataList) => {
              const bars = Array.isArray(dataList) ? dataList : [];
              const r = F.compute(expr, bars);
              if (!r.ok) return bars.map(() => ({ fired: NaN }));
              /*
                 ★★ NaN(모름)과 0(성립하지 않음)을 구별해 남긴다. draw 가 그 둘을
                   같게 취급하면 웜업 구간과 "신호 없음" 을 구별할 수 없다.
              */
              return r.values.map((v) => ({ fired: Number.isFinite(v) ? (v > 0.5 ? 1 : 0) : NaN }));
            },
            draw: ({ ctx, chart: ch, indicator, xAxis, yAxis }) => {
              try {
                const result = (indicator && indicator.result) || [];
                const bars = ch.getDataList() || [];
                if (!result.length || !bars.length) return true;
                const colors = readColors();
                const tone = direction === 'long' ? colors.long
                  : direction === 'short' ? colors.short
                    : colors.textPri;
                /*
                   ★ 보이는 구간만 그린다. 1000봉 전체를 그리면 화면 밖까지 계산한다.
                     getVisibleRange 가 없는 배포를 대비해 전체로 떨어뜨린다.
                */
                let from = 0; let to = result.length;
                try {
                  const vr = ch.getVisibleRange && ch.getVisibleRange();
                  if (vr && Number.isFinite(vr.from) && Number.isFinite(vr.to)) {
                    from = Math.max(0, vr.from); to = Math.min(result.length, vr.to + 1);
                  }
                } catch (e) { /* 전체로 그린다 */ }

                ctx.save();
                ctx.font = `500 10px ${colors.fontMono}`;
                ctx.textBaseline = 'middle';
                let drawn = 0;
                for (let i = from; i < to; i++) {
                  if (!result[i] || result[i].fired !== 1) continue;
                  const bar = bars[i];
                  if (!bar) continue;
                  const x = xAxis.convertToPixel(i);
                  /*
                     ★ 표시 높이는 방향에 따라 다르게 둔다. 롱은 저가 아래, 숏은 고가
                       위 — 캔들 몸통을 덮지 않는다. 방향이 없으면 종가 옆에 둔다.
                  */
                  const anchor = direction === 'long' ? Number(bar.low)
                    : direction === 'short' ? Number(bar.high)
                      : Number(bar.close);
                  const y0 = yAxis.convertToPixel(anchor);
                  if (!Number.isFinite(x) || !Number.isFinite(y0)) continue;
                  const y = direction === 'long' ? y0 + 14 : direction === 'short' ? y0 - 14 : y0;

                  ctx.fillStyle = tone;
                  ctx.beginPath();
                  if (direction === 'long') {
                    ctx.moveTo(x, y - 7); ctx.lineTo(x - 5, y + 3); ctx.lineTo(x + 5, y + 3);
                  } else if (direction === 'short') {
                    ctx.moveTo(x, y + 7); ctx.lineTo(x - 5, y - 3); ctx.lineTo(x + 5, y - 3);
                  } else {
                    /* 중립 — 방향을 말하지 않는 표시(◆). */
                    ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y);
                  }
                  ctx.closePath();
                  ctx.fill();
                  drawn += 1;
                }
                /*
                   ★★★ **무엇이 성립했는지 한 번은 적는다.** 마커마다 라벨을 붙이면
                     겹쳐서 못 읽으므로, 보이는 구간에 표시가 있을 때 좌상단에 규칙
                     이름을 한 번 적는다. 근거 없는 표시를 남기지 않는 것이 목적이다.
                */
                if (drawn > 0) {
                  const txt = `${label}${direction ? ` · ${direction}` : ''} — 규칙 성립 ${drawn}`;
                  const w = textWidth(txt, 10, colors.fontMono, '500') + 12;
                  ctx.fillStyle = withAlpha(colors.elevated || colors.panel, 0.92);
                  ctx.fillRect(6, 6, w, 16);
                  ctx.strokeStyle = tone;
                  ctx.lineWidth = 1;
                  ctx.strokeRect(6, 6, w, 16);
                  ctx.fillStyle = colors.textPri;
                  ctx.fillText(txt, 12, 14);
                }
                ctx.restore();
                return true;
              } catch (e) {
                /* 그리기 실패가 차트를 막지 않는다 — 기본 렌더로 떨어진다. */
                return false;
              }
            },
          });
          /* ★ 캔들 패널에 올린다 — 신호는 가격과 같은 자리에서 봐야 뜻이 있다. */
          const id = chart.createIndicator({ name: kName, paneId: 'candle_pane' }, true);
          if (id) { this._aiInd.set(kName, 'candle_pane'); applied = true; }
        } catch (e) { /* 이 차트에서 실패 — 다음 차트 시도 */ }
      }
      /*
         ★ 성공했을 때만 장부에 남긴다. 실패한 것을 남기면 저장·복원이 그리지 못하는
           규칙을 되살리려 하고, 그때마다 조용히 실패한다.
      */
      if (applied) this._signalRules.set(name, { name, expression: expr, direction });
      try { this.publishState(); } catch (e) { /* noop */ }
      setTimeout(() => { try { this.publishState(); } catch (e) { /* noop */ } }, 300);
      return applied ? { applied: true, name: kName } : { applied: false, error: 'CREATE_FAILED' };
    },

    removeSignalRule(name) {
      const kName = indicatorKey('SIG', name);
      let removed = false;
      for (const chart of INSTANCES) {
        try { chart.removeIndicator({ name: kName }); removed = true; } catch (e) { /* noop */ }
      }
      this._aiInd.delete(kName);
      /* ★ 장부에서도 지운다. 남겨 두면 저장본에 없는 규칙이 되살아난다. */
      this._signalRules.delete(String(name || ''));
      try { this.publishState(); } catch (e) { /* noop */ }
      return removed;
    },
    listIndicators() {
      const out = [];
      for (const chart of INSTANCES) {
        try { chart.getIndicators().forEach((i) => out.push({ name: i.name, paneId: i.paneId })); } catch (e) { /* noop */ }
      }
      return out;
    },

    /** 진단: 지표/오버레이/데이터 현황. 콘솔에서 ChartKlineUtil.debug() */
    debug() {
      return [...INSTANCES].map((chart) => {
        let overlays = [];
        let indicators = [];
        try { overlays = chart.getOverlays().map((o) => ({ name: o.name, id: o.id, points: o.points, ext: o.extendData && o.extendData.source })); } catch (e) { /* noop */ }
        /*
           ★★ 계산된 **값**까지 담는다.

             KLineCharts 는 각 지표의 계산 결과를 `result` 배열로 들고 있다
             (RSI 220개, 마지막 항목이 {rsi1, rsi2, rsi3}). 예전에는 이름·설정만
             꺼내서, AI 코파일럿은 "RSI 가 켜져 있다" 는 사실만 알고 값은 몰랐다.

             그래서 AI 가 지표 수치를 말하려면 스스로 추정해야 했고, 그건 출처 없는
             숫자다. 화면이 이미 계산해 둔 값을 그대로 넘기면 **고객이 보는 숫자와
             AI 가 말하는 숫자가 같아진다.** 서버에서 따로 계산하면 미세하게
             달라질 수 있고, 그러면 둘 다 못 믿게 된다.

           ★ 마지막 값만 보낸다. 220개를 전부 보내면 프롬프트가 비대해지고 비용이
             오른다. 지표 해석에 필요한 것은 최신 값과 그 직전 값(방향)이다.

           ★★ 값이 없으면 **필드를 넣지 않는다.** null 이나 0 을 넣으면 모델이 그것을
             값으로 읽는다 — 이 프로젝트가 반복해서 고쳐온 실패 방식이다.
        */
        try {
          indicators = chart.getIndicators().map((i) => {
            const out = { name: i.name, paneId: i.paneId, calcParams: i.calcParams };
            const res = Array.isArray(i.result) ? i.result : null;
            if (res && res.length > 0) {
              const last = res[res.length - 1];
              const prev = res.length > 1 ? res[res.length - 2] : null;
              /*
                 ★ 값은 객체다({rsi1: 7.84, ...}). 키 이름은 지표마다 다르므로
                   그대로 넘긴다 — 우리가 이름을 바꾸면 모델이 무슨 값인지 모른다.
              */
              if (last && typeof last === 'object') {
                out.latest = last;
                if (prev && typeof prev === 'object') out.previous = prev;
                out.samples = res.length;
              }
            }
            return out;
          });
        } catch (e) { /* noop */ }
        let bars = 0;
        try { bars = chart.getDataList().length; } catch (e) { /* noop */ }
        return {
          id: chart.id,
          bars,
          visibleRange: (() => { try { return chart.getVisibleRange(); } catch (e) { return null; } })(),
          indicators,
          overlays,
          registeredOverlayTemplates: [...REGISTERED],
        };
      });
    },
  };

  /**
   * 렌더러 선택자.
   *
   * 기본은 KLineChart. 되돌릴 수 있게 두 가지 탈출구를 둔다:
   *  1) localStorage.setItem('qt.chartEngine', 'canvas') → 자체 엔진
   *  2) klinecharts 로드 실패 → 자동으로 자체 엔진
   *
   * 삭제 대신 전환 가능하게 만든 이유: 나란히 비교해 판단할 수 있어야 하고,
   * 문제가 생겼을 때 되돌리는 비용이 0 이어야 한다.
   */
  window.ChartRenderer = function ChartRenderer() {
    let pref = null;
    try {
      pref = localStorage.getItem('qt.chartEngine');
    } catch (e) { /* 프라이버시 모드 등 */ }

    if (pref === 'canvas' && window.ChartCanvas) return window.ChartCanvas;
    if (window.ChartKline && window.klinecharts) return window.ChartKline;
    return window.ChartCanvas;
  };
})();
