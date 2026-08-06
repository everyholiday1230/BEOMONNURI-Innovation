/**
 * KuCoin 선물 WebSocket 클라이언트.
 *
 * 담당:
 *  - bullet-public 토큰 발급 → 접속 (토큰은 만료되므로 재연결마다 새로 받는다)
 *  - pingInterval 에 맞춘 ping, pong 미수신 시 강제 재연결
 *  - 지수 백오프 재연결 + 재연결 후 구독 자동 복원
 *  - 구독 참조 카운팅 (여러 소비자가 같은 심볼을 봐도 업스트림은 1개)
 *
 * 소켓은 팩토리로 주입받는다. 테스트에서 가짜 소켓을 넣어 재연결·ping·복원
 * 동작을 네트워크 없이 검증할 수 있어야 하기 때문이다.
 */

import { backoffMs } from '@quantumtrade/exchange-adapters';
import { DEFAULT_KUCOIN_RATE_LIMIT } from './rest.js';
import type { KucoinFuturesRest } from './rest.js';
import { assertSecureWsEndpoint, buildConnectUrl, parseFrame, pingFrame, subscribeFrame, unsubscribeFrame, type KucoinFrame } from './ws-protocol.js';

/** 소켓 추상화. ws 패키지와 브라우저 WebSocket 양쪽에 맞춘 최소 표면. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** 핸드셰이크 중에도 즉시 끊어야 할 때. ws 패키지의 terminate. 없으면 close 로 대체. */
  terminate?(): void;
  readonly readyState: number;
}

export interface SocketHandlers {
  onOpen(): void;
  onMessage(raw: string): void;
  onClose(code: number, reason: string): void;
  onError(err: Error): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketLike;

export const SOCKET_CONNECTING = 0;
export const SOCKET_OPEN = 1;

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'lost';

export interface KucoinWsEvents {
  /** 데이터 프레임. 정규화는 호출자가 한다. */
  onData(frame: Extract<KucoinFrame, { kind: 'data' }>): void;
  /** 연결 상태 변화. 사용자에게 '실시간 여부'를 정직하게 보여주기 위해 필수. */
  onState(state: ConnectionState, detail?: { attempt?: number; reason?: string }): void;
  /** KuCoin 프로토콜 오류 (구독 실패 등). */
  onUpstreamError?(code: string | undefined, message: string): void;
}

export interface KucoinWsClientConfig {
  rest: Pick<KucoinFuturesRest, 'createPublicBullet'>;
  socketFactory: SocketFactory;
  events: KucoinWsEvents;
  /** 허용 WS 호스트 재정의 (테스트용). */
  allowedHosts?: readonly string[];
  /** ping 주기 상한. KuCoin 이 알려준 값보다 크게 잡지 않는다. */
  maxPingIntervalMs?: number;
  /** 테스트에서 타이머를 제어하기 위한 주입점. */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  nowImpl?: () => number;
  /** connectId 생성기 (테스트 고정용). */
  connectIdImpl?: () => string;
}

export class KucoinWsClient {
  private socket: SocketLike | null = null;
  private state: ConnectionState = 'idle';
  private stopped = true;
  private reconnectAttempts = 0;

  /** topic -> 참조 수 */
  private readonly subscriptions = new Map<string, number>();
  /** 서버가 데이터를 보내온 topic (실제로 살아있는 구독) */
  private readonly activeTopics = new Set<string>();

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pongDeadline: number | null = null;
  private requestSeq = 0;
  private lastMessageAt = 0;
  /**
   * 마지막으로 실제 시세 데이터를 받은 시각.
   *
   * lastMessageAt 과 분리하는 이유: pong 도 메시지라서 lastMessageAt 을 갱신한다.
   * 연결은 살아 있는데 구독만 조용히 죽은 경우(업스트림이 토픽을 끊었지만 소켓은 유지)
   * lastMessageAt 만 보면 "정상"으로 보인다. 그 상태로 주문을 허용하면 오래된
   * 가격으로 체결된다. 데이터 흐름은 따로 세야 한다.
   */
  private lastDataAt = 0;
  private connectedAt: number | null = null;

  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly now: () => number;
  private readonly makeConnectId: () => string;

