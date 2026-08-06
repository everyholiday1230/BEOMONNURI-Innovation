import http from 'k6/http';
import { check } from 'k6';

// Phase 6 §9 — HTTP load (k6). VUs/duration via env. Target is the INTERNAL app (health/market meta),
// never BitMart directly. Thresholds record p95/p99.
const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8799';
export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '10s',
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${BASE}/health`);
  check(res, { 'status 200': (r) => r.status === 200 });
}
