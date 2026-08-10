/**
 * 친구 초대(리퍼럴) — 사용자용 라우터.
 *
 * 이 라우터가 하지 않는 것
 * ---------------------
 * · **적립 예정액을 계산하지 않는다.** 우리 수익은 거래소가 산정한 리베이트이고
 *   그 금액은 거래소 대시보드에만 있다. 추정치를 보여주면 실제 지급액과 어긋나
 *   분쟁이 된다. 단계별 인원과 실제 지급 기록만 돌려준다.
 *
 * · **자동 지급하지 않는다.** 비수탁이라 사용자 계정에 돈을 넣을 방법이 없다.
 *   지급은 운영자가 외부 수단으로 실행하고 기록한다.
 *
 * 제도가 꺼져 있으면 코드를 발급하지 않고 `enabled: false` 를 준다.
 * 화면은 그 값으로 "아직 시작하지 않았습니다" 를 보여준다 — 코드를 먼저 주면
 * 사용자가 공유하고 보상을 기다린다.
 */

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';

import { AuthService, type PublicUser } from '@quantumtrade/auth';

import type { PgReferralRepo } from '../db/referral-repo';

export interface ReferralRouterDeps {
  service: AuthService;
  /** Postgres 배포에만 있다. 없으면 제도를 사용할 수 없다고 알린다. */
  repo?: PgReferralRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
  /**
   * 공개 가입 주소의 기준(선택).
   *
   * 초대 링크를 서버가 만들어 주기 위해 필요하다. 설정이 없으면 링크를 만들지
   * 않고 코드만 준다 — 열리지 않는 주소를 주면 사용자가 그것을 공유한다.
   */
  publicBaseUrl?: string;
}

const err = (code: string, message: string) => ({ error: { code, message } });

export function createReferralRouter(d: ReferralRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };

  /*
     이 라우터에는 변경 동작이 없다 — 조회만 한다.

     그래서 CSRF 검증도 필요 없다(CSRF 는 상태를 바꾸는 요청을 막는 장치다).
     코드 발급은 GET /referral/me 안에서 일어나지만 멱등이고 사용자 자신의
     것만 만든다. 나중에 변경 동작을 추가하면 csrfOk 를 반드시 되살려야 한다 —
     deps 에 csrfKey·verifyCsrf 를 남겨둔 이유다.
  */

  /** 초대 링크. 기준 주소가 없으면 만들지 않는다. */
  const linkFor = (code: string): string | null => {
    const base = (d.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base) return null;
    return `${base}/index.html#/signup?ref=${encodeURIComponent(code)}`;
  };

  /**
   * 내 초대 현황.
   *
   * 제도가 꺼져 있으면 코드 없이 조건만 돌려준다. 켜져 있으면 이 시점에
   * 코드를 발급한다(멱등) — 사용자가 화면을 열 때 발급하는 것이 가장 단순하고,
   * 가입 시점 발급은 제도가 나중에 켜진 사용자를 놓친다.
   */
  app.get('/referral/me', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) {
      return c.json({
        supported: false, enabled: false,
        reason: 'referral requires the PostgreSQL backend',
      });
    }

    try {
      const settings = await d.repo.getSettings();
      if (!settings.enabled) {
        // 코드를 만들지 않는다. 조건만 알려준다.
        return c.json({ supported: true, enabled: false, settings: { enabled: false } });
      }

      const code = await d.repo.issueCode(a.user.id);
      const [summary, signups, payouts] = await Promise.all([
        d.repo.summaryFor(a.user.id),
        d.repo.listByReferrer(a.user.id, 100),
        d.repo.listPayouts(a.user.id, 50),
      ]);

      return c.json({
        supported: true,
        enabled: true,
        code: code ? code.code : null,
        link: code ? linkFor(code.code) : null,
        settings: {
          enabled: true,
          sharePct: settings.sharePct,
          minPayout: settings.minPayout,
          payoutCurrency: settings.payoutCurrency,
          payoutNote: settings.payoutNote,
        },
        summary,
        /*
           초대받은 사람의 이메일을 그대로 주지 않는다.

           초대자가 상대의 이메일 전체를 볼 이유가 없다 — 누가 가입했는지는
           본인이 알려주는 것이고, 우리가 노출하면 개인정보 문제가 된다.
           단계 확인에 필요한 만큼만 가린다.
        */
        signups: signups.map((s) => ({
          id: s.id,
          maskedEmail: maskEmail(s.referredEmail),
          signedUpAt: s.signedUpAt,
          emailVerifiedAt: s.emailVerifiedAt,
          keysConnectedAt: s.keysConnectedAt,
          firstTradeAt: s.firstTradeAt,
          sharePctAtSignup: s.sharePctAtSignup,
        })),
        payouts: payouts.map((p) => ({
          id: p.id, amount: p.amount, currency: p.currency,
          method: p.method, reference: p.reference,
          periodStart: p.periodStart, periodEnd: p.periodEnd,
          paidAt: p.paidAt,
        })),
        /*
           ★ 화면이 반드시 표시해야 하는 사실.

           적립 예정액을 우리가 계산하지 않는다는 것, 그리고 지급이 자동이
           아니라는 것. 이 두 문장이 없으면 사용자는 잔액이 쌓이고 자동으로
           입금될 것으로 기대한다.
        */
        disclosures: {
          accrualComputed: false,
          autoPayout: false,
        },
      });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /**
   * 코드 유효성 확인 (가입 화면에서 쓴다).
   *
   * 인증이 필요 없다 — 가입 전에 호출한다.
   * ★ 초대자가 누구인지 알려주지 않는다. 코드를 넣어보며 다른 사용자의
   *   존재나 이메일을 알아내는 것을 막는다. 유효 여부만 준다.
   */
  app.get('/referral/check', async (c) => {
    const raw = c.req.query('code') || '';
    if (!d.repo) return c.json({ valid: false, supported: false });

    try {
      const settings = await d.repo.getSettings();
      if (!settings.enabled) return c.json({ valid: false, supported: true, enabled: false });

      const code = await d.repo.findCode(raw);
      return c.json({
        supported: true,
        enabled: true,
        valid: Boolean(code && !code.disabled),
        sharePct: settings.sharePct,
      });
    } catch (e) {
      // 확인 실패를 '무효' 로 답하지 않는다 — 유효한 코드가 버려질 수 있다.
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  return app;
}

/**
 * 이메일 가리기.
 *
 * 'noticetest@x.local' → 'no***@x.local'
 * 앞 두 글자와 도메인만 남긴다. 본인이 초대한 사람이 맞는지 확인할 수 있는
 * 최소한만 보여준다.
 */
function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, Math.min(6, local.length - head.length)))}${domain}`;
}
