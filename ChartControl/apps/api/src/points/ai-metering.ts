/*
   AI 사용량 → 포인트 차감 계산 (하이브리드).

   - 기본 300pt / 실행 (일반 분석 커버)
   - 출력 1,500토큰까지 기본 포함, 초과분은 1K당 200pt 추가
   - 입력 토큰은 서버가 넣는 컨텍스트(캔들 ~90봉)로 한정되므로 과금하지 않는다
     (사용자가 예측 가능하게, 남용 방지).

   만 포인트 ≈ 30회(일반 분석 300pt 기준 33회, 긴 분석이 섞이면 ~30회).
   순수 함수 — 단위 테스트로 고정한다.
*/
export const AI_BASE_POINTS = 300;
export const AI_OUTPUT_FREE_TOKENS = 1_500;
export const AI_OVERAGE_PER_1K_OUTPUT = 200;
/** 프리체크 최소 잔액: 최소 한 번(기본)은 돌릴 수 있어야 한다. */
export const AI_MIN_BALANCE = AI_BASE_POINTS;

export function computeRunPoints(outputTokens: number): number {
  const out = Math.max(0, Math.floor(Number(outputTokens) || 0));
  const overageTokens = Math.max(0, out - AI_OUTPUT_FREE_TOKENS);
  const overage = Math.ceil(overageTokens / 1000) * AI_OVERAGE_PER_1K_OUTPUT;
  return AI_BASE_POINTS + overage;
}
