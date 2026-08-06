/**
 * KuCoin 공개 WebSocket 업스트림 매니저.
 *
 * 담당:
 *  - bullet-public 으로 접속 토큰 발급 (POST. GET 은 405)
 *  - instanceServers[0].pingInterval 에 맞춘 ping (기본 18초, 미응답 시 KuCoin 이 끊는다)
 *  - 지수 백오프 재연결 + 재연결 후 구독 자동 복원
 *  - 구독 참조 카운팅. 여러 브라우저가 같은 심볼을 봐도 업스트림은 1개만 유지
 *
 * 이 클래스는 KuCoin 프로토콜만 안다. 정규화는 호출자가 adapter.js 로 한다.
 */

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

import { log } from '../../log.js';
import { createPublicBullet } from './rest.js';

const CONNECTING = 'connecting';
const OPEN = 'open';
const CLOSED = 'closed';

export class KucoinWsManager extends EventEmitter {
  constructor() {
    super();
    /** @type {WebSocket|null} */
    this.ws = null;
    this.state = CLOSED;
    /** topic -> 참조 수 */
    this.subscriptions = new Map();
    /** 서버가 ack 한 topic 집합 */
    this.acked = new Set();
    this.reconnectAttempts = 0;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.pongDeadline = null;
    this.requestSeq = 0;
    this.stopped = false;
    this.lastMessageAt = 0;
    this.connectedAt = null;
  }

  // -------------------------------------------------------------------------
  // 수명주기
  // -------------------------------------------------------------------------

