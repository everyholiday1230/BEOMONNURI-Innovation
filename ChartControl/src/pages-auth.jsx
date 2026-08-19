/* ============================================================
   Auth Pages
   ------------------------------------------------------------
   - LoginPage         /login
   - SignupPage        /signup
   - PasswordResetPage /password-reset
   - EmailVerifyPage   /verify-email
   - Setup2FAPage      /setup-2fa
   - KYCOnboardingPage /kyc
   - LandingPage       /   (public marketing)
   - NotFoundPage      *
   ------------------------------------------------------------
   특징: 사이드바 없음 · 좌측 폼 + 우측 브랜드 패널의 2-column
   ============================================================ */

(function () {
  const { useState, useEffect, useMemo } = React;
  const I = window.Icons;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  // 사전에 키가 없으면 폴백 언어(영어)로, 그것도 없으면 키를 그대로 보여준다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /*
     국가 목록 — 한 곳에서만 정의한다.

     ★★ 전에는 가입 화면과 KYC 화면에 각각 하드코딩돼 있었고, **목록이 서로
       달랐다**(7개 / 4개). 가입할 때 고른 나라를 KYC 에서는 고를 수 없는 상태가
       될 수 있다.

     ★ 라벨을 사전 키로 둔다. 전에는 `🇯🇵 日本`·`🇩🇪 Deutschland` 처럼 그 나라
       말로 적혀 있어서, 중국어 화면에 일본어·독일어가 섞여 나왔다. 나라 이름은
       보는 사람의 언어로 적는 것이 맞다.

     ★ 국기 이모지는 사전 값에 함께 둔다 — 언어와 무관한 표기이고, 목록에서
       나라를 빨리 찾는 데 도움이 된다.
  */
  const COUNTRY_OPTIONS = [
    { value: 'KR', key: 'country_kr' },
    { value: 'US', key: 'country_us' },
    { value: 'JP', key: 'country_jp' },
    { value: 'CN', key: 'country_cn' },
    { value: 'TW', key: 'country_tw' },
    { value: 'SG', key: 'country_sg' },
    { value: 'HK', key: 'country_hk' },
    { value: 'GB', key: 'country_gb' },
    { value: 'DE', key: 'country_de' },
    { value: 'OTHER', key: 'country_other' },
  ];
  const countryOptions = () => COUNTRY_OPTIONS.map(
    (c) => <option key={c.value} value={c.value}>{t(c.key)}</option>,
  );

  /** 언어 변경 시 이 파일의 컴포넌트들이 재렌더되도록 하는 훅. */
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);

  // ============================================================
  // AUTH SHELL — reusable wrapper for auth pages
  // ============================================================
  window.AuthShell = function AuthShell({ title, subtitle, children, mode = 'auth', progress }) {
    /*
       ★★ 히어로 통계는 **셀 수 있는 것만** 보여준다.

         원래 이 자리에 이렇게 적혀 있었다:
           '21+ Pairs'      — 실제로는 662개(그리고 서버가 세어 준다)
           '8 Exchanges'    — 거래는 KuCoin 하나만 지원한다
           '62% Signal Hit' — AI 가 연결되어 있지 않다. 근거가 전혀 없다
           '2.6× Avg R:R'   — 같음

         랜딩 페이지의 같은 블록은 이미 실제 개수로 고쳤는데, **로그인 화면의
         히어로에는 옛 숫자가 남아 있었다.** 방문자가 가장 먼저 보는 두 화면이
         서로 다른 숫자를 말하고 있었다.

         적중률이 가장 위험하다. "이 서비스를 쓰면 62% 맞는다" 로 읽히고, 그것을
         근거로 돈을 넣는다. 측정하지 않은 수치는 쓰지 않는다.

       ★ 비수탁·출금권한 미요구는 **검증 가능한 사실**이므로 그대로 쓴다.
         이쪽이 광고 문구보다 실제로 더 설득력이 있다.
    */
    const [heroPairs, setHeroPairs] = useState(null);
    useEffect(() => {
      const api = window.QTApi;
      if (!api || !api.rest || !api.rest.instruments) return undefined;
      // 백엔드 없는 디자인 미리보기에서는 요청하지 않는다(콘솔 404 방지).
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return undefined;
      let cancelled = false;
      api.rest.instruments()
        .then((r) => {
          if (cancelled) return;
          const n = Array.isArray(r && r.data) ? r.data.length : null;
          setHeroPairs(Number.isFinite(n) && n > 0 ? n : null);
        })
        .catch(() => { /* 실패하면 '—' 로 남는다 — 추측값을 넣지 않는다 */ });
      return () => { cancelled = true; };
    }, []);
    const heroEx = window.QTApi && window.QTApi.useExchanges ? window.QTApi.useExchanges(false) : null;
    const heroExCount = heroEx && Array.isArray(heroEx.items) ? heroEx.items.length : 0;

    return (
      <div className="auth-shell">
        {/* LEFT — form */}
        <div className="auth-shell__form">
          <a className="auth-shell__brand" href="#/">
            <span className="auth-shell__brand-mark">Q</span>
            <span>{window.QTI18n ? window.QTI18n.brand() : 'ChartControl'}</span>
            <span className="auth-shell__brand-ver">v1.0</span>
          </a>

          <div className="auth-shell__form-inner">
            {progress && (
              <div className="auth-progress">
                {progress.map((p, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <div className={`auth-progress__line ${i <= progress.findIndex(x => x.active) ? 'is-done' : ''}`}/>}
                    <div className={`auth-progress__step ${p.active ? 'is-active' : ''} ${p.done ? 'is-done' : ''}`}>
                      <span className="auth-progress__num">{p.done ? '✓' : (i+1)}</span>
                      <span className="auth-progress__label">{p.label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}

            {title && (
              <div className="auth-title-block">
                <h1 className="auth-title">{title}</h1>
                {subtitle && <p className="auth-subtitle">{subtitle}</p>}
              </div>
            )}

            {children}
          </div>

          <div className="auth-shell__foot">
            <div className="auth-foot-links">
              <a href="#/terms">{t('auth_3b9e30')}</a>
              <a href="#/privacy">{t('auth_d629d0')}</a>
              <a href="#/security">{t('auth_a5e5da')}</a>
              <a href="#/help">{t('auth_e2654a')}</a>
            </div>
            {/* 모드는 고정 문구로 쓰지 않는다 — 위 랜딩 푸터와 같은 이유. */}
            <div className="auth-foot-copy">© 2026 {window.QTI18n ? window.QTI18n.brand() : 'ChartControl'} · {(() => {
              const cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
              const backend = !(window.QTLive && window.QTLive.isBackendPresent
                && window.QTLive.isBackendPresent() === false);
              if (!backend) return t('stripe_preview');
              if (!cfg) return t('stripe_checking');
              return (Boolean(cfg.liveOrdersEnabled) && /LIVE/i.test(String(cfg.tradingMode || '')))
                ? t('stripe_live') : t('stripe_sim');
            })()}</div>
          </div>
        </div>

        {/* RIGHT — brand hero */}
        <div className="auth-shell__hero">
          <div className="auth-hero-bg"/>
          <div className="auth-hero-content">
            <div className="auth-hero-badge">{t('auth_hero_badge')}</div>
            <div className="auth-hero-title">
              {t('auth_77edb5')}<br/>
              {t('auth_9ab22f')}
            </div>
            <div className="auth-hero-body">
              {t('auth_7e2510')}
            </div>
            <div className="auth-hero-features">
              {[
                { icon: 'Sparkles', title: 'AI-Native Workflow', desc: t('auth_833f52') },
                { icon: 'Chart',    title: '24-col Layout',       desc: t('auth_66cdd9') },
                { icon: 'Alert',    title: 'Safety by Design',    desc: t('auth_2d0495') },
                {
                  icon: 'Wallet',
                  /*
                     ★★ "8+ 거래소 지원 · Binance · Bitget · OKX · Bybit …" 가
                       하드코딩돼 있었다. 실제로 연결되는 거래소는 2개
                       (KuCoin·BitMart)이고, Binance·OKX·Bybit 는 어댑터가 없다.
                       로그인 화면은 가입 직후 보는 화면이라, 여기서 못 지키는
                       약속을 하면 바로 드러난다.
                     ★ 이름을 나열하지 않는다 — 협약이 늘거나 줄 때마다 문구를
                       고쳐야 하고, 빠뜨리면 또 거짓이 된다. 개수만 말한다.
                  */
                  title: t('auth_exchanges_title'),
                  desc: t('auth_exchanges_desc'),
                },
              ].map((f, i) => {
                const Ic = I[f.icon] || I.Grid;
                return (
                  <div key={i} className="auth-hero-feat">
                    <div className="auth-hero-feat__icon"><Ic size={14}/></div>
                    <div>
                      <div className="auth-hero-feat__title">{f.title}</div>
                      <div className="auth-hero-feat__desc">{f.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="auth-hero-stats">
              <div>
                <strong>{heroPairs === null ? t('dash') : heroPairs.toLocaleString()}</strong>
                <span>{t('landing_stat_pairs')}</span>
              </div>
              <div>
                <strong>{heroExCount > 0 ? heroExCount : t('dash')}</strong>
                <span>{t('landing_stat_exchange')}</span>
              </div>
              <div><strong>0</strong><span>{t('landing_stat_custody')}</span></div>
              <div><strong>0</strong><span>{t('landing_stat_withdraw')}</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // LOGIN PAGE
  // ============================================================
  window.LoginPage = function LoginPage({ shellProps }) {
    const [email, setEmail] = useState('');
    const [pw, setPw] = useState('');
    const [remember, setRemember] = useState(true);
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState('credentials'); // credentials | 2fa
    const [otp, setOtp] = useState(['','','','','','']);
    const otpRefs = Array.from({length: 6}, () => React.createRef());

    // 서버가 돌려준 오류 문구. 마크업은 그대로 두고 이 값만 표시한다.
    const [authError, setAuthError] = useState('');

    /**
     * 로그인.
     *
     * MFA 가 켜진 계정만 2단계로 넘어간다. 예전에는 항상 2단계를 보여줬는데,
     * MFA 를 쓰지 않는 계정에는 통과할 수 없는 화면이라 로그인이 불가능했다.
     */
    const submit = (e) => {
      e.preventDefault();
      if (!window.QTApi || !window.QTApi.auth) {
        // 백엔드가 없는 정적 프리뷰. 화면 흐름만 보여준다.
        setStep('2fa');
        setTimeout(() => otpRefs[0].current?.focus(), 100);
        return;
      }
      setAuthError('');
      setLoading(true);
      window.QTApi.auth.login(email, pw)
        .then((res) => {
          setLoading(false);
          const needsMfa = Boolean(res && (res.mfaRequired || res.requiresMfa || (res.user && res.user.mfaEnabled && !res.user.mfaVerified)));
          if (needsMfa) {
            setStep('2fa');
            setTimeout(() => otpRefs[0].current?.focus(), 100);
            return;
          }
          if (window.QTAuth) window.QTAuth.refresh();
          window.location.hash = '/trade';
        })
        .catch((err) => {
          setLoading(false);
          // 비밀번호 오류와 계정 잠금을 구분해 알려준다.
          setAuthError(
            err && err.status === 401 ? t('auth_err_invalid_credentials')
            : err && err.status === 423 ? t('auth_err_account_locked')
            : err && err.status === 429 ? t('auth_err_too_many_attempts')
            : (err && err.message) || t('auth_err_generic')
          );
        });
    };

    const submitOtp = () => {
      if (!window.QTApi || !window.QTApi.auth) { window.location.hash = '/trade'; return; }
      setAuthError('');
      setLoading(true);
      window.QTApi.auth.verifyMfa(otp.join(''))
        .then(() => {
          setLoading(false);
          if (window.QTAuth) window.QTAuth.refresh();
          window.location.hash = '/trade';
        })
        .catch((err) => {
          setLoading(false);
          setAuthError((err && err.message) || t('auth_err_invalid_code'));
        });
    };

    return (
      <window.AuthShell title={t('login_e225a6')} subtitle={t('login_3f05db')}>
        {step === 'credentials' && (
          <form onSubmit={submit} className="auth-form">
            <div className="input-group">
              <span className="input-group__label"><I.User size={11}/> {t('fld_email')}</span>
              <input type="email" placeholder={t('fld_email_ph')} value={email} onChange={e => setEmail(e.target.value)} required autoFocus/>
            </div>
            <div className="input-group">
              <span className="input-group__label"><I.Lock size={11}/> {t('fld_password')}</span>
              <input type="password" placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} required/>
            </div>

            <div className="auth-row-between">
              <label className="chk">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/>
                <span className="chk__box"><I.Check size={10}/></span>
                {t('login_a89650')}
              </label>
              <a href="#/password-reset" style={{fontSize:12, color:'var(--color-brand)'}}>{t('login_92c6f3')}</a>
            </div>

            {authError && (
              <div className="auth-alert auth-alert--danger">
                <I.Alert size={12}/>
                <div>{authError}</div>
              </div>
            )}

            <button type="submit" className="btn btn--primary btn--lg" style={{width:'100%'}} disabled={loading}>
              {loading ? <><span className="spinner"/> {t('login_33c1f7')}</> : <>{t('login_e2d231')}</>}
            </button>

            <div className="auth-divider"><span>{t('login_46bed0')}</span></div>

            <div style={{display:'flex', gap: 8}}>
              <button type="button" className="btn" style={{flex:1}}>Google</button>
              <button type="button" className="btn" style={{flex:1}}>Apple</button>
              <button type="button" className="btn" style={{flex:1}} /* qt-i18n-ignore: 서비스 고유명사 */>GitHub</button>
            </div>

            <div className="auth-row-center">
              {t('login_68a92d')} <a href="#/signup" style={{color:'var(--color-brand)', marginLeft: 4}}>{t('login_49f561')}</a>
            </div>

            <div className="auth-alert auth-alert--info" style={{marginTop: 16}}>
              <I.Info size={12}/>
              <div><strong>{t('demo_label')}</strong> {t('login_13d6ae')}</div>
            </div>
          </form>
        )}

        {step === '2fa' && (
          <div className="auth-form">
            <div className="auth-alert auth-alert--info">
              <I.Sparkles size={12}/>
              <div>
                {t('login_2fa_hint_pre')}<strong>{t('login_2fa_hint_em')}</strong>{t('login_2fa_hint_post')}
                <br/>{t('login_2fa_apps')}
              </div>
            </div>

            <div className="otp-input">
              {otp.map((d, i) => (
                <input
                  key={i}
                  ref={otpRefs[i]}
                  type="text"
                  maxLength={1}
                  className="otp-input__cell"
                  value={d}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g,'').slice(0,1);
                    const next = [...otp]; next[i] = val; setOtp(next);
                    if (val && i < 5) otpRefs[i+1].current?.focus();
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs[i-1].current?.focus();
                  }}
                />
              ))}
            </div>

            {authError && (
              <div className="auth-alert auth-alert--danger">
                <I.Alert size={12}/>
                <div>{authError}</div>
              </div>
            )}

            <button className="btn btn--primary btn--lg" style={{width:'100%'}} onClick={submitOtp} disabled={loading || otp.some(x => !x)}>
              {loading ? <><span className="spinner"/> {t('login_33c1f7')}</> : t('login_241c96')}
            </button>

            <div style={{fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center'}}>
              {t('login_f3047a')} <a href="#" style={{color:'var(--color-brand)'}}>{t('login_6adb8b')}</a>
            </div>

            <button className="btn btn--ghost" style={{width:'100%'}} onClick={() => setStep('credentials')}>
              {t('login_f787eb')}
            </button>
          </div>
        )}
      </window.AuthShell>
    );
  };

  // ============================================================
  // SIGNUP PAGE
  // ============================================================
  window.SignupPage = function SignupPage({ shellProps }) {
    const [form, setForm] = useState({ email: '', pw: '', pw2: '', country: 'KR', agree: false, marketing: true });

    /*
       초대 코드.

       ★ 가입 시점에만 귀속된다. 나중에 "이 사람은 내가 초대했다" 고 주장해도
         검증할 근거가 없으므로 소급 적용을 허용하지 않는다. 그래서 이 화면이
         코드를 받는 유일한 자리다.

       주소(?ref=CODE)에서 먼저 읽는다 — 초대 링크로 들어온 사용자가 코드를
       직접 입력하게 만들면 대부분 그냥 넘어가고 귀속이 실패한다.
    */
    const [refCode, setRefCode] = useState('');
    const [refState, setRefState] = useState(null);   // null=미확인 | {valid, sharePct}

    /*
       동의 대상이 게시되어 있는가.

       ★ 게시되지 않은 약관에 동의를 받으면 그 동의는 아무것도 가리키지 않는다.
         화면이 그 사실을 사용자에게 알린다 (가입을 막지는 않는다 — 정책 결정).
    */
    const [legalMissing, setLegalMissing] = useState([]);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.legalIndex) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      api.legalIndex().then((r) => {
        if (cancelled || !r.available) return;
        const kinds = new Set((r.documents || []).map((x) => x.kind));
        setLegalMissing(['terms', 'privacy'].filter((k) => !kinds.has(k)));
      }).catch(() => { /* 확인 실패를 경고로 바꾸지 않는다 — 잘못된 경고가 더 나쁘다 */ });
      return () => { cancelled = true; };
    }, []);

    useEffect(() => {
      // 해시 쿼리에서 코드를 꺼낸다. 라우터가 파싱한 값을 쓸 수 없는 화면이다.
      const hash = String(window.location.hash || '');
      const q = hash.indexOf('?');
      if (q === -1) return;
      const params = new URLSearchParams(hash.slice(q + 1));
      const code = params.get('ref');
      if (code) setRefCode(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    }, []);

    /*
       코드 유효성 확인.

       입력이 멈춘 뒤에 한 번만 확인한다 — 글자마다 요청하면 서버에 부담이고,
       사용자는 타이핑 중에 '무효' 를 보게 된다.
       ★ 서버는 초대자가 누구인지 알려주지 않는다(코드를 넣어보며 다른 사용자의
         존재를 알아내는 것을 막는다). 유효 여부만 온다.
    */
    useEffect(() => {
      const code = refCode.trim();
      if (!code) { setRefState(null); return undefined; }
      if (!window.QTApi || !window.QTApi.rest || !window.QTApi.rest.referralCheck) return undefined;
      let cancelled = false;
      const id = setTimeout(() => {
        window.QTApi.rest.referralCheck(code)
          .then((r) => { if (!cancelled) setRefState(r); })
          // 확인 실패를 '무효' 로 표시하지 않는다 — 유효한 코드가 버려질 수 있다.
          .catch(() => { if (!cancelled) setRefState(null); });
      }, 450);
      return () => { cancelled = true; clearTimeout(id); };
    }, [refCode]);
    const [loading, setLoading] = useState(false);
    const errors = [];
    if (form.pw && form.pw.length < 8) errors.push(t('signup_5ca401'));
    if (form.pw2 && form.pw !== form.pw2) errors.push(t('signup_dd3243'));

    // password strength
    const strength = (() => {
      const p = form.pw;
      if (!p) return { score: 0, label: '' };
      let s = 0;
      if (p.length >= 8) s++;
      if (/[A-Z]/.test(p)) s++;
      if (/[0-9]/.test(p)) s++;
      if (/[^A-Za-z0-9]/.test(p)) s++;
      return { score: s, label: [t('signup_591c17'),t('signup_24bb15'),t('signup_2179da'),t('signup_5f67e6'),t('signup_dff519')][s] };
    })();

    // 서버 검증 오류. 클라이언트 검증(errors)과 합쳐서 같은 자리에 표시한다.
    const [serverError, setServerError] = useState('');

    const submit = (e) => {
      e.preventDefault();
      if (!window.QTApi || !window.QTApi.auth) {
        window.location.hash = '/verify-email';
        return;
      }
      setServerError('');
      setLoading(true);
      window.QTApi.auth.register(form.email, form.pw, {
        country: form.country,
        marketingOptIn: form.marketing,
        /*
           코드가 유효할 때만 보낸다.

           무효한 코드를 보내도 서버가 무시하지만, 보내지 않으면 서버 로그가
           깨끗해지고 "왜 귀속이 안 됐나" 를 추적할 때 혼선이 없다.
        */
        ...(refCode.trim() && refState && refState.valid ? { referralCode: refCode.trim() } : {}),
      })
        .then(() => {
          setLoading(false);
          window.location.hash = '/verify-email';
        })
        .catch((err) => {
          setLoading(false);
          // 서버 비밀번호 정책이 클라이언트보다 엄격하다(최소 10자). 그대로 보여준다.
          setServerError(
            err && err.status === 409 ? t('auth_err_email_taken')
            : (err && err.message) || t('auth_err_generic')
          );
        });
    };

    return (
      <window.AuthShell
        title={t('signup_ecb4cc')}
        subtitle={t('signup_a6f945')}
        progress={[
          { label: t('signup_1ff941'), active: true },
          { label: t('signup_32b217') },
          { label: t('signup_d284fa') },
        ]}
      >
        <form onSubmit={submit} className="auth-form">
          <div className="input-group">
            <span className="input-group__label"><I.User size={11}/> {t('fld_email')}</span>
            <input type="email" placeholder={t('fld_email_ph')} value={form.email} onChange={e => setForm({...form, email: e.target.value})} required autoFocus/>
          </div>

          <div className="input-group">
            <span className="input-group__label"><I.Lock size={11}/> {t('fld_password')}</span>
            <input type="password" placeholder={t('signup_10c83d')} value={form.pw} onChange={e => setForm({...form, pw: e.target.value})} required/>
          </div>

          {form.pw && (
            <div className="pw-strength">
              <div className="pw-strength__bar">
                {[1,2,3,4].map(n => (
                  <div key={n} className={`pw-strength__seg ${n <= strength.score ? 'is-fill s'+strength.score : ''}`}/>
                ))}
              </div>
              <div className="pw-strength__label">{strength.label}</div>
            </div>
          )}

          <div className="input-group">
            <span className="input-group__label"><I.Lock size={11}/> {t('fld_confirm')}</span>
            <input type="password" placeholder={t('signup_711154')} value={form.pw2} onChange={e => setForm({...form, pw2: e.target.value})} required/>
          </div>

          <div className="input-group">
            <span className="input-group__label"><I.Globe size={11}/> {t('fld_country')}</span>
            <select value={form.country} onChange={e => setForm({...form, country: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
              {countryOptions()}
            </select>
          </div>

          {(errors.length > 0 || serverError) && (
            <div className="auth-alert auth-alert--danger">
              <I.Alert size={12}/>
              <div>{[...errors, serverError].filter(Boolean).join(' · ')}</div>
            </div>
          )}

          {/*
             초대 코드 (선택).

             제도가 켜져 있을 때만 보여준다 — 꺼져 있으면 입력해도 귀속되지
             않으므로, 칸을 두면 사용자가 코드를 넣고 보상을 기대한다.
             서버가 enabled 로 알려준다.
          */}
          {(refCode || (refState && refState.enabled)) && (
            <div>
              <div className="input-group">
                <span className="input-group__label">{t('signup_ref_label')}</span>
                <input
                  value={refCode}
                  maxLength={16}
                  placeholder={t('signup_ref_ph')}
                  onChange={(e) => setRefCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                />
              </div>
              {/*
                 확인 결과.

                 유효할 때만 초대자 몫을 알려준다. 초대자가 누구인지는 표시하지
                 않는다 — 서버가 주지 않고, 주면 코드를 넣어보며 다른 사용자를
                 알아낼 수 있다.
              */}
              {refCode && refState && (
                <div style={{
                  marginTop:5, fontSize:11.5,
                  color: refState.valid ? 'var(--color-success)' : 'var(--color-warning)',
                }}>
                  {refState.valid
                    ? t('signup_ref_ok', { pct: refState.sharePct })
                    : t('signup_ref_bad')}
                </div>
              )}
            </div>
          )}

          <label className="chk">
            <input type="checkbox" checked={form.agree} onChange={e => setForm({...form, agree: e.target.checked})} required/>
            <span className="chk__box"><I.Check size={10}/></span>
            <span style={{fontSize: 12}}>
              <a href="#/terms" target="_blank" rel="noopener" style={{color:'var(--color-brand)'}}>{t('auth_3b9e30')}</a> · <a href="#/privacy" target="_blank" rel="noopener" style={{color:'var(--color-brand)'}}>{t('signup_532136')}</a> {t('signup_75a112')}
            </span>
          </label>

          {/*
             ★★ 동의 대상이 실제로 게시되어 있는지 확인한다 ★★

               "약관에 동의합니다" 를 받는데 그 약관이 게시되지 않았으면 그
               동의는 아무것도 가리키지 않는다. 전에는 링크 자체가 404 였고,
               그래도 가입은 진행됐다.

               게시되지 않았으면 그 사실을 적는다. 가입을 막지는 않는다 —
               막을지 여부는 우리가 정할 정책 문제이고, 화면이 임의로 막으면
               런칭 당일에 아무도 가입하지 못한다. 대신 운영자가 볼 수 있게
               /admin/legal 의 readiness 가 canLaunch:false 를 보고한다.
          */}
          {legalMissing.length > 0 && (
            <div style={{
              padding:'9px 11px', borderRadius:6, fontSize:11.5, lineHeight:1.7,
              background:'color-mix(in srgb, var(--color-warning, #d97706) 12%, transparent)',
              border:'1px solid var(--color-warning, #d97706)',
            }}>
              {t('signup_legal_missing', {
                what: legalMissing.map((k) => t(k === 'terms' ? 'legal_terms' : 'legal_privacy')).join(' · '),
              })}
            </div>
          )}

          <label className="chk">
            <input type="checkbox" checked={form.marketing} onChange={e => setForm({...form, marketing: e.target.checked})}/>
            <span className="chk__box"><I.Check size={10}/></span>
            <span style={{fontSize: 12}}>{t('signup_21e2e3')}</span>
          </label>

          <button type="submit" className="btn btn--primary btn--lg" style={{width:'100%'}} disabled={loading || !form.agree || errors.length > 0 || !form.email || !form.pw2}>
            {loading ? <><span className="spinner"/> {t('signup_24cd06')}</> : t('signup_3929bb')}
          </button>

          <div className="auth-row-center">
            {t('signup_9922a0')} <a href="#/login" style={{color:'var(--color-brand)', marginLeft: 4}}>{t('login_e2d231')}</a>
          </div>
        </form>
      </window.AuthShell>
    );
  };

  // ============================================================
  // EMAIL VERIFY
  // ============================================================
  window.EmailVerifyPage = function EmailVerifyPage({ shellProps }) {
    const [code, setCode] = useState(['','','','','','']);
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const refs = Array.from({length:6}, () => React.createRef());
    useEffect(() => { refs[0].current?.focus(); }, []);

    const [verifyError, setVerifyError] = useState('');

    const submit = () => {
      if (!window.QTApi || !window.QTApi.auth) { window.location.hash = '/kyc'; return; }
      setVerifyError('');
      setLoading(true);
      window.QTApi.auth.verifyEmail(code.join(''))
        .then(() => {
          setLoading(false);
          // 인증되면 세션의 emailVerified 가 바뀐다. 화면 등급 상태도 갱신한다.
          if (window.QTAuth) window.QTAuth.refresh();
          window.location.hash = '/kyc';
        })
        .catch((err) => {
          setLoading(false);
          setVerifyError((err && err.message) || t('auth_err_invalid_code'));
        });
    };

    /** 인증 코드 재발송. 서버가 실제로 메일을 보낸다. */
    const resend = () => {
      if (!window.QTApi || !window.QTApi.auth) { setSent(true); setTimeout(() => setSent(false), 3000); return; }
      setVerifyError('');
      window.QTApi.auth.requestEmailVerify()
        .then(() => { setSent(true); setTimeout(() => setSent(false), 3000); })
        .catch((err) => setVerifyError((err && err.message) || t('auth_err_generic')));
    };

    return (
      <window.AuthShell
        title={t('signup_32b217')}
        subtitle={t('email_verify_5eb00e')}
        progress={[
          { label: t('signup_1ff941'), done: true },
          { label: t('signup_32b217'), active: true },
          { label: t('signup_d284fa') },
        ]}
      >
        <div className="auth-form">
          <div className="auth-verify-icon">
            <I.Bell size={30}/>
          </div>

          <div style={{textAlign: 'center', fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8}}>
            {t('verify_hint_pre')}<strong>{t('verify_hint_em')}</strong>{t('verify_hint_post')}<br/>
            <span style={{color: 'var(--color-text-tertiary)'}}>{t('email_verify_0fa353')}</span>
          </div>

          <div className="otp-input">
            {code.map((d, i) => (
              <input
                key={i}
                ref={refs[i]}
                type="text" maxLength={1}
                className="otp-input__cell"
                value={d}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g,'').slice(0,1);
                  const next = [...code]; next[i] = val; setCode(next);
                  if (val && i < 5) refs[i+1].current?.focus();
                }}
                onKeyDown={e => {
                  if (e.key === 'Backspace' && !code[i] && i > 0) refs[i-1].current?.focus();
                }}
              />
            ))}
          </div>

          {verifyError && (
            <div className="auth-alert auth-alert--danger">
              <I.Alert size={12}/>
              <div>{verifyError}</div>
            </div>
          )}

          <button className="btn btn--primary btn--lg" style={{width:'100%'}} onClick={submit} disabled={loading || code.some(x => !x)}>
            {loading ? <><span className="spinner"/> {t('login_33c1f7')}</> : t('email_verify_455f7c')}
          </button>

          <div className="auth-row-center" style={{fontSize:12}}>
            {sent ? (
              <span style={{color: 'var(--color-success)'}}>{t('email_verify_089bb3')}</span>
            ) : (
              <>
                {t('login_f3047a')}
                <a href="#" style={{color:'var(--color-brand)', marginLeft: 4}} onClick={e => { e.preventDefault(); resend(); }}>{t('email_verify_37a414')}</a>
              </>
            )}
          </div>
        </div>
      </window.AuthShell>
    );
  };

  // ============================================================
  // KYC ONBOARDING
  // ============================================================
  window.KYCOnboardingPage = function KYCOnboardingPage({ shellProps }) {
    /*
       본인 인증 온보딩.

       ★★ 이 화면은 신분 서류를 수집하고 있었다 ★★

       이름·생년월일·주소·여권 앞뒤면·셀피·자금 출처를 받아서, 제출하면
       성공 화면을 보여주고 /trade 로 보냈다. 그런데 받는 백엔드가 없다 —
       입력한 개인정보와 신분증 사진은 그냥 버려진다.

       왜 폼을 살려두면 안 되는가
       ------------------------
       1. 고객은 신분증 사진을 올렸다고 믿는다. 심사가 진행되는 줄 알고 기다린다.
       2. 실제로 저장하도록 만들어도 안 된다. 우리는 자금을 보관하지 않으므로
          신분 확인 의무가 없고, 보관할 법적 근거 없이 신분증을 모으면
          위험이 줄지 않고 늘어난다(유출 시 책임).
       3. 본인 확인은 이미 거래소가 했다. API 키를 발급하기 전에 거래소가
          검증했고, 자금을 보관하는 주체가 그 의무를 진다.

       그래서 실서비스에서는 사실을 알리고 다음 단계로 보낸다.
       백엔드가 없는 디자인 미리보기에서는 원래 폼을 유지한다(디자이너 불가침).
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const backendKnownAbsent = Boolean(
      window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false,
    );

    const cfg = (window.QTApi && window.QTApi.useConfig) ? window.QTApi.useConfig() : null;
    const signupUrl = (cfg && cfg.exchangeSignupUrl) || '';

    if (!backendKnownAbsent) {
      return (
        <window.AuthShell
          title={t('kyc_na_title')}
          subtitle={t('kyc_na_subtitle')}
          progress={[
            { label: t('signup_1ff941'), done: true },
            { label: t('signup_32b217'), done: true },
            { label: t('kyc_na_step'), active: true },
          ]}
        >
          <div className="auth-form">
            <div className="auth-alert auth-alert--info" style={{alignItems:'flex-start'}}>
              <I.Info size={13}/>
              <div style={{lineHeight:1.8}}>
                <div style={{fontWeight:600, marginBottom:4}}>{t('kyc_na_panel_title')}</div>
                <div>{t('kyc_na_reason')}</div>
              </div>
            </div>

            <ul style={{margin:'4px 0 0', paddingLeft:20, fontSize:12.5, lineHeight:2, color:'var(--color-text-secondary)'}}>
              <li>{t('kyc_na_p1')}</li>
              <li>{t('kyc_na_p2')}</li>
              <li>{t('kyc_na_p3')}</li>
            </ul>

            {/* 다음에 실제로 해야 하는 일 — 거래소 계정과 API 키 연결. */}
            <div style={{marginTop:8, display:'flex', flexDirection:'column', gap:8}}>
              <a className="btn btn--primary btn--lg" href="#/wallet" style={{textDecoration:'none', justifyContent:'center'}}>
                {t('kyc_na_connect')}
              </a>
              {/* 거래소 계정이 없는 사용자에게만 가입 경로를 준다. */}
              {signupUrl && (
                <a className="btn btn--lg" href={signupUrl} target="_blank" rel="noopener noreferrer" style={{textDecoration:'none', justifyContent:'center'}}>
                  {t('deposit_create_account')} <I.ArrowRight size={12}/>
                </a>
              )}
              <a className="btn" href="#/trade" style={{textDecoration:'none', justifyContent:'center'}}>
                {t('kyc_na_skip')}
              </a>
            </div>
          </div>
        </window.AuthShell>
      );
    }

    const [step, setStep] = useState(1);
    const [form, setForm] = useState({
      firstName: '', lastName: '', birth: '', nationality: 'KR',
      address: '', city: '', postal: '',
      idType: 'passport', idFront: null, idBack: null, selfie: null,
      source: '', purpose: '',
    });

    const totalSteps = 4;
    const next = () => setStep(Math.min(totalSteps, step + 1));
    const prev = () => setStep(Math.max(1, step - 1));
    const submit = () => {
      setStep(5);
      setTimeout(() => { window.location.hash = '/trade'; }, 2000);
    };

    return (
      <window.AuthShell
        title={t('k_y_c_onboarding_5f6780')}
        subtitle={step <= totalSteps ? t('kyc_step_progress', { step, total: totalSteps }) : t('k_y_c_onboarding_dc301f')}
        progress={[
          { label: t('signup_1ff941'), done: true },
          { label: t('signup_32b217'), done: true },
          { label: 'KYC', active: true },
        ]}
      >
        <div className="auth-form">
          {step === 1 && (
            <>
              <div className="auth-kyc-step-title">{t('k_y_c_onboarding_9334ed')}</div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10}}>
                <div className="input-group"><span className="input-group__label">{t('fld_first_name')}</span><input value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})}/></div>
                <div className="input-group"><span className="input-group__label">{t('fld_last_name')}</span><input value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})}/></div>
              </div>
              <div className="input-group"><span className="input-group__label">{t('k_y_c_onboarding_31fbff')}</span><input type="date" value={form.birth} onChange={e => setForm({...form, birth: e.target.value})}/></div>
              <div className="input-group">
                <span className="input-group__label">{t('k_y_c_onboarding_ff63ca')}</span>
                <select value={form.nationality} onChange={e => setForm({...form, nationality: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
                  {countryOptions()}
                </select>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="auth-kyc-step-title">{t('k_y_c_onboarding_ebce71')}</div>
              <div className="input-group"><span className="input-group__label">{t('fld_address')}</span><input placeholder={t('k_y_c_onboarding_dad291')} value={form.address} onChange={e => setForm({...form, address: e.target.value})}/></div>
              <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap: 10}}>
                <div className="input-group"><span className="input-group__label">{t('fld_city')}</span><input value={form.city} onChange={e => setForm({...form, city: e.target.value})}/></div>
                <div className="input-group"><span className="input-group__label">{t('fld_postal')}</span><input value={form.postal} onChange={e => setForm({...form, postal: e.target.value})}/></div>
              </div>
              <div className="auth-alert auth-alert--info">
                <I.Info size={12}/>
                <div>{t('k_y_c_onboarding_02220b')}</div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="auth-kyc-step-title">{t('k_y_c_onboarding_8ff495')}</div>
              <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>{t('k_y_c_onboarding_3f327d')}</div>
              <div className="seg" style={{width:'100%'}}>
                <button className={`seg__opt ${form.idType==='passport'?'is-active':''}`} style={{flex:1}} onClick={() => setForm({...form, idType: 'passport'})}>{t('k_y_c_onboarding_8e5bec')}</button>
                <button className={`seg__opt ${form.idType==='drivers'?'is-active':''}`} style={{flex:1}} onClick={() => setForm({...form, idType: 'drivers'})}>{t('k_y_c_onboarding_311122')}</button>
                <button className={`seg__opt ${form.idType==='national'?'is-active':''}`} style={{flex:1}} onClick={() => setForm({...form, idType: 'national'})}>{t('k_y_c_onboarding_3ba1d5')}</button>
              </div>

              <div className="kyc-upload-grid">
                <div className="kyc-upload">
                  <I.Camera size={20}/>
                  <div className="kyc-upload__title">{t('k_y_c_onboarding_26c302')}</div>
                  <div className="kyc-upload__desc">{t('k_y_c_onboarding_6cfe7d')}</div>
                  <button className="btn btn--xs">{t('k_y_c_onboarding_51672c')}</button>
                </div>
                <div className="kyc-upload">
                  <I.Camera size={20}/>
                  <div className="kyc-upload__title">{t('k_y_c_onboarding_2b9e56')}</div>
                  <div className="kyc-upload__desc">{t('k_y_c_onboarding_f8bbc7')}</div>
                  <button className="btn btn--xs">{t('k_y_c_onboarding_51672c')}</button>
                </div>
                <div className="kyc-upload" style={{gridColumn: 'span 2'}}>
                  <I.User size={20}/>
                  <div className="kyc-upload__title">{t('k_y_c_onboarding_de4a5c')}</div>
                  <div className="kyc-upload__desc">{t('k_y_c_onboarding_90745c')}</div>
                  <button className="btn btn--xs btn--primary">{t('k_y_c_onboarding_e07e2e')}</button>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div className="auth-kyc-step-title">{t('k_y_c_onboarding_0f797f')}</div>
              <div className="input-group">
                <span className="input-group__label">{t('k_y_c_onboarding_f01127')}</span>
                <select value={form.source} onChange={e => setForm({...form, source: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
                  <option value="">{t('k_y_c_onboarding_c22557')}</option>
                  <option value="salary">{t('k_y_c_onboarding_edd43e')}</option>
                  <option value="business">{t('k_y_c_onboarding_7fb985')}</option>
                  <option value="investment">{t('k_y_c_onboarding_f27c14')}</option>
                  <option value="savings">{t('k_y_c_onboarding_98ae59')}</option>
                  <option value="inheritance">{t('k_y_c_onboarding_7340b7')}</option>
                  <option value="other">{t('signup_44650a')}</option>
                </select>
              </div>
              <div className="input-group">
                <span className="input-group__label">{t('k_y_c_onboarding_898ed0')}</span>
                <select value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
                  <option value="">{t('k_y_c_onboarding_c22557')}</option>
                  <option value="hedge">{t('k_y_c_onboarding_5d5aea')}</option>
                  <option value="speculation">{t('k_y_c_onboarding_e18ea9')}</option>
                  <option value="long-term">{t('k_y_c_onboarding_aa6c8f')}</option>
                  <option value="arbitrage">{t('k_y_c_onboarding_d66780')}</option>
                  <option value="other">{t('signup_44650a')}</option>
                </select>
              </div>
              <div className="auth-alert auth-alert--info">
                <I.Info size={12}/>
                <div>
                {t('kyc_aml_pre')}<strong>{t('kyc_aml_em')}</strong>{t('kyc_aml_post')}
              </div>
              </div>
            </>
          )}

          {step === 5 && (
            <div style={{textAlign:'center', padding: '20px 0'}}>
              <div className="auth-verify-icon" style={{background: 'oklch(78% 0.14 145 / 0.14)', color: 'var(--color-success)', borderColor: 'var(--color-success)'}}>
                <I.Check size={30}/>
              </div>
              <div style={{fontSize: 16, fontWeight: 600, marginTop: 16}}>{t('k_y_c_onboarding_2ecb11')}</div>
              <div style={{fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 8}}>{t('k_y_c_onboarding_55af46')}</div>
              <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 16, fontFamily: 'var(--font-mono)'}}>Case ID · KYC-{Date.now().toString(36).toUpperCase()}</div>
              <div style={{marginTop: 24}}>
                <button className="btn btn--primary" onClick={() => window.location.hash = '/trade'}>{t('k_y_c_onboarding_03e1e5')}</button>
              </div>
            </div>
          )}

          {step <= totalSteps && (
            <div style={{display:'flex', gap: 8, marginTop: 16}}>
              {step > 1 && <button className="btn" onClick={prev}>{t('k_y_c_onboarding_810016')}</button>}
              {step < totalSteps && <button className="btn btn--primary" style={{flex:1}} onClick={next}>{t('k_y_c_onboarding_c5798c')}</button>}
              {step === totalSteps && <button className="btn btn--primary" style={{flex:1}} onClick={submit}>{t('k_y_c_onboarding_4f67fa')}</button>}
            </div>
          )}
        </div>
      </window.AuthShell>
    );
  };

  // ============================================================
  // PASSWORD RESET
  // ============================================================
  window.PasswordResetPage = function PasswordResetPage({ shellProps }) {
    const [step, setStep] = useState(1);
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [resetError, setResetError] = useState('');

    /**
     * 재설정 링크 요청.
     *
     * 계정이 없어도 성공으로 처리한다 — 서버가 그렇게 응답한다. 존재하는
     * 이메일만 성공을 주면 가입 여부를 알아내는 수단이 된다(계정 열거).
     */
    const requestReset = () => {
      if (!window.QTApi || !window.QTApi.auth) { setStep(2); return; }
      setResetError('');
      setLoading(true);
      window.QTApi.auth.forgotPassword(email)
        .then(() => { setLoading(false); setStep(2); })
        .catch((err) => {
          setLoading(false);
          // 레이트리밋만 사용자에게 알린다. 그 외는 화면을 진행시킨다(열거 방지).
          if (err && err.status === 429) setResetError(t('auth_err_too_many_attempts'));
          else setStep(2);
        });
    };

    return (
      <window.AuthShell title={t('password_reset_8d8082')} subtitle={t('password_reset_d196c8')}>
        <div className="auth-form">
          {step === 1 && (
            <>
              <div className="input-group">
                <span className="input-group__label"><I.User size={11}/> {t('fld_email')}</span>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus/>
              </div>
              {resetError && (
                <div className="auth-alert auth-alert--danger">
                  <I.Alert size={12}/>
                  <div>{resetError}</div>
                </div>
              )}
              <button className="btn btn--primary btn--lg" style={{width:'100%'}} onClick={requestReset} disabled={!email || loading}>
                {loading ? <><span className="spinner"/> {t('login_33c1f7')}</> : t('password_reset_7badb1')}
              </button>
              <div className="auth-row-center"><a href="#/login" style={{color:'var(--color-brand)'}}>{t('password_reset_5ee6ba')}</a></div>
            </>
          )}
          {step === 2 && (
            <div style={{textAlign: 'center'}}>
              <div className="auth-verify-icon"><I.Bell size={30}/></div>
              <div style={{fontSize: 14, fontWeight: 500, marginTop: 12}}>{t('password_reset_d09993')}</div>
              <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4}}>{t('pwreset_link_sent', { email })}</div>
              <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 20, fontFamily: 'var(--font-mono)'}}>{t('email_verify_0fa353')}</div>
              <button className="btn" style={{marginTop: 20}} onClick={() => window.location.hash = '/login'}>{t('password_reset_a40b90')}</button>
            </div>
          )}
        </div>
      </window.AuthShell>
    );
  };

  // ============================================================
  // LANDING PAGE (public marketing) - 로그인 전
  // ============================================================
  window.LandingPage = function LandingPage({ shellProps }) {
    /*
       거래쌍 수 — 실제로 조회한다.

       '21+' 가 박혀 있었는데 KuCoin 은 660개 넘는 USDT 무기한을 상장한다.
       실제보다 훨씬 적게 말하는 것도 부정확한 정보다.
       조회 실패 시 '—' 로 둔다 — 숫자를 만들지 않는다.

       랜딩은 비로그인 화면이므로 공개 엔드포인트만 쓴다.
    */
    const [landingPairs, setLandingPairs] = useState(null);
    useEffect(() => {
      if (!window.QTApi || !window.QTApi.rest || !window.QTApi.rest.instruments) return undefined;
      // 백엔드가 없는 디자인 미리보기에서는 요청하지 않는다 (콘솔 404 방지).
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return undefined;
      let cancelled = false;
      window.QTApi.rest.instruments()
        .then((r) => {
          if (cancelled) return;
          const n = Array.isArray(r && r.data) ? r.data.length : null;
          setLandingPairs(Number.isFinite(n) && n > 0 ? n : null);
        })
        .catch(() => { /* 실패하면 '—' 로 남는다 */ });
      return () => { cancelled = true; };
    }, []);

    /*
       지원 거래소 — 서버 판정을 쓴다.

       ★★ 원래 `window.QTApp.EXCHANGES`(예시 9개)를 그대로 "Supported Exchanges"
         로 보여줬다. 실제로 연결되는 것은 2개뿐이므로, 방문자는 우리가 9개를
         지원한다고 믿고 가입한다. 가장 먼저 보는 화면에서 사실과 다른 약속을
         하면 신뢰를 회복할 기회가 없다.

       ★ 랜딩은 비로그인 화면이므로 항상 연결 가능한 것만 보여준다.
       ★ 백엔드 없는 미리보기에서는 예시 목록을 쓴다 — 디자이너 화면 보존.
    */
    /*
       주소로 직접 들어온 경우에도 해당 섹션으로 옮겨준다.

       `#/?section=pricing` 로 링크를 공유하거나 새 탭으로 열면 페이지 위쪽이
       보인다. 링크를 눌렀을 때만 스크롤하면 공유된 주소가 약속을 지키지 못한다.
       (렌더 직후에는 섹션이 아직 없을 수 있어 한 프레임 뒤에 찾는다)
    */
    useEffect(() => {
      const want = (shellProps && shellProps.query && shellProps.query.section) || '';
      if (!want) return undefined;
      const id = requestAnimationFrame(() => {
        const el = document.getElementById(String(want));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return () => cancelAnimationFrame(id);
    }, [shellProps && shellProps.query && shellProps.query.section]);

    const exPreviewOnly = window.QTLive && window.QTLive.isBackendPresent
      && window.QTLive.isBackendPresent() === false;
    const exData = window.QTApi && window.QTApi.useExchanges
      ? window.QTApi.useExchanges(false)
      : null;
    const landingExchanges = exPreviewOnly
      ? (window.QTApp.EXCHANGES || [])
      : (exData ? exData.items : []);

    return (
      <div className="landing-shell">
        {/*
           랜딩 상단 띠.

           ★★ "MOCK DATA · NO REAL FUNDS · PROTOTYPE DEMO · SESSION PUBLIC-DEMO"
             가 하드코딩돼 있었다. 이건 **처음 오는 방문자가 보는 첫 문장**이다.
             실서비스인데 "프로토타입 데모" 라고 적혀 있으면 가입하지 않는다.
             (앱 헤더의 같은 띠는 이미 서버 상태로 고쳤다 — 여기만 남아 있었다)

           ★ 랜딩은 비로그인 화면이므로 거래 모드를 단정하지 않는다. 대신 사실만
             말한다: 시세는 실제이고, 주문은 거래소에서 고객 키로 이뤄진다는 것.
             백엔드가 없는 디자인 미리보기에서는 예시 데이터임을 밝힌다.
        */}
        <div className="sim-stripe" style={{position:'relative'}}>
          <div className="sim-stripe__left">
            <span className="sim-stripe__badge">
              {exPreviewOnly ? t('stripe_preview') : t('landing_stripe_badge')}
            </span>
            <span>{exPreviewOnly ? t('stripe_preview_note') : t('landing_stripe_note')}</span>
          </div>
          <div className="sim-stripe__right">
            <span>{t('stripe_data', {
              src: t(exPreviewOnly ? 'stripe_data_mock' : 'stripe_data_live'),
            })}</span>
          </div>
        </div>

        <header className="landing-header">
          <a className="app-brand" href="#/">
            <span className="app-brand__mark">Q</span>
            <span className="app-brand__name">{window.QTI18n ? window.QTI18n.brand() : 'ChartControl'}</span>
            <span className="app-brand__ver">v1.0</span>
          </a>
          {/*
             ★★ 이 링크들이 404 를 만들고 있었다.

               이 앱은 해시 라우터를 쓴다(`#/trade` → 경로 `trade`). 그래서
               `href="#features"` 는 앵커가 아니라 **경로 `features` 로 해석**되고,
               그런 라우트는 없으므로 세 개 모두 "404 · Not Found" 로 갔다.
               방문자가 가장 먼저 누르는 메뉴 세 개가 전부 막혀 있었던 것이다.

             ★ 대상 섹션은 같은 페이지에 실제로 있다(id="features"/"pricing"/
               "exchanges"). 그래서 라우트를 새로 만들 필요가 없고, 그 자리로
               스크롤해 주면 된다. 해시를 건드리지 않으므로 라우터와 충돌하지 않는다.

             ★ 로그인 여부로 막지 않는다. 이 세 개는 **가입을 결정하기 전에 보는
               소개·가격·지원 거래소**다. 여기서 가입 화면으로 보내면, 무엇을 사는지
               모르는 사람에게 먼저 계정을 만들라고 요구하는 셈이 된다. 오히려
               이탈이 늘고, 우리 수익은 가입이 아니라 그 뒤의 거래에서 나온다.
               (로그인한 사용자는 앱 안에 있으므로 이 헤더 자체를 보지 않는다)

             ★ scrollIntoView 만 쓰고 href 는 남긴다 — 새 탭으로 열거나 주소를
               복사하는 사용자를 막지 않기 위해서다.
          */}
          <nav className="landing-nav">
            {[
              { id: 'features', key: 'landing_nav_features' },
              { id: 'pricing', key: 'landing_nav_pricing' },
              { id: 'exchanges', key: 'landing_nav_exchanges' },
            ].map((item) => (
              <a
                key={item.id}
                href={`#/?section=${item.id}`}
                onClick={(e) => {
                  const el = document.getElementById(item.id);
                  if (!el) return;                 // 없으면 기본 동작에 맡긴다
                  e.preventDefault();
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {t(item.key)}
              </a>
            ))}
            <a href="design-system.html" target="_blank" rel="noopener noreferrer" /* qt-i18n-ignore: 개발자 문서 */>Design</a>
          </nav>
          <div style={{display:'inline-flex', gap: 6}}>
            <a className="btn btn--sm" href="#/login">{t('login_e225a6')}</a>
            <a className="btn btn--sm btn--primary" href="#/signup">{t('signup_ecb4cc')}</a>
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-hero__badge">
            <span className="dot dot--ai"/> AI-Native Trading Terminal
          </div>
          <h1 className="landing-hero__title">
            {t('auth_77edb5')}<br/>
            <span style={{color: 'var(--color-brand)'}}>{t('landing_4c1fc3')}</span>{t('landing_af3947')}
          </h1>
          <p className="landing-hero__body">
            {/*
               ★★ "8개 거래소" 가 문구에 박혀 있었다. 실제로 연결되는 거래소는
                 2개(KuCoin·BitMart)이고, 지금 노출되는 것은 그 중 협약이 끝난
                 것뿐이다. 첫 화면에서 지원 범위를 부풀리면 가입 후에 바로
                 드러난다 — 히어로 통계에는 이미 실제 개수가 나오고 있어서
                 같은 화면 안에서 숫자가 어긋나 보였다.
               ★ 조회 중(0개)에는 개수를 말하지 않는다.
            */}
            {t(landingExchanges.length > 0 ? 'landing_sub_counted' : 'landing_sub_plain',
               { n: landingExchanges.length })}<br/>
            {t('landing_66a662')}
          </p>
          <div style={{display: 'inline-flex', gap: 10, marginTop: 24}}>
            <a className="btn btn--primary btn--lg" href="#/signup">
              <I.Sparkles size={14}/> {t('landing_7bbd5b')}
            </a>
            {/*
               '데모 둘러보기' 버튼 — 지금은 숨긴다.

               ★★ 이 버튼은 `#/trade` 로 보냈다. 그런데 거래 화면은 로그인이
                 필요하므로, 비로그인 방문자가 누르면 **404("이 페이지를 보려면
                 로그인이 필요합니다")** 를 만난다. 처음 오는 사람에게 보여줄
                 화면이 아니다.

               ★ 지우지 않고 주석으로 남긴다. 나중에 로그인 없이 볼 수 있는
                 읽기 전용 데모를 만들면 그때 이 버튼을 되살린다.
                 (그때는 `#/trade` 가 아니라 데모 전용 경로로 보내야 한다)

               <a className="btn btn--lg" href="#/trade">
                 <I.Chart size={14}/> {t('landing_1ea899')}
               </a>
            */}
          </div>

          {/*
             히어로 통계.

             ★ 다섯 값 중 셋이 근거 없는 주장이었다:
                 '62% Signal Hit Rate'  — AI 신호 적중률을 집계하지 않는다
                 '2.6× Avg R:R'         — 평균 손익비를 집계하지 않는다
                 '99.98% Uptime'        — 가동률을 측정하지 않는다
               랜딩 페이지의 숫자는 가입 판단에 직접 쓰인다. 특히 적중률은
               "이 서비스를 쓰면 62% 맞는다" 로 읽히므로 가장 위험하다.

             '8 Exchanges' 도 사실이 아니다 — 거래는 KuCoin 하나만 지원한다.

             그래서 **실제로 셀 수 있는 것만** 남긴다. 거래쌍 수는 서버가 준다.
             비수탁·출금권한 미요구는 검증 가능한 사실이므로 그대로 쓴다.
          */}
          <div className="landing-hero-stats">
            <div>
              <strong>{landingPairs === null ? '—' : landingPairs.toLocaleString() + '+'}</strong>
              <span>{t('landing_stat_pairs')}</span>
            </div>
            {/*
               ★★ 거래소 수가 `1` 로 하드코딩돼 있었다. 바로 위 부제는 서버에서
                 받은 실제 개수(2곳)를 쓰는데 통계는 1 이어서, **같은 화면 안에서
                 숫자가 어긋났다.** 방문자가 어느 쪽을 믿어야 할지 알 수 없다.
               ★ 조회 중(0개)에는 '—' 로 둔다 — 0 이라고 쓰면 "지원 거래소가
                 없다" 로 읽힌다.
            */}
            <div>
              <strong>{landingExchanges.length > 0 ? landingExchanges.length : '—'}</strong>
              <span>{t('landing_stat_exchange')}</span>
            </div>
            <div><strong>0</strong><span>{t('landing_stat_custody')}</span></div>
            <div><strong>0</strong><span>{t('landing_stat_withdraw')}</span></div>
          </div>
        </section>

        <section id="features" className="landing-section">
          <div className="landing-section-title">{t('landing_why_brand')}</div>
          <div className="landing-feat-grid">
            {[
              { icon: 'Sparkles', title: 'AI-Native Workflow', body: t('landing_5f6b64') },
              { icon: 'Chart',    title: '24-column Custom Layout', body: t('landing_44cbb3') },
              { icon: 'Alert',    title: 'Safety by Design', body: t('landing_40f668') },
              { icon: 'Wallet',   title: '8+ Exchange Integration', body: 'Binance · Bitget · OKX · Bybit · BitMart · Gate · Kraken · Coinbase' },
              { icon: 'Book',     title: 'Trade Journal + AI Insights', body: t('landing_69704c') },
              { icon: 'Layers',   title: 'Institutional Design System', body: 'OKLCH tokens · 4 brand palettes · 3 densities · Dark/Light' },
            ].map((f, i) => {
              const Ic = I[f.icon] || I.Grid;
              return (
                <div key={i} className="landing-feat">
                  <div className="landing-feat__icon"><Ic size={18}/></div>
                  <div className="landing-feat__title">{f.title}</div>
                  <div className="landing-feat__body">{f.body}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section id="pricing" className="landing-section">
          <div className="landing-section-title">{t('landing_nav_pricing')}</div>
          <div className="landing-pricing">
            {[
              { name:'Beginner', price:'$0', period:t('landing_04b7df'), desc:t('landing_1351e7'), features:[t('landing_d3219e'), t('landing_9c7f54'), t('landing_724991'), t('landing_8466e2')], cta:t('landing_b8adca'), highlight:false },
              { name:'Pro', price:'$29', period:t('landing_04b7df'), desc:t('landing_74f8f5'), features:[t('landing_4f403f'), t('landing_6e9bb1'), t('landing_c3d5f3'), t('landing_bc5424'), t('landing_1a4272'), t('landing_91e9d6')], cta:t('landing_0077f3'), highlight:true },
              { name:'VIP', price:t('landing_0fc1ee'), period:'', desc:t('landing_b7f95d'), features:[t('landing_6587f1'), t('landing_860f96'), t('landing_633158'), t('landing_0af146')], cta:t('landing_531f6a'), highlight:false },
            ].map(p => (
              <div key={p.name} className={`landing-price-card ${p.highlight ? 'is-highlight' : ''}`}>
                {p.highlight && <div className="landing-price-card__badge">POPULAR</div>}
                <div className="landing-price-card__name">{p.name}</div>
                <div className="landing-price-card__desc">{p.desc}</div>
                <div className="landing-price-card__price"><strong>{p.price}</strong><span>{p.period}</span></div>
                <ul>{p.features.map(f => <li key={f}>✓ {f}</li>)}</ul>
                <a className={`btn ${p.highlight ? 'btn--primary' : ''}`} href="#/signup" style={{width: '100%'}}>{p.cta}</a>
              </div>
            ))}
          </div>
        </section>

        <section id="exchanges" className="landing-section">
          <div className="landing-section-title">{t('landing_exchanges_title')}</div>
          <div className="landing-exchanges">
            {landingExchanges.map(ex => (
              <div key={ex.id} className="landing-ex">
                <div className="landing-ex__logo" style={{background: ex.logoBg, color: ex.logoColor}}>{(window.exchangeLogo && window.exchangeLogo(ex.id, { size: 20 })) || ex.logoText}</div>
                <div className="landing-ex__name">{ex.name}</div>
                <div className="landing-ex__market">{ex.market}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="landing-foot">
          <div>© 2026 {window.QTI18n ? window.QTI18n.brand() : 'ChartControl'} · v1.0</div>
          {/*
             ★★ 모드를 고정 문구로 쓰지 않는다.

               전에는 'SIMULATION · No real funds · Prototype demo' 가 박혀 있었다.
               실주문이 열린 배포에서도 이 문구가 그대로 나오므로, 방문자는
               **자기 돈이 실제로 움직이지 않는다고 믿는다.** 위험을 축소하는
               방향으로 틀리는 문구는 가장 나쁘다.

             ★ 판정 기준은 앱 상단 배너와 같다(서버 설정의 liveOrdersEnabled +
               tradingMode). 두 곳이 다른 기준을 쓰면 화면 안에서 말이 어긋난다.
             ★ 설정을 아직 못 받았으면 단정하지 않는다.
          */}
          <div>{(() => {
            const cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
            const backend = !(window.QTLive && window.QTLive.isBackendPresent
              && window.QTLive.isBackendPresent() === false);
            if (!backend) return `${t('stripe_preview')} · ${t('stripe_preview_note')}`;
            if (!cfg) return `${t('stripe_checking')} · ${t('stripe_checking_note')}`;
            const liveOrders = Boolean(cfg.liveOrdersEnabled) && /LIVE/i.test(String(cfg.tradingMode || ''));
            return liveOrders
              ? `${t('stripe_live')} · ${t('stripe_live_note')}`
              : `${t('stripe_sim')} · ${t('stripe_sim_note')}`;
          })()}</div>
        </footer>
      </div>
    );
  };

  // ============================================================
  // NOT FOUND (404)
  // ============================================================
  window.NotFoundPage = function NotFoundPage({ shellProps, message }) {
    return (
      <window.AuthShell title={t('nf_title_attr')} subtitle={t('not_found_eeedd6')}>
        <div className="auth-form" style={{alignItems:'center', textAlign:'center'}}>
          <div style={{fontSize: 64, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-brand-subtle)'}}>404</div>
          <div style={{fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.7}}>
            {message || t('not_found_9acdbe')}<br/>
            {t('not_found_e62d56')}
          </div>
          <div style={{display:'flex', gap: 8, marginTop: 16}}>
            <a className="btn btn--primary" href="#/trade">{t('not_found_e87cf6')}</a>
            <a className="btn" href="#/markets">{t('not_found_7f5914')}</a>
            <a className="btn" href="#/portfolio">{t('not_found_d9477a')}</a>
          </div>
          <a href="#/" style={{fontSize: 12, color: 'var(--color-brand)', marginTop: 20}}>{t('not_found_1c767f')}</a>
        </div>
      </window.AuthShell>
    );
  };
})();
