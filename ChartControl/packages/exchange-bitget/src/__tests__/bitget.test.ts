/*
   Bitget 어댑터 — **실제 API 로 확인한 사실**을 잠근다 (2026-09-18).

   ★★★ 이 시험의 기대값은 전부 실호출로 얻은 것이다. 문서만 보고 적은 값은 없다.
     · `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES` → 797개
     · BTCUSDT: pricePlace 1 · priceEndStep 1 · volumePlace 4 · minTradeNum 0.0001
     · granularity: 1m 3m 5m 15m 30m **1H 2H 4H 6H 12H** 1D 1W 1M
       ★ 소문자 시간(`1h`)·`8H` 는 `Parameter verification failed` 로 거부된다
     · 봉 한 줄: [시각, 시가, 고가, 저가, 종가, **기준통화량**, 견적통화량]
     · 시세 `change24h` 는 **비율**(0.06104 = +6.104%)
     · 서명 오류 코드: 40006/40037(키) · 40009(서명) · 40018(IP) · 40014(권한)
*/
import { describe, it, expect } from 'vitest';
import { toGranularity, UNSUPPORTED_TIMEFRAMES, PRODUCT_TYPE } from '../symbols.js';
import { normalizeCandles, normalizeTickers, rowToCandle, rowToTicker } from '../normalize.js';
import { prehash, sign, authHeaders } from '../signature.js';
import { BitgetMarketData } from '../market-adapter.js';
import { BitgetPrivateRest } from '../private-rest.js';
import { BitgetV3Rest } from '../v3-rest.js';
import { BitgetV3Trading } from '../v3-trading.js';
import { BitgetV2Trading } from '../v2-trading.js';
import { classifyError, CODE_IS_CLASSIC } from '../account-mode.js';

describe('타임프레임 매핑', () => {
  it('확인된 값과 같다', () => {
    const pairs: Array<[Parameters<typeof toGranularity>[0], string]> = [
      ['1m', '1m'], ['3m', '3m'], ['5m', '5m'], ['15m', '15m'], ['30m', '30m'],
      ['1h', '1H'], ['2h', '2H'], ['4h', '4H'], ['6h', '6H'], ['12h', '12H'],
      ['1d', '1D'], ['1w', '1W'], ['1M', '1M'],
    ];
    for (const [ours, theirs] of pairs) expect(toGranularity(ours), ours).toBe(theirs);
  });

  /*
     ★★★ `8h` 는 **Bitget 에 없다**(실측: `Parameter verification failed`).
       가까운 주기(6H·12H)로 대체하면 고객은 **맞아 보이는데 틀린 차트**를 본다.
  */
  it("'8h' 는 null 이다 — 6H·12H 로 대체하지 않는다", () => {
    expect(toGranularity('8h')).toBeNull();
    expect(UNSUPPORTED_TIMEFRAMES.has('8h')).toBe(true);
  });

  it('시간 단위는 대문자다', () => {
    /* ★ 소문자 `1h` 를 보내면 거부된다 — 실측으로 확인했다. */
    expect(toGranularity('1h')).toBe('1H');
    expect(toGranularity('1h')).not.toBe('1h');
  });

  it('상품 구분자가 필요하다', () => {
    /* ★ Bitget 은 모든 mix 요청에 productType 을 요구한다. */
    expect(PRODUCT_TYPE).toBe('USDT-FUTURES');
  });
});

describe('봉 정규화', () => {
  const ROW = ['1789758000000', '80906.8', '81386.4', '80875.4', '81169.3', '1648.9872', '133878384.8306'];

  it('실제 응답 한 줄을 변환한다', () => {
    const c = rowToCandle(ROW);
    expect(c).not.toBeNull();
    expect(c!.time).toBe(1_789_758_000_000);
    expect(c!.open).toBe('80906.8');
    expect(c!.close).toBe('81169.3');
  });

  /*
     ★★★ 거래량은 **6번째(기준통화)** 다. 7번째는 USDT 금액이다.
       섞으면 거래량이 수천 배로 보이고 거래량 지표가 전부 어긋난다.
  */
  it('거래량은 기준통화량이다 — 금액이 아니다', () => {
    const c = rowToCandle(ROW);
    expect(c!.volume).toBe('1648.9872');
    expect(c!.volume).not.toBe('133878384.8306');
  });

  it('깨진 줄은 버리고 나머지는 살린다', () => {
    const out = normalizeCandles([ROW, ['x'], null, [...ROW.slice(0, 4)]]);
    /* ★ 한 줄이 깨졌다고 전체를 버리면 화면이 빈다. */
    expect(out).toHaveLength(1);
  });

  it('시각 오름차순으로 정렬하고 중복을 없앤다', () => {
    const later = ['1789761600000', '1', '2', '0.5', '1.5', '10', '15'];
    const out = normalizeCandles([later, ROW, ROW]);
    expect(out.map((c) => c.time)).toEqual([1_789_758_000_000, 1_789_761_600_000]);
  });
});

