/*
   ★★ 이 부하 시나리오는 **더 이상 유효하지 않다** (2026-09-08).

     대상 엔드포인트 `/api/ai/analyze` 가 제거됐다 — 인증된 고객 누구에게나 "항상 롱"
     대본 신호를 내보내던 경로였다(커밋 eb6b634).

   ★ 지금 AI 경로는 `/api/ai/copilot`(스트리밍)이다. 부하 시험을 다시 쓸 때는
     스트리밍 응답과 포인트 차감을 함께 봐야 한다 — 단순 요청 수로는 비용을
     측정할 수 없다.

   ★ 지우지 않고 남긴다. 조용히 삭제하면 "AI 부하 시험이 원래 없었나" 로 오해한다.
*/
import http from 'k6/http';
import { check } from 'k6';

// Profile 8 — AI request burst. NOT executed. Validates the BFF's per-user rate limit / backpressure
// and that SSE analysis streams remain responsive under a burst.
const BASE = __ENV.BASE_URL || 'http://localhost:8787';

export const options = {
  scenarios: {
    ai_burst: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '30s', target: 200 }, // burst
        { duration: '30s', target: 5 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post(
    `${BASE}/api/ai/analyze`,
    JSON.stringify({ symbol: 'BTCUSDT', timeframe: '15m', prompt: 'analyze', lastPrice: 68000 }),
    { headers: { 'content-type': 'application/json' }, timeout: '30s' },
  );
  check(res, { 'ai stream ok or rate-limited': (r) => r.status === 200 || r.status === 429 });
}
