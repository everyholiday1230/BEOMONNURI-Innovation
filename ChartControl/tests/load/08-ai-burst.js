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
