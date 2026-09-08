import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPEN_ORDER_STATES, TERMINAL_ORDER_STATES } from '../portfolio/query';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   AI 가 이용자 상태를 볼 수 있는가, 그리고 상태 목록에 구멍이 없는가.

   ★★ 왜 이 검사가 필요한가

     `get_user_visible_positions` 와 `get_user_visible_open_orders` 가 **항상 빈 배열을
     돌려주는 껍데기**였다("Live positions/orders are gated elsewhere; default empty").
     그래서 AI 는 도구로 고객 상태를 확인할 수 없었고, 포지션을 들고 있는 고객에게
     "포지션이 없습니다" 라고 답할 수 있었다.

     후속 제안에 "보유 포지션 위험 확인" 칩을 넣으면서 이 모순이 드러났다 — 칩은
     포지션이 있을 때만 뜨는데, 눌러서 물어보면 도구가 빈 배열을 준다.

   ★★ 그리고 상태 목록에 구멍이 있었다.

     `UNKNOWN_RECONCILING` 이 OPEN/TERMINAL 어느 목록에도 없었다. 그 상태의 주문은
     미체결 목록에도 내역에도 나오지 않는다 — 화면에서 사라진다. 하필 결과를 모르는
     상태라 고객이 가장 보고 싶어하는 주문이 사라지는 셈이었다.
*/

/** 도메인 상태 기계에서 상태 이름을 읽는다. */
function machineStates(file: string): string[] {
  const src = read(file);
  const i = src.indexOf('{');
  const j = src.indexOf('};', i);
  return [...new Set([...src.slice(i, j).matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]!))];
}

