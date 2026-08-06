/**
 * WebSocket 프로토콜 검증 — 순수 함수만이라 네트워크가 필요 없다.
 *
 * 픽스처는 2026-08-04 KuCoin 실수신 프레임에서 그대로 따왔다.
 */

import { describe, expect, it } from 'vitest';

import {
  KUCOIN_WS_HOSTS,
  assertSecureWsEndpoint,
  buildConnectUrl,
  candleTopic,
  depth5Topic,
  executionTopic,
  parseFrame,
  parseTopic,
  pingFrame,
  subscribeFrame,
  tickerTopic,
  unsubscribeFrame,
} from '../ws-protocol.js';

describe('토픽 조립', () => {
  it('실측 확인된 4개 채널 형식을 만든다', () => {
    expect(tickerTopic('XBTUSDTM')).toBe('/contractMarket/ticker:XBTUSDTM');
    expect(depth5Topic('XBTUSDTM')).toBe('/contractMarket/level2Depth5:XBTUSDTM');
    expect(executionTopic('XBTUSDTM')).toBe('/contractMarket/execution:XBTUSDTM');
    expect(candleTopic('XBTUSDTM', '1m')).toBe('/contractMarket/limitCandle:XBTUSDTM_1min');
    expect(candleTopic('XBTUSDTM', '1h')).toBe('/contractMarket/limitCandle:XBTUSDTM_1hour');
  });

  it('지원하지 않는 타임프레임은 토픽을 만들지 않는다', () => {
    expect(candleTopic('XBTUSDTM', '3m')).toBeNull();
  });
});

describe('프레임 조립', () => {
  it('subscribe / unsubscribe / ping 프레임', () => {
    expect(JSON.parse(subscribeFrame('qt1', '/contractMarket/ticker:XBTUSDTM'))).toEqual({
      id: 'qt1',
      type: 'subscribe',
      topic: '/contractMarket/ticker:XBTUSDTM',
      response: true,
    });
    expect(JSON.parse(unsubscribeFrame('qt2', '/x'))).toEqual({
      id: 'qt2',
      type: 'unsubscribe',
      topic: '/x',
      response: true,
    });
    expect(JSON.parse(pingFrame('qt3'))).toEqual({ id: 'qt3', type: 'ping' });
  });

  it('접속 URL 에 token 과 connectId 를 붙인다', () => {
    const url = buildConnectUrl('wss://ws-api-futures.kucoin.com/', 'tok+en/=', 'cid-1');
    expect(url).toContain('token=tok%2Ben%2F%3D'); // URL 인코딩
    expect(url).toContain('connectId=cid-1');
    expect(url.startsWith('wss://ws-api-futures.kucoin.com/?')).toBe(true);
  });

  it('endpoint 에 이미 쿼리가 있으면 & 로 이어붙인다', () => {
    const url = buildConnectUrl('wss://ws-api-futures.kucoin.com/?protocol=1.1', 't', 'c');
    expect(url).toBe('wss://ws-api-futures.kucoin.com/?protocol=1.1&token=t&connectId=c');
  });
});

describe('WS endpoint 보안 검증 (fail-closed)', () => {
  it('공식 wss 호스트는 통과한다', () => {
    for (const host of KUCOIN_WS_HOSTS) {
      expect(assertSecureWsEndpoint(`wss://${host}/`)).toBeTruthy();
    }
  });

  it('평문 ws:// 는 거부한다 — 조작된 시세로 주문하는 것을 막는다', () => {
    expect(() => assertSecureWsEndpoint('ws://ws-api-futures.kucoin.com/')).toThrow(/wss/);
  });

  it('허용되지 않은 호스트는 거부한다', () => {
    expect(() => assertSecureWsEndpoint('wss://evil.example.com/')).toThrow(/호스트/);
    // 접미사만 같은 유사 도메인도 거부해야 한다.
    expect(() => assertSecureWsEndpoint('wss://kucoin.com.evil.io/')).toThrow(/호스트/);
  });

  it('서브도메인은 허용한다', () => {
    expect(assertSecureWsEndpoint('wss://a.ws-api-futures.kucoin.com/')).toBeTruthy();
  });

  it('형식이 깨진 URL 은 거부한다', () => {
    expect(() => assertSecureWsEndpoint('not-a-url')).toThrow(/형식/);
  });
});

