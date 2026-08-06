/**
 * 디자이너 프론트엔드 JSX/JS 문법 검사.
 *
 * 브라우저는 @babel/standalone 으로 .jsx 를 런타임 변환한다. 문법 오류가 있으면
 * 화면이 백지가 되고 콘솔에만 한 줄 남는다. 개발 중 그걸 빨리 잡기 위한 도구다.
 *
 *   node tools/jsx-check.mjs            전체
 *   node tools/jsx-check.mjs src/app.jsx  특정 파일
 */
// esbuild 는 워크스페이스 하위 패키지에만 있어 루트에서 해석되지 않는다.
// 실제 경로를 찾아 동적 import 한다 (설치 위치가 바뀌어도 동작한다).
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
const req = createRequire(import.meta.url);
function findEsbuild() {
  try { return req.resolve('esbuild'); } catch { /* 루트에 없다 */ }
  const base = 'node_modules/.pnpm';
  const dirs = readdirSync(base).filter((d) => d.startsWith('esbuild@')).sort().reverse();
  for (const d of dirs) {
    const p = `${process.cwd()}/${base}/${d}/node_modules/esbuild/lib/main.js`;
    try { req.resolve(p); return p; } catch { /* 다음 후보 */ }
  }
  throw new Error('esbuild 를 찾을 수 없다');
}
const { transform } = await import(findEsbuild());
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const files = args.length
  ? args
  : (await readdir('src'))
      .filter((f) => /\.(jsx|js)$/.test(f))
      .map((f) => join('src', f));

let failed = 0;
for (const f of files) {
  const src = await readFile(f, 'utf8');
  try {
    await transform(src, { loader: f.endsWith('.jsx') ? 'jsx' : 'js', sourcefile: f });
  } catch (e) {
    failed += 1;
    console.log(`\n✗ ${f}`);
    for (const err of e.errors ?? [{ text: e.message }]) {
      const loc = err.location ? ` (${err.location.line}:${err.location.column})` : '';
      console.log(`   ${err.text}${loc}`);
      if (err.location?.lineText) console.log(`   > ${err.location.lineText.trim()}`);
    }
  }
}
console.log(failed === 0 ? `\n문법 OK — ${files.length}개 파일` : `\n실패 ${failed}개 / ${files.length}개`);
process.exit(failed === 0 ? 0 : 1);
