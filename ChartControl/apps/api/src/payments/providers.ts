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
