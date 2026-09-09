/**
 * CSP 를 좁힌 것이 되돌아가지 않게 고정한다.
 *
 * ★★ 무엇을 뺐나 (2026-09-08)
 *
 *   · script-src 의 `'unsafe-eval'` — 브라우저 Babel 변환을 없애고 web-dist/ 로
 *     사전 컴파일하게 되면서 필요 없어졌다. eval 은 주입된 문자열을 코드로 실행시키는
 *     가장 쉬운 길이다.
 *   · 외부 CDN(unpkg·jsdelivr) — 실서비스 화면은 쓰지 않는다. 허용 목록에 남겨 두면
 *     나중에 누군가 외부 링크를 넣어도 CSP 가 막지 않고, 그러면 이용자 IP 가 제3자로
 *     나가 개인정보처리방침 4절과 어긋난다.
 *
 * ★ CDN 을 뺄 수 있게 된 전제: `design-library/` 를 운영에서 서빙하지 않는다.
 *   그 문서들이 CDN 을 쓰고 CSP 는 오리진 전체에 적용되므로, 경로를 막지 않으면
 *   CSP 를 좁힐 수 없다. **이 전제가 깨지면 그 화면이 조용히 깨진다.**
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

describe('CSP — 좁힌 상태 유지', () => {
  it("script-src 에 'unsafe-eval' 이 없다", () => {
    const src = read('../index.ts');
    const at = src.indexOf('scriptSrc:');
    expect(at).toBeGreaterThan(-1);
    const line = src.slice(at, src.indexOf('\n', at));
    expect(line, `되돌아갔다: ${line.trim()}`).not.toContain('unsafe-eval');
  });

  it('CSP 지시문에 외부 CDN 이 없다', () => {
    const src = read('../index.ts');
    /* 지시문 줄만 본다 — 설명 주석에는 왜 뺐는지 적혀 있어야 한다. */
    for (const key of ['scriptSrc:', 'scriptSrcElem:', 'styleSrc:', 'fontSrc:']) {
      const at = src.indexOf(key);
      expect(at, `${key} 를 찾지 못했다`).toBeGreaterThan(-1);
      const line = src.slice(at, src.indexOf('\n', at));
      expect(line, `${key} 에 CDN 이 남아 있다`).not.toMatch(/CDN|unpkg|jsdelivr/);
    }
  });

  it('실서비스 화면에 외부 도메인 참조가 없다 (CDN 을 뺄 근거)', () => {
    const html = read('../../../../index.html');
    /* 주석은 제외하고 실제 태그만 본다. */
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
    /*
       ★★ 이 시험이 막으려는 것은 **외부 CDN 에서 코드·폰트를 받아오는 것**이다
         (개인정보처리방침에 없는 제3자 전달 + CSP 를 넓혀야 하는 이유가 된다).

       ★ 그런데 **자기 도메인을 가리키는 절대 URL 은 다르다.** og:image·og:url·
         canonical 은 규격상 절대 URL 이어야 한다 — 상대 경로를 쓰면 대부분의
         플랫폼과 검색엔진이 무시한다. 그것까지 막으면 공유 카드와 색인을 고칠 수
         없다(실제로 이 시험이 그 수정을 막았다).

       ★ 그래서 **우리 도메인은 허용하고 그 밖의 도메인만 막는다.** 도메인 목록을
         여기 한 곳에 둔다 — 늘어나면 눈에 띈다.

       ★ 그리고 og:image 등은 src/href 가 아니라 content= 로 들어간다. 원래 정규식이
         못 잡던 자리이므로 content= 도 함께 본다 — 여기로 외부 CDN 이 들어올 수 있다.
    */
    const OWN_HOSTS = ['chartcontrol.onrender.com'];
    const refs = stripped.match(/(?:src|href|content)="https?:\/\/[^"]+"/g) ?? [];
    const external = refs.filter((r) => {
      const url = r.replace(/^[a-z]+="/, '').replace(/"$/, '');
      try {
        return !OWN_HOSTS.includes(new URL(url).hostname);
      } catch {
        return true; /* 파싱 안 되는 값은 문제로 본다 */
      }
    });
    expect(external, `외부 도메인 참조가 생겼다: ${external.join(', ')}`).toEqual([]);
  });

  it('운영에서 design-library 를 서빙하지 않는다 (CDN 을 뺄 수 있는 전제)', () => {
    const src = read('../static-web.ts');
    expect(src).toContain('PRODUCTION_BLOCKED_DIRS');
    expect(src).toMatch(/PRODUCTION_BLOCKED_DIRS\s*=\s*\['design-library'\]/);
    /* 개발에서는 열려야 한다 — 조건 없이 막으면 디자이너 작업이 끊긴다. */
    const at = src.indexOf('function isAllowedTarget');
    const fn = src.slice(at, src.indexOf('\n}', at));
    expect(fn).toContain('isProduction()');
  });

  it("'unsafe-inline' 은 아직 남아 있고, 그 사실을 숨기지 않는다", () => {
    /*
       ★ 과장하지 않는다. inline 이 남아 있으면 CSP 가 XSS 를 완전히 막지 못한다.
         주석이 그 사실을 적고 있어야 한다 — "CSP 있음 = 안전" 으로 읽히면 안 된다.
    */
    const src = read('../index.ts');
    expect(src).toContain("'unsafe-inline'");
    expect(src).toMatch(/XSS 를 (완전히 )?막(지|기)/);
  });
});