  constructor(private readonly cfg: KucoinWsClientConfig) {
    this.setTimeoutFn = cfg.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutFn = cfg.clearTimeoutImpl ?? clearTimeout;
    this.setIntervalFn = cfg.setIntervalImpl ?? setInterval;
    this.clearIntervalFn = cfg.clearIntervalImpl ?? clearInterval;
    this.now = cfg.nowImpl ?? Date.now;
    this.makeConnectId =
      cfg.connectIdImpl ?? (() => `qt-${this.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  // -------------------------------------------------------------------------
  // 수명주기
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.detachSocket('client stop');
    this.activeTopics.clear();
    this.setState('idle');
  }

  getStatus() {
    return {
      state: this.state,
      topics: this.subscriptions.size,
      activeTopics: this.activeTopics.size,
      reconnectAttempts: this.reconnectAttempts,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt || null,
      /** 마지막 수신 이후 경과. 스트림 정지(stall) 감지 지표. pong 도 포함된다. */
      staleMs: this.lastMessageAt ? this.now() - this.lastMessageAt : null,
      lastDataAt: this.lastDataAt || null,
      /**
       * 마지막 실데이터 이후 경과. 구독이 있는데 이 값이 커지면 시세가 멈춘 것이다.
       * null = 아직 한 건도 못 받음 (0 으로 오해하면 안 된다).
       */
      dataStaleMs: this.lastDataAt ? this.now() - this.lastDataAt : null,
    };
  }

  private setState(next: ConnectionState, detail?: { attempt?: number; reason?: string }): void {
    if (this.state === next && !detail) return;
    this.state = next;
    this.cfg.events.onState(next, detail);
  }

  private detachSocket(reason: string): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      // 핸드셰이크 중(CONNECTING)에 close() 를 부르면 ws 라이브러리가 비동기로
      // error 를 emit 한다. 그래서 그 상태에서는 terminate 로 즉시 끊는다.
      if (socket.readyState === SOCKET_CONNECTING && socket.terminate) socket.terminate();
      else socket.close(1000, reason);
    } catch {
      /* 이미 닫힘 */
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    if (this.state === 'connecting' || this.state === 'live') return;

    this.setState('connecting');

    let bullet: Awaited<ReturnType<KucoinFuturesRest['createPublicBullet']>>;
    try {
      bullet = await this.cfg.rest.createPublicBullet();
    } catch (err) {
      this.scheduleReconnect(`bullet 발급 실패: ${errMessage(err)}`);
      return;
    }

    const server = bullet?.instanceServers?.[0];
    if (!server?.endpoint || !bullet?.token) {
      this.scheduleReconnect('bullet 응답 형식 이상');
      return;
    }

    // 검증 실패는 재시도해도 같으므로 던진다. 조용히 평문 연결로 떨어지면 안 된다.
    assertSecureWsEndpoint(server.endpoint, this.cfg.allowedHosts);

    const pingInterval = Math.min(
      this.cfg.maxPingIntervalMs ?? 18000,
      Math.max(5000, Number(server.pingInterval) || 18000),
    );
    const pingTimeout = Math.max(5000, Number(server.pingTimeout) || 10000);

    const url = buildConnectUrl(server.endpoint, bullet.token, this.makeConnectId());

    let socket: SocketLike;
    try {
      socket = this.cfg.socketFactory(url, {
        onOpen: () => {
          // KuCoin 은 접속 직후 welcome 프레임을 보낸다. live 판정은 그때 한다.
        },
        onMessage: (raw) => this.handleMessage(raw, { pingInterval, pingTimeout }),
        onClose: (code, reason) => {
          if (this.socket !== socket) return; // 이미 교체된 소켓
          this.socket = null;
          this.activeTopics.clear();
          this.clearTimers();
          this.scheduleReconnect(`소켓 종료 code=${code} ${reason}`);
        },
        onError: (err) => {
          if (this.socket !== socket) return;
          this.cfg.events.onUpstreamError?.(undefined, errMessage(err));
        },
      });
    } catch (err) {
      this.scheduleReconnect(`소켓 생성 실패: ${errMessage(err)}`);
      return;
    }

    this.socket = socket;
  }

  private handleMessage(raw: string, timings: { pingInterval: number; pingTimeout: number }): void {
    this.lastMessageAt = this.now();
    const frame = parseFrame(raw);

    switch (frame.kind) {
      case 'welcome':
        this.reconnectAttempts = 0;
        this.connectedAt = this.now();
        this.startPing(timings);
        this.resubscribeAll();
        this.setState('live');
        break;

      case 'pong':
        this.pongDeadline = null;
        break;

      case 'data':
        this.lastDataAt = this.now();
        // 구독 중인 토픽만 활성으로 센다.
        //
        // 구독 해제를 보낸 뒤에도 업스트림은 이미 보낸 프레임을 계속 흘린다.
        // 그걸 그대로 더하면 activeTopics 가 한 번 올라간 뒤 절대 내려오지 않아
        // (실제로 topics=0 인데 activeTopics=1 로 남는 것을 확인했다)
        // 진단값이 거짓이 된다.
        if (this.subscriptions.has(frame.topic)) this.activeTopics.add(frame.topic);
        this.cfg.events.onData(frame);
        break;

      case 'error':
        this.cfg.events.onUpstreamError?.(frame.code, frame.message);
        break;

      case 'ack':
      case 'unknown':
      default:
        break;
    }
  }

  private startPing({ pingInterval, pingTimeout }: { pingInterval: number; pingTimeout: number }): void {
    if (this.pingTimer) this.clearIntervalFn(this.pingTimer);
    this.pingTimer = this.setIntervalFn(() => {
      if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;

      // 이전 ping 에 pong 이 없으면 죽은 연결이다. 강제로 끊어 재연결시킨다.
      // 이 처리가 없으면 소켓은 "열려 있지만" 데이터가 오지 않고, 화면은
      // 마지막 가격을 실시간인 것처럼 계속 보여준다. 가장 위험한 상태다.
      if (this.pongDeadline !== null && this.now() > this.pongDeadline) {
        this.cfg.events.onUpstreamError?.(undefined, 'pong 미수신 — 강제 재연결');
        const socket = this.socket;
        this.socket = null;
        this.clearTimers();
        try {
          if (socket.terminate) socket.terminate();
          else socket.close(4000, 'pong timeout');
        } catch {
          /* noop */
        }
        this.activeTopics.clear();
        this.scheduleReconnect('pong 미수신');
        return;
      }

      this.pongDeadline = this.now() + pingTimeout;
      this.send(pingFrame(this.nextId()));
    }, pingInterval);
  }

  private clearTimers(): void {
    if (this.pingTimer) this.clearIntervalFn(this.pingTimer);
    if (this.reconnectTimer) this.clearTimeoutFn(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.pongDeadline = null;
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts += 1;

    // 2회까지는 'reconnecting', 그 뒤는 'lost'. 사용자에게 낙관적으로 표시하지
    // 않는 것이 원칙이다.
    this.setState(this.reconnectAttempts > 2 ? 'lost' : 'reconnecting', {
      attempt: this.reconnectAttempts,
      reason,
    });

    const delay = backoffMs(this.reconnectAttempts - 1, DEFAULT_KUCOIN_RATE_LIMIT);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private nextId(): string {
    this.requestSeq += 1;
    return `qt${this.requestSeq}`;
  }

  private send(frame: string): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    try {
      this.socket.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 구독 (참조 카운팅)
  // -------------------------------------------------------------------------

  /**
   * topic 구독. 이미 구독 중이면 참조 수만 올린다.
   * @returns 해제 함수. 두 번 호출해도 안전하다.
   */
  subscribe(topic: string): () => void {
    const count = this.subscriptions.get(topic) ?? 0;
    this.subscriptions.set(topic, count + 1);

    if (count === 0 && this.state === 'live') {
      this.send(subscribeFrame(this.nextId(), topic));
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(topic);
    };
  }

  private release(topic: string): void {
    const count = this.subscriptions.get(topic) ?? 0;
    if (count <= 1) {
      this.subscriptions.delete(topic);
      this.activeTopics.delete(topic);
      if (this.state === 'live') this.send(unsubscribeFrame(this.nextId(), topic));
    } else {
      this.subscriptions.set(topic, count - 1);
    }
  }

  /** 재연결 후 호출. 끊긴 동안 유지된 구독을 모두 다시 보낸다. */
  private resubscribeAll(): void {
    for (const topic of this.subscriptions.keys()) {
      this.send(subscribeFrame(this.nextId(), topic));
    }
  }

  /** 테스트/진단용. 현재 구독 중인 토픽 목록. */
  listSubscriptions(): string[] {
    return [...this.subscriptions.keys()];
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Node `ws` 패키지용 소켓 팩토리.
 *
 * ws 를 동적으로 불러오는 이유: 이 패키지가 브라우저 번들에 포함될 때
 * Node 전용 모듈이 정적 import 로 끌려들어가지 않게 하기 위함.
 */
export function createNodeSocketFactory(WebSocketImpl: WebSocketCtor): SocketFactory {
  return (url, handlers) => {
    const ws = new WebSocketImpl(url, { handshakeTimeout: 15000 });
    ws.on('open', () => handlers.onOpen());
    ws.on('message', (data: unknown) => handlers.onMessage(String(data)));
    ws.on('close', (code: number, reason: unknown) =>
      handlers.onClose(code, reason ? String(reason).slice(0, 120) : ''),
    );
    ws.on('error', (err: Error) => handlers.onError(err));
    return ws as unknown as SocketLike;
  };
}

interface NodeWebSocketLike {
  on(event: string, listener: (...args: never[]) => void): unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readonly readyState: number;
}

type WebSocketCtor = new (url: string, opts?: { handshakeTimeout?: number }) => NodeWebSocketLike;
