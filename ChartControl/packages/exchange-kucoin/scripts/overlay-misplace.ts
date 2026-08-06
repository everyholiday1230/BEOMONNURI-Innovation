/**
 * chart-canvas.jsx 의 timeToIndex 공식을 실 데이터에 적용해 오버레이가
 * 실제로 몇 칸 어긋나는지 측정한다.
 */
import { KucoinFuturesRest, normalizeInstrument, normalizeRestCandles, toGranularity, planKlinePages, mergeCandlePages } from '../src/index.js';

const rest = new KucoinFuturesRest({ restBase: 'https://api-futures.kucoin.com' });
const contracts = (await rest.getActiveContracts()) as never[];
const insts = new Map(contracts.map(normalizeInstrument).filter(Boolean).map(i => [i!.symbol, i!]));

for (const [sym, tf] of [['MATICUSDT','1m'],['ATOMUSDT','1m'],['OPUSDT','1m'],['APTUSDT','1m'],['BTCUSDT','1m']] as const) {
  const inst = insts.get(sym); if (!inst) continue;
  const g = toGranularity(tf)!;
  const pages = planKlinePages(g, 220, Date.now());
  const out = [];
  for (const pg of pages) out.push(normalizeRestCandles(await rest.getKlines(inst.exchangeSymbol, g, pg.from, pg.to), inst));
  const c = mergeCandlePages(out, 220);
  if (c.length < 3) continue;

  // chart-canvas.jsx 원문 그대로
  const step = c[1] ? c[1]!.time - c[0]!.time : 60000;
  const start = c[0]!.time;
  const flawed = (t: number) => Math.max(0, Math.min(c.length-1, Math.round((t - start)/step)));

  let mismatch = 0, worst = 0;
  const ex: string[] = [];
  for (let i=0;i<c.length;i++){
    const f = flawed(c[i]!.time);
    if (f !== i) {
      mismatch++;
      const off = Math.abs(f-i);
      if (off > worst) worst = off;
      if (ex.length < 3) ex.push(`idx${i}->${f}(${f-i>0?'+':''}${f-i})`);
    }
  }
  const pct = ((mismatch/c.length)*100).toFixed(0);
  // 차트 폭 700px 가정 시 픽셀 오차
  const pxPerBar = 700 / Math.min(120, c.length);
  console.log(`${sym.padEnd(11)} ${tf}  캔들=${String(c.length).padStart(3)}  어긋남=${String(mismatch).padStart(3)}(${pct.padStart(3)}%)  최대=${String(worst).padStart(3)}칸 ≈ ${Math.round(worst*pxPerBar)}px  ${ex.join(' ')}`);
}
