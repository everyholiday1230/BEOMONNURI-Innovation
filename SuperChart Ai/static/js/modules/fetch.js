/**
 * fetch.js — dedupFetch (중복 요청 방지 + retry + timeout + 429 대응)
 */

const _inflight = new Map();

// ── 단기 응답 캐시 (A: 종목/TF 재방문 시 즉시 표시) ──
// 차트 GET 요청만 캐시. 짧은 TTL로 신선도 유지. POST/auth/실시간성 높은 건 제외.
const _respCache = new Map();   // key(url) -> {ts, body, status, ct}
const CACHE_TTL = 8000;         // 8초
const CACHE_MAX = 120;
const _CACHEABLE = /\/v1\/charts\/(candles|ind-|orderblocks|trendlines|ticker-24hr|long-short|ind-mtf)/;
function _cacheable(url, opts) {
  const method = (opts && opts.method ? opts.method : 'GET').toUpperCase();
  return method === 'GET' && _CACHEABLE.test(url);
}
function _cacheGet(url) {
  const e = _respCache.get(url);
  if (e && Date.now() - e.ts < CACHE_TTL) return e;
  if (e) _respCache.delete(url);
  return null;
}
function _makeResp(e) {
  return new Response(e.body, { status: e.status, headers: { 'Content-Type': e.ct || 'application/json' } });
}
function _cacheSet(url, payload) {
  _respCache.set(url, payload);
  if (_respCache.size <= CACHE_MAX) return;
  const oldestKey = _respCache.keys().next().value;
  if (oldestKey) _respCache.delete(oldestKey);
}
function _buildKey(url, opts) {
  const method = (opts && opts.method ? opts.method : 'GET').toUpperCase();
  let bodyKey = '';
  try {
    if (opts && typeof opts.body === 'string') bodyKey = opts.body;
    else if (opts && opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) bodyKey = JSON.stringify(opts.body);
  } catch (_) { bodyKey = ''; }
  const auth = (opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
  return `${method}::${url}::${bodyKey}::${auth ? 'auth' : 'anon'}`;
}

const RETRY_MAX = 2;
const RETRY_DELAY = 1000;  // 1초
const FETCH_TIMEOUT = 15000;  // 15초

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export function dedupFetch(url, opts) {
  if (!opts) opts = {};
  if (!opts.headers) opts.headers = {};
  if (!opts.credentials) opts.credentials = 'include';
  if (window.authToken && window.authToken !== 'cookie' && !opts.headers['Authorization']) opts.headers['Authorization'] = 'Bearer ' + window.authToken;
  const key = _buildKey(url, opts);
  if (_inflight.has(key)) return _inflight.get(key).then(r => r.clone());

  // 캐시 적중 → 즉시 반환 (요청 0)
  if (_cacheable(url, opts)) {
    const c = _cacheGet(url);
    if (c) return Promise.resolve(_makeResp(c));
  }

  const API = window.API || '';
  const t = window.t || (s => s);

  const p = (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      try {
        const r = await _fetchWithTimeout(url, opts, FETCH_TIMEOUT);
        _inflight.delete(key);

        // 401 세션 만료 — refresh 토큰으로 1회 자동 재발급 시도 후 원요청 재시도
        if (r.status === 401 && url.startsWith(API + '/v1/') && !url.includes('/auth/login') && !url.includes('/auth/signup') && !url.includes('/auth/refresh') && !url.includes('/portfolio')) {
          if (!opts._refreshed) {
            opts._refreshed = true;
            try {
              const rf = await _fetchWithTimeout(API + '/v1/auth/refresh', { method: 'POST', credentials: 'include' }, FETCH_TIMEOUT);
              if (rf.ok) { continue; }  // 갱신 성공 → 원요청 재시도
            } catch (e) { /* fallthrough */ }
          }
          if (!window._401handled) { window._401handled = true; if (window.showToast) window.showToast(t('세션이 만료되었습니다. 다시 로그인해주세요.'), '#D8B66A'); setTimeout(() => { window._401handled = false }, 5000); }
        }

        // 429 Rate Limit — retry
        if (r.status === 429 && attempt < RETRY_MAX) {
          const retryAfter = parseInt(r.headers.get('Retry-After') || '2') * 1000;
          await _wait(Math.min(retryAfter, 5000));
          continue;
        }

        // 500+ 서버 에러 — retry
        if (r.status >= 500 && attempt < RETRY_MAX) {
          await _wait(RETRY_DELAY * (attempt + 1));
          continue;
        }

        // 성공한 차트 GET 응답을 단기 캐시에 저장
        if (r.ok && _cacheable(url, opts)) {
          try {
            const body = await r.clone().text();
            _cacheSet(url, { ts: Date.now(), body, status: r.status, ct: r.headers.get('Content-Type') || 'application/json' });
          } catch (e) { /* 캐시 실패 무시 */ }
        }

        return r;
      } catch (e) {
        lastErr = e;
        if (attempt < RETRY_MAX) {
          await _wait(RETRY_DELAY * (attempt + 1));
          continue;
        }
      }
    }
    // 모든 retry 실패
    _inflight.delete(key);
    if (!window._netErrShown && window.showToast) {
      window._netErrShown = true;
      window.showToast(
        t('서버 연결이 불안정합니다'),
        t('자동 재시도 후에도 응답이 없어 요청을 완료하지 못했습니다. 네트워크 상태를 확인해주세요.'),
        'entry'
      );
      try {
        window.dispatchEvent(new CustomEvent('chartos:network-state', {
          detail: { status: 'degraded', message: t('서버 응답 지연') }
        }));
      } catch (_) {}
      setTimeout(() => { window._netErrShown = false }, 10000);
    }
    throw lastErr || new Error('fetch failed');
  })();

  _inflight.set(key, p);
  return p.then(r => r.clone());
}

window.dedupFetch = dedupFetch;
