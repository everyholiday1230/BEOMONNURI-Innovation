import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
   ============================================================
   ARIA-LABELS — 모든 입력칸에 접근성 이름이 있는가.

   ★★ 왜 이 검사가 필요한가

     이 앱의 입력칸에는 `aria-label` 도 `htmlFor` 도 **하나도 없었다**. 라벨이
     `<span className="input-group__label">` 로만 있어 input 과 연결되지 않았다.

       · 스크린리더 사용자는 어느 칸이 이메일이고 어느 칸이 비밀번호인지 알 수 없다.
       · Playwright 의 getByLabel 이 칸을 찾지 못해 e2e 인증 흐름이 전부 실패했다.

     즉 접근성 결함이 검증 수단까지 막고 있었다. 63곳을 보강했고, 이 검사는
     **새 입력칸이 라벨 없이 들어오는 것을 막는다.**

   ★ 체크박스·라디오는 제외한다. 감싸는 <label> 안의 글자가 이미 읽히고, 거기에
     aria-label 을 더하면 화면 글자와 다른 이름을 읽게 될 수 있다.
   ============================================================ */

const SRC = join(__dirname, '../../../../src');

/*
   여러 줄에 걸친 태그를 하나로 본다.

   ★★ 태그 끝을 단순히 첫 `>` 로 찾으면 안 된다. JSX 는 속성 안에 화살표 함수가
     들어간다: `onChange={(e) => …}`. 그 `>` 에서 끊으면 뒤에 있는 aria-label 을
     못 보고 "라벨 없음" 으로 잘못 보고한다 — 실제로 6곳을 그렇게 오판했다.
     중괄호 깊이를 세어 **속성 밖의** `>` 에서만 끊는다.
*/
function inputTags(text: string): string[] {
  const out: string[] = [];
  const re = /<(input|select|textarea)[\s>]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let depth = 0;
    let end = -1;
    for (let i = m.index; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) { end = i; break; }
    }
    out.push(text.slice(m.index, end === -1 ? m.index + 300 : end + 1));
  }
  return out;
}

const skip = (tag: string) => /type=["'](checkbox|radio|hidden)["']/.test(tag);

describe('ARIA-LABELS 입력칸 접근성 이름', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.jsx'));

  it('[1] ★★ 라벨 없는 입력칸이 없다', () => {
    const missing: string[] = [];
    for (const f of files) {
      for (const tag of inputTags(readFileSync(join(SRC, f), 'utf8'))) {
        if (skip(tag)) continue;
        if (/aria-label\s*=/.test(tag)) continue;
        missing.push(`${f}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(missing, `라벨 없는 입력칸:\n${missing.join('\n')}`).toEqual([]);
  });

  it('[2] 라벨은 사전 키를 쓴다 — 영어를 박으면 번역이 따라오지 않는다', () => {
    const hardcoded: string[] = [];
    for (const f of files) {
      for (const tag of inputTags(readFileSync(join(SRC, f), 'utf8'))) {
        const m = tag.match(/aria-label\s*=\s*(["'{])/);
        if (!m) continue;
        // 문자열 리터럴(" 또는 ')이면 하드코딩이다. {t(...)} 또는 {조건식} 은 허용.
        if (m[1] === '"' || m[1] === "'") {
          hardcoded.push(`${f}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(hardcoded, `하드코딩된 aria-label:\n${hardcoded.join('\n')}`).toEqual([]);
  });

  it('[3] 인증 화면 입력칸은 모두 라벨이 있다 — e2e 가 여기에 의존한다', () => {
    const auth = readFileSync(join(SRC, 'pages-auth.jsx'), 'utf8');
    const tags = inputTags(auth).filter((t) => !skip(t));
    expect(tags.length).toBeGreaterThan(5);
    expect(tags.every((t) => /aria-label\s*=/.test(t))).toBe(true);
  });
});
