/**
 * KuCoin 선물 WebSocket 프로토콜 — 순수 함수만.
 *
 * 소켓 연결과 분리한 이유: 프로토콜 조립/해석은 네트워크 없이 전부 단위 테스트할 수
 * 있어야 한다. 실제 연결이 필요한 부분은 ws-client.ts 가 담당하고, 그쪽은 소켓
 * 팩토리를 주입받아 가짜 소켓으로 테스트한다.
 *
 * ══ 실측 사실 (2026-08-04) ═══════════════════════════════════════
 *  - 접속 토큰은 POST /api/v1/bullet-public 으로 받는다 (GET 은 405)
 *  - 접속 URL: <endpoint>?token=<token>&connectId=<unique>
 *  - 서버가 먼저 {type:'welcome'} 을 보낸다. 그 시점부터 구독 가능.
 *  - pingInterval 기본 18000ms. 무응답이면 KuCoin 이 끊는다.
 *  - 채널 4종에서 실데이터 수신 확인:
 *      /contractMarket/ticker:<SYM>
 *      /contractMarket/level2Depth5:<SYM>
 *      /contractMarket/execution:<SYM>
 *      /contractMarket/limitCandle:<SYM>_<1min|5min|...>
 * ═══════════════════════════════════════════════════════════════
 */

import type { Timeframe } from '@quantumtrade/config';

import { toWsCandleSuffix, fromWsCandleSuffix } from './symbols.js';

const PREFIX = '/contractMarket/';

// ---------------------------------------------------------------------------
// 토픽 조립
// ---------------------------------------------------------------------------

export function tickerTopic(kucoinSymbol: string): string {
  return `${PREFIX}ticker:${kucoinSymbol}`;
}

/** 호가 5단. 위젯이 18행을 쓰지만 depth5 가 가장 자주 갱신된다. */
export function depth5Topic(kucoinSymbol: string): string {
  return `${PREFIX}level2Depth5:${kucoinSymbol}`;
}

export function depth50Topic(kucoinSymbol: string): string {
  return `${PREFIX}level2Depth50:${kucoinSymbol}`;
}

/** 체결. KuCoin 은 'execution' 이라 부른다 (다른 거래소의 'trade'). */
export function executionTopic(kucoinSymbol: string): string {
  return `${PREFIX}execution:${kucoinSymbol}`;
}

/** 캔들. 지원하지 않는 타임프레임이면 null. */
export function candleTopic(kucoinSymbol: string, timeframe: Timeframe): string | null {
  const suffix = toWsCandleSuffix(timeframe);
  return suffix === null ? null : `${PREFIX}limitCandle:${kucoinSymbol}_${suffix}`;
}

// ---------------------------------------------------------------------------
// 프레임 조립
// ---------------------------------------------------------------------------

export function subscribeFrame(id: string, topic: string): string {
  return JSON.stringify({ id, type: 'subscribe', topic, response: true });
}

export function unsubscribeFrame(id: string, topic: string): string {
  return JSON.stringify({ id, type: 'unsubscribe', topic, response: true });
}

export function pingFrame(id: string): string {
  return JSON.stringify({ id, type: 'ping' });
}

/** 접속 URL 조립. connectId 는 접속마다 유일해야 한다 (KuCoin 이 ack 매칭에 쓴다). */
export function buildConnectUrl(endpoint: string, token: string, connectId: string): string {
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${sep}token=${encodeURIComponent(token)}&connectId=${encodeURIComponent(connectId)}`;
}

/**
 * 접속 URL 이 안전한지 검사한다.
 *
 * fail-closed 로 만든 이유: 평문 ws:// 로 붙으면 시세가 중간에서 조작될 수 있고,
 * 트레이딩 화면에서 조작된 가격은 곧 사용자 손실이다. 그래서 검증 실패 시
 * 연결을 시도하지 않고 예외를 던진다.
 */
export const KUCOIN_WS_HOSTS = ['ws-api-futures.kucoin.com', 'ws-api-spot.kucoin.com'] as const;

export function assertSecureWsEndpoint(endpoint: string, allowedHosts: readonly string[] = KUCOIN_WS_HOSTS): string {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new Error(`KuCoin WS endpoint 형식 오류 (fail-closed): ${endpoint}`);
  }
  if (u.protocol !== 'wss:') {
    throw new Error(`KuCoin WS 는 wss:// 여야 한다 (fail-closed): ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new Error(`허용되지 않은 KuCoin WS 호스트 (fail-closed): ${host}`);
  }
  return endpoint;
}

