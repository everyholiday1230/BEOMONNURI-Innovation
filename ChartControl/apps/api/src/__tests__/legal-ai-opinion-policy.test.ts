import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
   **AI 가 방향성 견해를 말할 수 있게 한 정책이 문서와 어긋나지 않게 잠근다.**

   운영 결정(2026-09-18): AI 는 자기 견해를 **참고자료로** 말할 수 있다. 대신 문서가
   그것을 정확히 반영해야 한다.

   ★★★ 왜 시험이 필요한가 — **환불 근거가 약관에 매달려 있다.**

     예전 환불 정책은 "ChartControl 은 분석 소프트웨어이고 투자자문을 하지 않으므로
     시장 손실은 환불할 수 없다" 였다. AI 가 방향을 말하게 되면 그 한 문장이 곧
     거짓이 되고, **우리가 환불을 거절할 근거가 우리 손으로 무너진다.**

     그래서 환불 근거를 문장 하나가 아니라 **구조적 사실 여러 개**로 다시 세웠다.
     누가 그중 하나를 지우면 근거가 다시 약해지므로 여기서 막는다.

   ★ 세 언어를 함께 본다. 한 언어만 고치면 그 언어 고객은 옛 약관을 읽는다.
*/

const ROOT = join(__dirname, '../../../..');
const LEGAL = join(ROOT, 'docs/legal');
const read = (f: string) => readFileSync(join(LEGAL, f), 'utf8');
const LOCALES = ['en', 'ja', 'zh'] as const;

