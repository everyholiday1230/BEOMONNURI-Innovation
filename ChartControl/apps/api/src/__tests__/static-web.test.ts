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
import { resolve, sep } from 'node:path';

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
