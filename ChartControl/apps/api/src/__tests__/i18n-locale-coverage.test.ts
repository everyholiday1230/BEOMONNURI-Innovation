import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI_LOCALES, LEGAL_DOC_LOCALES, localeFilesPresent, localeDictFiles } from './helpers/ui-locales';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * 사전 검사의 **대상 언어 목록** 자체를 지키는 시험.
 *
 * ★★ 왜 필요한가
 *
 *   사전 내용을 검사하는 시험이 10개 넘게 있는데, 전부 `['en','ja','zh']` 를 각자
 *   하드코딩하고 있었다. 신흥시장 6개 언어를 추가한 뒤에도 아무도 그 목록을 고치지
 *   않아서, **새 언어 6개가 모든 검사에서 빠졌다.** 시험은 계속 초록색이었다.
 *
 *   그중에는 "제안 문구에 매수·매도 권유가 없는가" 검사가 있다. 투자자문 등록이
 *   없는 회사가 권유를 하면 안 되기 때문에 만든 검사다. 그 검사가 6개 언어를
 *   보지 않는다는 것은 **없는 것과 같다.**
 *
 * ★ 그래서 목록을 `src/i18n.js` 에서 읽어 오게 바꿨고(helpers/ui-locales.ts),
 *   이 파일이 그 도출이 계속 맞는지 확인한다. 도출이 조용히 망가지면 위 검사들이
 *   전부 함께 약해지므로, 여기가 가장 위에 있는 안전장치다.
 */
