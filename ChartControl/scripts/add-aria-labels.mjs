#!/usr/bin/env node
/*
   남은 입력칸에 접근성 라벨을 붙인다 — **태그 단위**로 처리한다.

   ★★ 왜 다시 쓰는가

     앞선 스크립트는 줄 단위였다. 이 코드베이스의 입력 태그는 여러 줄에 걸쳐 있어
     `placeholder`·`title`·`aria-label` 이 시작 줄에 없는 경우가 많고, 그래서 36개가
     남았다(테스트가 잡아냈다). 파일 전체를 문자열로 보고 태그마다 판단한다.

   ★ 라벨 문구은 새로 만들지 않는다. 근거 우선순위:
       1) 태그 안 placeholder={t('키')}
       2) 태그 안 title={t('키')}
       3) 태그 바로 앞의 input-group__label 안 t('키')
       4) 태그를 감싸는 <label> 의 앞선 t('키')
     하나도 없으면 건드리지 않고 보고한다 — 아무 이름이나 붙이면 "라벨이 있다" 는
     거짓 신호가 되고, 화면 글자와 읽히는 글자가 달라진다.
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
  let changedInFile = 0;
  let searchFrom = 0;

  for (;;) {
    const m = /<(input|select|textarea)([\s>])/i.exec(text.slice(searchFrom));
    if (!m) break;
    const tagStart = searchFrom + m.index;
    // 태그 끝(> 또는 />)을 찾는다. 중괄호 안의 > 는 무시한다.
    let depth = 0;
    let tagEnd = -1;
    for (let i = tagStart; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) { tagEnd = i; break; }
    }
    if (tagEnd === -1) break;
    const tag = text.slice(tagStart, tagEnd + 1);
    searchFrom = tagEnd + 1;

    if (/type=["'](checkbox|radio|hidden)["']/.test(tag)) continue;
    if (/aria-label\s*=/.test(tag)) continue;

    // 근거 찾기
    let expr = null;
    const ph = tag.match(new RegExp(`placeholder=${KEY.source}`, 'i'));
    if (ph) expr = `{t('${ph[1]}')}`;
    if (!expr) {
      const ti = tag.match(new RegExp(`title=${KEY.source}`, 'i'));
      if (ti) expr = `{t('${ti[1]}')}`;
    }
    if (!expr) {
      // 앞 400자 안의 라벨 span
      const before = text.slice(Math.max(0, tagStart - 400), tagStart);
      const lab = [...before.matchAll(new RegExp(`input-group__label[^>]*>\\s*(?:<[^>]+>\\s*)*${KEY.source}`, 'gi'))].pop();
      if (lab) expr = `{t('${lab[1]}')}`;
    }
    if (!expr) {
      // 감싸는 <label> 의 앞선 문구
      const before = text.slice(Math.max(0, tagStart - 500), tagStart);
      const li = before.lastIndexOf('<label');
      if (li >= 0) {
        const seg = before.slice(li);
        const lab = [...seg.matchAll(new RegExp(KEY.source, 'gi'))].pop();
        if (lab) expr = `{t('${lab[1]}')}`;
      }
    }

    if (!expr) {
      unresolved.push(`${file}  ${tag.replace(/\s+/g, ' ').slice(0, 86)}`);
      continue;
    }

    if (!reportOnly) {
      const injected = tag.replace(/<(input|select|textarea)([\s>])/i, (s2, t2, sep) => `<${t2} aria-label=${expr}${sep === '>' ? '>' : sep}`);
      text = text.slice(0, tagStart) + injected + text.slice(tagEnd + 1);
      searchFrom = tagStart + injected.length;
    }
    changedInFile += 1;
    added += 1;
  }

  if (!reportOnly && changedInFile > 0) writeFileSync(path, text, 'utf8');
  if (changedInFile > 0) console.log(`${path.padEnd(30)} ${changedInFile}개`);
}

console.log(`\n합계 ${added}개${reportOnly ? ' (보고만)' : ' 보강'}`);
if (unresolved.length) {
  console.log('\n근거 없음 — 건드리지 않았다:');
  for (const u of unresolved) console.log('  ', u);
}
