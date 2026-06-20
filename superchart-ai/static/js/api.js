/**
 * 공용 API 호출 헬퍼 (CSRF 자동 첨부, 에러 처리 일관화)
 *
 * 역할:
 * - CSRF 토큰 쿠키(csrf_token)를 자동으로 X-CSRF-Token 헤더에 첨부 (상태 변경 메서드만)
 * - Content-Type 자동 설정 (JSON body 있으면)
 * - 401 감지 시 세션 만료 처리 (기존 _401handled 로직 통합)
 * - 인증 쿠키는 브라우저가 자동 전송 (credentials: 'same-origin')
 *
 * 사용:
 *   const data = await api.get('/v1/symbols');
 *   const result = await api.post('/v1/alerts', { symbol: 'BTCUSDT', ... });
 *   const r = await api.del('/v1/alerts/xxx');
 *
 * 하위 호환:
 *   window.api 로 전역 노출 — ES Module 아닌 스크립트에서도 사용 가능
 *
 * 주의:
 * - 이 헬퍼를 사용하지 않는 기존 fetch() 호출은 CSRF 수동 첨부 필요
 * - 응답 자동 JSON 파싱 — raw Response 필요하면 api.raw() 사용
 */
(function () {
  'use strict';

  // CSRF 토큰을 쿠키에서 읽기 (httponly=false 이므로 JS 접근 가능)
  function _readCsrfToken() {
    const m = /(?:^|;\s*)csrf_token=([^;]+)/.exec(document.cookie || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  // 상태 변경 메서드 (CSRF 필수)
  const _MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

  /**
   * 공용 fetch 래퍼 (raw Response 반환).
   *
   * @param {string} url - 요청 URL
   * @param {Object} [opts] - fetch 옵션
   * @param {string} [opts.method='GET']
   * @param {Object} [opts.body] - 객체면 JSON.stringify
   * @param {Object} [opts.headers]
   * @param {boolean} [opts.skipCsrf=false] - CSRF 자동 첨부 건너뛰기
   * @returns {Promise<Response>}
   */
  async function raw(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = Object.assign({}, opts.headers || {});

    // body가 객체면 자동으로 JSON 직렬화 + Content-Type 설정
    let body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams) && !(body instanceof Blob)) {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      body = JSON.stringify(body);
    }

    // CSRF 자동 첨부 (상태 변경 메서드 + 쿠키 있을 때)
    if (!opts.skipCsrf && _MUTATING.has(method)) {
      const token = _readCsrfToken();
      if (token && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        headers['X-CSRF-Token'] = token;
      }
    }

    const fetchOpts = {
      method,
      headers,
      credentials: 'include', // 쿠키 자동 전송 (same-origin 환경이라도 로컬 HTTP에서 안정적)
    };
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      fetchOpts.body = body;
    }

    const r = await fetch(url, fetchOpts);

    // 401 감지 → 세션 만료 처리 (기존 _401handled 로직과 호환)
    if (r.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/signup')) {
      if (!window._401handled) {
        window._401handled = true;
        if (typeof window.clearAuthState === 'function') {
          window.clearAuthState();
        }
        if (typeof window.showToast === 'function' && typeof window.t === 'function') {
          window.showToast(window.t('세션이 만료되었습니다. 다시 로그인해주세요.'), '#D8B66A');
        }
        setTimeout(() => {
          window._401handled = false;
        }, 5000);
      }
    }

    return r;
  }

  /**
   * JSON 응답을 자동 파싱.
   * 4xx/5xx 도 정상 반환 (호출 측에서 success 필드 확인).
   */
  async function json(url, opts = {}) {
    const r = await raw(url, opts);
    try {
      return await r.json();
    } catch (e) {
      // JSON 파싱 실패 (HTML 응답 등)
      return { success: false, error: { code: 'INVALID_JSON', message: `HTTP ${r.status}`, status: r.status } };
    }
  }

  // 단축 메서드
  function get(url, opts) {
    return json(url, Object.assign({}, opts, { method: 'GET' }));
  }
  function post(url, body, opts) {
    return json(url, Object.assign({}, opts, { method: 'POST', body }));
  }
  function put(url, body, opts) {
    return json(url, Object.assign({}, opts, { method: 'PUT', body }));
  }
  function del(url, opts) {
    return json(url, Object.assign({}, opts, { method: 'DELETE' }));
  }
  function patch(url, body, opts) {
    return json(url, Object.assign({}, opts, { method: 'PATCH', body }));
  }

  // 전역 노출
  window.api = {
    raw,
    json,
    get,
    post,
    put,
    del,
    patch,
    // 유틸 (디버그/테스트용)
    _readCsrfToken,
  };
})();