describe('I18N-COVERAGE — 사전 검사의 대상 언어 목록', () => {
  it('[1] 화면 언어 목록이 사전 파일과 정확히 일치한다', () => {
    /*
       어긋나는 두 방향 모두 결함이다.
        · 파일은 있는데 목록에 없다 → 그 언어는 검사를 받지 않는다(과거의 상태).
        · 목록에 있는데 파일이 없다 → 지연 로드가 404 로 떨어져 그 언어 전체가
          영어로 남는다(i18n.js 의 LAZY_LOCALES 주석 참고).
    */
    expect([...UI_LOCALES].sort()).toEqual(localeFilesPresent());
  });

  it('[2] 목록이 조용히 줄어들지 않는다', () => {
    /*
       ★ 개수를 박아 두지 않는다 — 언어를 더하는 것은 정상이다. 대신 **줄어드는**
         것을 막는다. 지금까지 늘려 온 9개 미만이 되면 어딘가에서 언어가 사라진 것이다.
    */
    expect(UI_LOCALES.length).toBeGreaterThanOrEqual(9);
    expect(UI_LOCALES[0], '폴백 영어가 첫 번째여야 한다').toBe('en');
    for (const need of ['en', 'ja', 'zh', 'vi', 'hi', 'pt', 'es', 'tr', 'fil']) {
      expect(UI_LOCALES, `${need} 가 목록에서 빠졌다`).toContain(need);
    }
  });

  it('[3] 목록이 i18n.js 에서 도출된다 — 손으로 적은 것이 아니다', () => {
    /*
       ★ 도출이 실제로 i18n.js 를 읽는지 확인한다. 헬퍼가 어느 날 배열 리터럴로
         바뀌면 이 시험이 잡는다.
    */
    const helper = read('apps/api/src/__tests__/helpers/ui-locales.ts');
    expect(helper).toMatch(/readFileSync\([^)]*'i18n\.js'/u);
    expect(helper).toMatch(/LAZY_LOCALE_META/u);

    /* i18n.js 안에 실제로 그 언어들이 있는지도 본다. */
    const i18n = read('src/i18n.js');
    for (const code of UI_LOCALES) {
      if (code === 'en') continue;
      expect(i18n, `i18n.js LAZY_LOCALES 에 ${code} 가 없다`).toMatch(new RegExp(`^\\s*${code}:\\s*\\[`, 'mu'));
    }
  });

  /**
   * ★★ 법적 문서는 화면 언어보다 적다 — 그 사실을 **드러내 둔다.**
   *
   *   화면은 9개 언어인데 약관·개인정보·위험고지·환불·보안 문서는 en·ja·zh 3개뿐이다.
   *   즉 베트남어 화면을 쓰는 고객은 **영어 약관에 동의**한다. 동의의 유효성은
   *   법률 검토가 필요한 사안이라 코드로 메울 수 없다.
   *
   *   이 시험은 격차를 "고쳐야 할 실패" 로 만들지 않는다 — 지금 상태를 정확히
   *   고정해서, 문서 언어가 늘거나 줄면 반드시 눈에 띄게 한다. 문서를 추가하면
   *   이 시험이 실패하고, 그때 `SEED_LOCALES` 와 이 목록을 함께 고치게 된다.
   */
  it('[4] 법적 문서 언어가 SEED_LOCALES 와 실제 파일과 일치한다', () => {
    const seed = read('apps/api/src/legal/seed-legal.ts');
    const m = /SEED_LOCALES\s*=\s*\[([^\]]*)\]/u.exec(seed);
    expect(m, 'seed-legal.ts 에서 SEED_LOCALES 를 찾지 못했다').toBeTruthy();
    const codes = [...m![1]!.matchAll(/'([a-z-]+)'/gu)].map((x) => x[1]!);
    expect(codes.sort()).toEqual([...LEGAL_DOC_LOCALES].sort());

    /* 선언한 언어의 문서가 실제로 있는지 — 없으면 게시가 조용히 비어 버린다. */
    for (const loc of LEGAL_DOC_LOCALES) {
      for (const doc of ['terms', 'privacy', 'risk', 'refund', 'security']) {
        expect(() => read(`docs/legal/${doc}-${loc}.md`), `docs/legal/${doc}-${loc}.md 가 없다`).not.toThrow();
      }
    }
  });

  it('[5] 화면 언어 중 법적 문서가 없는 언어를 기록한다 — 법률 검토 대기 항목', () => {
    const gap = UI_LOCALES.filter((l) => !LEGAL_DOC_LOCALES.includes(l));
    /*
       ★ 지금은 6개다. 이 숫자가 바뀌면(언어를 더 넣거나 문서를 번역하면) 이 시험이
         실패해서 "법률 검토가 필요한 범위가 달라졌다" 는 사실을 알린다.
         숫자를 맞추려고 목록을 조작하지 말고, 실제 상태를 반영해 고칠 것.
    */
    expect(gap, `법적 문서가 없는 화면 언어: ${gap.join(', ')} — 이 언어 고객은 영어 약관에 동의한다`)
      .toEqual(['vi', 'hi', 'pt', 'es', 'tr', 'fil']);
  });

  /**
   * ★★ 이스케이프가 문자열로 새어 화면에 그대로 찍히는 것을 막는다.
   *
   *   실제로 있었다: `en.js` 의 `tl_rate_note` 가
   *   `'... each leader\\u2019s downline ...'` 였다. 자바스크립트 문자열에서
   *   `\\u2019` 는 역슬래시 + "u2019" 이므로, 화면에 아포스트로피가 아니라
   *   **`\u2019` 여섯 글자가 그대로** 보였다.
   *
   *   번역 파일을 스크립트로 생성·수정할 때 한 번 더 이스케이프되면서 생긴다.
   *   조용히 지나가는 종류라 검사로 고정한다.
   */
  it('[6] 사전에 이스케이프가 문자열로 새어 있지 않다', () => {
    const leaks: string[] = [];
    for (const file of localeDictFiles()) {
      const src = read(`src/locales/${file}`);
      src.split('\n').forEach((line, i) => {
        /* 실제 파일에 역슬래시 두 개 + uXXXX 가 있으면 화면에 노출된다. */
        if (/\\\\u[0-9a-fA-F]{4}/u.test(line)) leaks.push(`${file}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
    }
    expect(leaks, `이스케이프가 화면에 그대로 노출된다:\n${leaks.join('\n')}`).toEqual([]);
  });
});
