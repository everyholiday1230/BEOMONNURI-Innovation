/**
 * WS 클라이언트 검증 — 가짜 소켓과 가짜 타이머로 네트워크 없이 돌린다.
 *
 * 여기서 검증하는 것들은 전부 "돈이 걸린" 동작이다:
 *  - 연결이 죽었을 때 사용자에게 live 라고 거짓 표시하지 않는가
 *  - pong 이 안 오는 좀비 연결을 감지하는가
 *  - 재연결 후 구독을 복원하는가 (복원 실패 시 화면이 멈춘 채 live 로 보인다)
 *  - 마지막 구독자가 떠나면 업스트림을 닫는가 (레이트리밋 낭비 방지)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KucoinWsClient,
  SOCKET_CONNECTING,
  SOCKET_OPEN,
  type ConnectionState,
  type SocketHandlers,
  type SocketLike,
} from '../ws-client.js';
import { tickerTopic } from '../ws-protocol.js';
import { KucoinFuturesRest, DEFAULT_KUCOIN_FUTURES_REST } from '../rest.js';

/** 테스트가 조작할 수 있는 가짜 소켓. */
class FakeSocket implements SocketLike {
  sent: string[] = [];
  readyState = SOCKET_CONNECTING;
  closed: { code?: number; reason?: string } | null = null;
  terminated = false;

  constructor(
    readonly url: string,
    readonly handlers: SocketHandlers,
  ) {}

