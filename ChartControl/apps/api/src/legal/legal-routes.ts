/**
 * 법적 문서 — 사용자용 라우터.
 *
 * ★ 인증이 필요 없다. 회원가입 **전에** 약관을 읽어야 하기 때문이다.
 *   로그인해야 약관을 볼 수 있으면 동의 대상을 모르고 가입하는 셈이다.
 *
 * ★ 문서가 없으면 404 가 아니라 200 + `available: false` 로 답한다.
 *   화면이 "아직 게시되지 않았습니다 + 문의처" 를 보여줄 수 있어야 한다.
 *   404 는 링크가 깨진 것처럼 보이고, 콘솔도 오염된다.
 */

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';

import { AuthService, verifyCsrf, originAllowed } from '@quantumtrade/auth';

import { LEGAL_KINDS, type LegalKind, type PgLegalRepo } from '../db/legal-repo';

export interface LegalRouterDeps {
  service: AuthService;
  repo?: PgLegalRepo;
  cookieName: string;
  supportEmail: string;
  /**
   * CSRF 서명 키와 쿠키 이름. 동의 기록은 상태를 바꾸므로 보호가 필요하다.
   *
   * ★ 없으면 POST 라우트를 **등록하지 않는다.** 보호 없이 동의를 기록하면
   *   제3자 사이트가 고객 대신 동의를 남길 수 있다.
   */
  csrf?: { key: string; cookieName: string; corsOrigins: readonly string[] };
}

const isKind = (v: string): v is LegalKind => (LEGAL_KINDS as readonly string[]).includes(v);

/**
 * 요청 언어 판정.
 *
 * ★ 쿼리 파라미터를 먼저 본다 — 화면이 사용자가 고른 언어를 알고 있고,
 *   브라우저 설정보다 그것이 정확하다.
 */
function pickLocale(c: Context): string {
  const q = String(c.req.query('locale') ?? '').trim();
  if (q && /^[a-zA-Z-]{2,10}$/.test(q)) return q;
  const header = c.req.header('accept-language') ?? '';
  const first = header.split(',')[0]?.trim();
  return first && /^[a-zA-Z-]{2,10}$/.test(first) ? first : 'en';
}