describe('토픽 해석', () => {
  it('채널과 심볼을 분리한다', () => {
    expect(parseTopic('/contractMarket/ticker:XBTUSDTM')).toEqual({
      channel: 'ticker',
      exchangeSymbol: 'XBTUSDTM',
      timeframe: null,
    });
  });

  it('캔들 토픽에서 타임프레임을 복원한다', () => {
    expect(parseTopic('/contractMarket/limitCandle:XBTUSDTM_1min')).toEqual({
      channel: 'limitCandle',
      exchangeSymbol: 'XBTUSDTM',
      timeframe: '1m',
    });
    expect(parseTopic('/contractMarket/limitCandle:ETHUSDTM_4hour')?.timeframe).toBe('4h');
  });

  it('형식이 다른 토픽은 null', () => {
    expect(parseTopic('/other/ticker:X')).toBeNull();
    expect(parseTopic('/contractMarket/ticker')).toBeNull();
    expect(parseTopic('/contractMarket/:X')).toBeNull();
    expect(parseTopic('')).toBeNull();
  });
});

describe('프레임 해석', () => {
  it('welcome / pong / ack', () => {
    expect(parseFrame('{"id":"x","type":"welcome"}')).toEqual({ kind: 'welcome' });
    expect(parseFrame('{"id":"x","type":"pong"}')).toEqual({ kind: 'pong' });
    expect(parseFrame('{"id":"qt7","type":"ack"}')).toEqual({ kind: 'ack', id: 'qt7' });
  });

  it('실수신 ticker 데이터 프레임을 해석한다', () => {
    const raw = JSON.stringify({
      type: 'message',
      topic: '/contractMarket/ticker:XBTUSDTM',
      subject: 'ticker',
      data: { symbol: 'XBTUSDTM', price: '63738.3', bestBidPrice: '63738.2', ts: 1785841061462000000 },
    });
    const frame = parseFrame(raw);
    expect(frame.kind).toBe('data');
    if (frame.kind !== 'data') throw new Error('unreachable');
    expect(frame.channel).toBe('ticker');
    expect(frame.exchangeSymbol).toBe('XBTUSDTM');
    expect(frame.timeframe).toBeNull();
  });

  it('실수신 limitCandle 프레임에서 타임프레임을 뽑는다', () => {
    const raw = JSON.stringify({
      type: 'message',
      topic: '/contractMarket/limitCandle:XBTUSDTM_1min',
      data: { symbol: 'XBTUSDTM', candles: ['1785841020', '63750.1', '63738.3', '63753.2', '63738.3', '219934.1091', '3450'] },
    });
    const frame = parseFrame(raw);
    if (frame.kind !== 'data') throw new Error('expected data frame');
    expect(frame.channel).toBe('limitCandle');
    expect(frame.timeframe).toBe('1m');
  });

  it('error 프레임을 해석한다', () => {
    const frame = parseFrame('{"id":"1","type":"error","code":404,"data":"topic not found"}');
    expect(frame).toEqual({ kind: 'error', code: '404', message: 'topic not found' });
  });

  it('깨진 프레임에도 예외를 던지지 않는다 — 한 프레임이 스트림을 죽이면 안 된다', () => {
    expect(parseFrame('not json').kind).toBe('unknown');
    expect(parseFrame('').kind).toBe('unknown');
    expect(parseFrame('{"type":"weird"}').kind).toBe('unknown');
    expect(parseFrame('{"type":"message","topic":"/bad"}').kind).toBe('unknown');
  });
});
