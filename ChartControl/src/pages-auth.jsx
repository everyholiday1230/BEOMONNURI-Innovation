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

  /** 언어 변경 시 이 파일의 컴포넌트들이 재렌더되도록 하는 훅. */
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);

  // ============================================================
  // AUTH SHELL — reusable wrapper for auth pages
  // ============================================================
  window.AuthShell = function AuthShell({ title, subtitle, children, mode = 'auth', progress }) {
    return (
      <div className="auth-shell">
        {/* LEFT — form */}
        <div className="auth-shell__form">
          <a className="auth-shell__brand" href="#/">
            <span className="auth-shell__brand-mark">Q</span>
            <span>QuantumTrade</span>
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
            <div className="auth-foot-copy">© 2026 QuantumTrade AI · SIMULATION</div>
          </div>
        </div>

        {/* RIGHT — brand hero */}
        <div className="auth-shell__hero">
          <div className="auth-hero-bg"/>
          <div className="auth-hero-content">
            <div className="auth-hero-badge">Institutional AI Trading</div>
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
                { icon: 'Wallet',   title: t('auth_38d152'),       desc: 'Binance · Bitget · OKX · Bybit · …' },
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
              <div><strong>21+</strong><span>Pairs</span></div>
              <div><strong>8</strong><span>Exchanges</span></div>
              <div><strong>62%</strong><span>Signal Hit</span></div>
              <div><strong>2.6×</strong><span>Avg R:R</span></div>
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
              <span className="input-group__label"><I.User size={11}/> Email</span>
              <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required autoFocus/>
            </div>
            <div className="input-group">
              <span className="input-group__label"><I.Lock size={11}/> Password</span>
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
              <button type="button" className="btn" style={{flex:1}}>GitHub</button>
            </div>

            <div className="auth-row-center">
              {t('login_68a92d')} <a href="#/signup" style={{color:'var(--color-brand)', marginLeft: 4}}>{t('login_49f561')}</a>
            </div>

            <div className="auth-alert auth-alert--info" style={{marginTop: 16}}>
              <I.Info size={12}/>
              <div><strong>Demo:</strong> {t('login_13d6ae')}</div>
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
      window.QTApi.auth.register(form.email, form.pw, { country: form.country, marketingOptIn: form.marketing })
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
            <span className="input-group__label"><I.User size={11}/> Email</span>
            <input type="email" placeholder="you@example.com" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required autoFocus/>
          </div>

          <div className="input-group">
            <span className="input-group__label"><I.Lock size={11}/> Password</span>
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
            <span className="input-group__label"><I.Lock size={11}/> Confirm</span>
            <input type="password" placeholder={t('signup_711154')} value={form.pw2} onChange={e => setForm({...form, pw2: e.target.value})} required/>
          </div>

          <div className="input-group">
            <span className="input-group__label"><I.Globe size={11}/> Country</span>
            <select value={form.country} onChange={e => setForm({...form, country: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
              <option value="KR">{t('signup_b329a3')}</option>
              <option value="US">🇺🇸 United States</option>
              <option value="JP">🇯🇵 日本</option>
              <option value="SG">🇸🇬 Singapore</option>
              <option value="HK">🇭🇰 Hong Kong</option>
              <option value="GB">🇬🇧 United Kingdom</option>
              <option value="DE">🇩🇪 Deutschland</option>
              <option value="OTHER">{t('signup_44650a')}</option>
            </select>
          </div>

          {(errors.length > 0 || serverError) && (
            <div className="auth-alert auth-alert--danger">
              <I.Alert size={12}/>
              <div>{[...errors, serverError].filter(Boolean).join(' · ')}</div>
            </div>
          )}

          <label className="chk">
            <input type="checkbox" checked={form.agree} onChange={e => setForm({...form, agree: e.target.checked})} required/>
            <span className="chk__box"><I.Check size={10}/></span>
            <span style={{fontSize: 12}}>
              <a href="#/terms" style={{color:'var(--color-brand)'}}>{t('auth_3b9e30')}</a> · <a href="#/privacy" style={{color:'var(--color-brand)'}}>{t('signup_532136')}</a> {t('signup_75a112')}
            </span>
          </label>

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
                <div className="input-group"><span className="input-group__label">First Name</span><input value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})}/></div>
                <div className="input-group"><span className="input-group__label">Last Name</span><input value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})}/></div>
              </div>
              <div className="input-group"><span className="input-group__label">{t('k_y_c_onboarding_31fbff')}</span><input type="date" value={form.birth} onChange={e => setForm({...form, birth: e.target.value})}/></div>
              <div className="input-group">
                <span className="input-group__label">{t('k_y_c_onboarding_ff63ca')}</span>
                <select value={form.nationality} onChange={e => setForm({...form, nationality: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
                  <option value="KR">{t('signup_b329a3')}</option>
                  <option value="US">🇺🇸 United States</option>
                  <option value="JP">🇯🇵 日本</option>
                  <option value="OTHER">{t('signup_44650a')}</option>
                </select>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="auth-kyc-step-title">{t('k_y_c_onboarding_ebce71')}</div>
              <div className="input-group"><span className="input-group__label">Address</span><input placeholder={t('k_y_c_onboarding_dad291')} value={form.address} onChange={e => setForm({...form, address: e.target.value})}/></div>
              <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap: 10}}>
                <div className="input-group"><span className="input-group__label">City</span><input value={form.city} onChange={e => setForm({...form, city: e.target.value})}/></div>
                <div className="input-group"><span className="input-group__label">Postal</span><input value={form.postal} onChange={e => setForm({...form, postal: e.target.value})}/></div>
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
                <span className="input-group__label"><I.User size={11}/> Email</span>
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
    return (
      <div className="landing-shell">
        <div className="sim-stripe" style={{position:'relative'}}>
          <div className="sim-stripe__left">
            <span className="sim-stripe__badge">SIMULATION</span>
            <span>MOCK DATA · NO REAL FUNDS · PROTOTYPE DEMO</span>
          </div>
          <div className="sim-stripe__right">
            <span>SESSION · PUBLIC-DEMO</span>
          </div>
        </div>

        <header className="landing-header">
          <a className="app-brand" href="#/">
            <span className="app-brand__mark">Q</span>
            <span className="app-brand__name">QuantumTrade</span>
            <span className="app-brand__ver">v1.0</span>
          </a>
          <nav className="landing-nav">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#exchanges">Exchanges</a>
            <a href="design-system.html" target="_blank">Design</a>
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
            {t('landing_1ad875')}<br/>
            {t('landing_66a662')}
          </p>
          <div style={{display: 'inline-flex', gap: 10, marginTop: 24}}>
            <a className="btn btn--primary btn--lg" href="#/signup">
              <I.Sparkles size={14}/> {t('landing_7bbd5b')}
            </a>
            <a className="btn btn--lg" href="#/trade">
              <I.Chart size={14}/> {t('landing_1ea899')}
            </a>
          </div>

          <div className="landing-hero-stats">
            <div><strong>21+</strong><span>Trading Pairs</span></div>
            <div><strong>8</strong><span>Exchanges</span></div>
            <div><strong>62%</strong><span>Signal Hit Rate</span></div>
            <div><strong>2.6×</strong><span>Avg R:R</span></div>
            <div><strong>99.98%</strong><span>Uptime</span></div>
          </div>
        </section>

        <section id="features" className="landing-section">
          <div className="landing-section-title">Why QuantumTrade AI</div>
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
          <div className="landing-section-title">Pricing</div>
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
          <div className="landing-section-title">Supported Exchanges</div>
          <div className="landing-exchanges">
            {window.QTApp.EXCHANGES.map(ex => (
              <div key={ex.id} className="landing-ex">
                <div className="landing-ex__logo" style={{background: ex.logoBg, color: ex.logoColor}}>{ex.logoText}</div>
                <div className="landing-ex__name">{ex.name}</div>
                <div className="landing-ex__market">{ex.market}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="landing-foot">
          <div>© 2026 QuantumTrade AI · Institutional Cool · v1.0</div>
          <div>SIMULATION · No real funds · Prototype demo</div>
        </footer>
      </div>
    );
  };

  // ============================================================
  // NOT FOUND (404)
  // ============================================================
  window.NotFoundPage = function NotFoundPage({ shellProps, message }) {
    return (
      <window.AuthShell title="404 · Not Found" subtitle={t('not_found_eeedd6')}>
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
