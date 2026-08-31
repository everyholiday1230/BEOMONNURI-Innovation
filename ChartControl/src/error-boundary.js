/* ============================================================
   전역 에러 바운더리 — window.AppErrorBoundary
   ------------------------------------------------------------
   왜 필요한가

   전에는 에러 바운더리가 하나도 없었다. React 는 렌더 도중 예외가 던져지면
   **트리 전체를 언마운트한다.** 그래서 화면 어느 한 곳에서 예외가 하나만 나도
   앱 전체가 빈(검은) 화면이 됐다. 특정 이용자에게만 검은 화면이 뜨는 것은
   대개 그 이용자의 데이터(널 필드·손상된 저장값·예상 못한 응답 모양) 하나가
   렌더 중 예외를 던지기 때문이다.

   이 바운더리가 하는 일

   1) 예외를 잡아 앱이 검은 화면이 되지 않게 한다. 대신 복구 화면을 보여준다.
   2) 흔한 원인인 **손상된 localStorage** 를 이용자가 스스로 지우고 재시작할 수
      있게 한다(설정 초기화). 이게 검은 화면의 가장 흔한 자가복구 경로다.
   3) 서버에 오류를 보고한다(있으면). 어떤 이용자가 어디서 깨졌는지 알아야
      원인을 고친다 — 보고가 없으면 "검은 화면"이라는 말만 반복된다.

   ★ 바운더리는 클래스 컴포넌트로만 만들 수 있다(React 제약). 이 프로젝트는
     전역 스크립트 + 브라우저 Babel 이므로 window 에 올린다.
   ============================================================ */

(function () {
  'use strict';

  const React = window.React;
  if (!React) {
    // React 가 아직 없으면 조용히 포기한다 — 로드 순서상 여기 오면 안 되지만,
    // 바운더리 자체가 앱 로드를 막으면 안 된다.
    return;
  }

  /** 오류를 서버로 보낸다. 실패해도 무시한다 — 보고 실패가 복구 화면을 막으면 안 된다. */
  function report(error, info) {
    try {
      const body = {
        message: String((error && error.message) || error || 'unknown'),
        stack: String((error && error.stack) || ''),
        componentStack: String((info && info.componentStack) || ''),
        url: String(location.hash || location.pathname || ''),
        userAgent: navigator.userAgent,
        at: new Date().toISOString(),
      };
      // sendBeacon 은 페이지가 죽어도 전송을 시도한다. 없으면 fetch 로 폴백.
      const json = JSON.stringify(body);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/ops/client-error', new Blob([json], { type: 'application/json' }));
      } else {
        fetch('/api/ops/client-error', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: json,
          keepalive: true,
        }).catch(function () { /* 무시 */ });
      }
    } catch (e) {
      /* 보고는 최선의 노력이다 */
    }
  }

  /** 다국어. i18n 이 아직 없을 수 있으므로(로드 순서) 영어 기본값을 항상 갖는다. */
  function tt(key, fallback) {
    try {
      if (window.QTI18n && typeof window.QTI18n.t === 'function' && window.QTI18n.exists && window.QTI18n.exists(key)) {
        return window.QTI18n.t(key);
      }
    } catch (e) { /* 무시 */ }
    return fallback;
  }

  class AppErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false, error: null };
      this.handleReset = this.handleReset.bind(this);
      this.handleReload = this.handleReload.bind(this);
      this.handleResetLocal = this.handleResetLocal.bind(this);
    }

    static getDerivedStateFromError(error) {
      return { hasError: true, error: error };
    }

    componentDidCatch(error, info) {
      report(error, info);
      // 콘솔에도 남긴다 — 개발자가 재현할 때 필요하다.
      // eslint-disable-next-line no-console
      console.error('[AppErrorBoundary] 렌더 중 예외:', error, info);
    }

    handleReset() {
      // 다시 렌더를 시도한다. 일시적 오류(경합)라면 이걸로 복구된다.
      this.setState({ hasError: false, error: null });
    }

    handleReload() {
      location.reload();
    }

    handleResetLocal() {
      /*
         손상된 저장값을 지운다 — 검은 화면의 가장 흔한 자가복구 경로다.

         ★ 세션 토큰(쿠키)은 건드리지 않는다. localStorage 의 앱 설정만 지운다.
           qt.* 키만 지워서 다른 사이트/확장 데이터를 건드리지 않는다.
      */
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (k && k.indexOf('qt.') === 0) keys.push(k);
        }
        keys.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* 무시 */ }
      location.reload();
    }

    render() {
      if (!this.state.hasError) return this.props.children;

      const wrap = {
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0b0e11', color: '#e6e8ea', fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: 24,
      };
      const card = {
        maxWidth: 460, width: '100%', background: '#151a21', border: '1px solid #2a313c',
        borderRadius: 12, padding: '28px 26px', boxShadow: '0 10px 40px rgba(0,0,0,.4)',
      };
      const btn = {
        display: 'block', width: '100%', padding: '11px 14px', marginTop: 10, borderRadius: 8,
        border: '1px solid #2a313c', background: '#1e2530', color: '#e6e8ea', fontSize: 14,
        cursor: 'pointer', textAlign: 'center',
      };
      const btnPrimary = Object.assign({}, btn, { background: '#2f6df6', border: '1px solid #2f6df6', fontWeight: 600 });

      return React.createElement('div', { style: wrap },
        React.createElement('div', { style: card },
          React.createElement('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 8 } },
            tt('err_boundary_title', '화면을 표시하지 못했습니다')),
          React.createElement('div', { style: { fontSize: 13, lineHeight: 1.6, color: '#9aa4b2', marginBottom: 18 } },
            tt('err_boundary_body', '일시적인 문제일 수 있습니다. 아래를 순서대로 시도해 보세요. 문제가 계속되면 저장된 설정이 손상됐을 수 있습니다.')),
          React.createElement('button', { style: btnPrimary, onClick: this.handleReset },
            tt('err_boundary_retry', '다시 시도')),
          React.createElement('button', { style: btn, onClick: this.handleReload },
            tt('err_boundary_reload', '새로고침')),
          React.createElement('button', { style: btn, onClick: this.handleResetLocal },
            tt('err_boundary_reset', '설정 초기화 후 새로고침 (로그인 유지)')),
          React.createElement('div', { style: { fontSize: 11, color: '#5c6470', marginTop: 16, wordBreak: 'break-word' } },
            (this.state.error && this.state.error.message) ? String(this.state.error.message) : ''),
        ),
      );
    }
  }

  window.AppErrorBoundary = AppErrorBoundary;
})();
