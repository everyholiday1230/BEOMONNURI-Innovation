#!/usr/bin/env node
/* ============================================================
   하드코딩 문자열 검사 — 사전을 거치지 않고 화면에 나가는 글자를 찾는다
   ------------------------------------------------------------
   왜 이 검사가 필요한가

   ★★ 브라우저로 보는 검사만으로는 부족하다.

     `tools/i18n-fallback-check.mjs` 는 **en 사전에 있는 문장**이 번역되지 않은
     자리를 찾는다. 그런데 애초에 사전을 거치지 않고 JSX 에 직접 적힌 글자는
     en 사전에도 없으므로 그 검사에 걸리지 않는다. 실제로 `Email`·`Password`·
     `API Key` 같은 라벨 33개가 그 상태였다 — **모든 언어에서 영어로 보였고**
     어떤 i18n 검사도 이를 보고하지 않았다.

     그래서 소스를 직접 본다. 브라우저 검사(무엇이 보이는가)와 소스 검사(무엇이
     사전을 거치지 않는가)는 서로를 대체하지 못한다.

   무엇을 하드코딩으로 보는가

     · JSX 텍스트 노드:      <div>Order Book</div>
     · 사용자가 읽는 속성:    placeholder / title / aria-label / alt
     · 그 값이 t(...) 나 변수 보간이 아니라 **글자 그대로**인 경우

   무엇을 하드코딩으로 보지 않는가 — 오탐을 만들지 않기 위해

     · 고유명사·티커·단위: BTC, USDT, KuCoin, API, CSV, JSON, UTC …
     · 기호·숫자·구두점만 있는 것: '→', '·', '%', '24h'
     · 코드처럼 보이는 것: css 클래스, 색상값, 경로
     · 개발자 전용 화면: design-library / handoff (디자이너 참고용이며
       고객에게 노출되지 않는다 — 여기까지 번역을 요구하면 진짜 문제가 묻힌다)

   ★ 허용목록은 낱말 단위로만 둔다. 문장을 통째로 허용하기 시작하면 그 목록이
     곧 두 번째 사전이 되어, 무엇이 번역되는지 아무도 알 수 없게 된다.

   사용법
     node tools/hardcoded-text-check.mjs            # 요약
     node tools/hardcoded-text-check.mjs --list     # 전체 목록
     node tools/hardcoded-text-check.mjs --file src/widgets.jsx
   ============================================================ */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = argv.includes('--list');
const ONLY = (() => {
  const i = argv.indexOf('--file');
  return i >= 0 ? argv[i + 1] : null;
})();

/*
   개발·디자인 참고 화면. 고객 동선이 아니다.
   ★ 이 목록은 "번역하지 않아도 되는 곳" 이지 "검사하지 않아도 되는 곳" 이 아니다.
     새 파일을 여기에 넣기 전에, 그 화면을 고객이 볼 수 있는지 먼저 확인할 것.
*/
const DEV_ONLY_FILES = new Set([
  'design-library.jsx',
  'design-handoff.jsx',
  'page-templates.jsx',
]);

