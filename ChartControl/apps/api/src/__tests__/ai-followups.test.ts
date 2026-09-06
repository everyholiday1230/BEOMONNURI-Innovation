import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestFollowUps, MAX_FOLLOW_UPS, SOLICITATION_PATTERNS, type FollowUpContext } from '@quantumtrade/ai';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   후속 제안 — 답변만 하고 끝내지 않는다.

   ★★ 왜 규칙으로 만드는가

     모델에게 제안을 만들게 하면 **없는 기능과 해서는 안 되는 것을 제안한다.** 이
     제품은 주문을 절대 대신 넣지 않으므로 "주문 넣어줘" 칩은 눌러도 아무 일이 없는
     죽은 버튼이 된다. 그리고 투자자문 등록이 없으므로 매수·매도 권유를 할 수 없다.
     모델은 두 경계를 모른다.

   ★ 부수 효과로 토큰을 쓰지 않는다.
*/

const base: FollowUpContext = {
  toolsUsed: [],
  indicators: [],
  drawingTypes: [],
  positionCount: null,
  openOrderCount: null,
  hasTradeHistory: null,
  symbol: 'BTCUSDT',
  timeframe: '15m',
  mode: 'copilot',
};

describe('AI-FOLLOWUPS — 대화 흐름에 맞는 다음 행동 제안', () => {
  it('[1] 제안이 절대 비지 않는다', () => {
    /*
       ★★ 제안이 0개면 이 기능은 있으나 없으나 같다. 그리고 "가끔 빈다" 는 것이
         가장 나쁘다 — 고객은 왜 사라졌는지 알 수 없다.

       ★ 그래서 조건 없이 참인 규칙을 하나 두었고, 그 성질을 여기서 고정한다.
    */
    const empty = suggestFollowUps(base);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.length).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
  });

  it('[2] 상황이 다르면 제안도 달라진다 — 항상 같은 것만 주면 무의미하다', () => {
    const plain = suggestFollowUps(base).map((f) => f.key).join(',');
    const withPos = suggestFollowUps({ ...base, positionCount: 2 }).map((f) => f.key).join(',');
    const withDraw = suggestFollowUps({ ...base, drawingTypes: ['entryZone'] }).map((f) => f.key).join(',');
    expect(withPos).not.toBe(plain);
    expect(withDraw).not.toBe(plain);
  });

  it('[3] 보유 포지션이 있으면 위험 점검을 먼저 제안한다', () => {
    /* ★ 새 분석보다 지금 열려 있는 위험이 급하다. */
    const out = suggestFollowUps({ ...base, positionCount: 1 });
    expect(out[0]!.key).toBe('ai_fu_risk_open_position');
  });

  it('[4] 진입·손절만 그렸으면 무효화 레벨을 묻게 한다', () => {
    /*
       ★★ "언제 틀린 것으로 인정할지" 가 없는 계획이 손실을 키운다. 고객이 스스로
         떠올리기를 기대하지 않고 물어보기 쉽게 만든다.
    */
    const out = suggestFollowUps({ ...base, drawingTypes: ['entryZone', 'stopLoss'] });
    expect(out.map((f) => f.key)).toContain('ai_fu_invalidation');
    /* ★ 이미 그렸으면 다시 권하지 않는다. */
    const done = suggestFollowUps({ ...base, drawingTypes: ['entryZone', 'stopLoss', 'invalidationLevel'] });
    expect(done.map((f) => f.key)).not.toContain('ai_fu_invalidation');
  });

  it('[5] 분석을 했으면 반대 논거를 제안한다', () => {
    /*
       ★★ 이 제안이 가장 중요하다.

         언어 모델은 이용자가 원하는 답으로 기울고(아첨), 한 번 낸 판단을 반대 증거
         앞에서도 유지하는 경향이 보고돼 있다(확증 편향). 그 둘이 겹치면 "롱 가고
         싶은데 어때?" 에 동의하는 답이 나오고, 그것이 고객 돈을 잃게 한다.
    */
    const out = suggestFollowUps({ ...base, toolsUsed: ['get_candles'] });
    expect(out.map((f) => f.key)).toContain('ai_fu_counter_case');
  });

  it('[6] 거래 기록이 없거나 모르면 복기를 제안하지 않는다', () => {
    /*
       ★★ null(모름) 을 false(없음) 처럼 다루면 죽은 버튼이 된다 — 눌러도 볼
         기록이 없다.
    */
    expect(suggestFollowUps({ ...base, hasTradeHistory: null }).map((f) => f.key)).not.toContain('ai_fu_review_trades');
    expect(suggestFollowUps({ ...base, hasTradeHistory: false }).map((f) => f.key)).not.toContain('ai_fu_review_trades');
    expect(suggestFollowUps({ ...base, hasTradeHistory: true }).map((f) => f.key)).toContain('ai_fu_review_trades');
  });

  it('[7] 이미 읽은 데이터를 다시 읽으라고 권하지 않는다', () => {
    const out = suggestFollowUps({ ...base, toolsUsed: ['get_candles', 'get_funding_rate'] });
    expect(out.map((f) => f.key)).not.toContain('ai_fu_funding');
  });

  it('[8] 상한을 넘지 않는다 — 고르는 것 자체가 일이 되면 안 된다', () => {
    const crowded = suggestFollowUps({
      ...base,
      toolsUsed: ['get_candles'],
      positionCount: 3,
      openOrderCount: 2,
      hasTradeHistory: true,
      drawingTypes: ['entryZone'],
    });
    expect(crowded.length).toBe(MAX_FOLLOW_UPS);
  });

  it('[9] 모든 제안에 근거가 남는다 — 임의로 만든 제안이 아니다', () => {
    for (const ctx of [base, { ...base, positionCount: 1 }, { ...base, hasTradeHistory: true }]) {
      for (const f of suggestFollowUps(ctx)) {
        expect(f.because.length).toBeGreaterThan(0);
        expect(f.key.startsWith('ai_fu_')).toBe(true);
        expect(f.promptKey.startsWith('ai_fu_')).toBe(true);
      }
    }
  });

  it('[10] 규칙이 터져도 제안 전체를 잃지 않는다', () => {
    /* ★ 보조 기능이 본 기능(답변)을 막아서는 안 된다. */
    const broken = { ...base, drawingTypes: null as unknown as string[] };
    expect(() => suggestFollowUps(broken)).not.toThrow();
    expect(suggestFollowUps(broken).length).toBeGreaterThan(0);
  });

  it('[11] 사전에 매수·매도 권유 문구가 없다', () => {
    /*
       ★★ 문구는 사람이 쓴다. 시간이 지나면 누군가 "지금 사세요" 를 넣을 수 있고,
         그 순간 이 제품은 투자권유를 하는 것이 된다 — 사업자 유형이 소프트웨어
         개발·공급이고 투자자문 등록이 없다.

       ★ 그래서 사전 파일을 직접 훑는다. 코드 검사만으로는 막을 수 없다.
    */
    const bad: string[] = [];
    for (const lang of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/copilot.${lang}.js`);
      /* ai_fu_ 로 시작하는 줄만 검사한다. 다른 문구까지 막을 이유는 없다. */
      for (const line of src.split('\n')) {
        if (!/^\s*ai_fu_/.test(line)) continue;
        for (const re of SOLICITATION_PATTERNS) {
          if (re.test(line)) bad.push(`${lang}: ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(bad, `투자권유로 읽힐 수 있는 제안 문구:\n${bad.join('\n')}`).toEqual([]);
  });

  it('[12] 모든 제안 키가 3개 언어에 다 있다 — 없으면 칩이 안 그려진다', () => {
    /*
       ★★ 사전에 없으면 UI 가 그 칩을 그리지 않는다(죽은 버튼 방지). 그건 안전하지만,
         번역 누락이 조용히 기능을 없애는 것이므로 여기서 잡는다.
    */
    const keys = new Set<string>();
    const ctxs: FollowUpContext[] = [
      base,
      { ...base, positionCount: 2 },
      { ...base, openOrderCount: 1 },
      { ...base, hasTradeHistory: true },
      { ...base, drawingTypes: ['entryZone'] },
      { ...base, drawingTypes: ['entryZone', 'stopLoss'] },
      { ...base, toolsUsed: ['get_candles'], timeframe: '5m' },
      { ...base, toolsUsed: ['get_candles'], indicators: [] },
      { ...base, toolsUsed: ['get_market_snapshot'] },
    ];
    for (const c of ctxs) for (const f of suggestFollowUps(c)) { keys.add(f.key); keys.add(f.promptKey); }
    expect(keys.size).toBeGreaterThan(8);   // ★ 실제로 여러 제안을 훑었는지

    const missing: string[] = [];
    for (const lang of ['en', 'ja', 'zh']) {
      const src = read(`src/locales/copilot.${lang}.js`);
      for (const k of keys) {
        if (!new RegExp(`\\b${k}\\s*:`).test(src)) missing.push(`${lang}/${k}`);
      }
    }
    expect(missing, `사전 누락:\n${missing.join('\n')}`).toEqual([]);
  });

  it('[13] 복기 도구는 조회 실패를 "거래 없음" 으로 바꾸지 않는다', () => {
    /*
       ★★ 실제로 겪은 실패 유형이다. 조회가 안 되는 것과 없는 것을 같게 만들면
         고객에게 거짓을 말한다 — 거래한 사람에게 "기록이 없다" 고 하는 식이다.
    */
    const idx = read('apps/api/src/index.ts');
    expect(idx, '거래 이력 도구가 없다').toMatch(/get_user_trade_history/);
    expect(idx, '미지원/실패를 구별하지 않는다').toMatch(/available: false/);
    expect(idx, '성공 경로에 available 표시가 없다').toMatch(/available: true/);
  });

  it('[14] 복기는 실제 주문 기록(trade_decisions)을 읽는다', () => {
    /*
       ★★ 처음에는 `orders` 테이블을 읽었다. 그런데 운영 데이터베이스의 `orders` 는
         **0건**이고 실제 기록은 `trade_decisions` 에 26건 있었다(BLOCKED 13 ·
         ACCEPTED 8 · REJECTED 5). `orders` 는 모의 투영이 쓰는 테이블이다.

         그대로 배포했다면 실제로 주문한 고객에게 "기록이 없다" 고 답했을 것이다 —
         조회 실패를 '없음' 으로 바꾸지 않겠다고 하면서 정작 엉뚱한 테이블을 읽어
         같은 거짓을 만들 뻔했다. 배포 전에 잡았고, 이 검사가 되돌아가는 것을 막는다.
    */
    const idx = read('apps/api/src/index.ts');
    expect(idx, '학습 저장소(실제 기록)를 쓰지 않는다').toMatch(/learningRepo\.reviewHistory/);
    expect(idx, '모의 투영 테이블로 되돌아갔다').not.toMatch(/aiTradeHistory[\s\S]{0,600}listOrders/);

    const repo = read('apps/api/src/db/learning-repo.ts');
    expect(repo, 'reviewHistory 가 없다').toMatch(/reviewHistory/);
    expect(repo, 'trade_decisions 를 읽지 않는다').toMatch(/FROM trade_decisions/);
    /* ★ 결과가 없는 결정(막힌 주문, 미청산)도 남아야 한다. INNER JOIN 이면 사라진다. */
    expect(repo, 'LEFT JOIN 이 아니면 막힌 주문이 사라진다').toMatch(/LEFT JOIN trade_outcomes/);
    /* ★ 막힌 이유가 복기의 핵심이다. */
    expect(repo).toMatch(/submit_reason/);
    /* ★ 본인 것만. */
    expect(repo).toMatch(/WHERE d\.user_id = \$1/);
  });

  it('[15] 프롬프트가 과거 기록을 미래 예측으로 바꾸지 못하게 막는다', () => {
    const prompts = read('packages/ai/src/prompts.ts');
    expect(prompts).toMatch(/past trades/i);
    expect(prompts).toMatch(/prediction/i);
    expect(prompts, '읽지 못한 것을 "거래 없음" 으로 보고하지 않게 하는 규칙이 없다')
      .toMatch(/you have no trades/i);
  });
});
