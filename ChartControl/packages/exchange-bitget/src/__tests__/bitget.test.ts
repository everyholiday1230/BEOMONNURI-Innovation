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
