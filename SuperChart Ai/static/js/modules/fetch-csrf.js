/**
 * fetch-csrf.js — fetch 오버라이드 (CSRF 자동 첨부 + rate limit 토스트)
 */

let _lastErrToast = 0;
let _netDegradedAt = 0;
const _origFetch = window.fetch;

function _emitNetworkState(status, message) {
  try {
    window.dispatchEvent(new CustomEvent('chartos:network-state', {
      detail: { status, message, at: Date.now() }
    }));
  } catch (_) {}
}

function _getCsrfToken() {
  const m = document.cookie.match(/csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

window.fetch = function(...args) {
  const [url, opts] = args;
  if (opts && opts.method && !['GET', 'HEAD', 'OPTIONS'].includes(opts.method.toUpperCase())) {
    const token = _getCsrfToken();
    if (token) {
      opts.headers = opts.headers || {};
      if (opts.headers instanceof Headers) {
        if (!opts.headers.has('x-csrf-token')) opts.headers.set('x-csrf-token', token);
      } else {
        if (!opts.headers['x-csrf-token'] && !opts.headers['X-CSRF-Token']) opts.headers['X-CSRF-Token'] = token;
      }
    }
  }
  const t = window.t || (s => s);
  const authToken = window.authToken;
  return _origFetch(...args).then(r => {
    if (_netDegradedAt && r.ok) {
      _netDegradedAt = 0;
      _emitNetworkState('ok', t('서버 연결이 복구되었습니다'));
    }

    if (r.status === 429 && Date.now() - _lastErrToast > 5000) {
      _lastErrToast = Date.now();
      // 일시적 트래픽 폭주는 누구에게나 발생 가능 — 회원/VIP/VVIP 구분 없이 안내
      // 실제 사용량 제한은 백엔드 tier_guard 가 별도로 적용
      if (window.showToast) {
        window.showToast(t('요청이 많습니다. 잠시 후 다시 시도해주세요.'), '#D8B66A');
      }
    }
    return r;
  }).catch(e => {
    if (Date.now() - _lastErrToast > 10000) {
      _lastErrToast = Date.now();
      _netDegradedAt = Date.now();
      if (window.showToast) {
        window.showToast(
          t('서버 연결에 문제가 있습니다'),
          t('요청이 지연되고 있습니다. 잠시 후 자동 재시도되며, 계속되면 네트워크를 확인해주세요.'),
          'entry'
        );
      }
      _emitNetworkState('degraded', t('요청 지연 또는 연결 실패'));
    }
    throw e;
  });
};

window._origFetch = _origFetch;
window._getCsrfToken = _getCsrfToken;
