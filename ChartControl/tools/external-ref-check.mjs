/*
   실서비스 화면의 외부 참조 검사
   ------------------------------------------------------------
   목적: 고객이 여는 화면이 **우리 서버 밖으로 요청을 보내지 않는지** 확인한다.

   왜 필요한가
     외부 CDN 에서 폰트·스크립트를 불러오면, 그 파일을 받을 때 이용자의
     IP 주소와 User-Agent 가 그 회사로 전달된다. 우리가 게시한 개인정보
     처리방침 4절(제3자 제공)에는 거래소·메일 발송·클라우드만 적혀 있다.
     폰트 CDN 이나 스크립트 CDN 은 그 목록에 없으므로, 그런 요청이 하나라도
     있으면 **우리가 우리 방침을 위반하는 상태**가 된다.

     실제로 그런 상태였다 — 구글 폰트 2곳, jsDelivr(Pretendard), unpkg
     (React·Babel). 자체 호스팅으로 바꿨고, 이 검사는 그것이 되돌아오지
     않게 한다. 링크 한 줄이면 다시 생기고, 화면은 똑같이 보여서 눈으로는
     알 수 없다.

   왜 CSP 로 막지 않는가
     CSP 는 오리진 전체에 적용되어 문서별로 나눌 수 없다. design-library/ 와
     design-system.html 은 디자이너·개발자용이고 CDN 을 쓴다(실사용자에게
     링크를 노출하지 않는다). CSP 를 좁히면 그 문서가 깨지고, 넓히면 실서비스
     화면도 함께 허용된다. 그래서 파일 단위로 검사한다.

   사용법
     node tools/external-ref-check.mjs

   종료 코드
     0  외부 참조 없음
     1  외부 참조 발견
*/

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
   검사 대상 — 고객이 실제로 여는 것.

   design-library/ · design-system.html · developer-handoff.html ·
   HANDOFF_SUMMARY.html 은 제외한다. 개발·디자인 문서이며 실서비스 화면에서
   링크를 내렸다(app.jsx 의 auth.offline 조건).
*/
const TARGET_FILES = ['index.html'];
const TARGET_DIRS = ['src'];
const TARGET_EXT = new Set(['.html', '.css', '.js', '.jsx']);

/*
   외부 참조로 보는 패턴.

   `http://` 와 `https://` 로 시작하는 주소 중, 실제로 브라우저가 요청을
   보내게 되는 자리만 본다. 주석과 문서 문자열의 주소는 요청을 만들지
   않으므로 제외해야 오탐이 없다.
*/
const FETCHING_ATTR = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
const CSS_URL = /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi;
const IMPORT_URL = /@import\s+(?:url\()?["'](https?:\/\/[^"']+)["']/gi;

/*
   허용 목록.

   ★ 비어 있다. 실서비스 화면은 외부로 아무것도 요청하지 않는 것이 기준이다.
     예외를 추가해야 하는 상황이 오면, 먼저 개인정보처리방침 4절에
     그 제3자를 적고 새 버전을 게시해야 한다(게시본은 수정할 수 없다).
*/
const ALLOWED = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    // 폰트 파일 자체는 검사 대상이 아니다(바이너리).
    if (name === 'fonts') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (TARGET_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

/**
 * 주석을 지운다.
 *
 * 주석에 적힌 주소는 요청을 만들지 않는다. 지우지 않으면 "왜 CDN 을 쓰지
 * 않는가" 를 설명하는 주석이 위반으로 잡혀, 진짜 위반이 그 속에 묻힌다.
 */
function stripComments(text, ext) {
  let s = text;
  if (ext === '.html') s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // /* ... */ 와 // ... — CSS/JS/JSX 공통
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  return s;
}

const files = [
  ...TARGET_FILES.map((f) => join(ROOT, f)),
  ...TARGET_DIRS.flatMap((d) => walk(join(ROOT, d))),
];

const findings = [];
for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const text = stripComments(raw, extname(file));
  for (const re of [FETCHING_ATTR, CSS_URL, IMPORT_URL]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const url = m[1];
      if (ALLOWED.some((a) => url.startsWith(a))) continue;
      // 줄 번호는 원문 기준으로 찾는다(주석 제거로 어긋나므로 문자열로 검색).
      const idx = raw.indexOf(url);
      const line = idx >= 0 ? raw.slice(0, idx).split('\n').length : 0;
      findings.push({ file: file.replace(ROOT + '/', ''), line, url });
    }
  }
}

console.log(`검사 ${files.length}개 파일 (index.html + src/)`);

if (!findings.length) {
  console.log('외부 참조 없음 — 고객 화면은 우리 서버에만 요청한다.');
  process.exit(0);
}

console.log(`\n★ 외부 참조 ${findings.length}건 발견\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    ${f.url}`);
}
console.log(`
  이 주소들은 이용자의 IP 와 User-Agent 를 그 회사로 전달한다.
  개인정보처리방침 4절(제3자 제공)에 없는 전달이면 방침 위반이다.

  해결 방법 중 하나를 고른다.
    1) 자체 호스팅으로 바꾼다 (권장 — 방침을 고치지 않아도 된다)
       · 폰트: src/fonts/ + src/fonts.css 참고
       · 스크립트: vendor/ 참고. 받은 뒤 원본 integrity 해시와 대조할 것
    2) 개인정보처리방침에 그 제3자를 적고 새 버전을 게시한다
       (게시본은 수정할 수 없다 — 새 버전을 등록·게시해야 한다)
`);
process.exit(1);