export function createLegalRouter(d: LegalRouterDeps): Hono {
  const app = new Hono();

  /** 문서 하나 (약관·개인정보·위험고지·보안). 인증 불필요. */
  app.get('/legal/:kind', async (c) => {
    const kind = String(c.req.param('kind'));
    if (!isKind(kind)) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'unknown document kind' } }, 400);
    }
    const locale = pickLocale(c);

    if (!d.repo) {
      /*
         Postgres 가 없는 배포.

         법적 문서를 파일에 넣어 대신 보여주지 않는다 — 어느 버전에 동의했는지
         기록할 수 없고, 문구가 코드와 함께 배포되면 법무 검토 흐름이 깨진다.
      */
      return c.json({ available: false, reason: 'not_configured', kind, supportEmail: d.supportEmail });
    }

    const doc = await d.repo.liveFor(kind, locale);
    if (!doc) {
      return c.json({ available: false, reason: 'not_published', kind, supportEmail: d.supportEmail });
    }
    return c.json({
      available: true,
      kind: doc.kind,
      // 요청 언어와 다를 수 있다 (대체된 경우). 화면이 그 사실을 알려야 한다.
      locale: doc.locale,
      requestedLocale: locale,
      version: doc.version,
      title: doc.title,
      body: doc.body,
      effectiveAt: doc.effectiveAt,
      publishedAt: doc.publishedAt,
    });
  });

  /**
   * 지금 게시된 문서 목록.
   *
   * 회원가입 화면이 "동의 대상이 실제로 존재하는지" 를 확인하는 데 쓴다.
   * 없으면 동의 체크박스를 그대로 두면 안 된다.
   */
  app.get('/legal', async (c) => {
    if (!d.repo) return c.json({ available: false, documents: [] });
    const rows = await d.repo.publishedKinds();
    return c.json({ available: true, documents: rows });
  });

  /**
   * 내가 동의한 기록.
   *
   * ★ 사용자가 자기 동의 기록을 볼 수 있어야 한다. "나는 그런 데 동의한 적
   *   없다" 는 분쟁의 절반은 확인할 방법이 없어서 생긴다.
   */
  app.get('/legal/me/consents', async (c) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    if (!v) return c.json({ error: { code: 'UNAUTHENTICATED', message: '' } }, 401);
    if (!d.repo) return c.json({ available: false, consents: [], pending: [] });

    const locale = pickLocale(c);
    const [consents, pending] = await Promise.all([
      d.repo.consentsOf(v.user.id),
      d.repo.pendingConsents(v.user.id, locale),
    ]);
    return c.json({ available: true, consents, pending });
  });

  /**
   * 미동의 필수 문서에 동의를 기록한다.
   *
   * ★★ 왜 필요한가 — **구글 가입은 동의를 받을 수 없었다.**
   *
   *   구글은 리다이렉트로 돌아오므로 우리 가입 화면(체크박스)을 거치지 않는다.
   *   그래서 구글로 들어온 고객은 약관·개인정보·위험고지에 동의한 기록이 **하나도
   *   없는 상태로** 거래 화면까지 들어갔다. 이 라우트와 동의 화면이 그 구멍을 막는다.
   *
   * ★ 본문의 문서 ID 를 믿지 않는다. 서버가 계산한 미동의 목록에 있는 것만 기록한다 —
   *   클라이언트가 아무 ID나 보내 원하지 않는 문서에 동의를 남기게 하면 안 된다.
   * ★ 필수 3종이 모두 게시돼 있지 않으면 **아무것도 기록하지 않는다**(부분 동의 금지).
   * ★ 이미 동의한 것은 조용히 넘어간다(멱등) — 화면을 두 번 눌러도 오류가 나지 않는다.
   */
  if (d.csrf) {
    const cs = d.csrf;
    app.post('/legal/me/consents', async (c) => {
      const raw = getCookie(c, d.cookieName);
      const v = raw ? await d.service.validateSession(raw) : null;
      if (!v) return c.json({ error: { code: 'UNAUTHENTICATED', message: '' } }, 401);

      /* ★ Origin 검사 + 세션에 묶인 서명 토큰. 둘 다 본다. */
      if (!originAllowed(c.req.header('origin'), c.req.header('referer'), [...cs.corsOrigins])) {
        return c.json({ error: { code: 'CSRF_FAILED', message: 'origin not allowed' } }, 403);
      }
      if (!verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, cs.cookieName), v.session.csrfSecret, cs.key)) {
        return c.json({ error: { code: 'CSRF_FAILED', message: 'csrf validation failed' } }, 403);
      }

      if (!d.repo) {
        /*
           ★ 저장소가 없으면 성공이라고 답하지 않는다. 동의를 기록할 수 없는데
             기록했다고 답하면, 화면이 고객을 통과시키고 증거는 남지 않는다.
        */
        return c.json({ error: { code: 'LEGAL_UNAVAILABLE', message: 'consent store unavailable' } }, 503);
      }

      const locale = pickLocale(c);
      const pending = await d.repo.pendingConsents(v.user.id, locale);
      const required = await d.repo.requiredConsentDocs(locale);
      if (required.length === 0) {
        /* 필수 문서가 다 게시되지 않았다 — 받을 수 없는 동의를 받았다고 하지 않는다. */
        return c.json({ error: { code: 'LEGAL_NOT_PUBLISHED', message: 'required documents are not published' } }, 503);
      }

      const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
        ?? c.req.header('x-real-ip') ?? null;
      const recorded: string[] = [];
      for (const doc of pending) {
        try {
          const r = await d.repo.recordConsent({ userId: v.user.id, documentId: doc.documentId, ip });
          if (r) recorded.push(r.kind);
        } catch (e) {
          /* ★ 한 건이라도 실패하면 성공이라고 답하지 않는다. */
          console.warn(`[legal] 동의 기록 실패 user=${v.user.id} doc=${doc.documentId}: ${(e as Error).message}`);
          return c.json({ error: { code: 'CONSENT_FAILED', message: 'could not record consent' } }, 500);
        }
      }

      /* ★ 남은 미동의를 다시 계산해 돌려준다 — 화면이 통과 여부를 스스로 판단하지 않게. */
      const stillPending = await d.repo.pendingConsents(v.user.id, locale);
      return c.json({ ok: true, recorded, pending: stillPending });
    });
  }

  return app;
}
