/*
   관리자 화면이 **늦게 도착하는 동안 터지던** 결함을 잠근다.

   운영자 보고: "관리자가 유저 탭 가면 항상 This screen could not be displayed ...
   Minified React error #130 ... 트라이 어게인하면 들어가지긴 하는데 왜 이래."

   ★★★ 원인
     관리자 화면은 `/admin` 에 들어갈 때 **따로 내려받는다**(index.html — 방문자 전원에게
     69KB 를 보내지 않기 위해서다). 그래서 라우트가 처음 그려지는 순간에는
     `window.AdminXxxPage` 가 **아직 없다.** `<window.AdminUsersPage/>` 를 그대로 쓰면
     undefined 를 컴포넌트로 렌더해 React 가 **#130**("Element type is invalid ...
     got: undefined")으로 터진다.
     재시도가 통했던 이유: 그때는 스크립트가 이미 도착해 있었다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('늦게 오는 관리자 화면을 안전하게 그린다', () => {
  const app = read('src/app.jsx');

  /*
     ★★★ **라우트마다 가드를 쓰지 않는다.** 관리자 화면이 20개가 넘어서 새로 추가할 때
       또 빠뜨린다. 한 곳(`AdminLazy`)에서 막는다.
  */
  it('관리자 라우트가 직접 window 컴포넌트를 렌더하지 않는다', () => {
    /*
       ★ **주석을 세지 않는다.** 왜 이렇게 고쳤는지 설명하려면 주석에 옛 코드
         (`<window.AdminUsersPage/>`)를 적게 되는데, 그것까지 세면 설명을 쓸 수 없다
         — 실제로 이 시험이 내 주석을 잡았다.
       ★ 렌더는 라우트 조건 뒤에 온다(`route.path === ... && <window.X`). 그 형태만 본다.
    */
    const bad = (app.match(/&&\s*<window\.Admin[A-Za-z]+/gu) || []);
    expect(bad, `가드 없이 렌더하는 관리자 화면: ${bad.join(', ')}`).toEqual([]);
  });

  it('모든 관리자 라우트가 AdminLazy 를 쓴다', () => {
    const i = app.indexOf('{/* ADMIN routes */}');
    expect(i, '관리자 라우트 블록이 없다').toBeGreaterThan(-1);
    const block = app.slice(i, i + 4000);
    const routes = (block.match(/route\.path === '\/admin[^']*'/gu) || []);
    expect(routes.length, '관리자 라우트를 찾지 못했다').toBeGreaterThan(10);
    const lazies = (block.match(/<AdminLazy name="/gu) || []);
    expect(lazies.length, `라우트 ${routes.length}개 중 ${lazies.length}개만 보호된다`)
      .toBe(routes.length);
  });

  it('없는 동안 로딩을 보여준다 — 빈 화면이 아니다', () => {
    const i = app.indexOf('const AdminLazy = React.useCallback');
    expect(i, 'AdminLazy 가 없다').toBeGreaterThan(-1);
    const body = app.slice(i, i + 2200);
    /* ★ 빈 화면을 보여주면 운영자가 고장으로 읽는다. */
    expect(body, '로딩 안내가 없다').toMatch(/t\('admin_loading'\)/u);
    expect(body, '컴포넌트가 있을 때 그리지 않는다').toMatch(/if \(Comp\) return <Comp \{\.\.\.rest\}\/>;/u);
  });

  it('도착하면 다시 그린다', () => {
    /*
       ★ index.html 이 로드 후 `hashchange` 를 쏘지만 그 이벤트를 놓치는 경우가 있다.
         여기서도 짧게 확인해 도착을 잡는다.
       ★★ 영원히 돌지 않는다 — 탭이 계속 일하면 안 된다. 상한이 있어야 한다.
    */
    const i = app.indexOf('const AdminLazy = React.useCallback');
    const body = app.slice(i, i + 2200);
    expect(body, '도착을 확인하지 않는다').toMatch(/setInterval\(/u);
    expect(body, '상한이 없어 영원히 돈다').toMatch(/if \(n >= 40\) clearInterval\(h\)/u);
    /* ★ 정리하지 않으면 화면을 떠난 뒤에도 타이머가 남는다. */
    expect(body, 'cleanup 이 없다').toMatch(/return \(\) => clearInterval\(h\)/u);
    /* ★ 이미 있으면 타이머를 걸지 않는다 — 대부분의 경우가 그렇다. */
    expect(body, '있을 때도 폴링한다').toMatch(/if \(Comp\) return undefined;/u);
  });

  /*
     ★ 관리자 화면을 따로 내려받는 구조 자체는 유지한다 — 방문자 전원에게 69KB 를
       보내지 않기 위한 것이고, 실측 근거가 index.html 주석에 있다.
  */
  it('따로 내려받는 구조가 유지된다', () => {
    const html = read('index.html');
    expect(html, '관리자 스크립트를 모두에게 보낸다')
      .toMatch(/files = \['web-dist\/pages-admin\.js', 'web-dist\/pages-admin-more\.js'\]/u);
    /* ★ 순서를 지켜야 한다 — async 면 뒤 파일이 먼저 실행될 수 있다. */
    expect(html, '실행 순서를 보장하지 않는다').toMatch(/el\.async = false;/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('aret_title')) continue;
      if (!s.includes('admin_loading')) missing.push(f);
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });

  /*
     ★★★ **빌드 결과에도 남아 있지 않아야 한다.** 소스만 보고 넘기면, 빌드가 다른
       파일을 쓰는 경우를 놓친다.
  */
  it('빌드 결과에 가드 없는 렌더가 없다', () => {
    const built = read('web-dist/app.js');
    const bad = (built.match(/createElement\(window\.Admin[A-Za-z]+/gu) || []);
    expect(bad, `빌드에 남은 직접 렌더: ${bad.join(', ')}`).toEqual([]);
  });
});
