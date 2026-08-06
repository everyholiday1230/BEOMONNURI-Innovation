import { KucoinFuturesRest, normalizeInstrument, normalizeRestCandles, toKucoinSymbol, toGranularity, planKlinePages, mergeCandlePages } from '../src/index.js';
const rest = new KucoinFuturesRest({ restBase: 'https://api-futures.kucoin.com' });
const contracts = (await rest.getActiveContracts()) as never[];
const insts = new Map(contracts.map(normalizeInstrument).filter(Boolean).map(i => [i!.symbol, i!]));

// 디자이너 UI 의 21개 심볼 중 저유동성 포함
const symbols = ['BTCUSDT','MATICUSDT','OPUSDT','FILUSDT','ATOMUSDT','INJUSDT','APTUSDT','ARBUSDT'];
console.log('심볼        tf    캔들  구멍  최대구멍  총누락  첫두칸간격/정상간격');
for (const sym of symbols) {
  const inst = insts.get(sym); if (!inst) continue;
  for (const tf of ['1m','15m'] as const) {
    const g = toGranularity(tf)!;
    const pages = planKlinePages(g, 220, Date.now());
    const out = [];
    for (const pg of pages) out.push(normalizeRestCandles(await rest.getKlines(inst.exchangeSymbol, g, pg.from, pg.to), inst));
    const c = mergeCandlePages(out, 220);
    if (c.length < 3) { console.log(`${sym.padEnd(11)} ${tf.padEnd(5)} 데이터부족`); continue; }
    const step = g*60000;
    let gaps=0, maxGap=0, total=0;
    for (let i=1;i<c.length;i++){ const d=c[i]!.time-c[i-1]!.time; if(d>step){const m=Math.round(d/step)-1; gaps++; total+=m; if(m>maxGap)maxGap=m;} }
    const firstDelta = c[1]!.time - c[0]!.time;
    const ratio = firstDelta/step;
    console.log(`${sym.padEnd(11)} ${tf.padEnd(5)} ${String(c.length).padStart(4)} ${String(gaps).padStart(5)} ${String(maxGap).padStart(9)} ${String(total).padStart(7)}  x${ratio}${ratio!==1?'  <-- step 추정 오류!':''}`);
  }
}
