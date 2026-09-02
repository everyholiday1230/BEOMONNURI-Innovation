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
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
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
  return [...new Set(out)];
}

function compile(src, presets) {
  return Babel.transform(src, {
    presets,
    filename: 'file.jsx',
    // ★ 소스맵을 넣지 않는다. 원본 .jsx 는 그대로 배포되므로 브라우저 devtools 에서
    //   원본을 볼 수 있고, 맵까지 얹으면 전송량이 다시 늘어난다.
    sourceMaps: false,
    compact: false,
  }).code;
}

const files = jsxFilesFromIndex();
if (files.length === 0) {
  console.error('build-web: index.html 에서 text/babel JSX 를 찾지 못했다 — 중단한다.');
  process.exit(1);
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
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const code = compile(src, ['react']);
  const outRel = rel.replace(/^src\//, '').replace(/\.jsx$/, '.js');
  const outPath = join(OUT_DIR, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, 'utf8');
  totalIn += src.length;
  totalOut += code.length;
}

const written = readdirSync(OUT_DIR).length;
console.log(`build-web: JSX ${files.length}개 컴파일 → web-dist/ (${written} 항목)`);
console.log(`  원본 ${totalIn.toLocaleString()} → 컴파일 ${totalOut.toLocaleString()} 바이트`);
console.log('  브라우저는 babel.min.js(3,137,752 바이트)를 더 이상 받지 않는다.');