  send(data: string): void {
    if (this.readyState !== SOCKET_OPEN) throw new Error('소켓이 열려있지 않다');
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  terminate(): void {
    this.terminated = true;
  }

  // --- 테스트 조작용 ---
  open(): void {
    this.readyState = SOCKET_OPEN;
    this.handlers.onOpen();
  }
  welcome(): void {
    this.handlers.onMessage(JSON.stringify({ id: 'w', type: 'welcome' }));
  }
  deliver(obj: unknown): void {
    this.handlers.onMessage(JSON.stringify(obj));
  }
  dropConnection(code = 1006, reason = 'abnormal'): void {
    this.readyState = 3;
    this.handlers.onClose(code, reason);
  }
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const BULLET = {
  token: 'tok',
  instanceServers: [
    { endpoint: 'wss://ws-api-futures.kucoin.com/', pingInterval: 18000, pingTimeout: 10000 },
  ],
};

interface Harness {
  client: KucoinWsClient;
  sockets: FakeSocket[];
  states: Array<{ state: ConnectionState; detail?: { attempt?: number; reason?: string } }>;
  data: Array<{ channel: string; exchangeSymbol: string }>;
  errors: Array<{ code?: string; message: string }>;
  latest(): FakeSocket;
}

function makeHarness(overrides: { bulletFails?: boolean } = {}): Harness {
  const sockets: FakeSocket[] = [];
  const states: Harness['states'] = [];
  const data: Harness['data'] = [];
  const errors: Harness['errors'] = [];

  const client = new KucoinWsClient({
    rest: {
      createPublicBullet: async () => {
        if (overrides.bulletFails) throw new Error('bullet 실패');
        return BULLET as never;
      },
    },
    socketFactory: (url, handlers) => {
      const s = new FakeSocket(url, handlers);
      sockets.push(s);
      return s;
    },
    events: {
      onData: (frame) => data.push({ channel: frame.channel, exchangeSymbol: frame.exchangeSymbol }),
      onState: (state, detail) => states.push({ state, detail }),
      onUpstreamError: (code, message) => errors.push({ code, message }),
    },
    connectIdImpl: () => 'cid-test',
  });

  return { client, sockets, states, data, errors, latest: () => sockets[sockets.length - 1]! };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('연결 수명주기', () => {
  it('welcome 을 받기 전에는 live 가 아니다', async () => {
    const h = makeHarness();
    await h.client.start();

    // 소켓은 만들어졌지만 아직 welcome 이 없다.
    expect(h.sockets).toHaveLength(1);
    expect(h.states.map((s) => s.state)).toEqual(['connecting']);
    expect(h.client.getStatus().state).toBe('connecting');

    h.latest().open();
    // onOpen 만으로는 live 로 올리지 않는다 — KuCoin 은 welcome 을 먼저 보낸다.
    expect(h.client.getStatus().state).toBe('connecting');

    h.latest().welcome();
    expect(h.client.getStatus().state).toBe('live');
  });

  it('접속 URL 이 token 과 connectId 를 포함한다', async () => {
    const h = makeHarness();
    await h.client.start();
    expect(h.latest().url).toBe(
      'wss://ws-api-futures.kucoin.com/?token=tok&connectId=cid-test',
    );
  });

  it('bullet 발급 실패 시 재연결을 예약하고 live 로 표시하지 않는다', async () => {
    const h = makeHarness({ bulletFails: true });
    await h.client.start();

    expect(h.sockets).toHaveLength(0);
    const last = h.states[h.states.length - 1]!;
    expect(last.state).toBe('reconnecting');
    expect(last.detail?.reason).toContain('bullet');
  });

  it('stop 하면 구독과 타이머를 정리하고 idle 로 간다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    h.client.subscribe(tickerTopic('XBTUSDTM'));

    h.client.stop();
    expect(h.client.getStatus().state).toBe('idle');
    expect(h.client.getStatus().activeTopics).toBe(0);
  });

  it('핸드셰이크 중 stop 하면 close 대신 terminate 를 쓴다', async () => {
    // close() 를 부르면 ws 라이브러리가 비동기 error 를 던져 프로세스가 죽는다.
    const h = makeHarness();
    await h.client.start();
    expect(h.latest().readyState).toBe(SOCKET_CONNECTING);

    h.client.stop();
    expect(h.latest().terminated).toBe(true);
    expect(h.latest().closed).toBeNull();
  });
});

describe('구독', () => {
  it('live 상태에서 구독하면 즉시 프레임을 보낸다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    h.client.subscribe(tickerTopic('XBTUSDTM'));
    const subs = h.latest().frames().filter((f) => f.type === 'subscribe');
    expect(subs).toHaveLength(1);
    expect(subs[0]!.topic).toBe('/contractMarket/ticker:XBTUSDTM');
  });

  it('같은 토픽을 두 번 구독해도 업스트림 프레임은 1개다 (참조 카운팅)', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    const off1 = h.client.subscribe(tickerTopic('XBTUSDTM'));
    const off2 = h.client.subscribe(tickerTopic('XBTUSDTM'));
    expect(h.latest().frames().filter((f) => f.type === 'subscribe')).toHaveLength(1);

    // 첫 소비자가 떠나도 다른 소비자가 남아 있으면 구독을 유지한다.
    off1();
    expect(h.latest().frames().filter((f) => f.type === 'unsubscribe')).toHaveLength(0);
    expect(h.client.listSubscriptions()).toHaveLength(1);

    // 마지막 소비자가 떠나면 업스트림도 닫는다 — 아무도 안 보는 트래픽을 끊는다.
    off2();
    expect(h.latest().frames().filter((f) => f.type === 'unsubscribe')).toHaveLength(1);
    expect(h.client.listSubscriptions()).toHaveLength(0);
  });

  it('해제 함수를 두 번 불러도 안전하다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    const off = h.client.subscribe(tickerTopic('XBTUSDTM'));
    off();
    off();
    expect(h.latest().frames().filter((f) => f.type === 'unsubscribe')).toHaveLength(1);
  });

  it('연결 전에 구독해두면 welcome 시점에 보낸다', async () => {
    const h = makeHarness();
    // start 전에 구독 (호출 순서에 의존하지 않아야 한다)
    h.client.subscribe(tickerTopic('XBTUSDTM'));
    h.client.subscribe(tickerTopic('ETHUSDTM'));

    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    expect(h.latest().frames().filter((f) => f.type === 'subscribe')).toHaveLength(2);
  });
});