// ---------------------------------------------------------------------------
// 프레임 해석
// ---------------------------------------------------------------------------

export type KucoinFrame =
  | { kind: 'welcome' }
  | { kind: 'pong' }
  | { kind: 'ack'; id: string }
  | { kind: 'error'; code?: string; message: string }
  | {
      kind: 'data';
      topic: string;
      channel: string;
      /** KuCoin 심볼 (XBTUSDTM) */
      exchangeSymbol: string;
      /** limitCandle 인 경우에만 채워진다 */
      timeframe: Timeframe | null;
      data: unknown;
    }
  | { kind: 'unknown'; raw: string };

/**
 * 수신 프레임을 해석한다. 절대 예외를 던지지 않는다 — 한 프레임이 깨졌다고
 * 스트림 전체가 죽으면 안 되기 때문. 해석 불가는 'unknown' 으로 돌려준다.
 */
export function parseFrame(raw: string): KucoinFrame {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { kind: 'unknown', raw: raw.slice(0, 200) };
  }

  const type = typeof msg.type === 'string' ? msg.type : '';

  switch (type) {
    case 'welcome':
      return { kind: 'welcome' };
    case 'pong':
      return { kind: 'pong' };
    case 'ack':
      return { kind: 'ack', id: typeof msg.id === 'string' ? msg.id : '' };
    case 'error':
      return {
        kind: 'error',
        code: msg.code === undefined ? undefined : String(msg.code),
        message: typeof msg.data === 'string' ? msg.data : String(msg.data ?? 'unknown error'),
      };
    case 'message': {
      const topic = typeof msg.topic === 'string' ? msg.topic : '';
      const parsed = parseTopic(topic);
      if (!parsed) return { kind: 'unknown', raw: raw.slice(0, 200) };
      return {
        kind: 'data',
        topic,
        channel: parsed.channel,
        exchangeSymbol: parsed.exchangeSymbol,
        timeframe: parsed.timeframe,
        data: msg.data,
      };
    }
    default:
      return { kind: 'unknown', raw: raw.slice(0, 200) };
  }
}

export interface ParsedTopic {
  channel: string;
  exchangeSymbol: string;
  timeframe: Timeframe | null;
}

/**
 * 토픽에서 채널/심볼/타임프레임을 뽑는다.
 * 예: '/contractMarket/limitCandle:XBTUSDTM_1min'
 *      -> { channel:'limitCandle', exchangeSymbol:'XBTUSDTM', timeframe:'1m' }
 */
/*
   현물 토픽 접두어.

   ★★ 이것을 넣지 않으면 현물 프레임이 전부 `unknown` 으로 버려진다.

     연결도 되고 ack 도 오고 KuCoin 은 데이터를 계속 보내는데, 파서가 접두어를
     모르면 조용히 전부 버린다. 화면은 "실시간 연결됨" 을 표시하면서 값이 갱신되지
     않는다 — 실제로 그 상태를 겪었다(어댑터 수신 0건).

   ★ 호가만 `/spotMarket/` 이다(KuCoin 이 그렇게 나눠 두었다).
*/
const SPOT_PREFIXES = ['/market/', '/spotMarket/'] as const;

export function parseTopic(topic: string): ParsedTopic | null {
  const prefix = topic.startsWith(PREFIX)
    ? PREFIX
    : SPOT_PREFIXES.find((p) => topic.startsWith(p));
  if (!prefix) return null;
  const rest = topic.slice(prefix.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;

  const channel = rest.slice(0, colon);
  const target = rest.slice(colon + 1);
  if (!channel || !target) return null;

  const underscore = target.indexOf('_');
  if (underscore < 0) {
    return { channel, exchangeSymbol: target, timeframe: null };
  }

  const exchangeSymbol = target.slice(0, underscore);
  const suffix = target.slice(underscore + 1);
  if (!exchangeSymbol) return null;

  return { channel, exchangeSymbol, timeframe: fromWsCandleSuffix(suffix) };
}
