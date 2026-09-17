import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');

/**
 * 공개 화면 라우트 정합성 — **세 목록이 어긋나면 두 화면이 겹쳐 그려진다.**
 *
 * ★★★ 실제로 그렇게 됐다 (프로덕션 실측 2026-09-17)
 *
 *     #/refund   → 환불정책(2688자) + **로그인 폼**(div.auth-shell 1007자)
 *     #/company  → 사업자 정보(308자) + **404 화면**(956자)
 *
 *   원인: `app.jsx` 의 auth 분기는 조건들을 각각 `&&` 로 걸어 렌더한다.
 *
 *     {['/terms',…,'/refund'].includes(route.path) && <LegalPage/>}
 *     {needsLogin && <LoginPage/>}
 *     {isNotFound && !needsLogin && <NotFoundPage/>}
 *
 *   서로를 배제하지 않으므로, 라우트가 `PUBLIC_ROUTES` 에 없으면 `needsLogin` 이 참이 되어
 *   **문서와 로그인 폼이 동시에** 그려진다. `ALL_KNOWN_ROUTES` 에 없으면 404 가 겹친다.
 *
 * ★ 환불 정책과 사업자 정보는 전자상거래법이 요구하는 표시 항목이다. 로그인해야 볼 수
 *   있거나 "찾을 수 없다" 가 함께 뜨면 표시 의무를 충족하지 못한다.
 */