describe('재연결 복원력', () => {
  it('연결이 끊기면 live 로 표시하지 않는다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    expect(h.client.getStatus().state).toBe('live');

    h.latest().dropConnection();
    // 죽은 시세를 실시간처럼 보여주면 안 된다.
    expect(h.client.getStatus().state).not.toBe('live');
    expect(h.client.getStatus().state).toBe('reconnecting');
  });

  it('연결이 계속 실패하면 lost 로 강등한다 (낙관적 표시 금지)', async () => {
    // welcome 을 받지 못하고 계속 끊기는 상황 = 실제로 연결이 안 되는 상태.
    const h = makeHarness();
    await h.client.start();

    for (let i = 0; i < 3; i += 1) {
      h.latest().dropConnection();
      await vi.advanceTimersByTimeAsync(60_000);
    }

    const reported = h.states.map((s) => s.state);
    expect(reported).toContain('lost');
    expect(h.client.getStatus().reconnectAttempts).toBeGreaterThanOrEqual(3);
  });

  it('연결이 실제로 복구되면 재시도 카운터를 초기화한다', async () => {
    // 한 번 끊겼다가 정상 복구된 뒤에는 다음 장애를 'lost' 가 아니라
    // 'reconnecting' 으로 시작해야 한다. 그러지 않으면 오래 켜둔 세션에서
    // 사소한 재연결 한 번에 영구적으로 lost 표시가 남는다.
    const h = makeHarness();
    await h.client.start();
    h.latest().dropConnection();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.client.getStatus().reconnectAttempts).toBe(1);

    h.latest().open();
    h.latest().welcome();
    expect(h.client.getStatus().state).toBe('live');
    expect(h.client.getStatus().reconnectAttempts).toBe(0);

    h.latest().dropConnection();
    expect(h.client.getStatus().state).toBe('reconnecting');
  });

  it('재연결 후 기존 구독을 자동 복원한다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    h.client.subscribe(tickerTopic('XBTUSDTM'));
    h.client.subscribe(tickerTopic('ETHUSDTM'));
    const first = h.latest();
    expect(first.frames().filter((f) => f.type === 'subscribe')).toHaveLength(2);

    first.dropConnection();
    await vi.advanceTimersByTimeAsync(5_000);

    // 새 소켓이 만들어졌어야 한다.
    expect(h.sockets.length).toBeGreaterThan(1);
    const second = h.latest();
    expect(second).not.toBe(first);

    second.open();
    second.welcome();

    // 복원이 안 되면 화면은 멈춘 채 live 로 보인다 — 가장 위험한 상태.
    const restored = second.frames().filter((f) => f.type === 'subscribe');
    expect(restored).toHaveLength(2);
    expect(restored.map((f) => f.topic).sort()).toEqual([
      '/contractMarket/ticker:ETHUSDTM',
      '/contractMarket/ticker:XBTUSDTM',
    ]);
    expect(h.client.getStatus().state).toBe('live');
  });

  it('재연결 시 토큰을 새로 발급받는다 (토큰은 만료된다)', async () => {
    let bulletCalls = 0;
    const sockets: FakeSocket[] = [];
    const client = new KucoinWsClient({
      rest: {
        createPublicBullet: async () => {
          bulletCalls += 1;
          return BULLET as never;
        },
      },
      socketFactory: (url, handlers) => {
        const s = new FakeSocket(url, handlers);
        sockets.push(s);
        return s;
      },
      events: { onData: () => {}, onState: () => {} },
    });

    await client.start();
    expect(bulletCalls).toBe(1);

    sockets[0]!.open();
    sockets[0]!.welcome();
    sockets[0]!.dropConnection();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(bulletCalls).toBe(2);
  });
});

describe('좀비 연결 감지 (ping/pong)', () => {
  it('주기적으로 ping 을 보낸다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    await vi.advanceTimersByTimeAsync(18_000);
    expect(h.latest().frames().filter((f) => f.type === 'ping')).toHaveLength(1);
  });

  it('pong 이 오면 연결을 유지한다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    const socket = h.latest();

    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(18_000);
      socket.deliver({ id: 'p', type: 'pong' });
    }
    expect(h.client.getStatus().state).toBe('live');
    expect(h.sockets).toHaveLength(1); // 재연결하지 않았다
  });

  it('pong 이 안 오면 소켓이 열려 있어도 강제 재연결한다', async () => {
    // 소켓은 "열려 있지만" 데이터가 오지 않는 상태. 화면은 마지막 가격을
    // 실시간인 것처럼 계속 보여준다. 반드시 감지해야 한다.
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    const zombie = h.latest();

    await vi.advanceTimersByTimeAsync(18_000); // ping 1회 전송
    expect(zombie.frames().filter((f) => f.type === 'ping')).toHaveLength(1);

    // pong 없이 pingTimeout(10s) 초과 후 다음 ping 주기
    await vi.advanceTimersByTimeAsync(18_000);

    expect(zombie.terminated).toBe(true);
    expect(h.errors.some((e) => e.message.includes('pong'))).toBe(true);
    expect(h.client.getStatus().state).not.toBe('live');
  });
});

