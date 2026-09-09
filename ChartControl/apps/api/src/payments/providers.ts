import { createHmac, timingSafeEqual } from 'node:crypto';

/*
   결제 제공자 (docs: 포인트 충전).

   AI 제공자와 같은 원칙: 애플리케이션은 이 추상화에만 의존하고, 자격증명이 없으면
   제공자는 **비활성(available:false)** 으로 정직하게 보고한다(임의 결제 성공을 만들지
   않는다). PayPal 은 동기 capture, USDT(크립토)는 웹훅 확인 모델이다.

   보안: 결제 성공 판정은 **서버가 제공자에 직접 확인**(PayPal capture 조회, 크립토
   웹훅 HMAC 검증)한 결과로만 내린다 — 클라이언트가 "결제됐다" 고 말해도 믿지 않는다.
*/

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  /** 'live' → api-m.paypal.com, 그 외 → sandbox */
  mode: 'live' | 'sandbox';
}

export interface CreatedPayPalOrder {
  providerRef: string; // PayPal order id
  approveUrl: string | null;
}

/** PayPal REST(주문 생성 + 캡처). SDK 없이 fetch 로 구현한다. */
export class PayPalProvider {
  readonly kind = 'paypal' as const;
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly cfg: PayPalConfig) {}

  private base(): string {
    return this.cfg.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await fetch(`${this.base()}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !body?.access_token) throw new Error(`paypal token failed: ${res.status}`);
    this.token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  /** 결제 주문 생성. custom_id 로 우리 주문 id 를 실어 웹훅/조회에서 대조한다. */
  async createOrder(input: { orderId: string; amount: string; currency: string; returnUrl: string; cancelUrl: string }): Promise<CreatedPayPalOrder> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base()}/v2/checkout/orders`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ custom_id: input.orderId, amount: { currency_code: input.currency, value: input.amount } }],
        application_context: { user_action: 'PAY_NOW', return_url: input.returnUrl, cancel_url: input.cancelUrl },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; links?: { rel: string; href: string }[] } | null;
    if (!res.ok || !body?.id) throw new Error(`paypal create failed: ${res.status}`);
    const approve = (body.links ?? []).find((l) => l.rel === 'approve');
    return { providerRef: body.id, approveUrl: approve?.href ?? null };
  }

  /**
   * 주문을 캡처(실제 결제 확정)한다. 성공(COMPLETED)일 때만 ok=true.
   * captured 금액/통화를 돌려줘 호출부가 주문 금액과 대조할 수 있게 한다.
   */
  async capture(providerRef: string): Promise<{ ok: boolean; status: string; amount?: string; currency?: string; customId?: string }> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base()}/v2/checkout/orders/${encodeURIComponent(providerRef)}/capture`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      purchase_units?: { custom_id?: string; payments?: { captures?: { amount?: { value?: string; currency_code?: string } }[] } }[];
    } | null;
    if (!res.ok || !body) return { ok: false, status: `http_${res.status}` };
    const pu = body.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    return {
      ok: body.status === 'COMPLETED',
      status: body.status ?? 'unknown',
      amount: cap?.amount?.value,
      currency: cap?.amount?.currency_code,
      customId: pu?.custom_id,
    };
  }

  /* ─────────────────────── 구독(정기결제) ─────────────────────── */

  /**
   * 플랜의 실제 금액·주기·상태를 읽는다.
   *
   * ★★ 왜 필요한가 — **화면 금액과 실제 청구가 어긋나는 것을 막는다.**
   *
   *   PayPal 대시보드에서 플랜 금액을 바꿀 수 있다. 그러면 우리 화면은 $19 를
   *   보여주는데 실제로는 다른 금액이 청구된다. 고객은 화면을 보고 결제하므로
   *   이 어긋남은 우리 책임이다. 부팅 때 대조해 어긋나면 결제를 막는다.
   *
   * ★ 던지지 않고 ok=false 를 돌려준다. 부팅 중 조회 실패가 서버를 못 띄우게 하면
   *   결제와 무관한 기능까지 멈춘다. 다만 **통과로 다루지도 않는다.**
   */
  async getPlan(planId: string): Promise<{
    ok: boolean; amount?: string; currency?: string;
    intervalUnit?: string; intervalCount?: number; status?: string;
  }> {
    try {
      const token = await this.accessToken();
      const res = await fetch(
        `${this.base()}/v1/billing/plans/${encodeURIComponent(planId)}`,
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
      );
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        billing_cycles?: Array<{
          tenure_type?: string;
          frequency?: { interval_unit?: string; interval_count?: number };
          pricing_scheme?: { fixed_price?: { value?: string; currency_code?: string } };
        }>;
      } | null;
      if (!res.ok || !body) return { ok: false, status: `http_${res.status}` };
      /*
         ★ REGULAR 주기를 고른다. TRIAL 이 있으면 그 금액이 0 이라서, 첫 주기를
           그냥 읽으면 "금액 0" 으로 보이고 대조가 틀린다.
      */
      const cycles = body.billing_cycles ?? [];
      const regular = cycles.find((c) => (c.tenure_type ?? '').toUpperCase() === 'REGULAR') ?? cycles[0];
      return {
        ok: true,
        amount: regular?.pricing_scheme?.fixed_price?.value,
        currency: regular?.pricing_scheme?.fixed_price?.currency_code,
        intervalUnit: regular?.frequency?.interval_unit,
        intervalCount: regular?.frequency?.interval_count,
        status: body.status,
      };
    } catch (e) {
      return { ok: false, status: `error_${(e as Error).message.slice(0, 40)}` };
    }
  }

  /**
   * 구독을 만든다. 고객이 `approveUrl` 에서 승인해야 실제로 시작된다.
   *
   * ★★ 주문(createOrder)과 **다른 API** 다. 주문은 한 번 받는 것이고 구독은 매달
   *   자동으로 청구된다. 하나로 합치면 "한 번만 받으려던 것이 매달 빠져나가는" 사고가
   *   난다 — 돈이 걸린 곳에서는 경로를 섞지 않는다.
   *
   * ★ `custom_id` 에 우리 사용자 id 를 싣는다. 승인 후 돌아올 때 누구의 구독인지
   *   PayPal 응답만으로 확인할 수 있어야 한다 — 화면이 알려주는 값을 믿으면 남의
   *   구독을 자기 것으로 만들 수 있다.
   *
   * ★ 승인 링크가 없으면 **실패로 다룬다.** 구독 객체만 만들어지고 링크가 없으면
   *   고객은 결제할 방법이 없는데 우리 DB 에는 "시작함" 이 남는다.
   */
  async createSubscription(input: {
    planId: string;
    userId: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ providerRef: string; approveUrl: string; status: string }> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base()}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        plan_id: input.planId,
        custom_id: input.userId,
        application_context: {
          user_action: 'SUBSCRIBE_NOW',
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          /* 배송지를 받지 않는다 — 소프트웨어이고, 받으면 불필요한 개인정보가 된다. */
          shipping_preference: 'NO_SHIPPING',
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as {
      id?: string; status?: string; links?: { rel: string; href: string }[];
      message?: string; name?: string;
      /*
         ★★ PayPal 은 어느 필드가 왜 틀렸는지 `details` 에 담아 준다. 예전에는 이것을
           버리고 name/message 만 남겨서, 오류가 "Request is not well-formed" 뿐이었다.
           그 문장만으로는 원인을 알 수 없다 — 실제로 return_url 이 상대 경로인 것을
           찾는 데 시간을 썼다. 돈이 걸린 경로에서 진단 정보를 버리면 안 된다.
      */
      details?: { field?: string; issue?: string; description?: string }[];
      debug_id?: string;
    } | null;
    if (!res.ok || !body?.id) {
      const detail = (body?.details ?? [])
        .map((d) => [d.field, d.issue, d.description].filter(Boolean).join(' '))
        .join(' | ');
      throw new Error(
        `paypal subscription create failed: ${res.status} ${body?.name ?? ''} ${body?.message ?? ''}`
        + `${detail ? ` — ${detail}` : ''}${body?.debug_id ? ` (debug_id=${body.debug_id})` : ''}`.trimEnd(),
      );
    }
    const approve = (body.links ?? []).find((l) => l.rel === 'approve');
    if (!approve?.href) throw new Error('paypal subscription created without approve link');
    return { providerRef: body.id, approveUrl: approve.href, status: body.status ?? 'APPROVAL_PENDING' };
  }

  /**
   * 구독 상태를 조회한다. **승인 여부를 우리가 직접 확인하는 유일한 경로다.**
   *
   * ★ 화면이 "승인했다" 고 말해도 믿지 않는다. PayPal 에 물어 ACTIVE 인지 본다 —
   *   돌아오는 URL 은 고객이 직접 열 수 있으므로 그것만으로 구독을 켜면 안 된다.
   *
   * ★ `customId` 를 함께 돌려준다. 호출부가 "이 구독이 정말 이 사용자 것인가" 를
   *   대조할 수 있어야 한다.
   */
  async getSubscription(providerRef: string): Promise<{
    /** ACTIVE 인가. confirm 라우트가 이 의미로 쓴다. */
    ok: boolean;
    /** ★ 조회 자체가 됐는가. 통신 실패와 "승인 전·취소됨" 을 구별하려면 이것을 본다. */
    lookupOk: boolean;
    status: string; customId?: string; planId?: string;
    nextBillingAt?: string; startedAt?: string;
  }> {
    const token = await this.accessToken();
    const res = await fetch(
      `${this.base()}/v1/billing/subscriptions/${encodeURIComponent(providerRef)}`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
    );
    const body = (await res.json().catch(() => null)) as {
      status?: string; custom_id?: string; plan_id?: string; start_time?: string;
      billing_info?: { next_billing_time?: string };
    } | null;
    /*
       ★★★ **조회 성공**과 **구독이 유효한가**를 구별해서 돌려준다.

         예전에는 `ok` 하나뿐이었고 그 뜻이 "ACTIVE 인가" 였다. 그래서 호출자가
         `ok:false` 를 보면 그것이
           · 통신 실패인지 (HTTP 500, 타임아웃)
           · 조회는 됐지만 아직 승인 전인지 (APPROVAL_PENDING)
           · 취소·정지된 것인지 (CANCELLED / SUSPENDED)
         구별할 수 없었다.

         실제로 그 때문에 대조 작업이 **승인 전·취소된 구독을 전부 '조회 실패' 로
         처리했다.** 결과가 안전한 쪽(활성화 안 함)이라 눈에 잘 띄지 않았지만,
         취소된 구독이 영원히 정리되지 않고 오류 로그만 쌓인다. 샌드박스로 실제
         호출해 보고 발견했다 — PayPal 은 HTTP 200 + APPROVAL_PENDING 을 정상
         반환하는데 우리가 ok:false 로 바꾸고 있었다.

       ★ `lookupOk` 는 **조회 자체가 됐는가**다. 상태 판단은 호출자가 `status` 로 한다.
       ★ `ok` 는 기존 뜻(ACTIVE)을 그대로 둔다 — confirm 라우트가 그 의미로 쓰고 있고,
         거기서는 "ACTIVE 가 아니면 켜지 않는다" 가 정확한 규칙이다.
    */
    if (!res.ok || !body) return { ok: false, lookupOk: false, status: `http_${res.status}` };
    return {
      lookupOk: true,
      /* ★ ACTIVE 만 유효하다. APPROVAL_PENDING·SUSPENDED·CANCELLED 는 권한을 주지 않는다. */
      ok: body.status === 'ACTIVE',
      status: body.status ?? 'unknown',
      customId: body.custom_id,
      planId: body.plan_id,
      nextBillingAt: body.billing_info?.next_billing_time,
      startedAt: body.start_time,
    };
  }

  /**
   * 구독을 해지한다.
   *
   * ★ 이미 해지된 구독에 다시 해지를 보내면 PayPal 이 422 를 준다. 그것을 실패로
   *   다루면 화면에 "해지 실패" 가 뜨는데 실제로는 해지돼 있다 — 고객이 다시
   *   누르게 만든다. 이미 해지된 상태는 성공으로 본다.
   */
  async cancelSubscription(providerRef: string, reason: string): Promise<{ ok: boolean; status: string }> {
    const token = await this.accessToken();
    const res = await fetch(
      `${this.base()}/v1/billing/subscriptions/${encodeURIComponent(providerRef)}/cancel`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.slice(0, 120) }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (res.status === 204) return { ok: true, status: 'CANCELLED' };
    /* 이미 해지된 경우도 성공으로 본다(위 주석). */
    const body = (await res.json().catch(() => null)) as { name?: string; message?: string } | null;
    const already = res.status === 422 && /already|SUBSCRIPTION_STATUS_INVALID/i.test(
      `${body?.name ?? ''} ${body?.message ?? ''}`,
    );
    return { ok: already, status: already ? 'ALREADY_CANCELLED' : `http_${res.status}` };
  }
}

export interface CryptoConfig {
  /** 수신 USDT 주소(정적 모드). 처리사를 쓰면 처리사가 주소를 발급하므로 선택. */
  usdtAddress?: string;
  /** USDT 네트워크 표시(예: TRC20 / ERC20). */
  network?: string;
  /** 웹훅 HMAC 검증 시크릿(처리사/자체 워처가 서명). 없으면 웹훅 검증 불가 → 비활성. */
  webhookSecret: string;
}

/**
 * USDT(크립토) 결제 — 인보이스 + 웹훅 확인 모델.
 *
 * createInvoice: 고객에게 보낼 수신 주소/금액/네트워크를 만든다(정적 주소 모드).
 * verifyWebhook: 처리사(또는 자체 온체인 워처)가 보낸 결제 확정 웹훅의 HMAC 서명을
 *   검증한다. 검증 통과 + 확정(confirmed)일 때만 적립한다.
 *
 * 자격증명(webhookSecret)이 없으면 이 제공자는 만들어지지 않는다(fail-closed).
 */
export class CryptoInvoiceProvider {
  readonly kind = 'usdt' as const;
  constructor(private readonly cfg: CryptoConfig) {}

  createInvoice(input: { orderId: string; amount: string }): { providerRef: string; address: string | null; network: string; amount: string } {
    // providerRef 는 우리 주문 id 로 둔다(웹훅이 이 값으로 주문을 지목). 처리사 연동 시
    // 처리사 invoice id 로 대체할 수 있다.
    return {
      providerRef: input.orderId,
      address: this.cfg.usdtAddress ?? null,
      network: this.cfg.network ?? 'TRC20',
      amount: input.amount,
    };
  }

  /** 원문 바디 + 서명 헤더로 HMAC-SHA256 검증. 서명 불일치면 false. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const mac = createHmac('sha256', this.cfg.webhookSecret).update(rawBody).digest('hex');
    try {
      const a = Buffer.from(mac);
      const b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

export interface PaymentProviders {
  paypal?: PayPalProvider;
  crypto?: CryptoInvoiceProvider;
  toss?: TossProvider;
}

/** 환경설정에서 사용 가능한 결제 제공자를 만든다. 자격증명이 없으면 그 제공자는 undefined. */
export function resolvePaymentProviders(env: {
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalMode?: string;
  cryptoWebhookSecret?: string;
  cryptoUsdtAddress?: string;
  cryptoNetwork?: string;
  tossClientKey?: string;
  tossSecretKey?: string;
}): PaymentProviders {
  const out: PaymentProviders = {};
  if (env.paypalClientId && env.paypalClientSecret) {
    out.paypal = new PayPalProvider({
      clientId: env.paypalClientId,
      clientSecret: env.paypalClientSecret,
      mode: env.paypalMode === 'live' ? 'live' : 'sandbox',
    });
  }
  /*
     ★★ 토스는 더 이상 제공하지 않는다 (심사 탈락, 운영 결정).

       제공자를 만들지 않으므로 /me/topup/toss/* 라우트가 503 을 주고, 화면도
       결제 수단 목록에서 토스를 감춘다(pages-points.jsx 가 이 값을 본다).

     ★ 왜 코드를 통째로 지우지 않는가
       · point_orders.provider 에 'toss' CHECK 제약과 **과거 주문 행**이 남아 있다
         (migration 0034). 타입에서 'toss' 를 빼면 지난 결제 이력을 읽을 수 없다.
       · 다른 국내 PG(네이버페이 등)로 재신청할 계획이 있어, 붙일 자리를 남겨 둔다.
       그래서 TossProvider 클래스와 타입은 남기고 **연결만 끊는다.**

     ★ 되살리는 방법: 아래 두 줄의 주석을 풀고 TOSS_CLIENT_KEY/TOSS_SECRET_KEY 를 넣는다.
  */
  // if (env.tossClientKey && env.tossSecretKey) {
  //   out.toss = new TossProvider({ clientKey: env.tossClientKey, secretKey: env.tossSecretKey });
  // }
  if (env.cryptoWebhookSecret) {
    out.crypto = new CryptoInvoiceProvider({
      webhookSecret: env.cryptoWebhookSecret,
      usdtAddress: env.cryptoUsdtAddress,
      network: env.cryptoNetwork,
    });
  }
  return out;
}

/** 포인트 패키지 카탈로그(서버 권위값). amount 는 USD/USDT, krw 는 토스(원화 정수)용. */
export interface PointPackage { id: string; points: number; amount: string; krw: number; }
export const POINT_PACKAGES: PointPackage[] = [
  { id: 'pack_10k', points: 10_000, amount: '9.99', krw: 13000 },
  { id: 'pack_55k', points: 55_000, amount: '49.99', krw: 69000 },
  { id: 'pack_120k', points: 120_000, amount: '99.99', krw: 139000 },
];
export function findPackage(id: string): PointPackage | undefined {
  return POINT_PACKAGES.find((p) => p.id === id);
}

/*
   Toss Payments (한국 결제). 클라이언트 위젯이 결제를 요청하고 successUrl 로
   paymentKey·orderId·amount 를 돌려주면, 서버가 secret 키로 /v1/payments/confirm 을
   호출해 **직접 확정**한다(클라이언트 말만 믿지 않음). 자격증명 없으면 비활성.
*/
export interface TossConfig { clientKey: string; secretKey: string; }
export class TossProvider {
  readonly kind = 'toss' as const;
  constructor(private readonly cfg: TossConfig) {}
  get clientKey(): string { return this.cfg.clientKey; }
  async confirm(input: { paymentKey: string; orderId: string; amount: number }): Promise<{ ok: boolean; status?: string; method?: string; message?: string }> {
    const auth = Buffer.from(`${this.cfg.secretKey}:`).toString('base64');
    const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({ paymentKey: input.paymentKey, orderId: input.orderId, amount: input.amount }),
    });
    const body = (await res.json().catch(() => null)) as { status?: string; method?: string; message?: string } | null;
    return { ok: res.ok && body?.status === 'DONE', status: body?.status, method: body?.method, message: body?.message };
  }
}
