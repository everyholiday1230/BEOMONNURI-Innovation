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
      case 'position-long': return colors.long;
      case 'position-short': return colors.short;
      /*
         작성 중인 TP/SL 선. 익절=이익색, 손절=손실색이다 — 진입 방향이 아니라
         **결과**를 나타내는 색이어야 한다. 아직 거래소에 나가지 않았으므로
         점선으로 그린다(오버레이 style.dashed).
      */
      case 'draft-tp': return colors.long;
      case 'draft-sl': return colors.short;
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

  /** 공통: extendData 에서 렌더 정보를 뽑는다. */
  function renderInfo(overlay) {
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
    const label = LV
      ? LV.labelFor({ label: ext.label, live: ext.live, symbol: ext.symbol })
      : ext.label;
    return { ext, colors, src, color, dashed, label, width: ext.width || 1.5 };
  }

  /** 태그(라벨 알약). ChartCanvas drawTag 의 시각을 재현한다. */
  function tagFigures(text, x, y, color, colors) {
    if (!text) return [];
    const paddingX = 6;
    const approxW = String(text).length * 5.6 + paddingX * 2;
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
        attrs: { x: x + paddingX, y: y - 1, text: String(text), align: 'left', baseline: 'middle' },
        styles: { color, size: 10, family: colors.fontMono, weight: '500' },
        ignoreEvent: true,
      },
    ];
  }

  /** 가격 라벨 (오른쪽 축 위 알약). ChartCanvas drawPriceLabel 재현. */
  function priceLabelFigures(price, y, bounding, color, decimals, colors) {
    const text = Number(price).toFixed(decimals);
    const w = text.length * 6 + 10;
    return [
      {
        type: 'rect',
        attrs: { x: bounding.width - w - 2, y: y - 8, width: w, height: 16 },
        styles: { style: 'fill', color, borderRadius: 2 },
        ignoreEvent: true,
      },
      {
        type: 'text',
        attrs: { x: bounding.width - w / 2 - 2, y, text, align: 'center', baseline: 'middle' },
        styles: { color: colors.textInverse, size: 10, family: colors.fontMono, weight: '600' },
        ignoreEvent: true,
      },
    ];
  }

  function registerAllOverlays() {
    // --- 1. 수평선 (주문/포지션/손절/익절) ---
    ensureOverlayRegistered('qtHorizontal', {
      name: 'qtHorizontal',
      totalStep: 2,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ overlay, coordinates, bounding }) => {
        const c = coordinates[0];
        if (!c) return [];
        const { color, dashed, label, colors, ext } = renderInfo(overlay);
        const decimals = ext.decimals ?? 2;
        const price = overlay.points?.[0]?.value;
        return [
          {
            type: 'line',
            attrs: { coordinates: [{ x: 0, y: c.y }, { x: bounding.width, y: c.y }] },
            styles: { color, size: 1.5, style: dashed ? 'dashed' : 'solid', dashedValue: [5, 4] },
          },
          ...(price != null ? priceLabelFigures(price, c.y, bounding, color, decimals, colors) : []),
          ...tagFigures(label, 8, c.y - 14, color, colors),
        ];
      },
    });

    // --- 2. 추세선 (2점 + 우측 투영) ---
    ensureOverlayRegistered('qtTrendLine', {
      name: 'qtTrendLine',
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ overlay, coordinates, bounding }) => {
        if (coordinates.length < 2) return [];
        const [p1, p2] = coordinates;
        const { color, dashed, label, colors } = renderInfo(overlay);
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
      needDefaultYAxisFigure: true,
      createPointFigures: ({ overlay, coordinates, bounding }) => {
        if (coordinates.length < 2) return [];
        const yHi = Math.min(coordinates[0].y, coordinates[1].y);
        const yLo = Math.max(coordinates[0].y, coordinates[1].y);
        const { color, label, colors, ext } = renderInfo(overlay);
        const decimals = ext.decimals ?? 2;
        const priceHi = Math.max(overlay.points[0].value, overlay.points[1].value);
        const priceLo = Math.min(overlay.points[0].value, overlay.points[1].value);
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
          ...priceLabelFigures(priceHi, yHi, bounding, color, decimals, colors),
          ...priceLabelFigures(priceLo, yLo, bounding, color, decimals, colors),
          ...tagFigures(label, 8, (yHi + yLo) / 2 - 8, color, colors),
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
        needDefaultYAxisFigure: true,
        createPointFigures: ({ overlay, coordinates, bounding }) => {
          if (coordinates.length < 2) return [];
          const { colors, ext } = renderInfo(overlay);
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
              figures.push(...tagFigures(`${tag} ${shown}`, x0 + 6, y - 8, color, colors));
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
        point: {
          color: colors.ai,
          borderColor: withAlpha(colors.ai, 0.35),
          borderSize: 1,
          radius: 4,
          activeColor: colors.ai,
          activeBorderColor: withAlpha(colors.ai, 0.5),
          activeBorderSize: 2,
          activeRadius: 5,
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
    _activeTool = 'cursor',
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
    const [appLang, setAppLang] = useState(currentAppLang);

    const decimals = useMemo(
      () => priceDecimalsFor(symbol, candles?.[candles.length - 1]?.close),
      [symbol, candles],
    );

    // --- 테마/브랜드 변경 시 색상 재적용 (ChartCanvas 와 동일 동작) ---
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

          loadingOlderRef.current = true;
          LM.loadOlderCandles(symbolRef.current, timeframeRef.current, first.time, 300)
            .then((older) => {
              loadingOlderRef.current = false;
              const rows = Array.isArray(older) ? older : [];
              if (!rows.length) {
                // 거래소에 더 과거가 없다 — 이후로는 요청하지 않게 한다.
                noMoreOlderRef.current = true;
                callback([], { forward: false, backward: false });
                return;
              }
              // 우리 데이터 앞에 붙인다(중복 방지: 현재 첫 캔들보다 과거만).
              const head = rows.filter((c) => c && c.time < first.time);
              if (head.length) dataRef.current = head.concat(dataRef.current);
              callback(head.slice(), { forward: false, backward: head.length > 0 });
            })
            .catch(() => {
              loadingOlderRef.current = false;
              // 실패를 '더 없음' 으로 굳히지 않는다 — 일시적 오류일 수 있다.
              callback([], { forward: false, backward: true });
            });
        },
      });

      chart.setSymbol({ ticker: symbol, pricePrecision: decimals, volumePrecision: 3 });
      chart.setPeriod(periodFor(timeframe));

      const onCrosshair = (data) => {
        // data.dataIndex 가 있으면 그 캔들, 없으면(차트 밖) null 로 최신 캔들 표시
        const idx = data && typeof data.dataIndex === 'number' ? data.dataIndex : null;
        setHoverCandle(idx !== null && dataRef.current[idx] ? dataRef.current[idx] : null);
      };
      chart.subscribeAction('onCrosshairChange', onCrosshair);

      return () => {
        try {
          chart.unsubscribeAction('onCrosshairChange', onCrosshair);
        } catch (e) { /* noop */ }
        INSTANCES.delete(chart);
        if (onChartReady) onChartReady(null);
        try {
          KL.dispose(host);
        } catch (e) { /* noop */ }
        chartRef.current = null;
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

      chart.resetData();

      if (anchorTs != null) {
        try { chart.scrollToTimestamp(anchorTs, 0); } catch (e) { /* 복원 실패는 무시 */ }
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
      chart.setSymbol({ ticker: symbol, pricePrecision: decimals, volumePrecision: 3 });
      chart.setPeriod(periodFor(timeframe));
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
      } else if (volPaneRef.current !== null) {
        chart.removeIndicator({ paneId: volPaneRef.current, name: 'VOL' });
        volPaneRef.current = null;
      }
    }, [showVolume]);

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

        {/* HUD — ChartCanvas 와 동일한 마크업/클래스 */}
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

        {showLegend && showMA && (
          <div className="chart-legend">
            <div className="chart-legend__item"><span className="chart-legend__swatch" style={{background:'var(--chart-ma-1)'}}/>MA20</div>
            <div className="chart-legend__item"><span className="chart-legend__swatch" style={{background:'var(--chart-ma-2)'}}/>MA60</div>
            <div className="chart-legend__item"><span className="chart-legend__swatch" style={{background:'var(--chart-ma-3)'}}/>MA120</div>
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
    addIndicator(name, params) {
      const raw = String(name || '').toUpperCase();
      const kName = (this._aiAlias && this._aiAlias[raw]) || raw;
      const calcParams = Array.isArray(params) ? params.filter((n) => Number.isFinite(n) && n > 0) : undefined;
      let applied = false;
      for (const chart of INSTANCES) {
        try {
          const onPrice = this._aiOverlayInds.has(kName);
          const create = onPrice
            ? { name: kName, paneId: 'candle_pane', ...(calcParams ? { calcParams } : {}) }
            : { name: kName, ...(calcParams ? { calcParams } : {}) };
          const id = chart.createIndicator(create, onPrice);
          if (id) { this._aiInd.set(kName, onPrice ? 'candle_pane' : id); applied = true; }
        } catch (e) { /* 지원하지 않는 지표 이름 등 — applied 는 false 로 남는다 */ }
      }
      return applied;
    },
    removeIndicator(name) {
      const raw = String(name || '').toUpperCase();
      const kName = (this._aiAlias && this._aiAlias[raw]) || raw;
      const paneId = this._aiInd.get(kName);
      let removed = false;
      for (const chart of INSTANCES) {
        try { chart.removeIndicator({ paneId: paneId || 'candle_pane', name: kName }); removed = true; } catch (e) { /* noop */ }
      }
      this._aiInd.delete(kName);
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
        try { indicators = chart.getIndicators().map((i) => ({ name: i.name, paneId: i.paneId, calcParams: i.calcParams })); } catch (e) { /* noop */ }
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
