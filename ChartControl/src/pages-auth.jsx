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
  const { useState, useEffect, useRef, useMemo } = React;
  const I = window.Icons;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  // 사전에 키가 없으면 폴백 언어(영어)로, 그것도 없으면 키를 그대로 보여준다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /*
     랜딩 시세용 숫자 형식.

     ★ QTFmt 가 없을 수도 있는 경로(정적 프리뷰)를 고려해 폴백을 둔다. 자리수는
       가격대에 맞춘다 — BTC 를 소수 4자리로 쓰면 읽기 어렵고, 저가 코인을
       정수로 쓰면 값이 사라진다.
  */
  const fmtNum = (n) => {
    if (!Number.isFinite(n)) return '—';
    const digits = n >= 1000 ? 1 : n >= 1 ? 2 : 4;
    return (window.QTFmt && window.QTFmt.fmt) ? window.QTFmt.fmt(n, digits)
      : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

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
  // 자주 쓰는 주요 시장은 맨 위에 고정, 나머지는 사용자 언어로 정렬해 전부 노출한다.
  const COUNTRY_PRIORITY = ['KR', 'US', 'JP', 'CN', 'TW', 'SG', 'HK', 'GB', 'DE'];
  const COUNTRY_CODES = ('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ '
    + 'CA CD CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE '
    + 'GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ '
    + 'LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL '
    + 'NO NP NR NZ OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST '
    + 'SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW').split(' ');
  const countryOptions = () => {
    const loc = (window.QTI18n && window.QTI18n.getLocale && window.QTI18n.getLocale()) || 'en';
    let dn = null;
    try { dn = new Intl.DisplayNames([loc], { type: 'region' }); } catch (e) { /* older browser */ }
    const label = (code) => { try { return (dn && dn.of(code)) || code; } catch (e) { return code; } };
    const rest = COUNTRY_CODES
      .filter((c) => !COUNTRY_PRIORITY.includes(c))
      .sort((a, b) => label(a).localeCompare(label(b), loc));
    const ordered = COUNTRY_PRIORITY.concat(rest);
    const opts = ordered.map((code) => <option key={code} value={code}>{label(code)}</option>);
    opts.push(<option key="OTHER" value="OTHER">{t('country_other')}</option>);
    return opts;
  };

  /*
     브라우저에서 국가를 **추정**한다.

     ★★ 예전에는 초기값이 `'KR'` 로 박혀 있었다. 그건 선택이 아니라 가정이다 —
       한국어를 UI 에서 뺀 뒤에도 모든 신규 가입자가 한국으로 기록됐다. 나중에
       국가별 평균을 내려면 그 값은 쓸 수 없다.

     ★ 추정 근거는 두 가지다: 브라우저 언어의 지역 부분(ko-KR → KR)과 시간대.
       둘 다 확실하지 않다(VPN·여행·기기 설정). 그래서 **제안으로만** 쓰고,
       countrySource='inferred' 로 표시해 사용자가 직접 고른 값과 구분한다.

     ★ 추정에 실패하면 빈 값을 둔다. 아무 나라나 넣으면 틀린 사실이 기록된다.
  */
  const guessCountry = () => {
    try {
      const langs = (navigator.languages && navigator.languages.length)
        ? navigator.languages : [navigator.language || ''];
      for (const l of langs) {
        const m = String(l).match(/[-_]([A-Za-z]{2})$/);
        if (m) {
          const code = m[1].toUpperCase();
          if (COUNTRY_CODES.includes(code)) return code;
        }
      }
    } catch (e) { /* 추정 실패는 빈 값으로 둔다 */ }
    try {
      /* 시간대의 지역명으로 마지막 시도. Asia/Seoul 같은 값에서 도시는 알아도 국가 코드는 아니므로, 알려진 몇 개만 본다. */
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const TZ_HINT = { 'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP', 'Asia/Shanghai': 'CN', 'Asia/Taipei': 'TW',
        'Asia/Singapore': 'SG', 'Asia/Hong_Kong': 'HK', 'Europe/London': 'GB', 'Europe/Berlin': 'DE',
        'America/New_York': 'US', 'America/Los_Angeles': 'US', 'America/Chicago': 'US' };
      if (TZ_HINT[tz]) return TZ_HINT[tz];
    } catch (e) { /* 무시 */ }
    return '';
  };

  /*
     검색 가능한 국가 선택기.

     ★★ 왜 select 로는 안 되는가

       목록이 195개다. 기본 `<select>` 는 검색이 없어서 사용자가 스크롤로 찾아야
       한다. 나라 이름이 보는 사람의 언어로 번역되므로 알파벳 순서도 언어마다
       달라지고, 스크롤로 찾기가 더 어렵다.

     ★★ 접근성

       역할을 직접 선언한다 — combobox(입력) + listbox(목록) + option(항목).
       키보드만 쓰는 사용자가 ↑↓ 로 옮기고 Enter 로 고르고 Esc 로 닫을 수 있어야
       한다. 마우스로만 되는 선택기는 이 화면을 쓸 수 없게 만든다.

     ★ 코드로도 찾게 한다. 'KR' 을 입력하는 사람도 있고, 번역된 이름을 모르는
       경우도 있다(중국어 화면에서 독일을 찾을 때).
  */
  const CountryPicker = ({ value, onChange, t }) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [cursor, setCursor] = useState(0);
    const boxRef = useRef(null);
    const listId = 'country-listbox';

    const loc = (window.QTI18n && window.QTI18n.getLocale && window.QTI18n.getLocale()) || 'en';
    let dn = null;
    try { dn = new Intl.DisplayNames([loc], { type: 'region' }); } catch (e) { /* older browser */ }
    /*
       ★★ 영어 이름으로도 찾게 한다.

         실서비스 실측: 일본어 화면에서 'korea' 를 입력하면 **0개**였다. 일본어로는
         韓国 이라서 번역된 이름과 맞지 않았다. 그런데 UI 언어와 무관하게 영어
         이름을 입력하는 사람이 많다(영어가 편한 사용자, 나라 이름의 현지 표기를
         모르는 사용자). 검색의 목적은 찾는 것이므로, 못 찾으면 기능이 없는 것과
         같다.

       ★ 화면에 보이는 이름은 그대로 번역된 이름이다 — 영어는 검색에만 쓴다.
         목록에 영어를 섞으면 중국어 화면에 영어가 튀어나온다.
    */
    let dnEn = null;
    try { dnEn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* older browser */ }
    const nameOf = (code) => {
      if (code === 'OTHER') return t('country_other');
      try { return (dn && dn.of(code)) || code; } catch (e) { return code; }
    };
    const enNameOf = (code) => {
      if (code === 'OTHER') return 'other';
      try { return (dnEn && dnEn.of(code)) || code; } catch (e) { return code; }
    };

    /* 우선순위 국가를 앞에 두고, 나머지는 보는 사람의 언어 기준으로 정렬한다. */
    const all = useMemo(() => {
      const rest = COUNTRY_CODES
        .filter((c) => !COUNTRY_PRIORITY.includes(c))
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b), loc));
      return COUNTRY_PRIORITY.concat(rest).concat(['OTHER']);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loc]);

    const needle = q.trim().toLowerCase();
    const shown = needle
      ? all.filter((c) => nameOf(c).toLowerCase().includes(needle)
          || enNameOf(c).toLowerCase().includes(needle)
          || c.toLowerCase().includes(needle))
      : all;

    /* 목록이 바뀌면 커서를 처음으로 되돌린다 — 없는 항목을 가리키면 Enter 가 엉뚱한 것을 고른다. */
    useEffect(() => { setCursor(0); }, [needle, open]);

    /* 바깥을 누르면 닫는다. */
    useEffect(() => {
      if (!open) return undefined;
      const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const pick = (code) => {
      /*
         ★★ 사용자가 직접 고른 값이므로 근거를 'user' 로 올린다. 브라우저 추정과
           구분해야 나중에 국가별 평균이 왜곡되지 않는다.
      */
      onChange(code, 'user');
      setOpen(false);
      setQ('');
    };

    const onKeyDown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) { setOpen(true); return; }
        setCursor((i) => {
          const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
          if (next < 0) return shown.length - 1;
          if (next >= shown.length) return 0;
          return next;
        });
        return;
      }
      if (e.key === 'Enter') {
        if (open && shown[cursor]) { e.preventDefault(); pick(shown[cursor]); }
        return;
      }
      if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
    };

    return (
      <div ref={boxRef} style={{ position: 'relative' }}>
        <input
          type="text"
          role="combobox"
          aria-label={t('fld_country')}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={t('country_search_ph')}
          value={open ? q : nameOf(value)}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <div
            id={listId}
            role="listbox"
            aria-label={t('country_search_open')}
            className="panel"
            style={{
              position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 50,
              maxHeight: 240, overflowY: 'auto', marginTop: 2,
              boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,.4))',
            }}
          >
            {shown.length === 0 ? (
              /*
                 ★★ 결과가 없을 때 빈 상자를 보여주지 않는다. 빈 목록은 "고장났다"
                   로 읽힌다 — 무엇을 검색했고 왜 비었는지 말한다.
              */
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {t('country_no_match', { q: q.trim() })}
              </div>
            ) : shown.map((code, i) => (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={code === value}
                className={`btn btn--ghost btn--sm ${i === cursor ? 'is-active' : ''}`}
                style={{ display: 'block', width: '100%', textAlign: 'left' }}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(code)}
              >
                {nameOf(code)}
                <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>{code === 'OTHER' ? '' : code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  /** 언어 변경 시 이 파일의 컴포넌트들이 재렌더되도록 하는 훅. */
  const _useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);

  // ============================================================
  // AUTH SHELL — reusable wrapper for auth pages
  // ============================================================
  window.AuthShell = function AuthShell({ title, subtitle, children, _mode = 'auth', progress }) {
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
            <img className="auth-shell__brand-logo" src="/src/ccai-logo.png" alt={window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'}/>
            <span>{window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'}</span>
            
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
              <a href="#/refund">{t('legal_refund')}</a>
              <a href="#/help">{t('auth_e2654a')}</a>
            </div>
            {/* 모드는 고정 문구로 쓰지 않는다 — 위 랜딩 푸터와 같은 이유. */}
            <div className="auth-foot-copy">© 2026 {window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'} · {(() => {
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
                { icon: 'Sparkles', title: t('auth_feat_ai'), desc: t('auth_833f52') },
                { icon: 'Chart',    title: t('auth_feat_layout'),       desc: t('auth_66cdd9') },
                { icon: 'Alert',    title: t('auth_feat_safety'),    desc: t('auth_2d0495') },
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
  window.LoginPage = function LoginPage({ shellProps: _shellProps }) {
    const [email, setEmail] = useState('');
    const [pw, setPw] = useState('');
    const [remember, setRemember] = useState(true);
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState('credentials'); // credentials | 2fa
    const [otp, setOtp] = useState(['','','','','','']);
    const otpRefs = Array.from({length: 6}, () => React.createRef());

    // 서버가 돌려준 오류 문구. 마크업은 그대로 두고 이 값만 표시한다.
    const [authError, setAuthError] = useState('');

    /*
       구글 로그인 사용 가능 여부 + 실패 사유.

       ★ 서버 설정(/api/config 의 googleLogin)이 켜져 있을 때만 버튼을 보여준다.
         설정이 없으면 서버에 라우트가 없으므로 눌러도 아무 일이 없다.

       ★ 실패는 콜백이 #/login?oauth_error=... 로 돌려보낸다. 그 값을 읽어
         이용자에게 이유를 보여준다 — 조용히 로그인 화면으로 되돌리면 왜 안
         됐는지 알 수 없다.
    */
    const serverCfg = (window.QTApi && window.QTApi.useConfig) ? window.QTApi.useConfig() : null;
    const googleOn = Boolean(serverCfg && serverCfg.googleLogin);    const oauthError = (() => {
      const m = String(window.location.hash || '').match(/[?&]oauth_error=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    })();

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
          /*
             ★ 이메일 미인증(EMAIL_NOT_VERIFIED)은 비밀번호 오류와 상태코드(401)가
               같으므로 코드로 구분한다. 서버가 이미 인증 메일을 다시 보냈으니,
               인증 화면으로 보내 메일 확인을 안내한다.
          */
          if (err && err.code === 'EMAIL_NOT_VERIFIED') {
            try { sessionStorage.setItem('qt.pendingVerifyEmail', email); } catch (e) { /* 저장 실패 무시 */ }
            window.location.hash = '/verify-email';
            return;
          }
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
              <input aria-label={t('fld_email')} type="email" placeholder={t('fld_email_ph')} value={email} onChange={e => setEmail(e.target.value)} required autoFocus/>
            </div>
            <div className="input-group">
              <span className="input-group__label"><I.Lock size={11}/> {t('fld_password')}</span>
              <input aria-label={t('fld_password')} type="password" placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} required/>
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

            {/*
               ★★ 소셜 로그인(Google/Apple/GitHub) 버튼을 주석 처리했다.

                 이 세 버튼은 onClick 이 없어 눌러도 아무 일이 없었고, 백엔드에
                 소셜 OAuth 연동 자체가 없다(로그인은 이메일+비밀번호, 거래소 연결은
                 KuCoin OAuth 를 쓴다). 구현되지 않은 로그인 수단을 버튼으로 두면
                 고객은 고장으로 읽는다. '또는' 구분선도 함께 내렸다.

               ★ 나중에 소셜 로그인을 붙이면 이 주석을 풀고 각 버튼에 onClick 을
                 연결하면 된다(문구 키 login_46bed0 은 사전에 남겨 둔다).

            <div className="auth-divider"><span>{t('login_46bed0')}</span></div>

            <div style={{display:'flex', gap: 8}}>
              <button type="button" className="btn" style={{flex:1}}>Google</button>
              <button type="button" className="btn" style={{flex:1}}>Apple</button>
              <button type="button" className="btn" style={{flex:1}}>GitHub</button>
            </div>
            */}

            {/*
               ★★ 구글 로그인.

                 서버가 설정돼 있을 때만(/api/config 의 googleLogin) 보여준다.
                 설정이 없으면 라우트 자체가 없으므로, 버튼을 띄워도 눌러야 아무
                 일이 없다 — 예전 소셜 버튼 3개가 만든 문제가 그것이다.

               ★ fetch 가 아니라 전체 페이지 이동이다. OAuth 는 구글 도메인으로
                 나갔다가 돌아오는 흐름이라 XHR 로는 할 수 없다.
            */}
            {googleOn && (
              <>
                <div className="auth-divider"><span>{t('login_46bed0')}</span></div>
                <button
                  type="button"
                  className="btn btn--lg"
                  style={{ width: '100%' }}
                  onClick={() => { window.location.href = '/api/auth/google/start'; }}
                >
                  {t('login_google')}
                </button>
              </>
            )}

            {oauthError && (
              <div className="auth-alert auth-alert--warn" style={{ marginTop: 8 }}>
                <div>{t('login_google_failed', { reason: oauthError })}</div>
              </div>
            )}

            <div className="auth-row-center">
              {t('login_68a92d')} <a href="#/signup" style={{color:'var(--color-brand)', marginLeft: 4}}>{t('login_49f561')}</a>
            </div>

            {/*
               ★★ '데모: 아무 이메일/비번으로 입장' 안내를 제거했다.

                 실서비스에서 인증은 실제로 동작한다(위 submit → 서버 로그인).
                 그런데 이 문구는 "아무 값이나 넣으면 들어가진다" 고 말해서,
                 고객에게 인증이 가짜/우회 가능한 것처럼 보였다. 명백히 거짓이고
                 보안적으로도 오해를 준다. 문구 키(demo_label·login_13d6ae)는
                 사전에 남겨 둔다 — 되살릴 일은 없지만 지우면 다른 곳 참조가
                 깨질 수 있다.
            */}
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
                <input aria-label={t('a11y_otp_digit')} key={i} ref={otpRefs[i]}
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
  window.SignupPage = function SignupPage({ shellProps: _shellProps }) {
    const [form, setForm] = useState({ email: '', pw: '', pw2: '', country: guessCountry(), countrySource: 'inferred', agree: false, marketing: true });

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
    /*
       ★★ 서버와 같은 숫자(최소 10자). 예전에는 8자로 검사해 8~9자를 통과시켰고,
         서버가 거부해서 고객은 "형식이 맞다고 했는데 왜 안 되나" 를 겪었다.
    */
    if (form.pw && form.pw.length < 10) errors.push(t('pwreset_too_short'));
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
        /*
           ★ 빈 값은 보내지 않는다. 서버 스키마가 두 글자 코드만 받으므로 ''
             를 보내면 검증에서 걸린다 — 국가를 고르지 않았다고 가입이 막히면
             그 손해가 이 정보의 가치보다 크다.
        */
        ...(form.country ? { country: form.country } : {}),
        /*
           ★★ 그 값의 근거를 함께 보낸다. 브라우저 추정과 사용자가 직접 고른 값을
             서버가 구분해서 저장한다 — 추정치를 선언으로 취급하면 나중에 국가별
             평균이 조용히 왜곡된다.
        */
        ...(form.country ? { countrySource: form.countrySource || 'inferred' } : {}),
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
          /*
             ★★ 가입 직후 바로 쓸 수 있게 한다.

               이메일 인증이 꺼져 있으므로(운영 결정) '/verify-email' 로 보내면
               아무도 통과할 수 없는 안내 화면에서 끝난다 — 메일이 오지 않는데
               "메일을 확인하세요" 라고 말하는 셈이다. 그래서 같은 자격으로 바로
               로그인시키고 거래 화면으로 보낸다.

             ★ 자동 로그인이 실패하면(레이트리밋·MFA 등) 로그인 화면으로 보낸다.
               가입은 이미 성공했으므로 실패로 되돌리지 않는다.
          */
          window.QTApi.auth.login(form.email, form.pw)
            .then(() => {
              if (window.QTAuth && window.QTAuth.refresh) {
                try { window.QTAuth.refresh(); } catch (e) { /* 무시 */ }
              }
              window.location.hash = '/trade';
            })
            .catch(() => { window.location.hash = '/login'; });
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
            <input aria-label={t('fld_email')} type="email" placeholder={t('fld_email_ph')} value={form.email} onChange={e => setForm({...form, email: e.target.value})} required autoFocus/>
          </div>

          <div className="input-group">
            <span className="input-group__label"><I.Lock size={11}/> {t('fld_password')}</span>
            <input aria-label={t('fld_password')} type="password" placeholder={t('signup_10c83d')} value={form.pw} onChange={e => setForm({...form, pw: e.target.value})} required/>
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
            <input aria-label={t('fld_confirm')} type="password" placeholder={t('signup_711154')} value={form.pw2} onChange={e => setForm({...form, pw2: e.target.value})} required/>
          </div>

          <div className="input-group">
            <span className="input-group__label"><I.Globe size={11}/> {t('fld_country')}</span>
            <CountryPicker
              value={form.country}
              onChange={(code, source) => setForm({ ...form, country: code, countrySource: source })}
              t={t}
            />
            {/*
               ★★ 추정값이라는 사실을 숨기지 않는다.

                 브라우저에서 짐작한 값을 미리 채워 두면 편하지만, 그대로 두면
                 사용자는 자기가 고른 것으로 착각한다. 확인해 달라고 말한다 —
                 그래야 이 데이터를 나중에 신뢰할 수 있다.
            */}
            {form.country && form.countrySource === 'inferred' && (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                {t('country_guessed')}
              </div>
            )}
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
                <input aria-label={t('signup_ref_ph')}
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
  window.EmailVerifyPage = function EmailVerifyPage({ shellProps: _shellProps }) {
    /*
       ★★ 이메일 인증은 '메일의 링크' 로 한다.

         인증 토큰은 6자리 숫자가 아니라 긴 무작위 토큰(base64url)이라 손으로 입력할
         수 없다. 그래서 사용자는 메일의 '이메일 인증' 버튼(#/verify-email?token=…)을
         누르고, 이 화면은 URL 의 토큰을 읽어 자동으로 인증한다.
         (예전엔 6자리 입력칸이 있었는데 토큰 형식과 맞지 않아 인증이 불가능했다.)
    */
    const [status, setStatus] = useState('idle'); // idle | verifying | success | failed
    const [sent, setSent] = useState(false);
    const [sendErr, setSendErr] = useState('');

    useEffect(() => {
      const hash = String(window.location.hash || '');
      const q = hash.indexOf('?');
      const token = q === -1 ? '' : (new URLSearchParams(hash.slice(q + 1)).get('token') || '');
      if (!token) { setStatus('idle'); return; }
      if (!window.QTApi || !window.QTApi.auth) { setStatus('success'); return; }
      setStatus('verifying');
      window.QTApi.auth.verifyEmail(token)
        .then((r) => {
          if (r && r.ok === false) { setStatus('failed'); return; }
          setStatus('success');
          if (window.QTAuth) window.QTAuth.refresh();
        })
        .catch(() => setStatus('failed'));
    }, []);

    /*
       재발송. 로그인 상태에서만 서버가 사용자를 안다(POST /auth/verify-email/request 는
       인증 필요). 로그인 차단으로 이 화면에 온 사용자는 세션이 없으므로, 그때는
       "다시 로그인하면 인증 메일을 다시 보낸다" 고 안내한다(로그인 시 서버가 자동 재발송).
    */
    const resend = () => {
      setSendErr('');
      if (!window.QTApi || !window.QTApi.auth) { setSent(true); setTimeout(() => setSent(false), 3000); return; }
      window.QTApi.auth.requestEmailVerify()
        .then(() => { setSent(true); setTimeout(() => setSent(false), 3000); })
        .catch((err) => {
          if (err && err.status === 401) setSendErr(t('verify_resend_login'));
          else setSendErr((err && err.message) || t('auth_err_generic'));
        });
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
          <div className="auth-verify-icon"><I.Bell size={30}/></div>

          {status === 'verifying' && (
            <div style={{textAlign:'center', fontSize:13, color:'var(--color-text-secondary)'}}>
              <span className="spinner"/> {t('verify_processing')}
            </div>
          )}

          {status === 'success' && (
            <>
              <div style={{textAlign:'center', fontSize:14, fontWeight:500, color:'var(--color-success)', marginBottom:8}}>
                {t('verify_success')}
              </div>
              <button className="btn btn--primary btn--lg" style={{width:'100%'}} onClick={() => { window.location.hash = '/login'; }}>
                {t('verify_go_login')}
              </button>
            </>
          )}

          {status === 'failed' && (
            <>
              <div className="auth-alert auth-alert--danger">
                <I.Alert size={12}/>
                <div>{t('verify_failed')}</div>
              </div>
              <button className="btn btn--primary btn--lg" style={{width:'100%'}} onClick={() => { window.location.hash = '/login'; }}>
                {t('verify_go_login')}
              </button>
            </>
          )}

          {status === 'idle' && (
            <>
              <div style={{textAlign:'center', fontSize:12.5, color:'var(--color-text-secondary)', lineHeight:1.7, marginBottom:8}}>
                {t('verify_check_email')}
              </div>
              <div className="auth-row-center" style={{fontSize:12}}>
                {sent ? (
                  <span style={{color:'var(--color-success)'}}>{t('email_verify_089bb3')}</span>
                ) : (
                  <>
                    {t('login_f3047a')}
                    <a href="#" style={{color:'var(--color-brand)', marginLeft:4}} onClick={e => { e.preventDefault(); resend(); }}>{t('email_verify_37a414')}</a>
                  </>
                )}
              </div>
              {sendErr && (
                <div className="auth-alert auth-alert--warning" style={{marginTop:8}}>
                  <I.Info size={12}/>
                  <div>{sendErr}</div>
                </div>
              )}
              <button className="btn btn--ghost" style={{width:'100%', marginTop:12}} onClick={() => { window.location.hash = '/login'; }}>
                {t('verify_go_login')}
              </button>
            </>
          )}
        </div>
      </window.AuthShell>
    );
  };

  // ============================================================
  // KYC ONBOARDING
  // ============================================================
  window.KYCOnboardingPage = function KYCOnboardingPage({ shellProps: _shellProps }) {
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

     /*
        ★★ 이 훅들이 아래 `if (!backendKnownAbsent) return (…)` **뒤에** 있었다.
          백엔드 판정은 null(모름) → true/false 로 바뀌므로, 그 렌더에서 훅 개수가
          달라져 React 가 죽는다. 훅은 조건보다 먼저, 항상 같은 순서로 부른다.
     */
    const [step, setStep] = useState(1);
    const [form, setForm] = useState({
      firstName: '', lastName: '', birth: '', nationality: 'KR',
      address: '', city: '', postal: '',
      idType: 'passport', idFront: null, idBack: null, selfie: null,
      source: '', purpose: '',
    });

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
          { label: t('na_kyc_title'), active: true },
        ]}
      >
        <div className="auth-form">
          {step === 1 && (
            <>
              <div className="auth-kyc-step-title">{t('k_y_c_onboarding_9334ed')}</div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10}}>
                <div className="input-group"><span className="input-group__label">{t('fld_first_name')}</span><input aria-label={t('fld_first_name')} value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})}/></div>
                <div className="input-group"><span className="input-group__label">{t('fld_last_name')}</span><input aria-label={t('fld_first_name')} value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})}/></div>
              </div>
              <div className="input-group"><span className="input-group__label">{t('k_y_c_onboarding_31fbff')}</span><input aria-label={t('fld_last_name')} type="date" value={form.birth} onChange={e => setForm({...form, birth: e.target.value})}/></div>
              <div className="input-group">
                <span className="input-group__label">{t('k_y_c_onboarding_ff63ca')}</span>
                <select aria-label={t('k_y_c_onboarding_ff63ca')} value={form.nationality} onChange={e => setForm({...form, nationality: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
                  {countryOptions()}
                </select>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="auth-kyc-step-title">{t('k_y_c_onboarding_ebce71')}</div>
              <div className="input-group"><span className="input-group__label">{t('fld_address')}</span><input aria-label={t('fld_address')} placeholder={t('k_y_c_onboarding_dad291')} value={form.address} onChange={e => setForm({...form, address: e.target.value})}/></div>
              <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap: 10}}>
                <div className="input-group"><span className="input-group__label">{t('fld_city')}</span><input aria-label={t('fld_address')} value={form.city} onChange={e => setForm({...form, city: e.target.value})}/></div>
                <div className="input-group"><span className="input-group__label">{t('fld_postal')}</span><input aria-label={t('fld_city')} value={form.postal} onChange={e => setForm({...form, postal: e.target.value})}/></div>
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
                <select aria-label={t('k_y_c_onboarding_f01127')} value={form.source} onChange={e => setForm({...form, source: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
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
                <select aria-label={t('k_y_c_onboarding_898ed0')} value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
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
  window.PasswordResetPage = function PasswordResetPage({ shellProps: _shellProps }) {
    const [step, setStep] = useState(1);
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [resetError, setResetError] = useState('');
    const [resetToken, setResetToken] = useState('');
    const [newPw, setNewPw] = useState('');
    const [newPw2, setNewPw2] = useState('');
    const [resetDone, setResetDone] = useState(false);

    /*
       ★★ 재설정 링크로 도착한 경우. 메일의 버튼(#/password-reset?token=…)을 누르면
         URL 에 토큰이 실려 온다. 그 토큰을 읽어 '새 비밀번호 입력'(step 3) 으로 간다.
         (예전엔 이 단계가 없어 링크를 눌러도 비밀번호를 바꿀 수 없었다.)
    */
    useEffect(() => {
      const hash = String(window.location.hash || '');
      const q = hash.indexOf('?');
      const tok = q === -1 ? '' : (new URLSearchParams(hash.slice(q + 1)).get('token') || '');
      if (tok) { setResetToken(tok); setStep(3); }
    }, []);

    /* 새 비밀번호 확정. 서버가 토큰을 단 한 번만 받아 처리한다. */
    const doReset = () => {
      setResetError('');
      if (newPw.length < 10) { setResetError(t('pwreset_too_short')); return; }
      if (newPw !== newPw2) { setResetError(t('pwreset_mismatch')); return; }
      if (!window.QTApi || !window.QTApi.auth) { setResetDone(true); return; }
      setLoading(true);
      window.QTApi.auth.resetPassword(resetToken, newPw)
        .then((r) => {
          setLoading(false);
          if (r && r.ok === false) { setResetError(t('pwreset_link_invalid')); return; }
          setResetDone(true);
        })
        .catch((err) => {
          setLoading(false);
          setResetError((err && err.message) || t('pwreset_link_invalid'));
        });
    };

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
                <input aria-label={t('fld_email')} type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus/>
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
          {step === 3 && (
            resetDone ? (
              <div style={{textAlign:'center'}}>
                <div className="auth-verify-icon"><I.Check size={30}/></div>
                <div style={{fontSize:14, fontWeight:500, marginTop:12, color:'var(--color-success)'}}>{t('pwreset_done')}</div>
                <button className="btn btn--primary btn--lg" style={{width:'100%', marginTop:20}} onClick={() => { window.location.hash = '/login'; }}>{t('verify_go_login')}</button>
              </div>
            ) : (
              <>
                <div style={{textAlign:'center', fontSize:12.5, color:'var(--color-text-secondary)', marginBottom:8}}>{t('pwreset_new_hint')}</div>
                <div className="input-group">
                  <span className="input-group__label"><I.Lock size={11}/> {t('pwreset_new_pw')}</span>
                  <input aria-label={t('pwreset_new_pw')} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} autoFocus/>
                  {/*
                     ★★ 규칙을 **입력 전에** 알린다.

                       예전에는 짧게 넣고 제출한 뒤에야 "최소 10자" 오류를 봤다.
                       규칙을 나중에 알려주는 것은 고객에게 실패를 한 번 겪게 한 뒤
                       가르치는 것이다. 실제로 이 지점에서 막힌다는 보고를 받았다.
                  */}
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:4}}>
                    {t('pw_rule_hint')}
                  </div>
                </div>
                <div className="input-group">
                  <span className="input-group__label"><I.Lock size={11}/> {t('pwreset_new_pw2')}</span>
                  <input aria-label={t('pwreset_new_pw2')} type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)}/>
                </div>
                {resetError && (
                  <div className="auth-alert auth-alert--danger"><I.Alert size={12}/><div>{resetError}</div></div>
                )}
                <button className="btn btn--primary btn--lg" style={{width:'100%'}} onClick={doReset} disabled={loading || !newPw || !newPw2}>
                  {loading ? <><span className="spinner"/> {t('login_33c1f7')}</> : t('pwreset_submit')}
                </button>
              </>
            )
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

    /*
       랜딩의 실시간 시세.

       ★★ 첫 화면에 스크린샷이나 예시 숫자를 두지 않는다. 공개 API(/api/market/…)는
         로그인 없이 열려 있으므로, 방문자가 보는 값은 **지금 거래소에서 온 실데이터**다.
         읽지 못하면 '—' 를 두고 안내 문구를 보여준다 — 예시로 채우면 그 값을 믿는다.

       ★ 세 종목만 부른다. 랜딩에서 664종을 부르면 첫 화면이 느려지고, 방문자가
         비교하려는 것은 대표 종목이다.
    */
    const LANDING_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const [liveQuotes, setLiveQuotes] = useState(null);   // null = 조회 중 · [] = 실패
    useEffect(() => {
      let cancelled = false;
      const rest = window.QTApi && window.QTApi.rest;
      if (!rest || !rest.candles) { setLiveQuotes([]); return undefined; }
      Promise.all(LANDING_SYMBOLS.map((s) => Promise.all([
        rest.candles(s, '1h', 48).catch(() => null),
        rest.ticker ? rest.ticker(s).catch(() => null) : Promise.resolve(null),
      ]).then(([c, tk]) => {
        const rows = (c && c.data) || [];
        const closes = Array.isArray(rows)
          ? rows.map((r) => Number(r.close)).filter((n) => Number.isFinite(n))
          : [];
        if (closes.length < 2) return null;
        const first = closes[0];
        const last = closes[closes.length - 1];
        return {
          symbol: s,
          closes,
          last,
          /* 변동률은 우리가 받은 캔들로 계산한다 — 티커의 24h 값과 창이 달라 섞으면 어긋난다. */
          changePct: first > 0 ? ((last - first) / first) * 100 : null,
          vol24h: tk && tk.data && Number.isFinite(Number(tk.data.vol24h)) ? Number(tk.data.vol24h) : null,
        };
      }))).then((list) => {
        if (!cancelled) setLiveQuotes(list.filter(Boolean));
      }).catch(() => { if (!cancelled) setLiveQuotes([]); });
      return () => { cancelled = true; };
    }, []);

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
            <img className="app-brand__logo" src="/src/ccai-logo.png" alt={window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'}/>
            <span className="app-brand__name">{window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'}</span>
            
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
              { id: 'live', key: 'landing_nav_live' },
              { id: 'how', key: 'landing_nav_how' },
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
            {/*
               ★★ 공개 랜딩에 있던 개발자 문서 링크(design-system.html)를 없앴다.
                 두 가지 문제가 있었다:
                   · 그 파일은 정적 서빙 허용목록에 없어 **404 가 난다**(실측).
                     방문자가 처음 보는 화면에서 깨진 링크를 누르게 된다.
                   · 내부 디자인 문서는 고객에게 보여줄 것이 아니다.
                 필요한 사람은 관리자 화면(/admin/design-ops)에서 열 수 있다.
            */}
          </nav>
          <div style={{display:'inline-flex', gap: 6}}>
            <a className="btn btn--sm" href="#/login">{t('login_e225a6')}</a>
            <a className="btn btn--sm btn--primary" href="#/signup">{t('signup_ecb4cc')}</a>
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-hero__badge">
            <span className="dot dot--ai"/> {t('landing_hero_badge')}
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

        {/*
           실시간 시세.

           ★★ 랜딩에 제품 스크린샷을 붙이는 대신 **실데이터를 그린다.** 방문자가
             "진짜 도는 서비스인가" 를 확인하는 가장 짧은 경로다. 값을 읽지 못하면
             예시로 채우지 않고 못 읽었다고 말한다.
        */}
        <section id="live" className="landing-section">
          <div className="landing-section-title">{t('landing_live_title')}</div>
          <div className="landing-live__sub">{t('landing_live_sub')}</div>
          {liveQuotes === null ? (
            <div className="landing-live__note">{t('cmp_loading')}</div>
          ) : liveQuotes.length === 0 ? (
            <div className="landing-live__note">{t('landing_live_unavailable')}</div>
          ) : (
            <>
              <div className="landing-live">
                {liveQuotes.map((q) => {
                  /* 스파크라인 — 받은 종가만으로 그린다. 값이 없으면 이 카드는 나오지 않는다. */
                  const w = 260;
                  const h = 64;
                  const lo = Math.min(...q.closes);
                  const hi = Math.max(...q.closes);
                  const span = hi - lo || 1;
                  const step = q.closes.length > 1 ? w / (q.closes.length - 1) : w;
                  const pts = q.closes.map((c, i) => `${(i * step).toFixed(1)},${(h - ((c - lo) / span) * (h - 6) - 3).toFixed(1)}`);
                  const up = q.changePct !== null && q.changePct >= 0;
                  /* ★ 토큰 이름을 틀리면 선이 그려지지 않는다(stroke 가 무효값이 된다).
                       실제 토큰은 --color-trade-long / --color-trade-short 다. */
                  const stroke = up ? 'var(--color-trade-long)' : 'var(--color-trade-short)';
                  return (
                    <div key={q.symbol} className="landing-live__card">
                      <div className="landing-live__head">
                        <strong>{q.symbol.replace('USDT', '/USDT')}</strong>
                        <span className={up ? 't-long' : 't-short'}>
                          {q.changePct === null ? '—' : `${up ? '+' : ''}${q.changePct.toFixed(2)}%`}
                        </span>
                      </div>
                      <div className="landing-live__price">{fmtNum(q.last)}</div>
                      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
                        {/* 면적을 옅게 깔고 선을 얹는다 — 선만 있으면 작은 화면에서 거의 보이지 않는다. */}
                        <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={stroke} opacity="0.14"/>
                        <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
                      </svg>
                    </div>
                  );
                })}
              </div>
              <div className="landing-live__note">
                {t('landing_live_note', { n: liveQuotes[0] ? liveQuotes[0].closes.length : 0 })}
              </div>
            </>
          )}
        </section>

        {/*
           자금의 위치.

           ★★ 비수탁이라는 말은 글로만 쓰면 읽히지 않는다. 자금이 어디 있고 우리가
             무엇을 보내는지 그림으로 한 번에 보여준다. 여기에 적은 세 가지는 모두
             코드로 확인되는 사실이다(출금 권한 미요구·지갑 없음·직원 출금 불가).
        */}
        <section id="custody" className="landing-section">
          <div className="landing-section-title">{t('landing_custody_title')}</div>
          <div className="landing-live__sub">{t('landing_custody_sub')}</div>
          <div className="landing-flow">
            <div className="landing-flow__node">
              <div className="landing-flow__icon"><I.User size={18}/></div>
              <strong>{t('landing_custody_you')}</strong>
              <span>{t('landing_custody_you_sub')}</span>
            </div>
            <div className="landing-flow__arrow">
              <span>{t('landing_custody_flow_1')}</span>
              <div className="landing-flow__line"><i/></div>
              <span className="landing-flow__back">{t('landing_custody_flow_2')}</span>
            </div>
            <div className="landing-flow__node landing-flow__node--us">
              <div className="landing-flow__icon"><I.Chart size={18}/></div>
              <strong>{t('landing_custody_us')}</strong>
              <span>{t('landing_custody_us_sub')}</span>
            </div>
            <div className="landing-flow__arrow">
              <span>{t('landing_custody_flow_1')}</span>
              <div className="landing-flow__line"><i/></div>
              <span className="landing-flow__back">{t('landing_custody_flow_2')}</span>
            </div>
            <div className="landing-flow__node">
              <div className="landing-flow__icon"><I.Wallet size={18}/></div>
              <strong>{t('landing_custody_ex')}</strong>
              <span>{t('landing_custody_ex_sub')}</span>
            </div>
          </div>
          <ul className="landing-custody__points">
            <li>{t('landing_custody_point_1')}</li>
            <li>{t('landing_custody_point_2')}</li>
            <li>{t('landing_custody_point_3')}</li>
          </ul>
        </section>

        {/* 시작 절차 — 가입에서 첫 주문까지 무엇이 필요한지 숨기지 않는다. */}
        <section id="how" className="landing-section">
          <div className="landing-section-title">{t('landing_how_title')}</div>
          <div className="landing-steps">
            {[
              ['landing_how_1', 'landing_how_1_sub'],
              ['landing_how_2', 'landing_how_2_sub'],
              ['landing_how_3', 'landing_how_3_sub'],
              ['landing_how_4', 'landing_how_4_sub'],
            ].map(([k, sub], i) => (
              <div key={k} className="landing-step">
                <div className="landing-step__no">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div className="landing-step__title">{t(k)}</div>
                  <div className="landing-step__body">{t(sub)}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{textAlign: 'center', marginTop: 22}}>
            <a className="btn btn--primary btn--lg" href="#/signup">
              <I.Sparkles size={14}/> {t('landing_how_cta')}
            </a>
          </div>
        </section>

        <section id="features" className="landing-section">
          <div className="landing-section-title">{t('landing_why_brand')}</div>
          <div className="landing-feat-grid">
            {[
              { icon: 'Sparkles', title: t('auth_feat_ai'), body: t('landing_5f6b64') },
              { icon: 'Chart',    title: t('landing_feat_layout'), body: t('landing_44cbb3') },
              { icon: 'Alert',    title: t('auth_feat_safety'), body: t('landing_40f668') },
              /*
                 ★★ 전에는 '8+ Exchange Integration' 과 함께
                   'Binance · Bitget · OKX · Bybit · BitMart · Gate · Kraken · Coinbase'
                   가 박혀 있었다. 실제로 연결되는 것은 카탈로그가 connectable 로
                   표시한 것뿐이다(현재 KuCoin·BitMart). 나머지는 어댑터가 없다 —
                   가입한 사람이 Binance 를 연결하려다 방법이 없음을 알게 된다.
              */
              { icon: 'Wallet',   title: t('landing_feat_ex_title'),
                body: landingExchanges.length > 0
                  ? t('landing_feat_ex_body', { names: landingExchanges.map((e) => e.name).join(' · ') })
                  : t('landing_feat_ex_none') },
              { icon: 'Book',     title: t('auth_feat_journal'), body: t('landing_69704c') },
              { icon: 'Layers',   title: t('auth_feat_design'), body: t('landing_feat_design_body') },
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

        {/*
           요금.

           ★★ 전에는 Beginner $0 / Pro $29 / VIP "문의" 3장의 요금표가 있었고
             'POPULAR' 배지와 결제로 이어지는 CTA 까지 붙어 있었다. 그런데
             **결제 사업자가 연결돼 있지 않다.** 서버도 구독 등급을
             `unavailable: ['subscriptionTiers', …]` 로 선언한다. 즉 월 $29 를
             내려고 눌러도 낼 수 있는 곳이 없다. 런칭 첫 화면에서 팔 수 없는
             것을 파는 것이 가장 나쁘다.

           ★ 섹션을 지우지 않고 사실을 쓴다 — 방문자는 요금을 찾아서 여기를 누른다.
             "무료다 / 청구할 수단이 없다 / 유료가 열리면 먼저 알린다" 를 말한다.
        */}
        <section id="pricing" className="landing-section">
          <div className="landing-section-title">{t('landing_nav_pricing')}</div>
          <div className="landing-pricing">
            <div className="landing-price-card is-highlight" style={{gridColumn: '1 / -1'}}>
              <div className="landing-price-card__name">{t('landing_price_title')}</div>
              <div className="landing-price-card__price"><strong>$0</strong></div>
              <ul>
                <li>✓ {t('landing_price_body_1')}</li>
                <li>✓ {t('landing_price_body_2')}</li>
                <li>✓ {t('landing_price_body_3')}</li>
              </ul>
              <a className="btn btn--primary" href="#/signup" style={{width: '100%'}}>{t('landing_price_cta')}</a>
            </div>
          </div>
        </section>

        <section id="exchanges" className="landing-section">
          <div className="landing-section-title">{t('landing_exchanges_title')}</div>
          <div className="landing-exchanges">
            {landingExchanges.map(ex => (
              <div key={ex.id} className="landing-ex">
                <div className="landing-ex__logo" style={{background: ex.logoBg, color: ex.logoColor}}>{(window.exchangeLogo && window.exchangeLogo(ex.id, { size: 20 })) || ex.logoText}</div>
                <div className="landing-ex__name">{ex.name}</div>
                <div className="landing-ex__market">{ex.marketKey ? t(ex.marketKey) : ex.market}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="landing-foot">
          <div>© 2026 {window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'}</div>
          <div className="landing-foot__biz">{t('foot_business')}</div>
          {/*
             ★★ 법적 문서 링크를 랜딩에 둔다.

               전에는 약관·개인정보·위험고지·보안 문서가 **가입 화면에서만** 닿을 수
               있었다. 가입 전에 조건을 읽으려는 방문자는 찾을 방법이 없다. 파생상품을
               다루는 서비스에서 위험 고지에 닿지 못하는 첫 화면은 그 자체로 문제다.
             ★ 문의 주소도 함께 둔다 — 서버 설정(supportEmail)에서 온다. 값이 없으면
               링크를 만들지 않는다(mailto: 빈 주소는 오류처럼 보인다).
          */}
          <div className="landing-foot__legal">
            <a href="#/terms">{t('auth_3b9e30')}</a>
            <a href="#/privacy">{t('auth_d629d0')}</a>
            <a href="#/risk">{t('legal_risk')}</a>
            <a href="#/security">{t('auth_a5e5da')}</a>
            <a href="#/refund">{t('legal_refund')}</a>
            {/*
               ★ 문의 게시판이 주 창구다. 전화번호를 게시하지 않는 대신 게시판에서
                 질문·요청·문의를 받고 답변과 처리 상태를 같은 화면에서 볼 수 있게 한다.
                 로그인이 필요하므로, 눌렀을 때 로그인 화면으로 가는 것은 정상이다.
            */}
            <a href="#/help">{t('landing_foot_board')}</a>
            {(() => {
              const c = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
              const mail = (c && c.supportEmail) || '';
              return mail ? <a href={`mailto:${mail}`}>{mail}</a> : null;
            })()}
          </div>
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
  window.NotFoundPage = function NotFoundPage({ shellProps: _shellProps, message }) {
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
