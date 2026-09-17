import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');

/**
 * 화면이 실제로 제공하는 언어 목록 — **단일 출처**.
 *
 * ★★ 왜 이 파일이 필요한가
 *
 *   사전 검사 시험들이 `['en','ja','zh']` 를 **각자 하드코딩**하고 있었다(10개 파일).
 *   그 뒤 신흥시장 6개 언어(vi hi pt es tr fil)를 추가했는데, 시험 목록은 아무도
 *   고치지 않았다. 결과: **새 언어 6개가 모든 사전 검사에서 빠졌다.**
 *
 *   빠진 검사 중에는 "제안 문구에 매수·매도 권유가 없는가" 가 있다. 이 회사는
 *   투자자문 등록이 없어서 권유를 할 수 없다. 즉 번역자가 베트남어에 "지금 사세요"
 *   를 넣어도 아무도 잡지 못하는 상태였다 — 검사가 있다고 믿으면서.
 *
 * ★ 그래서 목록을 코드에 적지 않고 `src/i18n.js` 에서 **읽어 온다.**
 *   언어를 추가하는 사람은 i18n.js 를 고칠 수밖에 없으므로(고치지 않으면 화면에
 *   나타나지 않는다) 검사 대상이 자동으로 따라온다.
 *
 * ★ 정적 폴백(en) + 지연 로드 대상(LAZY_LOCALE_META) 을 합친 것이 "제공 언어" 다.
 *   `available()` 이 화면에 만들어 주는 목록과 같은 정의다.
 */
function readUiLocales(): string[] {
  const src = readFileSync(join(ROOT, 'src', 'i18n.js'), 'utf8');

  const metaBlock = /const\s+LAZY_LOCALE_META\s*=\s*\{([\s\S]*?)\n\s*\};/u.exec(src);
  if (!metaBlock) throw new Error('i18n.js 에서 LAZY_LOCALE_META 를 찾지 못했다 — 검사 대상 언어를 정할 수 없다');

  /*
     ★ 주석을 먼저 지운다. 이 저장소는 주석에 예시 코드를 그대로 남기는 규약이라
       (`vi: { label: ... }` 같은 설명이 주석 안에 있다) 정규식이 주석을 집는다.
  */
  const body = metaBlock[1]!
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '');

  const lazy = [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*\{/gmu)].map((m) => m[1]!);
  if (lazy.length === 0) throw new Error('LAZY_LOCALE_META 가 비어 보인다 — 정규식이 빗나갔다');

  /* 폴백 영어는 지연 목록에 없다(정적으로 실린다). 항상 첫 번째로 둔다. */
  return ['en', ...lazy.filter((c) => c !== 'en')];
}

/**
 * 화면이 제공하는 모든 언어. 사전 검사는 이 목록을 돌아야 한다.
 *
 * ★ 한 번만 읽는다 — 시험 파일마다 디스크를 다시 읽을 이유가 없다.
 */
export const UI_LOCALES: readonly string[] = readUiLocales();

/**
 * 법적 문서가 게시되는 언어 (`SEED_LOCALES`).
 *
 * ★★ `UI_LOCALES` 와 **다르다.** 화면은 9개 언어인데 약관·개인정보·위험고지는
 *   en·ja·zh 3개뿐이다. 그 격차는 법률 검토가 필요한 사안이라 코드로 메울 수 없다.
 *   두 목록을 섞지 않기 위해 이름을 나눠 둔다 — 문서 검사는 이쪽을 쓴다.
 */
export const LEGAL_DOC_LOCALES: readonly string[] = ['en', 'ja', 'zh'];

/**
 * `src/locales/` 의 모든 사전 파일 이름.
 *
 * ★ 언어 코드가 아니라 **파일 단위**로 돌려준다 — `en.js` 와 `copilot.en.js` 를
 *   따로 훑어야 하는 검사(이스케이프 누출 등)가 있다.
 */
export function localeDictFiles(): string[] {
  return readdirSync(join(ROOT, 'src', 'locales'))
    .filter((f) => f.endsWith('.js'))
    .sort();
}

/**
 * `src/locales/` 에 메인 사전 파일이 실제로 있는 언어.
 *
 * ★ `UI_LOCALES` 와 어긋나면 어느 한쪽이 틀린 것이다. 그것을 시험이 잡는다.
 */
export function localeFilesPresent(): string[] {
  return [...new Set(
    readdirSync(join(ROOT, 'src', 'locales'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.replace(/\.js$/u, '').split('.').pop()!),
  )].sort();
}