describe('시세 정규화', () => {
  const T = {
    symbol: 'BTCUSDT', lastPr: '81140', high24h: '81386.4', low24h: '76201.2',
    baseVolume: '43762.3561', usdtVolume: '3463702228.57657',
    change24h: '0.06104', indexPrice: '81186.478', fundingRate: '0.000009',
  };

  /*
     ★★★ `change24h` 는 **비율**이다. 그대로 쓰면 +6.1% 가 +0.06% 로 보인다.
       KuCoin 과 단위가 다르므로 거래소마다 확인해야 한다.
  */
  it('변동률을 퍼센트로 바꾼다', () => {
    const t = rowToTicker(T);
    expect(t).not.toBeNull();
    expect(t!.changePct).toBeCloseTo(6.104, 3);
  });

  it('거래량은 기준통화량이다', () => {
    const t = rowToTicker(T);
    expect(t!.vol24h).toBe('43762.3561');
  });

  it('심볼이 없으면 버린다', () => {
    expect(rowToTicker({ lastPr: '1' })).toBeNull();
    expect(normalizeTickers([T, { lastPr: '1' }, null])).toHaveLength(1);
  });
});

describe('서명', () => {
  it('prehash 형식이 확인된 것과 같다', () => {
    /* timestamp + METHOD + requestPath(쿼리 포함) + body */
    expect(prehash('1700000000000', 'GET', '/api/v2/mix/account/accounts?productType=USDT-FUTURES'))
      .toBe('1700000000000GET/api/v2/mix/account/accounts?productType=USDT-FUTURES');
  });

  it('GET 은 body 가 빈 문자열이다', () => {
    /* ★ `'{}'` 를 넣으면 서명이 틀린다. */
    expect(prehash('1', 'GET', '/x')).toBe('1GET/x');
  });

  it('서명은 base64 sha256 이다', () => {
    expect(sign('secret', 'payload')).toHaveLength(44);
  });

  /*
     ★★★ **헤더에 비밀이 없어야 한다.** 헤더 객체를 로그로 찍는 일이 흔하고,
       그때 비밀이 새면 되돌릴 수 없다.
  */
  it('헤더에 apiSecret 이 새지 않는다', () => {
    const h = authHeaders({ apiKey: 'K', apiSecret: 'SUPERSECRET', passphrase: 'P' }, 'GET', '/x');
    expect(JSON.stringify(h)).not.toContain('SUPERSECRET');
    expect(h['ACCESS-KEY']).toBe('K');
  });

  /*
     ★★★ passphrase 는 **원문 그대로**다. KuCoin 은 서명해 보내지만 Bitget 은 아니다 —
       같다고 가정하면 `40009 signature error` 가 난다.
  */
  it('passphrase 를 서명하지 않는다', () => {
    const h = authHeaders({ apiKey: 'K', apiSecret: 'S', passphrase: 'PLAIN' }, 'GET', '/x');
    expect(h['ACCESS-PASSPHRASE']).toBe('PLAIN');
  });

  it('오류 메시지를 영어로 받는다', () => {
    /* ★ locale 을 안 보내면 중국어로 올 수 있다 — 우리가 로그로 읽어야 한다. */
    const h = authHeaders({ apiKey: 'K', apiSecret: 'S', passphrase: 'P' }, 'GET', '/x');
    expect(h.locale).toBe('en-US');
  });
});

