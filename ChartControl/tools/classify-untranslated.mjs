/**
 * 미번역 문구를 두 유형으로 나눈다 (작업용 보조 스크립트).
 *
 *   A형 — en 사전에는 있고 ja/zh 에만 없는 키. 번역만 추가하면 된다(코드 무수정).
 *   B형 — 사전에 아예 없는 문자열. JSX 에 직접 쓴 것이므로 키를 만들고 t() 로 바꿔야 한다.
 *
 * 두 유형을 섞어서 작업하면 "사전에 넣었는데 화면이 안 바뀐다"(B형인데 A형으로 처리)
 * 같은 혼선이 생긴다.
 *
 *   node tools/classify-untranslated.mjs /tmp/untrans-user-zh.json zh
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const listPath = process.argv[2];
const locale = process.argv[3] ?? 'zh';
if (!listPath) {
  console.error('사용법: node tools/classify-untranslated.mjs <scan.json> <locale>');
  process.exit(1);
}

const LOC = 'src/locales';
const loadDict = (sfx) => {
  const out = new Map();     // key -> value
  const files = readdirSync(LOC).filter((f) => f === `${sfx}.js` || f.endsWith(`.${sfx}.js`));
  for (const f of files) {
    const txt = readFileSync(join(LOC, f), 'utf8');
    /* 값이 작은따옴표·큰따옴표 양쪽으로 쓰여 있다. */
    for (const m of txt.matchAll(/^\s{4,}([A-Za-z0-9_]+):\s*(['"])((?:[^\\]|\\.)*?)\2\s*,?\s*$/gm)) {
      out.set(m[1], { v: m[3].replace(/\\'/g, "'").replace(/\\"/g, '"'), file: f });
    }
  }
  return out;
};

const en = loadDict('en');
const tgt = loadDict(locale);

/* 값 → 키 목록 (en) */
const byValue = new Map();
for (const [k, o] of en) {
  if (!byValue.has(o.v)) byValue.set(o.v, []);
  byValue.get(o.v).push(k);
}

const items = JSON.parse(readFileSync(listPath, 'utf8'));

const typeA = [];   // 사전에 있음 → 번역만 추가
const typeB = [];   // 사전에 없음 → 키 신설 + t() 치환
const dynamic = [];

const looksDynamic = (s) => /\d/.test(s) && !/^(24h|30d|2FA|3-of-5|125)/i.test(s);

for (const { text, routes } of items) {
  const keys = byValue.get(text);
  if (keys && keys.length) {
    const need = keys.filter((k) => !tgt.has(k));
    if (need.length) typeA.push({ text, routes, keys: need, allKeys: keys });
    continue;   // 이미 번역된 키만 있으면 다른 이유로 보인 것이다(동적 조립 등)
  }
  if (looksDynamic(text)) { dynamic.push({ text, routes }); continue; }
  typeB.push({ text, routes });
}

console.log(`## A형 — en 사전에 있고 ${locale} 에만 없음 (번역 추가만): ${typeA.length}종\n`);
for (const a of typeA) console.log(`${JSON.stringify(a.text)}\n    키: ${a.keys.join(', ')}`);

console.log(`\n## B형 — 사전에 없음 (키 신설 + t() 치환 필요): ${typeB.length}종\n`);
for (const b of typeB) console.log(`${JSON.stringify(b.text)}   [${b.routes.join(' ')}]`);

console.log(`\n## 동적/데이터 (번역 대상 아님): ${dynamic.length}종\n`);
for (const d of dynamic) console.log(`${JSON.stringify(d.text)}`);
