/**
 * 자체 차트 엔진 순수 로직 회귀 테스트 (프레임워크 불필요).
 *
 * 브라우저 없이 Node 로 차트 엔진의 순수 모듈(scales/data-buffer/overlay-engine)을
 * 직접 임포트해 내비게이션·렌더 좌표 로직을 검증한다. 지표/전략/나만의신호가
 * 얹히는 토대(가격 스케일·시간축·오버레이 좌표)를 지켜, 과거/미래 이동 시
 * 빈 화면·캔들 소멸·박스(관심구간) 미표시 회귀를 방지한다.
 *
 * 실행:
 *   node superchart-ai/tests/chart_engine_verify.mjs
 * 종료코드 0 = 전체 통과.
 */
import { TimeScale, PriceScale } from "../static/chart-engine/scales.js";
import { DataBuffer } from "../static/chart-engine/data-buffer.js";
import { OverlayEngine } from "../static/chart-engine/overlay-engine.js";

globalThis.window = globalThis.window || { devicePixelRatio: 1, t: (s) => s };

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name); }
}

// ── 샘플 캔들 ──
function sampleBars(n = 100) {
  const bars = []; let t = 1000, p = 100;
  for (let i = 0; i < n; i++) { p += Math.sin(i / 5) * 2; bars.push({ time: t + i * 60, open: p, high: p + 1, low: p - 1, close: p, volume: 10 + i }); }
  return bars;
}

console.log("[data-buffer] priceRange 빈 구간 센티넬");
{
  const buf = new DataBuffer();
  buf.loadBulk(sampleBars(100));
  ok("100봉 적재", buf.length === 100);
  const empty = buf.priceRange(200, 260);
  ok("빈 구간 → Infinity 센티넬", empty.min === Infinity && empty.max === -Infinity);
  const real = buf.priceRange(0, 100);
  ok("정상 구간 → 유한 범위", Number.isFinite(real.min) && real.min < real.max);

  // _updatePriceRange 가드 재현: min<Infinity 일 때만 스케일 갱신 → 빈 구간이면 유지
  const ps = new PriceScale(); ps.setRange(real.min, real.max);
  const before = { min: ps.min, max: ps.max };
  const t = buf.priceRange(200, 260);
  if (t.min < Infinity) ps.setRange(t.min, t.max);
  ok("빈 구간 스크롤 시 직전 스케일 유지(빈화면 방지)", ps.min === before.min && ps.max === before.max);
}

console.log("[data-buffer] prepend 재인덱싱/시간 단조성");
{
  const bars = sampleBars(100);
  const buf = new DataBuffer();
  buf.loadBulk(bars.slice(50));
  const added = buf.prepend(bars.slice(0, 50));
  ok("과거 50봉 prepend", added === 50 && buf.length === 100);
  let mono = true;
  for (let i = 1; i < buf.length; i++) if (buf.time[i] < buf.time[i - 1]) mono = false;
  ok("prepend 후 시간 단조 증가", mono);
}

