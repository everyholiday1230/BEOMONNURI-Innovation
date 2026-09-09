import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgLearningRepo } from '../db/learning-repo';

/**
 * 거래 학습 데이터 저장 검사 (실제 PostgreSQL).
 *
 * ★★ 왜 실제 DB 로 검사하는가
 *
 *   이 기록의 위험은 "조용히 안 쌓이는 것" 이다. 레포지토리가 실패를 삼키도록
 *   설계했기 때문에(주문을 막지 않기 위해), 잘못된 SQL 이나 제약 위반이 있어도
 *   호출부는 아무 것도 모른다. 가짜 DB 로 검사하면 그 실패를 잡을 수 없다.
 *
 * PG_TEST_URL 이 없으면 건너뛴다.
 */
const URL = process.env.PG_TEST_URL;

/*
   ★★★ **PG 가 없어도 도는 검사.** 아래 통합 시험은 PG_TEST_URL 이 없으면 전부
     건너뛰어진다 — 평소 CI 에서는 학습 동의 조건을 아무도 지켜주지 않는다는 뜻이다.
     실제로 그래서 이 파일의 실패 3건이 오랫동안 보이지 않았다.

   ★ 그래서 소스 검사만 **skipIf 밖**에 둔다. 통합 시험과 짝이다.
*/
describe('학습 표본 내보내기 — 동의 조건 (PG 없이도 확인한다)', () => {
  it('★★ 내보내기 SQL 에 동의 조건이 있다 (조용히 지워지는 것을 막는다)', () => {
    /*
       ★★★ 동작 시험(아래)과 **함께** 둔다. 동작 시험은 PG 가 없으면 건너뛰어지므로
         평소 CI 에서는 이 조건을 지켜주지 못한다. 소스 검사는 항상 돈다.

       ★ 주석을 먼저 지운다 — 설명하는 산문에 같은 문구가 있어서 소스 검사가
         엉뚱하게 통과하는 사고를 이 저장소에서 이미 겪었다.
    */
    const src = readFileSync(resolve(__dirname, '../db/learning-repo.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src, '학습 표본 내보내기에서 동의 조건이 사라졌다 — 동의 없는 기록이 학습에 들어간다')
      .toMatch(/ai_training_opt_in\s*=\s*TRUE/);
  });
});

describe.skipIf(!URL)('LEARN-DB 거래 학습 데이터 저장', () => {
  let pool: Pool;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    const suiteUrl = await createIsolatedTestDatabase(URL!, 'learning_dataset');
    pool = createPool(suiteUrl);
    await migrateUp(pool);

    userA = randomUUID();
    userB = randomUUID();
    for (const id of [userA, userB]) {
      await pool.query(
        /*
           ★★★ **ai_training_opt_in 을 TRUE 로 넣는다.**

             exportSamples 는 `JOIN users u ON … u.ai_training_opt_in = TRUE` 로
             **동의한 사용자만** 뽑는다(learning-repo.ts:531). 시험은 그 열을 넣지
             않아 기본값(FALSE/NULL)이었고, 그래서 내보내기가 항상 0건이었다.

           ★★ 이것은 **제품이 옳고 시험이 낡은** 경우다. 조건을 지우면 동의 없는
             기록이 학습에 들어간다 — 고치는 방향을 반대로 잡으면 안 된다.

           ★ 이 실패는 PG_TEST_URL 이 없으면 **조용히 건너뛰어져** 보이지 않았다.
             감사가 지적하고 실제 PG 18 로 돌려서 확인했다(3건 실패 → 0건).
        */
        'INSERT INTO users (id, email, password_hash, status, ai_training_opt_in) VALUES ($1,$2,$3,$4,TRUE)',
        [id, `u_${id}@ex.com`, 'scrypt$1$1$1$a$b', 'active'],
      );
    }
  });

  afterAll(async () => { await pool.end(); });

  it('[1] 0025 가 4개 표를 만든다', async () => {
    const tables = (await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    )).rows.map((r) => r.tablename as string);
    for (const t of ['trade_decisions', 'trade_outcomes', 'learning_subjects', 'learning_exports']) {
      expect(tables).toContain(t);
    }
  });

  it('[2] ★★ 가명 키는 한 사람에 하나이고 user_id 로 되돌릴 수 없다', async () => {
    const repo = new PgLearningRepo(pool);
    const k1 = await repo.subjectKey(userA);
    const k2 = await repo.subjectKey(userA);
    // 같은 사람은 같은 가명이어야 한다. 두 개면 한 사람이 두 명으로 학습된다.
    expect(k1).toBe(k2);

    const other = await repo.subjectKey(userB);
    expect(other).not.toBe(k1);

    /*
       ★★ user_id 의 해시가 아니어야 한다.

         해시면 우리 이용자 목록을 전부 해시해 맞춰 보는 것으로 가명이 풀린다.
         가명에 user_id 조각이 들어 있지 않은지 확인한다.
    */
    expect(k1).not.toContain(userA);
    expect(k1).not.toContain(userA.replace(/-/g, ''));
    expect(k1.startsWith('s_')).toBe(true);
  });

  it('[3] 판단이 지표 설정값까지 그대로 저장된다', async () => {
    const repo = new PgLearningRepo(pool);
    const id = await repo.recordDecision({
      userId: userA,
      market: 'futures', executionMode: 'live',
      symbol: 'BTCUSDT', side: 'long', orderType: 'limit',
      price: '60000', quantity: '0.01', leverage: '10', marginMode: 'isolated',
      uiContext: {
        timeframe: '15m',
        indicators: [{ id: 'MA', params: { calcParams: [20, 60] } }],
        source: 'order-panel',
      },
      marketSnapshot: { last: '63000', bid: '62999', ask: '63001', spreadBps: '0.31' },
      submitStatus: 'ACCEPTED',
      clientOrderId: 'coid-1',
    });
    expect(id).not.toBeNull();

    const row = (await pool.query(
      'SELECT ui_context, market_snapshot, leverage FROM trade_decisions WHERE id = $1', [id],
    )).rows[0]!;
    expect(row.ui_context.indicators[0].params.calcParams).toEqual([20, 60]);
    expect(row.market_snapshot.spreadBps).toBe('0.31');
    // 숫자 칸은 그대로 보존된다.
    expect(String(row.leverage)).toBe('10');
  });

  it('[4] ★★ 없는 값은 NULL 이다 — 0 으로 채우지 않는다', async () => {
    const repo = new PgLearningRepo(pool);
    const id = await repo.recordDecision({
      userId: userA,
      market: 'spot', executionMode: 'paper',
      symbol: 'ETHUSDT', side: 'short', orderType: 'market',
      // 가격 없음(시장가), 레버리지 없음(현물), 발동가 없음
      quantity: '1',
      submitStatus: 'ACCEPTED',
    });
    const row = (await pool.query(
      'SELECT price, leverage, stop_price, ui_context FROM trade_decisions WHERE id = $1', [id],
    )).rows[0]!;
    /*
       ★ 0 으로 채우면 "0 원에 주문했다", "레버리지 0배" 가 된다. 둘 다 존재하지
         않는 상태이고, 학습 데이터에 들어가면 모델이 그것을 사실로 배운다.
    */
    expect(row.price).toBeNull();
    expect(row.leverage).toBeNull();
    expect(row.stop_price).toBeNull();
    expect(row.ui_context).toBeNull();
  });

  it('[5] ★★ 차단된 주문도 남는다', async () => {
    const repo = new PgLearningRepo(pool);
    const id = await repo.recordDecision({
      userId: userA,
      market: 'futures', executionMode: 'live',
      symbol: 'BTCUSDT', side: 'long', orderType: 'market', quantity: '99',
      riskSnapshot: { pass: false, failCount: 2, liveGateAllowed: false, gates: {} },
      submitStatus: 'BLOCKED', submitReason: 'RISK_GATE',
    });
    const row = (await pool.query(
      'SELECT submit_status, submit_reason, risk_snapshot FROM trade_decisions WHERE id = $1', [id],
    )).rows[0]!;
    expect(row.submit_status).toBe('BLOCKED');
    expect(row.submit_reason).toBe('RISK_GATE');
    // 왜 막혔는지가 남아야 학습에서 "이 상황의 이 주문은 한도에 걸린다" 를 배운다.
    expect(row.risk_snapshot.failCount).toBe(2);
  });

  it('[6] 결과가 판단에 연결된다', async () => {
    const repo = new PgLearningRepo(pool);
    const decisionId = await repo.recordDecision({
      userId: userA,
      market: 'futures', executionMode: 'live',
      symbol: 'SOLUSDT', side: 'long', orderType: 'limit',
      price: '150', quantity: '2', submitStatus: 'ACCEPTED', clientOrderId: 'coid-link',
    });
    const found = await repo.findDecisionByClientOrderId('coid-link');
    expect(found?.id).toBe(decisionId);

    await repo.recordOutcome({
      decisionId,
      userId: userA,
      market: 'futures', executionMode: 'live',
      symbol: 'SOLUSDT', side: 'long',
      outcomeKind: 'closed',
      entryPrice: '150', exitPrice: '145',
      realizedPnl: '-10', roiPct: '-3.33',
      holdingSeconds: 7200,
      closeReason: 'stop_loss',
      observedFrom: 'exchange_order',
    });

    const samples = await repo.exportSamples({
      from: new Date(Date.now() - 3_600_000),
      to: new Date(Date.now() + 3_600_000),
      limit: 100,
    });
    const s = samples.find((x) => x.decisionId === decisionId);
    expect(s).toBeTruthy();
    // ★ 손실이 그대로 나온다 — 걸러내지 않는다.
    expect(s!.outcome?.realizedPnl).toBe('-10');
    expect(s!.outcome?.closeReason).toBe('stop_loss');
  });

  it('★★★ 학습 동의를 철회하면 내보내기에서 빠진다 (동의 없는 학습 방지)', async () => {
    /*
       ★★★ 이 경로에 시험이 **없었다.** 그런데 법적으로 가장 무거운 곳이다 —
         동의 없는 개인정보를 상용 모델 학습에 쓰면 개인정보보호법 위반이다.

       ★★ 그리고 이 조건은 **조용히 깨질 수 있다.** exportSamples 의 JOIN 한 줄이고,
         지워도 다른 시험은 전부 통과한다(오히려 데이터가 더 많이 나와 통과한다).
         실제로 다른 시험들은 opt_in 을 넣지 않아 0건을 받고 있었는데도
         "PG 없음" 으로 건너뛰어져 아무도 몰랐다.

       ★ 그래서 **철회하면 사라지는지**를 직접 확인한다. 동의를 TRUE→FALSE 로 바꾸고
         같은 조회를 다시 한다.
    */
    const repo = new PgLearningRepo(pool);
    const range = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000), limit: 100 };

    const before = await repo.exportSamples(range);
    expect(before.length, '동의 상태에서 표본이 나오지 않았다 — 시험 전제가 깨졌다')
      .toBeGreaterThan(0);

    /* ★ 동의 철회. 열을 직접 바꾼다 — 이 시험의 대상은 조회 조건이다. */
    await pool.query('UPDATE users SET ai_training_opt_in = FALSE');
    const after = await repo.exportSamples(range);
    expect(after, '동의를 철회했는데도 학습 표본에 남아 있다').toEqual([]);

    /* ★ 되돌려 둔다 — 뒤 시험이 이 상태에 영향받지 않게. */
    await pool.query('UPDATE users SET ai_training_opt_in = TRUE');
    const restored = await repo.exportSamples(range);
    expect(restored.length, '되돌린 뒤 표본이 다시 나오지 않았다').toBeGreaterThan(0);
  });

  it('[7] ★★ 내보내기에 user_id 가 들어가지 않는다', async () => {
    const repo = new PgLearningRepo(pool);
    const samples = await repo.exportSamples({
      from: new Date(Date.now() - 3_600_000),
      to: new Date(Date.now() + 3_600_000),
      limit: 100,
    });
    expect(samples.length).toBeGreaterThan(0);
    const text = JSON.stringify(samples);
    /*
       ★ SELECT 목록에 user_id 가 없으므로 실수로도 나갈 수 없다. 그 사실을
         검사로 고정한다 — 나중에 열을 추가할 때 되돌아가지 않게.
    */
    expect(text).not.toContain(userA);
    expect(text).not.toContain(userB);
    for (const s of samples) {
      expect(s).not.toHaveProperty('userId');
      expect(s.subject.startsWith('s_')).toBe(true);
    }
  });

  it('[8] 기간 밖 표본은 나오지 않는다', async () => {
    const repo = new PgLearningRepo(pool);
    const past = await repo.exportSamples({
      from: new Date('2020-01-01T00:00:00Z'),
      to: new Date('2020-01-02T00:00:00Z'),
      limit: 100,
    });
    expect(past).toHaveLength(0);
  });

  it('[9] 실주문/모의를 구분해 뽑을 수 있다', async () => {
    const repo = new PgLearningRepo(pool);
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);
    const live = await repo.exportSamples({ from, to, limit: 100, executionMode: 'live' });
    const paper = await repo.exportSamples({ from, to, limit: 100, executionMode: 'paper' });
    /*
       ★ 섞으면 체결 성질이 다른 표본이 한 덩어리가 된다(모의는 슬리피지가
         실제와 다르다). 분리가 가능해야 한다.
    */
    expect(live.every((s) => s.executionMode === 'live')).toBe(true);
    expect(paper.every((s) => s.executionMode === 'paper')).toBe(true);
    expect(paper.length).toBeGreaterThan(0);
  });

  it('[10] ★★ 회원이 사라져도 표본은 남는다 (탈퇴 시 연결만 끊긴다)', async () => {
    const repo = new PgLearningRepo(pool);
    const doomed = randomUUID();
    await pool.query(
      /*
           ★★★ **ai_training_opt_in 을 TRUE 로 넣는다.**

             exportSamples 는 `JOIN users u ON … u.ai_training_opt_in = TRUE` 로
             **동의한 사용자만** 뽑는다(learning-repo.ts:531). 시험은 그 열을 넣지
             않아 기본값(FALSE/NULL)이었고, 그래서 내보내기가 항상 0건이었다.

           ★★ 이것은 **제품이 옳고 시험이 낡은** 경우다. 조건을 지우면 동의 없는
             기록이 학습에 들어간다 — 고치는 방향을 반대로 잡으면 안 된다.

           ★ 이 실패는 PG_TEST_URL 이 없으면 **조용히 건너뛰어져** 보이지 않았다.
             감사가 지적하고 실제 PG 18 로 돌려서 확인했다(3건 실패 → 0건).
        */
        'INSERT INTO users (id, email, password_hash, status, ai_training_opt_in) VALUES ($1,$2,$3,$4,TRUE)',
      [doomed, `u_${doomed}@ex.com`, 'scrypt$1$1$1$a$b', 'active'],
    );
    const id = await repo.recordDecision({
      userId: doomed,
      market: 'futures', executionMode: 'live',
      symbol: 'BTCUSDT', side: 'long', orderType: 'market', quantity: '1',
      submitStatus: 'ACCEPTED',
    });

    await pool.query('DELETE FROM users WHERE id = $1', [doomed]);

    const row = (await pool.query(
      'SELECT user_id, subject_key FROM trade_decisions WHERE id = $1', [id],
    )).rows[0];
    /*
       ★★ CASCADE 였다면 이 행이 사라진다 — 이미 학습에 쓴 표본이 없어져
         데이터셋의 연속성이 깨진다. SET NULL 이어야 한다.
       ★ 연결이 끊긴 뒤에는 이 표본이 누구인지 **우리도 알 수 없다.**
    */
    expect(row).toBeTruthy();
    expect(row.user_id).toBeNull();
    expect(row.subject_key).toBeTruthy();
  });

  it('[11] 현황이 실제 개수를 보고한다', async () => {
    const repo = new PgLearningRepo(pool);
    const st = await repo.stats();
    expect(st.decisions).toBeGreaterThan(0);
    expect(st.outcomes).toBeGreaterThan(0);
    expect(st.subjects).toBeGreaterThan(0);
    expect(st.oldestAt).toBeTruthy();
    // ★ 쓰기 실패가 있었다면 숨기지 않는다.
    expect(st.writeFailures).toBe(0);
  });

  it('[12] ★ 내보내기 이력이 남는다', async () => {
    const repo = new PgLearningRepo(pool);
    await repo.recordExport({
      actorUserId: userA,
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-20T00:00:00Z'),
      sampleCount: 3,
      format: 'jsonl_prompt',
      contentSha256: 'abc123',
    });
    const row = (await pool.query(
      'SELECT sample_count, format, content_sha256 FROM learning_exports ORDER BY created_at DESC LIMIT 1',
    )).rows[0]!;
    expect(row.sample_count).toBe(3);
    expect(row.format).toBe('jsonl_prompt');
    // 같은 파일을 두 번 학습시키는 것을 알아채기 위한 지문이다.
    expect(row.content_sha256).toBe('abc123');
  });
});

