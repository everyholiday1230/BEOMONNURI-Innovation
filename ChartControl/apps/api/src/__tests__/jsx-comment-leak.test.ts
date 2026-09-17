import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/*
   **JSX 자식 자리의 블록 주석은 주석이 아니라 화면에 나오는 글자다.**

   실제 사고: 접힌 사이드바에 설명 문단이 그대로 노출됐다(운영자 보고).
     `<>`
     `/* 접힌 레일 — 고정한 메뉴만 ... `      ← 중괄호가 없다
   JSX 에서 이것은 JSXText 이고, Babel 은 얌전히 문자열로 바꿔 화면에 그린다.
   문법 오류가 아니므로 **컴파일도 eslint 도 통과한다.** 그래서 눈으로만 걸러야 했다.

   ★ 원본을 정규식으로 훑어서는 정상 주석과 구분할 수 없다. 이 저장소는 주석이
     아주 많고, 그중 대부분은 올바른 위치에 있다.
   ★ 그래서 **컴파일 결과**를 본다. 정상 주석은 컴파일에서 사라지고, 새는 것만
     문자열 리터럴로 남는다. 판정이 흐릿하지 않다.
*/

const ROOT = join(__dirname, '../../../..');
const require_ = createRequire(__filename);

/** 여는/닫는 기호를 코드로 만든다 — 이 파일의 주석 자체가 잡히면 안 된다. */
const OPEN = '/' + '*';
const CLOSE = '*' + '/';

/** 컴파일 결과의 문자열 리터럴 중 주석 기호를 품은 것을 찾는다. */
function leaksIn(code: string): string[] {
  const found: string[] = [];
  const re = /(["'])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    /* 캡처가 비어 있을 수 있다(빈 문자열 리터럴). 그때는 볼 것이 없다. */
    const lit = m[2] ?? '';
    if (lit.includes(OPEN) || lit.includes(CLOSE)) found.push(lit.slice(0, 80));
  }
  return found;
}

describe('JSX 주석이 화면 글자로 새지 않는다', () => {
  it('모든 .jsx 를 컴파일해도 주석이 문자열로 남지 않는다', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const Babel: any = require_(join(ROOT, 'vendor/babel/babel.min.js'));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const dir = join(ROOT, 'src');
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsx'));

    /* 파일이 갑자기 0개면 검사가 헛돈다 — 경로가 틀렸다는 뜻이다. */
    expect(files.length, 'JSX 파일을 찾지 못했다 — 경로가 틀렸다').toBeGreaterThan(10);

    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const code = Babel.transform(src, { presets: ['react'], comments: false }).code as string;
      for (const lit of leaksIn(code)) bad.push(`${f}: ${lit}`);
    }
    expect(bad, `주석이 화면 글자로 컴파일된다:\n${bad.join('\n')}`).toEqual([]);
  });

  it('검사 자체가 새는 주석을 실제로 잡는다', () => {
    /*
       ★ 역검증을 시험 안에 넣는다. 위 시험은 "아무것도 없음" 을 확인하므로,
         검사가 고장나 항상 빈 배열을 돌려줘도 통과한다. 일부러 새는 코드를
         만들어 잡히는지 확인한다.
    */
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const Babel: any = require_(join(ROOT, 'vendor/babel/babel.min.js'));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const broken = `const a = <div>\n  ${OPEN} 설명 문단 ${CLOSE}\n  <span>x</span>\n</div>;`;
    const code = Babel.transform(broken, { presets: ['react'], comments: false }).code as string;
    expect(leaksIn(code).length, '새는 주석을 잡지 못한다 — 검사가 고장났다').toBeGreaterThan(0);

    /* 올바르게 감싼 주석은 잡히지 않아야 한다 — 그래야 오탐이 없다. */
    const okSrc = `const a = <div>\n  {${OPEN} 설명 문단 ${CLOSE}}\n  <span>x</span>\n</div>;`;
    const okCode = Babel.transform(okSrc, { presets: ['react'], comments: false }).code as string;
    expect(leaksIn(okCode), '올바른 주석을 잘못 잡는다').toEqual([]);
  });

  it('빌드가 이 결함을 막는다', () => {
    /*
       시험만으로는 부족하다 — 배포는 `pnpm build` 로 나간다. 빌드도 스스로
       막아야 시험을 건너뛴 경로에서도 안 나간다.
    */
    const build = readFileSync(join(ROOT, 'scripts/build-web.mjs'), 'utf8');
    expect(build, '빌드에 새는 주석 가드가 없다').toMatch(/leaked/u);
    expect(build, '가드가 빌드를 실패시키지 않는다')
      .toMatch(/leaked\.length > 0[\s\S]{0,600}process\.exit\(1\)/u);
  });
});
