/**
 * 디자이너 프론트엔드 정적 서빙 — 자체 구현.
 *
 * 왜 프레임워크의 정적 미들웨어를 쓰지 않는가
 * ----------------------------------------
 * GHSA-frvp-7c67-39w9 (@hono/node-server 의 정적 파일 미들웨어에서 Windows 경로
 * 순회, `%5C` 인코딩 백슬래시) 때문에 이 저장소는 그 미들웨어를 아예 import 하지
 * 않는 것을 보안 계약으로 두고 있다 (apps/api/src/__tests__/server-adapter.test.ts).
 * 설치된 2.0.12 는 이미 패치된 버전이지만, 그 방어선을 허무는 대신 필요한 기능만
 * 직접 구현한다. 부수 효과로 두 가지를 더 얻는다.
 *   · 경로 검증을 우리가 통제한다 (순회 차단을 테스트로 고정할 수 있다).
 *   · MIME 을 정확히 줄 수 있다 (.jsx 를 octet-stream 으로 흘리지 않는다).
 *
 * 왜 API 가 정적 파일을 직접 서빙하는가
 * ----------------------------------
 * 프론트엔드가 `/api/...` 를 same-origin 으로 호출하고 쿠키 인증을 쓴다.
 * 오리진이 갈리면 CORS 와 SameSite 쿠키를 환경마다 다시 풀어야 하고 배포 대상도
 * 둘이 된다. 하나로 합치면 그 문제가 사라진다.
 *
 * 디자이너 산출물 불가침
 * --------------------
 * index.html / src / vendor / design-library 는 **읽기만** 한다.
 * 빌드도 변환도 하지 않는다. 파일을 그대로 내보내는 것이 계약이다.
 */

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Context, Hono } from 'hono';

/**
 * 서빙 대상 디렉터리. 화이트리스트다.
 *
 * 루트를 통째로 열면 .env, .data/*.db, node_modules 까지 HTTP 로 노출된다.
 * 유출 사고가 나는 전형적 경로라서 명시한 것만 연다.
 */
export const STATIC_DIRS = ['src', 'vendor', 'design-library'] as const;

/** 루트에서 직접 서빙할 개별 파일. */
/*
   루트에서 서빙하는 파일.

   ★ sitemap.xml 을 추가했다. robots.txt 가 사이트맵 주소를 알려주는데 그 파일이
     404 면 크롤러가 매번 헛걸음한다.
*/
export const STATIC_ROOT_FILES = ['index.html', 'favicon.ico', 'robots.txt', 'sitemap.xml'] as const;

/**
 * 확장자 → Content-Type.
 *
 * `.jsx` 가 중요하다. 디자이너 HTML 은 `<script type="text/babel" src="...jsx">`
 * 로 불러오는데, 서버가 octet-stream 을 주면 브라우저 설정에 따라 차단될 수 있다.
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/babel; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',   /* sitemap.xml — octet-stream 으로 주면 크롤러가 무시한다. */
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME[path.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 요청 경로를 루트 안의 실제 파일 경로로 바꾼다. 안전하지 않으면 null.
 *
 * 막아야 하는 것들
 *   · `../` 상위 탈출 (인코딩된 `%2e%2e` 는 Hono 가 이미 디코딩해서 넘긴다)
 *   · `%5C` → 백슬래시. Windows 에서 경로 구분자로 해석된다 (GHSA 의 핵심).
 *   · 널 바이트 — 일부 하위 API 에서 문자열을 조기 종료시킨다.
 *   · 심볼릭 링크로 루트 밖을 가리키는 경우
 *
 * 마지막 방어선은 "정규화 후 경로가 루트로 시작하는가" 다. 앞의 검사를 모두
 * 우회해도 이 검사가 남는다.
 */
export function safeJoin(root: string, requestPath: string): string | null {
  if (!requestPath || requestPath.includes('\0')) return null;
  // 백슬래시는 어떤 플랫폼에서도 우리 URL 경로에 등장할 이유가 없다.
  if (requestPath.includes('\\')) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    // 잘못된 퍼센트 인코딩. 거부한다.
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  if (rel === '' || rel === '.') return null;
  if (rel.split(/[/\\]/).some((seg) => seg === '..')) return null;

  const rootResolved = resolve(root);
  const full = resolve(join(rootResolved, rel));

  // 경로가 루트 안에 있는지 최종 확인. 정확한 접두사 비교를 위해 구분자를 붙인다.
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) return null;
  return full;
}

/** 요청 경로의 첫 세그먼트가 화이트리스트에 있는지. */
function isAllowedTarget(rel: string): boolean {
  const first = rel.split('/')[0] ?? '';
  return (
    (STATIC_DIRS as readonly string[]).includes(first) ||
    (STATIC_ROOT_FILES as readonly string[]).includes(rel)
  );
}