/* 번역 대상이 아닌 낱말. 낱말 단위로만 둔다(문장은 절대 넣지 않는다). */
const ALLOW_WORDS = new Set([
  // 브랜드·고유명사
  'ChartControl', 'QuantumTrade', 'KuCoin', 'Binance', 'Bitget', 'OKX', 'Bybit',
  'BitMart', 'Gate.io', 'Kraken', 'Telegram', 'Google', 'Apple', 'Authenticator',
  'Bloomberg', 'TradingView', 'KLineChart', 'React', 'PostgreSQL', 'Redis',
  // 통화·티커·단위
  'USDT', 'USD', 'BTC', 'ETH', 'SOL', 'XRP', 'KRW', 'JPY', 'CNY', 'EUR',
  'bp', 'bps', 'ms', 'px', 'MB', 'KB', 'GB',
  // 기술 약어 (화면에서도 그대로 쓰는 것)
  'API', 'APIs', 'CSV', 'JSON', 'PDF', 'URL', 'IP', 'ID', 'UID', 'UTC', 'TOTP',
  'SMS', 'MFA', '2FA', 'KYC', 'AML', 'CTF', 'GDPR', 'WCAG', 'ARIA', 'HTTPS',
  'WebSocket', 'REST', 'SQL', 'UUID', 'HMAC', 'SHA', 'OAuth', 'CORS', 'CSP',
  'VIP', 'PnL', 'ROI', 'ATR', 'RSI', 'MACD', 'EMA', 'SMA', 'BOLL', 'KDJ',
  'SAR', 'OBV', 'CCI', 'DMI', 'DMA', 'TRIX', 'PSY', 'PVT', 'ROC', 'VR', 'AO',
  'BBI', 'EMV', 'AVP', 'WR', 'BIAS', 'BRAR', 'CR', 'MTM', 'VOL', 'AVL',
  'TP', 'SL', 'OHLC', 'AI', 'LLM', 'GPT', 'Claude',
  // 키보드 키 이름 — 어느 언어에서도 키캡에 적힌 그대로 표기한다
  'Ctrl', 'Shift', 'Alt', 'Cmd', 'Meta', 'Esc', 'Enter', 'Tab', 'Space',
  'Del', 'Backspace', 'Fn',
  // 등급·모드 표기 (대문자 고정 표기를 그대로 쓴다)
  'LIVE', 'PAPER', 'MOCK', 'DEMO', 'BETA', 'PRO', 'VIP1', 'VIP2', 'VIP3',
  'SUPER', 'ADMIN', 'OPS', 'USER', 'L1', 'L2', 'L3',
]);

