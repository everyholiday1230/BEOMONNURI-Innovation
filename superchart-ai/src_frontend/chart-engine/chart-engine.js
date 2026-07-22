import { DataBuffer as k } from "/static/chart-engine/data-buffer.js";
function C(y) {
  let e;
  return y >= 1e4
    ? y.toLocaleString(void 0, { maximumFractionDigits: 0 })
    : (y >= 100
        ? (e = y.toFixed(2))
        : y >= 1
          ? (e = y.toFixed(4))
          : y < 1e-4
            ? (e = y.toFixed(8))
            : y < 0.01
              ? (e = y.toFixed(6))
              : (e = y.toFixed(4)),
      e.replace(/0+$/, "").replace(/\.$/, ""));
}
import {
  TimeScale as L,
  PriceScale as M,
} from "/static/chart-engine/scales.js";
import {
  CandleRenderer as R,
  VolumeRenderer as B,
  LineRenderer as D,
  GridRenderer as P,
} from "/static/chart-engine/renderers.js";
import { OverlayEngine as I } from "/static/chart-engine/overlay-engine.js";
export class ChartCore {
  constructor(e) {
    ((this.container = e),
      (this.width = e.clientWidth || 800),
      (this.height = e.clientHeight || 500),
      (this.mainCanvas = this._createCanvas("main")),
      (this.overlayCanvas = this._createCanvas("overlay")),
      e.appendChild(this.mainCanvas),
      e.appendChild(this.overlayCanvas),
      (this.mainCtx = this.mainCanvas.getContext("2d")),
      (this.overlayCtx = this.overlayCanvas.getContext("2d")),
      (this.buffer = new k()),
      (this.timeScale = new L()),
      (this.timeScale.width = this.width - 90),
      (this.priceScale = new M()),
      (this.priceScale.height = this.height * 0.78),
      (this.grid = new P(this.mainCtx, this.width, this.height)),
      (this.candleRenderer = new R(
        this.mainCtx,
        this.timeScale,
        this.priceScale,
      )),
      (this.volumeRenderer = new B(
        this.mainCtx,
        this.timeScale,
        this.height * 0.15,
        this.height * 0.83,
      )),
      (this.overlay = new I(this.overlayCtx, this.timeScale, this.priceScale)),
      (this.overlay._chart = this),
      (this.lineRenderer = new D(
        this.mainCtx,
        this.timeScale,
        this.priceScale,
      )),
      (this.indicators = {}),
      (this.subCharts = {}),
      (this._dirty = !0),
      (this._dragging = !1),
      (this._lastX = 0),
      (this._selectedDrawing = null),
      (this._preview = null),
      (this._nextDrawingId = 1),
      (this._uc = null),
      (this._priceScaleLocked = !1),
      (this._magnet = !1),
      this._recalcLayout(),
      this._setupInteractions(),
      this._setupResize(),
      this._startRenderLoop());
  }
  loadBars(e) {
    ((this.indicators = {}),
      (this.subCharts = {}),
      (this._uc = null),
      (this._bc = null),
      (this._uf = null),
      (this._vpData = null),
      (this._ichiCloud = null),
      this.buffer.loadBulk(e),
      (this.timeScale._dataLength = this.buffer.length),
      this.timeScale.fitContent(this.buffer.length),
      (this.priceScale.min = 0),
      (this.priceScale.max = 0),
      this._updatePriceRange(),
      this._recalcLayout(),
      (this._dirty = !0));
  }
  updateBar(e, i, t, r, h) {
    this._replayBackup ||
      (this.buffer.updateLast(e, i, t, r, h), (this._dirty = !0));
  }
  appendBar(e, i, t, r, h, l) {
    if (!this._replayBackup) {
      if (this.buffer.length > 0 && Number.isFinite(e)) {
        const s = this.buffer.time[this.buffer.length - 1];
        if (e === s) {
          (this.buffer.updateLast(i, t, r, h, l),
            this._updatePriceRange(),
            (this._dirty = !0));
          return;
        }
        if (Number.isFinite(s) && s > 0 && e < s) return;
      }
      (this.buffer.append(e, i, t, r, h, l),
        (this.timeScale._dataLength = this.buffer.length),
        this.timeScale.visibleTo >= this.buffer.length - 2 &&
          ((this.timeScale.visibleTo = this.buffer.length),
          (this.timeScale.visibleFrom =
            this.timeScale.visibleTo - this.timeScale.visibleBars()),
          (this._priceScaleLocked = !1)),
        this._updatePriceRange(),
        (this._dirty = !0));
    }
  }
  updateOrAppend(e, i, t, r, h, l) {
    if (this._replayBackup) return;
    if (this.buffer.length === 0) {
      this.appendBar(e, i, t, r, h, l);
      return;
    }
    const s = this.buffer.time[this.buffer.length - 1];
    if (!Number.isFinite(e) || e === s) {
      (this.buffer.updateLast(i, t, r, h, l),
        this._updatePriceRange(),
        (this._dirty = !0));
      return;
    }
    e > s && this.appendBar(e, i, t, r, h, l);
  }
  setIndicator(e, i, t = "#D8B66A", r = 1, dot = !1) {
    ((this.indicators[e] = { data: i, color: t, lineWidth: r, dot: dot }),
      (this._dirty = !0));
  }
  removeIndicator(e) {
    (delete this.indicators[e], (this._dirty = !0));
  }
  setSubChart(e, i) {
    ((this.subCharts[e] = i), this._recalcLayout(), (this._dirty = !0));
  }
  removeSubChart(e) {
    (delete this.subCharts[e], this._recalcLayout(), (this._dirty = !0));
  }
  _recalcLayout() {
    const e = Object.keys(this.subCharts).length,
      i = 22;
    if (e === 0) {
      const av = this.height - i;
      ((this.priceScale.height = av * 0.84),
        (this.volumeRenderer.height = av * 0.13),
        (this.volumeRenderer.yOffset = this.priceScale.height + 1),
        (this._subChartTop = av),
        (this._subChartEach = 0),
        (this._timeAxisY = this.height - i));
      return;
    }
    ((!this._subRatios || Object.keys(this._subRatios).length !== e) &&
      ((this._subRatios = {}),
      Object.keys(this.subCharts).forEach((l) => {
        this._subRatios[l] = 1 / e;
      })),
      this._lastSubCount !== e &&
        ((this._mainRatio = null), (this._lastSubCount = e)));
    const t = this._mainRatio || 1 - Math.min(e * 0.18, 0.5);
    this._mainRatio = t;
    const h = (this.height - i) * t;
    ((this.priceScale.height = h * 0.85),
      (this.volumeRenderer.height = h * 0.12),
      (this.volumeRenderer.yOffset = this.priceScale.height + 1),
      (this._timeAxisY = this.height - i),
      (this._subChartTop = h),
      (this._subChartEach = (this.height - i - h) / e));
  }
  addDrawing(e) {
    ((e._id = this._nextDrawingId++),
      this.overlay.addDrawing(e),
      (this._dirty = !0));
  }
  clearDrawings(e) {
    (e
      ? (this.overlay.drawings = this.overlay.drawings.filter(
          (i) => i.type !== e,
        ))
      : this.overlay.clearAll(),
      (this._selectedDrawing = null),
      (this._dirty = !0));
  }
  setPreview(e) {
    ((this._preview = e), (this._dirty = !0));
  }
  clearPreview() {
    ((this._preview = null), (this._dirty = !0));
  }
  selectDrawingAt(e, i) {
    const t = this.priceScale.yToPrice(i),
      r = this.timeScale.xToBar(e);
    let h = null,
      l = 1 / 0;
    for (const s of this.overlay.drawings) {
      let n = 1 / 0;
      if (s.type === "hline") n = Math.abs(t - s.price);
      else if (s.type === "vline")
        n =
          (Math.abs(r - (s.index || 0)) *
            (this.priceScale.max - this.priceScale.min)) /
          120;
      else if (s.type === "trendline" && s.points?.length >= 2) {
        const f = s.points[0],
          p = s.points[1],
          d = Math.max(
            0,
            Math.min(
              1,
              ((r - f.index) * (p.index - f.index) +
                (t - f.price) * (p.price - f.price)) /
                (Math.pow(p.index - f.index, 2) +
                  Math.pow(p.price - f.price, 2) || 1),
            ),
          ),
          _ = f.price + d * (p.price - f.price);
        n = Math.abs(t - _);
      } else if (s.type === "ob")
        t >= s.bottom && t <= s.top
          ? (n = 0)
          : (n = Math.min(Math.abs(t - s.top), Math.abs(t - s.bottom)));
      else if (
        s.type === "signal" ||
        s.type === "ob_entry" ||
        s.type === "obsig_entry" ||
        s.type === "autobot_entry"
      )
        n =
          Math.abs(t - (s.price || s.entry || 0)) +
          (Math.abs(r - (s.index || s.bar_idx || 0)) *
            (this.priceScale.max - this.priceScale.min)) /
            500;
      else if (s.type === "fib") {
        const f = (s.high + s.low) / 2;
        n = Math.abs(t - f);
      } else
        (s.type === "text" || s.type === "horizontal") &&
          (n = Math.abs(t - (s.price || 0)));
      const a = (this.priceScale.max - this.priceScale.min) * 0.015;
      n < a && n < l && ((l = n), (h = s));
    }
    this._selectedDrawing = h;
    for (const s of this.overlay.drawings) s._selected = !1;
    return (h && (h._selected = !0), (this._dirty = !0), h);
  }
  _hitDrawingAt(e, i) {
    const t = this.priceScale.yToPrice(i),
      r = this.timeScale.xToBar(e),
      MOV = new Set(["hline", "vline", "trendline", "fib", "text"]);
    let h = null,
      l = 1 / 0;
    for (const s of this.overlay.drawings) {
      if (!MOV.has(s.type) || s._autoTrend) continue;
      let n = 1 / 0;
      if (s.type === "hline") n = Math.abs(t - s.price);
      else if (s.type === "vline")
        n =
          (Math.abs(r - (s.index || 0)) *
            (this.priceScale.max - this.priceScale.min)) /
          120;
      else if (s.type === "trendline" && s.points?.length >= 2) {
        const f = s.points[0],
          p = s.points[1],
          d = Math.max(
            0,
            Math.min(
              1,
              ((r - f.index) * (p.index - f.index) +
                (t - f.price) * (p.price - f.price)) /
                (Math.pow(p.index - f.index, 2) +
                  Math.pow(p.price - f.price, 2) || 1),
            ),
          ),
          _ = f.price + d * (p.price - f.price);
        n = Math.abs(t - _);
      } else if (s.type === "fib") {
        const hi = Math.max(s.high, s.low),
          lo = Math.min(s.high, s.low),
          pad = (hi - lo) * 0.15;
        n =
          t <= hi + pad && t >= lo - pad
            ? 0
            : Math.min(Math.abs(t - hi), Math.abs(t - lo));
      } else if (s.type === "text")
        n =
          Math.abs(t - (s.price || 0)) +
          (Math.abs(r - (s.index || 0)) *
            (this.priceScale.max - this.priceScale.min)) /
            300;
      const a = (this.priceScale.max - this.priceScale.min) * 0.012;
      n < a && n < l && ((l = n), (h = s));
    }
    return h;
  }
  deleteSelected() {
    return this._selectedDrawing
      ? ((this.overlay.drawings = this.overlay.drawings.filter(
          (e) => e !== this._selectedDrawing,
        )),
        (this._selectedDrawing = null),
        (this._dirty = !0),
        !0)
      : !1;
  }
  _render() {
    if (
      !this._dirty ||
      ((this._dirty = !1),
      this.onRenderSync && this.onRenderSync(),
      this.mainCtx.clearRect(0, 0, this.width, this.height),
      this.overlayCtx.clearRect(0, 0, this.width, this.height),
      (this.mainCtx.textAlign = "left"),
      (this.mainCtx.textBaseline = "alphabetic"),
      (this.overlayCtx.textAlign = "left"),
      (this.overlayCtx.textBaseline = "alphabetic"),
      this.buffer.length === 0)
    )
      return;
    this._updatePriceRange();
    const e = this.width - 100;
    if (this._watermark) {
      const t = this.mainCtx;
      (t.save(),
        t.beginPath(),
        t.rect(0, 0, e, this.height),
        t.clip(),
        (t.fillStyle = "rgba(255,255,255,0.03)"),
        (t.font = "bold 60px sans-serif"),
        (t.textAlign = "center"),
        (t.textBaseline = "alphabetic"),
        t.fillText(this._watermark, e / 2, this.height * 0.45),
        t.restore());
    }
    ((this.grid._timeAxisY = this._timeAxisY || this.height - 20),
      this.grid.render(this.priceScale, this.timeScale, this.buffer),
      this.mainCtx.save(),
      this.mainCtx.beginPath(),
      this.mainCtx.rect(0, 0, e, this.height),
      this.mainCtx.clip(),
      (this.volumeRenderer._replayLimit = this._replayVisibleLength || 0),
      (this.volumeRenderer._maPeriod =
        window._indSettings?.vol?.ma_period ?? 20),
      (this.volumeRenderer._maColor =
        window._indSettings?.vol?.ma_color || "#D8B66A"),
      (this.volumeRenderer._maWidth =
        window._indSettings?.vol?.ma_width || 2.5),
      this.showVolume !== !1 && this.volumeRenderer.render(this.buffer),
      (this.candleRenderer._uc = this._uc || this._uf || null),
      (this.candleRenderer._bc = this._bc || null),
      (this.candleRenderer._replayBackup = this._replayBackup || null),
      (this.candleRenderer._replayLimit = this._replayVisibleLength || 0),
      this.candleRenderer.render(this.buffer));
    for (const [t, r] of Object.entries(this.indicators)) {
      const h = this._selectedIndicator === t,
        l = this._replayVisibleLength
          ? r.data.filter((s) => s.index < this._replayVisibleLength)
          : r.data;
      if (r.dot) {
        const ctx = this.mainCtx,
          rad = Math.max(1, (r.lineWidth || 1.5) + 0.5);
        for (const o of l) {
          if (
            o.index < this.timeScale.visibleFrom - 1 ||
            o.index > this.timeScale.visibleTo + 1
          )
            continue;
          if (!Number.isFinite(o.value)) continue;
          const x = this.timeScale.barToX(o.index),
            y = this.priceScale.priceToY(o.value);
          ctx.fillStyle = o.color || r.color;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      } else
        this.lineRenderer.render(l, r.color, h ? r.lineWidth + 2 : r.lineWidth);
    }
    this.mainCtx.restore();
    if (this._vpData) {
      const vp = this._vpData,
        ctx = this.mainCtx,
        cw = this.width - 100;
      const vpH = this._subChartTop || this.height;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cw, vpH);
      ctx.clip();
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < vp.rows; i++) {
        if (vp.vol[i] < vp.max * 0.03) continue;
        const y1 = this.priceScale.priceToY(vp.low + i * vp.step),
          y2 = this.priceScale.priceToY(vp.low + (i + 1) * vp.step),
          barH = Math.max(1, Math.abs(y2 - y1) - 1),
          ratio = vp.vol[i] / vp.max,
          barW = ratio * cw * 0.12,
          buyR = vp.buyVol[i] / vp.vol[i],
          buyW = barW * buyR,
          sellW = barW - buyW,
          isPOC = ratio > 0.85;
        ctx.fillStyle = isPOC ? "rgba(196,56,75,0.5)" : "rgba(196,56,75,0.25)";
        ctx.fillRect(cw - barW, Math.min(y1, y2), buyW, barH);
        ctx.fillStyle = isPOC ? "rgba(59,130,246,0.5)" : "rgba(59,130,246,0.2)";
        ctx.fillRect(cw - barW + buyW, Math.min(y1, y2), sellW, barH);
        if (isPOC) {
          ctx.strokeStyle = "rgba(245,158,11,0.7)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(0, Math.min(y1, y2) + barH / 2);
          ctx.lineTo(cw, Math.min(y1, y2) + barH / 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }
    if (this._ichiCloud && this._ichiCloud.spanA && this._ichiCloud.spanB) {
      const ic = this._ichiCloud,
        ctx2 = this.mainCtx,
        cw2 = this.width - 100;
      ctx2.save();
      ctx2.beginPath();
      ctx2.rect(0, 0, cw2, this.height);
      ctx2.clip();
      const vf = Math.max(0, Math.floor(this.timeScale.visibleFrom)),
        vt2 = Math.min(
          Math.max(ic.spanA.length, ic.spanB.length),
          Math.ceil(this.timeScale.visibleTo),
        );
      for (let i = vf; i < vt2 - 1; i++) {
        if (
          i >= ic.spanA.length ||
          i >= ic.spanB.length ||
          i + 1 >= ic.spanA.length ||
          i + 1 >= ic.spanB.length
        )
          continue;
        const a1 = ic.spanA[i]?.value,
          b1 = ic.spanB[i]?.value,
          a2 = ic.spanA[i + 1]?.value,
          b2 = ic.spanB[i + 1]?.value;
        if (
          !Number.isFinite(a1) ||
          !Number.isFinite(b1) ||
          !Number.isFinite(a2) ||
          !Number.isFinite(b2)
        )
          continue;
        const x1 = this.timeScale.barToX(ic.spanA[i].index),
          x2 = this.timeScale.barToX(ic.spanA[i + 1].index),
          ya1 = this.priceScale.priceToY(a1),
          yb1 = this.priceScale.priceToY(b1),
          ya2 = this.priceScale.priceToY(a2),
          yb2 = this.priceScale.priceToY(b2);
        ctx2.fillStyle =
          a1 >= b1 ? "rgba(76,175,80,0.08)" : "rgba(239,83,80,0.08)";
        ctx2.beginPath();
        ctx2.moveTo(x1, ya1);
        ctx2.lineTo(x2, ya2);
        ctx2.lineTo(x2, yb2);
        ctx2.lineTo(x1, yb1);
        ctx2.closePath();
        ctx2.fill();
      }
      ctx2.restore();
    }
    if (this.buffer.length > 0) {
      const t = Math.max(0, Math.floor(this.timeScale.visibleFrom)),
        r = Math.min(this.buffer.length, Math.ceil(this.timeScale.visibleTo));
      let h = -1 / 0,
        l = 1 / 0;
      for (let p = t; p < r; p++)
        (this.buffer.high[p] > h && (h = this.buffer.high[p]),
          this.buffer.low[p] < l && (l = this.buffer.low[p]));
      const s = this.mainCtx,
        n = (p) => C(p),
        a = this.priceScale.priceToY(h);
      ((s.strokeStyle = "rgba(59,130,246,0.4)"),
        (s.lineWidth = 0.5),
        s.setLineDash([3, 3]),
        s.beginPath(),
        s.moveTo(0, a),
        s.lineTo(e, a),
        s.stroke(),
        s.setLineDash([]),
        (s.fillStyle = "#3B82F6"),
        (s.font = "bold 14px sans-serif"),
        s.fillText((window.t || ((x) => x))("최고 ") + n(h), 4, a - 3));
      const f = this.priceScale.priceToY(l);
      ((s.strokeStyle = "rgba(196,56,75,0.4)"),
        (s.lineWidth = 0.5),
        s.setLineDash([3, 3]),
        s.beginPath(),
        s.moveTo(0, f),
        s.lineTo(e, f),
        s.stroke(),
        s.setLineDash([]),
        (s.fillStyle = "#C4384B"),
        (s.font = "bold 14px sans-serif"),
        s.fillText((window.t || ((x) => x))("최저 ") + n(l), 4, f + 10));
      if (t < this.buffer.length && Number.isFinite(this.buffer.open[t])) {
        const _op = this.buffer.open[t],
          _oy = this.priceScale.priceToY(_op);
        s.strokeStyle = "rgba(216,182,106,0.5)";
        s.lineWidth = 0.5;
        s.setLineDash([3, 3]);
        s.beginPath();
        s.moveTo(0, _oy);
        s.lineTo(e, _oy);
        s.stroke();
        s.setLineDash([]);
        s.fillStyle = "#D8B66A";
        s.font = "bold 14px sans-serif";
        s.fillText((window.t || ((x) => x))("시가 ") + n(_op), 4, _oy - 3);
      }
    }
    if (this.buffer.length > 0) {
      const t = this._replayVisibleLength
          ? this._replayVisibleLength - 1
          : this.buffer.length - 1,
        r = this.buffer.close[t],
        h = t > 0 ? this.buffer.close[t - 1] : r,
        s = r >= h ? "#C4384B" : "#3B82F6",
        n = this.priceScale.priceToY(r),
        a = this.mainCtx;
      if (
        (a.save(),
        (a.shadowColor = s),
        (a.shadowBlur = 6),
        (a.strokeStyle = s),
        (a.lineWidth = 1),
        a.setLineDash([4, 3]),
        a.beginPath(),
        a.moveTo(0, n),
        a.lineTo(e, n),
        a.stroke(),
        a.setLineDash([]),
        a.restore(),
        !(
          this.overlay &&
          this.overlay.crosshair &&
          Math.abs(this.overlay.crosshair.y - n) < 30
        ))
      ) {
        ((a.fillStyle = s),
          a.fillRect(e, n - 11, 100, 22),
          (a.fillStyle = "#fff"),
          (a.font = "bold 14px sans-serif"));
        const d = C(r);
        a.fillText(d, e + 6, n + 4);
      }
      if (this._demoPosition && this._demoPosition.side) {
        const d = this._demoPosition,
          _ = this.priceScale.priceToY(d.entry),
          S = d.pnl >= 0 ? "#C4384B" : "#3B82F6",
          x = d.pnl >= 0 ? "+" : "";
        ((a.strokeStyle = S),
          (a.lineWidth = 1),
          (a.globalAlpha = 0.5),
          a.setLineDash([3, 3]),
          a.beginPath(),
          a.moveTo(0, _),
          a.lineTo(e, _),
          a.stroke(),
          a.setLineDash([]),
          (a.globalAlpha = 1),
          (a.fillStyle = "rgba(59,130,246,0.8)"),
          a.fillRect(e, _ - 10, 100, 20),
          (a.fillStyle = "#fff"),
          (a.font = "14px sans-serif"));
        const g = C(d.entry);
        a.fillText((d.side === "long" ? "L " : "S ") + g, e + 4, _ + 3);
        const v = `${x}${d.pnl.toFixed(1)}$ (${x}${d.pnl_pct.toFixed(1)}%)`;
        a.font = "bold 14px sans-serif";
        const w = a.measureText(v).width + 8,
          o = n + 14;
        ((a.fillStyle = S),
          a.fillRect(e, o - 2, 100, 20),
          (a.fillStyle = "#fff"),
          a.fillText(v, e + 4, o + 11),
          d.tp !== void 0 &&
            ((a.font = "14px sans-serif"),
            (a.fillStyle = document.body.classList.contains("dark")
              ? "#8b949e"
              : "#8E7D72"),
            a.fillText("TP" + d.tp + "/4", e + 4, o + 24)));
      }
    }
    const i = this._subChartTop || this.height;
    if (
      (this.overlayCtx.save(),
      this.overlayCtx.beginPath(),
      this.overlayCtx.rect(0, 0, this.width, i),
      this.overlayCtx.clip(),
      this.overlay.render(this.buffer),
      this.overlayCtx.restore(),
      this.overlay.crosshair)
    ) {
      const t = this.overlayCtx;
      ((t.strokeStyle = "rgba(107,114,128,0.5)"),
        (t.lineWidth = 0.5),
        t.setLineDash([4, 4]),
        t.beginPath(),
        t.moveTo(this.overlay.crosshair.x, 0),
        t.lineTo(this.overlay.crosshair.x, this.height),
        t.moveTo(0, this.overlay.crosshair.y),
        t.lineTo(this.width, this.overlay.crosshair.y),
        t.stroke(),
        t.setLineDash([]));
      const r = this.timeScale.xToBar(this.overlay.crosshair.x);
      if (r >= 0 && r < this.buffer.length) {
        const l = this.buffer.getBar(r);
        if (l) {
          const s = this._timeAxisY || this.height - 20,
            n = new Date(l.time * 1e3),
            a =
              this.buffer.length > 1 &&
              this.buffer.time[1] - this.buffer.time[0] >= 86400,
            _pad = (v) => v.toString().padStart(2, "0"),
            f = a
              ? n.getFullYear() +
                "-" +
                _pad(n.getMonth() + 1) +
                "-" +
                _pad(n.getDate())
              : _pad(n.getMonth() + 1) +
                "-" +
                _pad(n.getDate()) +
                " " +
                _pad(n.getHours()) +
                ":" +
                _pad(n.getMinutes()),
            _bw = a ? 78 : 88,
            _bh = 18;
          ((t.fillStyle = "#921230"),
            t.fillRect(this.overlay.crosshair.x - _bw / 2, s + 1, _bw, _bh),
            (t.fillStyle = "#fff"),
            (t.font = "bold 12px sans-serif"),
            (t.textAlign = "center"),
            (t.textBaseline = "middle"),
            t.fillText(f, this.overlay.crosshair.x, s + 1 + _bh / 2),
            (t.textAlign = "left"),
            (t.textBaseline = "alphabetic"));
        }
      }
      const h = this.priceScale.yToPrice(this.overlay.crosshair.y);
      h > 0 &&
        ((this._crossPriceY = this.overlay.crosshair.y),
        (this._crossPriceFmt = C(h)));
    }
    if (this.buffer.length > 0) {
      const t = this._replayVisibleLength
          ? this._replayVisibleLength - 1
          : this.buffer.length - 1,
        r = this.buffer.close[t],
        h = this.priceScale.priceToY(r),
        l = Math.max(0, t - 1),
        n = r >= this.buffer.close[l] ? "#C4384B" : "#3B82F6",
        a = this.overlayCtx;
      ((a.fillStyle = n),
        a.fillRect(e, h - 11, 100, 22),
        (a.fillStyle = "#fff"),
        (a.font = "bold 14px sans-serif"));
      const f = C(r);
      a.fillText(f, e + 6, h + 4);
    }
    if (this.overlay && this.overlay.crosshair) {
      const _cy = this.overlay.crosshair.y,
        _cp = this.priceScale.yToPrice(_cy),
        _st = this._subChartTop || this.height;
      if (_cy >= 0 && _cy < _st && Number.isFinite(_cp) && _cp > 0) {
        const r = this.overlayCtx,
          h = document.body.classList.contains("dark");
        r.fillStyle = h ? "#921230" : "#032129";
        r.fillRect(e, _cy - 10, 100, 20);
        r.fillStyle = "#fff";
        r.font = "14px sans-serif";
        r.fillText(C(_cp), e + 4, _cy + 4);
      }
    }
    if ((this._renderSubCharts(), this._preview && this._preview.points)) {
      const t = this.overlayCtx,
        r = this._preview.points,
        h = this.timeScale.barToX(r[0].index),
        l = this.priceScale.priceToY(r[0].price),
        s = this.timeScale.barToX(r[1].index),
        n = this.priceScale.priceToY(r[1].price);
      ((t.strokeStyle = "rgba(196,56,75,0.7)"),
        (t.lineWidth = 2),
        t.setLineDash([6, 4]),
        t.beginPath(),
        t.moveTo(h, l),
        t.lineTo(s, n),
        t.stroke(),
        t.setLineDash([]),
        (t.fillStyle = "#C4384B"),
        t.beginPath(),
        t.arc(h, l, 4, 0, Math.PI * 2),
        t.fill(),
        t.beginPath(),
        t.arc(s, n, 4, 0, Math.PI * 2),
        t.fill());
    }
  }
  _renderSubCharts() {
    const e = Object.keys(this.subCharts);
    if (!e.length) return;
    this._subBtns = [];
    const i = this.mainCtx,
      t = this.width - 100,
      r = this._subChartTop || this.height * 0.7,
      h = this._subChartEach || 80;
    e.forEach((l, s) => {
      const n = this.subCharts[l],
        a = r + s * h,
        f = h - 4,
        p = document.body.classList.contains("dark");
      if (
        ((i.strokeStyle = p ? "rgba(255,255,255,0.1)" : "#E8DDD0"),
        (i.lineWidth = 1),
        i.beginPath(),
        i.moveTo(0, a - 2),
        i.lineTo(t, a - 2),
        i.stroke(),
        (i.fillStyle = p ? "rgba(20,56,69,0.6)" : "rgba(250,246,240,0.95)"),
        i.fillRect(0, a, t, f),
        n.bg)
      ) {
        const o = this.timeScale.barWidth,
          u = Math.max(0, Math.floor(this.timeScale.visibleFrom)),
          c = Math.min(this.buffer.length, Math.ceil(this.timeScale.visibleTo));
        for (const b of n.bg) {
          if (b.index < u || b.index > c) continue;
          const m = this.timeScale.barToX(b.index);
          if (b.bg === "up") i.fillStyle = "rgba(196,56,75,0.15)";
          else if (b.bg === "down") i.fillStyle = "rgba(59,130,246,0.15)";
          else continue;
          i.fillRect(m - o / 2, a, o, f);
        }
      }
      let d = 1 / 0,
        _ = -1 / 0;
      const S = Math.max(0, Math.floor(this.timeScale.visibleFrom)),
        x = Math.min(this.buffer.length, Math.ceil(this.timeScale.visibleTo));
      if (n.range) ((d = n.range.min), (_ = n.range.max));
      else {
        for (const u of n.lines)
          for (const c of u.data)
            c.index >= S &&
              c.index <= x &&
              (c.value < d && (d = c.value), c.value > _ && (_ = c.value));
        d === _ && ((d -= 1), (_ += 1));
        const o = (_ - d) * 0.1;
        ((d -= o), (_ += o));
      }
      const g = (o) => a + f - ((o - d) / (_ - d)) * f;
      if (n.hlines)
        for (const o of n.hlines) {
          const u = g(o.value);
          u < a ||
            u > a + f ||
            ((i.strokeStyle = o.color || "rgba(107,114,128,0.3)"),
            (i.lineWidth = 1.5),
            i.setLineDash([3, 3]),
            i.beginPath(),
            i.moveTo(0, u),
            i.lineTo(t, u),
            i.stroke(),
            i.setLineDash([]),
            (i.fillStyle = o.color || "#8E7D72"),
            (i.font = "14px sans-serif"),
            i.fillText(String(o.value), t + 4, u + 3));
        }
      for (const o of n.lines) {
        if (
          ((i.strokeStyle = o.color || "#D8B66A"),
          (i.lineWidth = o.lineWidth || 1),
          o.lineWidth !== 0)
        ) {
          i.beginPath();
          let u = !1;
          for (const c of o.data) {
            if (c.index < S - 1 || c.index > x + 1) continue;
            const b = this.timeScale.barToX(c.index),
              m = g(c.value);
            u ? i.lineTo(b, m) : (i.moveTo(b, m), (u = !0));
          }
          i.stroke();
        }
        if (o.histogram) {
          const u = g(0);
          for (const c of o.data) {
            if (c.index < S || c.index > x) continue;
            const b = this.timeScale.barToX(c.index),
              m = g(c.value),
              T = Math.max(1, this.timeScale.barWidth * 0.6);
            ((i.fillStyle =
              c.color ||
              (c.value >= 0 ? "rgba(196,56,75,0.5)" : "rgba(59,130,246,0.5)")),
              i.fillRect(b - T / 2, Math.min(m, u), T, Math.abs(m - u)));
          }
        }
      }
      if (
        ((i.fillStyle = document.body.classList.contains("dark")
          ? "#c9d1d9"
          : "#8E7D72"),
        (i.font = "bold 14px sans-serif"),
        i.fillText(n.label || l, 6, a + 11),
        n.fill)
      ) {
        const o = g(n.fill.value);
        i.globalAlpha = 0.15;
        for (const u of n.lines)
          for (const c of u.data) {
            if (c.index < S || c.index > x) continue;
            const b = this.timeScale.barToX(c.index),
              m = g(c.value);
            ((i.fillStyle =
              c.value >= n.fill.value
                ? n.fill.above || "rgba(174,76,230,0.1)"
                : n.fill.below || "rgba(51,197,112,0.1)"),
              i.fillRect(b - 1, Math.min(m, o), 2, Math.abs(m - o)));
          }
        i.globalAlpha = 1;
      }
      if (n.markers)
        for (const o of n.markers) {
          if (o.index < S || o.index > x) continue;
          const u = this.timeScale.barToX(o.index),
            c = g(o.value);
          ((i.font = "bold 11px sans-serif"),
            (i.fillStyle = o.color || "#33c570"),
            (i.textAlign = "center"),
            o.type === "bull"
              ? i.fillText("\u25B2Bull", u, c + 12)
              : i.fillText("Bear\u25BC", u, c - 4),
            (i.textAlign = "left"));
        }
      const v = i.measureText(n.label || l).width + 14;
      ((i.fillStyle = "rgba(107,114,128,0.5)"),
        (i.font = "14px sans-serif"),
        i.fillText("\u2699", v, a + 11),
        (i.fillStyle = "rgba(59,130,246,0.6)"),
        i.fillText("\u2715", v + 16, a + 11),
        this._subBtns || (this._subBtns = []),
        this._subBtns.push({
          name: l,
          settingsX: v - 2,
          closeX: v + 14,
          y: a,
          h,
          labelX: 6,
          labelW: v - 8,
        }));
      const w = n.lines[0];
      if (w && w.data.length) {
        const u = w.data[w.data.length - 1].value,
          c = g(u);
        ((i.fillStyle = w.color || "#D8B66A"),
          i.fillRect(t, c - 9, 100, 18),
          (i.fillStyle = "#fff"),
          (i.font = "14px sans-serif"),
          i.fillText(u.toFixed(2), t + 4, c + 3));
      }
      if (this.overlay.crosshair) {
        const o = this.overlay.crosshair.y;
        if (o >= a && o <= a + f) {
          const u = d + (1 - (o - a) / f) * (_ - d);
          ((i.fillStyle = "#921230"),
            i.fillRect(t, o - 9, 100, 18),
            (i.fillStyle = "#fff"),
            (i.font = "14px sans-serif"),
            i.fillText(u.toFixed(2), t + 4, o + 3));
        }
      }
    });
  }
  _updatePriceRange() {
    if (this._priceScaleLocked) return;
    const e = Math.max(0, Math.floor(this.timeScale.visibleFrom)),
      i = Math.min(this.buffer.length, Math.ceil(this.timeScale.visibleTo)),
      t = this.buffer.priceRange(e, i);
    t.min < 1 / 0 && this.priceScale.setRange(t.min, t.max);
  }
  _startRenderLoop() {
    const e = () => {
      this._destroyed || (this._render(), requestAnimationFrame(e));
    };
    requestAnimationFrame(e);
  }
  _setupInteractions() {
    const e = this.overlayCanvas;
    (e.addEventListener(
      "wheel",
      (t) => {
        t.preventDefault();
        if (t.deltaY === 0) return;
        const r = this.width - 100;
        if (t.offsetX > r) {
          this._priceScaleLocked = !0;
          const h = t.deltaY > 0 ? 1.1 : 0.9,
            l = this.priceScale.yToPrice(t.offsetY),
            s = l - (l - this.priceScale.min) * h,
            n = l + (this.priceScale.max - l) * h;
          ((this.priceScale.min = s), (this.priceScale.max = n));
        } else {
          const h = t.deltaY > 0 ? 1.1 : 0.9;
          this.timeScale.zoom(h, t.offsetX);
        }
        this._dirty = !0;
      },
      { passive: !1 },
    ),
      e.addEventListener("dblclick", (t) => {
        if (window._forecastMode) return;
        const r = this.width - 100;
        if (t.offsetX > r) {
          ((this._priceScaleLocked = !1),
            this.timeScale.fitContent(this.buffer.length),
            (this._dirty = !0));
          return;
        }
        const h = this.priceScale.yToPrice(t.offsetY),
          l = Math.round(this.timeScale.xToBar(t.offsetX));
        for (const [s, n] of Object.entries(this.indicators))
          for (const a of n.data)
            if (
              Math.abs(a.index - l) <= 1 &&
              Math.abs(a.value - h) / h < 0.002
            ) {
              ((this._selectedIndicator = s),
                (this._dirty = !0),
                window._openIndSettings && window._openIndSettings(s));
              return;
            }
        ((this._priceScaleLocked = !1),
          this.timeScale.fitContent(this.buffer.length),
          (this._dirty = !0));
      }),
      (this._keydownHandler = (t) => {
        if (
          (t.key === "Delete" || t.key === "Backspace") &&
          this._selectedDrawing
        ) {
          this.deleteSelected();
          return;
        }
        if (t.key === "Escape" && this._selectedDrawing) {
          ((this._selectedDrawing._selected = !1),
            (this._selectedDrawing = null),
            (this._dirty = !0));
          return;
        }
        if (t.key === "Escape" && this._selectedIndicator) {
          const r = this._selectedIndicator;
          (this.removeIndicator(r),
            (this._selectedIndicator = null),
            (this._dirty = !0));
          const h = document.querySelector(`[data-ind="${r}"]`);
          (h && h.classList.remove("on"),
            window._onIndRemoved && window._onIndRemoved(r));
        } else
          t.key === "Escape" &&
            ((this._selectedIndicator = null), (this._dirty = !0));
      }),
      document.addEventListener("keydown", this._keydownHandler),
      e.addEventListener("click", (t) => {
        if (window._forecastMode) return;
        const r = this.width - 100;
        if (t.offsetX > r) return;
        const h = this.priceScale.yToPrice(t.offsetY),
          l = Math.round(this.timeScale.xToBar(t.offsetX));
        if (!this.selectDrawingAt(t.offsetX, t.offsetY)) {
          for (const [n, a] of Object.entries(this.indicators))
            for (const f of a.data)
              if (
                Math.abs(f.index - l) <= 1 &&
                Math.abs(f.value - h) / h < 0.003
              ) {
                ((this._selectedIndicator = n), (this._dirty = !0));
                return;
              }
          (this._selectedIndicator &&
            ((this._selectedIndicator = null), (this._dirty = !0)),
            this._selectedDrawing &&
              ((this._selectedDrawing._selected = !1),
              (this._selectedDrawing = null),
              (this._dirty = !0)));
        }
      }),
      e.addEventListener("mousedown", (t) => {
        if (window._drawMode === "fib" || window._drawMode === "trendline")
          return;
        const r = this._subChartTop || this.height;
        if (
          Math.abs(t.offsetY - r) < 6 &&
          Object.keys(this.subCharts).length > 0
        ) {
          ((this._resizingSub = !0),
            (this._resizeStartY = t.offsetY),
            (this._resizeStartRatio = this._mainRatio));
          return;
        }
        if (t.shiftKey) {
          this._shiftDragStart = {
            x: t.offsetX,
            y: t.offsetY,
            price: this.priceScale.yToPrice(t.offsetY),
            index: this.timeScale.xToBar(t.offsetX),
          };
          return;
        }
        const _hit =
          t.offsetX < this.width - 100
            ? this._hitDrawingAt(t.offsetX, t.offsetY)
            : null;
        if (_hit) {
          let d = _hit;
          if (t.altKey) {
            d = JSON.parse(JSON.stringify(_hit));
            delete d._id;
            delete d._selected;
            this.overlay.addDrawing(d);
          }
          this._movingDrawing = d;
          this._moveStart = {
            price: this.priceScale.yToPrice(t.offsetY),
            index: this.timeScale.xToBar(t.offsetX),
          };
          this._fibGrab = null;
          if (d.type === "fib" && d.high > d.low) {
            const gp = this._moveStart.price,
              rng = d.high - d.low;
            this._fibGrab =
              gp >= d.high - rng * 0.25
                ? "high"
                : gp <= d.low + rng * 0.25
                  ? "low"
                  : "move";
          }
          this._selectedDrawing && (this._selectedDrawing._selected = !1);
          d._selected = !0;
          this._selectedDrawing = d;
          this._dirty = !0;
          return;
        }
        ((this._dragging = !0),
          (this._lastX = t.clientX),
          (this._lastY = t.clientY));
      }),
      e.addEventListener("mousemove", (t) => {
        if (this._movingDrawing) {
          const np = this.priceScale.yToPrice(t.offsetY),
            ni = this.timeScale.xToBar(t.offsetX),
            dp = np - this._moveStart.price,
            di = ni - this._moveStart.index,
            d = this._movingDrawing;
          if (d.price !== void 0) d.price += dp;
          if (d.high !== void 0 && d.low !== void 0) {
            if (this._fibGrab === "high") d.high += dp;
            else if (this._fibGrab === "low") d.low += dp;
            else {
              d.high += dp;
              d.low += dp;
            }
          }
          if (d.index !== void 0) d.index += di;
          if (Array.isArray(d.points))
            d.points = d.points.map((pt) => ({
              index: pt.index + di,
              price: pt.price + dp,
            }));
          this._moveStart = { price: np, index: ni };
          this._dirty = !0;
          return;
        }
        if (
          (this.overlay.setCrosshair(
            t.offsetX,
            this._magnetY(t.offsetX, t.offsetY),
          ),
          (this._dirty = !0),
          this._resizingSub)
        ) {
          const h = t.offsetY - this._resizeStartY,
            l = Math.max(
              0.3,
              Math.min(0.85, this._resizeStartRatio + h / this.height),
            );
          ((this._mainRatio = l), this._recalcLayout(), (this._dirty = !0));
          return;
        }
        const r = this._subChartTop || this.height;
        if (
          ((this.mainCanvas.style.cursor =
            Math.abs(t.offsetY - r) < 6 &&
            Object.keys(this.subCharts).length > 0
              ? "row-resize"
              : ""),
          window._drawMode === "fib" || window._drawMode === "trendline")
        ) {
          this._dragging = !1;
          return;
        }
        if (
          this._shiftDragStart &&
          t.shiftKey &&
          window._drawMode !== "fib" &&
          window._drawMode !== "trendline"
        ) {
          const h = this.priceScale.yToPrice(t.offsetY),
            l = this.timeScale.xToBar(t.offsetX);
          this._preview = {
            points: [
              {
                index: this._shiftDragStart.index,
                price: this._shiftDragStart.price,
              },
              { index: l, price: h },
            ],
          };
          return;
        }
        if (this._dragging) {
          const h = t.clientX - this._lastX,
            l = t.clientY - this._lastY;
          if ((this.timeScale.scroll(h), Math.abs(l) > 0)) {
            const s = this.priceScale.max - this.priceScale.min,
              n = (l / (this.priceScale.height || 400)) * s;
            ((this.priceScale.min += n),
              (this.priceScale.max += n),
              (this._priceScaleLocked = !0));
          }
          ((this._lastX = t.clientX),
            (this._lastY = t.clientY),
            this._checkLoadMore());
        }
      }),
      e.addEventListener("mouseup", (t) => {
        if (this._movingDrawing) {
          this._movingDrawing = null;
          this._moveStart = null;
          this._fibGrab = null;
          this._dragging = !1;
          this._dirty = !0;
          return;
        }
        if (this._shiftDragStart) {
          if (window._drawMode === "fib" || window._drawMode === "trendline") {
            ((this._shiftDragStart = null),
              (this._preview = null),
              (this._dirty = !0),
              (this._dragging = !1));
            return;
          }
          const r = this._shiftDragStart.price,
            h = this.priceScale.yToPrice(t.offsetY),
            l = this._shiftDragStart.index,
            s = this.timeScale.xToBar(t.offsetX);
          (Math.abs(t.offsetY - this._shiftDragStart.y) < 5
            ? this.addDrawing({
                type: "hline",
                price: r,
                color: "#921230",
                lineWidth: 1,
              })
            : this.addDrawing({
                type: "trendline",
                points: [
                  { index: l, price: r },
                  { index: s, price: h },
                ],
                color: "#C4384B",
                lineWidth: 2,
              }),
            (this._shiftDragStart = null),
            (this._preview = null),
            (this._dirty = !0));
        }
        if (this._resizingSub) {
          try {
            window.saveSubRatios && window.saveSubRatios();
          } catch (_) {}
        }
        ((this._dragging = !1), (this._resizingSub = !1));
      }),
      e.addEventListener("mouseleave", () => {
        ((this._dragging = !1),
          (this._resizingSub = !1),
          this.overlay.clearCrosshair(),
          (this._dirty = !0));
      }),
      e.addEventListener(
        "touchstart",
        (t) => {
          const r = t.touches[0];
          ((this._dragging = !0),
            (this._lastX = r.clientX),
            (this._lastTouchY = r.clientY),
            (this._touchStartTime = Date.now()));
        },
        { passive: !0 },
      ),
      e.addEventListener(
        "touchmove",
        (t) => {
          if (!this._dragging || !t.touches[0]) return;
          t.preventDefault();
          const r = t.touches[0];
          if (t.touches.length === 2) {
            const h = Math.hypot(
              t.touches[0].clientX - t.touches[1].clientX,
              t.touches[0].clientY - t.touches[1].clientY,
            );
            if (this._lastPinch) {
              const l = this._lastPinch / h;
              (this.timeScale.zoom(l, this.width / 2), (this._dirty = !0));
            }
            this._lastPinch = h;
          } else {
            const h = r.clientX - this._lastX;
            (this.timeScale.scroll(h),
              (this._lastX = r.clientX),
              (this._dirty = !0),
              this._checkLoadMore());
          }
        },
        { passive: !1 },
      ),
      e.addEventListener("touchend", () => {
        ((this._dragging = !1), (this._lastPinch = null));
      }),
      (this._clickCallbacks = []));
    const i = (t) => {
      if (this._subBtns) {
        const l = t.offsetX,
          s = t.offsetY;
        for (const n of this._subBtns)
          if (s >= n.y && s <= n.y + n.h) {
            if (l >= n.closeX && l <= n.closeX + 14) {
              (this.removeSubChart(n.name),
                this.onSubClose && this.onSubClose(n.name));
              return;
            }
            if (l >= n.settingsX && l <= n.settingsX + 14) {
              this.onSubSettings && this.onSubSettings(n.name, t);
              return;
            }
            if (
              l >= n.labelX &&
              l <= n.labelX + n.labelW &&
              s >= n.y &&
              s <= n.y + 14
            ) {
              this.onSubSettings && this.onSubSettings(n.name, t);
              return;
            }
          }
      }
      const r = this.priceScale.yToPrice(t.offsetY),
        h = Math.round(this.timeScale.xToBar(t.offsetX));
      for (const l of this._clickCallbacks)
        l({ x: t.offsetX, y: t.offsetY, price: r, barIdx: h });
    };
    e.addEventListener("click", i);
  }
  onClick(e) {
    this._clickCallbacks.includes(e) || this._clickCallbacks.push(e);
  }
  onLoadMore(e) {
    this._loadMoreCb = e;
  }
  _setupResize() {
    const e = () => {
      const i = this.container.clientWidth,
        t = this.container.clientHeight;
      if (i < 10 || t < 10 || (this.width === i && this.height === t)) return;
      ((this.width = i), (this.height = t));
      const r = window.devicePixelRatio || 1;
      for (const s of [this.mainCanvas, this.overlayCanvas])
        ((s.width = i * r),
          (s.height = t * r),
          (s.style.width = i + "px"),
          (s.style.height = t + "px"),
          s.getContext("2d").setTransform(r, 0, 0, r, 0, 0));
      const h = this.timeScale.visibleTo - this.timeScale.visibleFrom,
        l =
          this.buffer.length > 0 &&
          (this.timeScale.visibleTo < this.buffer.length - 5 ||
            this._priceScaleLocked);
      if (
        ((this.timeScale.width = i - 90),
        (this.priceScale.height = t * 0.78),
        (this.volumeRenderer.height = t * 0.15),
        (this.volumeRenderer.yOffset = t * 0.83),
        (this.grid.width = i),
        (this.grid.height = t),
        this._recalcLayout(),
        this.buffer.length > 0)
      )
        if (l && h > 0) {
          const s = this.timeScale.width / h;
          ((this.timeScale.barWidth = Math.max(1, Math.min(30, s * 0.7))),
            (this.timeScale.barSpacing = this.timeScale.barWidth * 0.3));
        } else this.timeScale.fitContent(this.buffer.length);
      this._dirty = !0;
    };
    ((this.resize = e),
      (this._resizeObserver = new ResizeObserver(() => e())),
      this._resizeObserver.observe(this.container));
  }
  destroy() {
    try {
      (this._resizeObserver && this._resizeObserver.disconnect(),
        this._keydownHandler &&
          document.removeEventListener("keydown", this._keydownHandler),
        (this._destroyed = !0));
    } catch {}
  }
  _createCanvas(e) {
    const i = document.createElement("canvas"),
      t = window.devicePixelRatio || 1;
    return (
      (i.width = this.width * t),
      (i.height = this.height * t),
      (i.style.cssText = `position:absolute;top:0;left:0;width:${this.width}px;height:${this.height}px`),
      e === "overlay" && (i.style.zIndex = "2"),
      i.getContext("2d").setTransform(t, 0, 0, t, 0, 0),
      i
    );
  }
  _checkLoadMore() {
    this._loadingMore ||
      !this._loadMoreCb ||
      (this.timeScale.visibleFrom <= 10 &&
        ((this._loadingMore = !0),
        this._loadMoreCb().finally(() => {
          this._loadingMore = !1;
        })));
  }
  prependBars(e) {
    if (!e.length) return;
    const i = this.buffer.prepend(e);
    if (i > 0) {
      ((this.timeScale.visibleFrom += i),
        (this.timeScale.visibleTo += i),
        (this.timeScale._dataLength = this.buffer.length),
        this._padColorArrays(i));
      for (const k in this.indicators) {
        const ind = this.indicators[k];
        if (ind && Array.isArray(ind.data)) {
          ind.data = ind.data.map((d) =>
            d && typeof d === "object" && d.index !== undefined
              ? { ...d, index: d.index + i }
              : d,
          );
        }
      }
      for (const sk in this.subCharts) {
        const sub = this.subCharts[sk];
        if (sub) {
          if (Array.isArray(sub.lines))
            sub.lines.forEach((line) => {
              if (Array.isArray(line.data))
                line.data = line.data.map((d) =>
                  d && typeof d === "object" && d.index !== undefined
                    ? { ...d, index: d.index + i }
                    : d,
                );
            });
          if (Array.isArray(sub.markers))
            sub.markers = sub.markers.map((m) =>
              m && m.index !== undefined ? { ...m, index: m.index + i } : m,
            );
          if (Array.isArray(sub.bg))
            sub.bg = sub.bg.map((b) =>
              b && b.index !== undefined ? { ...b, index: b.index + i } : b,
            );
        }
      }
      if (this._ichiCloud) {
        if (Array.isArray(this._ichiCloud.spanA))
          this._ichiCloud.spanA = this._ichiCloud.spanA.map((p) =>
            p && p.index !== undefined ? { ...p, index: p.index + i } : p,
          );
        if (Array.isArray(this._ichiCloud.spanB))
          this._ichiCloud.spanB = this._ichiCloud.spanB.map((p) =>
            p && p.index !== undefined ? { ...p, index: p.index + i } : p,
          );
      }
      if (this.overlay && Array.isArray(this.overlay.drawings)) {
        for (const d of this.overlay.drawings) {
          if (d.index !== undefined && typeof d.index === "number")
            d.index += i;
          if (d.bar_idx !== undefined) d.bar_idx += i;
          if (d.start_idx !== undefined) d.start_idx += i;
          if (d.break_idx !== undefined) d.break_idx += i;
          if (d.startIdx !== undefined) d.startIdx += i;
          if (d.endIdx !== undefined) d.endIdx += i;
          if (Array.isArray(d.points))
            d.points.forEach((p) => {
              if (p && p.index !== undefined) p.index += i;
            });
        }
      }
    }
    this._dirty = !0;
  }
  _padColorArrays(i) {
    if (i <= 0) return;
    const ph = () => ({ v: 0, color: "rgba(128,128,128,0.3)", border: !1 });
    for (const k of ["_uc", "_bc", "_uf"]) {
      const arr = this[k];
      if (Array.isArray(arr) && arr.length > 0) {
        const pad = new Array(i);
        for (let j = 0; j < i; j++) pad[j] = ph();
        this[k] = pad.concat(arr);
      }
    }
  }
  fitContent() {
    (this.timeScale.fitContent(this.buffer.length), (this._dirty = !0));
  }
  getVisibleRange() {
    return { from: this.timeScale.visibleFrom, to: this.timeScale.visibleTo };
  }
  setPriceScaleMode(mode) {
    // 'linear' | 'log'. 모드 변경 후 현재 가시 범위로 가격 범위를 다시 계산한다.
    const m = mode === "log" ? "log" : "linear";
    if (this.priceScale.mode === m) return;
    this.priceScale.setMode(m);
    // 수동 줌 잠금을 풀고 가시 범위 기준으로 재계산 (라벨/스케일 정상화)
    this._priceScaleLocked = !1;
    this._updatePriceRange();
    this._dirty = !0;
  }
  getPriceScaleMode() {
    return this.priceScale.mode || "linear";
  }
  togglePriceScaleMode() {
    const next = this.getPriceScaleMode() === "log" ? "linear" : "log";
    this.setPriceScaleMode(next);
    return next;
  }
  setMagnet(on) {
    this._magnet = !!on;
  }
  toggleMagnet() {
    this._magnet = !this._magnet;
    return this._magnet;
  }
  // 마그넷 모드: 마우스 X 위치의 캔들에서 O/H/L/C 중 마우스 Y에 가장 가까운 값으로 Y를 스냅.
  // 메인 차트(가격) 영역 안에서만 적용. 그 외(가격축/서브차트)는 원본 Y 반환.
  _magnetY(x, y) {
    if (!this._magnet) return y;
    const plotW = this.width - 100;
    const plotBottom = this._subChartTop || this.priceScale.height;
    if (x < 0 || x > plotW || y < 0 || y > plotBottom) return y;
    const bar = Math.round(this.timeScale.xToBar(x));
    if (bar < 0 || bar >= this.buffer.length) return y;
    const cands = [
      this.buffer.open[bar],
      this.buffer.high[bar],
      this.buffer.low[bar],
      this.buffer.close[bar],
    ];
    let bestY = y,
      bestD = 1 / 0;
    for (const price of cands) {
      if (!Number.isFinite(price) || price <= 0) continue;
      const cy = this.priceScale.priceToY(price);
      const d = Math.abs(cy - y);
      if (d < bestD) {
        bestD = d;
        bestY = cy;
      }
    }
    // 너무 멀면(스냅 반경 밖) 스냅하지 않아 자유 이동 보장
    return bestD <= 18 ? bestY : y;
  }
  startReplay(e) {
    this._replayBackup ||
      ((this._replayBackup = {
        length: this.buffer.length,
        _uc: this._uc ? [...this._uc] : null,
        _bc: this._bc ? [...this._bc] : null,
      }),
      (this._replayIndex = Math.max(50, Math.min(e, this.buffer.length - 1))),
      (this._replayAutoTimer = null),
      (this._replayVisibleLength = this._replayIndex),
      (this.timeScale._dataLength = this._replayVisibleLength),
      (this.timeScale.visibleTo = Math.min(
        this.timeScale.visibleTo,
        this._replayVisibleLength,
      )),
      (this.timeScale.visibleFrom = Math.max(
        0,
        this.timeScale.visibleTo - this.timeScale.visibleBars(),
      )),
      (this._priceScaleLocked = !1),
      (this.overlay.drawings = this.overlay.drawings.filter(
        (i) =>
          i.type === "signal" ||
          i.type === "forecast" ||
          i.type === "projection" ||
          i.type === "demo_action" ||
          i.type === "autobot_marker" ||
          i.type === "hline" ||
          i.type === "trendline" ||
          i.type === "buy_scan",
      )),
      (this._dirty = !0),
      this.onReplayChange &&
        this.onReplayChange(this._replayIndex, this.buffer.length));
  }
  replayForward(e = 1) {
    if (!this._replayBackup) return;
    const i = this.buffer.length;
    ((this._replayIndex = Math.min(this._replayIndex + e, i)),
      (this._replayVisibleLength = this._replayIndex),
      (this.timeScale._dataLength = this._replayVisibleLength));
    const t = this.timeScale.visibleBars();
    ((this.timeScale.visibleTo = this._replayVisibleLength),
      (this.timeScale.visibleFrom = Math.max(0, this.timeScale.visibleTo - t)),
      (this._priceScaleLocked = !1),
      (this._dirty = !0),
      this.onReplayChange &&
        this.onReplayChange(this._replayIndex, this.buffer.length));
  }
  replayBack(e = 1) {
    this._replayBackup &&
      ((this._replayIndex = Math.max(50, this._replayIndex - e)),
      (this._replayVisibleLength = this._replayIndex),
      (this.timeScale._dataLength = this._replayVisibleLength),
      this.timeScale.fitContent(this._replayVisibleLength),
      (this._priceScaleLocked = !1),
      (this._dirty = !0),
      this.onReplayChange &&
        this.onReplayChange(this._replayIndex, this.buffer.length));
  }
  replayAutoPlay(e = 500) {
    this._replayBackup &&
      (this.replayAutoStop(),
      (this._replayAutoTimer = setInterval(() => {
        if (this._replayIndex >= this._replayBackup.length) {
          this.replayAutoStop();
          return;
        }
        this.replayForward(1);
      }, e)));
  }
  replayAutoStop() {
    this._replayAutoTimer &&
      (clearInterval(this._replayAutoTimer), (this._replayAutoTimer = null));
  }
  stopReplay() {
    (this.replayAutoStop(),
      this._replayBackup &&
        (this._replayBackup._uc && (this._uc = this._replayBackup._uc),
        this._replayBackup._bc && (this._bc = this._replayBackup._bc),
        (this._replayBackup = null),
        (this._replayIndex = 0),
        (this._replayVisibleLength = 0),
        (this.timeScale._dataLength = this.buffer.length),
        this.timeScale.fitContent(this.buffer.length),
        (this._priceScaleLocked = !1),
        (this._dirty = !0),
        this.onReplayChange && this.onReplayChange(-1, 0)));
  }
  get isReplaying() {
    return !!this._replayBackup;
  }
  get replayPosition() {
    return this._replayIndex;
  }
  get replayTotal() {
    return this._replayBackup ? this._replayBackup.length : 0;
  }
  reorderSubChart(e, i) {
    const t = Object.keys(this.subCharts),
      r = t.indexOf(e);
    if (r < 0) return;
    const h = i === "up" ? r - 1 : r + 1;
    if (h < 0 || h >= t.length) return;
    [t[r], t[h]] = [t[h], t[r]];
    const l = {};
    (t.forEach((s) => {
      l[s] = this.subCharts[s];
    }),
      (this.subCharts = l),
      (this._dirty = !0));
  }
}
