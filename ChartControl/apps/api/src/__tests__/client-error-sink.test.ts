import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   브라우저 오류가 실제로 서버까지 도달하는가.

   ★★ 측정으로 드러난 것: 도달하지 않았다.

     실서비스 구성(Postgres)으로 로컬에서 확인했다. 브라우저에 미처리 오류를
     던져도 `/api/ops/client-error` 로 요청이 **한 건도 가지 않았고**, ops_errors
     는 0행이었고, `window.onerror` 는 아예 설정돼 있지 않았다.

     원인: 보고 함수 report() 는 잘 만들어져 있었지만 **React 렌더 오류에서만**
     불렸다(에러 바운더리의 componentDidCatch). 그런데 실제 앱 오류의 대부분은
     렌더 중이 아니라 비동기 콜백·이벤트 핸들러·프로미스 거부에서 난다.
     그 전부가 조용히 사라지고 있었다.

   ★★ 이게 왜 심각한가

     동작하지 않는 관측성은 없는 것보다 나쁘다. 운영자는 ops_errors 가 비어 있는
     것을 보고 "오류가 없다" 고 믿는다. 실제로 이 프로젝트가 그 상태였다 —
     실서비스 ops_errors 는 0행이고, 그것을 "조용하다" 로 읽고 있었다.

   ★ 실측 결과(수정 후): 미처리 오류와 프로미스 거부가 각각 전송되고, 같은 오류를
     5번 더 던져도 추가 전송은 없었고(클라이언트 중복 제거), 이미지 로드 실패는
     보고되지 않았고, 두 행이 출처 표시와 함께 DB 에 남았고, 운영자 조회
     `/api/admin/ops/errors` 가 200 으로 2건을 돌려줬다.
*/
describe('CLIENT-ERROR-SINK — 브라우저 오류가 서버에 닿는다', () => {
  const src = read('src/error-boundary.js');

  it('[1] 전역 오류 핸들러가 설치된다 — 이것이 없어서 아무것도 보고되지 않았다', () => {
    /*
       ★★ 렌더 오류만 잡으면 대부분을 놓친다. 두 이벤트가 실제 앱 오류의
         주된 경로다.
    */
    expect(src).toMatch(/addEventListener\('error'/);
    expect(src).toMatch(/addEventListener\('unhandledrejection'/);
  });

  it('[2] 리소스 로드 실패는 보고하지 않는다', () => {
    const start = src.indexOf("addEventListener('error'");
    const block = src.slice(start, start + 900);
    /*
       ★★ <img>·<script> 로드 실패도 같은 'error' 이벤트로 온다. 걸러내지 않으면
         이미지 하나 깨질 때마다 보고가 쌓여 **진짜 오류가 묻힌다.**
    */
    expect(block).toMatch(/ev\.target !== window/);
    expect(block).toMatch(/tagName/);
  });

  it('[3] 보고가 폭주하지 않는다 — 보고가 오류를 만들면 무한 루프가 된다', () => {
    // 같은 내용은 한 번만.
    expect(src).toMatch(/if \(reported\[key\]\) return;/);
    // 페이지당 총량 제한.
    expect(src).toMatch(/REPORT_MAX/);
    expect(src).toMatch(/reportCount >= REPORT_MAX/);
  });

  it('[4] 보고 경로의 예외는 삼킨다 — 보고 실패가 복구 화면을 막으면 안 된다', () => {
    const start = src.indexOf('function reportOnce(');
    const block = src.slice(start, start + 700);
    expect(block).toMatch(/try \{/);
    expect(block).toMatch(/catch/);
  });

  it('[5] 하위 출처를 함께 보낸다 — 렌더 오류와 프로미스 거부는 분류가 다르다', () => {
    expect(src).toMatch(/source: String\(\(info && info\.source\) \|\| 'react-render'\)/);
    expect(src).toMatch(/source: 'window\.error'/);
    expect(src).toMatch(/source: 'unhandledrejection'/);
  });

  it('[6] 서버가 하위 출처를 메시지에 남긴다 — 전부 client 로 뭉개면 읽을 수 없다', () => {
    const api = read('apps/api/src/index.ts');
    const start = api.indexOf("app.post('/api/ops/client-error'");
    const block = api.slice(start, start + 3000);
    expect(block).toMatch(/parsed\.source/);
    expect(block).toMatch(/\[\$\{sub\}\]/);
    /*
       ★ source 컬럼을 넓히지 않고 메시지에 넣는다. 컬럼을 바꾸면 기존 조회·화면
         필터를 함께 고쳐야 하고, 놓치면 목록이 조용히 비어 보인다.
    */
    expect(block).toMatch(/source: 'client'/);
  });

  it('[7] 하위 출처 문자열을 그대로 믿지 않는다', () => {
    const api = read('apps/api/src/index.ts');
    const start = api.indexOf("app.post('/api/ops/client-error'");
    const block = api.slice(start, start + 3000);
    /*
       ★ 이 값은 브라우저가 보낸 것이다. 길이와 문자를 제한하지 않으면 로그와
         목록에 임의 문자열이 섞인다.
    */
    expect(block).toMatch(/replace\(\/\[\^a-zA-Z0-9\._-\]\/g, ''\)/);
    expect(block).toMatch(/slice\(0, 40\)/);
  });

  it('[8] 수동 보고 창구가 있다 — 없으면 각자 fetch 를 만들어 형식이 갈린다', () => {
    expect(src).toMatch(/window\.QTReportError = function/);
  });
});
