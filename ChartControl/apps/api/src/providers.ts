import {
  BitMartPublicMarketDataProvider,
  MockReplayProvider,
  type IMarketDataProvider,
  type IOrderBookAdapter,
  type ITradesAdapter,
} from '@quantumtrade/exchange-adapters';
import {
  KucoinFuturesAdapter,
  KucoinSpotAdapter,
  createNodeSocketFactory,
} from '@quantumtrade/exchange-kucoin';
import WebSocket from 'ws';

import type { ApiEnv } from './env';

export interface MarketProviders {
  market: IMarketDataProvider;
  book: IOrderBookAdapter;
  trades: ITradesAdapter;
  /** the data source label surfaced to clients */
  source: 'kucoin_public' | 'bitmart_public' | 'mock_replay';
  /**
     현물 시세.

     ★ 선물 어댑터와 **별도 인스턴스**다. 심볼 규칙(BTC-USDT vs XBTUSDTM)·캔들
       배열 순서·수량 의미가 모두 달라, 하나의 어댑터가 두 시장을 다루면 어느
       규칙이 적용됐는지 코드에서 알 수 없다.

     ★ 없을 수 있다(KUCOIN_PUBLIC 이 아닌 모드). 그때 현물 요청은 미지원을
       분명히 알린다 — 선물 데이터로 대신 채우면 이용자는 현물 시세를 본다고
       믿으면서 선물 가격으로 판단한다.
  */
  spot?: {
    getSymbols: () => Promise<unknown[]>;
    getCandles: (q: { symbol: string; timeframe: string; limit?: number; before?: number }) => Promise<unknown[]>;
    getTicker: (symbol: string) => Promise<unknown>;
    getTickers: () => Promise<unknown[]>;
    readonly supportsStreaming: boolean;
    /** 실시간 구독. supportsStreaming 이 false 면 아무 일도 하지 않는다. */
    startStreaming?: () => Promise<void>;
    stopStreaming?: () => void;
    subscribeTicker?: (symbol: string, cb: (t: unknown) => void) => () => void;
    subscribeCandles?: (symbol: string, tf: string, cb: (c: unknown) => void) => () => void;
    subscribeBook?: (symbol: string, cb: (b: unknown) => void) => () => void;
    subscribeTrades?: (symbol: string, cb: (t: unknown) => void) => () => void;
  };
  /** 스트리밍을 지원하는 어댑터면 여기에 노출된다 (WS 시작/중지용). */
  streaming?: {
    start: () => Promise<void>;
    stop: () => void;
    status: () => unknown;
  };
}

/**
 * DATA_MODE 로 시세 제공자를 고른다.
 *
 * KUCOIN_PUBLIC (현재 운영 모드)
 *   캔들·티커·오더북·체결 네 경로가 모두 실 KuCoin 이다. 하나의 어댑터가
 *   IMarketDataProvider + IOrderBookAdapter + ITradesAdapter 를 전부 구현하므로
 *   목업과 섞이지 않는다. BitMart 모드에서는 오더북/체결이 목업이었다.
 *
 * BITMART_PUBLIC (유지, 실사용 불가)
 *   BitMart 가 2026-08-26 01:00 UTC 에 거래를 종료했다. 코드는 남겨둔다 —
 *   다른 거래소로 갈아탈 때 참고할 구현체이고 테스트 123개가 걸려 있다.
 *
 * MOCK_REPLAY
 *   완전 결정적. 테스트와 오프라인 개발용.
 */
export function selectProviders(env: ApiEnv): MarketProviders {
  const mock = new MockReplayProvider();

  if (env.dataMode === 'KUCOIN_PUBLIC') {
    const kucoin = new KucoinFuturesAdapter({
      restBase: env.kucoinFuturesRest,
      rateLimit: {
        maxRps: env.kucoinRestMaxRps,
        burst: env.kucoinRestBurst,
        backoffBaseMs: 500,
        backoffMaxMs: 30_000,
        jitterRatio: 0.3,
        circuitBreakerThreshold: 5,
        circuitBreakerResetMs: 30_000,
      },
      // ws 패키지를 여기서 주입한다. 어댑터는 소켓 구현을 모른다 — 테스트에서
      // 가짜 소켓을 넣어 재연결/ping 을 네트워크 없이 검증하기 위한 구조다.
      socketFactory: createNodeSocketFactory(WebSocket as never),
      onConnectionState: (state, detail) => {
        // 연결 상태는 사용자에게 "실시간인지"를 정직하게 보여주는 근거다.
        // 죽은 시세를 live 로 표시하지 않으려면 이 로그가 남아야 한다.
        const suffix = detail?.reason ? ` — ${detail.reason}` : '';
        console.log(`[market] kucoin stream: ${state}${suffix}`);
      },
      onDiagnostic: (message, meta) => {
        console.warn(`[market] ${message}`, JSON.stringify(meta));
      },
    });

    return {
      market: kucoin,
      book: kucoin,
      trades: kucoin,
      source: 'kucoin_public',
      /*
         현물은 공개 REST 만 쓴다(WS 는 아직). 스트리밍 여부를 어댑터가
         스스로 밝히므로, 화면이 "실시간" 이라고 잘못 표시하지 않는다.
      */
      spot: new KucoinSpotAdapter({
        restBase: env.kucoinSpotRest,
        /*
           ★ 소켓 구현을 주입하면 현물도 실시간이 된다. 주입하지 않으면
             supportsStreaming 이 false 로 남아, 화면이 "실시간" 이라고
             잘못 표시하지 않는다.
        */
        socketFactory: createNodeSocketFactory(WebSocket as never),
        onConnectionState: (state, detail) => {
           
          console.log(`[market] kucoin spot stream: ${state}${detail ? ' ' + JSON.stringify(detail) : ''}`);
        },
      }),
      streaming: {
        start: () => kucoin.startStreaming(),
        stop: () => kucoin.stopStreaming(),
        status: () => kucoin.getStatus(),
      },
    };
  }

  if (env.dataMode === 'BITMART_PUBLIC') {
    const bitmart = new BitMartPublicMarketDataProvider({
      restBase: env.bitmartRestBase,
      wsPublic: env.bitmartWsPublic,
    });
    return { market: bitmart, book: mock, trades: mock, source: 'bitmart_public' };
  }

  return { market: mock, book: mock, trades: mock, source: 'mock_replay' };
}
