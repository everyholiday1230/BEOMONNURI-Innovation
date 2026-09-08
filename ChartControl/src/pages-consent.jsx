/**
 * 동의 화면 — 필수 법적 문서에 동의를 받는다.
 *
 * ★★ 왜 이 화면이 필요한가 — **구글 가입은 동의를 받을 수 없었다.**
 *
 *   비밀번호 가입은 폼에 체크박스가 있어 동의를 받고 기록한다. 그런데 구글 로그인은
 *   리다이렉트로 돌아오므로 그 폼을 **거치지 않는다.** 그래서 구글로 들어온 고객은
 *   약관·개인정보처리방침·위험고지에 동의한 기록이 **하나도 없는 상태로** 거래 화면까지
 *   들어갔다. 분쟁이 생기면 "동의를 받았다" 고 말할 근거가 없다.
 *
 *   구글 콜백이 새 계정을 `#/consent` 로 보내고, 이 화면이 동의를 받아 기록한다.
 *
 * ★ 미동의 목록은 **서버가 계산한다.** 화면이 "무엇이 필요한지" 를 스스로 정하면
 *   서버와 어긋난다. 화면은 서버가 준 목록만 보여준다.
 * ★ 조회에 실패하면 통과시키지 않는다 — 실패를 "동의할 것 없음" 으로 바꾸면 그대로
 *   거래 화면으로 흘러가 원래 버그가 되돌아온다.
 */
