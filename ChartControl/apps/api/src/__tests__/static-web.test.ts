/**
 * 정적 서빙 경로 안전성 검증.
 *
 * 왜 중요한가
 * ----------
 * 이 핸들러는 프로젝트 루트 아래 파일을 HTTP 로 내보낸다. 경로 검증이 뚫리면
 * `.env`, `.data/chartcontrol.db`(세션·사용자 테이블), `~/.ssh` 까지 읽힌다.
 * 그래서 순회 시도를 하나하나 테스트로 고정한다.
 *
 * 프레임워크의 정적 미들웨어를 쓰지 않는 이유는 static-web.ts 헤더 주석 참고
 * (GHSA-frvp-7c67-39w9 를 구조적으로 도달 불가하게 유지한다).
 */

import { describe, expect, it } from 'vitest';
import { resolve, sep, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

import { STATIC_DIRS, STATIC_ROOT_FILES, resolveWebRoot, safeJoin } from '../static-web';

const ROOT = resolve('/srv/app');

describe('safeJoin — 정상 경로', () => {
  it.each([
    ['index.html', 'index.html'],
    ['src/app.jsx', `src${sep}app.jsx`],
    ['vendor/klinecharts/klinecharts.min.js', `vendor${sep}klinecharts${sep}klinecharts.min.js`],
    ['design-library/index.html', `design-library${sep}index.html`],
  ])('%s 를 루트 안 경로로 해석한다', (input, expectedTail) => {
    const out = safeJoin(ROOT, input);
    expect(out).toBe(resolve(ROOT, expectedTail));
  });

  it('퍼센트 인코딩된 정상 파일명을 디코딩한다', () => {
    expect(safeJoin(ROOT, 'src/a%20b.css')).toBe(resolve(ROOT, `src${sep}a b.css`));
  });
});

describe('safeJoin — 순회 차단', () => {
  it.each([
    ['../etc/passwd', '상위 탈출'],
    ['../../.env', '두 단계 상위'],
    ['src/../../.env', '중간 상위'],
    ['src/../../../root/.ssh/id_rsa', '깊은 상위'],
    ['%2e%2e/.env', '인코딩된 점두개'],
    ['%2e%2e%2f%2e%2e%2f.env', '전부 인코딩'],
    ['..%2f..%2f.env', '혼합'],
  ])('%s (%s) 를 거부한다', (bad) => {
    expect(safeJoin(ROOT, bad)).toBeNull();
  });

  it.each([
    ['..\\.env', '백슬래시 상위'],
    ['src\\..\\..\\.env', '백슬래시 혼합'],
    ['%5c%5c.env', '인코딩된 백슬래시'],
    ['src%5C..%5C..%5C.env', 'GHSA 재현 형태'],
  ])('%s (%s) 를 거부한다 — 백슬래시는 어떤 플랫폼에서도 허용하지 않는다', (bad) => {
    // GHSA-frvp-7c67-39w9 의 진입점이 이 형태였다. 리눅스에서는 백슬래시가
    // 경로 구분자가 아니지만, 플랫폼에 의존하지 않도록 일괄 거부한다.
    expect(safeJoin(ROOT, bad)).toBeNull();
  });

  it('널 바이트를 거부한다', () => {
    expect(safeJoin(ROOT, 'src/app.jsx\0.png')).toBeNull();
    expect(safeJoin(ROOT, 'src/app.jsx%00.png')).toBeNull();
  });

  it('잘못된 퍼센트 인코딩을 거부한다', () => {
    // decodeURIComponent 가 던지는 입력. 예외를 밖으로 흘리지 않고 거부한다.
    expect(safeJoin(ROOT, '%')).toBeNull();
    expect(safeJoin(ROOT, '%zz')).toBeNull();
  });

  it('빈 경로와 현재 디렉터리를 거부한다', () => {
    expect(safeJoin(ROOT, '')).toBeNull();
    expect(safeJoin(ROOT, '.')).toBeNull();
  });

  it('절대경로를 루트 기준으로 강제한다', () => {
    // 선행 슬래시를 떼므로 /etc/passwd 는 <root>/etc/passwd 가 된다.
    // 루트 밖으로 나가지 않는 것이 핵심이다 (실제 존재 여부는 화이트리스트가 막는다).
    const out = safeJoin(ROOT, '/etc/passwd');
    expect(out).toBe(resolve(ROOT, `etc${sep}passwd`));
    expect(out!.startsWith(ROOT + sep)).toBe(true);
  });

  it('어떤 입력도 루트 밖을 가리키지 않는다', () => {
    const attacks = [
      '../../../../../../etc/shadow',
      '....//....//.env',
      'src/./../../.env',
      '%2e%2e%5c%2e%2e%5c.env',
      'vendor/../../../.data/chartcontrol.db',
    ];
    for (const a of attacks) {
      const out = safeJoin(ROOT, a);
      if (out !== null) {
        expect(out === ROOT || out.startsWith(ROOT + sep), `${a} → ${out}`).toBe(true);
      }
    }
  });
});

describe('화이트리스트', () => {
  it('민감한 디렉터리는 서빙 대상에 없다', () => {
    const dirs = STATIC_DIRS as readonly string[];
    for (const forbidden of ['.data', 'node_modules', 'apps', 'packages', 'server', '.git']) {
      expect(dirs).not.toContain(forbidden);
    }
  });

  it('민감한 파일은 루트 서빙 대상에 없다', () => {
    const files = STATIC_ROOT_FILES as readonly string[];
    for (const forbidden of ['.env', '.env.example', 'package.json', 'pnpm-lock.yaml']) {
      expect(files).not.toContain(forbidden);
    }
  });

  it('★★ index.html 이 참조하는 루트 파일이 실제로 존재하고 서빙된다', () => {
    /*
       ★★★ 메타 태그만 넣고 파일을 열지 않으면 **고친 것이 아니다.**

         og:image 가 404 면 공유 카드는 여전히 **제목만 있는 회색 칸**으로 나온다.
         그리고 그 사실은 링크를 실제로 공유해 보지 않으면 드러나지 않는다 —
         화면에서는 아무 문제도 보이지 않는다.

       ★ 그래서 index.html 을 읽어 참조된 루트 파일을 뽑고,
           (1) 파일이 디스크에 있는지
           (2) STATIC_ROOT_FILES 에 있는지
         둘 다 확인한다. 하나만 봐도 놓친다 — 파일은 있는데 서빙 목록에 없거나,
         목록에는 있는데 파일이 없을 수 있다.
    */
    const root = resolve(__dirname, '../../../..');
    const html = readFileSync(join(root, 'index.html'), 'utf-8');
    /* content="https://…/파일" 과 href="/파일" 양쪽을 본다. */
    const refs = new Set<string>();
    for (const m of html.matchAll(/(?:content|href)="(?:https?:\/\/[^"/]+)?\/([A-Za-z0-9._-]+\.(?:png|svg|ico|txt|xml))"/g)) {
      if (m[1]) refs.add(m[1]);
    }
    expect(refs.size, 'index.html 에서 루트 파일 참조를 하나도 못 찾았다 — 정규식이 낡았다')
      .toBeGreaterThan(0);
    for (const f of refs) {
      expect(existsSync(join(root, f)), `${f} 를 index.html 이 참조하는데 파일이 없다`).toBe(true);
      expect(STATIC_ROOT_FILES as readonly string[], `${f} 가 STATIC_ROOT_FILES 에 없어 404 가 된다`)
        .toContain(f);
    }
  });

  it('★★★ index.html 이 참조하는 web-dist 파일이 모두 빌드된다 (지연 로드 포함)', () => {
    /*
       ★★★ 관리자 화면을 `#/admin` 일 때만 붙이도록 바꿨더니 `<script src>` 태그가
         사라졌고, build-web.mjs 가 **그 두 파일을 아예 컴파일하지 않았다.**
         프로덕션에서 web-dist/pages-admin.js 가 **404** 가 됐다.

       ★★ 로컬에는 예전 빌드 결과가 남아 있어서 `ls` 로는 정상처럼 보였다.
         프로덕션에 배포한 뒤 실제로 눌러보고서야 드러났다 — 그래서 시험으로 고정한다.

       ★ 태그든 인라인 문자열이든 index.html 이 참조하는 web-dist/*.js 는
         (1) 원본 src/*.jsx 가 있고 (2) 빌드 결과가 있어야 한다.
    */
    const root = resolve(__dirname, '../../../..');
    const html = readFileSync(join(root, 'index.html'), 'utf-8');
    const names = new Set<string>();
    /* <script src="web-dist/x.js"> 와 인라인 문자열 'web-dist/x.js' 양쪽. */
    for (const m of html.matchAll(/['"`]web-dist\/([A-Za-z0-9._-]+)\.js['"`]/g)) {
      if (m[1]) names.add(m[1]);
    }
    expect(names.size, 'index.html 에서 web-dist 참조를 찾지 못했다').toBeGreaterThan(10);
    const missing: string[] = [];
    for (const n of names) {
      const hasSrc = existsSync(join(root, `src/${n}.jsx`));
      const hasOut = existsSync(join(root, `web-dist/${n}.js`));
      /*
         ★ 원본이 없는 이름은 빌드 대상이 아니다(다른 방식으로 만들어질 수 있다).
           원본이 있는데 결과물이 없으면 배포하면 404 다.
      */
      if (hasSrc && !hasOut) missing.push(n);
    }
    expect(missing, `index.html 이 참조하는데 빌드되지 않았다 → 배포하면 404: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('★★★ 마운트 가드가 지연 로드되는 전역을 기다리지 않는다', () => {
    /*
       ★★★ 실제로 일어난 사고다.

         관리자 화면을 `#/admin` 일 때만 내려받도록 바꿨는데(69KB 절감) index.html 의
         마운트 가드가 `window.Admin*` 6개를 **필수로 요구하고 있었다.** 일반 방문자는
         조건이 영원히 만족되지 않아 6초 재시도 뒤
         "Failed to load required scripts" 만 남았다 — **랜딩·로그인이 통째로 죽었다.**

       ★★ 네트워크에는 4xx/5xx 가 **하나도 없었다.** 그래서 응답 코드만 보면 정상이다.
         프로덕션에서 화면을 실제로 열어보고서야 발견했다.

       ★ 규칙: 지연 로드하는 번들이 등록하는 전역은 마운트 가드에 있으면 안 된다.
         여기서는 "가드에 Admin* 전역이 없다" 로 확인한다 — 지연 대상이 관리자뿐이므로
         충분하고, 대상이 늘면 이 시험을 함께 고치게 된다.
    */
    const root = resolve(__dirname, '../../../..');
    const html = readFileSync(join(root, 'index.html'), 'utf-8');
    const guard = html.match(/if \(window\.App && [^\n]*/)?.[0] ?? '';
    expect(guard, '마운트 가드를 찾지 못했다 — 시험이 낡았다').not.toBe('');
    const admins = [...guard.matchAll(/window\.(Admin[A-Za-z]*)/g)].map((m) => m[1]);
    expect(admins, `지연 로드되는 관리자 전역을 마운트 가드가 기다린다 → 화면이 뜨지 않는다: ${admins.join(', ')}`)
      .toEqual([]);
    /* ★ 그리고 관리자 번들이 실제로 지연 로드 방식인지도 확인한다 — 둘 중 하나만
         맞으면 의미가 없다. */
    expect(html, '관리자 번들이 다시 즉시 로드로 돌아갔다')
      .not.toMatch(/<script[^>]*src="web-dist\/pages-admin(-more)?\.js"/);
  });

  it('디자이너 산출물은 모두 포함된다', () => {
    // 하나라도 빠지면 화면이 깨진다. 서빙 대상이 조용히 줄어드는 것을 막는다.
    expect(STATIC_DIRS).toContain('src');
    expect(STATIC_DIRS).toContain('vendor');
    expect(STATIC_DIRS).toContain('design-library');
    expect(STATIC_ROOT_FILES).toContain('index.html');
  });
});

describe('resolveWebRoot', () => {
  it('명시 경로가 유효하지 않으면 null', () => {
    expect(resolveWebRoot('/nonexistent/path/xyz')).toBeNull();
  });

  it('CWD 와 무관하게 실제 프론트엔드 루트를 찾는다', () => {
    // 모노레포 안에서 실행되므로 루트를 찾아야 한다.
    const root = resolveWebRoot();
    expect(root).not.toBeNull();
    expect(root!.length).toBeGreaterThan(0);
  });
});
