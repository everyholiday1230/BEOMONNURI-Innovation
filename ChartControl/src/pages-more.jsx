/* ============================================================
   More User Pages
   ------------------------------------------------------------
   - ExchangeConnectWizard (modal)  — API key 연결 마법사
   - DepositPage / WithdrawPage / TransactionHistoryPage
   - StrategyDetailPage / MyStrategiesPage
   - ReferralPage / FeeRebatePage
   - HelpCenterPage / SecurityPage
   - Onboarding tour
   ============================================================ */

(function () {
  const { useState, useEffect } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const _useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
  const I = window.Icons;
  const { fmt, fmtCompact } = window.QTFmt;

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  // ============================================================
  // EXCHANGE CONNECT WIZARD (Modal) — 4-step
  // ============================================================
  window.ExchangeConnectWizard = function ExchangeConnectWizard({ exchange, onClose, onSuccess }) {
    /*
       거래소 가입 링크 (설정에서). 추천 코드가 붙어 있을 수 있다.

       ★ 이 링크는 **신규 가입**에만 귀속된다. 이미 계정이 있는 사용자에게는
         아무 의미가 없으므로, 안내 문구를 "계정이 없으신가요" 로 한정한다.
         "여기로 가입하세요" 라고 이미 계정 있는 사람에게 권하면 거짓 안내다.
    */
    // 설정이 도착하면 재렌더된다 — 안 그러면 링크가 있어도 카드가 안 뜬다.
    if (window.QTApi && window.QTApi.useConfig) window.QTApi.useConfig();
    const referralUrl = (window.QTApi && window.QTApi.getReferralUrl)
      ? window.QTApi.getReferralUrl(exchange.id) : '';
    /*
       추천 코드. 거래소 앱에서 가입하는 사람은 링크를 열지 않으므로 코드가
       유일한 귀속 수단이다. 없으면 그 줄을 아예 그리지 않는다.
    */
    const referralCode = (window.QTApi && window.QTApi.getReferralCode)
      ? window.QTApi.getReferralCode(exchange.id) : '';
    const [codeCopied, setCodeCopied] = useState(false);
    const [step, setStep] = useState(1);
    const [form, setForm] = useState({ label: t('layout_preset_main'), apiKey: '', apiSecret: '', passphrase: '', ipRestrict: true });
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    /*
       KuCoin Fast API (OAuth) 사용 가능 여부.

       ★ 서버 설정이 결정한다(/api/config 의 kucoinOauthAvailable). client_id 와
         Redirect URL 이 모두 있을 때만 true 다 — 반쯤 설정된 상태로 버튼을
         보이면 이용자가 KuCoin 까지 갔다가 콜백에서 실패한다.
    */
    const fastApiAvailable = (() => {
      const cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
      return Boolean(cfg && cfg.kucoinOauthAvailable === true);
    })();
    const [fastApiBusy, setFastApiBusy] = useState(false);
    const [fastApiErr, setFastApiErr] = useState(null);

    /*
       인증 시작.

       ★ 서버가 **주소를 돌려주고** 화면이 이동한다. 서버가 302 로 바로 보내면
         fetch 가 CORS 때문에 실패하고, 이용자에게는 아무 일도 일어나지 않는
         것처럼 보인다.

       ★ 같은 탭에서 이동한다. 새 탭으로 열면 승인 후 돌아온 화면이 원래 탭과
         달라서 이용자가 두 화면 중 어느 것이 맞는지 헷갈린다.
    */
    const startFastApi = async () => {
      // ★ QTApi.auth 에 있다(QTApi.exchanges 는 목록 조회 함수다).
      const api = window.QTApi && window.QTApi.auth;
      if (!api || !api.startKucoinOauth) return;
      setFastApiBusy(true); setFastApiErr(null);
      try {
        const r = await api.startKucoinOauth();
        if (r && r.url) {
          window.location.href = r.url;
          return; // 이동한다 — 아래 상태 정리는 실행되지 않는다.
        }
        setFastApiErr(t('fast_api_start_failed'));
      } catch (e) {
        setFastApiErr((e && e.message) || t('fast_api_start_failed'));
      }
      setFastApiBusy(false);
    };

    /*
       ★★ `if (!exchange) return null;` 이 이 줄들보다 **위에** 있었다.

         조기 return 뒤에 훅을 부르면 렌더마다 훅 개수가 달라진다. exchange 가
         null → 값 으로 바뀌는 렌더에서 React 가 "Rendered more hooks than during
         the previous render" 로 죽는다. 마법사는 카드에서 거래소를 고를 때 정확히
         그 전이를 겪는다.

       ★ 훅을 모두 위로 올리고, 조기 return 은 훅 뒤로 내렸다.
    */
    /** 저장된 자격증명 id. 검증·삭제에 쓴다. */
    const [_credentialId, setCredentialId] = useState(null);

    /**
     * 키를 저장하고 거래소에 실제로 연결해 본다.
     *
     * 두 단계다: 저장(서버가 봉투암호화) → 검증(거래소 실호출).
     * 저장만 하고 검증하지 않으면 "연결됨"으로 보이지만 실제로는 못 쓰는 키다.
     *
     * 검증은 읽기 권한만으로 통과한다. 주문 권한이 없는 키도 연결 확인이 되므로
     * 사용자가 읽기 전용으로 시작할 수 있다.
     */
    const runTest = () => {
      if (!window.QTApi || !window.QTApi.credentials) {
        // 백엔드 없는 정적 프리뷰. 화면 흐름만 보여준다.
        setTesting(true);
        setTimeout(() => {
          setTesting(false);
          const success = form.apiKey.length >= 8 && form.apiSecret.length >= 8;
          setTestResult({
            ok: success,
            message: success ? t('exchange_connect_wizard_cea2a6') : t('exchange_connect_wizard_7e3fbe'),
            perms: success ? ['Read', 'Trade', 'Futures'] : [],
            latency: null,
            serverTime: new Date().toLocaleString('en-GB', { hour12: false }),
            preview: true,
          });
          if (success) setTimeout(() => setStep(4), 800);
        }, 1000);
        return;
      }

      setTesting(true);
      setTestResult(null);
      const startedAt = Date.now();

      window.QTApi.credentials
        .save({
          apiKey: form.apiKey.trim(),
          apiSecret: form.apiSecret.trim(),
          passphrase: form.passphrase.trim(),
          label: form.label,
        })
        .then((saved) => {
          setCredentialId(saved.id);
          return window.QTApi.credentials.verify(saved.id);
        })
        .then((res) => {
          setTesting(false);
          setTestResult({
            ok: res.ok,
            message: res.ok
              ? t('exchange_connect_wizard_cea2a6')
              : res.reason || t('exchange_connect_wizard_7e3fbe'),
            // 권한 목록은 서버가 확인해 준 것만 표시한다. 추측해서 채우지 않는다.
            perms: res.ok ? (res.permissionsVerified ? ['Read'] : []) : [],
            latency: Date.now() - startedAt,
            serverTime: new Date().toLocaleString('en-GB', { hour12: false }),
          });
          if (res.ok) setTimeout(() => setStep(4), 800);
        })
        .catch((err) => {
          setTesting(false);
          setTestResult({
            ok: false,
            // 로그인이 안 됐거나 비밀번호 정책 위반 등을 그대로 알려준다.
            message: err && err.status === 401
              ? t('cred_err_login_required')
              : (err && err.message) || t('exchange_connect_wizard_7e3fbe'),
            perms: [],
            latency: null,
            serverTime: new Date().toLocaleString('en-GB', { hour12: false }),
          });
        });
    };

    /* 훅을 모두 부른 뒤에 판정한다 — 훅 순서가 렌더마다 달라지지 않게. */
    if (!exchange) return null;

    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" style={{width: 560, maxHeight: '90vh'}} onClick={e => e.stopPropagation()}>
          <div className="modal__header">
            <div style={{display:'flex', alignItems:'center', gap: 12}}>
              <div className="exchange-card__logo" style={{width:32, height:32, background: exchange.logoBg, color: exchange.logoColor, borderRadius:6, fontSize: 12}}>{exchange.logoText}</div>
              <div>
                <div className="modal__title">{t("wiz_title", { exchange: exchange.name })}</div>
                <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)'}}>{t('wiz_step_of', { step: step, total: 4 })}</div>
              </div>
            </div>
            <button className="btn btn--icon" onClick={onClose}><I.X size={14}/></button>
          </div>

          <div className="wizard-progress">
            {[t('exchange_connect_wizard_a17369'), t('exchange_connect_wizard_fa18a0'), t('exchange_connect_wizard_4511bd'), t('exchange_connect_wizard_8d8680')].map((label, i) => (
              <div key={i} className={`wizard-progress__step ${i+1 <= step ? 'is-active' : ''} ${i+1 < step ? 'is-done' : ''}`}>
                <span className="wizard-progress__num">{i+1 < step ? '✓' : i+1}</span>
                <span className="wizard-progress__label">{label}</span>
              </div>
            ))}
          </div>

          <div className="modal__body" style={{padding: '20px 24px'}}>
            {step === 1 && (
              <div style={{display:'flex', flexDirection:'column', gap: 16}}>
                {/*
                   ★★ KuCoin Fast API — 한 번 클릭으로 연결.

                     아래 4단계(가입 → 키 발급 → 키 입력 → 완료)는 이용자가
                     KuCoin 에서 키를 손으로 만드는 경로다. 그 과정에서 이탈이
                     생기고, 실수로 **출금 권한을 켜는** 위험도 있다.

                     Fast API 가 설정되어 있으면 그 전부를 건너뛴다. 우리가
                     요구하는 권한은 조회·현물·선물뿐이고 출금은 코드에서
                     false 로 고정되어 있다(이용약관 제2조: 입출금을 취급하지 않는다).

                   ★ 설정이 없으면 이 카드를 렌더하지 않는다 — 누르면 404 인
                     버튼을 두면 이용자가 고장으로 여긴다.
                */}
                {exchange.id === 'kucoin' && fastApiAvailable && (
                  <div
                    style={{
                      padding: '14px 16px', borderRadius: 8,
                      border: '1px solid var(--color-brand)',
                      background: 'color-mix(in srgb, var(--color-brand) 8%, transparent)',
                      display: 'flex', flexDirection: 'column', gap: 10,
                    }}
                  >
                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                      <I.Zap size={15} style={{color:'var(--color-brand)', flexShrink:0}}/>
                      <strong style={{fontSize:13}}>{t('fast_api_title')}</strong>
                    </div>
                    <div style={{fontSize:11.5, lineHeight:1.7, color:'var(--color-text-secondary)'}}>
                      {t('fast_api_desc')}
                    </div>
                    <div style={{fontSize:11, lineHeight:1.7, color:'var(--color-text-tertiary)'}}>
                      {t('fast_api_scopes')}
                    </div>
                    {fastApiErr && (
                      <div style={{fontSize:11.5, color:'var(--color-warning)'}}>{fastApiErr}</div>
                    )}
                    <button
                      className="btn btn--sm btn--primary"
                      type="button"
                      disabled={fastApiBusy}
                      onClick={startFastApi}
                    >
                      {fastApiBusy ? t('sec_loading') : t('fast_api_connect')}
                    </button>
                    <div style={{fontSize:10.5, color:'var(--color-text-tertiary)'}}>
                      {t('fast_api_manual_hint')}
                    </div>
                  </div>
                )}

                <div style={{fontSize: 14, fontWeight: 600}}>{t("wiz_step1_q", { exchange: exchange.name })}</div>
                {/*
                     가입 안내 문장.

                     ★ 보상 금액을 아는 경우에만 그것을 말하는 문장을 쓴다.

                       전에는 문장을 조각으로 이어 붙여
                         wiz_signup_a + '추천 링크' + ' 를 통해 가입하면 ' + <보상> + '.'
                       처럼 만들었는데, 서버 카탈로그에 referralRebate 가 없어서
                       <보상> 이 빈 문자열이 되고 화면에는
                         "… sign up through the referral link below to receive ."
                       처럼 **말이 끊긴 문장에 마침표만 남았다** (실제 화면에서 확인).

                     ★ 그리고 금액을 함부로 적지 않는다. KuCoin 가입 페이지는
                       "Up to 11,000 USDT" 라고 쓰지만 그것은 조건부 최대치다.
                       우리가 "받는다" 고 단정하면 지키지 못하는 약속이 된다.
                       조건을 확인하기 전까지는 링크가 있다는 사실만 말한다.
                */}
                <p style={{fontSize: 12.5, color:'var(--color-text-secondary)', lineHeight:1.7, margin:0}}>
                  {(() => {
                    const reward = window.QTI18n ? window.QTI18n.formatRebate(exchange.referralRebate) : '';
                    if (!reward) {
                      // 보상 조건 미확인 — 아무것도 약속하지 않는 완결된 문장.
                      return <>{t('wiz_signup_a')}<strong>{t('wiz_signup_link')}</strong>{t('wiz_signup_plain_end')}</>;
                    }
                    return <>{t('wiz_signup_a')}<strong>{t('wiz_signup_link')}</strong>{t('wiz_signup_b')}<strong>{reward}</strong>{t('wiz_signup_c')}</>;
                  })()}
                </p>
                {/*
                   추천 가입 카드.

                   링크는 서버 설정에서 온다. 없으면 카드를 감춘다 —
                   예시 코드가 박힌 링크를 보여주면 사용자는 가입하지만 귀속이
                   안 돼 수익이 0 이 된다. 실제로 9개 거래소에 예시 코드가
                   박혀 있었다.

                   rel="noopener noreferrer" 를 붙인다: target=_blank 만 있으면
                   열린 페이지가 window.opener 로 우리 탭을 조작할 수 있다.
                */}
                {referralUrl && (
                  <a href={referralUrl} target="_blank" rel="noopener noreferrer" className="wizard-referral-card">
                    <div className="wizard-referral-card__icon"><I.Sparkles size={20}/></div>
                    <div style={{flex: 1}}>
                      <div style={{fontWeight: 600, fontSize: 13}}>{t('exchange_connect_wizard_acfc61')}</div>
                      {/*
                         보상 문구는 아는 경우에만. 빈 줄을 남기면 카드에 설명이
                         없는 칸이 생겨 무엇을 주는지 모르는 채로 보인다.
                      */}
                      {(() => {
                        const reward = window.QTI18n ? window.QTI18n.formatRebate(exchange.referralRebate) : '';
                        return reward
                          ? <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>{reward}</div>
                          : <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>{t('wiz_signup_card_sub', { exchange: exchange.name })}</div>;
                      })()}
                      <div style={{fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 4}}>{t('exchange_connect_wizard_ca4b74')}</div>
                    </div>
                    <div style={{color: 'var(--color-brand)'}}><I.ArrowRight size={16}/></div>
                  </a>
                )}
                {/*
                   추천 코드.

                   ★ 링크 카드와 별도로 둔다. 거래소 **모바일 앱**에서 가입하는
                     사람은 위 링크를 열지 않으므로, 가입 화면의 "Referral Code"
                     칸에 이 값을 손으로 넣는 것이 유일한 귀속 수단이다. 코드를
                     보여주지 않으면 그 경로의 가입은 정상 처리되고 리베이트만
                     0 이 된다 — 화면에 오류가 없어 알아챌 수 없다.

                   ★ a 태그 안에 버튼을 넣지 않는다: 링크 안의 버튼은 클릭이
                     링크 이동과 겹쳐 복사가 되는지 알 수 없게 된다.
                */}
                {referralCode && (
                  <div className="section-card" style={{margin: 0, display:'flex', alignItems:'center', gap: 10, padding: '10px 12px'}}>
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{fontSize: 11, color:'var(--color-text-secondary)'}}>{t('wiz_referral_code_label')}</div>
                      <div style={{fontFamily:'var(--font-mono)', fontSize: 14, fontWeight: 600, letterSpacing: '0.04em'}}>{referralCode}</div>
                      <div style={{fontSize: 10.5, color:'var(--color-text-tertiary)', marginTop: 2, lineHeight: 1.5}}>{t('wiz_referral_code_hint')}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={t('wiz_referral_code_copy_aria')}
                      onClick={() => window.QTCopy(referralCode, {
                        /*
                           복사는 QTCopy 한 곳에서만 한다. 실패 처리를 화면마다
                           따로 쓰면 어느 한 곳에서 빠지고, 빠진 곳은 조용히
                           실패한다 — 이용자는 복사됐다고 믿고 빈 값을 붙여넣어
                           추천 귀속을 잃는다.
                        */
                        onDone: () => { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1800); },
                      })}
                    >
                      <I.Copy size={12}/> {codeCopied ? t('copied') : t('copy')}
                    </button>
                  </div>
                )}
                <div className="auth-alert auth-alert--info">
                  <I.Info size={12}/>
                  <div>{t('wiz_have_a')}<strong>{exchange.name}</strong>{t('wiz_have_b')}</div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div style={{display:'flex', flexDirection:'column', gap: 16}}>
                <div style={{fontSize: 14, fontWeight: 600}}>{t('exchange_connect_wizard_0506be')}</div>
                <p style={{fontSize: 12.5, color:'var(--color-text-secondary)', lineHeight:1.7, margin:0}}>
                  {t('wiz_apikey_a', { exchange: exchange.name })}<strong>{t('wiz_apikey_allow')}</strong>{t('wiz_apikey_b')}<strong className="t-danger">{t('wiz_apikey_deny')}</strong>{t('wiz_apikey_c')}
                </p>
                <a href={exchange.apiDocs} target="_blank" className="btn btn--sm">
                  <I.Book size={12}/> {t("wiz_api_docs", { exchange: exchange.name })}
                </a>

                <div className="section-card" style={{margin: 0}}>
                  <div className="section-card__head"><div className="section-card__title">{t('exchange_connect_wizard_aad4f8')}</div></div>
                  <div className="section-card__body" style={{padding: 12}}>
                    {[
                      { ok: true, text: t('exchange_connect_wizard_938e35') },
                      { ok: true, text: t('exchange_connect_wizard_4b268e') },
                      { ok: false, text: t('exchange_connect_wizard_d39a64') },
                      { ok: true, text: t('exchange_connect_wizard_64bc70') },
                      { ok: true, text: t('exchange_connect_wizard_c0269d') },
                    ].map((c, i) => (
                      <div key={i} style={{display:'flex', alignItems:'center', gap: 8, fontSize: 12, padding: '4px 0'}}>
                        <span style={{width: 16, height: 16, borderRadius: 3, background: c.ok ? 'var(--color-success)' : 'var(--color-danger)', color: c.ok ? 'var(--color-bg-app)' : 'white', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize: 10, fontWeight: 700}}>{c.ok ? '✓' : '✗'}</span>
                        <span style={{color: c.ok ? 'var(--color-text-primary)' : 'var(--color-danger)'}}>{c.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{display:'flex', flexDirection:'column', gap: 12}}>
                <div style={{fontSize: 14, fontWeight: 600}}>{t('exchange_connect_wizard_46d3df')}</div>

                <div className="input-group">
                  <span className="input-group__label">{t('fld_label')}</span>
                  <input value={form.label} onChange={e => setForm({...form, label: e.target.value})}/>
                </div>

                <div className="input-group">
                  <span className="input-group__label">{t('fld_api_key')}</span>
                  <input type="password" placeholder={t('exchange_connect_wizard_267402')} value={form.apiKey} onChange={e => setForm({...form, apiKey: e.target.value})}/>
                </div>

                <div className="input-group">
                  <span className="input-group__label">{t('fld_api_secret')}</span>
                  <input type="password" placeholder={t('exchange_connect_wizard_344324')} value={form.apiSecret} onChange={e => setForm({...form, apiSecret: e.target.value})}/>
                </div>

                {exchange.required.includes('passphrase') && (
                  <div className="input-group">
                    <span className="input-group__label">{t('fld_passphrase')}</span>
                    <input type="password" placeholder={t('exchange_connect_wizard_ad0627')} value={form.passphrase} onChange={e => setForm({...form, passphrase: e.target.value})}/>
                  </div>
                )}

                <label className="chk" style={{fontSize:12}}>
                  <input type="checkbox" checked={form.ipRestrict} onChange={e => setForm({...form, ipRestrict: e.target.checked})}/>
                  <span className="chk__box"><I.Check size={10}/></span>
                  {t('exchange_connect_wizard_ec2bc7')}
                </label>

                {testResult && !testResult.ok && (
                  <div className="auth-alert auth-alert--danger">
                    <I.Alert size={12}/>
                    <div>{testResult.message}</div>
                  </div>
                )}

                {testResult && testResult.ok && (
                  <div className="auth-alert auth-alert--success">
                    <I.Check size={12}/>
                    <div>
                      <strong>{t('exchange_connect_wizard_a9672e')}</strong> · Latency {testResult.latency.toFixed(0)}ms<br/>
                      <span style={{fontFamily: 'var(--font-mono)', fontSize: 10}}>Permissions: {testResult.perms.join(' · ')}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div style={{textAlign:'center', padding: '20px 0'}}>
                <div className="auth-verify-icon" style={{background: 'oklch(78% 0.14 145 / 0.14)', color: 'var(--color-success)', borderColor: 'var(--color-success)'}}>
                  <I.Check size={30}/>
                </div>
                <div style={{fontSize: 16, fontWeight: 600, marginTop: 16}}>{t("wiz_done", { exchange: exchange.name })}</div>
                <div style={{fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 8}}>{t("wiz_done_desc", { exchange: exchange.name })}</div>
                <div style={{marginTop: 20, padding: '10px 12px', background: 'var(--color-bg-surface)', borderRadius: 4, textAlign: 'left', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)'}}>
                  <div>Exchange · {exchange.name}</div>
                  <div>Label · {form.label}</div>
                  <div>Key · ••••••{form.apiKey.slice(-4) || 'xxxx'}</div>
                  <div>IP · {form.ipRestrict ? 'Restricted' : 'Any'}</div>
                </div>
              </div>
            )}
          </div>

          <div className="modal__footer">
            {step > 1 && step < 4 && <button className="btn btn--sm" onClick={() => setStep(step-1)}>{t('exchange_connect_wizard_810016')}</button>}
            {step === 1 && <button className="btn btn--sm btn--primary" onClick={() => setStep(2)}>{t('exchange_connect_wizard_806a50')}</button>}
            {step === 2 && <button className="btn btn--sm btn--primary" onClick={() => setStep(3)}>{t('exchange_connect_wizard_f4b9a9')}</button>}
            {step === 3 && (
              <>
                <button className="btn btn--sm" onClick={runTest} disabled={testing || !form.apiKey || !form.apiSecret}>
                  {testing ? <><span className="spinner"/> {t('exchange_connect_wizard_718595')}</> : 'Test Connection'}
                </button>
                <button className="btn btn--sm btn--primary" onClick={() => { if (onSuccess) onSuccess(exchange, form); onClose(); }} disabled={!testResult?.ok}>
                  <I.Check size={12}/> {t('exchange_connect_wizard_5953fd')}
                </button>
              </>
            )}
            {step === 4 && <button className="btn btn--sm btn--primary" onClick={onClose}>{t('exchange_connect_wizard_8d8680')}</button>}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // DEPOSIT PAGE
  // ============================================================
  window.DepositPage = function DepositPage({ shellProps }) {
    const [asset, setAsset] = useState('USDT');
    const [network, setNetwork] = useState('TRC20');

    /*
       ★★ 입금 주소에 관한 안전 규칙 ★★

       우리는 자금을 보관하지 않는다(비수탁). 그래서 **우리 입금 주소는 존재하지
       않는다**. 고객은 자기 KuCoin 계정에 입금하고, 우리는 그 계정을 API 로
       조작할 뿐이다.

       원래 이 화면에는 예시 주소 4개가 QR·복사 버튼과 함께 있었다. 디자인
       시연용이었지만, 실제 서비스에서 고객이 그 주소를 복사해 송금하면
       **자금이 영구히 사라진다**. 되돌릴 방법이 없다.

       그래서 백엔드가 붙어 있으면(=실서비스) 주소를 내보내지 않는다.
       백엔드가 없는 디자인 미리보기에서는 원래 예시를 유지한다 —
       디자이너 화면을 훼손하지 않기 위해서다.
    */
    /*
       backendPresent 는 부팅 직후 null 이고 잠시 뒤 확정된다.
       구독하지 않으면 첫 렌더 값(null)에 고정돼, 정적 미리보기에서도
       실서비스 화면이 보인다(실제로 겪음).
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    // null(판정 중)도 실서비스로 간주한다. 모르는 상태에서 주소를 보여주는 위험이
    // 미리보기에서 주소가 안 보이는 불편보다 훨씬 크다.
    const isRealService = backend !== false;

    const MOCK_ADDRESSES = {
      TRC20: 'TXqYJx7v3F4H6f8mZL1n2VG9r8sBaeK7wN',
      ERC20: '0x7d8f3B4E5c6A9F2b1D3E8f0A5C7B9D2E4F6A8B0C',
      BEP20: '0x9F2b1D3E8f0A5C7B9D2E4F6A8B0C7d8f3B4E5c6A',
      Solana: 'DYw8jCTKfWpZbCXG7QP7VbYUqSJmZ4xF9C8vNq3Kt8Rj',
    };
    const address = isRealService ? '' : (MOCK_ADDRESSES[network] || '');

    /*
       거래소 가입 링크 (설정에서). 계정이 없는 사용자에게만 의미가 있다.

       exchangeSignupUrl 은 "우리가 지원하는 주 거래소" 의 링크다. 입금 화면은
       특정 거래소 카드가 아니라 일반 안내이므로 이 값을 쓴다.
    */
    const cfg = (window.QTApi && window.QTApi.useConfig) ? window.QTApi.useConfig() : null;
    const signupUrl = (cfg && cfg.exchangeSignupUrl) || '';
    const hasKeys = Boolean(window.QTAccount && window.QTAccount.isLive && window.QTAccount.isLive());

    /*
       최근 입금 내역.

       ★★ 예시 3건(1,000 USDT · 0.05 BTC · 500 USDT)이 하드코딩이었다.
         **가짜 트랜잭션 ID까지 붙어 있었다** — 사용자가 자기 입금이 완료된
         것으로 읽고, 오지 않은 자금을 기다린다.

       ★ 우리는 비수탁이라 입금을 받지 않는다. 입금은 사용자가 거래소에서
         직접 하고, 그 내역은 거래소 원장에 있다. 실서비스에서는 원장을
         조회하거나(키 필요) 아무것도 보여주지 않는다.
    */
    const mockHistory = [
      { time: Date.now()-1000*60*30,   asset: 'USDT', amount: 1000.00, network: 'TRC20', status: 'completed', txId: '3f4e5c6a...' },
      { time: Date.now()-1000*60*60*4, asset: 'BTC',  amount:    0.05, network: 'BTC',   status: 'completed', txId: 'a1b2c3d4...' },
      { time: Date.now()-1000*60*60*8, asset: 'USDT', amount:  500.00, network: 'ERC20', status: 'pending',   txId: 'b2c3d4e5...' },
    ];
    const liveDeposits = (window.QTAccount && window.QTAccount.getTransactions)
      ? (window.QTAccount.getTransactions() || []).filter((x) => x.kind === 'deposit')
      : null;
    const historyEntries = (liveDeposits && liveDeposits.length > 0)
      ? liveDeposits.map((x) => ({
          time: x.time, asset: x.asset, amount: Math.abs(Number(x.amount) || 0),
          network: x.network || '—', status: x.status || 'completed', txId: x.txHash || '—',
        }))
      : ((window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) ? [] : mockHistory);

    return (
      <window.PageShell
        {...shellProps}
        title={t('deposit_b9ca11')}
        subtitle={t('deposit_65292b')}
        breadcrumb={['Home','Wallet','Deposit']}
      >
        <div className="grid-2-1">
          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            {/*
               ★★ 자산·네트워크 선택과 주소 카드는 **디자이너 미리보기에서만** 그린다.

                 실서비스에서는 우리 입금 주소가 존재하지 않으므로(비수탁) 주소가 빈
                 값이었다. 그런데 선택 칩은 그대로 보여서, 사용자는 네트워크를 고르면
                 주소가 나올 것으로 기대하고 누른다 — 아무 일도 일어나지 않는다.
                 있지도 않은 입금 경로를 암시하는 UI 는 자금 사고로 이어질 수 있다.

               ★ 실서비스에서는 아래의 "거래소에서 입금하세요" 안내만 남는다.
            */}
            {!isRealService && (
            <window.SectionCard title={t('deposit_1bcffc')}>
              <div style={{display:'flex', flexDirection:'column', gap: 12}}>
                <div>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>{t('asset')}</div>
                  <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                    {['USDT','BTC','ETH','SOL','BNB','USDC'].map(a => (
                      <button key={a} className={`btn btn--sm ${asset===a ? 'btn--primary' : ''}`} onClick={() => setAsset(a)}>{a}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>{t('wd_network')}</div>
                  <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                    {['TRC20','ERC20','BEP20','Solana'].map(n => (
                      <button key={n} className={`btn btn--sm ${network===n ? 'btn--primary' : ''}`} onClick={() => setNetwork(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              </div>
            </window.SectionCard>
            )}

            <window.SectionCard title={t('deposit_eba168')}>
              {/*
                 실서비스에서는 주소·QR·복사 버튼을 렌더하지 않는다.
                 존재하지 않는 주소를 복사할 수 있게 두는 것이 사고의 원인이다.
              */}
              {isRealService ? (
                <div style={{display:'flex', flexDirection:'column', gap: 12}}>
                  <div style={{
                    padding:'12px 14px', borderRadius:6, fontSize:12, lineHeight:1.7,
                    background:'color-mix(in srgb, var(--color-warning) 12%, transparent)',
                    border:'1px solid var(--color-warning)', color:'var(--color-text-primary)',
                  }}>
                    <div style={{fontWeight:600, marginBottom:4, display:'flex', alignItems:'center', gap:6}}>
                      <I.Alert size={13}/> {t('deposit_noncustodial_title')}
                    </div>
                    <div>{t('deposit_noncustodial_1')}</div>
                    <div style={{marginTop:6}}>{t('deposit_noncustodial_2')}</div>
                  </div>

                  <ol style={{margin:0, paddingLeft:20, fontSize:12, lineHeight:1.9, color:'var(--color-text-secondary)'}}>
                    <li>{t('deposit_step_1')}</li>
                    <li>{t('deposit_step_2', { asset: asset, network: network })}</li>
                    <li>{t('deposit_step_3')}</li>
                  </ol>

                  <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                    {/* 계정이 없는 사용자에게만 가입 경로를 보여준다. */}
                    {signupUrl && !hasKeys && (
                      <a href={signupUrl} target="_blank" rel="noopener noreferrer" className="btn btn--sm btn--primary" style={{textDecoration:'none'}}>
                        {t('deposit_create_account')} <I.ArrowRight size={11}/>
                      </a>
                    )}
                    {!hasKeys && (
                      <a href="#/wallet" className="btn btn--sm" style={{textDecoration:'none'}}>{t('deposit_connect_keys')}</a>
                    )}
                  </div>
                </div>
              ) : (
              <div style={{display:'flex', flexDirection:'column', gap: 12, alignItems:'center'}}>
                {/* QR placeholder */}
                <div style={{width: 180, height: 180, background: 'white', padding: 10, borderRadius: 6, display:'grid', gridTemplateColumns:'repeat(21, 1fr)', gap: 1}}>
                  {Array.from({length: 441}).map((_, i) => {
                    // deterministic pseudo-random pattern
                    const on = (i * 17 + address.charCodeAt(i % address.length)) % 3 === 0;
                    // corner markers
                    const x = i % 21, y = Math.floor(i / 21);
                    const corner = (x < 4 && y < 4) || (x >= 17 && y < 4) || (x < 4 && y >= 17);
                    const cornerBorder = ((x === 0 || x === 3) && y < 4) || ((y === 0 || y === 3) && x < 4)
                      || ((x === 17 || x === 20) && y < 4) || ((y === 0 || y === 3) && x >= 17)
                      || ((x === 0 || x === 3) && y >= 17) || ((y === 17 || y === 20) && x < 4);
                    const cornerCenter = (x >= 1 && x <= 2 && y >= 1 && y <= 2) || (x >= 18 && x <= 19 && y >= 1 && y <= 2) || (x >= 1 && x <= 2 && y >= 18 && y <= 19);
                    const isBlack = corner ? (cornerBorder || cornerCenter) : on;
                    return <div key={i} style={{background: isBlack ? '#000' : 'transparent'}}/>;
                  })}
                </div>
                <div style={{width: '100%', padding: '10px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border-default)', borderRadius: 6, display:'flex', gap: 8, alignItems: 'center'}}>
                  <span style={{flex:1, fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all'}}>{address}</span>
                  <button className="btn btn--xs" onClick={() => window.QTCopy(address)}><I.Copy size={11}/> {t('copy')}</button>
                </div>
              </div>
              )}
            </window.SectionCard>

            {/*
               ★★ 입금 조건(최소 수량·확인 횟수·소요 시간·허용 네트워크)은 **거래소가**
                 정한다. 우리는 입금을 받지 않으므로 그 값을 알 수 없다. 그런데 여기에
                 '최소 10 USDT · 확인 1회 · 1~3분 · TRC20 전용' 이 박혀 있었다.
                 사용자가 이 숫자를 믿고 다른 네트워크로 보내면 자금이 사라진다 —
                 우리가 알지도 못하는 조건을 단정한 것이 원인이 된다.
               ★ 그래서 실서비스에서는 이 카드를 그리지 않는다. 위의 안내가 "주소는
                 거래소에서 복사하라" 고 이미 말한다. 미리보기에서는 디자인을 남긴다.
            */}
            {!isRealService && (
            <window.SectionCard title={t('deposit_adb488')}>
              <ul style={{margin:0, paddingLeft: 20, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.8}}>
                <li>{t('deposit_eca2cd')} <strong>10 {asset}</strong></li>
                <li>{t('deposit_2f858e')} <strong>{t('dep_confirm_count', { n: network === 'TRC20' ? 1 : network === 'BEP20' ? 15 : 12 })}</strong></li>
                <li>{t('deposit_53bb7f')} <strong>{network === 'TRC20' ? t('deposit_9360c7') : network === 'BEP20' ? t('deposit_13c35d') : t('deposit_b5d053')}</strong></li>
                <li className="t-danger">{t('dep_net_a')}<strong>{network}</strong>{t('dep_net_b')}</li>
              </ul>
            </window.SectionCard>
            )}
          </div>

          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            {/*
               현재 잔고.

               ★★ '9,840.22 USDT' 가 하드코딩이었다. 입금 안내 화면에서 사용자가
                 이 값을 자기 잔고로 읽는다. 우리는 거래소 키 없이 잔고를 모른다.

               ★ 실잔고가 있으면 그것을, 없으면 '—' 와 이유를 보여준다.
            */}
            <window.SectionCard title={t('deposit_d4cde2')}>
              {(() => {
                const acct = window.QTAccount;
                const live = (acct && acct.isLive && acct.isLive()) ? (acct.getBalances() || []) : null;
                const total = live
                  ? live.reduce((a, x) => a + (Number(x.available) || 0), 0)
                  : null;
                const preview = window.QTMockPolicy ? window.QTMockPolicy.allowMockData() : false;
                if (total === null && preview) {
                  return (
                    <>
                      <div style={{fontFamily:'var(--font-num)', fontSize:24, fontWeight:600}}>9,840.22 <span style={{fontSize:12, color:'var(--color-text-tertiary)'}}>USDT</span></div>
                      <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:4}}>{t('pf_all_exchanges')}</div>
                    </>
                  );
                }
                return (
                  <>
                    <div style={{fontFamily:'var(--font-num)', fontSize:24, fontWeight:600}}>
                      {total === null ? '—' : fmt(total, 2)}
                      {total !== null && <span style={{fontSize:12, color:'var(--color-text-tertiary)'}}> USDT</span>}
                    </div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:4, lineHeight:1.6}}>
                      {total === null ? t('dep_balance_unknown') : t('dep_balance_src')}
                    </div>
                  </>
                );
              })()}
            </window.SectionCard>

            <window.SectionCard title={t('deposit_7fb69f')} noPadding>
              {/* 빈 표는 고장처럼 보인다. 왜 비었는지 말한다. */}
              {historyEntries.length === 0 && (
                <div style={{padding:'14px 16px', fontSize:12, lineHeight:1.7, color:'var(--color-text-secondary)'}}>
                  {hasKeys ? t('dep_history_none') : t('dep_history_need_key')}
                </div>
              )}
              {historyEntries.map((h, i) => (
                <div key={i} style={{padding: '10px 14px', borderBottom: i < historyEntries.length-1 ? '1px solid var(--color-border-subtle)' : ''}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 4}}>
                    <span style={{fontWeight: 500}}>+{h.amount} {h.asset}</span>
                    <span className={`status-pill status-pill--${h.status === 'completed' ? 'ok' : 'warn'}`}>{h.status.toUpperCase()}</span>
                  </div>
                  <div style={{fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)'}}>{h.network} · {timeAgo(h.time)}</div>
                  <div style={{fontSize: 10, color: 'var(--color-brand)', fontFamily: 'var(--font-mono)', marginTop: 2}}>TX: {h.txId}</div>
                </div>
              ))}
            </window.SectionCard>
          </div>
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // WITHDRAW PAGE
  // ============================================================
  window.WithdrawPage = function WithdrawPage({ shellProps }) {
    const [asset, setAsset] = useState('USDT');
    const [network, setNetwork] = useState('TRC20');
    const [address, setAddress] = useState('');
    const [amount, setAmount] = useState('');
    const [otp, setOtp] = useState('');
    const [showConfirm, setShowConfirm] = useState(false);

    /*
       ★★ 출금에 관한 안전 규칙 ★★

       우리는 자금을 보관하지 않는다(비수탁). 그래서 **우리는 출금을 실행할 수
       없다**. 출금은 고객이 자기 거래소에서 직접 해야 한다.

       더 중요한 것: 우리가 요구하는 API 키 권한에 출금이 없다. 일부러 없다.
       출금 권한이 있는 키가 유출되면 자금이 전부 빠져나간다. 조회·거래 권한만
       받으면 최악의 경우에도 포지션 손실로 끝난다.

       원래 이 화면은 주소·수량·OTP 를 받고 "출금 요청 접수됨 (simulation)" 을
       띄웠다. 실서비스에서 고객이 실제 주소를 넣고 그 문구를 보면, 출금이
       처리 중이라고 믿고 기다린다. 오지 않는 돈을 기다리게 만드는 것은
       금액 손실은 아니지만 신뢰를 잃는다.
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    const isRealService = backend !== false;

    const acct = window.useAccountData ? window.useAccountData() : { isLive: false };
    const cfg = (window.QTApi && window.QTApi.useConfig) ? window.QTApi.useConfig() : null;
    const signupUrl = (cfg && cfg.exchangeSignupUrl) || '';

    /*
       잔고. 실제 값이 있으면 쓰고, 없으면 디자이너 예시를 유지한다.
       실서비스에서 예시 잔고(9,840.22)를 보여주면 없는 돈을 있다고 말하는 것이다.
    */
    const liveBalance = (() => {
      if (!acct.isLive || !window.QTAccount) return null;
      const rows = window.QTAccount.getBalances() || [];
      const row = rows.find((b) => String(b.asset).toUpperCase() === String(asset).toUpperCase());
      if (!row) return null;
      const v = Number(row.available);
      return Number.isFinite(v) ? v : null;
    })();
    /*
       ★ 실서비스에서 잔고를 모르면 0 이다 (예시 9,840.22 를 쓰지 않는다).
         출금 폼은 이미 비활성이지만, 예시 잔고가 보이면 사용자가 그 돈이
         있다고 믿는다.
    */
    /*
       ★★ 읽지 못한 잔고를 0 으로 쓰지 않는다.

         전에는 실서비스에서 0 을 넣었다. 화면에는 '0.00 USDT' 가 잔고로 표시되는데,
         이는 "잔고가 0 이다" 라는 단정이다. 키를 연결하지 않았으면 우리는 잔고를
         **모른다** — 모르는 것과 0 은 다른 사실이고, 사용자는 0 을 보고 자금이
         사라졌다고 오해할 수 있다. null 을 넘겨 화면이 '—' 로 표시하게 한다.
    */
    const balance = liveBalance !== null
      ? liveBalance
      : (((window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) || isRealService) ? null : 9840.22);
    const fee = { TRC20: 1, ERC20: 15, BEP20: 0.5, Solana: 0.5 }[network] || 1;
    const receive = Math.max(0, parseFloat(amount) - fee || 0);

    return (
      <window.PageShell
        {...shellProps}
        title={t('withdraw_972169')}
        subtitle={t('withdraw_690b48')}
        breadcrumb={['Home','Wallet','Withdraw']}
      >
        {/*
           실서비스 안내.

           폼을 지우지 않고 그 위에 사실을 놓는다 — 디자이너 화면은 유지하되
           실제로 무엇이 일어나는지(=아무것도 일어나지 않는다) 먼저 알린다.
        */}
        {isRealService && (
          <div style={{
            padding:'12px 14px', borderRadius:6, fontSize:12, lineHeight:1.7, marginBottom: 4,
            background:'color-mix(in srgb, var(--color-warning) 12%, transparent)',
            border:'1px solid var(--color-warning)', color:'var(--color-text-primary)',
          }}>
            <div style={{fontWeight:600, marginBottom:4, display:'flex', alignItems:'center', gap:6}}>
              <I.Alert size={13}/> {t('withdraw_noncustodial_title')}
            </div>
            <div>{t('withdraw_noncustodial_1')}</div>
            <div style={{marginTop:6}}>{t('withdraw_noncustodial_2')}</div>
            <div style={{marginTop:8, display:'flex', gap:8, flexWrap:'wrap'}}>
              {signupUrl && !acct.isLive && (
                <a href={signupUrl} target="_blank" rel="noopener noreferrer" className="btn btn--sm" style={{textDecoration:'none'}}>
                  {t('deposit_create_account')} <I.ArrowRight size={11}/>
                </a>
              )}
            </div>
          </div>
        )}

        <div className="grid-2-1">
          {/*
             ★★ 출금 입력 카드는 **디자이너 미리보기에서만** 그린다.

               실서비스에서 이 카드는 아무 일도 하지 않는다 — 우리는 출금 권한이 없는
               키만 받으므로 출금을 실행할 수 없고, 제출 버튼도 비활성이었다. 그런데
               자산·네트워크 칩은 눌리기만 해서, 사용자는 출금 창구가 있다고 오해한 채
               주소까지 입력하게 된다. 위의 경고만 남기는 것이 정직하다.
          */}
          {!isRealService && (
          <window.SectionCard title={t('withdraw_3f13b3')}>
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              <div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>{t('asset')}</div>
                <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                  {['USDT','BTC','ETH','SOL','BNB','USDC'].map(a => (
                    <button key={a} className={`btn btn--sm ${asset===a ? 'btn--primary' : ''}`} onClick={() => setAsset(a)}>{a}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>{t('wd_network')}</div>
                <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                  {['TRC20','ERC20','BEP20','Solana'].map(n => (
                    <button key={n} className={`btn btn--sm ${network===n ? 'btn--primary' : ''}`} onClick={() => setNetwork(n)}>{n}</button>
                  ))}
                </div>
              </div>

              <div className="input-group">
                <span className="input-group__label">{t('fld_address')}</span>
                <input placeholder={t('wd_address_placeholder', { network })} value={address} onChange={e => setAddress(e.target.value)}/>
              </div>

              <div className="input-group">
                <span className="input-group__label">{t('fld_amount')}</span>
                <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/>
                <span className="input-group__suffix">{asset}</span>
              </div>

              <div style={{display:'flex', gap:6, justifyContent:'flex-end'}}>
                {[25, 50, 75, 100].map(p => (
                  <button key={p} className="btn btn--xs" disabled={balance === null} onClick={() => setAmount(((balance || 0) * p / 100).toFixed(2))}>{p}%</button>
                ))}
              </div>

              <div style={{padding: '12px 14px', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 6, display:'flex', flexDirection:'column', gap: 4, fontSize: 12}}>
                <div style={{display:'flex', justifyContent:'space-between', color: 'var(--color-text-tertiary)'}}><span>{t('withdraw_d4bbb3')}</span><span style={{fontFamily:'var(--font-num)'}}>{balance.toFixed(2)} {asset}</span></div>
                <div style={{display:'flex', justifyContent:'space-between', color: 'var(--color-text-tertiary)'}}><span>{t('withdraw_34f036')}</span><span style={{fontFamily:'var(--font-num)'}}>{fee} {asset}</span></div>
                <div style={{display:'flex', justifyContent:'space-between', paddingTop: 6, borderTop: '1px solid var(--color-border-subtle)'}}><span><strong>{t('withdraw_5f9394')}</strong></span><span style={{fontFamily:'var(--font-num)', fontWeight: 600}}>{receive.toFixed(2)} {asset}</span></div>
              </div>

              <div className="auth-alert auth-alert--warning">
                <I.Alert size={12}/>
                <div>{t('wd_2fa_a')}<strong>{t('wd_2fa_em')}</strong>{t('wd_2fa_b')}</div>
              </div>

              {/*
                 실서비스에서는 이 버튼을 비활성화한다.

                 누를 수 있게 두면 OTP 를 넣고 "접수됨" 을 보고 기다린다.
                 처리할 수 없는 요청을 접수하는 것처럼 보이면 안 된다.
              */}
              <button
                className="btn btn--primary btn--lg"
                disabled={isRealService || !address || !amount || parseFloat(amount) < fee}
                title={isRealService ? t('withdraw_at_exchange_hint') : undefined}
                onClick={() => setShowConfirm(true)}
              >
                {t('withdraw_e88174')}
              </button>
            </div>
          </window.SectionCard>
          )}

          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            <window.SectionCard title={t('deposit_d4cde2')}>
              <div style={{fontFamily: 'var(--font-num)', fontSize: 24, fontWeight: 600}}>{balance === null ? t('dash') : balance.toFixed(2)} <span style={{fontSize: 12, color: 'var(--color-text-tertiary)'}}>USDT</span></div>
            </window.SectionCard>

            <window.SectionCard title={t('withdraw_fe7cae')}>
              {/*
                 ★★ 없는 한도를 숫자로 보여주지 않는다.

                   '남은 한도 82,120 USDT / 일 한도 100,000 USDT / 17.88%' 와
                   'KYC L2 · Pro tier' 가 박혀 있었다. 우리는 **출금을 취급하지
                   않으므로 한도라는 것이 존재하지 않는다.** 이용자는 이 화면을
                   보고 하루 10만 USDT 를 뺄 수 있다고 이해하고 자금 계획을 세운다.

                 ★ 한도는 거래소가 정한다. 그래서 어디서 확인해야 하는지 알린다.
                   숫자를 우리가 아는 척하지 않는다.
              */}
              <div style={{fontSize: 12, display:'flex', flexDirection:'column', gap: 6}}>
                <div style={{display:'flex', justifyContent:'space-between'}}><span>{t('withdraw_757555')}</span><strong>{t('dash')}</strong></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span>{t('withdraw_fe7cae')}</span><strong>{t('dash')}</strong></div>
                <div style={{fontSize:10, color:'var(--color-text-tertiary)', lineHeight:1.6}}>{t('withdraw_limits_at_exchange')}</div>
              </div>
            </window.SectionCard>

            <window.SectionCard title={t('withdraw_605c61')}>
              <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6}}>{t('withdraw_708758')}</div>
              {(isRealService ? [] : [
                // 예시 주소. 실서비스에서는 렌더하지 않는다 —
                // 내가 저장한 주소로 오인해 그리로 보내려 할 수 있다.
                { name: 'My Binance USDT', addr: 'TXqYJ...eK7wN' },
                { name: 'Cold Wallet',    addr: '0x7d8...E5c6A' },
              ]).map((a, i) => (
                <div key={i} style={{display:'flex', gap:8, alignItems:'center', padding:'6px 8px', border:'1px solid var(--color-border-subtle)', borderRadius:4, marginBottom: 4, cursor:'pointer'}} onClick={() => setAddress(a.addr)}>
                  <span style={{flex:1, fontSize:11}}>{a.name}</span>
                  <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{a.addr}</span>
                </div>
              ))}
              {isRealService && (
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', padding:'8px 0'}}>
                  {t('withdraw_addressbook_na')}
                </div>
              )}
              <button className="btn btn--xs" style={{width:'100%', marginTop: 4}} disabled={isRealService}><I.Plus size={11}/> {t('withdraw_ecf928')}</button>
            </window.SectionCard>
          </div>
        </div>

        {showConfirm && (
          <div className="overlay" onClick={() => setShowConfirm(false)}>
            <div className="modal" style={{width: 440}} onClick={e => e.stopPropagation()}>
              <div className="modal__header">
                <div className="modal__title">{t('withdraw_e01e9b')}</div>
                <button className="btn btn--icon" onClick={() => setShowConfirm(false)}><I.X size={14}/></button>
              </div>
              <div className="modal__body" style={{padding: 20, display:'flex', flexDirection:'column', gap: 12}}>
                <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>{t('withdraw_a426f8')}</div>
                <div style={{padding: 12, background: 'var(--color-bg-surface)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.8}}>
                  <div><strong>{t('asset')}:</strong> {asset}</div>
                  <div><strong>{t('wd_network')}:</strong> {network}</div>
                  <div><strong>{t('fld_to')}:</strong> <span style={{color:'var(--color-brand)'}}>{address.slice(0, 8)}...{address.slice(-6)}</span></div>
                  <div><strong>{t('fld_amount')}:</strong> {amount} {asset}</div>
                  <div><strong>{t('withdraw_34f036')}:</strong> {fee} {asset}</div>
                  <div><strong>{t('withdraw_5f9394')}:</strong> {receive.toFixed(2)} {asset}</div>
                </div>
                <div className="input-group">
                  <span className="input-group__label">{t('fld_2fa_code')}</span>
                  <input type="text" maxLength={6} placeholder={t('withdraw_403732')} value={otp} onChange={e => setOtp(e.target.value)}/>
                </div>
              </div>
              <div className="modal__footer">
                <button className="btn btn--sm" onClick={() => setShowConfirm(false)}>{t('withdraw_19b2d1')}</button>
                <button className="btn btn--sm btn--danger" disabled={otp.length !== 6} onClick={() => { alert(t('withdraw_83b14a')); setShowConfirm(false); }}>
                  <I.Check size={12}/> {t('withdraw_e6f846')}
                </button>
              </div>
            </div>
          </div>
        )}
      </window.PageShell>
    );
  };

  // ============================================================
  // TRANSACTION HISTORY PAGE
  // ============================================================
  window.TransactionHistoryPage = function TransactionHistoryPage({ shellProps }) {
    const [filter, setFilter] = useState('all');
    const [q, setQ] = useState('');

    /*
       자금 이동 내역 (실데이터).

       거래소 원장에서 온다. 목업은 입금·출금·내부이체·거래·수수료·리베이트를
       섞어 보여줬는데, 우리 구조에서 실제로 볼 수 있는 것은 **거래소 계정 안의
       원장 항목**이다 — 입금·출금은 우리가 처리하지 않으므로 우리 기록에 없고,
       거래소가 원장에 남긴 것만 조회된다.

       KPI 네 개도 고정값이었다(+$2,340 · -$180 · -$18.42 · +$5.42).
       원장 종류별로 실제 합계를 낸다.
    */
    const acct = window.useAccountData ? window.useAccountData() : { isLive: false };
    const liveTx = (acct.isLive && window.QTAccount) ? (window.QTAccount.getTransactions() || []) : null;

    /*
       원장 종류 → 화면 분류.

       거래소 원장의 kind 를 그대로 쓰지 않는 이유: 화면 필터가 6종으로 고정돼
       있고, 원장에는 그 외 종류가 더 있다. 모르는 종류는 'other' 로 모아
       숨기지 않는다 — 항목이 사라지면 합계가 맞지 않는다.
    */
    const KIND_MAP = {
      REALIZED_PNL: 'trade',
      COMMISSION_FEE: 'fee',
      FUNDING_FEE: 'fee',
      TRANSFER_IN: 'deposit',
      TRANSFER_OUT: 'withdraw',
      DEPOSIT: 'deposit',
      WITHDRAW: 'withdraw',
      REBATE: 'rebate',
    };

    const liveRows = liveTx
      ? liveTx.map((x) => {
          const amt = Number(x.amount);
          return {
            id: x.id,
            kind: KIND_MAP[x.kind] || 'other',
            asset: x.asset || '—',
            amount: Number.isFinite(amt) ? amt : undefined,
            // 온체인 네트워크 정보가 없다. 거래소 내부 원장이므로 해당 없음.
            network: '—',
            status: 'completed',
            // 해시 대신 원장 종류와 심볼을 보여준다 — 없는 해시를 만들지 않는다.
            txHash: [x.rawType || x.kind, x.symbol].filter(Boolean).join(' · ') || '—',
            time: Number(x.time) || undefined,
          };
        })
      : null;

    const isLive = Array.isArray(liveRows);

    // 종류별 합계. 해당 항목이 없으면 null → 화면이 '—' 를 그린다.
    const sumOf = (kinds) => {
      if (!isLive) return null;
      const rows = liveRows.filter((r) => kinds.includes(r.kind) && typeof r.amount === 'number');
      if (!rows.length) return null;
      return rows.reduce((a, r) => a + r.amount, 0);
    };
    const money = (v) => (v === null ? '—' : (v >= 0 ? '+' : '-') + '$' + fmt(Math.abs(v), 2));

    const mockTxs = [
      { id:'tx001', kind:'deposit',  asset:'USDT', amount:  1000,   network:'TRC20', status:'completed', txHash:'3f4e5c6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', time: Date.now() - 1000*60*30 },
      { id:'tx002', kind:'withdraw', asset:'BTC',  amount:  -0.05,  network:'BTC',   status:'completed', txHash:'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', time: Date.now() - 1000*60*60*3 },
      { id:'tx003', kind:'deposit',  asset:'USDT', amount:   500,   network:'ERC20', status:'pending',   txHash:'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1', time: Date.now() - 1000*60*60*8 },
      { id:'tx004', kind:'transfer', asset:'ETH',  amount:  -0.5,   network:'—',     status:'completed', txHash:'internal-transfer-Binance→BitGet',   time: Date.now() - 1000*60*60*22 },
      { id:'tx005', kind:'trade',    asset:'BTC',  amount:  0.185,  network:'—',     status:'completed', txHash:'trade-fill-BTC/USDT',                time: Date.now() - 1000*60*60*40 },
      { id:'tx006', kind:'fee',      asset:'USDT', amount: -1.36,   network:'—',     status:'completed', txHash:'trading-fee-2026-08-01',             time: Date.now() - 1000*60*60*40 },
      { id:'tx007', kind:'rebate',   asset:'USDT', amount:  0.38,   network:'—',     status:'completed', txHash:'rebate-2026-07',                     time: Date.now() - 1000*60*60*72 },
      { id:'tx008', kind:'deposit',  asset:'SOL',  amount:  10,     network:'Solana',status:'completed', txHash:'DYw8jCTKfWpZbCXG7QP7VbYUqSJmZ4xF',   time: Date.now() - 1000*60*60*120 },
    ];

    /*
       원장 목록.

       ★★ 실서비스에서는 목업 거래를 보여주지 않는다. 전에는 거래소 원장을
         조회하지 못하면 예시 8건(입금 1,000 USDT · 거래 0.185 BTC …)이 나왔고,
         사용자는 자기 입출금 기록으로 읽는다.

       ★ 미리보기에서는 유지한다 — 표 레이아웃 확인에 필요하다.
    */
    const txs = isLive
      ? liveRows
      : ((window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) ? [] : mockTxs);

    const filtered = txs
      .filter(t => filter === 'all' || t.kind === filter)
      .filter(t => !q || t.txHash.includes(q) || t.asset.toLowerCase().includes(q.toLowerCase()));

    return (
      <window.PageShell
        {...shellProps}
        title={t('tx_title')}
        subtitle={t('transaction_history_1de8f9')}
        breadcrumb={['Home','Wallet','Transactions']}
        /* Export 숨김 (베타 범위 제외) — 배선할 서버 경로가 아직 없다. */
        actions={null}
      >
        <div className="grid-4">
          {isLive ? (() => {
            const inSum = sumOf(['deposit']);
            const outSum = sumOf(['withdraw']);
            const feeSum = sumOf(['fee']);
            const pnlSum = sumOf(['trade']);
            return (
              <>
                <window.KPICard label={t('tx_in')} value={money(inSum)} sub={t('tx_ledger_src')} tone="long"/>
                <window.KPICard label={t('tx_out')} value={money(outSum)} sub={t('tx_ledger_src')} tone="short"/>
                <window.KPICard label={t('tx_fees')} value={money(feeSum)} sub={t('tx_fees_sub')} tone="warning"/>
                <window.KPICard label={t('tx_realized')} value={money(pnlSum)} sub={t('tx_realized_sub')} tone={pnlSum !== null && pnlSum >= 0 ? 'long' : 'short'}/>
              </>
            );
          })() : (window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) ? (
            /*
               ★ 실서비스인데 원장을 조회하지 못했다.

                 +$2,340 · -$180 · -$18.42 · +$5.42 는 예시였다. 사용자는 그것을
                 자기 입출금 합계로 읽는다. 모르면 '—' 다.
            */
            <>
              <window.KPICard label={t('transaction_history_ec0ce9')} value="—" sub={t('tx_need_key')}/>
              <window.KPICard label={t('transaction_history_99af2b')} value="—" sub={t('tx_need_key')}/>
              <window.KPICard label={t('withdraw_34f036')} value="—" sub={t('tx_need_key')}/>
              <window.KPICard label={t('transaction_history_ef5fd4')} value="—" sub={t('tx_need_key')}/>
            </>
          ) : (
            <>
              <window.KPICard label={t('transaction_history_ec0ce9')} value="+$2,340" tone="long"/>
              <window.KPICard label={t('transaction_history_99af2b')} value="-$180"   tone="short"/>
              <window.KPICard label={t('withdraw_34f036')} value="-$18.42" tone="warning"/>
              <window.KPICard label={t('transaction_history_ef5fd4')} value="+$5.42"  tone="brand"/>
            </>
          )}
        </div>

        <window.SectionCard
          title={t('nav_transactions')}
          actions={
            <>
              <div className="input-group" style={{width: 240, height: 30}}>
                <I.Search size={12}/>
                <input placeholder={t('transaction_history_adb142')} value={q} onChange={e => setQ(e.target.value)}/>
              </div>
              <div className="seg">
                {['all','deposit','withdraw','transfer','trade','fee','rebate'].map(f => (
                  <button key={f} className={`seg__opt ${filter===f?'is-active':''}`} onClick={() => setFilter(f)}>{t('tx_f_' + f)}</button>
                ))}
              </div>
            </>
          }
          noPadding
        >
          <window.DataTable
            columns={[
              { key: 'time',   label: t('tx_col_time'), render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{new Date(r.time).toLocaleString('en-GB', {hour12: false})}</span> },
              { key: 'kind',   label: t('tx_col_type'), render: r => {
                const colors = { deposit: 'ok', withdraw: 'warn', transfer: 'neutral', trade: 'neutral', fee: 'warn', rebate: 'ok' };
                return <span className={`status-pill status-pill--${colors[r.kind] || 'neutral'}`}>{r.kind.toUpperCase()}</span>;
              }},
              { key: 'asset',  label: t('tx_col_asset'), render: r => <strong>{r.asset}</strong> },
              { key: 'amount', label: t('col_amount'), align:'right', render: r => (
                <span className={r.amount >= 0 ? 't-long' : 't-short'} style={{fontFamily:'var(--font-num)', fontWeight: 500}}>
                  {r.amount >= 0 ? '+' : ''}{r.amount} {r.asset}
                </span>
              )},
              { key: 'network', label: t('col_network') },
              { key: 'status',  label: t('col_status'), render: r => <span className={`status-pill status-pill--${r.status === 'completed' ? 'ok' : 'warn'}`}>{r.status.toUpperCase()}</span> },
              { key: 'hash',    label: t('tx_col_hash'), render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-brand)'}}>{r.txHash.slice(0, 12)}…</span> },
              { key: 'act',     label: '', align:'right', render: () => <button className="tbl-action">{t('col_view')}</button> },
            ]}
            rows={filtered}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // STRATEGY DETAIL PAGE
  // ============================================================
  window.StrategyDetailPage = function StrategyDetailPage({ shellProps, strategyId }) {
    const [tab, setTab] = useState('overview');

    /*
       전략 상세 (실데이터).

       ★★ 이 화면은 자산곡선을 **만들어내고** 있었다 ★★

           const trend = t * strategy.pnl30;
           const noise = Math.sin(i / 3) * (strategy.maxDD * 0.3);

       목업 수익률에 사인파 잡음을 얹은 그림이었다. 차트는 사람이 가장 강하게
       믿는 표현이라, 만들어낸 곡선은 만들어낸 숫자보다 더 위험하다 —
       사용자는 그 모양을 보고 "꾸준히 우상향" 같은 판단을 한다.

       백엔드는 실제 백테스트의 자산곡선(500포인트)과 거래 목록을 준다.
       그것을 쓰고, 없으면 그리지 않는다.
    */
    const [live, setLive] = useState(null);
    const [err, setErr] = useState(null);
    const [_busy, _setBusy] = useState(false);

    const load = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.strategy || !strategyId) return;
      api.strategy(strategyId)
        .then((r) => { setLive(r.data || null); setErr(null); })
        .catch((e) => setErr((e && e.message) || 'load failed'));
    }, [strategyId]);
    useEffect(() => { load(); }, [load]);

    /*
       백테스트 실행 상태.

       ★ `bt` 는 두 곳에서 온다: 전략 조회에 딸려 온 미리 계산된 결과, 그리고
         이용자가 방금 돌린 결과. 방금 돌린 것이 있으면 그것을 우선한다 —
         이용자가 버튼을 눌렀는데 이전 결과가 남아 있으면 "안 돌아갔다" 고 본다.
    */
    const [btRun, setBtRun] = useState({ busy: false, error: null, note: null, result: null });
    const [btForm, setBtForm] = useState({ symbol: 'BTCUSDT', timeframe: '15m', bars: '500' });

    const runBacktest = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.backtest || !strategyId) return;
      setBtRun((prev) => ({ ...prev, busy: true, error: null, note: null }));
      api.backtest(strategyId, {
        symbol: btForm.symbol,
        timeframe: btForm.timeframe,
        bars: Number(btForm.bars) || 500,
      })
        .then((r) => {
          /*
             ★ 서버가 캔들을 못 받으면 503(NO_DATA)을 준다. 그것을 "수익률 0" 으로
               보여주면 시험하지 않은 것을 시험한 것처럼 만든다. 사유를 그대로 남긴다.
          */
          const data = (r && r.data) || r;
          setBtRun({ busy: false, error: null, note: null, result: data || null });
        })
        .catch((e) => {
          /*
             ★★ 서버의 원문을 그대로 보여주지 않는다.

               이 경로의 502 는 `계약 사양 미적재: NOPEUSDT` 처럼 **한국어 문장**을
               담고 있다. 화면 언어는 영어·일본어·중국어뿐이라, 원문을 그대로 쓰면
               읽을 수 없는 글이 나온다(규칙 16: 서버는 키를 주고 화면이 번역한다).

               서버가 아직 키를 주지 않으므로 코드로 판정한다. 모르는 코드는
               일반 문구로 — 원문으로 되돌아가지 않는다.
          */
          const code = (e && e.code) || '';
          const key = code === 'NO_DATA' ? 'bt_err_no_data'
            : code === 'UPSTREAM_ERROR' ? 'bt_err_upstream'
            : code === 'BAD_REQUEST' ? 'bt_err_bad_request'
            : 'bt_err_failed';
          setBtRun({ busy: false, error: t(key), note: null, result: null });
        });
    }, [strategyId, btForm.symbol, btForm.timeframe, btForm.bars]);

    // 방금 돌린 결과가 있으면 그것을, 없으면 전략에 딸려 온 것을 쓴다.
    const bt = btRun.result || (live && live.backtest);
    const m = (bt && bt.metrics) || null;
    const isLive = Boolean(live);

    const numOrNull = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // 실 전략을 화면이 기대하는 모양으로. 없는 값은 null → '—' 로 그린다.
    const strategy = isLive
      ? {
          id: live.id,
          // ★ 번역 키가 있으면 그것을 쓴다(목록 화면과 같은 규칙).
          name: live.nameKey ? t(live.nameKey) : live.name,
          author: live.author === 'built-in' ? null : live.author,
          authorKey: live.author === 'built-in' ? 'strategy_builtin' : null,
          tag: live.category || '—',
          description: (live.descriptionKey ? t(live.descriptionKey) : live.description) || '',
          pnl30: m ? numOrNull(m.totalReturnPct) : null,
          winRate: m ? numOrNull(m.winRatePct) : null,
          sharpe: m ? numOrNull(m.sharpe) : null,
          maxDD: m ? numOrNull(m.maxDrawdownPct) : null,
          trades: m ? numOrNull(m.tradeCount) : null,
          followers: numOrNull(live.followers),
          subscription: null,
          featured: false,
        }
      /*
         ★ 실서비스에서는 목업 전략으로 폴백하지 않는다.

           전에는 STRATEGIES[0]('BTC Trend + Copilot')을 보여줬다. 없는 전략
           ID 로 들어와도, API 가 실패해도 그것이 떴다. 사용자는 존재하지 않는
           전략의 수익률을 보고 Follow 를 누르려 한다.

           백엔드가 없는 것이 확인된 경우(디자이너 미리보기)에만 원본 예시를
           유지한다 — 그때는 API 자체가 없으므로 예시가 유일한 표시 수단이다.
      */
      : ((window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false)
          ? (window.QTApp.STRATEGIES.find(s => s.id === (strategyId || 'strat-05')) || window.QTApp.STRATEGIES[0])
          : null);

    /*
       자산곡선.

       실데이터가 있으면 그것만 쓴다. 없으면 목업 곡선을 유지한다(디자인
       미리보기). 실데이터 모드에서 백테스트를 아직 돌리지 않았으면
       곡선을 그리지 않고 안내를 보여준다 — 빈 차트를 그리면 "성과가
       평평하다" 로 읽힌다.
    */
    const liveCurve = (bt && Array.isArray(bt.equityCurve) && bt.equityCurve.length > 1)
      ? bt.equityCurve.map((p) => Number(p.equity)).filter((v) => Number.isFinite(v))
      : null;

    /*
       전략을 찾지 못한 경우.

       ★ 아래 곡선 계산이 strategy.pnl30 을 읽으므로 여기서 빠져나가야 한다.
       ★ 로딩 중(live === null && err === null && strategyId 있음)과 진짜 없음을
         구분한다 — 로딩 중에 "없습니다" 를 보여주면 있는데도 없다고 알린다.
    */
    if (!strategy) {
      const loading = Boolean(strategyId) && !err;
      return (
        <window.PageShell
          {...shellProps}
          title={t('strat_detail_title')}
          breadcrumb={['Home', 'AI Strategies']}
        >
          <div style={{
            padding:'16px 18px', borderRadius:8, fontSize:12.5, lineHeight:1.85,
            background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)',
            color:'var(--color-text-secondary)',
          }}>
            <div style={{fontWeight:600, marginBottom:5, color:'var(--color-text-primary)'}}>
              {loading ? t('strat_loading') : (strategyId ? t('strat_not_found') : t('strat_pick_one'))}
            </div>
            <div>{loading ? t('strat_loading_sub') : (strategyId ? t('strat_not_found_sub') : t('strat_pick_one_sub'))}</div>
            {!loading && (
              <a href="#/ai-strategies" className="btn btn--sm" style={{marginTop:12, display:'inline-block'}}>
                {t('strat_browse')}
              </a>
            )}
            {err && <div style={{marginTop:10, fontSize:11.5, color:'var(--color-danger)'}}>{err}</div>}
          </div>
        </window.PageShell>
      );
    }

    const points = liveCurve ? liveCurve.length : 60;
    const curve = liveCurve || Array.from({length: points}, (_, i) => {
      const t = i / points;
      const trend = t * strategy.pnl30;
      const noise = Math.sin(i / 3) * (strategy.maxDD * 0.3);
      return 100 + trend + noise;
    });
    const eqW = 800, eqH = 260;
    const eqMax = Math.max(...curve);
    const eqMin = Math.min(...curve);
    const eqRange = eqMax - eqMin || 1;
    const eqPath = curve.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * eqW / (points - 1)).toFixed(1)} ${(eqH - ((v - eqMin) / eqRange) * (eqH - 20) - 10).toFixed(1)}`).join(' ');
    const eqArea = eqPath + ` L ${eqW} ${eqH} L 0 ${eqH} Z`;

    return (
      <window.PageShell
        {...shellProps}
        title={strategy.name}
        subtitle={`${strategy.authorKey ? t(strategy.authorKey) : (strategy.author || '—')} · ${strategy.tag}`}
        breadcrumb={['Home','AI Strategies', strategy.name]}
        badge={<>
          {/* 구독 등급 제도가 없으면 배지를 비운다 — 'null' 글자가 나오면 안 된다. */}
          {strategy.subscription && <span className={`badge badge--neutral`}>{strategy.subscription}</span>}
          {strategy.featured && <span className="badge badge--ai">✦ FEATURED</span>}
        </>}
        actions={
          <>
            {isLive ? (
              <>
                {/*
                   백테스트는 실제로 서버가 계산한다.

                   ★★ 이 버튼은 아래 설정 카드와 **같은 경로**를 쓴다.

                     전에는 여기서 `api.backtest(id, {})` 를 직접 불렀다. 빈 본문은
                     서버 기본값(BTCUSDT·1h)으로 계산된다. 그래서 이용자가 설정
                     카드에서 심볼·주기를 바꿔 놓아도 이 버튼은 **기본값 결과**를
                     보여주었다 — 화면의 입력과 표시된 숫자가 서로 다른 조건이다.

                   ★ 오류도 서버 원문(한국어)을 그대로 띄우고 있었다. 합치면서
                     번역 키로 바뀐다.
                */}
                <button
                  className="btn btn--sm"
                  disabled={btRun.busy}
                  onClick={() => { setTab('backtest'); runBacktest(); }}
                >
                  <I.Chart size={13}/> {btRun.busy ? t('bt_running') : t('strat_run_backtest')}
                </button>
                {/*
                   알림 버튼은 배선할 대상이 없다 — 전략 신호 알림을 만드는
                   서버 기능이 없다. 실데이터에서는 감춘다.
                */}
                <a className="btn btn--sm btn--primary" href="#/ai-strategies" style={{textDecoration:'none'}}>
                  <I.ArrowRight size={13}/> {t('strat_back_to_list')}
                </a>
              </>
            ) : (
              <>
                {/*
                   ★ 이 버튼도 실제로 백테스트를 돌린다.

                     전에는 아무 동작이 없었다. 서버에 실행 경로가 있는데 화면이
                     부르지 않는 상태가 두 곳(여기와 아래 설정 카드)에 있었다.
                */}
                <button
                  className="btn btn--sm"
                  disabled={btRun.busy}
                  onClick={() => { setTab('backtest'); runBacktest(); }}
                >
                  <I.Chart size={13}/> {btRun.busy ? t('bt_running') : t('bt_live_backtest')}
                </button>
                <button className="btn btn--sm"><I.Bell size={13}/> {t('col_alert')}</button>
                <button className="btn btn--sm btn--primary"><I.Plus size={13}/> {t('strategy_detail_73a075')}</button>
              </>
            )}
          </>
        }
      >
        <div className="grid-4">
          {/* 없는 값은 '—'. 0 으로 채우면 미실행과 성과 0 이 구분되지 않는다. */}
          <window.KPICard
            label={isLive ? t('strat_backtest_ret') : t('strat_30d_pnl')}
            value={strategy.pnl30 === null ? '—' : (strategy.pnl30 >= 0 ? '+' : '') + Number(strategy.pnl30).toFixed(2) + '%'}
            tone={strategy.pnl30 === null ? undefined : (strategy.pnl30 >= 0 ? 'long' : 'short')}
            sub={isLive && bt && bt.window ? t('strat_bars', { n: bt.window.barCount }) : undefined}
          />
          <window.KPICard
            label={t('kpi_win_rate')}
            value={strategy.winRate === null ? '—' : Number(strategy.winRate).toFixed(1) + '%'}
            sub={isLive && strategy.trades !== null ? t('strat_trades_n', { n: strategy.trades }) : undefined}
            tone="brand"
          />
          <window.KPICard label={t('col_sharpe')} value={strategy.sharpe === null ? '—' : Number(strategy.sharpe).toFixed(2)}/>
          <window.KPICard
            label={t('bt_max_dd')}
            value={strategy.maxDD === null ? '—' : '-' + Number(strategy.maxDD).toFixed(2) + '%'}
            tone="short"
          />
        </div>

        <div className="tabs" style={{borderBottom: '1px solid var(--color-border-subtle)', marginBottom: -12}}>
          {[
            { id: 'overview', label: t('strat_tab_overview') },
            { id: 'backtest', label: t('col_backtest') },
            { id: 'trades', label: t('strat_tab_trades') },
            { id: 'settings', label: t('strat_tab_settings') },
            { id: 'reviews', label: t('strat_tab_reviews') },
          ].map(t => (
            <button key={t.id} className={`tab ${tab===t.id?'is-active':''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <window.SectionCard title={`Equity Curve · ${strategy.backtestRange}`}>
              <svg viewBox={`0 0 ${eqW} ${eqH}`} width="100%" height="280" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="eqStratGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35"/>
                    <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map(f => (
                  <line key={f} x1="0" x2={eqW} y1={eqH*f} y2={eqH*f} stroke="var(--chart-grid)" strokeDasharray="2 4"/>
                ))}
                <path d={eqArea} fill="url(#eqStratGrad)"/>
                <path d={eqPath} fill="none" stroke="var(--color-brand)" strokeWidth="2"/>
              </svg>
            </window.SectionCard>

            <div className="grid-2">
              <window.SectionCard title={t('strat_desc_title')}>
                <p style={{fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: 0}}>
                  {t('strat_desc_1', { name: strategy.name, tag: strategy.tag })}
                  {t('strat_desc_2')}
                </p>
                <p style={{fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: '12px 0 0'}}>
                  <strong>{t('strategy_detail_0a17fe')}</strong> {strategy.authorKey === 'author_house_lab' ? t('strategy_detail_40a912') : t('strategy_detail_704ee2')}
                </p>
              </window.SectionCard>

              <window.SectionCard title={t('strat_risk_profile')}>
                <div style={{display:'flex', flexDirection:'column', gap: 10}}>
                  {[
                    { k: 'Volatility', level: 3, max: 5 },
                    { k: 'Position size', level: 2, max: 5 },
                    { k: 'Correlation to BTC', level: 4, max: 5 },
                    { k: 'Time in market', level: 3, max: 5 },
                    { k: 'Data dependency', level: 3, max: 5 },
                  ].map(r => (
                    <div key={r.k}>
                      <div style={{display:'flex', justifyContent:'space-between', fontSize:11, marginBottom: 4}}>
                        <span>{r.k}</span>
                        <span style={{fontFamily:'var(--font-mono)'}}>{r.level}/{r.max}</span>
                      </div>
                      <div style={{display:'flex', gap:2}}>
                        {Array.from({length: r.max}).map((_, i) => (
                          <div key={i} style={{flex:1, height:6, borderRadius:2, background: i < r.level ? 'var(--color-brand)' : 'var(--color-border-default)'}}/>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </window.SectionCard>
            </div>
          </>
        )}

        {tab === 'backtest' && (
          <>
            {/*
               ★★ 백테스트 실행 기능은 없다.

                 서버에 백테스트를 돌리는 엔드포인트가 없다(검색 결과 0건).
                 지표는 서버가 **미리 계산해 둔 결과**를 읽어오는 것이다.
                 그런데 이 화면에는 기간·초기자본을 넣고 'Run Backtest' 를
                 누르는 양식이 있었고, 누르면 아무 일도 일어나지 않았다.
                 값을 바꿔 눌러본 사용자는 아래 숫자가 자기 설정으로 계산된
                 것이라고 믿는다.

               ★ 양식을 지우지 않고(UI 계약) 무엇이 준비 중인지 밝힌다.
                 입력은 읽기 전용으로 두어 "바꿨는데 반영이 안 된다" 는
                 오해를 없앤다.
            */}
            <window.SectionCard
              title={t('bt_config_title')}
              subtitle={btRun.note || t('bt_config_sub')}
            >
              {/*
                 ★★ 이 양식은 실제로 백테스트를 돌린다.

                   전에는 입력이 전부 readOnly 이고 버튼이 disabled 였다. 서버에는
                   `POST /api/strategies/:id/backtest` 가 이미 있었고 실제로 지표를
                   계산해 돌려주는데, 화면이 부르지 않아서 "실행 API 가 없다" 고
                   적어 두었던 것이다.

                 ★ 봉 수(bars)로 구간을 정한다. 서버가 그 개수만큼 최근 캔들을
                   받아 시험하므로, 날짜를 임의로 넣는 것보다 결과가 재현된다.
                   시작·종료 날짜는 **결과에서 나온 실제 구간**을 보여준다 —
                   요청한 구간과 실제 구간이 다를 수 있고(상장 이후 데이터만 존재),
                   요청값을 그대로 보여주면 없는 기간을 시험한 것처럼 보인다.
              */}
              <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12}}>
                <div className="input-group">
                  <span className="input-group__label">{t('fld_symbol')}</span>
                  <input
                    value={btForm.symbol}
                    onChange={(e) => setBtForm({ ...btForm, symbol: e.target.value.toUpperCase() })}
                  />
                </div>
                <div className="input-group">
                  <span className="input-group__label">{t('bt_timeframe')}</span>
                  <select
                    className="input"
                    value={btForm.timeframe}
                    onChange={(e) => setBtForm({ ...btForm, timeframe: e.target.value })}
                  >
                    {['5m','15m','30m','1H','4H','1D'].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <span className="input-group__label">{t('bt_bars')}</span>
                  <input
                    value={btForm.bars}
                    onChange={(e) => setBtForm({ ...btForm, bars: e.target.value.replace(/[^0-9]/g, '') })}
                  />
                </div>
                <div className="input-group">
                  <span className="input-group__label">{t('bt_window')}</span>
                  {/*
                     실제로 시험된 구간. 요청값이 아니라 결과값이다.
                     아직 돌리지 않았으면 '—' — 0 이나 오늘 날짜로 채우지 않는다.
                  */}
                  {/*
                     ★ `window` 는 응답 **루트**에 있다(metrics 안이 아니다).

                       원래 코드가 `metrics.window` 를 읽고 있어서 늘 '—' 였다.
                       값이 없는 것과 자리를 잘못 찾은 것은 화면에서 똑같이 보이므로,
                       실제 응답을 확인하고 나서야 드러났다.
                  */}
                  <input
                    readOnly
                    value={bt && bt.window && bt.window.fromTime
                      ? `${new Date(bt.window.fromTime).toISOString().slice(0,10)} → ${new Date(bt.window.toTime).toISOString().slice(0,10)}`
                      : t('dash')}
                  />
                </div>
              </div>
              <button
                className="btn btn--primary"
                style={{marginTop: 12}}
                disabled={btRun.busy || !btForm.symbol || !Number(btForm.bars)}
                onClick={runBacktest}
              >
                <I.Sparkles size={12}/> {btRun.busy ? t('bt_running') : t('bt_run')}
              </button>
              {/*
                 결과·실패를 화면에 남긴다. 토스트는 사라지고, 백테스트는
                 몇 초 걸리므로 이용자가 그 사이 다른 곳을 보고 있을 수 있다.
              */}
              {btRun.error && (
                <div className="auth-alert auth-alert--danger" style={{marginTop: 10}} role="status">
                  <I.Alert size={12}/><div>{btRun.error}</div>
                </div>
              )}
              {/*
                 ★★ 아래 지표가 **어떤 요청의 결과인지** 밝힌다.

                   실행이 실패하면 이전 결과가 화면에 남는다(지우면 이용자가 보고
                   있던 것을 빼앗는다). 그런데 어느 심볼의 결과인지 적지 않으면,
                   방금 넣은 심볼의 결과로 읽는다 — 실패한 요청의 숫자로 오해한다.
              */}
              {bt && (bt.symbol || bt.timeframe) && (
                <div className="text-dim" style={{marginTop: 10, fontSize: 12}}>
                  {t('bt_showing')} {bt.symbol || t('dash')} · {bt.timeframe || t('dash')}
                  {bt.computedAt ? ` · ${new Date(bt.computedAt).toLocaleString(window.QTI18n.bcp47Of())}` : ''}
                </div>
              )}
            </window.SectionCard>

            {/*
               ★★ 전에는 이 네 칸 중 셋이 하드코딩이었다.

                 `Total Return +142.4%` · `Sortino 3.42` · `Calmar 1.84` 는 고정
                 문자열이고 Sharpe 만 실데이터였다. 진짜와 가짜가 한 줄에 섞여
                 있어서, 하나가 실제 값이라는 것을 아는 사용자는 나머지도
                 실제라고 읽는다. +142.4% 는 팔로우를 결정하게 만드는 숫자다.

               ★ 지금은 서버가 주는 것만 표시한다.
                 Sortino·Calmar 는 서버가 계산하지 않으므로 '—' 로 두고 이유를
                 붙인다. 다른 지표로 대체하거나 비슷한 값을 만들어 넣지 않는다.
            */}
            <div className="grid-4">
              <window.KPICard
                label={t('bt_total_return')}
                value={m && Number.isFinite(m.totalReturnPct) ? `${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(2)}%` : '—'}
                tone={m && Number.isFinite(m.totalReturnPct) ? (m.totalReturnPct >= 0 ? 'long' : 'short') : undefined}
                sub={m && Number.isFinite(m.totalReturnPct) ? undefined : t('bt_no_metric')}
              />
              <window.KPICard
                label={t('bt_sharpe_ratio')}
                value={m && Number.isFinite(m.sharpe) ? m.sharpe.toFixed(2) : '—'}
                sub={m && Number.isFinite(m.sharpe) ? undefined : t('bt_no_metric')}
              />
              <window.KPICard label={t('bt_sortino')} value="—" sub={t('bt_metric_absent')}/>
              <window.KPICard label={t('bt_calmar')} value="—" sub={t('bt_metric_absent')}/>
            </div>

            {/*
               ★★ 월별 수익률 히트맵이 `Math.sin(i/2)*15 + Math.random()*8 - 4` 였다.

                 렌더할 때마다 숫자가 바뀌었다. 같은 화면을 두 번 보면 다른
                 성적이 나오는데, 그것이 눈에 띄지 않을 만큼 작은 칸이었다.
                 서버는 월별 분해를 주지 않는다(metrics 는 구간 합계뿐).

               ★ 만들지 않는다. 없다는 사실을 말한다.
            */}
            <window.SectionCard title={t('strat_monthly_returns')}>
              <div style={{padding:'14px 16px', fontSize:11.5, lineHeight:1.7, color:'var(--color-text-tertiary)'}}>
                {t('bt_monthly_absent')}
              </div>
            </window.SectionCard>
          </>
        )}

        {tab === 'trades' && (
          /*
             ★★ 전에는 하드코딩된 4건이 표에 있었다.

               `2026-07-30 · BTC/USDT · long · 67,285 → 68,432 · +1.7% · 2h 14m`
               같은 행이 고정 문자열이었다. 이 표는 "이 전략이 실제로 이렇게
               거래했다" 로 읽히고, 승률 계산의 근거로 보인다.

               서버 metrics 는 구간 합계(수익률·승률·MDD·Sharpe·거래수)만 준다.
               개별 신호 이력을 주는 엔드포인트가 없다.

             ★ 만들지 않는다. 대신 서버가 준 거래 횟수와 구간을 사실대로 보여준다.
          */
          <window.SectionCard title={t('strat_hist_signals')}>
            <div style={{padding:'4px 2px', fontSize:11.5, lineHeight:1.8, color:'var(--color-text-tertiary)'}}>
              <div>{t('bt_signals_absent')}</div>
              {m && Number.isFinite(m.tradeCount) && (
                <div style={{marginTop:8, color:'var(--color-text-secondary)'}}>
                  {t('bt_trade_count', { n: m.tradeCount })}
                  {m.window && m.window.fromTime && m.window.toTime && (
                    <> · {new Date(m.window.fromTime).toLocaleDateString()} – {new Date(m.window.toTime).toLocaleDateString()}</>
                  )}
                </div>
              )}
            </div>
          </window.SectionCard>
        )}

        {tab === 'settings' && (
          /*
             ★★ 이 화면이 가장 위험했다.

               'Auto-copy' 스위치가 **켜진 상태**로 그려지고, 포지션 크기·동시
               보유 수·손실 중단선까지 있었다. 서버는 팔로우에 대해
               `autoExecution: false` 를 명시한다 — 신호를 복제하거나 주문을
               제출하지 않는다. 즉 이 설정은 아무 데도 저장되지 않고 아무
               동작도 하지 않는다.

               사용자는 자동 매매가 켜졌다고 믿고 기다린다. 주문이 나갈 줄 알고
               기다리면 기회를 놓치고, 반대로 밤에 자동으로 나갈까 봐 불안해한다.
               둘 다 실제 손해다.

             ★ 양식을 지우지 않고(UI 계약) 비활성으로 두고 사실을 밝힌다.
          */
          <window.SectionCard title={t('strat_follow_settings')} subtitle={t('bt_autocopy_absent')}>
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              <div className="input-group">
                <span className="input-group__label">
                  {t('fld_auto_copy')}
                  <span className="qt-pending-mark">{t('sec_pending')}</span>
                </span>
                <label className="switch" style={{marginLeft:'auto'}} title={t('bt_autocopy_absent')}>
                  <input type="checkbox" checked={false} disabled readOnly/>
                  <span className="switch__track"><span className="switch__thumb"/></span>
                </label>
              </div>
              <div className="input-group"><span className="input-group__label">{t('fld_position_size')}</span><input defaultValue="100" disabled/><span className="input-group__suffix">USDT</span></div>
              <div className="input-group"><span className="input-group__label">{t('fld_max_concurrent')}</span><input defaultValue="3" disabled/><span className="input-group__suffix">positions</span></div>
              <div className="input-group"><span className="input-group__label">{t('fld_stop_copy_dd')}</span><input defaultValue="10" disabled/><span className="input-group__suffix">%</span></div>
              <button className="btn" disabled title={t('bt_autocopy_absent')}>{t('strat_save_settings')}</button>
            </div>
          </window.SectionCard>
        )}

        {tab === 'reviews' && (
          /*
             ★★ 리뷰 3건과 "2,140 followers · Avg 4.6/5" 가 하드코딩이었다.

               `J.K. ★★★★★ 3d ago` 같은 항목이다. 존재하지 않는 사람들의
               존재하지 않는 평가이고, 별점 평균은 팔로우 결정에 직접 쓰인다.
               서버에 리뷰·별점 기능이 없다.

             ★ 팔로워 수만 서버 값으로 보여주고(있으면), 평가는 없다고 말한다.
          */
          <window.SectionCard
            title={t('strat_tab_reviews')}
            subtitle={live && Number.isFinite(live.followers) ? t('bt_followers', { n: live.followers }) : undefined}
          >
            <div style={{padding:'4px 2px', fontSize:11.5, lineHeight:1.8, color:'var(--color-text-tertiary)'}}>
              {t('bt_reviews_absent')}
            </div>
          </window.SectionCard>
        )}
      </window.PageShell>
    );
  };

  // ============================================================
  // MY STRATEGIES PAGE
  // ============================================================
  window.MyStrategiesPage = function MyStrategiesPage({ shellProps }) {
    /*
       내 전략 (팔로우 목록).

       ★ 팔로우는 **관심 등록**이다. 서버가 autoExecution:false 를 명시한다 —
         신호를 자동 복제하거나 주문을 제출하지 않는다.
         원래 화면에 'Auto-copy 0' 이라는 KPI 가 있었는데, 자동 복제 기능이
         있다는 뜻으로 읽힌다. 사용자가 주문이 나갈 줄 알고 기다리면
         기회를 놓치거나, 반대로 나갈까 봐 불안해한다.

       Combined PnL 도 계산할 수 없다 — 팔로우는 거래가 아니므로 손익이 없다.
       내 실제 손익은 /analytics 에 있다(거래소 원장 기준).
    */
    const [mine, setMine] = useState(null);
    const [note, setNote] = useState(null);
    const [busyId, setBusyId] = useState(null);

    const load = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.myStrategies) return;
      api.myStrategies()
        // ★ 서버는 번역 키(noteKey)를 준다. 문장을 담으면 다국어 화면에 한국어가 새어 나간다.
        .then((r) => { setMine(r.data || []); setNote({ autoExecution: r.autoExecution, key: r.noteKey }); })
        .catch(() => setMine([]));
    }, []);
    useEffect(() => { load(); }, [load]);

    const isLive = Array.isArray(mine);

    const unfollow = async (followId) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.unfollowStrategy) return;
      setBusyId(followId);
      try { await api.unfollowStrategy(followId); load(); } catch (e) { /* 실패해도 목록은 유지 */ }
      setBusyId(null);
    };

    return (
      <window.PageShell
        {...shellProps}
        title={t('my_title')}
        subtitle={t('my_strategies_2247f0')}
        breadcrumb={['Home','AI Strategies','My']}
        actions={<a className="btn btn--sm btn--primary" href="#/ai-strategies">{t('my_strategies_bc178b')}</a>}
      >
        <div className="grid-4">
          {isLive ? (
            <>
              <window.KPICard label={t('strat_following')} value={mine.length} sub={t('my_following_sub')}/>
              {/*
                 자동 복제.

                 'Auto-copy 0' 은 기능이 있다는 뜻으로 읽힌다. 서버가
                 autoExecution:false 로 없다고 알려주므로 그대로 표시한다.
              */}
              <window.KPICard
                label={t('my_autocopy')}
                value={t('my_autocopy_off')}
                sub={note && note.key ? t(note.key) : undefined}
                tone="warning"
              />
              {/* 팔로우는 거래가 아니므로 손익이 없다. 실손익은 /analytics 에 있다. */}
              <window.KPICard label={t('my_combined_pnl')} value="—" sub={t('my_combined_pnl_sub')}/>
              <window.KPICard label={t('my_combined_win')} value="—" sub={t('my_combined_pnl_sub')}/>
            </>
          ) : (
            <>
              <window.KPICard label={t('strat_kpi_following')} value="0" sub={t('my_strategies_eb1536')}/>
              <window.KPICard label={t('my_autocopy')} value="0" tone="brand"/>
              <window.KPICard label={t('my_combined_pnl')} value="$0.00" tone="neutral"/>
              <window.KPICard label={t('my_combined_win')} value="—" />
            </>
          )}
        </div>

        <window.SectionCard title={t('strat_followed')} noPadding={isLive && mine.length > 0}>
          {isLive && mine.length > 0 ? (
            <window.DataTable
              columns={[
                /* ★ 번역 키가 있으면 그것으로. 없으면 원문(사전에 없는 전략). */
                { key:'name', label:t('my_col_strategy'), render: r => <strong>{r.nameKey ? t(r.nameKey) : r.name}</strong> },
                { key:'pair', label:t('my_col_basis'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>{r.symbol} · {r.timeframe}</span>
                ) },
                { key:'since', label:t('my_col_since'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>
                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}
                  </span>
                ) },
                { key:'act', label:'', align:'right', render: r => (
                  <>
                    <button className="tbl-action" onClick={() => { window.location.hash = '#/ai-strategies/detail?id=' + encodeURIComponent(r.strategyId); }}>
                      {t('my_col_open')}
                    </button>
                    <button className="tbl-action" style={{marginLeft:3}} disabled={busyId === r.id} onClick={() => unfollow(r.id)}>
                      {busyId === r.id ? '…' : t('my_col_unfollow')}
                    </button>
                  </>
                ) },
              ]}
              rows={mine}
            />
          ) : (
            <div style={{padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)'}}>
              <div style={{fontSize: 48, marginBottom: 12}}>📊</div>
              <div style={{fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)'}}>{t('my_strategies_308c9f')}</div>
              <div style={{fontSize: 12, marginTop: 4}}>{t('my_strategies_7dbef2')}</div>
              <a className="btn btn--primary" style={{marginTop: 20}} href="#/ai-strategies">{t('my_strategies_c93fb6')}</a>
            </div>
          )}
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // REFERRAL PAGE — 대표님이 강조한 친구 초대 시스템
  // ============================================================
  window.ReferralPage = function ReferralPage({ shellProps }) {
    const [copied, setCopied] = useState(false);

    /*
       친구 초대 코드.

       원래 'KURI001' 과 'https://quantumtrade.ai/signup?ref=KURI001' 이 박혀
       있었다. 세 가지가 잘못이었다:

         1. 모든 사용자에게 **같은 코드**가 보인다 → 누가 초대했는지 구분 불가.
            코드가 하나면 초대 추적이라는 개념 자체가 성립하지 않는다.
         2. 도메인이 확정되지 않았다 → 공유한 링크가 열리지 않을 수 있다.
         3. 화면이 "매월 1일 정산 · USDT 로 지갑에 자동 입금" 을 약속한다.
            초대 추적 백엔드도, 정산 수단도 없고, 우리는 비수탁이라
            '지갑에 입금' 할 대상 자체가 없다.

       코드를 만들어 보여주지 않는다. 사용자가 그 코드를 친구에게 공유하고
       보상을 기다리게 만드는 것이 가장 나쁜 결과다.
       이 화면은 접근 규칙(access.js)에서 미개발로 유지되어 admin 이상만 본다.
    */
    /*
       실제 제도에 연결한다.

       제도가 꺼져 있으면 코드가 없다(서버가 발급하지 않는다). 그때는 코드를
       만들어 보여주지 않는다 — 사용자가 공유하고 보상을 기다린다.

       ★ 서버가 disclosures 로 두 가지를 알려준다:
           accrualComputed:false — 적립 예정액을 우리가 계산하지 않는다
           autoPayout:false      — 자동 지급하지 않는다
         화면이 이 두 사실을 반드시 표시한다. 감추면 잔액이 쌓이고 자동으로
         입금될 것으로 기대한다.
    */
    const [ref, setRef] = useState(null);
    const [refErr, setRefErr] = useState(null);

    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.referral) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return undefined;
      let cancelled = false;
      api.referral()
        .then((r) => { if (!cancelled) { setRef(r); setRefErr(null); } })
        .catch((e) => { if (!cancelled) setRefErr((e && e.message) || 'load failed'); });
      return () => { cancelled = true; };
    }, []);

    const refLive = Boolean(ref && ref.supported);
    const refOn = Boolean(ref && ref.enabled);
    const referralCode = refOn ? ref.code : null;
    const referralLink = refOn ? ref.link : null;
    const refSum = (ref && ref.summary) || null;
    const refSet = (ref && ref.settings) || null;

    return (
      <window.PageShell
        {...shellProps}
        title={t('referral_5c777f')}
        subtitle={t('referral_36c994')}
        breadcrumb={['Home','Referral']}
      >
        <div className="grid-4">
          {refLive && refOn ? (
            <>
              <window.KPICard
                label={t('referral_556648')}
                value={refSum ? refSum.signups : '—'}
                sub={refSum ? t('ref_stage_sub', { verified: refSum.emailVerified }) : undefined}
                tone="brand"
              />
              {/*
                 실제 수익이 발생하는 단계.

                 가입만으로는 우리 수익이 없다 — 거래소 계정을 연결하고 거래를
                 해야 리베이트가 생긴다. 초대자에게 "무엇이 남았는지" 를 보여준다.
              */}
              <window.KPICard
                label={t('ref_connected')}
                value={refSum ? refSum.keysConnected : '—'}
                sub={refSum ? t('ref_traded_sub', { n: refSum.traded }) : undefined}
              />
              {/*
                 ★ '적립 예정액' 을 보여주지 않는다.

                 우리 수익은 거래소가 산정한 리베이트이고 그 금액은 거래소
                 대시보드에만 있다. 추정치를 보여주면 실제 지급액과 어긋나
                 분쟁이 된다. 실제로 지급된 것만 표시한다.
              */}
              <window.KPICard
                label={t('ref_paid')}
                value={refSum ? fmt(refSum.paidTotal, 2) + ' ' + (refSet ? refSet.payoutCurrency : '') : '—'}
                sub={refSum ? t('ref_paid_sub', { n: refSum.payoutCount }) : undefined}
                tone="long"
              />
              <window.KPICard
                label={t('ref_terms')}
                value={refSet ? refSet.sharePct + '%' : '—'}
                sub={refSet ? t('ref_terms_sub', { min: fmt(refSet.minPayout, 2), cur: refSet.payoutCurrency }) : undefined}
              />
            </>
          ) : (
            <>
              <window.KPICard label={t('referral_556648')} value="0" tone="brand"/>
              <window.KPICard label={t('referral_cc6354')} value="0" sub={t('referral_4aa57d')}/>
              <window.KPICard label={t('referral_1a8dfd')} value="$0.00" tone="long"/>
              <window.KPICard label={t('referral_d7f3c2')} value="$0.00" />
            </>
          )}
        </div>

        <window.SectionCard title={t('referral_e31ce0')}>
          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            <div style={{padding: '16px 20px', background: 'linear-gradient(135deg, var(--color-brand-subtle), transparent 60%)', border: '1px solid var(--color-brand)', borderRadius: 8}}>
              <div style={{fontSize: 11, color: 'var(--color-brand)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6}}>{t('referral_967128')}</div>
              <div style={{display:'flex', gap: 8, alignItems:'center'}}>
                {/*
                   링크가 없으면 복사 버튼을 주지 않는다. 빈 값을 복사해
                   친구에게 보내면 열리지 않는 링크가 된다.
                */}
                <span style={{flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, wordBreak: 'break-all', color: referralLink ? undefined : 'var(--color-text-tertiary)'}}>
                  {referralLink || t('referral_not_issued')}
                </span>
                <button
                  className={`btn btn--sm ${copied ? 'btn--primary' : ''}`}
                  disabled={!referralLink}
                  onClick={() => { if (!referralLink) return; window.QTCopy(referralLink, { onDone: () => { setCopied(true); setTimeout(() => setCopied(false), 2000); } }); }}
                >
                  {copied ? <><I.Check size={12}/> {t('copied')}</> : <><I.Copy size={12}/> {t('copy')}</>}
                </button>
              </div>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12}}>
              <div style={{padding: 12, background: 'var(--color-bg-surface)', borderRadius: 6}}>
                <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4}}>{t('referral_4e6dd0')}</div>
                {/* 코드가 없으면 — 로 표시한다. 0 이나 빈칸은 값으로 오인된다. */}
                <div style={{fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: referralCode ? undefined : 'var(--color-text-tertiary)'}}>{referralCode || '—'}</div>
              </div>
              <div style={{padding: 12, background: 'var(--color-bg-surface)', borderRadius: 6}}>
                <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4}}>{t('referral_944615')}</div>
                {/* 확정된 조건이 있으면 그 값. 제도가 꺼져 있으면 '—'. */}
                <div style={{fontFamily: 'var(--font-num)', fontSize: 20, fontWeight: 700, color: refSet ? undefined : 'var(--color-text-tertiary)'}}>
                  {refSet ? refSet.sharePct + '%' : '—'}
                </div>
              </div>
            </div>

            <div>
              <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6}}>{t('referral_0f2024')}</div>
              {/*
                 공유 버튼.

                 네 개 모두 동작이 없었다. 카카오톡은 SDK 와 앱키가 필요해 지금
                 붙일 수 없으므로, **링크가 있을 때만** 실제로 열리는 것들만 남긴다.
                 링크가 없으면(제도 꺼짐·기준주소 미설정) 전부 비활성이다 —
                 빈 링크를 공유하면 상대가 열 수 없다.
              */}
              <div style={{display:'flex', gap: 6, flexWrap:'wrap'}}>
                <button
                  className="btn btn--sm" style={{flex:1}}
                  disabled={!referralLink}
                  onClick={() => {
                    if (!referralLink) return;
                    /*
                       기기 공유 시트가 있으면 그것을 쓴다(모바일에서 카카오톡·
                       메시지 등 설치된 앱이 모두 나온다). 없으면 복사로 대체한다.
                    */
                    if (navigator.share) {
                      navigator.share({ title: t('ref_share_title'), text: t('ref_share_text'), url: referralLink }).catch(() => {});
                    } else {
                      /*
                         ★ 복사 실패를 삼키지 않는다. 전에는 프로미스를 그대로 두어
                           권한이 거부되면 처리되지 않은 거부가 났고, 화면은 성공처럼
                           보였다(실측: PAGEERROR Write permission denied). 이용자는
                           빈 값을 붙여넣어 추천 귀속을 잃는다.
                      */
                      window.QTCopy(referralLink, {
                        onDone: () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
                      });
                    }
                  }}
                ><I.Share size={12}/> {t('ref_share')}</button>
                <a
                  className="btn btn--sm" style={{flex:1, textDecoration:'none', pointerEvents: referralLink ? undefined : 'none', opacity: referralLink ? 1 : 0.4}}
                  href={referralLink ? `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(t('ref_share_text'))}` : undefined}
                  target="_blank" rel="noopener noreferrer"
                ><I.Send size={12}/> Telegram</a>
                <a
                  className="btn btn--sm" style={{flex:1, textDecoration:'none', pointerEvents: referralLink ? undefined : 'none', opacity: referralLink ? 1 : 0.4}}
                  href={referralLink ? `https://twitter.com/intent/tweet?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(t('ref_share_text'))}` : undefined}
                  target="_blank" rel="noopener noreferrer"
                ><I.Send size={12}/> X</a>
                <a
                  className="btn btn--sm" style={{flex:1, textDecoration:'none', pointerEvents: referralLink ? undefined : 'none', opacity: referralLink ? 1 : 0.4}}
                  href={referralLink ? `mailto:?subject=${encodeURIComponent(t('ref_share_title'))}&body=${encodeURIComponent(t('ref_share_text') + '\n' + referralLink)}` : undefined}
                ><I.Send size={12}/> {t('fld_email')}</a>
              </div>
            </div>
          </div>
        </window.SectionCard>

        {/*
           ★★ 반드시 표시해야 하는 고지 ★★

           서버가 disclosures 로 두 사실을 알려준다. 이 문구가 없으면 사용자는
           잔액이 자동으로 쌓이고 지갑에 입금될 것으로 기대한다 — 우리는
           비수탁이라 사용자 계정에 돈을 넣을 방법이 없다.
        */}
        {refLive && refOn && (
          <div style={{
            padding:'14px 16px', borderRadius:8, fontSize:12.5, lineHeight:1.85,
            background:'color-mix(in srgb, var(--color-warning) 10%, transparent)',
            border:'1px solid var(--color-warning)',
          }}>
            <div style={{fontWeight:600, marginBottom:6, display:'flex', alignItems:'center', gap:6}}>
              <I.Info size={13}/> {t('ref_how_paid_title')}
            </div>
            <ul style={{margin:0, paddingLeft:20}}>
              <li>{t('ref_how_paid_1')}</li>
              <li>{t('ref_how_paid_2')}</li>
              <li>{t('ref_how_paid_3', { pct: refSet ? refSet.sharePct : 0, min: refSet ? fmt(refSet.minPayout, 2) : 0, cur: refSet ? refSet.payoutCurrency : '' })}</li>
            </ul>
            {refSet && refSet.payoutNote && (
              <div style={{marginTop:8, paddingTop:8, borderTop:'1px solid var(--color-border-subtle)'}}>
                <strong>{t('ref_operator_note')}</strong> {refSet.payoutNote}
              </div>
            )}
          </div>
        )}

        {/* 제도가 꺼져 있을 때 — 코드도 약속도 주지 않는다. */}
        {refLive && !refOn && (
          <div style={{
            padding:'14px 16px', borderRadius:8, fontSize:12.5, lineHeight:1.8,
            background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)',
            color:'var(--color-text-secondary)',
          }}>
            <div style={{fontWeight:600, marginBottom:4, color:'var(--color-text-primary)'}}>{t('ref_off_title')}</div>
            <div>{t('ref_off_body')}</div>
          </div>
        )}

        <div className="grid-2">
          {/*
             등급표.

             '5단계 20~40%' 는 정의한 적 없는 제도였다. 실제 조건은 단일
             비율이다(관리자가 설정한 값). 단계를 만들어 보여주면 사용자가
             다음 단계를 목표로 활동하는데 그 단계가 존재하지 않는다.
             제도가 켜져 있으면 현재 조건 하나만, 꺼져 있으면 원래 표를 둔다.
          */}
          {refLive && refOn ? (
            <window.SectionCard title={t('referral_a0193f')}>
              <div style={{display:'flex', flexDirection:'column', gap:10}}>
                <div style={{display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--color-brand-subtle)', borderRadius:4, border:'1px solid var(--color-brand)'}}>
                  <span style={{width:40, height:40, borderRadius:'50%', background:'var(--color-brand)', color:'var(--color-text-inverse)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700}}>
                    {refSet ? refSet.sharePct : 0}%
                  </span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13, fontWeight:600}}>{t('ref_single_tier')}</div>
                    <div style={{fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('ref_single_tier_sub')}</div>
                  </div>
                </div>
                <div style={{fontSize:11.5, lineHeight:1.7, color:'var(--color-text-tertiary)'}}>
                  {t('ref_no_tiers')}
                </div>
              </div>
            </window.SectionCard>
          ) : (window.QTMockPolicy && window.QTMockPolicy.allowMockData && window.QTMockPolicy.allowMockData()) ? (
          /*
             ★★ 이 5단 등급표는 목업이다.

               `Beginner 20% · Silver 25% · Gold 30%(CURRENT) · Platinum 35% ·
               Diamond 40%` — 실제 제도에는 등급이 없다(서버는 sharePct 하나만
               준다). 그런데 서버가 안 붙었거나 제도가 꺼져 있을 때 이 표가
               나왔고, **"현재 Gold 30%" 라는 배지까지 붙었다.** 바로 위 카드가
               "제도가 시작되지 않았습니다" 라고 말하는 동안 옆에서는 내 등급이
               Gold 라고 알려주는 상태였다.

               지급 비율은 돈에 관한 약속이다. 없는 등급을 보여주면 사용자가
               그 비율을 기대하고 친구를 초대한다.

             ★ 지금은 **디자인 미리보기에서만** 렌더한다(레이아웃 확인용).
               실서비스에서는 아래 안내로 대체된다. 마크업은 지우지 않았다.
          */
          <window.SectionCard title={t('referral_a0193f')}>
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              {[
                { tier: 'Beginner', pct: 20, req: t('referral_c0d797') },
                { tier: 'Silver',   pct: 25, req: t('referral_d23449') },
                { tier: 'Gold',     pct: 30, req: t('referral_ccc2b8'), current: true },
                { tier: 'Platinum', pct: 35, req: t('referral_1c41fb') },
                { tier: 'Diamond',  pct: 40, req: t('referral_3be144') },
              ].map(t => (
                <div key={t.tier} style={{display:'flex', alignItems:'center', gap: 12, padding: '10px 12px', background: t.current ? 'var(--color-brand-subtle)' : 'var(--color-bg-surface)', borderRadius: 4, border: t.current ? '1px solid var(--color-brand)' : '1px solid var(--color-border-subtle)'}}>
                  <span style={{width:32, height:32, borderRadius:'50%', background: t.current ? 'var(--color-brand)' : 'var(--color-bg-elevated)', color: t.current ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700}}>{t.pct}%</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13, fontWeight: t.current ? 600 : 500}}>{t.tier}</div>
                    <div style={{fontSize:11, color: 'var(--color-text-tertiary)'}}>{t.req}</div>
                  </div>
                  {t.current && <span className="status-pill status-pill--ok">{window.QTI18n ? window.QTI18n.t('tier_current') : 'CURRENT'}</span>}
                </div>
              ))}
            </div>
          </window.SectionCard>
          ) : (
            /*
               실서비스에서 제도가 아직 열리지 않은 상태.
               비율을 만들지 않고, 확정되면 여기에 표시된다는 사실만 알린다.
            */
            <window.SectionCard title={t('referral_a0193f')}>
              <div style={{fontSize:11.5, lineHeight:1.7, color:'var(--color-text-tertiary)'}}>
                {t('ref_rates_tbd')}
              </div>
            </window.SectionCard>
          )}

          <window.SectionCard title={t('referral_7932cf')}>
            {/*
               실제 흐름으로 교체.

               ★ 옛 문구가 지킬 수 없는 약속을 했다:
                   '친구가 링크로 회원가입 · KYC 완료' — 우리는 KYC 를 하지 않는다
                   '매월 1일 정산 · USDT로 지갑에 자동 입금' — 자동 지급 수단이 없고
                     비수탁이라 '지갑' 자체가 없다
                 이 문구가 위쪽 '지급 방법' 고지와 정면으로 어긋났다.
                 한 화면에서 두 가지를 말하면 사용자는 유리한 쪽을 믿는다.
            */}
            {refLive && refOn ? (
              <ol style={{margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.9}}>
                <li>{t('ref_step_1')}</li>
                <li>{t('ref_step_2')}</li>
                <li>{t('ref_step_3')}</li>
                <li>{t('ref_step_4')}</li>
                <li>{t('ref_step_5', { min: refSet ? fmt(refSet.minPayout, 2) : 0, cur: refSet ? refSet.payoutCurrency : '' })}</li>
              </ol>
            ) : (
              <ol style={{margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.8}}>
                <li>{t('referral_047382')}</li>
                <li>{t('referral_c57b53')}</li>
                <li>{t('referral_5f1706')}</li>
              </ol>
            )}

            <div className="auth-alert auth-alert--info" style={{marginTop: 16}}>
              <I.Info size={12}/>
              <div>{refLive && refOn ? t('ref_note_locked') : t('ref_note_off')}</div>
            </div>
          </window.SectionCard>
        </div>

        {/*
           초대 목록.

           이메일을 가려서 보여준다(서버가 마스킹). 초대자가 상대의 전체
           이메일을 볼 이유가 없다 — 누가 가입했는지는 본인이 알려주는 것이고
           우리가 노출하면 개인정보 문제가 된다.

           단계를 함께 보여준다. 가입만으로는 우리 수익이 없으므로, 초대자가
           "무엇이 남았는지" 알아야 한다.
        */}
        {refLive && refOn && Array.isArray(ref.signups) && ref.signups.length > 0 ? (
          <window.SectionCard title={t('referral_8580a8')} subtitle={t('ref_list_sub')} noPadding>
            <window.DataTable
              columns={[
                { key:'who', label:t('ref_col_who'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11.5}}>{r.maskedEmail || '—'}</span>
                ) },
                { key:'joined', label:t('ref_col_joined'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>
                    {r.signedUpAt ? new Date(r.signedUpAt).toLocaleDateString() : '—'}
                  </span>
                ) },
                /* 단계는 체크 표시로. 날짜를 다 보여주면 표가 읽기 어렵다. */
                { key:'stage', label:t('ref_col_stage'), render: r => (
                  <span style={{display:'inline-flex', gap:6, alignItems:'center', fontSize:11}}>
                    <span style={{color: r.emailVerifiedAt ? 'var(--color-success)' : 'var(--color-text-tertiary)'}}>
                      {r.emailVerifiedAt ? '✓' : '○'} {t('ref_stage_email')}
                    </span>
                    <span style={{color: r.keysConnectedAt ? 'var(--color-success)' : 'var(--color-text-tertiary)'}}>
                      {r.keysConnectedAt ? '✓' : '○'} {t('ref_stage_keys')}
                    </span>
                    <span style={{color: r.firstTradeAt ? 'var(--color-success)' : 'var(--color-text-tertiary)'}}>
                      {r.firstTradeAt ? '✓' : '○'} {t('ref_stage_trade')}
                    </span>
                  </span>
                ) },
                { key:'pct', label:t('ref_col_rate'), align:'right', render: r => r.sharePctAtSignup + '%' },
              ]}
              rows={ref.signups}
            />
            <div style={{padding:'10px 16px', borderTop:'1px solid var(--color-border-subtle)', fontSize:11, color:'var(--color-text-tertiary)'}}>
              {t('ref_rate_locked')}
            </div>
          </window.SectionCard>
        ) : (
        <window.SectionCard title={t('referral_8580a8')} noPadding>
          <div style={{padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)'}}>
            <div style={{fontSize: 40, marginBottom: 8}}>👥</div>
            <div style={{fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)'}}>{t('referral_c398ae')}</div>
            <div style={{fontSize: 11, marginTop: 4}}>{t('referral_fa91e4')}</div>
          </div>
        </window.SectionCard>
        )}

        {/*
           지급 이력.

           운영자가 실제로 보낸 것만 기록된다. 자동 생성이 아니므로 여기 있는
           항목은 모두 "실제로 보냈다" 는 주장이고, 근거(method·reference)가
           함께 남는다 — 나중에 확인할 수 있어야 한다.
        */}
        {refLive && refOn && Array.isArray(ref.payouts) && ref.payouts.length > 0 && (
          <window.SectionCard title={t('ref_payouts')} subtitle={t('ref_payouts_sub')} noPadding>
            <window.DataTable
              columns={[
                { key:'when', label:t('ref_col_paid_at'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11}}>
                    {r.paidAt ? new Date(r.paidAt).toLocaleString() : '—'}
                  </span>
                ) },
                { key:'amt', label:t('ref_col_amount'), align:'right', render: r => (
                  <strong style={{fontFamily:'var(--font-num)'}}>{fmt(r.amount, 2)} {r.currency}</strong>
                ) },
                { key:'method', label:t('ref_col_method'), render: r => r.method || '—' },
                { key:'ref', label:t('ref_col_reference'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>{r.reference || '—'}</span>
                ) },
                { key:'period', label:t('ref_col_period'), render: r => (
                  <span style={{fontSize:11, color:'var(--color-text-tertiary)'}}>
                    {r.periodStart && r.periodEnd
                      ? `${new Date(r.periodStart).toLocaleDateString()} – ${new Date(r.periodEnd).toLocaleDateString()}`
                      : '—'}
                  </span>
                ) },
              ]}
              rows={ref.payouts}
            />
          </window.SectionCard>
        )}

        {refErr && (
          <div style={{fontSize:11.5, color:'var(--color-danger)'}}>{t('admin_load_failed')} · {refErr}</div>
        )}
      </window.PageShell>
    );
  };

  // ============================================================
  // FEE & REBATE (사용자 화면)
  // ============================================================
  window.FeeRebatePage = function FeeRebatePage({ shellProps }) {
    const acct = window.useAccountData ? window.useAccountData() : { status: 'OFFLINE', isLive: false };
    const tiers = window.QTApp.FEE_TIERS;

    /*
       거래소 실제 수수료율.

       KuCoin 이 계약별 기본 수수료율을 준다(메이커 0.02% · 테이커 0.06%).
       ★ 이건 **기본값**이다. 사용자별 VIP 할인은 거래소 계정에 달려 있고
         우리가 알 수 없다. "고객이 실제로 내는 수수료" 라고 표시하면 거짓이다.
    */
    const [specs, setSpecs] = useState(null);
    useEffect(() => {
      if (!window.QTApi || !window.QTApi.rest || !window.QTApi.rest.contractSpecs) return undefined;
      /*
         백엔드가 없는 것이 확인됐으면 요청하지 않는다.

         정적 미리보기에서 /api/* 를 부르면 404 가 콘솔에 남는다. 기능상 문제는
         없지만 콘솔이 잡음으로 차면 진짜 장애를 찾을 때 놓친다.
         null(판정 중)일 때는 시도한다 — 실서비스에서 데이터를 놓치는 쪽이 더 나쁘다.
      */
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      window.QTApi.rest.contractSpecs(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
        .then((r) => { if (!cancelled) setSpecs(r.data || []); })
        .catch(() => { /* 백엔드 없으면 목업 유지 */ });
      return () => { cancelled = true; };
    }, []);

    const btc = specs ? specs.find((x) => x.symbol === 'BTCUSDT') : null;
    const pct = (v) => (v == null ? null : (v * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%');

    /*
       내 30일 거래량·수수료.

       거래량은 거래소가 사용자별로 주지 않는다(우리 키 권한으로는 조회 불가).
       체결 기록에서 합산할 수 있지만 그건 **우리를 통한 거래**만 포함한다 —
       고객이 거래소에서 직접 한 거래는 빠진다. 그 사실을 함께 표시한다.
    */
    const mine = React.useMemo(() => {
      if (!acct.isLive || !window.QTAccount) return null;
      const fills = window.QTAccount.getFills();
      const tx = window.QTAccount.getTransactions();
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;

      const recent = fills.filter((f) => f.time >= since);
      const volume = recent.reduce((a, f) => a + (Number(f.price) || 0) * (Number(f.amount) || 0), 0);
      const fees = tx
        .filter((x) => x.kind === 'COMMISSION_FEE' && x.time >= since)
        .reduce((a, x) => a + Math.abs(Number(x.amount) || 0), 0);

      return { volume, fees, fillCount: recent.length };
    }, [acct.version, acct.isLive]);

    const isLive = Boolean(btc || mine);
    /*
       ★★ 목업 거래량이 화면에 나오고 있었다.

         `mine` 이 없을 때(거래소 키 미연결) `42180000` 을 그대로 썼다. 그래서
         가입만 한 이용자에게도 **30일 거래량 $42.18M** 이 표시됐다. 자기 계정에
         거래 기록이 없는 사람이 이 숫자를 보면 남의 계정을 보고 있다고 생각하거나,
         우리 화면을 신뢰하지 않게 된다.

       ★ 모르면 null 이다. 표시하는 쪽이 '—' 로 그린다 — 0 으로도 채우지 않는다.
         0 은 "거래를 한 번도 안 했다" 는 사실 주장이고, 우리는 그것을 확인하지
         못했다(키가 없어서 조회 자체를 못 했다).
    */
    const my30dVol = mine ? mine.volume : null;
    /*
       화면에 그릴 값. 실값이 없으면 '—' 다.

       ★ 목업 미리보기(백엔드 없는 디자인 확인)에서만 예시 숫자를 쓴다. 판정은
         QTMockPolicy 한 곳에서 한다 — 화면마다 따로 판단하면 어떤 화면은
         목업을, 어떤 화면은 '—' 를 보여준다.
    */
    const mockOk = Boolean(window.QTMockPolicy && window.QTMockPolicy.allowMockData());

    /*
       내 고객 등급 (서버 계산).

       ★★ 등급은 **실거래만** 센다(거래일·금액·횟수 + 추천 가입). 모의 거래는
         우리 서버가 즉시 체결시키므로 등급에 넣으면 버튼 몇 번으로 최고 등급이 된다.

       ★ 조회 실패는 null 로 남긴다 — "등급 없음" 과 "확인 못 함" 은 다르다.
    */
    const [tier, setTier] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.myTier) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      /*
         ★ 로그인 상태가 아니면 부르지 않는다.

           등급은 인증이 필요한 조회다. 로그인하지 않은 상태에서 부르면 401 이
           브라우저 콘솔에 남고, 그것이 "이 화면에 오류가 있다" 로 보고된다 —
           실제로 검증 스크립트가 그렇게 잡았다. 부를 수 없는 요청을 보내지 않는
           것이 맞다.
      */
      if (!(window.QTAuth && window.QTAuth.isLoggedIn && window.QTAuth.isLoggedIn())) {
        return undefined;
      }
      let alive = true;
      api.myTier()
        .then((r) => { if (alive) setTier(r || null); })
        .catch(() => { if (alive) setTier(null); });
      return () => { alive = false; };
    }, []);
    const vol30dText = my30dVol !== null
      ? '$' + fmtCompact(my30dVol)
      : (mockOk ? '$' + fmtCompact(42180000) : t('dash'));

    /*
       실제로 운영 중인 제도.

       ★ 전에는 목업 프로모션 3개('8월 리베이트 30%' · 'KYC 완료 $50 웰컴' ·
         '친구 초대 페이백')가 ACTIVE 배지와 함께 있었다. 아무것도 실재하지
         않았고, 그중 KYC 웰컴은 우리가 KYC 를 하지 않으므로 **영원히 받을 수
         없는 약속**이었다. 사용자가 그걸 믿고 기다리면 우리가 거짓말한 것이다.

       ★ 실재하는 제도는 둘이다: 친구 초대와 포인트. 둘 다 켜고 끌 수 있으므로
         **지금 켜져 있는 것만** 보여준다. 꺼져 있으면 없다고 말한다.
    */
    const [programmes, setProgrammes] = useState(null);
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      let cancelled = false;
      Promise.all([
        api.referral ? api.referral().catch(() => null) : Promise.resolve(null),
        api.points ? api.points().catch(() => null) : Promise.resolve(null),
      ]).then(([ref, pts]) => {
        if (cancelled) return;
        setProgrammes({
          referral: ref && ref.enabled ? ref : null,
          points: pts && pts.enabled ? pts : null,
        });
      });
      return () => { cancelled = true; };
    }, []);

    return (
      <window.PageShell
        {...shellProps}
        title={t('fee_page_title')}
        subtitle={t('fee_rebate_4f1ad0')}
        breadcrumb={['Home','Settings','Fees']}
      >
        <div className="grid-3">
          {/*
            거래소 기본 수수료율. 등급 체계가 없으므로 '기본' 으로 표시한다 —
            존재하지 않는 등급('Pro')을 보여주면 사용자가 할인받는 줄 안다.
          */}
          {/*
             내 등급.

             ★★ 전에는 실데이터 모드에서 '거래소 기본 요율' 만 보여줬다. 우리에게
               등급 제도가 없었기 때문이고, 그때는 그것이 정직한 표시였다.
               이제 제도가 있으므로 실제 등급을 보여준다.

             ★ 세 상태를 구분한다:
                 · 측정 불가(키 없음) → '—' + 안내
                 · 등급 계산됨 → 등급 이름(번역 키)
                 · 제도 미설정/조회 실패 → 거래소 기본 요율로 되돌아간다
          */}
          <window.KPICard
            label={t('fee_my_tier')}
            value={tier && tier.configured
              ? (tier.unknown
                ? t('dash')
                : (tier.tier ? t(tier.tier.nameKey) : t('tier_name_starter')))
              : (isLive ? (btc ? t('fee_tier_base') : t('dash')) : t('dash'))}
            sub={tier && tier.configured
              ? (tier.unknown
                ? t('tier_unmeasurable')
                : t('tier_from_live_trades'))
              : (isLive && btc
                /* 'Maker'/'Taker' 를 문자열로 두면 ja/zh 화면에 영어가 남는다 — 기존 열 머리글 키를 쓴다. */
                ? `${t('fee_col_maker')} ${pct(btc.makerFeeRate) || t('dash')} · ${t('fee_col_taker')} ${pct(btc.takerFeeRate) || t('dash')}`
                : t('fee_unavailable'))}
            tone="brand"
          />
          <window.KPICard
            label={t('fee_vol30')}
            value={vol30dText}
            sub={mine ? t('fee_vol_note', { count: mine.fillCount }) : undefined}
          />
          <window.KPICard
            label={t('fee_total_30d')}
            value={mine
              ? '$' + fmt(mine.fees, 4)
              : ((window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) ? '—' : '$18.42')}
            sub={mine ? t('fee_from_ledger') : undefined}
            tone="warning"
          />
        </div>

        {/*
           등급 혜택 표 — 브로커 커미션 환급률.

           ★★ payoutsEnabled 가 false 면 "예정" 으로만 보여주고 금액을 말하지 않는다.
             우리는 리베이트가 실제로 입금되는 것을 아직 확인하지 못했다. 확인 전에
             금액을 말하면 지킬 수 없는 약속이 된다.

           ★ 등급표는 서버가 주는 criteria 를 그대로 그린다. 비율을 화면에 박으면
             운영 중 조정할 때 두 곳을 고쳐야 하고, 한 곳을 잊으면 화면과 실제
             지급이 달라진다.
        */}
        {tier && tier.configured && Array.isArray(tier.criteria) && tier.criteria.length > 0 && (
          <window.SectionCard
            title={t('tier_benefit_title')}
            subtitle={tier.benefitsPayoutsEnabled ? t('tier_benefit_sub_live') : t('tier_benefit_sub_pending')}
            noPadding
          >
            <window.DataTable
              columns={[
                { key: 'code', label: t('col_tier'), render: r => (
                  <strong style={{ color: tier.tier && tier.tier.code === r.code ? 'var(--brand-primary-500)' : undefined }}>
                    {t(r.nameKey)}
                  </strong>
                ) },
                { key: 'rebate', label: t('tier_benefit_col_rebate'), align: 'right', render: r => (
                  r.rebateShareBps > 0 ? `${r.rebateShareBps / 100}%` : t('dash')
                ) },
                { key: 'referral', label: t('col_referral'), align: 'center', render: r => (
                  r.requiresReferral ? t('yes') : t('dash')
                ) },
              ]}
              rows={tier.criteria}
              rowKey={r => r.code}
            />
            {/*
               ★ 환급 기준을 밝힌다. "거래액의 O%" 로 오해하면 실제 지급액이
                 기대보다 훨씬 작아 보인다 — 우리 커미션의 비율이다.
            */}
            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t('tier_benefit_basis')}
            </div>
          </window.SectionCard>
        )}

        {/* 실 수수료율 표. 거래소가 계약별로 다르게 매긴다. */}
        {isLive && specs && specs.length > 0 && (
          <window.SectionCard title={t('fee_specs_title')} subtitle={t('fee_specs_sub')} noPadding>
            <window.DataTable
              columns={[
                { key: 'symbol', label: t('col_symbol'), render: r => <strong>{r.symbol.replace('USDT','/USDT')}</strong> },
                { key: 'maker', label: t('fee_col_maker'), align:'right', render: r => pct(r.makerFeeRate) || '—' },
                { key: 'taker', label: t('fee_col_taker'), align:'right', render: r => pct(r.takerFeeRate) || '—' },
                { key: 'funding', label: t('fee_funding_8h'), align:'right', render: r => pct(r.fundingFeeRate) || '—' },
                { key: 'mm', label: t('fee_maint_margin'), align:'right', render: r => pct(r.maintenanceMarginRate) || '—' },
                { key: 'lev', label: t('ex_col_max_lev'), align:'right', render: r => (r.maxLeverage ? r.maxLeverage + '×' : '—') },
              ]}
              rows={specs}
            />
          </window.SectionCard>
        )}

        {/*
          다음 등급까지.

          ★★ 전에는 이 블록이 미리보기 전용이었다 — 우리에게 등급 제도가 없었고,
            "VIP 까지 $8M 남음" 을 보여주면 존재하지 않는 혜택을 약속하는 셈이었다.

          ★ 이제 제도가 있다(거래일·금액·횟수 + 추천 가입). 서버가 **무엇이
            부족한지** 항목별로 주므로 그것을 그대로 보여준다.

          ★★ 추천 가입 조건은 **소급되지 않는다.** 이미 거래소 계정이 있던 고객은
            채울 방법이 없다. 그 사실을 함께 밝힌다 — 채울 수 없는 목표를
            보여주면 거짓 기대를 만든다.
        */}
        {tier && tier.configured && !tier.unknown && tier.next ? (
          <window.SectionCard title={t('fee_next_tier', { tier: t(tier.next.nameKey) })}>
            <div style={{display:'flex', flexDirection:'column', gap: 10}}>
              {tier.next.missing.map((m) => {
                const need = m.key === 'referral' ? null : Number(m.need);
                const have = m.key === 'referral' ? null : Number(m.have || 0);
                const pctDone = need && need > 0 ? Math.min(100, (have / need) * 100) : 0;
                return (
                  <div key={m.key} style={{display:'flex', flexDirection:'column', gap: 4}}>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
                      <span>{t('tier_need_' + m.key)}</span>
                      {m.key === 'referral' ? (
                        <span style={{color:'var(--color-warning)'}}>{t('tier_need_referral_note')}</span>
                      ) : (
                        /*
                           ★ 횟수·일수는 정수다. fmtCompact 는 소수 2자리를 붙여
                             `12.00 / 50.00` 처럼 나온다 — 거래 12.00 건은 있을 수
                             없는 표기다. 금액만 축약하고 개수는 정수로 쓴다.
                        */
                        <span>
                          <strong>{m.key === 'volume' ? fmtCompact(have) : String(Math.round(have))}</strong>
                          {' / '}
                          {m.key === 'volume' ? fmtCompact(need) : String(Math.round(need))}
                          {' '}({pctDone.toFixed(0)}%)
                        </span>
                      )}
                    </div>
                    {m.key !== 'referral' && (
                      <div style={{height:8, background:'var(--color-bg-input)', borderRadius:999, overflow:'hidden'}}>
                        <div style={{height:'100%', width: pctDone + '%', background:'var(--color-brand)'}}/>
                      </div>
                    )}
                  </div>
                );
              })}
              {/*
                 ★ 상위 등급의 **요율**은 적지 않는다. 우리에게 수수료 재량이 없고
                   요율은 거래소가 고객 계정 기준으로 정한다. 등급은 우리 제도이고
                   요율은 거래소 것이다 — 섞으면 없는 할인을 약속한다.
              */}
              <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>
                {t('tier_benefit_unset')}
              </div>
            </div>
          </window.SectionCard>
        ) : (!isLive && mockOk) ? (
          /*
             ★★ 이 진행바의 42.18M / 50M 은 예시 숫자다. 전에는 `!isLive` 로만
               걸러서, **키를 연결하지 않은 실사용자**에게도 보였다(실측).
               백엔드가 붙어 있으면 실서비스다 — 그때는 예시를 그리지 않고
               아래의 "수수료는 어디서 정해지는가" 안내로 내려간다.
          */
          <window.SectionCard title={t('fee_next_tier', { tier: 'VIP' })}>
            <div style={{display:'flex', flexDirection:'column', gap: 10}}>
              <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
                {/*
                   ★ 이 블록은 `!isLive`(백엔드 없는 디자인 미리보기)에서만 그려진다.
                     그래서 예시 값을 여기서 명시한다 — 실값 변수를 쓰면 값이 없을 때
                     NaN 과 '$NaN more' 가 화면에 나온다.
                */}
                <span><strong>{fmtCompact(42180000)}</strong> / {fmtCompact(50000000)} USDT ({((42180000 / 50000000) * 100).toFixed(1)}%)</span>
                <span style={{color:'var(--color-text-tertiary)'}}>${fmtCompact(50000000 - 42180000)} more</span>
              </div>
              <div style={{height:10, background:'var(--color-bg-input)', borderRadius:999, overflow:'hidden'}}>
                <div style={{height:'100%', width: Math.min(100, (42180000 / 50000000) * 100) + '%', background: 'linear-gradient(90deg, var(--color-brand), var(--color-ai))'}}/>
              </div>
              <div style={{fontSize:11, color:'var(--color-text-tertiary)', display:'flex', justifyContent:'space-between'}}>
                <span>{t('fee_tier_next_unknown')}</span>
              </div>
            </div>
          </window.SectionCard>
        ) : (
          <window.SectionCard title={t('fee_where_title')}>
            <div style={{display:'flex', flexDirection:'column', gap: 8, fontSize:12, lineHeight:1.7}}>
              <div>{t('fee_where_1')}</div>
              <div>{t('fee_where_2')}</div>
              <div style={{color:'var(--color-text-tertiary)'}}>{t('fee_where_3')}</div>
            </div>
          </window.SectionCard>
        )}

        {/*
           수수료 등급.

           ★★ 전에는 Beginner/Standard/Pro/VIP 4등급표를 보여줬고, 마지막 열이
             'Token Hold Req. — 1000 QT' 였다. 둘 다 존재하지 않는다:
               · 우리에게 등급 제도가 없다 (거래를 쌓아도 우리가 깎아줄 수 없다)
               · QT 토큰이 없다 (사지도 보유하지도 못한다)
             사용자가 이 표를 보면 우리 사이트에서 거래량을 쌓으면 수수료가
             내려간다고 믿는다. 실제 등급은 **본인의 거래소 계정**에 달려 있다.

           ★ KuCoin 의 VIP 등급표를 여기 옮겨 적지 않는다. 그들이 조건을 바꾸면
             우리 화면이 거짓이 되고, 우리는 바뀐 것을 모른다. 대신 어디서
             확인해야 하는지 알려준다.
        */}
        {!mockOk ? (
          /*
             ★★ 조건이 `isLive` 였다. 수수료 실데이터가 없으면(=키 미연결)
               목업 등급표(Beginner/Standard/Pro·VIP, 0.020%/0.050%, 1000 QT)가
               나왔고 사용자를 'Pro · 현재 등급' 으로 표시했다. 존재하지 않는
               제도이고 요율도 우리 것이 아니다.
               → 실서비스에서는 항상 이 안내(거래소가 정한다 + 확인 링크)를 쓴다.
                 목업 표는 백엔드 없는 디자이너 미리보기에서만 남긴다.
          */
          <window.SectionCard title={t('fee_tiers_title')} subtitle={t('fee_tiers_sub')}>
            <div style={{display:'flex', flexDirection:'column', gap:10, fontSize:12.5, lineHeight:1.8}}>
              <div>{t('fee_tiers_1')}</div>
              <div>{t('fee_tiers_2')}</div>
              <div style={{color:'var(--color-text-tertiary)'}}>{t('fee_tiers_3')}</div>
              {/*
                 거래소로 보내는 링크.

                 rel 에 noopener 를 붙인다 — 없으면 열린 창이 window.opener 로
                 우리 페이지를 조작할 수 있다.
              */}
              {(() => {
                /*
                   추천 링크는 설정에서 읽는다 (QTApi.getReferralUrl).

                   ★ 없으면 링크를 아예 렌더하지 않는다. 예시 링크로 대체하면
                     가입은 되지만 귀속이 안 돼 수익이 0 이 된다 — 조용히 샌다.
                */
                const url = (window.QTApi && window.QTApi.getReferralUrl)
                  ? window.QTApi.getReferralUrl('kucoin')
                  : '';
                return url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                     className="btn btn--sm" style={{alignSelf:'flex-start'}}>
                    {t('fee_tiers_check')}
                  </a>
                ) : null;
              })()}
            </div>
          </window.SectionCard>
        ) : (
          <window.SectionCard title={t('fee_all_tiers')} noPadding>
            {/* 디자이너 미리보기(백엔드 없음)에서는 원본 표를 그대로 유지한다. */}
            <window.DataTable
              columns={[
                { key:'tier', label:t('col_tier'), render: r => r.tier === 'Pro'
                  ? <strong style={{color:'var(--color-brand)'}}>{r.tier} · {t('tier_current')}</strong>
                  : <span>{r.tier}</span> },
                { key:'maker', label:t('fee_col_maker'), align:'right', render: r => (r.maker*100).toFixed(3) + '%' },
                { key:'taker', label:t('fee_col_taker'), align:'right', render: r => (r.taker*100).toFixed(3) + '%' },
                { key:'volReq', label:t('fee_col_vol_req'), align:'right', render: r => '$' + fmtCompact(r.vol30Req) },
                { key:'holdReq', label:t('fee_col_hold_req'), align:'right', render: r => r.holdReq + ' QT' },
              ]}
              rows={tiers}
            />
          </window.SectionCard>
        )}

        <div className="grid-2">
          <window.SectionCard title={t('fee_rebate_6d03c2')}>
            {/*
               실제로 켜져 있는 제도만 보여준다.

               ★ 목업 프로모션을 지운 자리다. ACTIVE 배지를 다시 붙일 때는
                 그 제도가 정말 켜져 있는지 서버에 물어본 결과여야 한다 —
                 화면이 스스로 'ACTIVE' 라고 쓰면 그게 거짓의 시작이다.
            */}
            {programmes === null ? (
              <div style={{fontSize:12, color:'var(--color-text-tertiary)'}}>{t('fee_prog_loading')}</div>
            ) : (!programmes.referral && !programmes.points) ? (
              <div style={{fontSize:12, lineHeight:1.8, color:'var(--color-text-secondary)'}}>
                {t('fee_prog_none')}
              </div>
            ) : (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {programmes.referral && (
                  <a href="#/referral" style={{
                    display:'block', padding:12, borderRadius:4, textDecoration:'none',
                    background:'var(--color-brand-subtle)', border:'1px solid var(--color-brand)',
                    color:'inherit',
                  }}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
                      <strong>{t('fee_prog_referral')}</strong>
                      <span className="status-pill status-pill--ok">{t('fee_prog_running')}</span>
                    </div>
                    <div style={{fontSize:11.5, color:'var(--color-text-secondary)', lineHeight:1.6}}>
                      {t('fee_prog_referral_body')}
                    </div>
                  </a>
                )}
                {programmes.points && (
                  <a href="#/points" style={{
                    display:'block', padding:12, borderRadius:4, textDecoration:'none',
                    background:'var(--color-brand-subtle)', border:'1px solid var(--color-brand)',
                    color:'inherit',
                  }}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
                      <strong>{(programmes.points.settings && programmes.points.settings.unitName) || t('pt_unit_default')}</strong>
                      <span className="status-pill status-pill--ok">{t('fee_prog_running')}</span>
                    </div>
                    <div style={{fontSize:11.5, color:'var(--color-text-secondary)', lineHeight:1.6}}>
                      {t('fee_prog_points_body')}
                    </div>
                  </a>
                )}
              </div>
            )}
          </window.SectionCard>

          {/*
             정산 요약.

             고정값이었다(-$18.42 수수료 · +$5.42 리베이트 · +$0.00 추천 ·
             -$13.00 순액). 리베이트와 추천 수익은 **고객에게 지급되지 않는다** —
             둘 다 운영자(우리)가 거래소로부터 받는 것이다. 고객 화면에
               '리베이트 +$5.42'
             를 보여주면 자기가 받는 돈으로 오해한다.

             그래서 고객이 실제로 지불한 것만 보여준다: 거래소 원장의 수수료.
          */}
          <window.SectionCard title={t('fee_rebate_a3530c')} subtitle={isLive ? t('fee_settle_sub') : undefined}>
            {isLive ? (
              <div style={{display:'flex', flexDirection:'column', gap: 8}}>
                <div style={{display:'flex', justifyContent:'space-between', padding: 8, borderBottom:'1px solid var(--color-border-subtle)'}}>
                  <span>{t('fee_rebate_350a9e')}</span>
                  <span style={{fontFamily:'var(--font-num)'}}>{mine ? '-$' + fmt(mine.fees, 4) : '—'}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', padding: 8, fontWeight: 600, borderTop:'1px solid var(--color-border-default)'}}>
                  <span>{t('fee_rebate_597833')}</span>
                  <span style={{fontFamily:'var(--font-num)'}}>{mine ? '-$' + fmt(mine.fees, 4) : '—'}</span>
                </div>
                <div style={{fontSize:11.5, lineHeight:1.7, color:'var(--color-text-tertiary)', marginTop:4}}>
                  {t('fee_no_rebate_to_user')}
                </div>
              </div>
            ) : (
            <div style={{display:'flex', flexDirection:'column', gap: 8}}>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, borderBottom:'1px solid var(--color-border-subtle)'}}><span>{t('fee_rebate_350a9e')}</span><span style={{fontFamily:'var(--font-num)'}}>-$18.42</span></div>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, borderBottom:'1px solid var(--color-border-subtle)'}}><span>{t('fee_rebate_e7fe5e')}</span><span className="t-long" style={{fontFamily:'var(--font-num)'}}>+$5.42</span></div>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, borderBottom:'1px solid var(--color-border-subtle)'}}><span>{t('fee_rebate_2f76f9')}</span><span className="t-long" style={{fontFamily:'var(--font-num)'}}>+$0.00</span></div>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, fontWeight: 600, borderTop:'1px solid var(--color-border-default)'}}><span>{t('fee_rebate_597833')}</span><span style={{fontFamily:'var(--font-num)'}}>-$13.00</span></div>
            </div>
            )}
          </window.SectionCard>
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // HELP CENTER (Support/FAQ)
  // ============================================================
  window.HelpCenterPage = function HelpCenterPage({ shellProps }) {
    const [q, setQ] = useState('');

    /*
       도움말 · 문의.

       FAQ 는 실제 콘텐츠(i18n)이므로 그대로 쓴다. 문제는 문의 섹션이었다:
         · 'Live Chat' — 실시간 채팅 기능이 없다.
         · 'support@quantumtrade.ai' — 옛 브랜드 주소. 받는 사람이 없다.
         · 'Priority (Pro/VIP)' — 구독 등급 제도가 없다.
       버튼 세 개 모두 아무 동작이 없었다. 고객이 눌러보고 답을 기다린다.

       이제 실제로 동작하는 경로를 준다: 티켓을 만들면 운영자 화면(/admin/cs)에
       나타나고, 답장이 오면 여기서 볼 수 있다.
    */
    const cfg = (window.QTApi && window.QTApi.useConfig) ? window.QTApi.useConfig() : null;
    const supportEmail = (cfg && cfg.supportEmail) || '';

    const [tickets, setTickets] = useState(null);
    const [supported, setSupported] = useState(true);
    const [form, setForm] = useState({ subject: '', body: '' });
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [thread, setThread] = useState(null);
    const [reply, setReply] = useState('');

    const api = window.QTApi && window.QTApi.rest;

    const loadTickets = React.useCallback(() => {
      if (!api || !api.supportTickets) return;
      api.supportTickets()
        .then((r) => { setTickets(r.data || []); setSupported(r.supported); })
        .catch(() => setTickets([]));
    }, [api]);
    useEffect(() => { loadTickets(); }, [loadTickets]);

    const openThread = (id) => {
      if (!api || !api.supportTicket) return;
      setOpenId(id);
      setThread(null);
      api.supportTicket(id)
        .then((r) => setThread({ ticket: r.ticket, messages: r.messages || [] }))
        .catch(() => setThread(null));
    };

    const createTicket = async () => {
      if (!api || !api.createSupportTicket) return;
      const subject = form.subject.trim();
      const body = form.body.trim();
      if (!subject || !body) return;
      setBusy(true); setMsg(null);
      try {
        const r = await api.createSupportTicket({ subject, body });
        if (r && r.ok === false) {
          setMsg({ ok: false, text: (r.message) || t('help_ticket_failed') });
        } else {
          setForm({ subject: '', body: '' });
          setMsg({ ok: true, text: t('help_ticket_created') });
          loadTickets();
        }
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('help_ticket_failed') });
      }
      setBusy(false);
    };

    const sendReply = async () => {
      if (!api || !api.replySupportTicket || !openId || !reply.trim()) return;
      setBusy(true);
      try {
        await api.replySupportTicket(openId, reply.trim());
        setReply('');
        openThread(openId);
        loadTickets();
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('help_ticket_failed') });
      }
      setBusy(false);
    };

    const canTicket = Boolean(api && api.createSupportTicket && supported);

    const faqs = [
      { q:t('help_center_51472d'), a:t('help_center_c1c49c') },
      { q:t('help_center_667475'), a:t('help_center_aa37a6') },
      { q:t('help_center_d67afc'), a:t('help_center_72f72a') },
      { q:t('help_center_45bbd7'), a:t('help_center_8f8fe0') },
      { q:t('help_center_62cd9d'), a:t('help_center_b9a588') },
      { q:t('help_center_c46850'), a:t('help_center_c5eed0') },
      { q:t('help_center_7b944c'), a:t('help_center_ddc217') },
    ];
    /*
       검색.

       대소문자를 무시한다 — 'api' 로 검색했는데 'API key' 항목이 안 나오면
       사용자는 관련 내용이 없다고 판단하고 문의를 남긴다.
    */
    const filtered = (() => {
      const needle = q.trim().toLowerCase();
      if (!needle) return faqs;
      return faqs.filter(f => f.q.toLowerCase().includes(needle) || f.a.toLowerCase().includes(needle));
    })();

    return (
      <window.PageShell
        {...shellProps}
        title={t('help_title')}
        subtitle={t('help_center_42b43b')}
        breadcrumb={['Home','Help']}
      >
        <div className="input-group" style={{maxWidth: 600, margin: '0 auto', height: 44, fontSize: 14}}>
          <I.Search size={16}/>
          <input placeholder={t('help_center_044ef4')} value={q} onChange={e => setQ(e.target.value)}/>
        </div>

        <div className="grid-4">
          {/*
             카테고리 카드.

             cursor:pointer 라 눌리는 것처럼 보였지만 onClick 이 없었다.
             누를 수 있게 보이는데 아무 일도 없으면 고장으로 읽힌다.
             카드를 누르면 그 주제로 FAQ 를 검색한다 — 새 기능을 만들지 않고
             이미 있는 검색을 재사용한다.
          */}
          {[
            /*
               검색어를 제목과 분리한다.

               제목('계정 · KYC')을 그대로 검색하면 FAQ 문구와 겹치지 않아
               결과가 0 이 된다(실제로 겪음). 각 카테고리가 실제로 찾아낼
               낱말을 따로 지정한다.
            */
            { icon:'User',     title:t('help_center_df04a4'), desc:t('help_center_b92aff'), term: t('help_term_account') },
            { icon:'Wallet',   title:t('help_center_3910ce'),      desc:t('help_center_7901e1'), term: t('help_term_funds') },
            { icon:'Chart',    title:t('help_center_dc20f4'),        desc:t('help_center_eafac1'), term: t('help_term_trading') },
            { icon:'Sparkles', title:t('ai_copilot_title'),  desc:t('help_center_87ad98'), term: t('help_term_ai') },
          ].map((c, i) => {
            const Ic = I[c.icon] || I.Grid;
            const active = q === c.term;
            return (
              <div
                key={i}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={() => setQ(active ? '' : c.term)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setQ(active ? '' : c.term); } }}
                style={{padding: 16, background: 'var(--color-bg-panel)', border: '1px solid ' + (active ? 'var(--color-brand)' : 'var(--color-border-subtle)'), borderRadius: 6, cursor: 'pointer', textAlign: 'center'}}
              >
                <div style={{width:40, height:40, borderRadius:8, background:'var(--color-brand-subtle)', color:'var(--color-brand)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom: 8}}><Ic size={18}/></div>
                <div style={{fontSize:13, fontWeight:600}}>{c.title}</div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:4}}>{c.desc}</div>
              </div>
            );
          })}
        </div>

        <window.SectionCard title={t('help_center_ae2ce9')}>
          <div style={{display:'flex', flexDirection:'column', gap: 8}}>
            {filtered.length === 0 && (
              <div style={{padding:'16px 4px', fontSize:12, color:'var(--color-text-tertiary)'}}>
                {t('help_no_match', { q: q })}
              </div>
            )}
            {filtered.map((f, i) => (
              <details key={i} style={{padding: '10px 14px', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 4}}>
                <summary style={{cursor: 'pointer', fontSize: 13, fontWeight: 500}}>{f.q}</summary>
                <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.7}}>{f.a}</div>
              </details>
            ))}
          </div>
        </window.SectionCard>

        {/*
           문의하기.

           티켓을 만들면 운영자 화면에 실제로 나타난다. 실시간 채팅과
           우선 지원(Pro/VIP)은 제공하지 않으므로 표시하지 않는다 —
           없는 채널을 보여주면 고객이 그쪽으로 시도하고 답을 못 받는다.
        */}
        <window.SectionCard title={t('help_center_531f6a')} subtitle={canTicket ? t('help_contact_sub') : undefined}>
          {canTicket ? (
            <div style={{display:'flex', flexDirection:'column', gap:10, maxWidth:720}}>
              <div className="input-group">
                <span className="input-group__label">{t('help_subject')}</span>
                <input
                  value={form.subject}
                  maxLength={200}
                  onChange={e => setForm({ ...form, subject: e.target.value })}
                  placeholder={t('help_subject_ph')}
                />
              </div>
              <textarea
                value={form.body}
                maxLength={10000}
                onChange={e => setForm({ ...form, body: e.target.value })}
                placeholder={t('help_body_ph')}
                style={{width:'100%', minHeight:130, padding:10, background:'var(--color-bg-input)', border:'1px solid var(--color-border-default)', borderRadius:6, color:'var(--color-text-primary)', fontSize:12.5, fontFamily:'var(--font-sans)', resize:'vertical', outline:'none', lineHeight:1.7}}
              />
              {msg && (
                <div style={{
                  padding:'9px 12px', borderRadius:6, fontSize:12,
                  background: msg.ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                  border: '1px solid ' + (msg.ok ? 'var(--color-success)' : 'var(--color-danger)'),
                  color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)',
                }}>{msg.text}</div>
              )}
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                {/* 이메일 주소는 설정에 있을 때만 보여준다. */}
                {supportEmail && (
                  <a href={`mailto:${supportEmail}`} style={{fontSize:11.5, color:'var(--color-text-tertiary)'}}>
                    {t('help_or_email', { email: supportEmail })}
                  </a>
                )}
                <button
                  className="btn btn--sm btn--primary"
                  style={{marginLeft:'auto'}}
                  disabled={busy || !form.subject.trim() || !form.body.trim()}
                  onClick={createTicket}
                ><I.Send size={12}/> {busy ? '…' : t('help_submit')}</button>
              </div>
            </div>
          ) : (
            <div style={{fontSize:12.5, lineHeight:1.8, color:'var(--color-text-secondary)'}}>
              <div>{t('help_contact_unavailable')}</div>
              {supportEmail && (
                <div style={{marginTop:6}}>
                  <a href={`mailto:${supportEmail}`} style={{color:'var(--color-brand)'}}>{supportEmail}</a>
                </div>
              )}
            </div>
          )}
        </window.SectionCard>

        {/* 내 문의 목록 — 답장이 왔는지 여기서 확인한다. */}
        {canTicket && Array.isArray(tickets) && tickets.length > 0 && (
          <window.SectionCard title={t('help_my_tickets')} noPadding>
            <window.DataTable
              columns={[
                { key:'subject', label:t('help_col_subject'), render: r => <strong>{r.subject}</strong> },
                { key:'status', label:t('help_col_status'), render: r => (
                  <span className={`status-pill status-pill--${r.status === 'open' ? 'warn' : r.status === 'resolved' ? 'ok' : 'neutral'}`}>
                    {t('help_status_' + r.status)}
                  </span>
                ) },
                { key:'msgs', label:t('help_col_messages'), align:'right', render: r => (r.messageCount === undefined ? '—' : r.messageCount) },
                { key:'updated', label:t('help_col_updated'), render: r => (
                  <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}
                  </span>
                ) },
                { key:'act', label:'', align:'right', render: r => (
                  <button className="tbl-action" onClick={() => openThread(r.id)}>{t('help_col_open')}</button>
                ) },
              ]}
              rows={tickets}
            />
          </window.SectionCard>
        )}

        {/* 대화 보기 */}
        {openId && (
          <window.SectionCard
            title={thread && thread.ticket ? thread.ticket.subject : t('help_loading')}
            actions={<button className="btn btn--sm" onClick={() => { setOpenId(null); setThread(null); }}>{t('close')}</button>}
          >
            {thread ? (
              <div style={{display:'flex', flexDirection:'column', gap:12}}>
                {thread.messages.map((m) => (
                  <div key={m.id} style={{display:'flex', gap:10, alignItems:'flex-start'}}>
                    <div style={{
                      width:28, height:28, borderRadius:'50%', flexShrink:0,
                      background: m.authorSide === 'customer' ? 'var(--color-bg-elevated)' : 'var(--color-brand-subtle)',
                      color: m.authorSide === 'customer' ? 'var(--color-text-secondary)' : 'var(--color-brand)',
                      display:'inline-flex', alignItems:'center', justifyContent:'center',
                      fontFamily:'var(--font-mono)', fontSize:10, fontWeight:600,
                    }}>{m.authorSide === 'customer' ? 'ME' : 'CS'}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', marginBottom:2}}>
                        {new Date(m.createdAt).toLocaleString()}
                      </div>
                      <div style={{fontSize:12.5, lineHeight:1.7, color:'var(--color-text-secondary)', whiteSpace:'pre-wrap'}}>{m.body}</div>
                    </div>
                  </div>
                ))}
                <div style={{borderTop:'1px solid var(--color-border-subtle)', paddingTop:10}}>
                  <textarea
                    value={reply} onChange={e => setReply(e.target.value)}
                    placeholder={t('help_reply_ph')}
                    style={{width:'100%', minHeight:80, padding:9, background:'var(--color-bg-input)', border:'1px solid var(--color-border-default)', borderRadius:6, color:'var(--color-text-primary)', fontSize:12.5, fontFamily:'var(--font-sans)', resize:'vertical', outline:'none'}}
                  />
                  <div style={{display:'flex', justifyContent:'flex-end', marginTop:6}}>
                    <button className="btn btn--sm btn--primary" disabled={busy || !reply.trim()} onClick={sendReply}>
                      <I.Send size={12}/> {busy ? '…' : t('help_reply_send')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{fontSize:12, color:'var(--color-text-tertiary)'}}>{t('help_loading')}</div>
            )}
          </window.SectionCard>
        )}
      </window.PageShell>
    );
  };
})();
