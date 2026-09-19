/*
   거래소 등록소 — **거래소를 늘릴 때 고칠 곳을 한 군데로** 모은 것을 잠근다.

   운영 지시: "우리는 여러 거래소랑 협약할 거니까 잘해줘야 해."

   ★★★ 왜 등록소인가
     거래소를 추가할 때마다 라우트를 고치는 구조는 유지할 수 없다 — **고칠 곳이 여러
     군데면 반드시 한 곳을 빠뜨린다.** 이 저장소에서 같은 실패를 여러 번 겪었다
     (AI 명령 네 곳, soft delete 다섯 곳, 주기 표 세 곳).
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ExchangeRegistry } from '../exchanges/exchange-registry.js';
import {
  CONNECTABLE_EXCHANGE_IDS,
  READ_ONLY_EXCHANGE_IDS,
  READ_ONLY_REASON_KEYS,
  canPlaceOrders,
  isConnectable,
} from '../exchanges/exchange-catalog.js';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/* 최소 구현 — 인터페이스를 만족하는 껍데기. */
const acct = () => ({
  getServerTime: async () => 0,
  getBalances: async () => [],
  getPositions: async () => [],
  getOpenOrders: async () => [],
  getOrderByClientId: async () => null,
});
const trade = () => ({
  canPlaceRealOrders: true,
  submitOrder: async () => ({ status: 'REJECTED' as const, reason: 'test' }),
  cancelOrder: async () => ({ ok: true }),
  modifyOrder: async () => ({ ok: true }),
});

describe('등록소', () => {
  it('등록한 거래소를 찾는다', () => {
    const r = new ExchangeRegistry();
    r.register({ id: 'kucoin', account: acct(), trading: trade() });
    r.register({ id: 'bitget', account: acct() });
    expect(r.ids()).toEqual(['bitget', 'kucoin']);
    expect(r.account('kucoin')).not.toBeNull();
    expect(r.account('bitget')).not.toBeNull();
  });

  /*
     ★★★ **읽기만 붙인 거래소는 주문을 낼 수 없다.** 그 사실이 타입과 동작에 드러난다 —
       조용히 다른 거래소로 보내면 **엉뚱한 계정에 주문이 간다.**
  */
  it('주문 어댑터가 없으면 null 이다', () => {
    const r = new ExchangeRegistry();
    r.register({ id: 'bitget', account: acct() });
    expect(r.trading('bitget')).toBeNull();
    expect(r.tradableIds()).toEqual([]);
  });

  it('주문 가능한 거래소를 구분해 알려준다', () => {
    const r = new ExchangeRegistry();
    r.register({ id: 'kucoin', account: acct(), trading: trade() });
    r.register({ id: 'bitget', account: acct() });
    expect(r.tradableIds()).toEqual(['kucoin']);
  });

  /*
     ★★ 같은 id 를 두 번 등록하면 **던진다.** 조용히 덮어쓰면 나중 것이 이기고 어느
       어댑터가 쓰이는지 알 수 없다 — 주문이 걸린 경로에서 그 모호함을 감수하지 않는다.
  */
  it('중복 등록을 막는다', () => {
    const r = new ExchangeRegistry();
    r.register({ id: 'kucoin', account: acct() });
    expect(() => r.register({ id: 'kucoin', account: acct() })).toThrow(/이미 등록/u);
    /* 대소문자만 다른 것도 같은 거래소다 — 다르게 보면 두 개가 등록된다. */
    expect(() => r.register({ id: 'KuCoin', account: acct() })).toThrow(/이미 등록/u);
  });

  it('빈 id 를 거부한다', () => {
    const r = new ExchangeRegistry();
    expect(() => r.register({ id: '  ', account: acct() })).toThrow(/비어 있다/u);
  });

  /*
     ★★ 모르는 거래소는 **던지지 않고 null** 이다. 자격증명에 옛 거래소 이름이 남아
       있을 수 있고(거래소를 내렸을 때), 그때 화면 전체가 500 이 되면 **다른 거래소
       조회까지 막힌다.**
  */
  it('모르는 거래소는 null 이다 — 던지지 않는다', () => {
    const r = new ExchangeRegistry();
    r.register({ id: 'kucoin', account: acct() });
    expect(r.account('okx')).toBeNull();
    expect(r.trading('okx')).toBeNull();
    expect(r.has('okx')).toBe(false);
  });
});