(function () {
  const { useState, useEffect, useCallback } = React;

  /** 문서 종류 → 화면에 보일 이름. 서버가 주는 kind 를 사람이 읽는 말로 바꾼다. */
  const KIND_LABEL = {
    terms: { en: 'Terms of Service', ko: '이용약관' },
    privacy: { en: 'Privacy Policy', ko: '개인정보처리방침' },
    risk: { en: 'Risk Disclosure', ko: '위험 고지' },
  };

  function ConsentPage(props) {
    const shell = (props && props.shellProps) || {};
    const lang = (shell.lang === 'ko') ? 'ko' : 'en';
    const t = (en, ko) => (lang === 'ko' ? ko : en);

    /*
       ★ 네 가지 상태를 구분한다: 불러오는 중 / 실패 / 동의할 것 있음 / 없음.
         실패를 "없음" 과 합치면 통과시켜 버린다.
    */
    const [state, setState] = useState({ phase: 'loading', pending: [], error: null });
    const [checked, setChecked] = useState({});
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState(null);

    const load = useCallback(async () => {
      setState({ phase: 'loading', pending: [], error: null });
      try {
        const r = await fetch('/api/legal/me/consents', { credentials: 'same-origin' });
        if (r.status === 401) { location.hash = '#/login'; return; }
        const j = await r.json();
        if (!j || j.available === false) {
          /* 저장소가 없다 — 동의를 기록할 수 없다. 통과시키지 않고 그대로 말한다. */
          setState({ phase: 'error', pending: [], error: 'UNAVAILABLE' });
          return;
        }
        const pending = Array.isArray(j.pending) ? j.pending : [];
        setState({ phase: pending.length ? 'need' : 'done', pending, error: null });
      } catch (e) {
        setState({ phase: 'error', pending: [], error: String((e && e.message) || e) });
      }
    }, []);

    useEffect(() => { load(); }, [load]);

    /* 동의할 것이 없으면 거래 화면으로 보낸다. */
    useEffect(() => {
      if (state.phase === 'done') {
        const id = setTimeout(() => { location.hash = '#/trade'; }, 900);
        return () => clearTimeout(id);
      }
      return undefined;
    }, [state.phase]);

    const allChecked = state.pending.length > 0
      && state.pending.every((p) => checked[p.documentId]);

    async function submit() {
      setBusy(true); setFailure(null);
      try {
        /* CSRF 토큰을 먼저 받는다 — 동의 기록은 상태를 바꾸므로 서버가 요구한다. */
        const cs = await (await fetch('/api/auth/csrf', { credentials: 'same-origin' })).json();
        const r = await fetch('/api/legal/me/consents', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': (cs && cs.csrfToken) || '' },
          body: JSON.stringify({}),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) {
          /*
             ★ 실패를 조용히 넘기지 않는다. 이유를 화면에 보여준다 — 동의가 기록되지
               않았는데 통과하면 아무도 모른다.
          */
          const code = (j && j.error && j.error.code) || ('HTTP_' + r.status);
          setFailure(
            code === 'LEGAL_NOT_PUBLISHED'
              ? t('The documents are not published yet. Please contact support.',
                  '문서가 아직 게시되지 않았습니다. 고객지원에 문의해 주세요.')
              : code === 'LEGAL_UNAVAILABLE'
                ? t('The consent store is unavailable. Please try again later.',
                    '동의 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.')
                : t('Could not record your consent (' + code + ').',
                    '동의를 기록하지 못했습니다 (' + code + ').'),
          );
          setBusy(false);
          return;
        }
        /* ★ 서버가 다시 계산한 미동의를 믿는다. 남아 있으면 통과시키지 않는다. */
        const still = (j && Array.isArray(j.pending)) ? j.pending : [];
        if (still.length) {
          setState({ phase: 'need', pending: still, error: null });
          setFailure(t('Some documents still need your consent.', '일부 문서에 아직 동의가 필요합니다.'));
          setBusy(false);
          return;
        }
        location.hash = '#/trade';
      } catch (e) {
        setFailure(String((e && e.message) || e));
        setBusy(false);
      }
    }

    const wrap = { maxWidth: 560, margin: '0 auto', padding: '32px 20px' };

    if (state.phase === 'loading') {
      return (
        <div style={wrap}>
          <p className="muted">{t('Loading…', '불러오는 중…')}</p>
        </div>
      );
    }

    if (state.phase === 'error') {
      return (
        <div style={wrap}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>{t('Agreement required', '동의가 필요합니다')}</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            {t('We could not check which documents you need to agree to. You have not been signed out.',
               '어떤 문서에 동의가 필요한지 확인하지 못했습니다. 로그아웃되지는 않았습니다.')}
          </p>
          <button type="button" className="btn btn--primary" onClick={load}>
            {t('Try again', '다시 시도')}
          </button>
        </div>
      );
    }

    if (state.phase === 'done') {
      return (
        <div style={wrap}>
          <p>{t('All required documents are already agreed. Taking you to the app…',
                '필수 문서에 모두 동의되어 있습니다. 앱으로 이동합니다…')}</p>
        </div>
      );
    }

    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>
          {t('Before you continue', '시작하기 전에')}
        </h1>
        <p className="muted" style={{ marginBottom: 20, lineHeight: 1.6 }}>
          {t('You signed in with Google, so we could not show you these documents during sign-up. Please read and agree to continue.',
             '구글로 로그인하셨기 때문에 가입 과정에서 아래 문서를 보여드리지 못했습니다. 읽고 동의해 주세요.')}
        </p>

        {state.pending.map((p) => {
          const label = (KIND_LABEL[p.kind] && KIND_LABEL[p.kind][lang]) || p.kind;
          return (
            <label className="chk" key={p.documentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={!!checked[p.documentId]}
                onChange={(e) => setChecked((s) => ({ ...s, [p.documentId]: e.target.checked }))}
              />
              <span>
                {t('I agree to the ', '')}
                <a href={'#/legal/' + p.kind} target="_blank" rel="noreferrer">{label}</a>
                {t('', ' 에 동의합니다')}
                <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>v{p.version}</span>
              </span>
            </label>
          );
        })}

        {failure && (
          <p role="alert" style={{ color: 'var(--danger, #d33)', margin: '12px 0', fontSize: 13 }}>
            {failure}
          </p>
        )}

        {/*
           ★ 전부 체크하지 않으면 비활성이고, **왜** 비활성인지 문장으로 말한다.
             title 은 접근성 이름이 아니므로 쓰지 않는다.
        */}
        <button
          type="button"
          className="btn btn--primary"
          disabled={!allChecked || busy}
          onClick={submit}
          style={{ marginTop: 8 }}
        >
          {busy ? t('Saving…', '저장 중…') : t('Agree and continue', '동의하고 계속')}
        </button>
        {!allChecked && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t('Please agree to every document above to continue.',
               '계속하려면 위의 모든 문서에 동의해 주세요.')}
          </p>
        )}
      </div>
    );
  }

  window.ConsentPage = ConsentPage;
})();