describe('법적 문서가 AI 견해 정책과 일치한다', () => {
  it('약관에서 무조건적인 "투자자문 안 함" 문장이 사라졌다', () => {
    /*
       ★ 지우는 것이 목적이 아니다. **한정 없는** 부정이 남아 있으면 안 된다는 뜻이다.
         "등록 투자자문업자가 아니다" 와 "개별 사정에 맞춘 자문을 하지 않는다" 는
         유지한다 — 그것은 사실이고, 방향 견해와 모순되지 않는다.
    */
    const en = read('terms-en.md');
    expect(en, '한정 없는 "we do not provide investment advice" 가 남아 있다')
      .not.toMatch(/\*\*We do not provide investment advice[,.]/u);
    expect(en, '등록 투자자문업자가 아니라는 사실이 빠졌다')
      .toMatch(/not a registered investment adviser/iu);
    expect(en, '개별 맞춤 자문을 하지 않는다는 한정이 빠졌다')
      .toMatch(/personalised investment advice/iu);
  });

  it('약관에 AI 견해 조항이 있고 필요한 사실을 모두 밝힌다', () => {
    const en = read('terms-en.md');
    expect(en, 'AI 견해 조항(2A)이 없다').toMatch(/##\s*2A\./u);
    const i = en.indexOf('## 2A.');
    const sec = en.slice(i, en.indexOf('\n## ', i + 5));

    /* 이 다섯 가지는 하나라도 빠지면 "참고자료" 라는 성격이 성립하지 않는다. */
    expect(sec, '권유가 아니라는 사실이 없다').toMatch(/not a solicitation/iu);
    expect(sec, '개별 맞춤이 아니라는 사실이 없다').toMatch(/not tailored to you/iu);
    expect(sec, '틀릴 수 있다는 사실이 없다').toMatch(/can be wrong/iu);
    expect(sec, '적중률을 주장하지 않는다는 사실이 없다')
      .toMatch(/no accuracy rate is claimed/iu);
    expect(sec, '판단이 고객 것이라는 사실이 없다').toMatch(/decision is yours/iu);
  });

  it('환불 근거가 문장 하나가 아니라 구조적 사실로 서 있다', () => {
    /*
       ★★★ 여기가 이 시험의 핵심이다. 옛 근거("투자자문을 하지 않으므로")를 지웠으니
         대체 근거가 실제로 있어야 한다. 없으면 환불 거절이 근거를 잃는다.
    */
    const en = read('refund-en.md');
    expect(en, '옛 근거 문장이 그대로 남아 있다 — 이제 사실과 다르다')
      .not.toMatch(/is analysis software and does not provide investment advice/iu);

    const i = en.indexOf('## 5.');
    const sec = en.slice(i, en.indexOf('\n## ', i + 5));
    expect(sec, '§5 를 찾지 못했다').not.toBe('');

    /* 근거 다섯 축 — 하나라도 빠지면 환불 거절이 약해진다. */
    expect(sec, '주문을 고객이 낸다는 근거가 없다')
      .toMatch(/entered and approved by you/iu);
    expect(sec, '거래가 거래소에서 일어난다는 근거가 없다')
      .toMatch(/at your own exchange/iu);
    expect(sec, '출력이 참고자료라는 근거가 없다')
      .toMatch(/reference material, not advice/iu);
    expect(sec, '규칙을 고객이 썼다는 근거가 없다')
      .toMatch(/rule is one you wrote/iu);
    expect(sec, '결과를 약속하지 않는다는 근거가 없다')
      .toMatch(/promise no result/iu);
    /* 약관 조항을 실제로 가리켜야 한다 — 근거가 어디에 있는지 확인 가능해야 한다. */
    expect(sec, '약관 조항 참조가 없다').toMatch(/Terms §/u);

    /*
       ★ 우리 잘못일 때는 환불한다는 것도 함께 있어야 한다. 전부 거절만 적어 두면
         소비자법상 배제할 수 없는 권리와 부딪친다.
    */
    expect(en, '실제로 제공되지 않은 경우의 환불 조항이 없다')
      .toMatch(/did not actually deliver/iu);
    expect(en, '소비자법 우선 문구가 없다')
      .toMatch(/cannot be excluded/iu);
  });

  it('세 언어가 모두 갱신됐다 — 한 언어만 고치면 그 고객은 옛 약관을 읽는다', () => {
    for (const l of LOCALES) {
      const terms = read(`terms-${l}.md`);
      const refund = read(`refund-${l}.md`);
      /* 방향성 견해를 언급하는지(언어별 표현이 다르므로 개별 확인) */
      const mentionsView = /directional view/i.test(terms)
        || /方向性の見解/.test(terms)
        || /方向性观点/.test(terms);
      expect(mentionsView, `terms-${l}.md 에 방향성 견해 언급이 없다`).toBe(true);

      const hasNewRefund = /entered and approved by you/i.test(refund)
        || /お客様が入力し承認します/.test(refund)
        || /由你输入并确认/.test(refund);
      expect(hasNewRefund, `refund-${l}.md 의 환불 근거가 갱신되지 않았다`).toBe(true);
    }
  });

  it('개정판이 새 버전 라벨로 배포된다 — 라벨을 안 올리면 게시되지 않는다', () => {
    /*
       ★★ 실제로 겪은 일이다: 파일을 고치고 배포했는데 게시본이 그대로였다.
         seed-legal 은 (종류·언어·버전)이 같으면 이미 공개된 것으로 보고 건너뛴다.
    */
    const yaml = readFileSync(join(ROOT, 'render.yaml'), 'utf8');
    const m = /- key: LEGAL_VERSION[\s\S]{0,1400}?\n\s+value: "([^"]+)"/u.exec(yaml);
    expect(m, 'render.yaml 에서 LEGAL_VERSION 을 찾지 못했다').not.toBeNull();
    const version = m![1]!;
    /*
       ★★★ **고정값으로 잠그지 않는다.**

         전에는 `toBe('2026-09-18')` 이었다. 그래서 개인정보처리방침을 또 개정해
         라벨을 올리면(2026-09-19) 이 시험이 실패했다 — **올리는 것이 옳은 동작인데
         시험이 막았다.** 시험은 "AI 견해 정책 개정판이 게시될 수 있는 라벨인가" 를
         봐야 한다. 그 개정일(2026-09-18) **이상**이면 통과다.
       ★ 라벨이 개정일보다 앞서면(작으면) `seed-legal` 이 옛 버전으로 게시하므로
         개정판이 반영되지 않는다 — 그것만 막는다.
    */
    expect(version.localeCompare('2026-09-18'), `라벨 ${version} 이 개정일 2026-09-18 보다 앞선다 — 개정판이 게시되지 않는다`)
      .toBeGreaterThanOrEqual(0);

    /* 본문 시행일과 배포 라벨이 맞아야 한다(seed-legal 이 어긋남을 보고한다). */
    for (const l of LOCALES) {
      expect(read(`terms-${l}.md`), `terms-${l}.md 시행일이 라벨과 다르다`)
        .toMatch(/18 September 2026|2026年9月18日|2026 年 9 月 18 日/u);
    }
  });

  it('법적 문서에 다른 언어 문자가 섞이지 않았다', () => {
    /*
       ★★★ 실제로 겪었다 — 일본어 문서에 러시아어 단어(судить)가 섞여 들어갔다.
         내가 개정하면서 만든 오류다. 문법 검사로는 잡히지 않고, 그 언어를 읽는
         고객만 발견한다. 그래서 스크립트 단위로 막는다.

       ★ 한글도 잡는다. 이 저장소는 한국어로 개발하므로 초안이 새기 쉽다
         (실제로 en·ja·zh 문서에 한국어 자리표시자가 게시된 적이 있다).
    */
    const CYRILLIC = /[\u0400-\u04FF]/u;
    const HANGUL = /[\uAC00-\uD7A3]/u;
    const KANA = /[\u3040-\u30FF]/u;
    const files = readdirSync(LEGAL).filter((f) => /-(en|ja|zh)\.md$/u.test(f));
    expect(files.length, '법적 문서를 찾지 못했다').toBeGreaterThan(8);

    const bad: string[] = [];
    for (const f of files) {
      const locale = /-(en|ja|zh)\.md$/u.exec(f)![1]!;
      const lines = read(f).split('\n');
      lines.forEach((line, i) => {
        const hit = (re: RegExp, name: string) => {
          if (re.test(line)) bad.push(`${f}:${i + 1} ${name} — ${line.trim().slice(0, 50)}`);
        };
        hit(CYRILLIC, '키릴');
        hit(HANGUL, '한글');
        if (locale !== 'ja') hit(KANA, '가나');
      });
    }
    expect(bad, `다른 언어 문자가 섞였다:\n${bad.join('\n')}`).toEqual([]);
  });
});
