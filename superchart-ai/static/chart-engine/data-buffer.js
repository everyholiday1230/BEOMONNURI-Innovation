/**
 * DataBuffer — TypedArray 기반 시계열 데이터 버퍼.
 * Float64Array로 OHLCV 저장, 증분 업데이트 지원.
 */
export class DataBuffer {
  constructor(capacity = 10000) {
    this.capacity = capacity;
    this.length = 0;
    this.time = new Float64Array(capacity);
    this.open = new Float64Array(capacity);
    this.high = new Float64Array(capacity);
    this.low = new Float64Array(capacity);
    this.close = new Float64Array(capacity);
    this.volume = new Float64Array(capacity);
  }

  append(t, o, h, l, c, v) {
    // NaN/undefined 방어 — 잘못된 값이 들어오면 무시 (차트 깨짐 방지)
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return;
    // 양수 검증 (가격은 양수만 의미 있음)
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return;
    // OHLC 무결성: high >= low, high >= max(o,c), low <= min(o,c)
    // 거래소 데이터에 일시적 비정상 값이 들어와도 차트 깨지지 않도록 자동 보정
    if (h < l) { const tmp = h; h = l; l = tmp; }
    h = Math.max(h, o, c);
    l = Math.min(l, o, c);
    if (this.length >= this.capacity) this._grow();
    const i = this.length;
    this.time[i] = Number.isFinite(t) ? t : 0;
    this.open[i] = o; this.high[i] = h;
    this.low[i] = l; this.close[i] = c;
    // volume 음수 방지
    this.volume[i] = (Number.isFinite(v) && v >= 0) ? v : 0;
    this.length++;
  }

  updateLast(o, h, l, c, v) {
    if (this.length === 0) return;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return;
    // OHLC 무결성 자동 보정
    if (h < l) { const tmp = h; h = l; l = tmp; }
    h = Math.max(h, o, c);
    l = Math.min(l, o, c);
    const i = this.length - 1;
    this.open[i] = o; this.high[i] = h; this.low[i] = l;
    this.close[i] = c;
    if (Number.isFinite(v) && v >= 0) this.volume[i] = v;
    // 마지막 캔들 값이 바뀌면 캐시된 min/max가 최신 값을 반영하지 못할 수 있어 무효화한다.
    this._invalidatePriceRangeCache();
  }

  finalizeLast() {
    // 봉 확정 — 다음 append 대기
  }

  getBar(i) {
    if (i < 0 || i >= this.length) return null;
    return { time: this.time[i], open: this.open[i], high: this.high[i],
             low: this.low[i], close: this.close[i], volume: this.volume[i] };
  }

  getRange(from, to) {
    const bars = [];
    for (let i = Math.max(0, from); i < Math.min(this.length, to); i++) {
      bars.push(this.getBar(i));
    }
    return bars;
  }

  priceRange(from, to) {
    const lo = Math.max(0, from);
    const hi = Math.min(this.length, to);
    if (lo >= hi) return { min: 0, max: 1 };

    const cache = this._priceRangeCache;
    // 캐시가 있고, 새 구간이 이전 캐시 구간을 완전히 포함(순수 확장)하는
    // 경우에만 가장자리만 증분 스캔한다. 축소/불연속인 경우는 정확성을
    // 위해 아래에서 전체 재스캔한다.
    if (cache && lo <= cache.lo && hi >= cache.hi) {
      let { min, max } = cache;
      // 왼쪽으로 확장된 가장자리만 스캔
      for (let i = lo; i < cache.lo; i++) {
        const h = this.high[i], l = this.low[i];
        if (Number.isFinite(h) && h > max) max = h;
        if (Number.isFinite(l) && l < min) min = l;
      }
      // 오른쪽으로 확장된 가장자리만 스캔
      for (let i = cache.hi; i < hi; i++) {
        const h = this.high[i], l = this.low[i];
        if (Number.isFinite(h) && h > max) max = h;
        if (Number.isFinite(l) && l < min) min = l;
      }
      this._priceRangeCache = { lo, hi, min, max };
      return { min, max };
    }

    // 캐시를 활용할 수 없는 경우(축소/불연속/최초 호출): 전체 재스캔
    let min = Infinity, max = -Infinity;
    for (let i = lo; i < hi; i++) {
      const h = this.high[i], l = this.low[i];
      // NaN 방어 — NaN은 모든 비교에 false이므로 명시적으로 검사
      if (Number.isFinite(h) && h > max) max = h;
      if (Number.isFinite(l) && l < min) min = l;
    }
    // 유효한 값이 없으면 0~1 반환 (setRange가 호출돼도 안전)
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    this._priceRangeCache = { lo, hi, min, max };
    return { min, max };
  }

  /** 데이터가 변경(append/update/prepend)되면 캐시를 무효화해야 한다. */
  _invalidatePriceRangeCache() {
    this._priceRangeCache = null;
  }

  loadBulk(bars) {
    this.length = 0;
    this._invalidatePriceRangeCache();
    for (const b of bars) {
      this.append(b.time || b.openTime, b.open, b.high, b.low, b.close, b.volume || 0);
    }
  }

  prepend(bars) {
    if (!bars.length) return 0;
    // 중복 제거: 이미 있는 가장 오래된 시간보다 이전 것만
    const oldest = this.length > 0 ? this.time[0] : Infinity;
    const newBars = bars
      .filter(b => (b.time || b.openTime) < oldest)
      // 오래된→최신 순으로 정렬해야 시간축이 단조 증가하게 됨
      .sort((a, b) => (a.time || a.openTime) - (b.time || b.openTime));
    if (!newBars.length) return 0;
    const count = newBars.length;
    const newLen = this.length + count;
    while (newLen > this.capacity) this._grow();
    // 기존 데이터를 뒤로 이동
    for (const key of ['time','open','high','low','close','volume']) {
      this[key].copyWithin(count, 0, this.length);
    }
    // 새 데이터를 앞에 삽입 (이미 정렬됨)
    for (let i = 0; i < count; i++) {
      const b = newBars[i];
      this.time[i] = b.time || b.openTime;
      this.open[i] = b.open; this.high[i] = b.high;
      this.low[i] = b.low; this.close[i] = b.close;
      this.volume[i] = b.volume || 0;
    }
    this.length = newLen;
    // 기존 데이터의 인덱스가 전부 이동했으므로 캐시된 구간 인덱스도 무의미해진다.
    this._invalidatePriceRangeCache();
    return count;
  }

  _grow() {
    const newCap = this.capacity * 2;
    for (const key of ['time','open','high','low','close','volume']) {
      const old = this[key];
      this[key] = new Float64Array(newCap);
      this[key].set(old);
    }
    this.capacity = newCap;
  }
}
