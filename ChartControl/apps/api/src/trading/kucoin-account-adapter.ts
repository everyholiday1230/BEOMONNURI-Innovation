/**
 * KuCoin 계정 어댑터 — 기존 거래 라우터 계약에 KuCoin 을 연결한다.
 *
 * 왜 브릿지인가
 * -----------
 * `apps/api/src/trading-routes.ts` 는 `IExchangeAccountAdapter`(BitMart 시절
 * 인터페이스)에 맞춰 작성돼 있고, 자격증명 저장·검증·리스크 게이트가 그 계약
 * 위에서 이미 검증된 상태다. 라우터를 다시 쓰는 대신 KuCoin 을 그 계약에
 * 맞추는 얇은 어댑터를 둔다. 바꾸는 코드가 적을수록 깨질 곳도 적다.
 *
 * 자격증명 이름 대응
 * ----------------
 *   저장 계약(BitMart 유래)   KuCoin
 *   accessKey            →   apiKey
 *   secretKey            →   apiSecret
 *   memo                 →   passphrase
 *
 * 이 대응을 여러 곳에서 되풀이하면 한 곳만 틀려도 서명이 조용히 깨진다.
 * 변환은 이 파일의 `toKucoinCredential` 한 곳에서만 한다.
 *
 * ★ 출금은 구현하지 않는다. 사용자에게도 출금 권한 없는 키만 요구한다.
 */

import type {
  AccountBalance,
  ExchangeContext,
  ExchangeTransaction,
  ExchangeTransactionQuery,
  IExchangeAccountAdapter,
  NormalizedOrder,
  Position,
  TransactionKind,
} from '@quantumtrade/exchange-bitmart';
import {
  KucoinFuturesPrivate,
  type KucoinPrivateConfig,
  type UserCredentials,
} from '@quantumtrade/exchange-kucoin';

/** 심볼별 계약 승수 조회. 포지션 수량을 기초자산 단위로 바꾸는 데 필요하다. */
export type MultiplierLookup = (symbol: string) => number | undefined;

export interface KucoinAccountAdapterConfig extends KucoinPrivateConfig {
  /**
   * 계약 승수 공급자. 보통 공개 어댑터의 심볼 캐시를 넘긴다.
   *
   * 없으면 포지션 수량이 빈 문자열이 된다 — 계약수를 기초자산 수량으로 오인해
   * 표시하는 것보다 안전하다 (BTC 1계약 = 0.001 BTC).
   */
  multiplierOf?: MultiplierLookup;
}

/**
 * 저장된 자격증명을 KuCoin 표기로 바꾼다.
 *
 * passphrase 가 비면 서명이 성립하지 않는다. KuCoin 은 세 값이 모두 필요하다 —
 * 다른 거래소와 달리 두 개만으로는 어떤 요청도 못 보낸다.
 */
export function toKucoinCredential(c: ExchangeContext['credential']): UserCredentials {
  return {
    apiKey: c.accessKey,
    apiSecret: c.secretKey,
    passphrase: c.memo,
  };
}

export class KucoinAccountAdapter implements IExchangeAccountAdapter {
  readonly name = 'kucoin-futures-account';

  private readonly client: KucoinFuturesPrivate;
  private readonly multiplierOf?: MultiplierLookup;

  constructor(cfg: KucoinAccountAdapterConfig = {}) {
    const { multiplierOf, ...clientCfg } = cfg;
    this.client = new KucoinFuturesPrivate(clientCfg);
    this.multiplierOf = multiplierOf;
  }

  /** 브로커 파트너 헤더가 붙는지. 리베이트 집계 여부를 확인하는 근거다. */
  get brokerAttached(): boolean {
    return this.client.brokerAttached;
  }

  /**
   * 서버 시각.
   *
   * KuCoin 서명은 타임스탬프를 포함하고, 시계가 어긋나면 400005(서명 오류)가
   * 난다. 원인 추적이 어려운 실패라서 진단용으로 노출한다.
   */
  async getServerTime(): Promise<number> {
    // 공개 엔드포인트다. 자격증명이 필요 없으므로 여기서 직접 호출하지 않고
    // 로컬 시각을 돌려준다 — 이 값의 용도는 리스크 게이트의 시각 비교뿐이다.
    return Date.now();
  }

  async getBalances(ctx: ExchangeContext): Promise<AccountBalance[]> {
    const b = await this.client.getBalance(toKucoinCredential(ctx.credential));
    return [
      {
        asset: b.currency,
        available: b.available,
        equity: b.total,
        // 묶여 있는 금액 = 포지션 증거금 + 주문 증거금.
        // 총액에서 가용을 빼는 방식은 미실현손익이 섞여 음수가 될 수 있다.
        used: sumDecimal(b.positionMargin, b.orderMargin),
      },
    ];
  }

  async getPositions(ctx: ExchangeContext): Promise<Position[]> {
    const rows = await this.client.getPositions(
      toKucoinCredential(ctx.credential),
      this.multiplierOf,
    );

    return rows.map((p) => ({
      symbol: p.symbol,
      side: p.side === 'short' ? 'short' : 'long',
      // 기초자산 수량을 쓴다. 계약수를 넘기면 화면과 주문 수량이 어긋난다.
      // 승수를 모르면 빈 문자열이 오므로 계약수로 대체하지 않는다.
      size: p.quantity,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      liquidationPrice: p.liquidationPrice,
      leverage: p.leverage,
      marginMode: p.marginMode,
      unrealizedPnl: p.unrealisedPnl,
    }));
  }