describe('데이터 전달', () => {
  it('데이터 프레임을 해석해 전달하고 활성 토픽으로 기록한다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    h.client.subscribe(tickerTopic('XBTUSDTM'));

    h.latest().deliver({
      type: 'message',
      topic: '/contractMarket/ticker:XBTUSDTM',
      data: { symbol: 'XBTUSDTM', price: '63738.3' },
    });

    expect(h.data).toEqual([{ channel: 'ticker', exchangeSymbol: 'XBTUSDTM' }]);
    expect(h.client.getStatus().activeTopics).toBe(1);
  });

  it('깨진 프레임은 무시하고 스트림을 유지한다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    h.latest().handlers.onMessage('not json');
    h.latest().handlers.onMessage('{"type":"message","topic":"/bad"}');

    expect(h.data).toHaveLength(0);
    expect(h.client.getStatus().state).toBe('live');
  });

  it('upstream error 프레임을 콜백으로 알린다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    h.latest().deliver({ id: '1', type: 'error', code: 404, data: 'topic not found' });
    expect(h.errors).toEqual([{ code: '404', message: 'topic not found' }]);
  });

  it('마지막 수신 이후 경과시간(staleMs)을 노출한다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    const before = h.client.getStatus().staleMs;
    expect(before).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    // 스트림 정지를 외부에서 감지할 수 있어야 한다.
    expect(h.client.getStatus().staleMs!).toBeGreaterThanOrEqual(before!);
  });
});

describe('보안', () => {
  it('허용되지 않은 WS 호스트면 연결을 시도하지 않고 던진다', async () => {
    const client = new KucoinWsClient({
      rest: {
        createPublicBullet: async () =>
          ({ token: 't', instanceServers: [{ endpoint: 'wss://evil.example.com/' }] }) as never,
      },
      socketFactory: (url, handlers) => new FakeSocket(url, handlers),
      events: { onData: () => {}, onState: () => {} },
    });

    await expect(client.start()).rejects.toThrow(/호스트/);
  });
});

describe('데이터 신선도 지표 (dataStaleMs)', () => {
  /**
   * 왜 lastMessageAt 과 분리했는가
   * ----------------------------
   * pong 도 메시지라서 lastMessageAt 을 갱신한다. 그래서 소켓은 살아 있고
   * pong 은 오지만 구독한 시세만 조용히 끊긴 상태를 lastMessageAt 으로는
   * 구분할 수 없다. 그 상태를 "정상"으로 보고하면 오래된 가격으로 주문이 나간다.
   *
   * 이 판정을 쓰는 곳: apps/api/src/market-freshness.ts
   */

  it('데이터를 받기 전에는 dataStaleMs 가 null 이다 (0 이 아니다)', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    const st = h.client.getStatus();
    expect(st.dataStaleMs).toBeNull();
    expect(st.lastDataAt).toBeNull();
    // 연결 자체는 welcome 을 받았으므로 신선하다.
    expect(st.staleMs).not.toBeNull();
  });

  it('데이터를 받으면 dataStaleMs 가 갱신된다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    h.client.subscribe(tickerTopic('XBTUSDTM'));

    h.latest().deliver({
      type: 'message',
      topic: '/contractMarket/ticker:XBTUSDTM',
      data: { symbol: 'XBTUSDTM', price: '63738.3' },
    });

    expect(h.client.getStatus().dataStaleMs).toBe(0);
    expect(h.client.getStatus().lastDataAt).not.toBeNull();
  });

  it('pong 은 dataStaleMs 를 갱신하지 않는다 — 죽은 구독을 가리면 안 된다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    h.client.subscribe(tickerTopic('XBTUSDTM'));

    h.latest().deliver({
      type: 'message',
      topic: '/contractMarket/ticker:XBTUSDTM',
      data: { symbol: 'XBTUSDTM', price: '63738.3' },
    });

    // 60초 경과. 그 사이 pong 만 오고 시세는 오지 않는다.
    vi.advanceTimersByTime(60_000);
    h.latest().deliver({ id: 'p', type: 'pong' });

    const st = h.client.getStatus();
    // 연결 기준으로는 방금 소식을 받았다.
    expect(st.staleMs).toBe(0);
    // 데이터 기준으로는 60초째 굶고 있다. 이 차이가 핵심이다.
    expect(st.dataStaleMs).toBe(60_000);
  });

  it('시간이 흐르면 dataStaleMs 가 증가한다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();
    h.client.subscribe(tickerTopic('XBTUSDTM'));
    h.latest().deliver({
      type: 'message',
      topic: '/contractMarket/ticker:XBTUSDTM',
      data: { symbol: 'XBTUSDTM', price: '1' },
    });

    vi.advanceTimersByTime(45_000);
    expect(h.client.getStatus().dataStaleMs).toBe(45_000);
  });
});

