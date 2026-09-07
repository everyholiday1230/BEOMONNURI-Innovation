import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   죽은 버튼 — 눌러도 아무 일이 없는 조작 요소.

   ★★ 왜 이 검사가 필요한가

     운영에서 확인했다: 설정 → API 키 화면의 '키 추가' 버튼은 onClick 이 없어 눌러도
     아무 일도 일어나지 않았다(클릭 실측: URL 변화 없음, 대화창 없음). 같은 화면이
     "지갑 화면에서 연결하라" 고 안내하면서 바로 옆에 눌리지 않는 버튼을 두고 있었다.
     고객은 그 버튼을 먼저 누르고, 아무 일도 없으면 제품이 고장났다고 판단한다.

     '키 회수' 도 죽어 있었다. 이건 더 나쁘다 — 키가 유출됐다고 판단한 고객이 회수할
     방법이 화면에 없었고, 서버에는 삭제 API 가 이미 있었다.

   ★★ 왜 브라우저 감사(QTPending.audit)로 대신하지 않는가

     그 도구는 DOM 의 onclick 속성을 본다. React 는 합성 이벤트를 쓰므로 속성이
     비어 있다 — 운영에서 돌려 보니 175건을 보고했고 그중 PayPal·복사·새로고침처럼
     **실제로 동작하는** 것이 다수였다. 오탐이 많으면 아무도 보지 않는다.

     그래서 소스에서 본다: 버튼 태그에 onClick 이 **문자 그대로 없는** 경우만 센다.
*/

/** 고객이 실제로 보는 화면 파일. 관리자 화면은 범위가 다르므로 별도로 다룬다. */
const CUSTOMER_FILES = ['src/pages-user.jsx', 'src/ai-copilot.jsx', 'src/pages-more.jsx', 'src/widgets.jsx'];

