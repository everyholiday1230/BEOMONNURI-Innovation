/**
 * 심볼 / 타임프레임 매핑 검증.
 * 기대값은 2026-08-04 KuCoin contracts/active (679건) 실측 조회에 근거한다.
 */

import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_TIMEFRAMES,
  UNSUPPORTED_SYMBOLS,
  UNSUPPORTED_TIMEFRAMES,
  fromWsCandleSuffix,
  toGranularity,
  toInternalSymbol,
  toKucoinSymbol,
  toWsCandleSuffix,
} from '../symbols.js';

describe('심볼 매핑', () => {
  it('BTC 는 KuCoin 에서 XBT 표기를 쓴다', () => {
    expect(toKucoinSymbol('BTCUSDT')).toBe('XBTUSDTM');
    expect(toInternalSymbol('XBTUSDTM')).toBe('BTCUSDT');
  });

  it('MATIC 은 POL 로 리브랜딩되어 POLUSDTM 에 매핑된다', () => {
    expect(toKucoinSymbol('MATICUSDT')).toBe('POLUSDTM');
    expect(toInternalSymbol('POLUSDTM')).toBe('MATICUSDT');
  });

  it('일반 심볼은 <BASE>USDTM 규칙을 따른다', () => {
    const cases: Record<string, string> = {
      ETHUSDT: 'ETHUSDTM',
      SOLUSDT: 'SOLUSDTM',
      BNBUSDT: 'BNBUSDTM',
      XRPUSDT: 'XRPUSDTM',
      DOGEUSDT: 'DOGEUSDTM',
      AVAXUSDT: 'AVAXUSDTM',
      LINKUSDT: 'LINKUSDTM',
      ARBUSDT: 'ARBUSDTM',
      OPUSDT: 'OPUSDTM',
      ATOMUSDT: 'ATOMUSDTM',
      DOTUSDT: 'DOTUSDTM',
      ADAUSDT: 'ADAUSDTM',
      NEARUSDT: 'NEARUSDTM',
      INJUSDT: 'INJUSDTM',
      APTUSDT: 'APTUSDTM',
      SUIUSDT: 'SUIUSDTM',
      FILUSDT: 'FILUSDTM',
      LTCUSDT: 'LTCUSDTM',
    };
    for (const [internal, kucoin] of Object.entries(cases)) {
      expect(toKucoinSymbol(internal)).toBe(kucoin);
      expect(toInternalSymbol(kucoin)).toBe(internal);
    }
  });

  it('디자이너 마켓 목록 21개 중 20개가 왕복 변환 항등이다', () => {
    const designerSymbols = [
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
      'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'ARBUSDT', 'OPUSDT', 'ATOMUSDT',
      'DOTUSDT', 'ADAUSDT', 'NEARUSDT', 'INJUSDT', 'APTUSDT', 'SUIUSDT',
      'FILUSDT', 'LTCUSDT',
    ];
    for (const s of designerSymbols) {
      const k = toKucoinSymbol(s);
      expect(k, `${s} 매핑 실패`).not.toBeNull();
      expect(toInternalSymbol(k!)).toBe(s);
    }
    // 21번째인 TON 은 미상장이다.
    expect(toKucoinSymbol('TONUSDT')).toBeNull();
  });

  it('TON 은 KuCoin 선물 미상장으로 표시된다', () => {
    expect(UNSUPPORTED_SYMBOLS.has('TONUSDT')).toBe(true);
  });

  it('USDT 마켓이 아니거나 base 가 비면 null', () => {
    for (const bad of ['BTCUSD', 'BTCBUSD', '', 'USDT']) {
      expect(toKucoinSymbol(bad)).toBeNull();
    }
    for (const bad of ['XBTUSDT', 'USDTM', '']) {
      expect(toInternalSymbol(bad)).toBeNull();
    }
  });
});

describe('타임프레임 매핑', () => {
  it('KuCoin granularity(분) 로 변환한다', () => {
    expect(toGranularity('1m')).toBe(1);
    expect(toGranularity('5m')).toBe(5);
    expect(toGranularity('15m')).toBe(15);
    expect(toGranularity('30m')).toBe(30);
    expect(toGranularity('1h')).toBe(60);
    expect(toGranularity('2h')).toBe(120);
    expect(toGranularity('4h')).toBe(240);
    expect(toGranularity('1d')).toBe(1440);
    expect(toGranularity('1w')).toBe(10080);
  });

  /*
     ★★★ **`3m` 은 KuCoin 에 있다.** 이 시험은 사실이 아닌 것을 잠그고 있었다.

       2026-09-18 실측: `GET /api/v1/kline/query?granularity=3` 이 봉 200개를 돌려준다.
       주석에 "KuCoin 에 없다" 고 적혀 있었지만 확인해 보니 있었다 —
       **못 하는 것과 안 만든 것은 다르다.**

     ★ 대신 `6h`(360) 가 실제로 없다: `Unsupported granularity` 를 돌려준다.
       그것을 이 시험이 지킨다 — 가까운 주기(4h·8h)로 대체하면 **맞아 보이는데 틀린
       차트**를 주게 된다.
  */
  it("'6h' 는 KuCoin 선물에 없으므로 null 이다 — 4h·8h 로 대체하지 않는다", () => {
    expect(toGranularity('6h')).toBeNull();
    expect(UNSUPPORTED_TIMEFRAMES.has('6h')).toBe(true);
    expect(SUPPORTED_TIMEFRAMES).not.toContain('6h');
  });

  it("'3m' 은 지원된다 — 실제 API 로 확인했다", () => {
    expect(toGranularity('3m')).toBe(3);
    expect(UNSUPPORTED_TIMEFRAMES.has('3m')).toBe(false);
  });

  it('새로 넣은 주기가 확인된 granularity 와 같다', () => {
    /* 실측값: 480(8h) · 720(12h) · 43200(1M) */
    expect(toGranularity('8h')).toBe(480);
    expect(toGranularity('12h')).toBe(720);
    expect(toGranularity('1M')).toBe(43200);
  });

  it('WS 캔들 채널 접미사를 왕복 변환한다', () => {
    const pairs: Array<[Parameters<typeof toGranularity>[0], string]> = [
      ['1m', '1min'],
      ['5m', '5min'],
      ['15m', '15min'],
      ['30m', '30min'],
      ['1h', '1hour'],
      ['2h', '2hour'],
      ['4h', '4hour'],
      ['1d', '1day'],
      ['1w', '1week'],
    ];
    for (const [tf, suffix] of pairs) {
      expect(toWsCandleSuffix(tf)).toBe(suffix);
      expect(fromWsCandleSuffix(suffix)).toBe(tf);
    }
    expect(toWsCandleSuffix('3m')).toBeNull();
    expect(fromWsCandleSuffix('7min')).toBeNull();
  });

  it('디자이너 차트 툴바의 7개 타임프레임을 모두 지원한다', () => {
    // app.jsx ChartWidget 은 1m/5m/15m/30m/1H/4H/1D 를 노출한다.
    // 프론트 표기는 대문자이고 내부 Timeframe 은 소문자다.
    const frontToInternal: Record<string, Parameters<typeof toGranularity>[0]> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1H': '1h',
      '4H': '4h',
      '1D': '1d',
    };
    for (const [front, internal] of Object.entries(frontToInternal)) {
      expect(toGranularity(internal), `${front} 미지원`).toBeGreaterThan(0);
      expect(toWsCandleSuffix(internal)).toBeTruthy();
    }
  });
});
