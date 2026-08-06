import http from 'k6/http';
import { check, sleep } from 'k6';

// Profile 1 — 100 concurrent users smoke test. NOT executed in handoff.
const BASE = __ENV.BASE_URL || 'http://localhost:8787';

export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: 100, duration: '1m' },
  },
  thresholds: {
    // Target (SLO), not a measured result: cached API p95 <= 200ms.
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const cfg = http.get(`${BASE}/api/config`);
  check(cfg, { 'config 200': (r) => r.status === 200 });

  const candles = http.get(`${BASE}/api/market/candles?symbol=BTCUSDT&timeframe=15m&limit=300`);
  check(candles, { 'candles 200': (r) => r.status === 200 });

  sleep(1);
}