describe('AI-USER-STATE — AI 가 이용자 상태를 실제로 읽는다', () => {
  it('[1] 상태 기계를 읽어냈다 — 측정이 되는지 먼저 본다', () => {
    /* ★★ 추출이 실패해 빈 배열이 되면 아래 검사가 "검사할 것이 없어서" 통과한다. */
    const local = machineStates('packages/domain/src/order-machine.ts');
    expect(local.length).toBeGreaterThan(8);
    expect(local).toContain('FILLED');
    expect(OPEN_ORDER_STATES.length + TERMINAL_ORDER_STATES.length).toBeGreaterThan(8);
  });

  it('[2] 두 목록의 합집합이 order-machine 을 빠짐없이 덮는다', () => {
    /*
       ★★ 이것이 원래 주석의 주장이었고, 사실이 아니었다.

         어느 쪽에도 없는 상태의 주문은 조회에서 빠진다. 상태가 새로 생기면 조용히
         같은 일이 일어나므로 검사로 고정한다.
    */
    const covered = new Set<string>([...OPEN_ORDER_STATES, ...TERMINAL_ORDER_STATES]);
    const missing = machineStates('packages/domain/src/order-machine.ts').filter((s) => !covered.has(s));
    expect(missing, `어느 목록에도 없는 상태(조회에서 사라진다): ${missing.join(' ')}`).toEqual([]);
  });

  it('[3] 같은 상태가 두 목록에 동시에 들어가지 않는다', () => {
    /* ★ 겹치면 같은 주문이 미체결과 내역에 모두 나온다. */
    const both = OPEN_ORDER_STATES.filter((s) => (TERMINAL_ORDER_STATES as readonly string[]).includes(s));
    expect(both, `진행 중과 끝남에 동시에 있는 상태: ${both.join(' ')}`).toEqual([]);
  });

  it('[4] 라이브 상태 어휘를 로컬 목록에 섞지 않는다', () => {
    /*
       ★★ `orders` 테이블에 쓰는 것은 모의 투영뿐이다. 라이브 주문은 trade_decisions
         에 기록된다(운영 확인: orders 0건, trade_decisions 26건).

         그래서 OPEN·CANCELED·SUBMIT_UNKNOWN 같은 라이브 상태를 이 목록에 넣으면 이
         테이블에 존재하지 않는 상태를 조회하는 셈이 된다.

       ★ 특히 CANCELED(L 하나)와 CANCELLED(L 둘)는 철자가 다르다. 섞이면 조용히
         어긋난다.
    */
    const covered = new Set<string>([...OPEN_ORDER_STATES, ...TERMINAL_ORDER_STATES]);
    const liveOnly = ['OPEN', 'CANCELED', 'SUBMIT_UNKNOWN', 'RISK_REJECTED', 'AWAITING_USER_CONFIRMATION', 'RECONCILING', 'INCONSISTENT'];
    const leaked = liveOnly.filter((s) => covered.has(s));
    expect(leaked, `라이브 전용 상태가 로컬 목록에 섞였다: ${leaked.join(' ')}`).toEqual([]);
    /* ★ 두 철자가 같은 목록에 함께 있으면 안 된다. */
    expect(covered.has('CANCELLED') && covered.has('CANCELED')).toBe(false);
  });

  it('[5] 포지션·미체결 도구가 껍데기로 되돌아가지 않는다', () => {
    /*
       ★★ 원래 구현이 `async get_user_visible_positions() { return []; }` 였다.
         인수를 아예 받지 않는 것이 껍데기의 표시다.
    */
    const idx = read('apps/api/src/index.ts');
    expect(idx, '포지션 도구가 다시 빈 배열을 돌려준다')
      .not.toMatch(/async get_user_visible_positions\(\)\s*\{\s*return \[\];/);
    expect(idx, '미체결 도구가 다시 빈 배열을 돌려준다')
      .not.toMatch(/async get_user_visible_open_orders\(\)\s*\{\s*return \[\];/);
    /* ★ 실제 저장소를 읽어야 한다. */
    expect(idx).toMatch(/aiUserPositions/);
    expect(idx).toMatch(/aiUserOpenOrders/);
    expect(idx).toMatch(/portfolioRepo\.listPositions/);
    expect(idx, '미체결의 정의를 새로 적으면 화면과 갈라진다').toMatch(/OPEN_ORDER_STATES/);
  });

  it('[6] 못 읽는 것을 "없음" 으로 바꾸지 않는다', () => {
    /*
       ★★ 이 제품에서 반복해서 나온 실패 유형이다. 조회 실패를 빈 결과로 바꾸면
         고객에게 거짓을 말한다.
    */
    const idx = read('apps/api/src/index.ts');
    const seg = idx.slice(idx.indexOf('aiUserPositions = async'), idx.indexOf('aiTradeHistory = async'));
    expect(seg.length, '검사 대상 구간을 못 찾았다').toBeGreaterThan(200);
    expect(seg, '실패를 알리지 않는다').toMatch(/available: false/);
    expect(seg, '성공 표시가 없다').toMatch(/available: true/);
  });

  it('[7] AI 포지션 문맥이 화면과 같은 저장소를 읽는다', () => {
    /*
       ★★ `new PortfolioRepo(db)` — SQLite — 를 새로 만들어 쓰고 있었다. 운영 배포는
         Postgres 다. 즉 AI 에게 넘기는 포지션 문맥이 **빈 데이터베이스**를 읽고 있었고,
         고객이 포지션을 들고 있어도 AI 는 늘 "포지션 없음" 으로 봤다.

         바로 위 portfolioRepo 선언의 주석이 정확히 같은 사고를 경고하고 있었다.
    */
    const idx = read('apps/api/src/index.ts');
    expect(idx, 'AI 전용 SQLite 저장소를 다시 만들었다').not.toMatch(/const aiPortfolio = new PortfolioRepo\(db\)/);
    /*
       ★ 검사 대상을 옮겼다. 예전에는 `/api/ai/analyze` 의 `aiUserContext` 를 봤는데
         그 라우트와 함께 제거됐다(대본 응답 MockAIProvider 가 "항상 롱" 신호를
         내보내던 경로다). 지금 AI 에게 포지션을 넘기는 곳은 코파일럿 도구
         `get_user_visible_positions` → `aiUserPositions` 다. 검사가 사라지면
         같은 사고(AI 전용 빈 저장소를 읽는 것)를 다시 막을 수 없다.
    */
    const seg = idx.slice(idx.indexOf('aiUserPositions = async'), idx.indexOf('aiUserOpenOrders = async'));
    expect(seg.length).toBeGreaterThan(100);
    expect(seg, '공용 저장소를 쓰지 않는다').toMatch(/portfolioRepo\.listPositions/);
    /* ★ Pg 구현은 async 다. await 가 없으면 Promise 를 배열처럼 다뤄 조용히 빈 결과가 된다. */
    expect(seg).toMatch(/await portfolioRepo\.listPositions/);
  });
});
