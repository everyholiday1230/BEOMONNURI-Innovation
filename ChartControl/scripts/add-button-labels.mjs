#!/usr/bin/env node
/*
   아이콘 버튼에 접근성 이름을 붙인다.

   ★★ 왜 필요한가

     헤더의 아이콘 버튼들은 `title` 만 갖고 있고 `aria-label` 이 없다. `title` 은
     접근성 이름으로 **쓰이지 않는다** — 요소 안 텍스트가 있으면 그것이 이기고,
     없으면 이름 없는 버튼이 된다. 계정 버튼은 안에 이니셜 한 글자("A")가 있어서
     접근성 이름이 "A" 였다.

       · 스크린리더 사용자에게는 "A 버튼" 이다. 무엇을 하는 버튼인지 알 수 없다.
       · getByRole('button', { name: … }) 로 찾을 수 없어 e2e 가 계정/로그아웃
         흐름을 검증할 수 없다.

   ★ 이름은 새로 만들지 않는다. 이미 있는 `title={t('키')}` 를 그대로 aria-label 로
     쓴다 — 마우스 사용자가 보는 설명과 스크린리더가 읽는 설명이 같아야 한다.

   ★ title 이 없거나 사전 키가 아닌 버튼은 건드리지 않고 보고한다.
*/
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const reportOnly = process.argv.includes('--report');
const KEY = /\{t\(\s*'([a-z0-9_]+)'(?:\s*,[^)]*)?\)\}/i;

let added = 0;
const unresolved = [];

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.jsx')).sort()) {
  const path = join(SRC, file);
  let text = readFileSync(path, 'utf8');
  let changed = 0;
  let from = 0;

  for (;;) {
    const m = /<button([\s>])/i.exec(text.slice(from));
    if (!m) break;
    const start = from + m.index;
    // 속성 안의 화살표 함수(=>) 때문에 첫 '>' 로 끊으면 안 된다. 중괄호 깊이를 센다.
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) { end = i; break; }
    }
    if (end === -1) break;
    const tag = text.slice(start, end + 1);
    from = end + 1;

    if (/aria-label\s*=/.test(tag)) continue;
    /*
       title 값을 그대로 aria-label 로 옮긴다.

       ★ 단순 키(`title={t('키')}`) 뿐 아니라 **조건식**(`title={a ? t('x') : t('y')}`)
         도 그대로 쓴다. 조건식을 건너뛰면 접기/펴기·활성/비활성 토글 버튼이
         이름 없이 남는데, 그런 버튼이 실제로 12개였다.
    */
    const expr = (() => {
      const i = tag.search(/\stitle\s*=\s*\{/);
      if (i === -1) return null;
      const open = tag.indexOf('{', i);
      let d = 0;
      for (let k = open; k < tag.length; k += 1) {
        if (tag[k] === '{') d += 1;
        else if (tag[k] === '}') { d -= 1; if (d === 0) return tag.slice(open, k + 1); }
      }
      return null;
    })();
    if (!expr || !/\bt\(/.test(expr)) {
      if (/title\s*=/.test(tag)) unresolved.push(`${file}  ${tag.replace(/\s+/g, ' ').slice(0, 84)}`);
      continue;
    }
    if (!reportOnly) {
      const injected = tag.replace(/<button([\s>])/i, (s2, sep) => `<button aria-label=${expr}${sep === '>' ? '>' : sep}`);
      text = text.slice(0, start) + injected + text.slice(end + 1);
      from = start + injected.length;
    }
    changed += 1;
    added += 1;
  }

  if (!reportOnly && changed > 0) writeFileSync(path, text, 'utf8');
  if (changed > 0) console.log(`${path.padEnd(30)} ${changed}개`);
}

console.log(`\n합계 ${added}개${reportOnly ? ' (보고만)' : ' 보강'}`);
if (unresolved.length) {
  console.log('\ntitle 이 사전 키가 아니라 건드리지 않았다:');
  for (const u of unresolved.slice(0, 12)) console.log('  ', u);
}