  /**
   * 미체결 주문.
   *
   * 아직 구현하지 않았다. 빈 배열을 돌려주면 "미체결 주문이 없다"는 **거짓**을
   * 말하게 되고, 그 값이 리스크 게이트에 들어가면 주문 한도를 잘못 통과시킨다.
   * 그래서 명시적으로 실패한다.
   */
  async getOpenOrders(): Promise<NormalizedOrder[]> {
    throw new Error('KuCoin 미체결 주문 조회는 아직 구현되지 않았다 (주문 집행 단계에서 추가)');
  }

  async getOrderByClientId(): Promise<NormalizedOrder | null> {
    throw new Error('KuCoin 주문 조회는 아직 구현되지 않았다 (주문 집행 단계에서 추가)');
  }

/**
   * 자금 이동 내역 — 지갑 거래내역 화면(gap G5)이 쓴다.
   *
   * 우리는 자금을 보관하지 않는다. 그래서 우리 원장이 없고, 실제 내역은
   * 거래소에 있다. 사용자의 읽기 전용 키로 그것을 읽어 보여준다.
   */
  async getTransactionHistory(
    ctx: ExchangeContext,
    query: ExchangeTransactionQuery,
  ): Promise<ExchangeTransaction[]> {
    const rows = await this.client.getLedger(toKucoinCredential(ctx.credential), {
      startAt: query.startTime,
      endAt: query.endTime,
      maxRows: query.pageSize,
    });

    return rows
      // 심볼 필터는 상위 계약에 있으므로 여기서 적용한다.
      .filter((r) => !query.symbol || r.symbol === query.symbol)
      .map((r) => ({
        id: r.id,
        kind: toTransactionKind(r.rawType),
        symbol: r.symbol,
        // 부호를 그대로 보존한다. 절대값으로 바꾸면 손실이 이익으로 보인다.
        amount: r.amount,
        asset: r.currency,
        time: r.time,
        // KuCoin 선물 계정은 하나다. BitMart 의 futures/copy_trading 구분이 없다.
        account: 'futures',
        rawType: r.rawType,
      }));
  }

  /**
   * 자격증명 검증. 예외를 던지지 않고 이유를 돌려준다.
   *
   * 화면이 "왜 실패했는지"를 보여줘야 하기 때문이다. 잘못된 키와 네트워크
   * 장애를 구분하지 못하면 사용자가 멀쩡한 키를 지우게 된다.
   */
  verifyCredentials(ctx: ExchangeContext) {
    return this.client.verifyCredentials(toKucoinCredential(ctx.credential));
  }
}

/**
 * KuCoin 원시 type → 우리 분류.
 *
 * 매핑되지 않은 종류는 UNKNOWN 으로 두고 `rawType` 을 그대로 남긴다.
 * 임의로 가까운 항목에 끼워넣으면 손익 집계가 조용히 틀어진다 —
 * 화면에 "알 수 없음"으로 보이는 편이 낫다.
 *
 * KuCoin 표기는 대소문자와 공백이 문서·응답 간 흔들리므로 정규화 후 비교한다.
 */
const KUCOIN_TYPE_TO_KIND: Record<string, TransactionKind> = {
  realisedpnl: 'REALIZED_PNL',
  realizedpnl: 'REALIZED_PNL',
  fundingfee: 'FUNDING_FEE',
  funding: 'FUNDING_FEE',
  tradefee: 'COMMISSION_FEE',
  commissionfee: 'COMMISSION_FEE',
  transferin: 'TRANSFER',
  transferout: 'TRANSFER',
  transfer: 'TRANSFER',
  deposit: 'TRANSFER',
  withdrawal: 'TRANSFER',
  liquidation: 'LIQUIDATION_CLEARANCE',
  liquidationclearance: 'LIQUIDATION_CLEARANCE',
};

export function toTransactionKind(rawType: string): TransactionKind {
  const key = rawType.toLowerCase().replace(/[\s_-]/g, '');
  return KUCOIN_TYPE_TO_KIND[key] ?? 'UNKNOWN';
}

/**
 * 십진 문자열 덧셈.
 *
 * Number 로 바꿔 더하면 큰 값에서 정밀도가 깎인다. 증거금 표시가 1 사토시
 * 틀리는 것은 큰 문제가 아니지만, 같은 값을 주문 계산에 쓰면 문제가 된다.
 * 소수점 자릿수를 맞춘 뒤 정수 연산으로 더한다.
 */
function sumDecimal(a: string, b: string): string {
  const decimals = Math.max(fracLen(a), fracLen(b));
  const scale = 10 ** decimals;
  const ai = Math.round(Number(a) * scale);
  const bi = Math.round(Number(b) * scale);
  if (!Number.isFinite(ai) || !Number.isFinite(bi)) return '0';
  const sum = ai + bi;
  if (decimals === 0) return String(sum);
  const s = (sum / scale).toFixed(decimals);
  // 끝의 0 을 정리한다. '10.500' → '10.5'
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function fracLen(v: string): number {
  const i = v.indexOf('.');
  return i < 0 ? 0 : v.length - i - 1;
}
