/**
 * 거래소 등록소 — **거래소를 늘릴 때 고칠 곳을 한 군데로 모은다.**
 *
 * ★★★ 왜 만드는가
 *
 *   지금까지 배포는 거래소 하나만 알았다(`deps.exchangeId`·`deps.accountAdapter`).
 *   여러 거래소와 협약하는 방향이므로, 거래소를 추가할 때마다 라우트를 고치는 구조는
 *   유지할 수 없다 — **고칠 곳이 여러 군데면 반드시 한 곳을 빠뜨린다.**
 *   (이 저장소에서 같은 실패를 여러 번 겪었다: AI 명령 네 곳, soft delete 다섯 곳.)
 *
 *   그래서 `register()` 한 번으로 끝나게 한다. 라우트는 자격증명에 적힌
 *   `exchangeId` 로 어댑터를 **찾아 쓴다.**
 *
 * ★★★ **읽기와 쓰기를 따로 등록한다.**
 *
 *   새 거래소는 **읽기만 먼저** 붙인다. 서명이나 수량 단위를 잘못 이해했을 때 읽기는
 *   틀린 숫자를 보여주는 것으로 끝나지만 **쓰기는 고객 돈을 움직인다.**
 *   `trading` 이 없는 거래소는 **주문을 낼 수 없다** — 그 사실이 타입에 드러난다.
 */
import type { IExchangeAccountAdapter, IExchangeTradingAdapter } from '@quantumtrade/exchange-core';

export interface ExchangeBinding {
  /** 카탈로그와 같은 식별자. 자격증명 행에 저장되는 값이다. */
  readonly id: string;
  /** 계정 읽기 — 잔고·포지션·주문 조회. */
  readonly account: IExchangeAccountAdapter;
  /**
   * 주문 전송.
   *
   * ★★★ **없으면 주문을 낼 수 없다.** 읽기만 붙인 거래소가 그 상태다.
   *   `undefined` 를 "아직 배선 안 됨" 으로 쓰고, 라우트가 그 사실을 고객에게 말한다.
   */
  readonly trading?: IExchangeTradingAdapter;
}

export class ExchangeRegistry {
  private readonly bindings = new Map<string, ExchangeBinding>();

  /**
   * 등록.
   *
   * ★★ 같은 id 를 두 번 등록하면 **던진다.** 조용히 덮어쓰면 나중에 등록된 것이
   *   이기고, 어느 어댑터가 쓰이는지 알 수 없다 — 주문이 걸린 경로에서 그 모호함을
   *   감수하지 않는다.
   */
  register(binding: ExchangeBinding): void {
    const id = String(binding.id || '').trim().toLowerCase();
    if (!id) throw new Error('ExchangeRegistry.register: id 가 비어 있다');
    if (this.bindings.has(id)) {
      throw new Error(`ExchangeRegistry.register: '${id}' 가 이미 등록돼 있다 — 중복 등록은 어느 어댑터가 쓰이는지 모호하게 만든다`);
    }
    this.bindings.set(id, { ...binding, id });
  }

  /** 등록된 거래소 식별자(정렬). 화면·진단이 "무엇이 연결 가능한가" 를 물을 때 쓴다. */
  ids(): string[] {
    return [...this.bindings.keys()].sort();
  }

  has(id: string): boolean {
    return this.bindings.has(String(id || '').trim().toLowerCase());
  }

  /**
   * 계정 읽기 어댑터.
   *
   * ★ 없으면 `null` 이다. **던지지 않는다** — 자격증명에 옛 거래소 이름이 남아 있을 수
   *   있고(거래소를 내렸을 때), 그때 화면 전체가 500 이 되면 다른 거래소 조회까지 막힌다.
   */
  account(id: string): IExchangeAccountAdapter | null {
    return this.bindings.get(String(id || '').trim().toLowerCase())?.account ?? null;
  }

  /**
   * 주문 어댑터.
   *
   * ★★★ 읽기만 붙인 거래소는 `null` 이다. 호출자는 **주문을 만들지 말고 이유를
   *   말해야 한다** — 조용히 다른 거래소로 보내면 엉뚱한 계정에 주문이 간다.
   */
  trading(id: string): IExchangeTradingAdapter | null {
    return this.bindings.get(String(id || '').trim().toLowerCase())?.trading ?? null;
  }

  /** 주문까지 가능한 거래소. 화면이 "여기서는 주문이 된다" 를 정확히 말할 수 있어야 한다. */
  tradableIds(): string[] {
    return [...this.bindings.values()].filter((b) => b.trading).map((b) => b.id).sort();
  }
}
