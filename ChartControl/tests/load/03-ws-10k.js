import http from 'k6/http';
import { check } from 'k6';

// Profile 3 — staged ramp toward many concurrent SSE market-data connections. NOT executed.
// k6 keeps the HTTP response streaming open to approximate long-lived SSE consumers.
const BASE = __ENV.BASE_URL || 'http://localhost:8787';

export const options = {
  scenarios: {
    sse_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 1000 },
        { duration: '2m', target: 5000 },
        { duration: '2m', target: 10000 }, // staged target
        { duration: '2m', target: 10000 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    // Target: internal market-data fan-out p95 <= 250ms to first byte.
    http_req_waiting: ['p(95)<250'],
  },
};

export default function () {
  // Each VU opens a market SSE stream (server closes/times out per its config).
  const res = http.get(`${BASE}/api/stream/market?symbol=BTCUSDT&timeframe=1m`, { timeout: '30s' });
  check(res, { 'stream opened': (r) => r.status === 200 });
}