/* 순수 기호·숫자·짧은 표기 */
const NON_TEXT = /^[\s\d.,:;/|+\-—–·×%()[\]{}<>@#$^*_=~`'"!?→←↑↓▲▼✓✗★☆●○◆■□⚠🎁📌📊📐📍✍️🔒💡🎯🔀→\u200b\uFE0F]*$/u;

/** 낱말이 전부 허용목록에 있으면 번역 대상이 아니다. */
function isAllowed(text) {
  const t = text.trim();
  if (!t || NON_TEXT.test(t)) return true;
  /*
     경로·URL 전체는 번역하지 않는다. 낱말로 쪼갠 뒤에 판단하면 앞의 '/' 가
     떨어져 나가 일반 낱말처럼 보인다 — 그래서 쪼개기 전에 먼저 본다.
  */
  if (/^[./~]/.test(t) || /^[a-z][a-z0-9+.-]*:\/\//.test(t)) return true;
  /*
     kebab-case 한 낱말은 식별자다(CSS 속성·미디어 기능 등). 낱말로 쪼갠 뒤에는
     하이픈이 사라져 일반 낱말처럼 보이므로, 쪼개기 전에 본다.
     예: prefers-reduced-motion
  */
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(t)) return true;
  // 한 낱말이라도 사전에 없는 라틴 낱말이 있으면 번역 대상으로 본다.
  const words = t.split(/[\s/·|,()[\]{}:;+\-—–]+/u).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => {
    const bare = w.replace(/[.,:;!?'"%]+$/u, '').replace(/^['"]+/u, '');
    if (!bare) return true;
    if (/^\d/.test(bare)) return true;                  // 숫자로 시작 → 값
    if (ALLOW_WORDS.has(bare)) return true;
    if (/^[A-Z0-9_]{2,}$/.test(bare)) return true;      // 상수 표기(ORDER_BOOK)
    if (/^[A-Z]$/.test(bare)) return true;              // 한 글자 대문자 (키 이름 Ctrl+Z 의 Z 등)
    if (!/[A-Za-z]/.test(bare)) return true;            // 라틴 문자가 없다
    /*
       경로·URL·파일명은 번역하지 않는다. 화면에 그대로 보여야 하는 값이다
       (예: <code>/design-library/</code>). 번역하면 그 경로를 찾을 수 없게 된다.
    */
    if (/^[./~]|^[a-z]+:\/\//u.test(bare)) return true;
    /*
       kebab-case 한 낱말은 식별자다(CSS 속성·미디어 기능·클래스 이름).
       예: prefers-reduced-motion — 번역하면 그 값을 찾을 수 없게 된다.
    */
    if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/u.test(bare)) return true;
    if (/\.(js|jsx|ts|tsx|css|html|json|md|png|svg)$/u.test(bare)) return true;
    return false;
  });
}

/*
   JSX 텍스트 노드를 뽑는다.

   ★ 완전한 파서를 쓰지 않는다. 대신 "여는 태그의 > 와 다음 < 사이" 를 본다.
     이 방식은 조건식 안의 문자열을 놓치지만, **놓치는 쪽이 낫다** — 오탐이 많으면
     검사를 아무도 보지 않게 되고, 그러면 진짜 하드코딩이 그 속에 묻힌다.
*/
function scanFile(path) {
  const src = readFileSync(join(ROOT, path), 'utf8');
  const hits = [];
  const lines = src.split('\n');

  /*
     ★ 블록 주석을 상태로 추적한다.

       줄 시작이 `*` 인지만 보면, 주석 안의 예시 코드(`  title="Markets"` 처럼
       들여쓰기만 된 줄)가 위반으로 잡힌다. 설명이 위반으로 보고되면 진짜 위반이
       그 속에 묻힌다.
  */
  let inBlockComment = false;

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // 블록 주석 상태 갱신 (한 줄에 열고 닫는 경우도 처리한다)
    let scanLine = line;
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) return;              // 여전히 주석 안
      scanLine = line.slice(end + 2);
      inBlockComment = false;
    }
    const open = scanLine.lastIndexOf('/*');
    const close = scanLine.lastIndexOf('*/');
    if (open !== -1 && open > close) {
      inBlockComment = true;
      scanLine = scanLine.slice(0, open);
    }

    const trimmed = scanLine.trim();
    if (!trimmed || trimmed.startsWith('//')) return;

    /*
       ★ JSX 태그가 없는 줄은 보지 않는다.

         `isLong ? tp > px : tp < px` 같은 순수 JS 줄에서 `> px <` 를 텍스트로
         착각했다. 화면에 나가는 글자는 반드시 태그와 함께 있으므로, 태그가 없는
         줄은 검사 대상이 아니다.
    */
    if (!/<[A-Za-z/]/.test(scanLine)) return;

    /*
       ★ 개발자 전용 화면은 표시로 제외한다.

         `qt-i18n-ignore` 주석이 **이유와 함께** 있는 줄만 건너뛴다. 이유를
         요구하는 까닭: 표시가 늘어날 때 그것이 정당한지 나중에 판단할 수 있어야
         한다. 이유 없는 표시는 그냥 검사를 끄는 것과 같다.
    */
    if (/qt-i18n-ignore\s*:\s*\S/.test(line)) return;
    // 줄 안의 // 주석 뒤는 버린다 (URL 의 // 는 남긴다)
    const lineComment = scanLine.search(/(^|[^:])\/\//u);
    if (lineComment > 0) scanLine = scanLine.slice(0, lineComment + 1);

    /*
       ★ JSX 표현식 조각을 텍스트로 착각하지 않는다.

         줄 단위 정규식은 `h => h.delta < 0` 에서 `> h.delta <` 를 텍스트로 잡고,
         여러 줄에 걸친 삼항 연산자에서도 조각을 잡는다. 실측에서 두 경우 모두
         오탐으로 나타났다.
    */
    const looksLikeCode = (text, before) => {
      if ('=!<->'.includes(before)) return true;            // `=>` `>=` `->` 의 일부
      if (/==|=>|&&|\|\||\?\?/.test(text)) return true;     // 연산자
      /*
         ★ 식별자 판정을 좁힌다.

           전에는 낱말 문자로만 이루어진 텍스트를 모두 식별자로 보고 건너뛰었다.
           그래서 `<th>Symbol</th>` · `<th>Side</th>` 처럼 **한 낱말로 된 표 머리글이
           전부 검사에서 빠졌다.** 검사가 "0건" 이라고 보고하는 동안 주문 표의
           머리글은 영어로 고정돼 있었다.

           식별자는 보통 소문자로 시작하거나 점·괄호를 포함한다. 대문자로 시작하는
           한 낱말은 화면에 보이는 라벨일 가능성이 훨씬 높다.
      */
      const bare = text.trim();
      if (/^[a-z_$][\w$]*$/u.test(bare)) return true;        // 소문자 시작 식별자
      if (/^[\w$]+[.[][\w$.[\]'"]*$/u.test(bare)) return true; // 멤버 접근·인덱싱
      if (/^\s*[:?]\s*$/.test(text)) return true;           // 삼항 조각
      /*
         ★ 따옴표가 들어 있으면 JS 문자열 안이다.

           `applyInline` 처럼 마크다운을 태그로 바꾸는 함수에서
           `'<strong>$1</strong>').replace(/…/g, '<code>$1</code>')` 의 가운데
           토막이 텍스트로 잡혔다. 화면에 나가는 JSX 텍스트에 생따옴표를 쓰는
           일은 없다(사전으로 옮기면 더욱 없다).
      */
      if (/['"`]/.test(text)) return true;
      if (/\$\d/.test(text)) return true;                    // 정규식 치환 참조
      return false;
    };

    // 1) 텍스트 노드:  >Order Book<
    for (const m of scanLine.matchAll(/>([^<>{}\n]+)</gu)) {
      const text = m[1];
      const before = m.index > 0 ? scanLine[m.index - 1] : '';
      if (looksLikeCode(text, before)) continue;
      if (isAllowed(text)) continue;
      hits.push({ path, lineNo, kind: 'text', text: text.trim().slice(0, 70) });
    }

    // 2) 사용자가 읽는 속성
    for (const m of scanLine.matchAll(/\b(placeholder|title|aria-label|alt)=(?:"([^"]*)"|'([^']*)')/gu)) {
      const text = m[2] ?? m[3] ?? '';
      if (isAllowed(text)) continue;
      hits.push({ path, lineNo, kind: m[1], text: text.trim().slice(0, 70) });
    }
  });

  return hits;
}

// ---- 실행 ----

const files = ONLY
  ? [ONLY]
  : readdirSync(join(ROOT, 'src'))
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => !DEV_ONLY_FILES.has(f))
    .map((f) => join('src', f));

const all = [];
for (const f of files) {
  try {
    all.push(...scanFile(f));
  } catch (e) {
    console.log(`  ⚠ ${f} 읽기 실패: ${String(e).slice(0, 70)}`);
  }
}

const byFile = new Map();
for (const h of all) {
  if (!byFile.has(h.path)) byFile.set(h.path, []);
  byFile.get(h.path).push(h);
}

console.log('하드코딩 문자열 검사\n');
console.log(`  검사 파일 ${files.length}개 (개발 전용 ${DEV_ONLY_FILES.size}개 제외)\n`);

for (const [path, hits] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(hits.length).padStart(4)}건  ${path}`);
  if (LIST) {
    for (const h of hits) console.log(`          ${String(h.lineNo).padStart(5)}: [${h.kind}] ${h.text}`);
  }
}

console.log(`\n  합계 ${all.length}건`);
if (all.length && !LIST) console.log('  전체 목록: --list');
console.log('\n  ★ 사전을 거치지 않는 글자는 언어를 바꿔도 그대로 남는다.');
console.log('    t() 로 바꾸고 en/ja/zh 사전에 키를 넣어야 한다.');

exit(all.length === 0 ? 0 : 1);