describe('PUBLIC-ROUTES — 공개 화면이 다른 화면과 겹쳐 그려지지 않는다', () => {
  const appSrc = read('src/app.jsx');
  const app = stripComments(appSrc);
  const access = stripComments(read('src/access.js'));

  /** `ALL_KNOWN_ROUTES` 배열에 적힌 경로들. */
  const knownRoutes = (() => {
    const m = /const ALL_KNOWN_ROUTES = \[([\s\S]*?)\];/u.exec(app);
    expect(m, 'ALL_KNOWN_ROUTES 를 찾지 못했다').toBeTruthy();
    return [...m![1]!.matchAll(/'([^']+)'/gu)].map((x) => x[1]!);
  })();

  /** `PUBLIC_ROUTES` Set 에 적힌 경로들. */
  const publicRoutes = (() => {
    const m = /var PUBLIC_ROUTES = new Set\(\[([\s\S]*?)\]\);/u.exec(access);
    expect(m, 'PUBLIC_ROUTES 를 찾지 못했다').toBeTruthy();
    return [...m![1]!.matchAll(/'([^']+)'/gu)].map((x) => x[1]!);
  })();

  /**
   * `isAuthRoute` — 자체 레이아웃(헤더·사이드바 없음)을 쓰는 경로.
   *
   * ★★ 여기 없으면 auth 분기에 들어가지 못해 **빈 앱 셸**이 그려진다.
   *   수정 직후 `/company` 가 정확히 그 상태였다(div.app-shell 998자, 내용 없음).
   */
  const authRoutes = (() => {
    const m = /const isAuthRoute = \[([\s\S]*?)\]\.includes\(route\.path\);/u.exec(app);
    expect(m, 'isAuthRoute 를 찾지 못했다').toBeTruthy();
    return [...m![1]!.matchAll(/'([^']+)'/gu)].map((x) => x[1]!);
  })();

  /**
   * auth 분기에서 **로그인 없이** 그려지는 화면들.
   *
   * ★ `route.path === '/x' &&` 형태와 `[…].includes(route.path) &&` 형태 둘 다 잡는다.
   */
  const renderedPublic = (() => {
    const branch = /if \(isAuthRoute \|\| isNotFound\) \{([\s\S]*?)\n {4}\}/u.exec(app);
    expect(branch, 'auth 렌더 분기를 찾지 못했다').toBeTruthy();
    const b = branch![1]!;
    const out = new Set<string>();
    for (const m of b.matchAll(/route\.path === '([^']+)'\s*&&/gu)) out.add(m[1]!);
    for (const m of b.matchAll(/\[([^\]]*)\]\.includes\(route\.path\)\s*&&/gu)) {
      for (const r of m[1]!.matchAll(/'([^']+)'/gu)) out.add(r[1]!);
    }
    return [...out];
  })();

  it('[1] 렌더 목록을 실제로 뽑아냈다 (검사가 헛돌지 않는다)', () => {
    expect(renderedPublic.length, `auth 분기에서 찾은 경로가 너무 적다: ${renderedPublic.join(', ')}`)
      .toBeGreaterThanOrEqual(8);
    expect(renderedPublic).toContain('/terms');
    expect(renderedPublic).toContain('/login');
  });

  it('[2] ★★★ auth 분기에서 그리는 모든 경로가 ALL_KNOWN_ROUTES 에 있다', () => {
    /*
       ★ 없으면 `isNotFound` 가 참이 되어 **404 화면이 함께** 그려진다.
         `/company` 가 정확히 그 상태였다.
    */
    const missing = renderedPublic.filter((r) => !knownRoutes.includes(r));
    expect(missing, `ALL_KNOWN_ROUTES 에 없다 → 404 화면이 겹쳐 그려진다: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('[3] ★★★ auth 분기에서 그리는 모든 경로가 PUBLIC_ROUTES 에 있다', () => {
    /*
       ★ 없으면 `needsLogin` 이 참이 되어 **로그인 폼이 함께** 그려진다.
         `/refund` 가 정확히 그 상태였다(환불정책 + 로그인 폼).
    */
    const missing = renderedPublic.filter((r) => !publicRoutes.includes(r));
    expect(missing, `PUBLIC_ROUTES 에 없다 → 로그인 폼이 겹쳐 그려진다: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('[4] ★★ 세 목록이 함께 맞는다 — 하나만 넣으면 다른 방식으로 깨진다', () => {
    /*
       ★★★ 실제로 세 가지 깨짐을 순서대로 겪었다:

           PUBLIC_ROUTES 없음     → 로그인 폼이 겹친다   (#/refund)
           ALL_KNOWN_ROUTES 없음  → 404 가 겹친다        (#/company)
           isAuthRoute 없음       → 빈 앱 셸이 그려진다  (#/company, 첫 수정 직후)

         그래서 세 목록을 **함께** 검사한다. 하나만 보면 고친 줄 알고 다음 형태로
         깨진 것을 놓친다.
    */
    for (const r of authRoutes) {
      expect(knownRoutes, `isAuthRoute 에 있는 ${r} 가 ALL_KNOWN_ROUTES 에 없다 → 404 겹침`)
        .toContain(r);
      expect(publicRoutes, `isAuthRoute 에 있는 ${r} 가 PUBLIC_ROUTES 에 없다 → 로그인 폼 겹침`)
        .toContain(r);
    }
    /* 반대 방향: auth 분기에서 그리는데 자체 레이아웃 목록에 없으면 빈 앱 셸이 된다. */
    const notAuth = renderedPublic.filter((r) => !authRoutes.includes(r));
    expect(notAuth, `auth 분기에서 그리는데 isAuthRoute 에 없다 → 빈 앱 셸: ${notAuth.join(', ')}`)
      .toEqual([]);
  });

  it('[5] 법정 표시 화면은 반드시 공개다 (환불정책·사업자정보 포함)', () => {
    /*
       ★ 전자상거래법이 요구하는 표시 항목이다. 로그인해야 볼 수 있으면 표시 의무를
         충족하지 못한다. 이름을 박아 두는 이유: 목록을 줄이는 변경을 막기 위해서다.
    */
    for (const r of ['/terms', '/privacy', '/risk', '/security', '/refund', '/company']) {
      expect(publicRoutes, `${r} 가 공개 라우트가 아니다`).toContain(r);
      expect(knownRoutes, `${r} 가 알려진 라우트가 아니다`).toContain(r);
      expect(authRoutes, `${r} 가 자체 레이아웃 목록에 없다`).toContain(r);
    }
  });

  it('[6] 푸터가 링크하는 화면이 실제로 존재한다', () => {
    /*
       ★ 푸터 링크가 404 로 가면 표시 의무가 깨진다. `#/company` 가 그랬다 —
         링크는 있었고 렌더 블록도 있었는데 라우트 목록에 없었다.
    */
    const links = [...appSrc.matchAll(/href="#(\/[a-z-]+)"/gu)].map((m) => m[1]!);
    const uniq = [...new Set(links)];
    expect(uniq.length, '푸터/본문 링크를 찾지 못했다').toBeGreaterThan(3);
    const dead = uniq.filter((r) => !knownRoutes.includes(r) && r !== '/');
    expect(dead, `링크는 있는데 라우트 목록에 없다(404 로 간다): ${dead.join(', ')}`).toEqual([]);
  });
});