  async start() {
    this.stopped = false;
    await this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      // 핸드셰이크 중(CONNECTING)에 close() 를 부르면 ws 라이브러리가 비동기로
      // 'error' 를 emit 한다. 리스너를 먼저 전부 떼면 EventEmitter 가 그 error 를
      // 던져 프로세스가 죽는다. 그래서 no-op error 리스너를 남기고,
      // CONNECTING 상태에서는 terminate() 로 즉시 끊는다.
      ws.removeAllListeners();
      ws.on('error', () => {});
      try {
        if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
        else ws.close();
      } catch {
        /* 이미 닫힘 */
      }
    }
    this.state = CLOSED;
    this.acked.clear();
  }

  clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  async connect() {
    if (this.stopped) return;
    if (this.state === CONNECTING || this.state === OPEN) return;

    this.state = CONNECTING;
    this.emit('state', { state: 'connecting' });

    let bullet;
    try {
      bullet = await createPublicBullet();
    } catch (err) {
      log.warn('KuCoin bullet-public 발급 실패', { error: String(err?.message || err) });
      this.state = CLOSED;
      this.scheduleReconnect();
      return;
    }

    const server = bullet?.instanceServers?.[0];
    if (!server?.endpoint || !bullet?.token) {
      log.warn('KuCoin bullet-public 응답 형식 이상', { hasToken: Boolean(bullet?.token) });
      this.state = CLOSED;
      this.scheduleReconnect();
      return;
    }

    // connectId 는 KuCoin 이 ack 매칭에 쓴다. 접속마다 유일해야 한다.
    const connectId = `qt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const url = `${server.endpoint}?token=${encodeURIComponent(bullet.token)}&connectId=${connectId}`;
    const pingInterval = Math.max(5000, Number(server.pingInterval) || 18000);
    const pingTimeout = Math.max(5000, Number(server.pingTimeout) || 10000);

    const ws = new WebSocket(url, { handshakeTimeout: 15000 });
    this.ws = ws;

    ws.on('open', () => {
      // KuCoin 은 접속 직후 {type:'welcome'} 을 보낸다. 그때 OPEN 처리한다.
      log.debug('KuCoin WS 소켓 열림');
    });

    ws.on('message', (buf) => {
      this.lastMessageAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      this.handleMessage(msg, { pingInterval, pingTimeout });
    });

    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return; // 이미 교체된 소켓
      log.warn('KuCoin WS 종료', { code, reason: reason?.toString()?.slice(0, 120) });
      this.state = CLOSED;
      this.acked.clear();
      this.clearTimers();
      this.emit('state', { state: 'lost' });
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      if (this.ws !== ws) return;
      log.warn('KuCoin WS 오류', { error: String(err?.message || err) });
    });
  }

  handleMessage(msg, timings) {
    switch (msg.type) {
      case 'welcome':
        this.state = OPEN;
        this.reconnectAttempts = 0;
        this.connectedAt = Date.now();
        log.info('KuCoin WS 연결됨', { subscriptions: this.subscriptions.size });
        this.startPing(timings);
        this.resubscribeAll();
        this.emit('state', { state: 'live' });
        break;

      case 'pong':
        this.pongDeadline = null;
        break;

      case 'ack':
        // 구독 확인. topic 은 ack 에 안 실려오므로 id 로 추적한 것을 신뢰한다.
        break;

      case 'message':
        if (msg.topic) {
          this.acked.add(msg.topic);
          this.emit('data', { topic: msg.topic, subject: msg.subject, data: msg.data });
        }
        break;

      case 'error':
        log.warn('KuCoin WS 프로토콜 오류', { code: msg.code, data: String(msg.data).slice(0, 200) });
        this.emit('upstreamError', msg);
        break;

      default:
        break;
    }
  }

  startPing({ pingInterval, pingTimeout }) {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.state !== OPEN || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // 이전 ping 에 pong 이 오지 않았으면 죽은 연결로 판단하고 강제 재연결.
      if (this.pongDeadline && Date.now() > this.pongDeadline) {
        log.warn('KuCoin WS pong 미수신 — 강제 재연결');
        try {
          this.ws.terminate();
        } catch {
          /* noop */
        }
        return;
      }

      this.pongDeadline = Date.now() + pingTimeout;
      this.send({ id: this.nextId(), type: 'ping' });
    }, pingInterval);
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    // 1s, 2s, 4s, 8s, 16s, 30s 상한 + 지터
    const base = Math.min(30000, 1000 * 2 ** (this.reconnectAttempts - 1));
    const delay = base + Math.random() * 500;
    this.emit('state', { state: 'reconnecting', attempt: this.reconnectAttempts });
    log.info('KuCoin WS 재연결 예약', { attempt: this.reconnectAttempts, delayMs: Math.round(delay) });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) =>
        log.warn('KuCoin WS 재연결 실패', { error: String(err?.message || err) }),
      );
    }, delay);
  }

  nextId() {
    this.requestSeq += 1;
    return `qt${this.requestSeq}`;
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      log.warn('KuCoin WS 전송 실패', { error: String(err?.message || err) });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 구독 (참조 카운팅)
  // -------------------------------------------------------------------------

  /**
   * topic 구독. 이미 구독 중이면 참조 수만 올린다.
   * @returns {function} 해제 함수
   */
  subscribe(topic) {
    const count = this.subscriptions.get(topic) || 0;
    this.subscriptions.set(topic, count + 1);

    if (count === 0 && this.state === OPEN) {
      this.send({ id: this.nextId(), type: 'subscribe', topic, response: true });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.unsubscribe(topic);
    };
  }

  unsubscribe(topic) {
    const count = this.subscriptions.get(topic) || 0;
    if (count <= 1) {
      this.subscriptions.delete(topic);
      this.acked.delete(topic);
      if (this.state === OPEN) {
        this.send({ id: this.nextId(), type: 'unsubscribe', topic, response: true });
      }
    } else {
      this.subscriptions.set(topic, count - 1);
    }
  }

  resubscribeAll() {
    for (const topic of this.subscriptions.keys()) {
      this.send({ id: this.nextId(), type: 'subscribe', topic, response: true });
    }
  }

  getStatus() {
    return {
      state: this.state,
      topics: this.subscriptions.size,
      ackedTopics: this.acked.size,
      reconnectAttempts: this.reconnectAttempts,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt || null,
      // 마지막 메시지 이후 경과 시간. 스톨 감지 지표.
      staleMs: this.lastMessageAt ? Date.now() - this.lastMessageAt : null,
    };
  }
}

// ---------------------------------------------------------------------------
// 토픽 생성기
// ---------------------------------------------------------------------------

export const topics = {
  ticker: (s) => `/contractMarket/ticker:${s}`,
  depth5: (s) => `/contractMarket/level2Depth5:${s}`,
  depth50: (s) => `/contractMarket/level2Depth50:${s}`,
  execution: (s) => `/contractMarket/execution:${s}`,
  candle: (s, suffix) => `/contractMarket/limitCandle:${s}_${suffix}`,
};

/** 토픽 문자열에서 KuCoin 심볼을 추출한다. */
export function symbolFromTopic(topic) {
  const raw = String(topic || '').split(':')[1] || '';
  // limitCandle 은 'XBTUSDTM_1min' 형태
  return raw.split('_')[0] || null;
}
