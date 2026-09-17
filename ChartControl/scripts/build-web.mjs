#!/usr/bin/env node
/*
   ============================================================
   프론트엔드 빌드 — JSX 를 미리 컴파일한다.

   ★★ 왜 필요한가

     지금은 브라우저가 `vendor/babel/babel.min.js`(3,137,752 바이트)를 내려받아
     JSX 24개 파일을 **접속마다** 변환한다. 고객 첫 화면에서 React 프로덕션
     빌드(143KB)의 22배를 받고, 그 위에 변환 시간까지 얹힌다.

   ★★ 왜 브라우저와 같은 컴파일러를 쓰는가

     새 의존성을 추가하지 않고 `vendor/babel/babel.min.js` 를 Node 에서 그대로
     불러 쓴다. 빌드가 만든 결과와 오늘 브라우저가 만드는 결과가 **같은 컴파일러
     같은 버전**에서 나오므로, "빌드에서는 되는데 브라우저에서는 다르다" 가 없다.

   ★★ 프리셋은 `react` 만 쓴다. `env` 는 뺀다.

     오늘 브라우저는 기본 프리셋 ["react","env"] 로 변환하므로 JSX 는 ES5 로
     내려간다(const→var, 화살표→function, 템플릿→문자열 연결). 그런데 **변환 없이
     그대로 나가는 일반 .js 49개가 이미 const 171개·화살표 27개·템플릿 290개를
     쓴다.** 즉 브라우저는 ES2015+ 를 이미 이해해야 하고, JSX 만 ES5 로 낮추는 것은
     아무도 얻지 못하는 비용이었다(측정: 23개 파일 합계 약 +23만 바이트).

     이 판단은 추측이 아니라 --compare 와 위 문법 집계로 확인했다.
     혹시 구형 브라우저를 지원해야 한다면 일반 .js 부터 함께 낮춰야 하고,
     그때는 여기 presets 에 'env' 를 넣는 것만으로는 부족하다.

   사용:
     node scripts/build-web.mjs            컴파일 → web-dist/
     node scripts/build-web.mjs --compare  react 전용 vs react+env 산출물 비교
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const Babel = require_(join(ROOT, 'vendor/babel/babel.min.js'));

const OUT_DIR = join(ROOT, 'web-dist');
const compareMode = process.argv.includes('--compare');

/*
   컴파일 대상 목록을 **index.html 에서** 읽는다(손으로 관리하지 않는다).

   ★★ index.html 이 참조하는 것은 결과물(web-dist/*.js)이므로 거기서 역으로
     원본(src/*.jsx)을 구한다. 목록과 순서의 단일 출처가 index.html 이어야
     "빌드는 했는데 화면이 안 쓰는 파일" 이나 그 반대가 생기지 않는다.

   ★ 전환기에는 아직 text/babel 로 남은 태그도 함께 받는다.
*/
function jsxFilesFromIndex() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script[^>]*src="web-dist\/([^"]+)\.js"/g)) out.push(`src/${m[1]}.jsx`);
  for (const m of html.matchAll(/<script[^>]*type="text\/babel"[^>]*src="(src\/[^"]+\.jsx)"/g)) out.push(m[1]);
  /*
     ★★★ **지연 로드하는 파일도 컴파일해야 한다.**

       관리자 화면을 `#/admin` 일 때만 붙이도록 바꿨더니 `<script src>` 태그가
       사라졌고, 그래서 **이 빌드가 두 파일을 아예 컴파일하지 않았다.**
       프로덕션에서 web-dist/pages-admin.js 가 **404** 가 됐다 —
       로컬에는 예전 빌드 결과가 남아 있어서 눈치채지 못할 수 있었다.

     ★ 그래서 인라인 스크립트 안의 'web-dist/xxx.js' 문자열도 대상으로 받는다.
       index.html 이 단일 출처라는 원칙은 그대로 지킨다 — 태그든 문자열이든
       index.html 이 참조하면 빌드한다.

     ★ 원본(src/xxx.jsx)이 없는 이름은 버린다 — 문자열이 우연히 걸릴 수 있다.
  */
  for (const m of html.matchAll(/['"`]web-dist\/([A-Za-z0-9._-]+)\.js['"`]/g)) {
    const src = `src/${m[1]}.jsx`;
    if (existsSync(join(ROOT, src))) out.push(src);
  }
  return [...new Set(out)];
}

function compile(src, presets) {
  return Babel.transform(src, {
    presets,
    filename: 'file.jsx',
    // ★ 소스맵을 넣지 않는다. 원본 .jsx 는 그대로 배포되므로 브라우저 devtools 에서
    //   원본을 볼 수 있고, 맵까지 얹으면 전송량이 다시 늘어난다.
    sourceMaps: false,
    /*
       ★★★ **주석 제거 + 공백 압축.** 이것만으로 gzip 이 절반 이하가 된다.

         실측(주요 7개 파일): 952,949B → 448,194B (53% 절감)
                              gzip 247,453B → 108,915B (**56% 절감**)

         이 코드베이스는 한국어 주석이 매우 많고(왜 그렇게 고쳤는지를 적는 규약),
         한글은 UTF-8 로 3바이트다. 그래서 주석이 전송량의 절반을 차지했다.

       ★ **새 의존성을 넣지 않았다.** esbuild·terser 를 추가할 수도 있었지만,
         이미 있는 Babel 옵션 두 개로 대부분을 얻는다. 식별자 축약(mangle)까지 하면
         조금 더 줄지만, 새 도구를 들이는 위험과 이름이 바뀌어 디버깅이 어려워지는
         비용이 이득보다 크다고 판단했다.

       ★★ **주석은 src/ 에 그대로 남는다.** src/*.jsx 도 함께 배포되므로 브라우저
         devtools 에서 원본을 볼 수 있다 — 설명이 사라지는 것이 아니다.
         web-dist 는 실행용 산출물이고 src 가 진상이다.

       ★ compact:true 는 선택적 공백만 없앤다. 문법을 바꾸지 않으므로 동작이 같다.
    */
    compact: true,
    comments: false,
  }).code;
}

const files = jsxFilesFromIndex();
if (files.length === 0) {
  console.error('build-web: index.html 에서 text/babel JSX 를 찾지 못했다 — 중단한다.');
  process.exit(1);
}

/*
   ★★ **원본 JSX 를 일반 <script> 로 실으면 화면이 죽는다 — 여기서 막는다.**

     실제 사고(2026-09-15, 리더보드 기능): index.html 에
     `<script src="src/pages-leaderboard.jsx"></script>` 가 들어갔다.
     `type="text/babel"` 이 없으므로 브라우저는 JSX 를 그냥 JS 로 파싱하고
     `SyntaxError: Unexpected token '<'` 로 죽는다. 그 파일이 정의하려던
     `window.LeaderboardPage` 는 만들어지지 않아 `#/leaderboard` 가 빈 화면이 된다.

     그리고 이 빌드는 대상을 `web-dist/*.js` 참조에서 역산하므로 그 파일을
     **컴파일조차 하지 않았다.** 즉 오류가 두 겹인데 빌드는 성공으로 끝났다.

   ★ 조용히 고치지 않고 **실패시킨다.** 어디를 어떻게 바꿔야 하는지 말해 준다 —
     자동으로 web-dist 로 바꿔치기하면 실행 순서가 달라져 다른 사고가 된다
     (위 '위치가 중요하다' 주석 참고).
*/
{
  /*
     ★ **주석을 먼저 지운다.** 이 저장소는 주석에 "예전에 이렇게 적어서 깨졌다" 는
       예시를 그대로 남기는 규약이라, 정규식으로 소스를 훑으면 그 예시가 잡힌다.
       실제로 이 가드를 처음 넣었을 때 자기 설명 주석을 자기가 잡아 빌드를 막았다.
  */
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const rawJsxTags = [...html.matchAll(/<script(?![^>]*type="text\/babel")[^>]*src="(src\/[^"]+\.jsx)"[^>]*>/g)]
    .map((m) => m[1]);
  if (rawJsxTags.length > 0) {
    console.error(
      'build-web: index.html 이 원본 JSX 를 일반 <script> 로 싣고 있다 — 브라우저는 이것을 파싱하지 못한다:\n' +
      rawJsxTags.map((f) => `  · ${f}`).join('\n') +
      '\n  → web-dist 블록으로 옮기고 `web-dist/<이름>.js` 로 참조하십시오' +
      ' (그 블록에 두는 이유는 index.html 의 실행 순서 주석 참고).',
    );
    process.exit(1);
  }
}

if (compareMode) {
  /*
     ★★ "react 만으로 충분한가" 를 추측하지 않고 확인한다.

       react+env 결과와 react 전용 결과가 다르면, env 가 실제로 문법을 낮추고
       있다는 뜻이고 그 차이가 브라우저 지원 범위를 좁힐 수 있다. 어떤 파일에서
       얼마나 다른지 눈으로 보고 판단한다.
  */
  let differing = 0;
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const a = compile(src, ['react']);
    const b = compile(src, ['react', 'env']);
    const same = a === b;
    if (!same) {
      differing += 1;
      console.log(`  다름  ${rel.padEnd(30)} react=${a.length}  react+env=${b.length}  차이=${b.length - a.length}`);
    }
  }
  console.log(`\nJSX ${files.length}개 중 react/react+env 산출물이 다른 파일: ${differing}개`);
  process.exit(0);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

let totalIn = 0;
let totalOut = 0;
const leaked = [];
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const code = compile(src, ['react']);
  /*
     ★★★ **중괄호 없는 블록 주석은 주석이 아니라 화면에 나오는 글자다 — 여기서 막는다.**

       실제 사고: `src/page-shell.jsx` 의 접힌 사이드바에 설명 문단이 그대로
       노출됐다(운영자 보고). 원인은 JSX 자식 자리에 중괄호 없이 블록 주석만
       적은 것이다. JSX 에서 그것은 JSXText 이고, Babel 은 얌전히 문자열로
       바꿔 화면에 그린다. 문법 오류가 아니므로 컴파일도 eslint 도 통과한다.

     ★ 그래서 **컴파일 결과**에서 찾는다. 원본을 정규식으로 훑으면 정상 주석과
       구분할 수 없지만, 컴파일 후에는 정상 주석은 사라지고 새는 것만 문자열로
       남는다. 판정이 흐릿하지 않다.

     ★ 조용히 지우지 않고 실패시킨다 — 지우면 어디를 잘못 적었는지 모른 채 같은
       실수를 반복한다. 고칠 위치와 방법을 말해 준다.
  */
  {
    const re = /(["'])((?:\\.|(?!\1)[^\\])*?)\1/g;
    let m;
    while ((m = re.exec(code))) {
      const lit = m[2];
      /* 여는 기호와 닫는 기호를 코드로 만든다 — 이 주석 자체가 잡히면 안 된다. */
      const open = '/' + '*';
      const close = '*' + '/';
      if (lit.includes(open) || lit.includes(close)) {
        leaked.push({ rel, text: lit.slice(0, 70) });
        break;
      }
    }
  }
  const outRel = rel.replace(/^src\//, '').replace(/\.jsx$/, '.js');
  const outPath = join(OUT_DIR, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, 'utf8');
  /*
     ★★ **String.length 는 바이트가 아니다.** UTF-16 코드유닛 개수다.

       이 코드베이스는 한국어 주석이 많다. 한글은 UTF-8 로 **3바이트**인데
       String.length 로는 1로 센다. 실측: String.length 합 1,527,806 vs
       실제 UTF-8 1,793,820 → **14.8% 과소보고.**

       "바이트" 라고 찍어 놓고 실제보다 작게 말하면, 번들 크기를 줄이는 판단이
       전부 어긋난다(작아 보이니 손댈 이유가 없어 보인다).

     ★ Buffer.byteLength 로 실제 바이트를 센다.
  */
  totalIn += Buffer.byteLength(src, 'utf8');
  totalOut += Buffer.byteLength(code, 'utf8');
}

const written = readdirSync(OUT_DIR).length;

if (leaked.length > 0) {
  console.error(
    'build-web: 주석이 화면에 나오는 글자로 컴파일됐다 — JSX 자식 자리의 블록 주석은\n' +
    '           중괄호로 감싸야 한다:\n' +
    leaked.map((l) => `  · ${l.rel}: ${l.text}…`).join('\n') +
    '\n  → 해당 주석을 중괄호로 감싸십시오. 주석 본문에 닫는 기호를 적으면 그 자리에서' +
    '\n    주석이 끝나 나머지가 JSX 식으로 파싱되므로, 본문에는 기호를 적지 마십시오.',
  );
  process.exit(1);
}

console.log(`build-web: JSX ${files.length}개 컴파일 → web-dist/ (${written} 항목)`);
console.log(`  원본 ${totalIn.toLocaleString()} → 컴파일 ${totalOut.toLocaleString()} 바이트`);
console.log('  브라우저는 babel.min.js(3,137,752 바이트)를 더 이상 받지 않는다.');