describe('restBase 설정 안전성', () => {
  /**
   * restBase 를 생략하면 예전에는 `new URL(path, undefined)` 가 되어
   * 'Invalid URL' 로 터졌다. 원인 문자열에 restBase 라는 단서가 없어 추적이
   * 어려웠다 (실제로 겪음). 기본값을 두고, 명백히 잘못된 값은 생성 시점에 거부한다.
   */
  it('생략하면 기본 선물 호스트를 쓴다', () => {
    expect(() => new KucoinFuturesRest({})).not.toThrow();
    expect(DEFAULT_KUCOIN_FUTURES_REST).toBe('https://api-futures.kucoin.com');
  });

  it.each(['', '   ', undefined])('빈 값(%p)은 기본값으로 떨어진다', (v) => {
    // env 가 설정되지 않은 배포에서 조용히 죽는 것을 막는다.
    expect(() => new KucoinFuturesRest({ restBase: v as string })).not.toThrow();
  });

  it.each(['api-futures.kucoin.com', 'not a url', 'httpx://'])(
    '잘못된 URL(%s)은 생성 시점에 거부한다',
    (bad) => {
      // 첫 요청 때가 아니라 부팅 때 실패해야 한다 — 배포 즉시 드러난다.
      expect(() => new KucoinFuturesRest({ restBase: bad })).toThrow(/restBase/);
    },
  );
});

describe('activeTopics 정확성', () => {
  /**
   * 구독 해제 후 도착하는 잔여 프레임이 activeTopics 를 되살리면,
   * topics=0 인데 activeTopics=1 로 남아 진단값이 영구히 거짓이 된다 (실제로 겪음).
   */
  it('구독 해제 후 도착한 프레임은 활성으로 세지 않는다', async () => {
    const h = makeHarness();
    await h.client.start();
    h.latest().open();
    h.latest().welcome();

    const topic = tickerTopic('XBTUSDTM');
    const release = h.client.subscribe(topic);

    h.latest().deliver({
      type: 'message',
      topic: '/contractMarket/ticker:XBTUSDTM',
      data: { symbol: 'XBTUSDTM', price: '1' },
    });
    expect(h.client.getStatus().activeTopics).toBe(1);

    release();
    expect(h.client.getStatus().topics).toBe(0);
    expect(h.client.getStatus().activeTopics).toBe(0);

    // 업스트림이 아직 흘리는 잔여 프레임.
    h.latest().deliver({
      type: 'message',
      topic: '/contractMarket/ticker:XBTUSDTM',
      data: { symbol: 'XBTUSDTM', price: '2' },
    });

    expect(h.client.getStatus().activeTopics).toBe(0);
    expect(h.client.getStatus().topics).toBe(0);
  });
})
