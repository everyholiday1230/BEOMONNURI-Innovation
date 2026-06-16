/**
 * Scales — 시간축/가격축 변환.
 */
export class TimeScale {
  constructor() {
    this.visibleFrom = 0;  // bar index
    this.visibleTo = 100;
    this.barWidth = 8;
    this.barSpacing = 2;
    this.width = 800;
  }

  setViewport(from, to) {
    this.visibleFrom = Math.max(-50, Math.floor(from));
    this.visibleTo = Math.ceil(to);
    this.barWidth = Math.max(1, (this.width / (this.visibleTo - this.visibleFrom)) * 0.7);
    this.barSpacing = this.barWidth * 0.3;
  }

  barToX(index) {
    const totalWidth = this.barWidth + this.barSpacing;
    return (index - this.visibleFrom) * totalWidth + totalWidth / 2;
  }

  xToBar(x) {
    const totalWidth = this.barWidth + this.barSpacing;
    return Math.floor(x / totalWidth + this.visibleFrom);
  }

  visibleBars() { return this.visibleTo - this.visibleFrom; }

  scroll(deltaX) {
    const bars = deltaX / (this.barWidth + this.barSpacing);
    const range = this.visibleTo - this.visibleFrom;
    this.visibleFrom -= bars;
    this.visibleTo -= bars;
    // 왼쪽 경계: 음수 최대 -50
    if(this.visibleFrom < -50) { this.visibleFrom = -50; this.visibleTo = this.visibleFrom + range; }
    // 오른쪽 경계: visibleTo가 dataLength+20 이상 벗어나지 않도록
    if(this._dataLength > 0 && this.visibleTo > this._dataLength + 20) {
      this.visibleTo = this._dataLength + 20;
      this.visibleFrom = this.visibleTo - range;
    }
  }

  zoom(factor, centerX) {
    const centerBar = this.xToBar(centerX);
    const range = this.visibleTo - this.visibleFrom;
    const newRange = range * factor;
    this.visibleFrom = centerBar - (centerBar - this.visibleFrom) * factor;
    this.visibleTo = this.visibleFrom + newRange;
    this.barWidth = Math.max(1, Math.min(30, (this.width / newRange) * 0.7));
    this.barSpacing = this.barWidth * 0.3;
  }

  fitContent(dataLength) {
    if (!Number.isFinite(dataLength) || dataLength <= 0) {
      this.visibleFrom = 0;
      this.visibleTo = 100;
      this.barWidth = Math.max(1, (this.width / 100) * 0.7);
      this.barSpacing = this.barWidth * 0.3;
      return;
    }
    const visible = Math.min(dataLength, 300);
    this.visibleFrom = dataLength - visible;
    this.visibleTo = dataLength;
    this.barWidth = Math.max(1, (this.width / visible) * 0.7);
    this.barSpacing = this.barWidth * 0.3;
  }
}

export class PriceScale {
  constructor() {
    this.min = 0;
    this.max = 100;
    this.height = 400;
    this.margin = 0.05; // 5% padding
    this.mode = "linear"; // 'linear' | 'log'
  }

  setMode(mode) {
    this.mode = mode === "log" ? "log" : "linear";
  }

  // 로그 모드용: 양수만 의미 있으므로 안전한 하한을 둔다.
  _logSafe(v) {
    return v > 1e-12 ? v : 1e-12;
  }

  setRange(min, max) {
    if (min === max) {
      const offset = min === 0 ? 1 : Math.abs(min) * 0.001;
      min -= offset;
      max += offset;
    }
    if (this.mode === "log") {
      // 로그 공간에서 동일 비율의 패딩을 적용한다.
      const lo = Math.log10(this._logSafe(min));
      const hi = Math.log10(this._logSafe(max));
      const pad = (hi - lo) * this.margin;
      this.min = Math.pow(10, lo - pad);
      this.max = Math.pow(10, hi + pad);
    } else {
      const pad = (max - min) * this.margin;
      this.min = min - pad;
      this.max = max + pad;
    }
  }

  priceToY(price) {
    if (this.mode === "log") {
      const lo = Math.log10(this._logSafe(this.min));
      const hi = Math.log10(this._logSafe(this.max));
      const p = Math.log10(this._logSafe(price));
      return this.height - ((p - lo) / (hi - lo)) * this.height;
    }
    return (
      this.height - ((price - this.min) / (this.max - this.min)) * this.height
    );
  }

  yToPrice(y) {
    if (this.mode === "log") {
      const lo = Math.log10(this._logSafe(this.min));
      const hi = Math.log10(this._logSafe(this.max));
      const p = hi - (y / this.height) * (hi - lo);
      return Math.pow(10, p);
    }
    return this.max - (y / this.height) * (this.max - this.min);
  }
}