describe('카탈로그가 두 상태를 구분한다', () => {
  /*
     ★★★ `connectable` 만으로는 구분되지 않는다:
       · 연결하면 잔고·포지션을 보고 **주문도** 낼 수 있다 (KuCoin)
       · 연결하면 잔고·포지션**만** 본다 (Bitget — 지금)
     구분하지 않으면 고객이 연결하고 **주문이 나갈 것으로 기대한다.** 그 기대가
     깨지는 순간은 돈을 걸려는 순간이다.
  */
  /*
     ★★★ **계약이 바뀌었다(2026-09-18, 같은 날 몇 시간 뒤).**

       처음 배선했을 때는 읽기만이었다. 그 뒤 운영자가 **실키**를 주셔서 UTA(v3) 경로를
       끝까지 검증했다 — 주문 전송이 `25203 Insufficient margin` 까지 도달했다.
       인자가 전부 맞다는 뜻이다(잔고가 0이라 체결되지 않았다).

     ★ 그래서 비트겟은 이제 **주문까지 된다.** 시험도 사실을 따라간다.
     ★★ 다만 **Classic 계정 주문·손절/익절은 여전히 거부한다.** 그 검사는 아래
       `비트겟 주문 어댑터` 절에 있다 — 지원 범위를 넓히면 그쪽이 먼저 깨진다.
  */
  it('비트겟은 주문까지 된다', () => {
    expect(isConnectable('bitget')).toBe(true);
    expect(canPlaceOrders('bitget')).toBe(true);
  });

  it('읽기 전용 구분 장치는 남겨 둔다', () => {
    /*
       ★ 지금 읽기 전용 거래소는 없다. 그래도 **목록과 문구를 지우지 않는다** —
         거래소를 늘리면 이 상태(읽기만 배선)가 반드시 또 생기고, 그때 다시 만들면
         함께 만들어야 하는 응답 필드·9개 언어 문구를 빠뜨린다.
    */
    expect(Array.isArray(READ_ONLY_EXCHANGE_IDS), '목록 자체가 사라졌다').toBe(true);
    expect(Object.keys(READ_ONLY_REASON_KEYS).length, '문구 키가 사라졌다').toBeGreaterThan(0);
  });

  it('KuCoin 은 주문까지 된다', () => {
    expect(isConnectable('kucoin')).toBe(true);
    expect(canPlaceOrders('kucoin')).toBe(true);
  });

  it('연결할 수 없는 거래소는 주문도 안 된다', () => {
    for (const id of ['binance', 'okx', 'gate', 'bitmart']) {
      expect(canPlaceOrders(id), id).toBe(false);
    }
  });

  it('읽기 전용 거래소는 이유를 밝힌다', () => {
    /*
       ★ 이유 없이 막으면 고객은 고장으로 읽는다.
       ★★ 목록이 비어 있으면 검사할 것이 없다 — 그것은 정상이다(지금이 그 상태).
         나중에 읽기만 배선한 거래소를 넣으면 이유가 반드시 있어야 한다.
    */
    for (const id of READ_ONLY_EXCHANGE_IDS) {
      expect(READ_ONLY_REASON_KEYS[id], `${id} 의 이유가 없다`).toBeTruthy();
    }
  });

  it('읽기 전용 목록이 연결 가능 목록의 부분집합이다', () => {
    /* ★ 연결도 안 되는 거래소를 "읽기 전용" 이라고 하면 모순이다. */
    for (const id of READ_ONLY_EXCHANGE_IDS) {
      expect(CONNECTABLE_EXCHANGE_IDS, `${id} 가 연결 가능 목록에 없다`).toContain(id);
    }
  });

  it('이유 문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('ex_market_bitget')) continue;
      for (const key of Object.values(READ_ONLY_REASON_KEYS)) {
        if (!s.includes(key)) missing.push(`${f} ${key}`);
      }
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('자격증명을 맞는 거래소로 검증한다', () => {
  const routes = read('apps/api/src/trading-routes.ts');

  /*
     ★★★ 예전에는 배포에 하나뿐인 어댑터로 검증했다. 거래소가 둘 이상이면 **비트겟
       키를 KuCoin 으로 검증**하게 되고, 당연히 실패하면서 고객에게는 "키가 잘못됐다"
       고 말한다 — 키는 멀쩡한데 우리가 엉뚱한 곳에 물어본 것이다.
  */
  it('자격증명의 거래소로 어댑터를 고른다', () => {
    expect(routes, '등록소를 받지 않는다').toMatch(/exchanges\?: import\('\.\/exchanges\/exchange-registry'\)/u);
    expect(routes, '자격증명의 거래소를 보지 않는다')
      .toMatch(/const rowExchange = String\(\(row as \{ exchangeId\?: string \}\)\.exchangeId/u);
    expect(routes, '거래소별 어댑터를 찾지 않는다').toMatch(/d\.exchanges\.account\(rowExchange\)/u);
  });

  /*
     ★★ 배선되지 않은 거래소는 **그 사실을 말한다.** 다른 거래소 어댑터로 물어보면
       실패가 "키 문제" 로 보이고 고객이 멀쩡한 키를 지운다.
  */
  it('배선되지 않은 거래소는 이유를 말한다', () => {
    expect(routes, '배선 여부를 구분하지 않는다')
      .toMatch(/is not wired on this deployment yet/u);
    expect(routes, '감사에 남기지 않는다').toMatch(/result: 'unsupported_exchange'/u);
  });

  /*
     ★★★ **기존 경로를 바꾸지 않는다.** `accountAdapter` 를 지우면 주문 경로 전체를
       한 번에 고쳐야 하고, KuCoin 실주문이 걸린 상태에서 그 위험을 감수하지 않는다.
       등록소는 **더하는 것**이다.
  */
  it('기존 단일 어댑터 경로가 남아 있다', () => {
    expect(routes, 'accountAdapter 를 없앴다 — 기존 배포가 깨진다')
      .toMatch(/accountAdapter: IExchangeAccountAdapter;/u);
    /* 등록소가 없으면 기존 어댑터를 쓴다. */
    expect(routes, '등록소 없는 배포를 고려하지 않는다').toMatch(/let adapter = d\.accountAdapter;/u);
  });
});

describe('비트겟 계정 어댑터는 읽기만 한다', () => {
  const src = read('apps/api/src/trading/bitget-account-adapter.ts');

  /*
     ★★ **계정 어댑터에는 여전히 주문이 없다.** 주문은 별도 파일
       (`bitget-trading-adapter.ts`)이 담당한다 — 읽기와 쓰기를 한 파일에 섞으면
       읽기를 고치다가 주문 경로를 건드릴 수 있다.
  */
  it('계정 어댑터에 주문 경로가 없다', () => {
    expect(src, '계정 어댑터가 주문 인터페이스를 구현한다')
      .not.toMatch(/implements[^{]*IExchangeTradingAdapter/u);
    for (const m of ['submitOrder', 'cancelOrder', 'modifyOrder']) {
      expect(src, `${m} 가 계정 어댑터에 있다 — 읽기 파일에 주문이 섞인다`)
        .not.toMatch(new RegExp(`\\b${m}\\s*\\(`, 'u'));
    }
  });

  /*
     ★★★ 빈 배열·null 을 돌려주지 않는다. 빈 배열은 "미체결 주문이 없다" 는 뜻이고
       `null` 은 "그런 주문이 없다" 는 뜻이다 — 주문 대조가 그것을 보고 **주문이
       실패했다고 결론 내린다.**
  */
  /*
     ★★★ **계약이 바뀌었다(2026-09-19).** 운영자 지시: "둘 다 해주면 안 돼? 클래식이랑
       통합계정이랑 말이야." → Classic(v2) 조회·주문을 모두 배선했다.

       예전에는 Classic 에서 **던졌다**(배선 전이라 그것이 맞았다). 이제는 모드에 맞는
       경로로 간다.

     ★★ 그래도 **실패는 여전히 던진다.** 빈 배열은 "미체결 주문이 없다" 는 뜻이고
       `null` 은 "그런 주문이 없다" 는 뜻이다 — 주문 대조가 그것을 보고 **주문이
       실패했다고 결론 내린다.** 조회를 못 한 것과 없는 것은 다르다.
  */
  it('두 계정 모드 모두 조회한다', () => {
    const bodyOf = (name: string): string => {
      const i2 = src.indexOf(`async ${name}(`);
      expect(i2, `${name} 가 없다`).toBeGreaterThan(-1);
      const open = src.indexOf('{', src.indexOf(')', i2));
      let depth = 0;
      for (let k = open; k < src.length; k += 1) {
        if (src[k] === '{') depth += 1;
        else if (src[k] === '}') {
          depth -= 1;
          if (depth === 0) return src.slice(open, k + 1);
        }
      }
      return '';
    };
    for (const name of ['getOpenOrders', 'getOrderByClientId']) {
      const body = bodyOf(name);
      expect(body, `${name} 가 통합계정 경로를 쓰지 않는다`).toMatch(/this\.v3\./u);
      expect(body, `${name} 가 Classic 경로를 쓰지 않는다`).toMatch(/this\.v2\./u);
      /* ★ 모드를 보고 갈라야 한다 — 한쪽만 부르면 다른 모드 고객이 실패한다. */
      expect(body, `${name} 가 모드를 보지 않는다`).toMatch(/mode === 'unified'/u);
      /* ★★ 빈 배열·null 로 대체하지 않는다. */
      expect(body, `${name} 가 빈 배열로 대체한다`).not.toMatch(/catch[\s\S]{0,80}return \[\]/u);
    }
  });

  it('레버리지를 모르면 0 이다', () => {
    /* ★ 1 로 두면 청산 위험을 실제보다 작게 보이게 한다 — KuCoin 에서 겪은 문제다. */
    expect(src, '레버리지를 지어낸다').toMatch(/leverage: r\.leverage \?\? 0/u);
  });

  it('등록소에 읽기와 주문을 모두 등록한다', () => {
    /*
       ★ 실키 검증을 마쳤으므로 주문까지 등록한다. 검증 전에는 `trading` 없이
         등록했다 — 그 단계를 건너뛰지 않았다는 것이 이 파일의 이력에 남아 있다.
    */
    const index = read('apps/api/src/index.ts');
    const i = index.indexOf("id: 'bitget',");
    expect(i, '비트겟을 등록하지 않는다').toBeGreaterThan(-1);
    const body = index.slice(i, i + 300);
    expect(body, '계정 어댑터가 없다').toMatch(/account: new BitgetAccountAdapter\(\)/u);
    expect(body, '주문 어댑터가 없다').toMatch(/trading: new BitgetTradingAdapter\(\)/u);
  });

  /*
     ★★★ **Classic 계정 주문과 보호 주문은 거부한다.** 지원 범위를 넓히면 이 검사가
       먼저 깨져야 한다 — 조용히 무시하면 이용자가 무방비로 남는다.
  */
  it('주문 어댑터가 모드에 맞는 경로를 고른다', () => {
    const t = read('apps/api/src/trading/bitget-trading-adapter.ts');
    /*
       ★ 이제 Classic 도 배선했다. 모드를 보고 구현을 고른다 — 한쪽으로 몰면
         `40084`/`40085` 로 거부되거나 **단위가 어긋난 주문**이 나간다.
    */
    expect(t, '모드로 구현을 고르지 않는다').toMatch(/r\.mode === 'unified' \? this\.trading : this\.classic/u);
    /*
       ★★★ **모드 판정이 실패하면 주문을 보내지 않는다.** "아마 통합계정일 것" 으로
         메우지 않는다 — 단위가 어긋난 주문이 고객 돈을 움직인다.
    */
    expect(t, '모드 판정 실패를 거부하지 않는다').toMatch(/계정 모드를 판정할 수 없다/u);
    /* 보호 주문을 그대로 넘겨 아래 어댑터가 거부하게 한다 — 여기서 지우면 무방비가 된다. */
    for (const f of ['stopPrice', 'takeProfitPrice', 'stopLossPrice']) {
      expect(t, `${f} 를 버린다 — 이용자가 보호가 걸렸다고 믿는다`).toMatch(new RegExp(`req\\.${f}`, 'u'));
    }
  });

  /*
     ★★★ **양쪽 모드에서 손절·익절을 거부한다.** Bitget 은 모르는 필드를 조용히
       무시하므로(v3 실측) 이름을 틀려도 주문은 성공하고 손절만 없다.
       데모 키로 확인하기 전까지 거부가 맞다.
  */
  it('양쪽 구현이 손절·익절을 거부한다', () => {
    for (const f of [
      'packages/exchange-bitget/src/v3-trading.ts',
      'packages/exchange-bitget/src/v2-trading.ts',
    ]) {
      const s2 = read(f);
      expect(s2, `${f}: 스톱 주문을 거부하지 않는다`).toMatch(/if \(req\.stopPrice\)/u);
      expect(s2, `${f}: 손절·익절을 거부하지 않는다`)
        .toMatch(/if \(req\.takeProfitPrice \|\| req\.stopLossPrice\)/u);
    }
  });
});
