/*
   보관기간을 **전부 100일**로 통일한 것과, 저장을 하나로 합친 것을 잠근다.

   운영 결정 2026-09-18: "저장기간을 100일로 늘립시다. 모든것이요. 전부 100일이요."

   ★★★ 그 전 상태
     · `saved_items`     — 30일 뒤 만료 (연장 50점)
     · `user_strategies` — **만료 없음**
     고객이 "어느 쪽에 저장했는지" 를 기억해야 결과를 예측할 수 있었다.

   ★★★ 그리고 만료가 **실제로 아무 일도 하지 않았다.** 목록이 `expires_at` 를 보지
     않았고 지우는 작업도 없었다. 화면은 "30일 뒤 만료" 라고 알리는데 사실이 아니었다.
     약속한 대로 동작해야 한다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('보관기간은 전부 100일', () => {
  const savedRepo = read('apps/api/src/db/saved-item-repo.ts');
  const strategyRepo = read('apps/api/src/db/user-strategy-repo.ts');

  it('상수가 100일이다', () => {
    expect(savedRepo, '보관기간이 100일이 아니다').toMatch(/export const SAVED_TTL_DAYS = 100;/u);
  });

  /* ★ 두 저장소가 각자 상수를 들면 한쪽만 바뀌어 "전부 100일" 이 깨진다. */
  it('두 저장소가 같은 상수를 쓴다', () => {
    expect(strategyRepo, '규칙 쪽이 자기 기간을 따로 들고 있다')
      .toMatch(/import \{ SAVED_TTL_DAYS \} from '\.\/saved-item-repo\.js'/u);
    expect(strategyRepo, '저장 시 보관기간을 적용하지 않는다')
      .toMatch(/String\(SAVED_TTL_DAYS\)/u);
    /* 규칙 쪽에 자기만의 숫자가 박혀 있으면 안 된다. */
    expect(strategyRepo, '규칙 쪽에 기간 숫자가 박혀 있다').not.toMatch(/interval '\d+ days'/u);
  });

  it('규칙 저장에 만료가 붙는다', () => {
    expect(strategyRepo, 'expires_at 을 넣지 않는다')
      .toMatch(/INSERT INTO user_strategies[\s\S]{0,200}expires_at/u);
    expect(strategyRepo, '만료를 계산하지 않는다')
      .toMatch(/now\(\) \+ \(\$9 \|\| ' days'\)::interval/u);
  });

  /*
     ★★★ 만료가 실제로 동작해야 한다 — 안내만 하고 아무 일도 안 하면 거짓이다.
  */
  it('만료된 것은 목록에서 빠진다', () => {
    for (const [name, src] of [['저장된 항목', savedRepo], ['내 규칙', strategyRepo]] as const) {
      expect(src, `${name} 목록이 만료를 걸러내지 않는다`)
        .toMatch(/expires_at IS NULL OR expires_at > now\(\)/u);
    }
  });

  it('만료된 것을 지우지는 않는다', () => {
    /* ★ 만료는 **안 보이게 하는 것**이고 연장하면 다시 보인다. 지우면 되돌릴 수 없다. */
    for (const [name, src] of [['저장된 항목', savedRepo], ['내 규칙', strategyRepo]] as const) {
      expect(src, `${name} 이 만료를 이유로 삭제한다 — 되돌릴 수 없다`)
        .not.toMatch(/DELETE FROM \w+ WHERE[\s\S]{0,80}expires_at < now\(\)/u);
    }
  });

  it('만료 개념이 없던 옛 항목은 보여준다', () => {
    /* ★ 모른다고 감추면 고객이 저장한 것이 사라진 것으로 보인다. */
    for (const src of [savedRepo, strategyRepo]) {
      expect(src, 'NULL 을 감춘다').toMatch(/expires_at IS NULL OR/u);
    }
  });

  /*
     ★★★ 연장은 **지금부터** 다시 센다. 지난 만료 시각에 더하면 연장했는데도 여전히
       만료 상태로 남는다.
  */
  it('연장은 지금부터 센다', () => {
    for (const [name, src] of [['저장된 항목', savedRepo], ['내 규칙', strategyRepo]] as const) {
      expect(src, `${name} 연장이 지난 시각에 더한다`)
        .toMatch(/GREATEST\(now\(\), COALESCE\(expires_at, now\(\)\)\)/u);
    }
  });

  it('남의 항목을 연장할 수 없다', () => {
    const i = strategyRepo.indexOf('async extend(');
    const body = strategyRepo.slice(i, i + 700);
    expect(body, '소유자 확인이 없다').toMatch(/WHERE id = \$1 AND user_id = \$2/u);
  });
});