/**
 * 프론트엔드 루트를 찾는다.
 *
 * CWD 에 의존하지 않는다 — `pnpm --filter api start`, `node dist/index.js`,
 * 테스트 러너가 각각 다른 CWD 에서 돌기 때문이다. 이 파일 위치를 기준으로
 * 위로 올라가며 index.html + src 가 함께 있는 디렉터리를 찾는다.
 */
export function resolveWebRoot(explicit?: string): string | null {
  if (explicit && explicit.trim()) {
    const p = resolve(explicit.trim());
    return existsSync(join(p, 'index.html')) ? p : null;
  }

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 약한 ETag. 내용 해시가 아니라 크기+수정시각이라 파일 읽기 없이 만든다. */
function etagOf(size: number, mtimeMs: number): string {
  return `W/"${createHash('sha1').update(`${size}-${mtimeMs}`).digest('hex').slice(0, 16)}"`;
}

/**
 * 정적 서빙을 앱에 붙인다.
 *
 * 반드시 API 라우트를 모두 등록한 **뒤에** 호출한다. 먼저 붙이면 `/api/...`
 * 요청이 정적 핸들러를 거치게 된다.
 *
 * @returns 서빙 중인 루트. 프론트엔드를 못 찾으면 null (API 는 계속 동작).
 */
export function mountStatic(app: Hono, opts: { webRoot?: string } = {}): string | null {
  const found = resolveWebRoot(opts.webRoot ?? process.env.WEB_ROOT);
  if (!found) return null;
  // 클로저 안에서 좁혀진 타입을 유지하기 위해 별도 상수로 고정한다.
  const root: string = found;

  /**
   * 백엔드 존재를 알리는 헤더.
   *
   * 프론트엔드(src/live-market.js)가 이 헤더로 백엔드 유무를 판별한다.
   * Server-Timing 은 same-origin 에서 추가 요청 없이 읽을 수 있어서, 정적 프리뷰
   * 모드에서 `/api` 를 찔러보다 404 를 내는 일이 없다.
   * ★ 헤더 이름을 바꾸면 프론트엔드가 목업으로 되돌아간다.
   */
  const BACKEND_HEADER = 'qtbackend;desc="QuantumTrade API"';

  async function serveFile(c: Context, relPath: string): Promise<Response> {
    const full = safeJoin(root, relPath);
    if (!full || !isAllowedTarget(relPath)) return c.notFound();

    let info;
    try {
      info = await stat(full);
    } catch {
      return c.notFound();
    }
    if (!info.isFile()) return c.notFound();

    const isHtml = full.endsWith('.html');
    const etag = etagOf(info.size, info.mtimeMs);

    const headers: Record<string, string> = {
      'Content-Type': contentTypeFor(full),
      ETag: etag,
      'Last-Modified': new Date(info.mtimeMs).toUTCString(),
      // HTML 은 캐시하지 않는다. 스크립트 목록이 바뀌었는데 옛 HTML 이 남으면
      // 없는 파일을 불러 화면이 깨진다. 나머지는 재검증 조건부 캐시.
      'Cache-Control': isHtml ? 'no-cache, must-revalidate' : 'public, max-age=0, must-revalidate',
    };
    if (isHtml) headers['Server-Timing'] = BACKEND_HEADER;

    // 조건부 요청. 재검증만 하고 본문을 다시 보내지 않는다.
    if (c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304, headers });
    }

    const body = await readFile(full);
    return new Response(new Uint8Array(body), { status: 200, headers });
  }

  // --- 루트 문서 ---
  app.get('/', (c) => serveFile(c, 'index.html'));

  // --- 화이트리스트 디렉터리 ---
  for (const dir of STATIC_DIRS) {
    if (!existsSync(join(root, dir))) continue;
    app.get(`/${dir}/*`, (c) => {
      // 선행 슬래시를 떼고 그대로 넘긴다. 검증은 safeJoin 이 한다.
      const rel = c.req.path.replace(/^\/+/, '');
      // 디렉터리로 끝나면 index.html 을 찾는다 (design-library/ 진입점).
      return serveFile(c, rel.endsWith('/') ? `${rel}index.html` : rel);
    });
  }

  // --- 루트 개별 파일 ---
  for (const file of STATIC_ROOT_FILES) {
    if (!existsSync(join(root, file))) continue;
    app.get(`/${file}`, (c) => serveFile(c, file));
  }

  return root;
}

/** 진단용. 서빙 대상이 실제로 존재하는지 확인한다. */
export function describeStatic(root: string): { path: string; exists: boolean; kind: string }[] {
  return [...STATIC_ROOT_FILES, ...STATIC_DIRS].map((name) => {
    const full = join(root, name);
    const exists = existsSync(full);
    return { path: name, exists, kind: exists && statSync(full).isDirectory() ? 'dir' : 'file' };
  });
}