describe.skipIf(!URL)('LEARN-DB 결과 중복 방지 (0026)', () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    const suiteUrl = await createIsolatedTestDatabase(URL!, 'learning_dedupe');
    pool = createPool(suiteUrl);
    await migrateUp(pool);
    userId = randomUUID();
    await pool.query(
      /*
           ★★★ **ai_training_opt_in 을 TRUE 로 넣는다.**

             exportSamples 는 `JOIN users u ON … u.ai_training_opt_in = TRUE` 로
             **동의한 사용자만** 뽑는다(learning-repo.ts:531). 시험은 그 열을 넣지
             않아 기본값(FALSE/NULL)이었고, 그래서 내보내기가 항상 0건이었다.

           ★★ 이것은 **제품이 옳고 시험이 낡은** 경우다. 조건을 지우면 동의 없는
             기록이 학습에 들어간다 — 고치는 방향을 반대로 잡으면 안 된다.

           ★ 이 실패는 PG_TEST_URL 이 없으면 **조용히 건너뛰어져** 보이지 않았다.
             감사가 지적하고 실제 PG 18 로 돌려서 확인했다(3건 실패 → 0건).
        */
        'INSERT INTO users (id, email, password_hash, status, ai_training_opt_in) VALUES ($1,$2,$3,$4,TRUE)',
      [userId, `u_${userId}@ex.com`, 'scrypt$1$1$1$a$b', 'active'],
    );
  });
  afterAll(async () => { await pool.end(); });

  it('[1] ★★ 같은 판단·같은 종류를 두 번 넣지 않는다', async () => {
    const repo = new PgLearningRepo(pool);
    const decisionId = await repo.recordDecision({
      userId, market: 'futures', executionMode: 'paper',
      symbol: 'BTCUSDT', side: 'long', orderType: 'market', quantity: '1',
      submitStatus: 'ACCEPTED', clientOrderId: 'dupe-1',
    });

    const one = {
      decisionId, userId, market: 'futures' as const, executionMode: 'paper' as const,
      symbol: 'BTCUSDT', side: 'long', outcomeKind: 'filled' as const,
      filledQuantity: '1', observedFrom: 'sim' as const,
    };
    await repo.recordOutcome(one);
    await repo.recordOutcome(one);
    await repo.recordOutcome(one);

    const n = await pool.query(
      "SELECT COUNT(*) c FROM trade_outcomes WHERE decision_id = $1 AND outcome_kind = 'filled'",
      [decisionId],
    );
    /*
       결과는 조회할 때마다 수집한다. 이용자가 주문 내역을 열 때마다 같은 체결이
       돌아오므로, 막지 않으면 같은 거래가 표본 여러 개가 되어 학습에서 그만큼
       가중치를 갖는다.
    */
    expect(Number(n.rows[0].c)).toBe(1);
  });

  it('[2] 같은 판단에 다른 종류는 함께 남는다', async () => {
    const repo = new PgLearningRepo(pool);
    const decisionId = await repo.recordDecision({
      userId, market: 'futures', executionMode: 'live',
      symbol: 'ETHUSDT', side: 'long', orderType: 'limit', price: '3000', quantity: '1',
      submitStatus: 'ACCEPTED', clientOrderId: 'two-kinds',
    });
    const base = {
      decisionId, userId, market: 'futures' as const, executionMode: 'live' as const,
      symbol: 'ETHUSDT', side: 'long', observedFrom: 'exchange_order' as const,
    };
    // 진입 체결 → 나중에 청산. 둘은 다른 사실이므로 함께 있어야 한다.
    await repo.recordOutcome({ ...base, outcomeKind: 'filled', filledQuantity: '1' });
    await repo.recordOutcome({ ...base, outcomeKind: 'closed', realizedPnl: '42.5' });

    const r = await pool.query(
      'SELECT outcome_kind FROM trade_outcomes WHERE decision_id = $1 ORDER BY outcome_kind',
      [decisionId],
    );
    expect(r.rows.map((x) => x.outcome_kind)).toEqual(['closed', 'filled']);
  });

  it('[3] 판단 없는 결과는 여러 건이 정상이다', async () => {
    const repo = new PgLearningRepo(pool);
    const base = {
      decisionId: null, userId, market: 'futures' as const, executionMode: 'live' as const,
      symbol: 'SOLUSDT', side: 'long', outcomeKind: 'closed' as const,
      observedFrom: 'position_diff' as const,
    };
    /*
       거래소에서 직접 낸 주문의 손익이다. 여러 건이 정상이므로 유일 제약이
       걸리면 안 된다(0026 은 부분 인덱스를 쓴다).
    */
    await repo.recordOutcome({ ...base, realizedPnl: '1' });
    await repo.recordOutcome({ ...base, realizedPnl: '2' });
    const n = await pool.query(
      "SELECT COUNT(*) c FROM trade_outcomes WHERE decision_id IS NULL AND symbol = 'SOLUSDT'",
    );
    expect(Number(n.rows[0].c)).toBe(2);
  });

  it('[4] 결과 수집용 판단 조회는 접수된 것만 준다', async () => {
    const repo = new PgLearningRepo(pool);
    await repo.recordDecision({
      userId, market: 'futures', executionMode: 'live',
      symbol: 'XRPUSDT', side: 'long', orderType: 'market', quantity: '1',
      submitStatus: 'BLOCKED', submitReason: 'RISK_GATE', clientOrderId: 'blocked-1',
    });
    const list = await repo.recentDecisionsForOutcome(userId, Date.now() - 3_600_000);
    /*
       차단·거부된 주문에는 체결이 있을 수 없다. 포함하면 수집기가 매번 훑고
       아무 것도 못 잇는다.
    */
    expect(list.find((x) => x.clientOrderId === 'blocked-1')).toBeUndefined();
    expect(list.find((x) => x.clientOrderId === 'two-kinds')).toBeTruthy();
  });

  it('[5] 이미 기록된 결과 키를 읽는다', async () => {
    const repo = new PgLearningRepo(pool);
    const list = await repo.recentDecisionsForOutcome(userId, Date.now() - 3_600_000);
    const keys = await repo.existingOutcomeKeys(list.map((x) => x.id));
    // 위에서 넣은 filled/closed 가 보여야 한다.
    expect([...keys].some((k) => k.endsWith(':filled'))).toBe(true);
    expect([...keys].some((k) => k.endsWith(':closed'))).toBe(true);
  });
});
