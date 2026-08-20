/**
 * 미번역 문구를 소스에서 찾아 준다 (작업용 보조 스크립트).
 *
 * untranslated-scan.mjs 가 내놓은 문구 목록을 받아, 각 문구가 src/*.jsx 의 어디에
 * 있는지 찾는다. 못 찾으면 서버가 만든 문자열이거나 동적으로 조립된 것이다 —
 * 그건 사전으로 해결할 수 없으므로 따로 분류해야 한다.
 *
 *   node tools/locate-strings.mjs /tmp/untrans-user-zh.json
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const listPath = process.argv[2];
if (!listPath) {
  console.error('사용법: node tools/locate-strings.mjs <scan-result.json>');
  process.exit(1);
}
const items = JSON.parse(readFileSync(listPath, 'utf8'));

const SRC = 'src';
const files = readdirSync(SRC).filter((f) => f.endsWith('.jsx') || f.endsWith('.js'));
const bodies = new Map();
for (const f of files) bodies.set(f, readFileSync(join(SRC, f), 'utf8').split('\n'));

/* 동적으로 조립된 문구는 사전만으로 해결되지 않는다 — 미리 걸러 표시한다. */
const looksDynamic = (s) => /\d/.test(s) && !/^(24h|30d|2FA|3-of-5)/i.test(s);

const found = [];
const missing = [];

for (const { text, routes } of items) {
  if (looksDynamic(text)) { missing.push({ text, routes, why: '동적/데이터' }); continue; }
  const hits = [];
  for (const [f, lines] of bodies) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 사전 파일은 제외 (값이 당연히 들어 있다)
      if (f.startsWith('locales')) continue;
      if (!line.includes(text)) continue;
      // 주석 줄은 제외
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      hits.push(`${f}:${i + 1}`);
      if (hits.length >= 3) break;
    }
    if (hits.length >= 3) break;
  }
  if (hits.length) found.push({ text, routes, at: hits });
  else missing.push({ text, routes, why: '소스에서 못 찾음(서버 문자열 가능)' });
}

console.log(`### 소스에서 찾은 것 — ${found.length}종 (사전화 대상)\n`);
for (const f of found) console.log(`${JSON.stringify(f.text)}\n    ${f.at.join(' , ')}`);
console.log(`\n### 못 찾은 것 — ${missing.length}종\n`);
for (const m of missing) console.log(`${JSON.stringify(m.text)}  [${m.why}]`);
