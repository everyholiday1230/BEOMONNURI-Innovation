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
  const { useState, useEffect, useMemo, useRef } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
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
    const [step, setStep] = useState(1);
    const [form, setForm] = useState({ label: 'Main Trading', apiKey: '', apiSecret: '', passphrase: '', ipRestrict: true });
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    if (!exchange) return null;

    /** 저장된 자격증명 id. 검증·삭제에 쓴다. */
    const [credentialId, setCredentialId] = useState(null);

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

    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" style={{width: 560, maxHeight: '90vh'}} onClick={e => e.stopPropagation()}>
          <div className="modal__header">
            <div style={{display:'flex', alignItems:'center', gap: 12}}>
              <div className="exchange-card__logo" style={{width:32, height:32, background: exchange.logoBg, color: exchange.logoColor, borderRadius:6, fontSize: 12}}>{exchange.logoText}</div>
              <div>
                <div className="modal__title">{t("wiz_title", { exchange: exchange.name })}</div>
                <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)'}}>Step {step} of 4</div>
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
                <div style={{fontSize: 14, fontWeight: 600}}>{t("wiz_step1_q", { exchange: exchange.name })}</div>
                <p style={{fontSize: 12.5, color:'var(--color-text-secondary)', lineHeight:1.7, margin:0}}>
                  {t('wiz_signup_a')}<strong>{t('wiz_signup_link')}</strong>{t('wiz_signup_b')}<strong>{window.QTI18n ? window.QTI18n.formatRebate(exchange.referralRebate) : ''}</strong>{t('wiz_signup_c')}
                </p>
                <a href={exchange.referral} target="_blank" className="wizard-referral-card">
                  <div className="wizard-referral-card__icon"><I.Sparkles size={20}/></div>
                  <div style={{flex: 1}}>
                    <div style={{fontWeight: 600, fontSize: 13}}>{t('exchange_connect_wizard_acfc61')}</div>
                    <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>{window.QTI18n ? window.QTI18n.formatRebate(exchange.referralRebate) : ''}</div>
                    <div style={{fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 4}}>{t('exchange_connect_wizard_ca4b74')}</div>
                  </div>
                  <div style={{color: 'var(--color-brand)'}}><I.ArrowRight size={16}/></div>
                </a>
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
                  <span className="input-group__label">Label</span>
                  <input value={form.label} onChange={e => setForm({...form, label: e.target.value})}/>
                </div>

                <div className="input-group">
                  <span className="input-group__label">API Key</span>
                  <input type="password" placeholder={t('exchange_connect_wizard_267402')} value={form.apiKey} onChange={e => setForm({...form, apiKey: e.target.value})}/>
                </div>

                <div className="input-group">
                  <span className="input-group__label">API Secret</span>
                  <input type="password" placeholder={t('exchange_connect_wizard_344324')} value={form.apiSecret} onChange={e => setForm({...form, apiSecret: e.target.value})}/>
                </div>

                {exchange.required.includes('passphrase') && (
                  <div className="input-group">
                    <span className="input-group__label">Passphrase</span>
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

    const address = {
      TRC20: 'TXqYJx7v3F4H6f8mZL1n2VG9r8sBaeK7wN',
      ERC20: '0x7d8f3B4E5c6A9F2b1D3E8f0A5C7B9D2E4F6A8B0C',
      BEP20: '0x9F2b1D3E8f0A5C7B9D2E4F6A8B0C7d8f3B4E5c6A',
      Solana: 'DYw8jCTKfWpZbCXG7QP7VbYUqSJmZ4xF9C8vNq3Kt8Rj',
    }[network] || '';

    const historyEntries = [
      { time: Date.now()-1000*60*30,   asset: 'USDT', amount: 1000.00, network: 'TRC20', status: 'completed', txId: '3f4e5c6a...' },
      { time: Date.now()-1000*60*60*4, asset: 'BTC',  amount:    0.05, network: 'BTC',   status: 'completed', txId: 'a1b2c3d4...' },
      { time: Date.now()-1000*60*60*8, asset: 'USDT', amount:  500.00, network: 'ERC20', status: 'pending',   txId: 'b2c3d4e5...' },
    ];

    return (
      <window.PageShell
        {...shellProps}
        title={t('deposit_b9ca11')}
        subtitle={t('deposit_65292b')}
        breadcrumb={['Home','Wallet','Deposit']}
      >
        <div className="grid-2-1">
          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            <window.SectionCard title={t('deposit_1bcffc')}>
              <div style={{display:'flex', flexDirection:'column', gap: 12}}>
                <div>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>Asset</div>
                  <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                    {['USDT','BTC','ETH','SOL','BNB','USDC'].map(a => (
                      <button key={a} className={`btn btn--sm ${asset===a ? 'btn--primary' : ''}`} onClick={() => setAsset(a)}>{a}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>Network</div>
                  <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                    {['TRC20','ERC20','BEP20','Solana'].map(n => (
                      <button key={n} className={`btn btn--sm ${network===n ? 'btn--primary' : ''}`} onClick={() => setNetwork(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              </div>
            </window.SectionCard>

            <window.SectionCard title={t('deposit_eba168')}>
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
                  <button className="btn btn--xs" onClick={() => navigator.clipboard.writeText(address)}><I.Copy size={11}/> Copy</button>
                </div>
              </div>
            </window.SectionCard>

            <window.SectionCard title={t('deposit_adb488')}>
              <ul style={{margin:0, paddingLeft: 20, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.8}}>
                <li>{t('deposit_eca2cd')} <strong>10 {asset}</strong></li>
                <li>{t('deposit_2f858e')} <strong>{t('dep_confirm_count', { n: network === 'TRC20' ? 1 : network === 'BEP20' ? 15 : 12 })}</strong></li>
                <li>{t('deposit_53bb7f')} <strong>{network === 'TRC20' ? t('deposit_9360c7') : network === 'BEP20' ? t('deposit_13c35d') : t('deposit_b5d053')}</strong></li>
                <li className="t-danger">{t('dep_net_a')}<strong>{network}</strong>{t('dep_net_b')}</li>
              </ul>
            </window.SectionCard>
          </div>

          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            <window.SectionCard title={t('deposit_d4cde2')}>
              <div style={{fontFamily: 'var(--font-num)', fontSize: 24, fontWeight: 600}}>9,840.22 <span style={{fontSize: 12, color: 'var(--color-text-tertiary)'}}>USDT</span></div>
              <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4}}>All exchanges combined</div>
            </window.SectionCard>

            <window.SectionCard title={t('deposit_7fb69f')} noPadding>
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

    const balance = 9840.22;
    const fee = { TRC20: 1, ERC20: 15, BEP20: 0.5, Solana: 0.5 }[network] || 1;
    const receive = Math.max(0, parseFloat(amount) - fee || 0);

    return (
      <window.PageShell
        {...shellProps}
        title={t('withdraw_972169')}
        subtitle={t('withdraw_690b48')}
        breadcrumb={['Home','Wallet','Withdraw']}
      >
        <div className="grid-2-1">
          <window.SectionCard title={t('withdraw_3f13b3')}>
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              <div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>Asset</div>
                <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                  {['USDT','BTC','ETH','SOL','BNB','USDC'].map(a => (
                    <button key={a} className={`btn btn--sm ${asset===a ? 'btn--primary' : ''}`} onClick={() => setAsset(a)}>{a}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>Network</div>
                <div style={{display:'flex', flexWrap:'wrap', gap: 6}}>
                  {['TRC20','ERC20','BEP20','Solana'].map(n => (
                    <button key={n} className={`btn btn--sm ${network===n ? 'btn--primary' : ''}`} onClick={() => setNetwork(n)}>{n}</button>
                  ))}
                </div>
              </div>

              <div className="input-group">
                <span className="input-group__label">Address</span>
                <input placeholder={t('wd_address_placeholder', { network })} value={address} onChange={e => setAddress(e.target.value)}/>
              </div>

              <div className="input-group">
                <span className="input-group__label">Amount</span>
                <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/>
                <span className="input-group__suffix">{asset}</span>
              </div>

              <div style={{display:'flex', gap:6, justifyContent:'flex-end'}}>
                {[25, 50, 75, 100].map(p => (
                  <button key={p} className="btn btn--xs" onClick={() => setAmount((balance * p / 100).toFixed(2))}>{p}%</button>
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

              <button className="btn btn--primary btn--lg" disabled={!address || !amount || parseFloat(amount) < fee} onClick={() => setShowConfirm(true)}>
                {t('withdraw_e88174')}
              </button>
            </div>
          </window.SectionCard>

          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            <window.SectionCard title={t('deposit_d4cde2')}>
              <div style={{fontFamily: 'var(--font-num)', fontSize: 24, fontWeight: 600}}>{balance.toFixed(2)} <span style={{fontSize: 12, color: 'var(--color-text-tertiary)'}}>USDT</span></div>
            </window.SectionCard>

            <window.SectionCard title={t('withdraw_fe7cae')}>
              <div style={{fontSize: 12, display:'flex', flexDirection:'column', gap: 6}}>
                <div style={{display:'flex', justifyContent:'space-between'}}><span>{t('withdraw_757555')}</span><strong>82,120 USDT</strong></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span>{t('withdraw_fe7cae')}</span><strong>100,000 USDT</strong></div>
                <div style={{height:6, background:'var(--color-bg-input)', borderRadius:999, overflow:'hidden'}}>
                  <div style={{height:'100%', width:'17.88%', background:'var(--color-brand)'}}/>
                </div>
                <div style={{fontSize:10, color:'var(--color-text-tertiary)'}}>KYC L2 · Pro tier · <a href="#/settings" style={{color:'var(--color-brand)'}}>{t('withdraw_100747')}</a></div>
              </div>
            </window.SectionCard>

            <window.SectionCard title={t('withdraw_605c61')}>
              <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6}}>{t('withdraw_708758')}</div>
              {[
                { name: 'My Binance USDT', addr: 'TXqYJ...eK7wN' },
                { name: 'Cold Wallet',    addr: '0x7d8...E5c6A' },
              ].map((a, i) => (
                <div key={i} style={{display:'flex', gap:8, alignItems:'center', padding:'6px 8px', border:'1px solid var(--color-border-subtle)', borderRadius:4, marginBottom: 4, cursor:'pointer'}} onClick={() => setAddress(a.addr)}>
                  <span style={{flex:1, fontSize:11}}>{a.name}</span>
                  <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{a.addr}</span>
                </div>
              ))}
              <button className="btn btn--xs" style={{width:'100%', marginTop: 4}}><I.Plus size={11}/> {t('withdraw_ecf928')}</button>
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
                  <div><strong>Asset:</strong> {asset}</div>
                  <div><strong>Network:</strong> {network}</div>
                  <div><strong>To:</strong> <span style={{color:'var(--color-brand)'}}>{address.slice(0, 8)}...{address.slice(-6)}</span></div>
                  <div><strong>Amount:</strong> {amount} {asset}</div>
                  <div><strong>Fee:</strong> {fee} {asset}</div>
                  <div><strong>Receive:</strong> {receive.toFixed(2)} {asset}</div>
                </div>
                <div className="input-group">
                  <span className="input-group__label">2FA Code</span>
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

    const txs = [
      { id:'tx001', kind:'deposit',  asset:'USDT', amount:  1000,   network:'TRC20', status:'completed', txHash:'3f4e5c6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', time: Date.now() - 1000*60*30 },
      { id:'tx002', kind:'withdraw', asset:'BTC',  amount:  -0.05,  network:'BTC',   status:'completed', txHash:'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', time: Date.now() - 1000*60*60*3 },
      { id:'tx003', kind:'deposit',  asset:'USDT', amount:   500,   network:'ERC20', status:'pending',   txHash:'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1', time: Date.now() - 1000*60*60*8 },
      { id:'tx004', kind:'transfer', asset:'ETH',  amount:  -0.5,   network:'—',     status:'completed', txHash:'internal-transfer-Binance→BitGet',   time: Date.now() - 1000*60*60*22 },
      { id:'tx005', kind:'trade',    asset:'BTC',  amount:  0.185,  network:'—',     status:'completed', txHash:'trade-fill-BTC/USDT',                time: Date.now() - 1000*60*60*40 },
      { id:'tx006', kind:'fee',      asset:'USDT', amount: -1.36,   network:'—',     status:'completed', txHash:'trading-fee-2026-08-01',             time: Date.now() - 1000*60*60*40 },
      { id:'tx007', kind:'rebate',   asset:'USDT', amount:  0.38,   network:'—',     status:'completed', txHash:'rebate-2026-07',                     time: Date.now() - 1000*60*60*72 },
      { id:'tx008', kind:'deposit',  asset:'SOL',  amount:  10,     network:'Solana',status:'completed', txHash:'DYw8jCTKfWpZbCXG7QP7VbYUqSJmZ4xF',   time: Date.now() - 1000*60*60*120 },
    ];

    const filtered = txs
      .filter(t => filter === 'all' || t.kind === filter)
      .filter(t => !q || t.txHash.includes(q) || t.asset.toLowerCase().includes(q.toLowerCase()));

    return (
      <window.PageShell
        {...shellProps}
        title="Transaction History"
        subtitle={t('transaction_history_1de8f9')}
        breadcrumb={['Home','Wallet','Transactions']}
        actions={<button className="btn btn--sm"><I.Camera size={13}/> Export CSV</button>}
      >
        <div className="grid-4">
          <window.KPICard label={t('transaction_history_ec0ce9')} value="+$2,340" tone="long"/>
          <window.KPICard label={t('transaction_history_99af2b')} value="-$180"   tone="short"/>
          <window.KPICard label={t('withdraw_34f036')} value="-$18.42" tone="warning"/>
          <window.KPICard label={t('transaction_history_ef5fd4')} value="+$5.42"  tone="brand"/>
        </div>

        <window.SectionCard
          title="Transactions"
          actions={
            <>
              <div className="input-group" style={{width: 240, height: 30}}>
                <I.Search size={12}/>
                <input placeholder={t('transaction_history_adb142')} value={q} onChange={e => setQ(e.target.value)}/>
              </div>
              <div className="seg">
                {['all','deposit','withdraw','transfer','trade','fee','rebate'].map(f => (
                  <button key={f} className={`seg__opt ${filter===f?'is-active':''}`} onClick={() => setFilter(f)}>{f}</button>
                ))}
              </div>
            </>
          }
          noPadding
        >
          <window.DataTable
            columns={[
              { key: 'time',   label: 'Time', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{new Date(r.time).toLocaleString('en-GB', {hour12: false})}</span> },
              { key: 'kind',   label: 'Type', render: r => {
                const colors = { deposit: 'ok', withdraw: 'warn', transfer: 'neutral', trade: 'neutral', fee: 'warn', rebate: 'ok' };
                return <span className={`status-pill status-pill--${colors[r.kind] || 'neutral'}`}>{r.kind.toUpperCase()}</span>;
              }},
              { key: 'asset',  label: 'Asset', render: r => <strong>{r.asset}</strong> },
              { key: 'amount', label: 'Amount', align:'right', render: r => (
                <span className={r.amount >= 0 ? 't-long' : 't-short'} style={{fontFamily:'var(--font-num)', fontWeight: 500}}>
                  {r.amount >= 0 ? '+' : ''}{r.amount} {r.asset}
                </span>
              )},
              { key: 'network', label: 'Network' },
              { key: 'status',  label: 'Status', render: r => <span className={`status-pill status-pill--${r.status === 'completed' ? 'ok' : 'warn'}`}>{r.status.toUpperCase()}</span> },
              { key: 'hash',    label: 'TX Hash', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-brand)'}}>{r.txHash.slice(0, 12)}…</span> },
              { key: 'act',     label: '', align:'right', render: () => <button className="tbl-action">View</button> },
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
    const strategy = window.QTApp.STRATEGIES.find(s => s.id === (strategyId || 'strat-05')) || window.QTApp.STRATEGIES[0];
    const [tab, setTab] = useState('overview');

    // Generate deterministic equity curve
    const points = 60;
    const curve = Array.from({length: points}, (_, i) => {
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
        subtitle={`${strategy.author} · ${strategy.tag}`}
        breadcrumb={['Home','AI Strategies', strategy.name]}
        badge={<><span className={`badge badge--neutral`}>{strategy.subscription}</span> {strategy.featured && <span className="badge badge--ai">✦ FEATURED</span>}</>}
        actions={
          <>
            <button className="btn btn--sm"><I.Chart size={13}/> Live Backtest</button>
            <button className="btn btn--sm"><I.Bell size={13}/> Alert</button>
            <button className="btn btn--sm btn--primary"><I.Plus size={13}/> {t('strategy_detail_73a075')}</button>
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label="30d PnL" value={(strategy.pnl30 >= 0 ? '+' : '') + strategy.pnl30 + '%'} tone={strategy.pnl30 >= 0 ? 'long' : 'short'}/>
          <window.KPICard label="Win Rate" value={strategy.winRate + '%'} tone="brand"/>
          <window.KPICard label="Sharpe" value={strategy.sharpe.toFixed(2)}/>
          <window.KPICard label="Max Drawdown" value={'-' + strategy.maxDD + '%'} tone="short"/>
        </div>

        <div className="tabs" style={{borderBottom: '1px solid var(--color-border-subtle)', marginBottom: -12}}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'backtest', label: 'Backtest' },
            { id: 'trades', label: 'Historical Trades' },
            { id: 'settings', label: 'Settings' },
            { id: 'reviews', label: 'Reviews' },
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
              <window.SectionCard title="Strategy Description">
                <p style={{fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: 0}}>
                  {t('strat_desc_1', { name: strategy.name, tag: strategy.tag })}
                  {t('strat_desc_2')}
                </p>
                <p style={{fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: '12px 0 0'}}>
                  <strong>{t('strategy_detail_0a17fe')}</strong> {strategy.author === 'QuantumTrade Lab' ? t('strategy_detail_40a912') : t('strategy_detail_704ee2')}
                </p>
              </window.SectionCard>

              <window.SectionCard title="Risk Profile">
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
            <window.SectionCard title="Backtest Configuration">
              <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12}}>
                <div className="input-group"><span className="input-group__label">Symbol</span><input defaultValue="BTC/USDT"/></div>
                <div className="input-group"><span className="input-group__label">From</span><input type="date" defaultValue="2025-01-01"/></div>
                <div className="input-group"><span className="input-group__label">To</span><input type="date" defaultValue="2026-08-01"/></div>
                <div className="input-group"><span className="input-group__label">Initial Capital</span><input defaultValue="10000"/></div>
              </div>
              <button className="btn btn--primary" style={{marginTop: 12}}><I.Sparkles size={12}/> Run Backtest</button>
            </window.SectionCard>

            <div className="grid-4">
              <window.KPICard label="Total Return" value="+142.4%" tone="long"/>
              <window.KPICard label="Sharpe Ratio" value={strategy.sharpe.toFixed(2)}/>
              <window.KPICard label="Sortino" value="3.42" tone="brand"/>
              <window.KPICard label="Calmar" value="1.84"/>
            </div>

            <window.SectionCard title="Monthly Returns">
              <div style={{display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap: 2, padding: 8}}>
                {Array.from({length: 12*2}).map((_, i) => {
                  const val = Math.sin(i / 2) * 15 + Math.random() * 8 - 4;
                  const alpha = 0.2 + Math.abs(val) / 20 * 0.6;
                  const color = val >= 0 ? `oklch(72% 0.14 175 / ${alpha})` : `oklch(68% 0.22 355 / ${alpha})`;
                  return (
                    <div key={i} style={{aspectRatio: '1 / 1', background: color, borderRadius: 3, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize: 9, fontWeight: 600}}>
                      {val >= 0 ? '+' : ''}{val.toFixed(1)}
                    </div>
                  );
                })}
              </div>
            </window.SectionCard>
          </>
        )}

        {tab === 'trades' && (
          <window.SectionCard title="Historical Signals" noPadding>
            <window.DataTable
              columns={[
                { key:'date', label:'Date' },
                { key:'sym', label:'Symbol' },
                { key:'side', label:'Side', render: r => <span className={r.side==='long'?'t-long':'t-short'}>{r.side==='long'?'▲ LONG':'▼ SHORT'}</span> },
                { key:'entry', label:'Entry', align:'right' },
                { key:'exit', label:'Exit', align:'right' },
                { key:'pnl', label:'PnL', align:'right', render: r => <span className={r.pnl>=0?'t-long':'t-short'} style={{fontWeight:500}}>{r.pnl>=0?'+':''}{r.pnl.toFixed(1)}%</span> },
                { key:'dur', label:'Duration' },
              ]}
              rows={[
                { date:'2026-07-30', sym:'BTC/USDT', side:'long',  entry:'67,285', exit:'68,432', pnl:+1.7, dur:'2h 14m' },
                { date:'2026-07-28', sym:'BTC/USDT', side:'long',  entry:'67,840', exit:'67,280', pnl:-0.82, dur:'4h 32m' },
                { date:'2026-07-26', sym:'BTC/USDT', side:'short', entry:'68,120', exit:'67,480', pnl:+0.94, dur:'6h 20m' },
                { date:'2026-07-24', sym:'BTC/USDT', side:'long',  entry:'67,200', exit:'68,450', pnl:+1.86, dur:'8h 15m' },
              ]}
            />
          </window.SectionCard>
        )}

        {tab === 'settings' && (
          <window.SectionCard title="Follow Settings">
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              <div className="input-group"><span className="input-group__label">Auto-copy</span><label className="switch" style={{marginLeft:'auto'}}><input type="checkbox" defaultChecked/><span className="switch__track"><span className="switch__thumb"/></span></label></div>
              <div className="input-group"><span className="input-group__label">Position size</span><input defaultValue="100"/><span className="input-group__suffix">USDT</span></div>
              <div className="input-group"><span className="input-group__label">Max concurrent</span><input defaultValue="3"/><span className="input-group__suffix">positions</span></div>
              <div className="input-group"><span className="input-group__label">Stop copy at drawdown</span><input defaultValue="10"/><span className="input-group__suffix">%</span></div>
              <button className="btn btn--primary">Save Settings</button>
            </div>
          </window.SectionCard>
        )}

        {tab === 'reviews' && (
          <window.SectionCard title="Reviews" subtitle="2,140 followers · Avg 4.6/5">
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              {[
                { user:'J.K.', rating:5, comment:t('strategy_detail_411128'), date:'3d ago' },
                { user:'S.N.', rating:4, comment:t('strategy_detail_c84624'), date:'1w ago' },
                { user:'A.F.', rating:5, comment:t('strategy_detail_20ef84'), date:'2w ago' },
              ].map((r, i) => (
                <div key={i} style={{padding: 12, background: 'var(--color-bg-surface)', borderRadius: 6}}>
                  <div style={{display:'flex', gap: 8, alignItems:'center', marginBottom: 4}}>
                    <span style={{width:24, height:24, borderRadius:'50%', background:'var(--color-bg-elevated)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize:10, fontWeight:600}}>{r.user}</span>
                    <span style={{color:'var(--color-warning)'}}>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span>
                    <span style={{marginLeft:'auto', fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{r.date}</span>
                  </div>
                  <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>{r.comment}</div>
                </div>
              ))}
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
    return (
      <window.PageShell
        {...shellProps}
        title="My Strategies"
        subtitle={t('my_strategies_2247f0')}
        breadcrumb={['Home','AI Strategies','My']}
        actions={<a className="btn btn--sm btn--primary" href="#/ai-strategies">{t('my_strategies_bc178b')}</a>}
      >
        <div className="grid-4">
          <window.KPICard label="Following" value="0" sub={t('my_strategies_eb1536')}/>
          <window.KPICard label="Auto-copy" value="0" tone="brand"/>
          <window.KPICard label="Combined PnL" value="$0.00" tone="neutral"/>
          <window.KPICard label="Combined Win Rate" value="—" />
        </div>

        <window.SectionCard title="Followed Strategies">
          <div style={{padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)'}}>
            <div style={{fontSize: 48, marginBottom: 12}}>📊</div>
            <div style={{fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)'}}>{t('my_strategies_308c9f')}</div>
            <div style={{fontSize: 12, marginTop: 4}}>{t('my_strategies_7dbef2')}</div>
            <a className="btn btn--primary" style={{marginTop: 20}} href="#/ai-strategies">{t('my_strategies_c93fb6')}</a>
          </div>
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // REFERRAL PAGE — 대표님이 강조한 친구 초대 시스템
  // ============================================================
  window.ReferralPage = function ReferralPage({ shellProps }) {
    const [copied, setCopied] = useState(false);
    const referralLink = 'https://quantumtrade.ai/signup?ref=KURI001';
    const referralCode = 'KURI001';

    return (
      <window.PageShell
        {...shellProps}
        title={t('referral_5c777f')}
        subtitle={t('referral_36c994')}
        breadcrumb={['Home','Referral']}
      >
        <div className="grid-4">
          <window.KPICard label={t('referral_556648')} value="0" tone="brand"/>
          <window.KPICard label={t('referral_cc6354')} value="0" sub={t('referral_4aa57d')}/>
          <window.KPICard label={t('referral_1a8dfd')} value="$0.00" tone="long"/>
          <window.KPICard label={t('referral_d7f3c2')} value="$0.00" />
        </div>

        <window.SectionCard title={t('referral_e31ce0')}>
          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            <div style={{padding: '16px 20px', background: 'linear-gradient(135deg, var(--color-brand-subtle), transparent 60%)', border: '1px solid var(--color-brand)', borderRadius: 8}}>
              <div style={{fontSize: 11, color: 'var(--color-brand)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6}}>{t('referral_967128')}</div>
              <div style={{display:'flex', gap: 8, alignItems:'center'}}>
                <span style={{flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, wordBreak: 'break-all'}}>{referralLink}</span>
                <button
                  className={`btn btn--sm ${copied ? 'btn--primary' : ''}`}
                  onClick={() => { navigator.clipboard.writeText(referralLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                >
                  {copied ? <><I.Check size={12}/> {t('copied')}</> : <><I.Copy size={12}/> {t('copy')}</>}
                </button>
              </div>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12}}>
              <div style={{padding: 12, background: 'var(--color-bg-surface)', borderRadius: 6}}>
                <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4}}>{t('referral_4e6dd0')}</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700}}>{referralCode}</div>
              </div>
              <div style={{padding: 12, background: 'var(--color-bg-surface)', borderRadius: 6}}>
                <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4}}>{t('referral_944615')}</div>
                <div style={{fontFamily: 'var(--font-num)', fontSize: 20, fontWeight: 700, color: 'var(--color-brand)'}}>30%</div>
              </div>
            </div>

            <div>
              <div style={{fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6}}>{t('referral_0f2024')}</div>
              <div style={{display:'flex', gap: 6}}>
                <button className="btn btn--sm" style={{flex:1}}><I.Send size={12}/> KakaoTalk</button>
                <button className="btn btn--sm" style={{flex:1}}><I.Send size={12}/> Telegram</button>
                <button className="btn btn--sm" style={{flex:1}}><I.Send size={12}/> Twitter</button>
                <button className="btn btn--sm" style={{flex:1}}><I.Send size={12}/> Email</button>
              </div>
            </div>
          </div>
        </window.SectionCard>

        <div className="grid-2">
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
                  {t.current && <span className="status-pill status-pill--ok">CURRENT</span>}
                </div>
              ))}
            </div>
          </window.SectionCard>

          <window.SectionCard title={t('referral_7932cf')}>
            <ol style={{margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.8}}>
              <li>{t('referral_047382')}</li>
              <li>{t('referral_c57b53')}</li>
              <li>{t('ref_pay_a')}<strong>{t('ref_pay_em')}</strong>{t('ref_pay_b')}</li>
              <li>{t('referral_5f1706')}</li>
              <li>{t('ref_bonus_a')}<strong>{t('ref_bonus_em')}</strong>{t('ref_bonus_b')}</li>
            </ol>

            <div className="auth-alert auth-alert--info" style={{marginTop: 16}}>
              <I.Info size={12}/>
              <div>{t('ref_tier_a')}<strong>{t('ref_tier_em')}</strong>{t('ref_tier_b')}</div>
            </div>
          </window.SectionCard>
        </div>

        <window.SectionCard title={t('referral_8580a8')} noPadding>
          <div style={{padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)'}}>
            <div style={{fontSize: 40, marginBottom: 8}}>👥</div>
            <div style={{fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)'}}>{t('referral_c398ae')}</div>
            <div style={{fontSize: 11, marginTop: 4}}>{t('referral_fa91e4')}</div>
          </div>
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // FEE & REBATE (사용자 화면)
  // ============================================================
  window.FeeRebatePage = function FeeRebatePage({ shellProps }) {
    const tiers = window.QTApp.FEE_TIERS;
    const myTier = 'Pro';
    const my30dVol = 42180000;
    const nextTier = 'VIP';
    const nextReq = 50000000;
    const progress = (my30dVol / nextReq) * 100;

    return (
      <window.PageShell
        {...shellProps}
        title="Fees & Rebates"
        subtitle={t('fee_rebate_4f1ad0')}
        breadcrumb={['Home','Settings','Fees']}
      >
        <div className="grid-3">
          <window.KPICard label="Current Tier" value={myTier} sub="Maker 0.015% · Taker 0.040%" tone="brand"/>
          <window.KPICard label="30d Volume" value={'$' + fmtCompact(my30dVol)}/>
          <window.KPICard label="Total Fees (30d)" value="$18.42" tone="warning"/>
        </div>

        <window.SectionCard title={t('fee_next_tier', { tier: nextTier })}>
          <div style={{display:'flex', flexDirection:'column', gap: 10}}>
            <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
              <span><strong>{fmtCompact(my30dVol)}</strong> / {fmtCompact(nextReq)} USDT ({progress.toFixed(1)}%)</span>
              <span style={{color:'var(--color-text-tertiary)'}}>${fmtCompact(nextReq - my30dVol)} more</span>
            </div>
            <div style={{height:10, background:'var(--color-bg-input)', borderRadius:999, overflow:'hidden'}}>
              <div style={{height:'100%', width: Math.min(100, progress) + '%', background: 'linear-gradient(90deg, var(--color-brand), var(--brand-accent-500))', transition: 'width 300ms ease'}}/>
            </div>
            <div style={{fontSize:11, color:'var(--color-text-tertiary)', display:'flex', justifyContent:'space-between'}}>
              <span>Pro</span><span>VIP · Maker 0.015% · Taker 0.035%</span>
            </div>
          </div>
        </window.SectionCard>

        <window.SectionCard title="All Tiers" noPadding>
          <window.DataTable
            columns={[
              { key:'tier', label:'Tier', render: r => r.tier === myTier ? <strong style={{color:'var(--color-brand)'}}>{r.tier} · CURRENT</strong> : <span>{r.tier}</span> },
              { key:'maker', label:'Maker', align:'right', render: r => (r.maker*100).toFixed(3) + '%' },
              { key:'taker', label:'Taker', align:'right', render: r => (r.taker*100).toFixed(3) + '%' },
              { key:'volReq', label:'30d Volume Req.', align:'right', render: r => '$' + fmtCompact(r.vol30Req) },
              { key:'holdReq', label:'Token Hold Req.', align:'right', render: r => r.holdReq + ' QT' },
            ]}
            rows={tiers}
          />
        </window.SectionCard>

        <div className="grid-2">
          <window.SectionCard title={t('fee_rebate_6d03c2')}>
            {window.QTApp.PROMOTIONS.map(p => (
              <div key={p.id} style={{padding:12, background:'var(--color-brand-subtle)', border:'1px solid var(--color-brand)', borderRadius:4, marginBottom: 8}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom: 4}}>
                  <strong>{p.name}</strong>
                  <span className="status-pill status-pill--ok">ACTIVE</span>
                </div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{p.period}</div>
              </div>
            ))}
          </window.SectionCard>

          <window.SectionCard title={t('fee_rebate_a3530c')}>
            <div style={{display:'flex', flexDirection:'column', gap: 8}}>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, borderBottom:'1px solid var(--color-border-subtle)'}}><span>{t('fee_rebate_350a9e')}</span><span style={{fontFamily:'var(--font-num)'}}>-$18.42</span></div>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, borderBottom:'1px solid var(--color-border-subtle)'}}><span>{t('fee_rebate_e7fe5e')}</span><span className="t-long" style={{fontFamily:'var(--font-num)'}}>+$5.42</span></div>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, borderBottom:'1px solid var(--color-border-subtle)'}}><span>{t('fee_rebate_2f76f9')}</span><span className="t-long" style={{fontFamily:'var(--font-num)'}}>+$0.00</span></div>
              <div style={{display:'flex', justifyContent:'space-between', padding: 8, fontWeight: 600, borderTop:'1px solid var(--color-border-default)'}}><span>{t('fee_rebate_597833')}</span><span style={{fontFamily:'var(--font-num)'}}>-$13.00</span></div>
            </div>
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
    const faqs = [
      { q:t('help_center_51472d'), a:t('help_center_c1c49c') },
      { q:t('help_center_667475'), a:t('help_center_aa37a6') },
      { q:t('help_center_d67afc'), a:t('help_center_72f72a') },
      { q:t('help_center_45bbd7'), a:t('help_center_8f8fe0') },
      { q:t('help_center_62cd9d'), a:t('help_center_b9a588') },
      { q:t('help_center_c46850'), a:t('help_center_c5eed0') },
      { q:t('help_center_7b944c'), a:t('help_center_ddc217') },
    ];
    const filtered = q ? faqs.filter(f => f.q.includes(q) || f.a.includes(q)) : faqs;

    return (
      <window.PageShell
        {...shellProps}
        title="Help Center"
        subtitle={t('help_center_42b43b')}
        breadcrumb={['Home','Help']}
      >
        <div className="input-group" style={{maxWidth: 600, margin: '0 auto', height: 44, fontSize: 14}}>
          <I.Search size={16}/>
          <input placeholder={t('help_center_044ef4')} value={q} onChange={e => setQ(e.target.value)}/>
        </div>

        <div className="grid-4">
          {[
            { icon:'User',     title:t('help_center_df04a4'), desc:t('help_center_b92aff') },
            { icon:'Wallet',   title:t('help_center_3910ce'),      desc:t('help_center_7901e1') },
            { icon:'Chart',    title:t('help_center_dc20f4'),        desc:t('help_center_eafac1') },
            { icon:'Sparkles', title:'AI Copilot',  desc:t('help_center_87ad98') },
          ].map((c, i) => {
            const Ic = I[c.icon] || I.Grid;
            return (
              <div key={i} style={{padding: 16, background: 'var(--color-bg-panel)', border: '1px solid var(--color-border-subtle)', borderRadius: 6, cursor: 'pointer', textAlign: 'center'}}>
                <div style={{width:40, height:40, borderRadius:8, background:'var(--color-brand-subtle)', color:'var(--color-brand)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom: 8}}><Ic size={18}/></div>
                <div style={{fontSize:13, fontWeight:600}}>{c.title}</div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:4}}>{c.desc}</div>
              </div>
            );
          })}
        </div>

        <window.SectionCard title={t('help_center_ae2ce9')}>
          <div style={{display:'flex', flexDirection:'column', gap: 8}}>
            {filtered.map((f, i) => (
              <details key={i} style={{padding: '10px 14px', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 4}}>
                <summary style={{cursor: 'pointer', fontSize: 13, fontWeight: 500}}>{f.q}</summary>
                <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.7}}>{f.a}</div>
              </details>
            ))}
          </div>
        </window.SectionCard>

        <window.SectionCard title={t('help_center_531f6a')}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12}}>
            <div style={{padding: 16, background: 'var(--color-bg-surface)', borderRadius: 4, textAlign: 'center'}}>
              <div style={{fontSize: 24, marginBottom: 6}}>💬</div>
              <div style={{fontWeight: 500}}>Live Chat</div>
              <div style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>{t('help_center_23dfeb')}</div>
              <button className="btn btn--sm btn--primary" style={{marginTop: 8}}>{t('help_center_0330b1')}</button>
            </div>
            <div style={{padding: 16, background: 'var(--color-bg-surface)', borderRadius: 4, textAlign: 'center'}}>
              <div style={{fontSize: 24, marginBottom: 6}}>📧</div>
              <div style={{fontWeight: 500}}>Email</div>
              <div style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>support@quantumtrade.ai</div>
              <button className="btn btn--sm" style={{marginTop: 8}}>{t('help_center_dda31f')}</button>
            </div>
            <div style={{padding: 16, background: 'var(--color-bg-surface)', borderRadius: 4, textAlign: 'center'}}>
              <div style={{fontSize: 24, marginBottom: 6}}>📞</div>
              <div style={{fontWeight: 500}}>Priority (Pro/VIP)</div>
              <div style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>{t('help_center_8c548e')}</div>
              <button className="btn btn--sm">{t('help_center_5052f8')}</button>
            </div>
          </div>
        </window.SectionCard>
      </window.PageShell>
    );
  };
})();
