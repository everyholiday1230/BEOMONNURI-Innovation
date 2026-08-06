import http from 'k6/http';
import { check, sleep } from 'k6';

// Parametrized BFF load script. VUS/DURATION via env so the same script runs smoke & baseline.
//   BASE_URL=http://127.0.0.1:8787 VUS=10 DURATION=20s k6 run tests/load/00-smoke.js
const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8787';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '20s';

export const options = {
  scenarios: { load: { executor: 'constant-vus', vus: VUS, duration: DURATION } },
  summaryTrendStats: ['avg', 'min', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    // SLO targets (not asserted as pass here; recorded for comparison against measured results).
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const r1 = http.get(`${BASE}/api/config`);
  check(r1, { 'config 200': (r) => r.status === 200 });
  const r2 = http.get(`${BASE}/api/market/candles?symbol=BTCUSDT&timeframe=15m&limit=300`);
  check(r2, { 'candles 200': (r) => r.status === 200 });
  const r3 = http.get(`${BASE}/api/market/orderbook?symbol=BTCUSDT&depth=20`);
  check(r3, { 'orderbook 200': (r) => r.status === 200 });
  const r4 = http.get(`${BASE}/api/market/trades?symbol=BTCUSDT&limit=30`);
  check(r4, { 'trades 200': (r) => r.status === 200 });
  sleep(0.5);
}