/** 여는 태그 하나를 읽어 온다(중첩 없는 단순 스캔이지만 button 태그에는 충분하다). */
function buttonTags(src: string): Array<{ tag: string; line: number }> {
  const out: Array<{ tag: string; line: number }> = [];
  const re = /<button\b[\s\S]*?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({ tag: m[0], line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** 주석을 지운다. 설명 안의 예시 코드가 위반으로 잡히면 안 된다. */
const stripComments = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('DEAD-BUTTONS — 눌러도 아무 일이 없는 버튼을 막는다', () => {
  it('[1] 검사 대상을 실제로 읽었다', () => {
    /* ★★ 파일을 못 읽으면 "위반이 없어서" 통과한다. */
    let total = 0;
    for (const f of CUSTOMER_FILES) total += buttonTags(read(f)).length;
    expect(total, '버튼을 하나도 찾지 못했다 — 스캔이 깨졌다').toBeGreaterThan(100);
  });

  it('[2] 설정 화면의 API 키 버튼이 살아 있다', () => {
    /*
       ★ 이 두 버튼이 이번에 실제로 죽어 있던 것이다. 되돌아가는 것을 막는다.
    */
    const src = stripComments(read('src/pages-user.jsx'));

    /* 키 추가 — 연결 흐름이 있는 화면으로 보내야 한다. */
    const addIdx = src.indexOf("t('wal_add_key')");
    expect(addIdx, '키 추가 버튼을 찾지 못했다').toBeGreaterThan(0);
    const addTag = src.slice(Math.max(0, addIdx - 400), addIdx);
    expect(addTag, '키 추가 버튼에 onClick 이 없다').toMatch(/onClick/);

    /* 회수 — 실제 삭제 API 를 불러야 한다. */
    const revIdx = src.indexOf("t('col_revoke')");
    expect(revIdx, '키 회수 버튼을 찾지 못했다').toBeGreaterThan(0);
    const revSeg = src.slice(Math.max(0, revIdx - 1400), revIdx);
    expect(revSeg, '회수 버튼에 onClick 이 없다').toMatch(/onClick/);
    expect(revSeg, '회수가 실제 API 를 부르지 않는다').toMatch(/api\.remove/);
    /* ★ 되돌릴 수 없는 동작이므로 확인을 받아야 한다. */
    expect(revSeg, '확인 없이 회수한다').toMatch(/confirm/);
    /* ★ 실패를 조용히 넘기면 고객은 회수됐다고 믿는다. */
    expect(revSeg, '실패를 알리지 않는다').toMatch(/wal_revoke_failed/);
  });

  it('[3] 배선할 서버 기능이 없는 버튼은 아예 두지 않는다', () => {
    /*
       ★★ '수정' 버튼을 제거했다. 거래소 키는 수정 대상이 아니고(비밀키를 바꾸려면
         새로 등록하고 예전 것을 회수한다), 서버에 수정 기능도 없다.

       ★ 있으나 눌리지 않는 버튼보다 없는 편이 정직하다.
    */
    const src = stripComments(read('src/pages-user.jsx'));
    const revIdx = src.indexOf("t('col_revoke')");
    const around = src.slice(Math.max(0, revIdx - 1600), revIdx + 200);
    expect(around, "API 키 행에 배선 없는 '수정' 버튼이 돌아왔다").not.toMatch(/t\('col_edit'\)/);
  });

  it('[5] 실제로 화면에 그려지는 죽은 버튼이 없다', () => {
    /*
       ★★ 이것이 진짜 기준이다. `{false && ...}` 로 감춰 둔 버튼은 고객이 볼 수 없으므로
         죽은 버튼이 아니다 — 기능이 생겼을 때 되살릴 마크업이다. 지우면 디자인
         산출물과 어긋난다.

         반대로 **감추지 않고 배선도 없는** 버튼은 고객이 누르고 아무 일도 일어나지
         않는다. 그것만 센다.

       ★ 이 값은 0 이어야 한다. 0 이 아니게 만드는 변경은 고객에게 눌리지 않는 버튼을
         내보내는 것이다.
    */
    const offenders: string[] = [];
    for (const f of CUSTOMER_FILES) {
      /* ★ 주석을 공백으로 바꿔 길이를 유지한다 — 줄 번호가 밀리면 위치를 못 짚는다. */
      const src = read(f)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => ' '.repeat(m.length))
        .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
      const re = /<button\b[\s\S]*?<\/button>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const blk = m[0];
        /*
           ★★ 여는 태그를 `>` 로 끊으면 안 된다. 속성값 안에 `>` 가 들어 있는 경우
             (`onClick={() => ...}`) 태그가 조기에 끊겨 onClick 을 못 본다 — 실제로
             배선된 복사 버튼을 죽은 버튼으로 잘못 잡았다.

           ★ 그래서 **블록 전체**에서 onClick 을 찾는다. 안에 중첩 버튼이 없으므로
             안전하고, 놓치는 쪽보다 넉넉한 쪽이 오탐을 줄인다.
        */
        if (/onClick/.test(blk) || /disabled/.test(blk) || /type=["']submit["']/.test(blk)) continue;
        if (/qt-pending-mark/.test(blk)) continue;
        /* ★ 감춰진 블록 안이면 고객이 보지 못한다. */
        if (/\{false\s*&&/.test(src.slice(Math.max(0, m.index - 500), m.index))) continue;
        offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(
      offenders.length,
      `고객이 누를 수 있는데 아무 일도 일어나지 않는 버튼이 ${offenders.length}개다:\n${offenders.join('\n')}`,
    ).toBe(0);
  });

  it('[4] 고객 화면에 onClick 없는 버튼이 늘어나지 않는다', () => {
    /*
       ★★ 남아 있는 것을 전부 지금 고치지는 못한다. 그래서 **현재 개수를 고정**하고
         늘어나는 것만 막는다. 줄이면 이 숫자를 낮춰야 한다 — 그것이 진행 상황이다.

       ★ 개수만 세면 어디가 문제인지 알 수 없으므로 실패 시 위치를 함께 출력한다.
    */
    const offenders: string[] = [];
    for (const f of CUSTOMER_FILES) {
      const src = stripComments(read(f));
      for (const { tag, line } of buttonTags(src)) {
        if (/onClick/.test(tag)) continue;
        /* ★ disabled 버튼은 의도적으로 못 누르게 한 것이다 — 죽은 버튼이 아니다. */
        if (/disabled/.test(tag)) continue;
        /* ★ type="submit" 은 폼이 처리한다. */
        if (/type=["']submit["']/.test(tag)) continue;
        offenders.push(`${f}:${line}`);
      }
    }
    /*
       측정값. 이 숫자를 올리는 변경은 죽은 버튼을 추가한 것이다.
       내려가면 이 값을 함께 낮춘다.
    */
    const BASELINE = 14;   // 23 → 20 → 19 → 14. 늘리는 변경은 죽은 버튼을 추가한 것이다.
    expect(
      offenders.length,
      `onClick 없는 버튼이 ${offenders.length}개다(기준 ${BASELINE}).\n`
      + `늘었다면 죽은 버튼을 추가한 것이다:\n${offenders.slice(0, 25).join('\n')}`,
    ).toBeLessThanOrEqual(BASELINE);
  });
});
