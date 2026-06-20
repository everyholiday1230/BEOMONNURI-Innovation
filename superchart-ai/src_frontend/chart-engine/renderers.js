export class CandleRenderer {
  constructor(s, i, n) {
    ((this.ctx = s),
      (this.ts = i),
      (this.ps = n),
      (this.upColor = "#4A9E6B"),
      (this.downColor = "#C4384B"));
  }
  render(s) {
    const i = this.ctx,
      n = Math.max(0, Math.floor(this.ts.visibleFrom)),
      t = Math.min(this._replayLimit || s.length, Math.ceil(this.ts.visibleTo)),
      a =
        this._uc &&
        this._uc.length > 0 &&
        Math.abs(this._uc.length - s.length) <= 2,
      h = i.canvas.width / (window.devicePixelRatio || 1) - 90,
      d = this._chartType || "candle";
    if (d === "line" || d === "area") {
      i.beginPath();
      let e = !1;
      for (let o = n; o < t; o++) {
        const l = this.ts.barToX(o);
        if (l < -20 || l > h + 20) continue;
        const r = this.ps.priceToY(s.close[o]);
        e ? i.lineTo(l, r) : (i.moveTo(l, r), (e = !0));
      }
      if (d === "area") {
        const o = this.ts.barToX(Math.min(t - 1, s.length - 1)),
          l = this.ts.barToX(Math.max(n, 0));
        (i.lineTo(o, this.ps.height),
          i.lineTo(l, this.ps.height),
          i.closePath());
        const r = i.createLinearGradient(0, 0, 0, this.ps.height);
        (r.addColorStop(0, "rgba(59,130,246,0.3)"),
          r.addColorStop(1, "rgba(106,30,51,0.02)"),
          (i.fillStyle = r),
          i.fill());
      }
      ((i.strokeStyle = "#921230"), (i.lineWidth = 1.5), i.stroke());
      return;
    }
    for (let e = n; e < t; e++) {
      const o = this.ts.barToX(e);
      if (o < -20 || o > h + 20) continue;
      let l = s.open[e],
        r = s.high[e],
        T = s.low[e],
        g = s.close[e];
      const m = this.ts.barWidth;
      let p;
      const y = !!this._replayBackup;
      if (a && e < this._uc.length) {
        const c = this._uc[e];
        ((p = c.color),
          c.ho !== void 0 &&
            !y &&
            ((l = c.ho), (r = c.hh), (T = c.hl), (g = c.hc)));
      } else if (
        this._uf &&
        this._uf.length > 0 &&
        Math.abs(this._uf.length - s.length) <= 2 &&
        e < this._uf.length &&
        this._uf[e]
      ) {
        const c = this._uf[e];
        ((p = c.color),
          c.ho !== void 0 &&
            !y &&
            ((l = c.ho), (r = c.hh), (T = c.hl), (g = c.hc)));
      } else if (
        this._bc &&
        this._bc.length > 0 &&
        Math.abs(this._bc.length - s.length) <= 2 &&
        e < this._bc.length &&
        this._bc[e]
      ) {
        const c = this._bc[e];
        ((p = c.color || (g >= l ? this.upColor : this.downColor)),
          c.ho !== void 0 &&
            !y &&
            ((l = c.ho), (r = c.hh), (T = c.hl), (g = c.hc)));
      } else p = g >= l ? this.upColor : this.downColor;
      const v = this.ps.priceToY(l),
        f = this.ps.priceToY(g),
        x = this.ps.priceToY(r),
        b = this.ps.priceToY(T);
      ((i.strokeStyle = p),
        (i.lineWidth = 1),
        i.beginPath(),
        i.moveTo(o, x),
        i.lineTo(o, b),
        i.stroke(),
        (i.fillStyle = p));
      const u = Math.min(v, f),
        _ = Math.max(1, Math.abs(v - f));
      (i.fillRect(o - m / 2, u, m, _),
        a &&
          e < this._uc.length &&
          this._uc[e].border &&
          ((i.strokeStyle = this._uc[e].v > 0 ? "#C4384B" : "#3B82F6"),
          (i.lineWidth = 2),
          i.strokeRect(o - m / 2, u, m, _)),
        this._bc &&
          e < this._bc.length &&
          this._bc[e].border &&
          ((i.strokeStyle = this._bc[e].border),
          (i.lineWidth = 2),
          i.strokeRect(o - m / 2, u, m, _)));
    }
  }
}
export class VolumeRenderer {
  constructor(s, i, n, t) {
    ((this.ctx = s), (this.ts = i), (this.height = n), (this.yOffset = t));
  }
  render(s) {
    const i = this.ctx,
      n = Math.max(0, Math.floor(this.ts.visibleFrom)),
      t = Math.min(this._replayLimit || s.length, Math.ceil(this.ts.visibleTo));
    let a = 0;
    for (let h = n; h < t; h++) s.volume[h] > a && (a = s.volume[h]);
    if (a !== 0)
      for (let h = n; h < t; h++) {
        const d = this.ts.barToX(h),
          e = this.ts.barWidth,
          o = (s.volume[h] / a) * this.height,
          l = s.close[h] >= s.open[h],
          r = i.createLinearGradient(
            0,
            this.yOffset + this.height - o,
            0,
            this.yOffset + this.height,
          );
        (l
          ? (r.addColorStop(0, "rgba(196,56,75,0.4)"),
            r.addColorStop(1, "rgba(196,56,75,0.05)"))
          : (r.addColorStop(0, "rgba(59,130,246,0.4)"),
            r.addColorStop(1, "rgba(59,130,246,0.05)")),
          (i.fillStyle = r),
          i.fillRect(d - e / 2, this.yOffset + this.height - o, e, o));
      }
    if (a !== 0 && this._maPeriod > 1) {
      const mp = this._maPeriod;
      ((i.strokeStyle = this._maColor || "#D8B66A"),
        (i.lineWidth = this._maWidth || 2.5),
        i.beginPath());
      let started = !1;
      for (let h = Math.max(n, mp - 1); h < t; h++) {
        let sum = 0;
        for (let k = h - mp + 1; k <= h; k++) sum += s.volume[k];
        const ma = sum / mp,
          x = this.ts.barToX(h),
          y = this.yOffset + this.height - (ma / a) * this.height;
        started ? i.lineTo(x, y) : (i.moveTo(x, y), (started = !0));
      }
      i.stroke();
    }
  }
}
export class LineRenderer {
  constructor(s, i, n) {
    ((this.ctx = s), (this.ts = i), (this.ps = n));
  }
  render(s, i = "#D8B66A", n = 1) {
    if (!s || s.length < 2) return;
    const t = this.ctx;
    if (((t.lineWidth = n), s[0] && s[0].color)) {
      let h, d, e;
      for (const o of s) {
        if (
          o.index < this.ts.visibleFrom - 1 ||
          o.index > this.ts.visibleTo + 1
        )
          continue;
        const l = this.ts.barToX(o.index),
          r = this.ps.priceToY(o.value);
        (h !== void 0 &&
          ((t.strokeStyle = o.color || i),
          t.beginPath(),
          t.moveTo(h, d),
          t.lineTo(l, r),
          t.stroke()),
          (h = l),
          (d = r));
      }
    } else {
      ((t.strokeStyle = i), t.beginPath());
      let h = !1;
      for (const d of s) {
        if (
          d.index < this.ts.visibleFrom - 1 ||
          d.index > this.ts.visibleTo + 1
        )
          continue;
        const e = this.ts.barToX(d.index),
          o = this.ps.priceToY(d.value);
        h ? t.lineTo(e, o) : (t.moveTo(e, o), (h = !0));
      }
      t.stroke();
    }
  }
}
export class GridRenderer {
  constructor(s, i, n) {
    ((this.ctx = s), (this.width = i), (this.height = n));
  }
  render(s, i, n) {
    const t = this.ctx,
      a = this.width - 100,
      h = document.body.classList.contains("dark"),
      d = h ? "#0a2e3a" : "#FAF6F0",
      e = h ? "rgba(255,255,255,0.08)" : "#E8DDD0",
      o = h ? "rgba(255,255,255,0.12)" : "#E8DDD0",
      l = h ? "#8b949e" : "#8E7D72",
      r = h ? "#c9d1d9" : "#A89888";
    ((t.fillStyle = d),
      t.fillRect(a, 0, 100, this.height),
      (t.strokeStyle = o),
      (t.lineWidth = 1),
      t.beginPath(),
      t.moveTo(a, 0),
      t.lineTo(a, this.height),
      t.stroke(),
      (t.strokeStyle = e),
      (t.lineWidth = 0.5));
    const T = s.max - s.min,
      g = this._niceStep(T, 6),
      m = Math.ceil(s.min / g) * g;
    t.font = "14px sans-serif";
    if (s.mode === "log") {
      // 로그 스케일: 1,2,5 × 10^n 형태의 눈금을 가시 범위 안에서 생성
      for (const f of this._logTicks(s.min, s.max)) {
        const x = s.priceToY(f);
        if (x < 0 || x > this.height) continue;
        ((t.strokeStyle = e),
          t.beginPath(),
          t.moveTo(0, x),
          t.lineTo(a, x),
          t.stroke(),
          (t.fillStyle = l),
          t.fillText(this._formatPrice(f), a + 8, x + 4));
      }
    } else {
      for (let f = m; f <= s.max; f += g) {
        const x = s.priceToY(f);
        ((t.strokeStyle = e),
          t.beginPath(),
          t.moveTo(0, x),
          t.lineTo(a, x),
          t.stroke(),
          (t.fillStyle = l),
          t.fillText(this._formatPrice(f), a + 8, x + 4));
      }
    }
    const p = Math.max(0, Math.floor(i.visibleFrom)),
      y = Math.min(n.length, Math.ceil(i.visibleTo)),
      v = Math.max(1, Math.floor((y - p) / 8));
    let _llx = -1e9;
    for (let f = p; f < y; f += v) {
      const x = i.barToX(f);
      if (x > a) continue;
      ((t.strokeStyle = e),
        t.beginPath(),
        t.moveTo(x, 0),
        t.lineTo(x, this._timeAxisY || this.height - 20),
        t.stroke());
      const b = new Date(n.time[f] * 1e3);
      t.fillStyle = l;
      let u =
        b.getHours().toString().padStart(2, "0") +
        ":" +
        b.getMinutes().toString().padStart(2, "0");
      const _ = f - v;
      ((_ < 0 ||
        new Date(n.time[Math.max(0, _)] * 1e3).getDate() !== b.getDate()) &&
        ((u = b.getMonth() + 1 + "/" + b.getDate() + " " + u),
        (t.fillStyle = r),
        (t.font = "bold 14px sans-serif")),
        x - _llx >= 64 &&
          (t.fillText(
            u,
            Math.max(2, Math.min(x - 18, a - 46)),
            (this._timeAxisY || this.height - 20) + 14,
          ),
          (_llx = x)),
        (t.font = "14px sans-serif"));
    }
  }
  _niceStep(s, i) {
    const n = s / i,
      t = Math.pow(10, Math.floor(Math.log10(n))),
      a = n / t;
    return a <= 1 ? t : a <= 2 ? 2 * t : a <= 5 ? 5 * t : 10 * t;
  }
  _logTicks(min, max) {
    // [min,max] 범위에서 1,2,5 × 10^n 형태의 눈금 배열을 만든다.
    const out = [];
    if (!(min > 0) || !(max > min)) return out;
    let exp = Math.floor(Math.log10(min));
    const mults = [1, 2, 5];
    // 안전 상한(무한루프 방지)
    for (let guard = 0; guard < 60; guard++) {
      const base = Math.pow(10, exp);
      let added = false;
      for (const mu of mults) {
        const v = mu * base;
        if (v >= min && v <= max) {
          out.push(v);
          added = true;
        }
      }
      if (Math.pow(10, exp) > max && !added && out.length) break;
      exp++;
      if (Math.pow(10, exp - 1) > max) break;
    }
    return out;
  }
  _formatPrice(s) {
    return s >= 1e4
      ? s.toLocaleString(void 0, { maximumFractionDigits: 0 })
      : s >= 100
        ? s.toFixed(1)
        : s >= 1
          ? s.toFixed(2)
          : s >= 0.01
            ? s.toFixed(4)
            : s.toFixed(6);
  }
}