describe('마이그레이션이 기존 항목을 잃지 않는다', () => {
  const up = read('infrastructure/postgres/0052_retention_100_days.postgres.sql');
  const down = read('infrastructure/postgres/0052_retention_100_days.down.postgres.sql');

  /*
     ★★★ `created_at + 100일` 로 계산하면 **오래된 항목이 즉시 만료된다** — 고객이
       포인트를 내고 저장한 것이 이 마이그레이션 때문에 사라지는 셈이다.
  */
  it('기존 규칙은 지금부터 100일을 받는다', () => {
    expect(up, '생성 시각 기준으로 계산한다 — 옛 항목이 즉시 만료된다')
      .not.toMatch(/created_at \+ interval/u);
    expect(up, '기존 행에 만료를 주지 않는다')
      .toMatch(/UPDATE user_strategies[\s\S]{0,160}now\(\) \+ interval '100 days'/u);
  });

  it('이미 연장해 둔 고객을 깎지 않는다', () => {
    /* ★ GREATEST 로 100일보다 먼 것은 그대로 둔다. */
    expect(up, '더 먼 만료를 100일로 줄인다')
      .toMatch(/GREATEST\(COALESCE\(expires_at, now\(\)\), now\(\) \+ interval '100 days'\)/u);
  });

  it('되돌리기가 있다', () => {
    expect(down, '열을 되돌리지 않는다').toMatch(/DROP COLUMN IF EXISTS expires_at/u);
    /* ★ 만료 시각은 복원하지 않는다 — 짐작해 넣으면 고객 항목이 즉시 만료될 수 있다. */
    expect(down, '만료 시각을 짐작해 복원한다').not.toMatch(/UPDATE \w+\s+SET expires_at/u);
  });

  it('여러 번 실행해도 안전하다', () => {
    expect(up, '열 추가가 멱등하지 않다').toMatch(/ADD COLUMN IF NOT EXISTS/u);
    expect(up, '색인 생성이 멱등하지 않다').toMatch(/CREATE INDEX IF NOT EXISTS/u);
  });
});

describe('보관기간을 화면에 박아 두지 않는다', () => {
  /*
     ★★★ 화면에 숫자를 박으면 서버 정책을 바꿔도 안 따라온다 — "30일" 이 화면에 남아
       **거짓이 된다.** 실제로 그랬다(`sv_extend_hint: 'Extend 30 days...'`).
  */
  it('서버가 보관기간을 알려준다', () => {
    expect(read('apps/api/src/saved-routes.ts'), '저장 목록이 기간을 안 알린다')
      .toMatch(/retentionDays: SAVED_TTL_DAYS/u);
    expect(read('apps/api/src/user-strategy-routes.ts'), '규칙 목록이 기간을 안 알린다')
      .toMatch(/retentionDays: SAVED_TTL_DAYS/u);
  });

  it('사전 문구에 기간이 박혀 있지 않다', () => {
    const dir = join(ROOT, 'src/locales');
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      for (const line of s.split('\n')) {
        if (!/^\s*sv_/u.test(line)) continue;
        /* 숫자로 된 기간이 문구에 박혀 있으면 안 된다 — {d} 로 받아야 한다. */
        if (/\b\d{2,3}\s*(days|일|日|天|días|dias|ngày|gün|दिन|araw)\b/u.test(line)) bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad, `기간이 박힌 문구:\n${bad.join('\n')}`).toEqual([]);
  });

  it('화면이 기간을 넘겨 쓴다', () => {
    /*
       ★ 호출을 `[^)]*\)` 로 잡으면 **중첩 괄호에서 잘린다**
         (`{ sym: (saved.saveCost && ...) }` 의 첫 `)` 에서 끝난다) — 그래서 `d:` 가
         뒤에 있어도 못 보고 실패했다(역검증 아닌 내 시험 결함이었다).
         호출 시작점부터 **같은 줄 끝까지** 본다.
    */
    const KEYS = ['sv_extend_hint', 'sv_section_sub_tiered', 'sv_badge_saved_hint', 'sv_badge_rule_hint'];
    const bad: string[] = [];
    for (const f of ['src/pages-more.jsx', 'src/pages-points.jsx', 'src/ai-copilot.jsx']) {
      for (const line of read(f).split('\n')) {
        if (!KEYS.some((k) => line.includes(`'${k}'`))) continue;
        /* 매개변수를 아예 안 넘기는 호출도 잡는다. */
        if (!line.includes('d:')) bad.push(`${f}: ${line.trim().slice(0, 120)}`);
      }
    }
    expect(bad, `기간을 넘기지 않는 호출:\n${bad.join('\n')}`).toEqual([]);
  });
});