console.log("[scales] 미래/과거 이동·줌 경계");
{
  const ts = new TimeScale(); ts.width = 800; ts._dataLength = 100; ts.fitContent(100);
  for (let i = 0; i < 22; i++) ts.zoom(0.9, 400);
  const range = ts.visibleTo - ts.visibleFrom;
  ok("강하게 확대 시 범위 < 20", range < 20 && range >= 5);
  for (let i = 0; i < 50; i++) ts.scroll(-500); // 미래로 강하게 스크롤
  ok("미래 스크롤해도 캔들 유지(visibleFrom < dataLength)", ts.visibleFrom < ts._dataLength);
  ok("미래 여백은 화면 절반 이내", (ts._dataLength - ts.visibleFrom) >= range * 0.5 - 1e-6);

  const ts2 = new TimeScale(); ts2.width = 800; ts2._dataLength = 100; ts2.fitContent(100);
  for (let i = 0; i < 200; i++) ts2.scroll(500); // 과거로 강하게
  ok("과거 스크롤 -50 클램프", ts2.visibleFrom >= -50 - 1e-6);

  const ts3 = new TimeScale(); ts3.width = 800; ts3._dataLength = 100; ts3.fitContent(100);
  for (let i = 0; i < 100; i++) ts3.zoom(1.1, 400); // 축소 반복
  ok("축소 범위 유한·경계 내", Number.isFinite(ts3.visibleFrom) && (ts3.visibleTo - ts3.visibleFrom) <= 100 + 50 + 20 + 1);

  const ts4 = new TimeScale(); ts4.width = 800; ts4._dataLength = 100; ts4.fitContent(100);
  let rt = true;
  for (const idx of [ts4.visibleFrom + 1, Math.floor((ts4.visibleFrom + ts4.visibleTo) / 2), ts4.visibleTo - 2]) {
    if (Math.abs(ts4.xToBar(ts4.barToX(idx)) - idx) > 1) rt = false;
  }
  ok("barToX/xToBar 왕복 오차 ≤ 1봉", rt);
}

console.log("[scales] 키보드 내비게이션 프리미티브 방향");
{
  const ts = new TimeScale(); ts.width = 800; ts._dataLength = 100; ts.fitContent(100);
  const step = (ts.barWidth + ts.barSpacing) * 3;
  const from0 = ts.visibleFrom;
  ts.scroll(step); ok("ArrowLeft(step>0) → 과거로 이동(visibleFrom 감소)", ts.visibleFrom < from0);
  const from1 = ts.visibleFrom;
  ts.scroll(-step); ok("ArrowRight(-step) → 미래로 이동(visibleFrom 증가)", ts.visibleFrom > from1);
  const r0 = ts.visibleTo - ts.visibleFrom;
  ts.zoom(0.9, 400); ok("ArrowUp/+ (0.9) → 확대(범위 축소)", (ts.visibleTo - ts.visibleFrom) < r0);
  const r1 = ts.visibleTo - ts.visibleFrom;
  ts.zoom(1.1, 400); ok("ArrowDown/- (1.1) → 축소(범위 확대)", (ts.visibleTo - ts.visibleFrom) > r1);
  ts.fitContent(100); ok("Home → 전체 보기", ts.visibleTo === 100);

  // scrollToRealtime 은 확대 배율(range)을 유지한 채 마지막 봉으로 점프
  const rt = new TimeScale(); rt.width = 800; rt._dataLength = 100; rt.fitContent(100);
  for (let i = 0; i < 15; i++) rt.zoom(0.9, 400);           // 확대
  for (let i = 0; i < 20; i++) rt.scroll(500);              // 과거로 이동
  const keepRange = rt.visibleTo - rt.visibleFrom;
  // 엔진 scrollToRealtime 과 동일한 계산
  const margin = Math.min(5, Math.max(0, keepRange * 0.1));
  rt.visibleTo = rt._dataLength + margin; rt.visibleFrom = rt.visibleTo - keepRange;
  ok("End(scrollToRealtime) → 마지막 봉이 우측에 보임", rt.visibleFrom < rt._dataLength && rt.visibleTo >= rt._dataLength);
  ok("End(scrollToRealtime) → 확대 배율 유지", Math.abs((rt.visibleTo - rt.visibleFrom) - keepRange) < 1e-9);
}

console.log("[scales] 로그 스케일 좌표 왕복");
{
  const ps = new PriceScale(); ps.height = 400; ps.setMode("log"); ps.setRange(10, 1000);
  const y = ps.priceToY(100); const back = ps.yToPrice(y);
  ok("로그 모드 priceToY→yToPrice 왕복", Math.abs(back - 100) / 100 < 1e-6);
}