describe('오류를 정상으로 다루지 않는다', () => {
  /*
     ★★★ Bitget 은 **HTTP 200 에 오류 코드**를 담아 준다(잘못된 granularity → 200 +
       code 40034). `res.ok` 만 보면 오류를 정상 데이터로 다룬다 — 실측으로 확인했다.
  */
  it('code 가 00000 이 아니면 던진다', async () => {
    const md = new BitgetMarketData({
      fetchImpl: (async () => new Response(
        JSON.stringify({ code: '40034', msg: 'Parameter verification failed', requestTime: 1, data: null }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
    });
    await expect(md.getTickers()).rejects.toThrow(/40034/u);
  });

  it('지원하지 않는 주기는 호출조차 하지 않는다', async () => {
    let called = 0;
    const md = new BitgetMarketData({
      fetchImpl: (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch,
    });
    await expect(md.getCandles({ symbol: 'BTCUSDT', timeframe: '8h', limit: 3 })).rejects.toThrow(/8h/u);
    /* ★ 거래소를 부르지 않는다 — rate limit 을 낭비하지 않는다. */
    expect(called).toBe(0);
  });

  it('실시간 구독을 한 척하지 않는다', () => {
    /*
       ★★★ WebSocket 을 아직 붙이지 않았다. 빈 함수를 돌려주면 호출자는 구독됐다고
         믿고 갱신을 기다린다 — 그래서 던진다.
    */
    const md = new BitgetMarketData();
    expect(() => md.subscribeCandles('BTCUSDT', '1m', () => {})).toThrow(/실시간/u);
  });
});

describe('자격증명 검증은 실패 이유를 구분한다', () => {
  const mk = (code: string, msg: string) => new BitgetPrivateRest({
    fetchImpl: (async () => new Response(
      JSON.stringify({ code, msg, requestTime: 1, data: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch,
  });
  const CRED = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };

  /*
     ★★ 실패를 한 덩어리로 다루면 고객이 할 일을 모른다:
       키 문제 / IP 제한 / 권한 부족 / 거래소 장애는 각각 다른 행동을 요구한다.
  */
  it('키 문제', async () => {
    for (const code of ['40006', '40037', '40009', '40012']) {
      const r = await mk(code, 'x').verify(CRED);
      expect(r.ok, code).toBe(false);
      expect(r.ok === false && r.reason, code).toBe('BAD_CREDENTIAL');
    }
  });

  it('IP 제한', async () => {
    const r = await mk('40018', 'illegal IP').verify(CRED);
    expect(r.ok === false && r.reason).toBe('IP_BLOCKED');
  });

  it('권한 부족', async () => {
    const r = await mk('40014', 'insufficient permissions').verify(CRED);
    expect(r.ok === false && r.reason).toBe('NO_PERMISSION');
  });

  /*
     ★★★ **모르는 코드를 BAD_CREDENTIAL 이라고 단정하지 않는다.** 그러면 고객이
       멀쩡한 키를 지운다. 거래소 장애일 수 있다.
  */
  it('모르는 코드는 거래소 문제로 둔다', async () => {
    const r = await mk('99999', 'unknown').verify(CRED);
    expect(r.ok === false && r.reason).toBe('UPSTREAM');
  });

  it('성공하면 읽기가 된다는 뜻이다', async () => {
    const rest = new BitgetPrivateRest({
      fetchImpl: (async () => new Response(
        JSON.stringify({ code: '00000', msg: 'success', requestTime: 1, data: [{ marginCoin: 'USDT', available: '100' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
    });
    const r = await rest.verify(CRED);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.accountCount).toBe(1);
  });

  /*
     ★★★ **주문으로 검증하지 않는다.** 검증이 고객 돈을 움직여서는 안 된다.
       읽기 경로만 부른다.
  */
  it('검증이 읽기 경로만 부른다', async () => {
    const paths: string[] = [];
    const rest = new BitgetPrivateRest({
      fetchImpl: (async (url: string) => {
        paths.push(String(url));
        return new Response(JSON.stringify({ code: '00000', msg: 'ok', requestTime: 1, data: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await rest.verify(CRED);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('/api/v2/mix/account/accounts');
    for (const p of paths) {
      expect(p, '검증이 주문 경로를 부른다').not.toMatch(/order|place|close/u);
    }
  });
});

describe('포지션 읽기', () => {
  const mkPos = (rows: unknown[]) => new BitgetPrivateRest({
    fetchImpl: (async () => new Response(
      JSON.stringify({ code: '00000', msg: 'ok', requestTime: 1, data: rows }),
      { status: 200 },
    )) as unknown as typeof fetch,
  });
  const CRED = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };

  it('수량 0 인 행은 버린다', async () => {
    /* ★ 닫힌 포지션을 거래소가 그대로 돌려줄 수 있다. */
    const out = await mkPos([
      { symbol: 'BTCUSDT', holdSide: 'long', total: '0' },
      { symbol: 'ETHUSDT', holdSide: 'short', total: '1.5', leverage: '20' },
    ]).getPositions(CRED);
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe('ETHUSDT');
    expect(out[0]!.side).toBe('short');
  });

  /*
     ★★★ 레버리지를 모르면 **null** 이다. 1 로 두면 청산 위험을 실제보다 작게 보이게
       한다 — KuCoin 에서 실제로 그 문제를 겪었다.
  */
  it('레버리지를 모르면 null 이다', async () => {
    const out = await mkPos([{ symbol: 'BTCUSDT', holdSide: 'long', total: '1' }]).getPositions(CRED);
    expect(out[0]!.leverage).toBeNull();
  });

  it('잔고를 못 구하면 0 을 주지 않는다', async () => {
    /* ★ 0 은 "잔고가 없다" 는 뜻이고 조회 실패와 전혀 다르다. */
    const rest = mkPos([{ marginCoin: 'BTC', available: '1' }]);
    await expect(rest.getAvailableUsdt(CRED)).rejects.toThrow(/USDT/u);
  });
});

describe('계정 모드 — UTA(v3) vs Classic(v2)', () => {
  /*
     ★★★ **우리가 고를 수 없다.** 고객 계정 모드에 달렸고 키만 보고는 알 수 없다.
       실측(2026-09-18, 운영자 실키): 계정이 `unified` 라서 v2 가
       `40085 You are in Unified Account mode...` 로 거부됐다.

     ★★ 그래서 **v3 를 먼저 부르고 `40084` 일 때만 v2 로 내려간다.** 그 밖의 오류에서는
       모드를 정하지 않는다 — 추측해 엉뚱한 API 로 주문을 보내면 **가격·수량 단위가
       어긋난다**(PEPEUSDT priceMultiplier = 0.0000000001).
  */
  const mk = (code: string, msg = 'x', data: unknown = null) => new BitgetV3Rest({
    fetchImpl: (async () => new Response(
      JSON.stringify({ code, msg, requestTime: 1, data }),
      { status: 200 },
    )) as unknown as typeof fetch,
  });
  const CRED = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };

  it('v3 가 성공하면 unified 다', async () => {
    const r = await mk('00000', 'ok', { accountMode: 'unified' }).detectMode(CRED);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.mode).toBe('unified');
  });

  it('40084 면 classic 이다', async () => {
    const r = await mk(CODE_IS_CLASSIC, 'Classic Account mode').detectMode(CRED);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.mode).toBe('classic');
  });

  /*
     ★★★ 모르는 오류에서 **모드를 정하지 않는다.** 정하면 엉뚱한 API 로 주문이 간다.
  */
  it('그 밖의 오류에서는 모드를 정하지 않는다', async () => {
    for (const code of ['40018', '40014', '40006', '99999']) {
      const r = await mk(code, 'x').detectMode(CRED);
      expect(r.ok, code).toBe(false);
    }
  });

  it('오류 종류를 구분한다', () => {
    expect(classifyError('40018')).toBe('IP_BLOCKED');
    expect(classifyError('40014')).toBe('NO_PERMISSION');
    expect(classifyError('40037')).toBe('BAD_CREDENTIAL');
    /* ★ 모르는 코드를 키 문제로 단정하지 않는다 — 고객이 멀쩡한 키를 지운다. */
    expect(classifyError('99999')).toBe('UPSTREAM');
  });
});

describe('v3 응답의 함정', () => {
  const withData = (data: unknown) => new BitgetV3Rest({
    fetchImpl: (async () => new Response(
      JSON.stringify({ code: '00000', msg: 'ok', requestTime: 1, data }),
      { status: 200 },
    )) as unknown as typeof fetch,
  });
  const CRED = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };

  /*
     ★★★ `list` 가 **`null`** 로 온다(실측: 포지션 없는 계정). `[]` 를 기대하면 터진다.
  */
  it('list 가 null 이어도 터지지 않는다', async () => {
    await expect(withData({ list: null }).getPositions(CRED)).resolves.toEqual([]);
    await expect(withData({ list: null }).getUnfilledOrders(CRED)).resolves.toEqual([]);
    await expect(withData({ list: null, cursor: null }).getHistoryOrders(CRED)).resolves.toEqual([]);
  });

  it('잔고 0 은 정상 응답이다 — 실패와 구분된다', async () => {
    /* ★ 실측: 잔고 없는 계정은 `assets: []` 와 `usdtEquity: '0'` 을 준다. */
    const a = await withData({ usdtEquity: '0', accountEquity: '0', assets: [] }).getAssets(CRED);
    expect(a.usdtEquity).toBe('0');
    expect(a.assets).toEqual([]);
  });

  it('조회 실패는 던진다 — 0 으로 바꾸지 않는다', async () => {
    const bad = new BitgetV3Rest({
      fetchImpl: (async () => new Response(
        JSON.stringify({ code: '40037', msg: 'Apikey does not exist', requestTime: 1, data: null }),
        { status: 200 },
      )) as unknown as typeof fetch,
    });
    await expect(bad.getAssets(CRED)).rejects.toThrow(/40037/u);
    await expect(bad.getPositions(CRED)).rejects.toThrow(/40037/u);
  });

  it('수량 0 인 포지션은 버린다', async () => {
    const out = await withData({ list: [
      { symbol: 'BTCUSDT', holdSide: 'long', total: '0', openPriceAvg: '80000' },
      { symbol: 'ETHUSDT', holdSide: 'short', total: '2', openPriceAvg: '3000', leverage: '10' },
    ] }).getPositions(CRED);
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe('ETHUSDT');
    expect(out[0]!.leverage).toBe(10);
  });
});

describe('v3 주문 — 실키로 확인한 스펙', () => {
  /*
     ★★★ 실측(2026-09-18, 체결 불가 조건으로):
       · `qty` 다. `size` 로 보내면 "Parameter qty cannot be empty"
       · `posSide` 필수(헤지 모드). 없으면 `25156 In one-way position mode...`
       · `holdSide` 는 v2 이름 — v3 에 쓰면 25156
       · 최소 5 USDT(`45110`), 인자가 맞으면 `25203 Insufficient margin` 까지 간다
  */
  const capture = () => {
    const sent: Array<{ url: string; body: string }> = [];
    const t = new BitgetV3Trading({
      fetchImpl: (async (url: string, init?: RequestInit) => {
        sent.push({ url: String(url), body: String(init?.body ?? '') });
        return new Response(
          JSON.stringify({ code: '00000', msg: 'ok', requestTime: 1, data: { orderId: 'OID1', clientOid: 'COID1' } }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    return { t, sent };
  };
  const CRED = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };
  const BASE = { clientOrderId: 'COID1', symbol: 'BTCUSDT', side: 'long' as const, type: 'limit' as const, price: '10000', quantity: '0.001' };

  it('qty 와 posSide 를 보낸다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, BASE);
    const body = JSON.parse(sent[0]!.body) as Record<string, string>;
    expect(body.qty, 'qty 가 없다 — size 로 보내면 거부된다').toBe('0.001');
    expect(body.size, 'size 를 보낸다 — v2 이름이다').toBeUndefined();
    expect(body.posSide, 'posSide 가 없다 — 헤지 모드에서 거부된다').toBe('long');
    expect(body.holdSide, 'holdSide 를 보낸다 — v2 이름이라 25156 이 난다').toBeUndefined();
    expect(body.category).toBe('USDT-FUTURES');
    expect(body.clientOid, 'clientOid 가 없으면 대조할 열쇠가 없다').toBe('COID1');
  });

  it('방향 변환을 한 곳에서만 한다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, { ...BASE, side: 'short' });
    const body = JSON.parse(sent[0]!.body) as Record<string, string>;
    expect(body.side).toBe('sell');
    expect(body.posSide).toBe('short');
  });

  /*
     ★★★ **지원하지 않는 보호 주문은 거래소를 부르지도 않고 거부한다.**
       조용히 무시하면 이용자는 보호가 걸렸다고 믿은 채 무방비로 남는다.
  */
  /*
     ★★★ **UTA(v3) 는 손절·익절 필드 이름을 확인하지 못했다.** Classic(v2) 은 공식
       문서에서 확인했지만(`presetStopSurplusPrice`·`presetStopLossPrice`), UTA 문서의
       주문 항목을 열지 못했고 v2 이름이 v3 에서도 같다는 보장이 없다.
     ★ Bitget 은 모르는 필드를 조용히 무시하므로 **추측으로 보낼 수 없다** —
       이름이 틀리면 주문은 성공하고 손절만 없다.
  */
  it('보호 주문은 보내지 않고 거부한다', async () => {
    for (const extra of [{ stopPrice: '9000' }, { stopLossPrice: '9000' }, { takeProfitPrice: '99000' }]) {
      const { t, sent } = capture();
      const r = await t.submitOrder(CRED, { ...BASE, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe('REJECTED');
      /* ★ 거래소를 부르지 않았는지 — 부르면 주문이 나갈 수 있다. */
      expect(sent, `${JSON.stringify(extra)}: 거래소를 불렀다`).toHaveLength(0);
    }
  });

  it('가격 없는 지정가를 거부한다', async () => {
    const { t, sent } = capture();
    const r = await t.submitOrder(CRED, { ...BASE, price: undefined });
    expect(r.status).toBe('REJECTED');
    expect(sent).toHaveLength(0);
  });

  /*
     ★★★ 전송 결과를 모를 때 **거절로 다루지 않는다.** 주문이 들어갔을 수 있고,
       거절로 보고 다시 보내면 **두 번 들어간다.**
  */
  it('전송 실패는 SUBMIT_UNKNOWN 이다', async () => {
    const t = new BitgetV3Trading({
      fetchImpl: (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
    });
    const r = await t.submitOrder(CRED, BASE);
    expect(r.status).toBe('SUBMIT_UNKNOWN');
    expect(r.status === 'SUBMIT_UNKNOWN' && r.clientOrderId).toBe('COID1');
  });

  it('성공인데 주문 id 가 없으면 성공으로 단정하지 않는다', async () => {
    const t = new BitgetV3Trading({
      fetchImpl: (async () => new Response(
        JSON.stringify({ code: '00000', msg: 'ok', requestTime: 1, data: {} }),
        { status: 200 },
      )) as unknown as typeof fetch,
    });
    const r = await t.submitOrder(CRED, BASE);
    expect(r.status).toBe('SUBMIT_UNKNOWN');
  });

  it('취소 실패를 성공으로 만들지 않는다', async () => {
    const t = new BitgetV3Trading({
      fetchImpl: (async () => new Response(
        JSON.stringify({ code: '25204', msg: 'Order does not exist', requestTime: 1, data: null }),
        { status: 200 },
      )) as unknown as typeof fetch,
    });
    const r = await t.cancelOrder(CRED, 'BTCUSDT', 'x');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/25204/u);
  });

  it('바꿀 값 없는 수정을 거부한다', async () => {
    const { t, sent } = capture();
    const r = await t.modifyOrder(CRED, 'BTCUSDT', 'x', {});
    expect(r.ok).toBe(false);
    expect(sent, '거래소를 불렀다').toHaveLength(0);
  });

  it('청산 주문에 reduceOnly 를 보낸다', async () => {
    /* ★ 없으면 반대 포지션이 열릴 수 있다. */
    const { t, sent } = capture();
    await t.submitOrder(CRED, { ...BASE, reduceOnly: true });
    expect(JSON.parse(sent[0]!.body).reduceOnly).toBe('YES');
  });
});

describe('데모 거래 (가상 자금)', () => {
  /*
     ★★★ UTA 문서(2026-09-18 확인): 헤더 `paptrading: 1` 로 가상 자금 주문을 시험할 수 있다.
       내부 문서에 "데모 거래는 없다" 고 적혀 있었는데 **그 말은 FastApi 에 한정된다.**

     ★★★ **왜 데모가 필요한가 — 이것이 핵심이다.**
       Bitget 은 **모르는 필드를 조용히 무시한다**(실측: 존재하지 않는 필드를 보내도
       거절하지 않는다). 즉 손절 필드 이름을 틀리게 써도 **주문은 성공하고 손절만 없다.**
       오류가 없으므로 알아챌 방법이 없고, 고객은 보호가 걸렸다고 믿은 채 무방비로 남는다.
       그 종류의 실패는 **실제로 주문을 내 봐야** 확인된다.
  */
  it('데모 키에만 paptrading 을 붙인다', () => {
    const base = { apiKey: 'K', apiSecret: 'S', passphrase: 'P' };
    /*
       ★★ 실거래 키에 붙으면 **모든 요청이 `40099 exchange environment is incorrect`
         로 실패한다**(실측). 조건 없이 붙이면 연결이 전부 깨진다.
    */
    expect(authHeaders(base, 'GET', '/x').paptrading, '실거래 키에 데모 헤더가 붙었다').toBeUndefined();
    expect(authHeaders({ ...base, demo: true }, 'GET', '/x').paptrading).toBe('1');
  });

  it('데모 표시가 비밀을 새게 하지 않는다', () => {
    const h = authHeaders({ apiKey: 'K', apiSecret: 'SUPERSECRET', passphrase: 'P', demo: true }, 'GET', '/x');
    expect(JSON.stringify(h)).not.toContain('SUPERSECRET');
  });

  /*
     ★★★ **검증하지 못한 기능은 거부한다.** 손절·익절 필드 이름을 데모로 확인하기
       전까지 주문을 받지 않는다. "아마 이 이름일 것" 으로 고객 보호를 걸지 않는다.
     ★ 이 시험은 지원 범위를 넓힐 때 **먼저 깨져야 한다** — 그때 데모 검증을 했는지
       스스로 묻게 된다.
  */
  it('손절·익절은 데모 검증 전까지 거부한다', async () => {
    let called = 0;
    const t = new BitgetV3Trading({
      fetchImpl: (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch,
    });
    const CRED = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };
    const BASE = { clientOrderId: 'C', symbol: 'BTCUSDT', side: 'long' as const, type: 'limit' as const, price: '1', quantity: '1' };
    for (const extra of [{ stopLossPrice: '9000' }, { takeProfitPrice: '99000' }, { stopPrice: '9000' }]) {
      const r = await t.submitOrder(CRED, { ...BASE, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe('REJECTED');
    }
    /* ★★ 거래소를 **한 번도** 부르지 않았다 — 부르면 손절 없는 주문이 나갈 수 있다. */
    expect(called, '거래소를 불렀다 — 손절 없는 주문이 나갈 수 있다').toBe(0);
  });
});

describe('Classic(v2) 주문 — 공식 문서로 검증', () => {
  /*
     ★★★ **2026-09-19: 공식 문서를 읽어 결함 3개를 찾았다.**
       그 전에는 "필수 인자가 틀리면 거절되니 안전하다" 는 근거로 배포했는데,
       문서를 보니 **거절되지 않고 잘못 동작하는** 경우가 있었다.

       ① `tradeSide` 가 헤지 모드에서 **필수**인데 안 보냈다
       ② `reduceOnly` 는 **일방 모드 전용**이다 — 헤지에서는 무시된다
          ★★★ 그래서 청산 주문이 **반대 포지션을 새로 열었다.** 거절되지 않는다.
            "실패 방향이 안전하다" 는 내 판단이 틀렸던 지점이다
       ③ `newClientOid` 가 수정에 **필수**인데 안 보냈다

     ★ 교훈: 문서를 읽을 수 있으면 읽는다. "안전하게 실패한다" 는 추론이
       **모든 경우를 덮지 못한다.**
  */
  const capture = () => {
    const sent: Array<{ url: string; body: string }> = [];
    const t = new BitgetV2Trading({
      fetchImpl: (async (url: string, init?: RequestInit) => {
        sent.push({ url: String(url), body: String(init?.body ?? '') });
        return new Response(
          JSON.stringify({ code: '00000', msg: 'ok', requestTime: 1, data: { orderId: 'OID', clientOid: 'C' } }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    return { t, sent };
  };
  const CRED = { apiKey: 'k', apiSecret: 's', passphrase: 'p' };
  const BASE = { clientOrderId: 'C', symbol: 'BTCUSDT', side: 'long' as const, type: 'limit' as const, price: '10000', quantity: '0.001' };

  it('v2 경로와 v2 인자 이름을 쓴다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, BASE, 'one_way');
    expect(sent[0]!.url, 'v3 경로로 보낸다').toContain('/api/v2/mix/order/place-order');
    const body = JSON.parse(sent[0]!.body) as Record<string, string>;
    /* ★★★ v2 는 `productType`·`size`, v3 는 `category`·`qty` 다. 섞으면 거절된다. */
    expect(body.productType, 'productType 이 없다').toBe('USDT-FUTURES');
    expect(body.category, 'category 를 보낸다 — v3 이름이다').toBeUndefined();
    expect(body.size, 'size 가 없다').toBe('0.001');
    expect(body.qty, 'qty 를 보낸다 — v3 이름이다').toBeUndefined();
    expect(body.marginCoin).toBe('USDT');
    /* ★★ 교차 증거금은 `crossed` 다 — `cross` 로 보내면 거절된다. */
    expect(body.marginMode).toBe('crossed');
    expect(body.clientOid, 'clientOid 가 없으면 대조할 열쇠가 없다').toBe('C');
  });

  /*
     ★★★ **헤지 모드는 `tradeSide` 가 필수다**(문서: "Only required in hedge-mode").
       진입 `open` · 청산 `close`.
  */
  it('헤지 모드에서 tradeSide 를 보낸다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, BASE, 'hedge');
    const open = JSON.parse(sent[0]!.body) as Record<string, string>;
    expect(open.tradeSide, '진입에 tradeSide 가 없다').toBe('open');

    const c = capture();
    await c.t.submitOrder(CRED, { ...BASE, reduceOnly: true }, 'hedge');
    const close = JSON.parse(c.sent[0]!.body) as Record<string, string>;
    expect(close.tradeSide, '청산에 tradeSide=close 가 없다').toBe('close');
  });

  /*
     ★★★ **헤지 모드에서 `reduceOnly` 를 보내지 않는다** — 문서: "Applicable only in
       one-way-position mode". 무시되므로 그것만 보내면 **청산이 반대 포지션을 연다.**
       이것이 이번에 찾은 가장 위험한 결함이다.
  */
  it('헤지 모드에서 reduceOnly 를 보내지 않는다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, { ...BASE, reduceOnly: true }, 'hedge');
    const body = JSON.parse(sent[0]!.body) as Record<string, string>;
    expect(body.reduceOnly, 'reduceOnly 를 보낸다 — 헤지에서 무시되어 반대 포지션이 열린다')
      .toBeUndefined();
  });

  /*
     ★★ **일방 모드는 반대다**: `tradeSide` 를 보내면 안 되고(문서: "Ignore the tradeSide
       parameter"), 청산은 `reduceOnly: 'YES'` 다.
  */
  it('일방 모드에서는 reduceOnly 를 쓰고 tradeSide 를 보내지 않는다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, { ...BASE, reduceOnly: true }, 'one_way');
    const body = JSON.parse(sent[0]!.body) as Record<string, string>;
    expect(body.reduceOnly).toBe('YES');
    expect(body.tradeSide, 'tradeSide 를 보낸다 — 일방 모드에서는 무시하라고 문서에 있다')
      .toBeUndefined();
  });

  /*
     ★★★ **보유 모드를 모르면 주문을 보내지 않는다.** 기본값을 정해 주면 그 기본값이
       틀렸을 때 청산이 반대 포지션을 연다. 추측할 수 있는 값이 아니다.
  */
  it('보유 모드를 모르면 주문을 보내지 않는다', async () => {
    const { t, sent } = capture();
    const r = await t.submitOrder(CRED, BASE, null);
    expect(r.status).toBe('REJECTED');
    expect(sent, '거래소를 불렀다').toHaveLength(0);
  });

  it('방향 변환을 한 곳에서만 한다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, { ...BASE, side: 'short' }, 'one_way');
    expect(JSON.parse(sent[0]!.body).side).toBe('sell');
  });

  /*
     ★ 익절·손절 필드 이름은 **문서로 확인했다**: `presetStopSurplusPrice` ·
       `presetStopLossPrice`. 이제 값을 보낸다.
     ★★ 다만 **실제로 걸리는지는 확인하지 못했다.** Bitget 은 모르는 필드를 조용히
       무시하므로, 되읽어 확인하는 경로가 생기기 전까지 **어댑터가 거부한다**
       (`bitget-trading-adapter.ts`). 여기서는 이름만 잠근다.
  */
  it('익절·손절 필드 이름이 문서와 같다', async () => {
    const { t, sent } = capture();
    await t.submitOrder(CRED, { ...BASE, takeProfitPrice: '20000', stopLossPrice: '9000' }, 'one_way');
    const body = JSON.parse(sent[0]!.body) as Record<string, string>;
    expect(body.presetStopSurplusPrice, '익절 필드 이름이 다르다').toBe('20000');
    expect(body.presetStopLossPrice, '손절 필드 이름이 다르다').toBe('9000');
  });

  it('스톱 주문은 여전히 거부한다', async () => {
    const { t, sent } = capture();
    const r = await t.submitOrder(CRED, { ...BASE, stopPrice: '9' }, 'one_way');
    expect(r.status).toBe('REJECTED');
    expect(sent, '거래소를 불렀다').toHaveLength(0);
  });

  it('전송 실패는 SUBMIT_UNKNOWN 이다', async () => {
    const t = new BitgetV2Trading({
      fetchImpl: (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
    });
    const r = await t.submitOrder(CRED, BASE, 'one_way');
    /* ★ 거절로 보면 재전송해 **두 번 들어간다.** */
    expect(r.status).toBe('SUBMIT_UNKNOWN');
  });

  it('취소 실패를 성공으로 만들지 않는다', async () => {
    const t = new BitgetV2Trading({
      fetchImpl: (async () => new Response(
        JSON.stringify({ code: '22001', msg: 'No order to cancel', requestTime: 1, data: null }),
        { status: 200 },
      )) as unknown as typeof fetch,
    });
    const r = await t.cancelOrder(CRED, 'BTCUSDT', 'x');
    expect(r.ok).toBe(false);
  });

  /*
     ★★★ **수정에 `newClientOid` 가 필수다**(문서). 빠뜨리면 "cannot be empty" 로 거절된다.
     ★★ 문서: 가격·수량 수정은 **옛 주문을 취소하고 새 주문을 만든다.** 그래서 새 열쇠가
       필요하다. 무작위로 만들면 어느 주문의 수정인지 되짚을 수 없어, 원래 열쇠를 접두사로 쓴다.
  */
  it('수정은 newClientOid 를 보내고 원래 열쇠를 되짚을 수 있다', async () => {
    const { t, sent } = capture();
    await t.modifyOrder(CRED, 'BTCUSDT', 'C', { price: '11000', quantity: '0.002' });
    const body = JSON.parse(sent[0]!.body) as Record<string, string>;
    expect(body.newClientOid, 'newClientOid 가 없다 — 거래소가 거절한다').toBeTruthy();
    expect(body.newClientOid, '원래 열쇠를 되짚을 수 없다').toContain('C');
    /* ★ v2 는 `newSize`, v3 는 `newQty` 다. */
    expect(body.newPrice).toBe('11000');
    expect(body.newSize, 'newSize 가 없다 — v2 이름이다').toBe('0.002');
    expect(body.newQty, 'newQty 를 보낸다 — v3 이름이다').toBeUndefined();
  });
});
