/* ============================================================
   Canvas Chart Engine
   ------------------------------------------------------------
   - Renders candles + volume + MA lines on <canvas>
   - Crosshair with HUD
   - Overlay layer for AI signals: trend lines, entry zone,
     stop loss, take profit, signal markers
   - Overlays are draggable (drag price handles)
   - Domain model shape mirrors what a KLineChart 10.x adapter
     would need — see /design-system for docs
   ============================================================ */

(function () {
  const { useEffect, useRef, useState, useMemo, useCallback } = React;

  // ---- Number format helpers ----
  const fmt2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPrice = (n) => n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                                    : n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  // ---- Read CSS custom properties for colors ----
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
    };
  }

  // ---- Simple SMA ----
  function sma(candles, period) {
    const out = new Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  // ---- Main component ----
  window.ChartCanvas = function ChartCanvas({
    candles,
    timeframe = '15m',
    symbol = 'BTC/USDT',
    overlays = [],           // Overlay[]
    lastPrice,
    onOverlayChange,         // (id, newPoints) => void
    onOverlayHover,          // (overlay) => void
    activeTool = 'cursor',   // 'cursor' | 'trend-line' | 'horizontal' | ...
    showMA = true,
    showVolume = true,
    showLegend = true,
    padding = { top: 20, right: 68, bottom: 44, left: 8 },
    className = '',
  }) {
    const wrapRef = useRef(null);
    const cvsRef = useRef(null);
    const overlayCvsRef = useRef(null);   // separate overlay layer for interactivity redraw
    const [size, setSize] = useState({ w: 800, h: 400 });
    const [view, setView] = useState({ startIdx: 0, endIdx: candles.length - 1 });
    const [cursor, setCursor] = useState(null); // { x, y, price, time, candle }
    const [dragging, setDragging] = useState(null); // { overlayId, pointIdx, side? }
    const [hoverOverlay, setHoverOverlay] = useState(null);
    const [colors, setColors] = useState(readColors);

    // ---- Resize observer ----
    useEffect(() => {
      const el = wrapRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        setSize({ w: r.width, h: r.height });
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // ---- Re-read CSS colors when theme/brand changes ----
    useEffect(() => {
      const obs = new MutationObserver(() => setColors(readColors()));
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-brand', 'data-longshort', 'data-density'] });
      return () => obs.disconnect();
    }, []);

    // ---- Initial view: last 120 candles ----
    useEffect(() => {
      const total = candles.length;
      setView({ startIdx: Math.max(0, total - 120), endIdx: total - 1 });
    }, [candles.length]);

    // ---- Derived: viewport candles + price range ----
    const derived = useMemo(() => {
      const s = Math.max(0, view.startIdx);
      const e = Math.min(candles.length - 1, view.endIdx);
      const slice = candles.slice(s, e + 1);
      if (!slice.length) return null;
      let hi = -Infinity, lo = Infinity;
      let volMax = 0;
      for (const c of slice) {
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
        if (c.volume > volMax) volMax = c.volume;
      }
      /*
         오버레이를 Y축 범위에 넣는다 — 다만 **한계를 둔다**.

         ★★ 왜 한계가 필요한가

           전에는 오버레이 가격을 무조건 포함시켰다("선이 잘리지 않게").
           그 결과 진입가가 현재가와 멀면 **캔들이 화면 한쪽에 납작하게 눌려
           차트를 읽을 수 없었다.** 실제로 재현했다: 현재가 64,892 · 진입가
           62,404 → Y범위가 2.5배로 늘어나 캔들 움직임이 한 줄로 보였다.

           차트의 목적은 가격 움직임을 읽는 것이다. 선 하나를 다 보여주려고
           그 목적을 잃으면 안 된다.

         ★ 그래서 캔들 범위의 일정 배수까지만 늘린다. 그보다 먼 오버레이는
           범위에 넣지 않고 화면 가장자리에 붙여 그린다(아래 clampY).
           실제 트레이딩 앱들이 쓰는 방식이다 — 멀리 있는 주문은 가장자리에
           표시하고 축을 늘리지 않는다.
      */
      const candleRange = hi - lo || 1;
      // 캔들 범위의 60% 까지만 추가로 늘린다. 이 값을 넘는 오버레이는 가장자리 표시.
      const OVERLAY_RANGE_LIMIT = 0.6;
      const maxHi = hi + candleRange * OVERLAY_RANGE_LIMIT;
      const minLo = lo - candleRange * OVERLAY_RANGE_LIMIT;

      for (const ov of overlays) {
        for (const p of (ov.points || [])) {
          if (typeof p.price !== 'number' || !Number.isFinite(p.price)) continue;
          if (p.price > hi && p.price <= maxHi) hi = p.price;
          if (p.price < lo && p.price >= minLo) lo = p.price;
        }
        if (typeof ov.priceHi === 'number' && ov.priceHi > hi && ov.priceHi <= maxHi) hi = ov.priceHi;
        if (typeof ov.priceLo === 'number' && ov.priceLo < lo && ov.priceLo >= minLo) lo = ov.priceLo;
      }
      const pad = (hi - lo) * 0.08;
      hi += pad; lo -= pad;
      return { s, e, slice, hi, lo, volMax };
    }, [candles, view, overlays]);

    // ---- Scales ----
    const scales = useMemo(() => {
      if (!derived) return null;
      const plotX = padding.left;
      const plotW = Math.max(50, size.w - padding.left - padding.right);
      const volH = showVolume ? Math.max(40, size.h * 0.16) : 0;
      const plotY = padding.top;
      const plotH = Math.max(80, size.h - padding.top - padding.bottom - volH);
      const volY = plotY + plotH + 6;
      const barSlot = plotW / derived.slice.length;
      const candleW = Math.max(1, Math.min(14, barSlot * 0.7));
      const xForIndex = (i) => plotX + (i + 0.5) * barSlot;
      const yForPrice = (p) => plotY + (derived.hi - p) / (derived.hi - derived.lo) * plotH;
      const priceForY = (y) => derived.hi - (y - plotY) / plotH * (derived.hi - derived.lo);
      const yForVol = (v) => volY + volH - (v / derived.volMax) * volH;
      const indexForX = (x) => Math.floor((x - plotX) / barSlot);
      return { plotX, plotW, plotY, plotH, volY, volH, barSlot, candleW, xForIndex, yForPrice, priceForY, yForVol, indexForX };
    }, [derived, size, padding, showVolume]);

    // ---- Setup canvas DPR ----
    const setupCanvas = useCallback((cvs) => {
      const dpr = window.devicePixelRatio || 1;
      cvs.width = size.w * dpr;
      cvs.height = size.h * dpr;
      const ctx = cvs.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }, [size]);

    // ---- Draw main chart ----
    useEffect(() => {
      const cvs = cvsRef.current;
      if (!cvs || !derived || !scales) return;
      const ctx = setupCanvas(cvs);
      ctx.clearRect(0, 0, size.w, size.h);

      // Grid
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = colors.axisText;

      // Horizontal grid + price labels (5 divisions)
      const priceSteps = 5;
      for (let i = 0; i <= priceSteps; i++) {
        const y = scales.plotY + (scales.plotH * i) / priceSteps;
        ctx.beginPath();
        ctx.moveTo(scales.plotX, y);
        ctx.lineTo(scales.plotX + scales.plotW, y);
        ctx.stroke();
        const price = derived.hi - (derived.hi - derived.lo) * (i / priceSteps);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = colors.axisText;
        ctx.fillText(fmtPrice(price), scales.plotX + scales.plotW + 6, y);
      }

      // Vertical time grid + labels (roughly every 40px)
      const times = derived.slice;
      const stepIdx = Math.max(1, Math.floor(times.length / Math.max(3, Math.floor(scales.plotW / 80))));
      for (let i = 0; i < times.length; i += stepIdx) {
        const x = scales.xForIndex(i);
        ctx.beginPath();
        ctx.moveTo(x, scales.plotY);
        ctx.lineTo(x, scales.plotY + scales.plotH);
        ctx.strokeStyle = colors.grid;
        ctx.stroke();
        const d = new Date(times[i].time);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const label = (timeframe === '1D' || timeframe === '4H')
          ? `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`
          : `${hh}:${mm}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = colors.axisText;
        ctx.fillText(label, x, scales.plotY + scales.plotH + scales.volH + 10);
      }

      // Volume bars
      if (showVolume) {
        for (let i = 0; i < derived.slice.length; i++) {
          const c = derived.slice[i];
          const x = scales.xForIndex(i);
          const isUp = c.close >= c.open;
          ctx.fillStyle = isUp ? colors.volUp : colors.volDn;
          const y = scales.yForVol(c.volume);
          const h = scales.volY + scales.volH - y;
          ctx.fillRect(x - scales.candleW / 2, y, scales.candleW, h);
        }
      }

      // Candles
      for (let i = 0; i < derived.slice.length; i++) {
        const c = derived.slice[i];
        const x = scales.xForIndex(i);
        const isUp = c.close >= c.open;
        const color = isUp ? colors.up : colors.dn;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        // Wick
        ctx.beginPath();
        ctx.moveTo(x, scales.yForPrice(c.high));
        ctx.lineTo(x, scales.yForPrice(c.low));
        ctx.stroke();
        // Body
        const openY = scales.yForPrice(c.open);
        const closeY = scales.yForPrice(c.close);
        const top = Math.min(openY, closeY);
        const h = Math.max(1, Math.abs(closeY - openY));
        ctx.fillRect(x - scales.candleW / 2, top, scales.candleW, h);
      }

      // MAs
      if (showMA) {
        const drawMA = (arr, color) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < derived.slice.length; i++) {
            const globalIdx = derived.s + i;
            const v = arr[globalIdx];
            if (v == null) continue;
            const x = scales.xForIndex(i);
            const y = scales.yForPrice(v);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };
        drawMA(sma(candles, 20), colors.ma1);
        drawMA(sma(candles, 60), colors.ma2);
        drawMA(sma(candles, 120), colors.ma3);
      }

      // Last-price ribbon on right axis
      if (lastPrice != null && lastPrice >= derived.lo && lastPrice <= derived.hi) {
        const y = scales.yForPrice(lastPrice);
        const lastCandle = derived.slice[derived.slice.length - 1];
        const isUp = lastCandle.close >= lastCandle.open;
        ctx.strokeStyle = isUp ? colors.up : colors.dn;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(scales.plotX, y);
        ctx.lineTo(scales.plotX + scales.plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label pill
        const label = fmtPrice(lastPrice);
        ctx.font = '600 11px "IBM Plex Mono", monospace';
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = isUp ? colors.up : colors.dn;
        ctx.fillRect(scales.plotX + scales.plotW + 4, y - 8, w, 16);
        ctx.fillStyle = '#0A0E14';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, scales.plotX + scales.plotW + 4 + w / 2, y);
      }

    }, [derived, scales, size, colors, candles, showMA, showVolume, timeframe, lastPrice, setupCanvas]);

    // ---- Draw overlay layer (signals + crosshair) ----
    useEffect(() => {
      const cvs = overlayCvsRef.current;
      if (!cvs || !derived || !scales) return;
      const ctx = setupCanvas(cvs);
      ctx.clearRect(0, 0, size.w, size.h);

      const timeToIndex = (t) => {
        // find nearest candle idx in slice
        const step = candles[1] ? candles[1].time - candles[0].time : 60000;
        const start = derived.slice[0].time;
        const i = Math.round((t - start) / step);
        return Math.max(0, Math.min(derived.slice.length - 1, i));
      };
      const xForTime = (t) => scales.xForIndex(timeToIndex(t));

      // Draw each overlay
      for (const ov of overlays) {
        if (ov.hidden) continue;
        const src = ov.source || 'user';
        let color = colors.ai;
        if (src === 'ai-approved') color = colors.approved;
        else if (src === 'ai-draft') color = colors.ai;
        else if (src === 'order') color = colors.pending;
        else if (src === 'position-long') color = colors.long;
        else if (src === 'position-short') color = colors.short;
        else if (src === 'user') color = getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary').trim();

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = ov.width || 1.5;
        ctx.setLineDash(ov.style?.dashed || src === 'ai-draft' ? [5, 4] : []);

        if (ov.type === 'trend-line' && ov.points?.length === 2) {
          const [p1, p2] = ov.points;
          const x1 = xForTime(p1.time), y1 = scales.yForPrice(p1.price);
          const x2 = xForTime(p2.time), y2 = scales.yForPrice(p2.price);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          // Extend right side subtly (projection)
          if (x2 < scales.plotX + scales.plotW) {
            const slope = (y2 - y1) / (x2 - x1);
            const yEnd = y2 + slope * (scales.plotX + scales.plotW - x2);
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(scales.plotX + scales.plotW, yEnd);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          // Handles
          drawHandle(ctx, x1, y1, color);
          drawHandle(ctx, x2, y2, color);
          // Label pill
          if (ov.label) drawTag(ctx, ov.label, x1 + 6, y1 - 14, colors, color, ov.source);
        }
        else if (ov.type === 'horizontal' && ov.points?.[0]) {
          /*
             수평선 (주문·포지션 진입가).

             ★ 가격이 현재 Y축 범위를 벗어날 수 있다. Y축을 무한정 늘리지 않기로
               했으므로(위 derived 주석 참고), 벗어난 선은 **화면 가장자리에
               붙여** 그린다.

             ★ 가장자리에 붙일 때는 점선으로 바꿔 "실제 위치는 화면 밖" 임을
               알린다. 실선으로 두면 그 가격이 화면 안에 있다고 오해한다 —
               진입가를 잘못 읽으면 손익 판단이 어긋난다.
          */
          const rawY = scales.yForPrice(ov.points[0].price);
          const top = scales.plotY;
          const bottom = scales.plotY + scales.plotH;
          const outside = rawY < top || rawY > bottom;
          const y = Math.max(top, Math.min(bottom, rawY));

          const prevDash = ctx.getLineDash();
          if (outside) ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(scales.plotX, y);
          ctx.lineTo(scales.plotX + scales.plotW, y);
          ctx.stroke();
          ctx.setLineDash(prevDash);

          // 화면 밖 선은 끌어서 옮길 수 없다 — 손잡이를 그리지 않는다.
          if (!outside) drawHandle(ctx, scales.plotX + scales.plotW - 24, y, color);
          drawPriceLabel(ctx, ov.points[0].price, y, scales, color);
          if (ov.label) {
            // 위쪽 밖이면 라벨이 잘리므로 선 아래에 붙인다.
            const labelY = rawY < top ? y + 4 : y - 14;
            drawTag(ctx, ov.label, scales.plotX + 8, labelY, colors, color, ov.source);
          }
        }
        else if (ov.type === 'entry-zone' && ov.priceHi != null && ov.priceLo != null) {
          const yHi = scales.yForPrice(ov.priceHi);
          const yLo = scales.yForPrice(ov.priceLo);
          ctx.setLineDash([]);
          ctx.fillStyle = withAlpha(color, 0.14);
          ctx.fillRect(scales.plotX, Math.min(yHi, yLo), scales.plotW, Math.abs(yLo - yHi));
          ctx.strokeStyle = color;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(scales.plotX, yHi); ctx.lineTo(scales.plotX + scales.plotW, yHi); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(scales.plotX, yLo); ctx.lineTo(scales.plotX + scales.plotW, yLo); ctx.stroke();
          drawPriceLabel(ctx, ov.priceHi, yHi, scales, color);
          drawPriceLabel(ctx, ov.priceLo, yLo, scales, color);
          if (ov.label) drawTag(ctx, ov.label, scales.plotX + 8, (yHi + yLo) / 2 - 8, colors, color, ov.source);
          // handle in the middle right
          drawHandle(ctx, scales.plotX + scales.plotW - 8, yHi, color);
          drawHandle(ctx, scales.plotX + scales.plotW - 8, yLo, color);
        }
        else if (ov.type === 'signal-marker' && ov.points?.[0]) {
          const p = ov.points[0];
          const x = xForTime(p.time);
          const y = scales.yForPrice(p.price);
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.beginPath();
          if (ov.direction === 'long') {
            ctx.moveTo(x, y + 10);
            ctx.lineTo(x - 6, y + 20);
            ctx.lineTo(x + 6, y + 20);
            ctx.closePath();
          } else {
            ctx.moveTo(x, y - 10);
            ctx.lineTo(x - 6, y - 20);
            ctx.lineTo(x + 6, y - 20);
            ctx.closePath();
          }
          ctx.fill();
        }
      }
      ctx.setLineDash([]);

      // Crosshair
      if (cursor) {
        ctx.strokeStyle = colors.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cursor.x, scales.plotY);
        ctx.lineTo(cursor.x, scales.plotY + scales.plotH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(scales.plotX, cursor.y);
        ctx.lineTo(scales.plotX + scales.plotW, cursor.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Price label
        drawPriceLabel(ctx, cursor.price, cursor.y, scales, colors.textPri, true);
      }
    }, [overlays, cursor, scales, derived, colors, size, setupCanvas, candles]);

    function drawHandle(ctx, x, y, color) {
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#0A0E14';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    function drawPriceLabel(ctx, price, y, scales, color, isCursor = false) {
      ctx.setLineDash([]);
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      const label = fmtPrice(price);
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = isCursor ? color : color;
      ctx.fillRect(scales.plotX + scales.plotW + 4, y - 8, w, 16);
      ctx.fillStyle = isCursor ? '#0A0E14' : '#0A0E14';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, scales.plotX + scales.plotW + 4 + w / 2, y);
    }
    function drawTag(ctx, text, x, y, colors, color, source) {
      ctx.setLineDash([]);
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      const pad = 4;
      const w = ctx.measureText(text).width + pad * 2;
      ctx.fillStyle = colors.elevated;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const h = 14;
      ctx.beginPath();
      const r = 3;
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.textPri;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + pad, y + h / 2);
    }

    function withAlpha(oklchStr, alpha) {
      // oklch() supports alpha via slash
      if (oklchStr.includes('oklch(')) {
        if (oklchStr.includes('/')) return oklchStr.replace(/\/ [\d.]+\)$/, `/ ${alpha})`);
        return oklchStr.replace(')', ` / ${alpha})`);
      }
      return oklchStr;
    }

    // ---- Hit-testing for overlay handles ----
    function hitTest(mx, my) {
      if (!scales || !derived) return null;
      const xForTime = (t) => {
        const step = candles[1] ? candles[1].time - candles[0].time : 60000;
        const start = derived.slice[0].time;
        const i = Math.round((t - start) / step);
        return scales.xForIndex(Math.max(0, Math.min(derived.slice.length - 1, i)));
      };
      for (let oi = overlays.length - 1; oi >= 0; oi--) {
        const ov = overlays[oi];
        if (ov.hidden || ov.locked) continue;
        if ((ov.type === 'trend-line') && ov.points?.length === 2) {
          for (let pi = 0; pi < 2; pi++) {
            const p = ov.points[pi];
            const x = xForTime(p.time), y = scales.yForPrice(p.price);
            if (Math.hypot(mx - x, my - y) < 8) return { overlayId: ov.id, pointIdx: pi };
          }
          // line body — allow drag whole line
          const [p1, p2] = ov.points;
          const x1 = xForTime(p1.time), y1 = scales.yForPrice(p1.price);
          const x2 = xForTime(p2.time), y2 = scales.yForPrice(p2.price);
          const d = distToLine(mx, my, x1, y1, x2, y2);
          if (d < 5 && mx >= Math.min(x1, x2) - 4 && mx <= Math.max(x1, x2) + 4) {
            return { overlayId: ov.id, pointIdx: -1 }; // body drag
          }
        }
        if (ov.type === 'horizontal' && ov.points?.[0]) {
          const y = scales.yForPrice(ov.points[0].price);
          if (Math.abs(my - y) < 6) return { overlayId: ov.id, pointIdx: 0 };
        }
        if (ov.type === 'entry-zone' && ov.priceHi != null && ov.priceLo != null) {
          const yHi = scales.yForPrice(ov.priceHi);
          const yLo = scales.yForPrice(ov.priceLo);
          if (Math.abs(my - yHi) < 6) return { overlayId: ov.id, side: 'hi' };
          if (Math.abs(my - yLo) < 6) return { overlayId: ov.id, side: 'lo' };
        }
      }
      return null;
    }
    function distToLine(px, py, x1, y1, x2, y2) {
      const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, dot / lenSq));
      const xx = x1 + t * C, yy = y1 + t * D;
      return Math.hypot(px - xx, py - yy);
    }

    // ---- Mouse handlers ----
    const onMouseMove = useCallback((e) => {
      if (!scales) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (mx < scales.plotX || mx > scales.plotX + scales.plotW || my < scales.plotY || my > scales.plotY + scales.plotH) {
        setCursor(null);
      } else {
        const idx = scales.indexForX(mx);
        const c = derived.slice[Math.max(0, Math.min(derived.slice.length - 1, idx))];
        setCursor({ x: mx, y: my, price: scales.priceForY(my), time: c?.time, candle: c });
      }

      // Dragging
      if (dragging) {
        const price = scales.priceForY(my);
        const time = (() => {
          const idx = scales.indexForX(mx);
          const c = derived.slice[Math.max(0, Math.min(derived.slice.length - 1, idx))];
          return c ? c.time : null;
        })();
        if (onOverlayChange) {
          const ov = overlays.find(o => o.id === dragging.overlayId);
          if (!ov) return;
          const updated = JSON.parse(JSON.stringify(ov));
          if (ov.type === 'entry-zone') {
            if (dragging.side === 'hi') updated.priceHi = price;
            if (dragging.side === 'lo') updated.priceLo = price;
          } else if (ov.type === 'horizontal') {
            updated.points[0].price = price;
          } else if (ov.type === 'trend-line') {
            if (dragging.pointIdx === -1) {
              // body drag — move both by delta
              const dy = my - dragging.lastY;
              const p1y = scales.yForPrice(ov.points[0].price) + dy;
              const p2y = scales.yForPrice(ov.points[1].price) + dy;
              updated.points[0].price = scales.priceForY(p1y);
              updated.points[1].price = scales.priceForY(p2y);
              dragging.lastY = my;
            } else {
              updated.points[dragging.pointIdx] = { price, time: time || updated.points[dragging.pointIdx].time };
            }
          }
          onOverlayChange(dragging.overlayId, updated);
        }
      } else {
        // Hover — hit test to change cursor
        const hit = hitTest(mx, my);
        setHoverOverlay(hit ? overlays.find(o => o.id === hit.overlayId) : null);
      }
    }, [scales, derived, dragging, overlays, onOverlayChange]);

    const onMouseDown = useCallback((e) => {
      if (!scales) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = hitTest(mx, my);
      if (hit) {
        setDragging({ ...hit, lastY: my });
        e.preventDefault();
      }
    }, [scales, overlays]);

    const onMouseUp = useCallback(() => setDragging(null), []);
    const onMouseLeave = useCallback(() => { setCursor(null); setDragging(null); }, []);

    // ---- Wheel: horizontal zoom around cursor ----
    const onWheel = useCallback((e) => {
      if (!derived) return;
      e.preventDefault();
      const totalLen = derived.e - derived.s + 1;
      const rect = wrapRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const focusIdx = scales ? scales.indexForX(mx) : Math.floor(totalLen / 2);
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      const newLen = Math.max(30, Math.min(candles.length, Math.round(totalLen * factor)));
      // keep focus stable relative to center
      const focusFrac = totalLen === 0 ? 0.5 : focusIdx / totalLen;
      let newStart = Math.round((derived.s + focusIdx) - newLen * focusFrac);
      newStart = Math.max(0, Math.min(candles.length - newLen, newStart));
      const newEnd = newStart + newLen - 1;
      setView({ startIdx: newStart, endIdx: newEnd });
    }, [derived, scales, candles.length]);

    // ---- Pan on middle drag or shift+drag ----
    const [panning, setPanning] = useState(null);
    const onWrapMouseDown = useCallback((e) => {
      if (e.button === 1 || e.shiftKey) {
        setPanning({ x: e.clientX, startIdx: view.startIdx, endIdx: view.endIdx });
        e.preventDefault();
      } else {
        onMouseDown(e);
      }
    }, [view, onMouseDown]);
    const onWrapMouseMove = useCallback((e) => {
      if (panning && scales) {
        const dx = e.clientX - panning.x;
        const perBar = scales.barSlot;
        const shift = Math.round(-dx / perBar);
        const len = panning.endIdx - panning.startIdx + 1;
        let s = Math.max(0, Math.min(candles.length - len, panning.startIdx + shift));
        setView({ startIdx: s, endIdx: s + len - 1 });
      } else {
        onMouseMove(e);
      }
    }, [panning, scales, onMouseMove, candles.length]);
    const onWrapMouseUp = useCallback(() => {
      setPanning(null);
      onMouseUp();
    }, [onMouseUp]);

    // ---- HUD data ----
    const hudCandle = cursor?.candle || (derived ? derived.slice[derived.slice.length - 1] : null);

    return (
      <div
        ref={wrapRef}
        className={`chart-canvas-wrap ${className}`}
        onMouseMove={onWrapMouseMove}
        onMouseDown={onWrapMouseDown}
        onMouseUp={onWrapMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        style={{ cursor: dragging ? 'grabbing' : (hoverOverlay ? 'grab' : 'crosshair') }}
      >
        <canvas ref={cvsRef} />
        <canvas ref={overlayCvsRef} />

        {/* HUD */}
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

  window.ChartCanvasUtil = {
    fmtPrice, fmt2,
  };
})();