console.log("[price-scale] 가격축 휠 확대 가드 (뒤집힘/로그 하한)");
{
  const ps = new PriceScale(); ps.height = 400; ps.setRange(100, 200);
  ok("정상 범위 priceToY 유한", Number.isFinite(ps.priceToY(150)));
  ps.min = 150; ps.max = 150; // 가드 없이 동일 범위가 들어간 상황 시뮬레이션
  ok("min==max 이면 priceToY 가 NaN → 가드 필요성 입증", !Number.isFinite(ps.priceToY(150)));
  // 엔진 가드와 동일 조건
  const applies = (mode, s, e) => Number.isFinite(s) && Number.isFinite(e) && e > s && (mode !== "log" || s > 0);
  ok("가드: e<=s 거부", applies("linear", 100, 100) === false && applies("linear", 200, 100) === false);
  ok("가드: 로그 s<=0 거부", applies("log", -1, 100) === false && applies("log", 0, 100) === false);
  ok("가드: NaN 거부", applies("linear", NaN, 100) === false);
  ok("가드: 정상 허용", applies("linear", 100, 200) === true && applies("log", 1, 100) === true);
}

console.log("[overlay] 박스(zone) 렌더 스키마");
{
  function mockCtx() {
    const calls = { fillRect: [], strokeRect: [], fillText: [] };
    const noop = () => {};
    return {
      calls, canvas: { width: 800, height: 500 },
      save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop,
      closePath: noop, fill: noop, stroke: noop, arc: noop, setLineDash: noop,
      measureText: () => ({ width: 20 }),
      fillRect: (...a) => calls.fillRect.push(a),
      strokeRect: (...a) => calls.strokeRect.push(a),
      fillText: (...a) => calls.fillText.push(a),
      set fillStyle(v) {}, get fillStyle() { return ""; },
      set strokeStyle(v) {}, get strokeStyle() { return ""; },
      set lineWidth(v) {}, get lineWidth() { return 1; },
      set font(v) {}, get font() { return ""; },
      set globalAlpha(v) {}, get globalAlpha() { return 1; },
    };
  }
  const ts = { barToX: (i) => i * 10, visibleFrom: 0, visibleTo: 100, barWidth: 8, _dataLength: 100 };
  const ps = { priceToY: (p) => 500 - p, max: 200, min: 0, height: 400 };

  let ctx = mockCtx(); let oe = new OverlayEngine(ctx, ts, ps);
  oe._renderBox({ type: "box", index: 5, endIndex: 15, price: 100, price2: 99, color: "rgba(1,1,1,0.2)", label: "관심" });
  ok("백엔드 zone 스키마(index/endIndex) 렌더", ctx.calls.fillRect.length === 1 && ctx.calls.fillRect[0][2] === (15 - 5) * 10);

  ctx = mockCtx(); oe = new OverlayEngine(ctx, ts, ps);
  oe._renderBox({ type: "box", points: [{ index: 1, price: 10 }, { index: 3, price: 20 }] });
  ok("points 스키마(markArea) 유지", ctx.calls.fillRect.length === 1);

  ctx = mockCtx(); oe = new OverlayEngine(ctx, ts, ps);
  oe._renderBox({ type: "box" });
  ok("불완전 박스는 무시(예외 없음)", ctx.calls.fillRect.length === 0);
}

console.log("[overlay] 컬링 로직 (index/endIndex 범위)");
{
  const culled = (o, vf, vt, t) => {
    if (o.index !== undefined) { const e = o.endIndex !== undefined ? o.endIndex : o.index; if (e < vf - 5 || o.index > vt + 5 || (t && o.index >= t)) return true; }
    return false;
  };
  ok("시작이 좌측 밖이어도 span 겹치면 유지", culled({ index: -30, endIndex: 40 }, 0, 100) === false);
  ok("완전 좌측 밖 박스는 컬링", culled({ index: -100, endIndex: -40 }, 0, 100) === true);
  ok("화면 내 signal 유지", culled({ index: 50 }, 0, 100) === false);
  ok("화면 우측 밖 signal 컬링", culled({ index: 130 }, 0, 100) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