describe('저장한 것을 한 화면에 모은다', () => {
  const more = read('src/pages-more.jsx');
  const copilot = read('src/ai-copilot.jsx');
  const app = read('src/app.jsx');

  /*
     ★★★ 운영자: "아예 합치는 게 나으려나?" → 합친다. 규칙과 차트에 그린 것을 같은
       목록에 보여준다. 고객이 어디에 저장했는지 기억할 필요가 없다.
  */
  it('저장 화면이 그린 것도 보여준다', () => {
    expect(more, '그림을 읽지 않는다').toMatch(/api\.savedList\s*\n?\s*\?/u);
    expect(more, '두 목록을 합치지 않는다').toMatch(/Promise\.all\(\[api\.myUserStrategies\(\), drawingsP\]\)/u);
    /* ★ 최근 저장이 위로 — 두 목록을 시간순으로 섞는다. */
    expect(more, '시간순으로 섞지 않는다').toMatch(/Number\(b\.createdAt \|\| 0\) - Number\(a\.createdAt \|\| 0\)/u);
  });

  it('한쪽 조회가 실패해도 다른 쪽은 보여준다', () => {
    expect(more, '그림 조회 실패가 목록 전체를 막는다')
      .toMatch(/catch\(\(\) => \(\{ items: \[\] \}\)\)/u);
  });

  /*
     ★★★ 종류에 맞는 API 를 불러야 한다. 잘못 부르면 **아무 일도 안 일어난다** —
       고장으로 보이고, 연장은 포인트만 나갈 수도 있다.
  */
  it('연장·삭제가 종류에 맞는 API 를 쓴다', () => {
    expect(more, '연장이 종류를 구별하지 않는다')
      .toMatch(/it\.__saved \? api && api\.savedExtend : api && api\.extendUserStrategy/u);
    expect(more, '삭제가 종류를 구별하지 않는다')
      .toMatch(/it\.__saved \? api && api\.savedDelete : api && api\.deleteUserStrategy/u);
  });

  it('그림도 차트에서 열 수 있다', () => {
    expect(more, '그림을 차트로 넘기지 않는다').toMatch(/sessionStorage\.setItem\('qt\.pendingSavedItem'/u);
    expect(copilot, '넘어온 그림을 적용하지 않는다').toMatch(/sessionStorage\.getItem\('qt\.pendingSavedItem'\)/u);
  });

  /*
     ★★★ **소비하는 쪽이 적용할 수 있는 쪽이어야 한다.**
       처음에는 차트 준비 시점(app.jsx)에서 읽었다. 그때는 코파일럿이 아직 마운트되지
       않아 적용 함수가 없었는데 **대기값을 이미 지워 버려서 그림이 사라졌다** —
       대기값도 없고 화면에도 없다(실측).
  */
  it('적용할 수 있는 쪽에서 소비한다', () => {
    expect(app, '차트 쪽이 그림 대기값을 가로챈다')
      .not.toMatch(/sessionStorage\.getItem\('qt\.pendingSavedItem'\)/u);
    const i = copilot.indexOf("sessionStorage.getItem('qt.pendingSavedItem')");
    const body = copilot.slice(Math.max(0, i - 700), i + 600);
    /* ★ 캔들이 도착한 뒤에 그린다 — 없으면 좌표가 비어 관문에서 걸러진다. */
    expect(body, '캔들을 기다리지 않는다').toMatch(/if \(!barsReady\) return;/u);
    /* ★ 지우기를 적용보다 먼저 — 적용이 터져도 무한 반복되지 않게. */
    expect(body.indexOf('removeItem'), '적용 뒤에 지운다').toBeLessThan(body.indexOf('applySaved(JSON.parse'));
  });

  /*
     ★★★ 노출 effect 가 `applySaved` 선언보다 **뒤에** 있어야 한다.
       앞에 두면 의존성 배열이 **렌더 중 TDZ 로 평가되어** 전역이 아예 붙지 않는다
       (실측: `typeof window.__qtApplySavedItem === 'undefined'`). 오류도 안 난다.
  */
  it('노출이 선언보다 뒤에 있다', () => {
    const decl = copilot.indexOf('const applySaved = useCallback');
    const use = copilot.indexOf('window.__qtApplySavedItem = applySaved');
    expect(decl, 'applySaved 선언이 없다').toBeGreaterThan(-1);
    expect(use, '노출이 없다').toBeGreaterThan(-1);
    expect(decl, 'TDZ — 선언보다 앞에서 의존성으로 쓴다').toBeLessThan(use);
  });
});
