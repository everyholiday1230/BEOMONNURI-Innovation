#!/usr/bin/env node
/*
   인증 화면 입력칸에 접근성 라벨(aria-label)을 붙인다.

   ★★ 왜 필요한가

     라벨이 <span className="input-group__label"> 로만 있고 input 과 **연결돼 있지
     않다**(htmlFor/id 도, aria-label 도 없다). 그래서:

       · 스크린리더 사용자는 어느 칸이 이메일이고 어느 칸이 비밀번호인지 알 수 없다.
       · e2e 가 getByLabel('email') 로 칸을 찾지 못해 **모든 인증 흐름 테스트가
         실패**한다(24개 스펙이 이 방식을 쓴다).

     즉 접근성 결함이 검증 수단까지 막고 있었다.

   ★ 라벨 텍스트는 사전 키(t('fld_email'))다. aria-label 에 같은 값을 넣으면
     번역이 함께 따라온다 — 영어 문자열을 새로 박으면 두 벌이 되어 어긋난다.
*/
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/pages-auth.jsx';
const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

let added = 0;
for (let i = 0; i < lines.length - 1; i += 1) {
  const label = lines[i];
  if (!label.includes('input-group__label')) continue;
  // 라벨 span 에서 사전 키를 뽑는다: {t('fld_email')}
  const key = label.match(/\{t\('([a-z0-9_]+)'(?:,[^)]*)?\)\}/i);
  if (!key) continue;
  // 바로 다음 줄(또는 그 다음)의 input/select 에 aria-label 을 붙인다.
  for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j += 1) {
    const el = lines[j];
    if (!/<(input|select|textarea)\s/.test(el)) continue;
    if (el.includes('aria-label=')) break;
    lines[j] = el.replace(/<(input|select|textarea)\s/, `<$1 aria-label={t('${key[1]}')} `);
    added += 1;
    break;
  }
}

writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log(`${FILE}: aria-label ${added}개 추가`);
