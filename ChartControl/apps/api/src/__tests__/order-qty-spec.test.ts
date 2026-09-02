import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   주문 수량 규격을 고객에게 **미리** 알려준다.

   ★★ 실서비스 사고 (production 데이터로 확인)

     08-30 09:44, 고객이 XRPUSDT 에 0.1(최소 10), DOGEUSDT 에 0.1(최소 100)을
     넣어 주문이 차단됐다. 우리는 그 최소값을 **알고 있었다** — 서버가 minQty 를
     내려주고 api-client 가 /symbols 와 병합하고 주문 폼도 읽을 준비가 돼 있었다.

     끊긴 곳은 `live-market.js` 의 applyMarkets 한 곳이었다. tickSize·multiplier·
     maxLeverage 는 복사하는데 **stepSize·minQty·quantityPrecision 은 빠져
     있었다.** 그래서 폼은 최소값을 몰랐고, 아무 경고도 못 했고, 고객은 눌러보고
     거래소 거부를 받고서야 알았다.

     그 누락은 경고만 막은 게 아니다. stepSize 가 없으면 수량 스냅(snapQty)도
     동작하지 않아 **자동 보정까지** 함께 죽어 있었다.

   ★ 브라우저에서 실측했다: 0.0001 을 넣으면
     "BTCUSDT trades in steps of 0.001. 0.0001 rounds down to zero — enter at
      least 0.001." 가 danger 로 뜨고, 유효한 0.05 에서는 사라진다.
     이 테스트는 그 배선이 다시 끊기지 않게 고정한다.
*/
describe('ORDER-QTY-SPEC — 폼이 수량 규격을 안다', () => {
  it('[1] applyMarkets 가 수량 규격을 복사한다 — 여기가 끊겨 있었다', () => {
    const src = read('src/live-market.js');
    const start = src.indexOf('m.tickSize = r.tickSize;');
    expect(start, 'applyMarkets 의 규격 복사 구간을 찾을 수 없다').toBeGreaterThan(0);
    const block = src.slice(start, start + 2000);
    for (const field of ['stepSize', 'minQty', 'quantityPrecision']) {
      /*
         ★★ 하나라도 빠지면 폼이 그 값을 모른다. tickSize 만 있고 stepSize 가
           없던 상태가 정확히 이 사고였다.
      */
      expect(block, `m.${field} 복사가 없다`).toMatch(new RegExp(`m\\.${field}\\s*=\\s*r\\.${field}`));
    }
  });

  it('[2] 주문 폼이 최소수량을 검사한다', () => {
    const src = read('src/widgets.jsx');
    expect(src).toMatch(/market\.minQty/);
    expect(src).toMatch(/oe_err_below_min_qty/);
    expect(src).toMatch(/oe_err_qty_snapped_zero/);
  });

  it('[3] 최소수량 위반은 경고가 아니라 차단이다', () => {
    const src = read('src/widgets.jsx');
    const start = src.indexOf('const minQtyNum =');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, start + 1600);
    /*
       ★★ 'warn' 이면 제출을 막지 못한다. 최소수량 미달 주문은 성공할 수 없으므로
         경고로 두면 고객이 눌러보고 거래소 거부를 받는다 — 고치기 전 상태다.
    */
    const dangers = block.match(/level: 'danger'/g) ?? [];
    expect(dangers.length, '최소수량 오류가 danger 가 아니다').toBeGreaterThanOrEqual(2);
    expect(block).not.toMatch(/oe_err_below_min_qty[\s\S]{0,120}level: 'warn'/);
  });

  it('[4] 수량 0 도 차단이다 — 예전에는 warn 이라 통과했다', () => {
    const src = read('src/widgets.jsx');
    /*
       ★ 수량 0 짜리 주문은 성공할 수 없다. 경고로 두는 것은 "눌러보라" 는 말이다.
    */
    expect(src).toMatch(/if \(sz <= 0 && !\(parseFloat\(size\) > 0\)\) errors\.push\(\{ level: 'danger'/);
  });

  it('[5] 최소값과 입력값을 함께 보여준다', () => {
    const en = read('src/locales/en.js');
    const below = en.match(/oe_err_below_min_qty: '([^']*)'/)?.[1] ?? '';
    /*
       ★ "최소 10" 만으로는 자기가 얼마를 넣었는지 헷갈린다 — 0.1 과 10 은
         자리수만 다르다. 둘을 나란히 보여줘야 고객이 차이를 본다.
    */
    expect(below).toContain('{min}');
    expect(below).toContain('{entered}');
    expect(below).toContain('{symbol}');

    const snapped = en.match(/oe_err_qty_snapped_zero: '([^']*)'/)?.[1] ?? '';
    // ★ 스냅으로 0 이 된 경우는 단위(step)를 말해야 고객이 다음 값을 정할 수 있다.
    expect(snapped).toContain('{step}');
    expect(snapped).toContain('{min}');
  });

  it('[6] 새 문구가 남아 있는 모든 언어에 있다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/${loc}.js`);
      for (const key of ['oe_err_below_min_qty', 'oe_err_qty_snapped_zero']) {
        expect(src, `${loc} 에 ${key} 가 없다`).toContain(`${key}: '`);
      }
    }
  });

  it('[7] 심볼 이름을 빈 값으로 두지 않는다', () => {
    const src = read('src/widgets.jsx');
    const start = src.indexOf('const minQtyNum =');
    const block = src.slice(start, start + 1600);
    /*
       ★ 이 위젯의 market 에는 symbol 필드가 없을 수 있다(base+quote 로 온다).
         market.symbol 을 쓰면 "  trades in steps of" 가 되어 어느 종목인지 모른다.
    */
    expect(block).toMatch(/symbol: symbolKey/);
    expect(block).not.toMatch(/symbol: market\.symbol/);
  });
});
