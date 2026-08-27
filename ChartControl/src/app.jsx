/* ============================================================
   Main App — routing shell, header, sidebar, trading screen
   ============================================================ */

(function () {
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const I = window.Icons;
  const { fmt, fmtPrice } = window.QTFmt;

  /**
   * 번역 조회 — 파일 단위 헬퍼.
   *
   * ★★ 왜 필요했나 (실제로 주문을 막고 있던 결함)
   *
   *   `t` 가 App 컴포넌트 **안에서** useCallback 으로만 정의돼 있었다. 그런데
   *   ChartWidget · RiskChecklist · OrderPreviewModal 은 App 밖에 정의된 별도
   *   컴포넌트다. 그 셋이 t() 를 52번 호출하고 있었고, 전부
   *   `ReferenceError: t is not defined` 로 터졌다.
   *
   *   결과가 나빴다: **매수 버튼을 눌러도 아무 일도 일어나지 않았다.**
   *   주문 확인창(OrderPreviewModal)이 렌더 도중 예외로 죽어서, 사용자는
   *   버튼이 고장난 줄 알고 다시 누르게 된다. 콘솔을 열지 않으면 원인을
   *   알 수 없다.
   *
   *   실주문을 켠 뒤에 발견했다면 "주문이 안 나간다" 는 신고를 받고 원인을
   *   찾는 동안 거래를 못 했을 것이다.
   *
   * ★ App 안의 t 는 그대로 둔다. 그것은 tweaks.lang 변경에 반응해야 하므로
   *   useCallback 이어야 한다. 이 헬퍼는 App 밖 컴포넌트용이고, 호출 시점에
   *   현재 언어를 조회하므로 결과는 같다.
   */
  const t = (k, vars) => (window.QTI18n ? window.QTI18n.t(k, vars) : k);

  /*
     필수 면책 동의 게이트. 첫 사용 시 한 번, "이 서비스는 투자자문이 아니며 모든
     판단·매매는 본인 책임" 을 명확히 고지하고 동의를 받는다(규제/책임 방어).
     동의는 localStorage 에 남긴다(문구 버전이 바뀌면 KEY 를 올려 재동의).
  */
  function DisclaimerGate() {
    const KEY = 'qt.disclaimer.ack.v1';
    const [ack, setAck] = React.useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } });
    if (ack) return null;
    const agree = () => { try { localStorage.setItem(KEY, '1'); } catch (e) { /* noop */ } setAck(true); };
    return (
      <div role="dialog" aria-modal="true" aria-label={t('disc_title')}
        style={{position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.72)', display:'flex', alignItems:'center', justifyContent:'center', padding:16}}>
        <div style={{maxWidth:560, width:'100%', background:'var(--color-bg-elevated, #14181f)', border:'1px solid var(--color-border-default, #2a2f3a)', borderRadius:10, padding:'22px 22px 18px', boxShadow:'0 20px 60px rgba(0,0,0,0.5)'}}>
          <div style={{fontSize:16, fontWeight:700, marginBottom:10, color:'var(--color-text-primary, #fff)'}}>{t('disc_title')}</div>
          <div style={{fontSize:13, lineHeight:1.75, color:'var(--color-text-secondary, #b8c0cc)', whiteSpace:'pre-line'}}>{t('disc_body')}</div>
          <div style={{display:'flex', gap:12, marginTop:18, alignItems:'center', justifyContent:'flex-end'}}>
            <a href="#/risk" style={{fontSize:12, color:'var(--color-brand, #35d0e0)'}}>{t('disc_read_more')}</a>
            <button className="btn btn--primary" onClick={agree}>{t('disc_agree')}</button>
          </div>
        </div>
      </div>
    );
  }
  window.DisclaimerGate = DisclaimerGate;

  /*
    프로필 메뉴 — 예전에는 동그란 아바타 버튼을 누르면 **즉시 로그아웃**됐다.
    실수로 눌러 세션이 끊기는 문제가 있어, 아래로 열리는 드롭다운으로 바꾼다.
    (개인설정 · 포인트 · 로그아웃). 기존 번역 키만 재사용해 하드코딩을 피한다.
  */
  function ProfileMenu({ auth, pushRoute }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef(null);
    React.useEffect(() => {
      if (!open) return undefined;
      const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onEsc);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
    }, [open]);
    const initial = auth.user && auth.user.email ? auth.user.email[0].toUpperCase() : 'K';
    const avatar = (
      <div style={{width:22, height:22, background:'var(--color-brand)', color:'var(--color-text-inverse)', borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600}}>{initial}</div>
    );
    if (!auth.user) {
      return (
        <button className="header-tool header-tool--icon" title={t('profile_sign_in')} onClick={() => pushRoute('/login')}>{avatar}</button>
      );
    }
    const go = (route) => { setOpen(false); pushRoute(route); };
    const doLogout = () => {
      setOpen(false);
      if (window.QTAuth) window.QTAuth.logout().then(() => pushRoute('/login'));
      else pushRoute('/login');
    };
    return (
      <div ref={ref} style={{position:'relative', display:'inline-flex'}}>
        <button className="header-tool header-tool--icon" aria-haspopup="true" aria-expanded={open}
          title={t('profile_signed_in_as', { email: auth.user.email })}
          onClick={() => setOpen((o) => !o)}>{avatar}</button>
        {open && (
          <div role="menu" className="profile-menu">
            <div className="profile-menu__email">{auth.user.email}</div>
            <button role="menuitem" className="profile-menu__item" onClick={() => go('/settings')}>{t('nav_settings')}</button>
            <button role="menuitem" className="profile-menu__item" onClick={() => go('/points')}>{t('nav_points')}</button>
            <button role="menuitem" className="profile-menu__item profile-menu__item--danger" onClick={doLogout}>{t('set_sign_out')}</button>
          </div>
        )}
      </div>
    );
  }
  window.ProfileMenu = ProfileMenu;

  /*
    최소 법적 푸터 — 거래(전체화면) 화면을 제외한 일반 페이지 하단에 얇게 깐다.
    꼭 필요한 것만: 브랜드·© 연도, 약관·개인정보·리스크·환불 링크, 한 줄 리스크 고지, 문의.
  */
  function AppFooter() {
    const brand = (window.QTI18n && window.QTI18n.brand) ? window.QTI18n.brand() : 'ChartControl AI';
    const year = new Date().getFullYear();
    const support = (window.QTConfig && window.QTConfig.supportEmail) || 'support@beomonnuri.com';
    return (
      <footer className="app-legal-footer">
        <span className="app-legal-footer__biz">{t('foot_business')}</span>
        <span className="app-legal-footer__copy">© {year} {brand} · {t('foot_disclaimer')}</span>
        <span className="app-legal-footer__links">
          <a href="#/terms">{t('auth_3b9e30')}</a>
          <a href="#/privacy">{t('auth_d629d0')}</a>
          <a href="#/risk">{t('legal_risk')}</a>
          <a href="#/refund">{t('legal_refund')}</a>
          <a href={`mailto:${support}`}>{support}</a>
        </span>
      </footer>
    );
  }
  window.AppFooter = AppFooter;

  // ---- Persist / read tweaks state ----
  /**
   * 기본 언어를 브라우저 설정에서 결정한다.
   *
   * 해외 우선 출시이므로 기본은 영어다. 브라우저 설정이 **등록된 서비스 언어**
   * (영어·일본어·중국어) 중 하나와 맞으면 그 언어로 시작한다. 맞는 것이 없으면
   * 영어다 — 한국어 브라우저도 영어로 시작한다(한국어는 서비스 언어가 아니다).
   * 사용자가 Tweaks 에서 직접 바꾸면 그 선택이 localStorage 에 저장되어 이
   * 함수보다 우선한다.
   */
  function detectDefaultLang() {
    // 언어 후보를 하드코딩하지 않는다. i18n 레지스트리에 등록된 언어와
    // 브라우저 설정을 대조하므로, 로케일 파일을 추가하면 자동으로 후보가 된다.
    if (window.QTI18n) return window.QTI18n.detect();
    return 'en';
  }

  const DEFAULT_TWEAKS = {
    theme: 'dark',
    brand: 'institutional-cool',
    longshort: 'teal-magenta',
    density: 'comfortable',
    presetId: 'standard-trader',
    lang: detectDefaultLang(),
    pro: true,      // Pro is default (interactions_depth 8)
    numFmt: 'standard',
    autofit: true, // 자동맞춤: Trade 탭에 기본 적용(화면 꽉 채움 + 촘촘 + 주문버튼 고정). 토글로 끌 수 있다.
    role: 'user',   // user | ops | admin | super
  };

  function useTweaks() {
    const [state, setState] = useState(() => {
      const saved = localStorage.getItem('qt.tweaks');
      if (saved) { try { return { ...DEFAULT_TWEAKS, ...JSON.parse(saved) }; } catch (e) {} }
      return DEFAULT_TWEAKS;
    });
    useEffect(() => {
      localStorage.setItem('qt.tweaks', JSON.stringify(state));
      const root = document.documentElement;
      root.dataset.theme = state.theme;
      root.dataset.brand = state.brand;
      root.dataset.longshort = state.longshort;
      root.dataset.density = state.density;
      // (data-autofit 은 App 레벨에서 tweaks.autofit 과 /trade-ex 라우트를 합쳐 설정한다.)
      // 언어는 i18n 이 단일 출처다. setLocale 이 document lang 도 갱신한다.
      if (window.QTI18n) {
        /*
           ★ setLocale 은 등록되지 않은 언어를 폴백으로 정규화하고 **실제로 적용된
             값**을 돌려준다. 그 값을 저장 상태에 되써야 한다.

             되쓰지 않으면 화면 문장은 영어인데 헤더 버튼에는 저장된 코드가 그대로
             찍힌다. 한국어를 서비스 언어에서 제외한 뒤, 이미 lang='ko' 를 저장한
             브라우저가 정확히 그 상태가 된다 — 영어 화면에 KO 표시.
        */
        const applied = window.QTI18n.setLocale(state.lang);
        if (applied && applied !== state.lang) {
          setState((s) => (s.lang === applied ? s : { ...s, lang: applied }));
        }
      } else {
        root.setAttribute('lang', state.lang);
      }
    }, [state]);
    const set = useCallback((partial) => setState(s => ({ ...s, ...partial })), []);
    return [state, set];
  }

  /**
   * 유효 등급 — 화면 권한 판단의 단일 출처.
   *
   * 서버 세션이 있으면 **서버 등급만** 쓴다. 헤더의 등급 스위치는 디자이너가
   * 화면을 미리 보기 위한 도구이므로 지우지 않지만, 백엔드가 붙은 상태에서는
   * 효력이 없다. 그러지 않으면 콘솔에서 등급을 바꿔 관리자 화면을 열 수 있다.
   *
   *   백엔드 있음 + 로그인  → 서버 등급
   *   백엔드 있음 + 비로그인 → null (등급 제한이 있는 것은 아무것도 못 봄)
   *   백엔드 없음(정적 프리뷰) → 스위치 값 (실데이터가 없으니 위험하지 않다)
   *
   * 이건 1겹(화면 숨김)이다. 실제 차단은 서버가 403 으로 한다.
   */
  function useEffectiveRole(tweaksRole) {
    const [snap, setSnap] = useState(() =>
      window.QTAuth ? window.QTAuth.get() : { tier: null, loading: false, offline: true }
    );

    useEffect(() => {
      if (!window.QTAuth) return undefined;
      setSnap(window.QTAuth.get());
      return window.QTAuth.subscribe((s) => setSnap({ ...s }));
    }, []);

    // 백엔드가 없으면 스위치를 그대로 쓴다 (정적 프리뷰 계약).
    if (!window.QTAuth || snap.offline) {
      return { role: tweaksRole, loading: false, offline: true, user: null, switchActive: true };
    }
    return {
      role: snap.tier,
      loading: snap.loading,
      offline: false,
      user: snap.user || null,
      switchActive: false,
    };
  }

  // ---- Router hash ----
  /*
     해시가 없을 때 어디로 보낼지.

     ★★ 원래 무조건 `/trade` 로 보냈다. 그래서 주소창에 도메인만 입력해
       들어온 **비로그인 방문자에게 404("이 페이지를 보려면 로그인이 필요합니다")**
       가 떴다. 처음 오는 사람이 보는 첫 화면이 404 면 그대로 떠난다.

     ★ 로그인 상태를 확인할 수 없는 시점(스크립트 로드 직후)에도 판단해야 한다.
       `QTAuth` 가 아직 없으면 **랜딩으로 둔다** — 비로그인에게 404 를 보여주는
       것이 로그인 사용자에게 랜딩을 한 번 보여주는 것보다 나쁘다.
       (로그인 사용자는 랜딩에서 바로 거래로 갈 수 있다)
  */
  function defaultRoute() {
    try {
      const auth = window.QTAuth;
      if (auth && typeof auth.isLoggedIn === 'function' && auth.isLoggedIn()) return '/trade';
    } catch (e) { /* 판단 불가 → 랜딩 */ }
    return '/';
  }

  function useRoute() {
    const [route, setRoute] = useState(() => {
      const hash = window.location.hash.replace(/^#/, '') || defaultRoute();
      const [path, qs] = hash.split('?');
      const query = Object.fromEntries(new URLSearchParams(qs || ''));
      return { path, query };
    });
    useEffect(() => {
      const onHash = () => {
        const hash = window.location.hash.replace(/^#/, '') || defaultRoute();
        const [path, qs] = hash.split('?');
        setRoute({ path, query: Object.fromEntries(new URLSearchParams(qs || '')) });
      };
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const push = useCallback((path, query = {}) => {
      const qs = new URLSearchParams(query).toString();
      window.location.hash = path + (qs ? '?' + qs : '');
    }, []);
    return [route, push];
  }

  // ---- Toasts ----
  function useToasts() {
    const [toasts, setToasts] = useState([]);
    const push = useCallback((toast) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(t => [...t, { id, ...toast }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), toast.duration || 4200);
    }, []);
    /*
       ★ 개별 안내를 지우는 함수. 행동 버튼(예: "되살리기")을 누르면 그 안내는
         할 일이 끝났으므로 즉시 사라져야 한다 — 남아 있으면 또 눌린다.
    */
    const dismiss = useCallback((id) => {
      setToasts(t => t.filter(x => x.id !== id));
    }, []);
    return [toasts, push, dismiss];
  }

  // ============================================================
  // ROOT APP
  // ============================================================
  window.App = function App() {
    const [tweaks, setTweaks] = useTweaks();

    /*
       거래 모드. 주문 경로를 결정하므로 화면 상태와 따로 두지 않는다 —
       어긋나면 "모의인데 실주문" 이라는 사고가 된다.
    */
    /*
       청산 위험 경고. 실 포지션이 있을 때만 값이 채워진다.
       목업 포지션으로 경고를 내면 사용자가 실제 위험으로 오해한다.
    */
    const [riskAlerts, setRiskAlerts] = useState(() => (window.QTRisk ? window.QTRisk.getAlerts() : []));
    useEffect(() => {
      if (!window.QTRisk) return undefined;
      setRiskAlerts(window.QTRisk.getAlerts());
      return window.QTRisk.subscribe((list) => setRiskAlerts(list.slice()));
    }, []);


    const [tradeMode, setTradeMode] = useState(() => (window.QTMode ? window.QTMode.get() : 'futures'));
    useEffect(() => {
      if (!window.QTMode) return undefined;
      setTradeMode(window.QTMode.get());
      return window.QTMode.subscribe((m) => setTradeMode(m));
    }, []);
    // 화면 권한의 단일 출처. 백엔드가 붙으면 서버 등급이 스위치를 덮어쓴다.
    const auth = useEffectiveRole(tweaks.role);
    const [route, pushRoute] = useRoute();

    /*
       자동맞춤(auto-fit) 적용 여부. Trade 탭에 기본 적용(DEFAULT_TWEAKS.autofit=true).
       상단 ⊹ 토글로 켜고 끌 수 있다. CSS 는 html[data-autofit="on"] 에서만 반응한다.
    */
    useEffect(() => {
      document.documentElement.dataset.autofit = tweaks.autofit ? 'on' : 'off';
    }, [tweaks.autofit]);

    /*
       서랍 닫기.

       메뉴를 눌러 이동했는데 서랍이 그대로 열려 있으면 본문이 가려진다.
       라우트가 바뀌면 닫는다. 바깥을 눌렀을 때도 닫아야 하는데, 그 막(::after)은
       CSS 로 만든 가상 요소라 클릭을 받을 수 없어서 문서 클릭으로 처리한다.
    */
    useEffect(() => {
      document.documentElement.setAttribute('data-qt-drawer', 'closed');
    }, [route.path]);

    useEffect(() => {
      const onDocClick = (e) => {
        const el = document.documentElement;
        if (el.getAttribute('data-qt-drawer') !== 'open') return;
        // 사이드바 안이나 토글 버튼을 누른 것이면 유지한다.
        if (e.target.closest && (e.target.closest('.app-sidebar') || e.target.closest('.qt-drawer-toggle'))) return;
        el.setAttribute('data-qt-drawer', 'closed');
      };
      const onKey = (e) => {
        if (e.key === 'Escape') document.documentElement.setAttribute('data-qt-drawer', 'closed');
      };
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKey);
      };
    }, []);
    const [tweaksOpen, setTweaksOpen] = useState(false);

    /*
       언어 드롭다운 열림 상태.

       ★ 바깥을 누르거나 Esc 로 닫는다. 안 닫으면 좁은 화면에서 메뉴가 다른
         버튼 위에 남아 그 버튼을 누를 수 없게 된다.
    */
    const [langOpen, setLangOpen] = useState(false);
    useEffect(() => {
      if (!langOpen) return undefined;
      const onDown = (e) => {
        // 메뉴 안(자기 래퍼 안)을 누른 것이면 닫지 않는다.
        if (e.target && e.target.closest && e.target.closest('.qt-langwrap')) return;
        setLangOpen(false);
      };
      const onKey = (e) => { if (e.key === 'Escape') setLangOpen(false); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [langOpen]);

    /*
       사이드바 접기·고정 상태.

       QTNav 가 유일한 출처다. 거래 화면과 일반 페이지가 같은 값을 봐야
       한쪽에서 접었을 때 다른 쪽도 접힌다.
    */
    const navPrefs = window.QTNav && window.QTNav.useNav
      ? window.QTNav.useNav()
      : { collapsed: true, pinned: [], isPinned: () => false, toggleCollapsed: () => {}, togglePin: () => {} };
    const [toasts, pushToast, dismissToast] = useToasts();

    /*
       토스트를 전역에 노출한다.

       위젯(widgets.jsx)은 props 로 pushToast 를 받지 않는 경로가 있어서
       주문 취소 결과를 알릴 방법이 없었다. props 사슬을 여러 단계 고치는
       대신 여기서 한 번 노출한다 — 알림이 없으면 사용자는 취소가 됐는지
       실패했는지 알 수 없다.
    */
    useEffect(() => {
      window.QTToast = pushToast;
      return () => { if (window.QTToast === pushToast) delete window.QTToast; };
    }, [pushToast]);
    // 번역 조회를 i18n 레지스트리에 위임한다. 디자이너가 만든 QT.I18N 60키는
    // QTI18n.absorbLegacy() 가 흡수하므로 기존 키가 그대로 동작한다.
    const t = useCallback(
      (k, vars) => (window.QTI18n ? window.QTI18n.t(k, vars) : ((QT.I18N[tweaks.lang] && QT.I18N[tweaks.lang][k]) || k)),
      [tweaks.lang],
    );

    /*
       URL 쿼리 → 레이아웃 프리셋.

       무엇이 잘못됐나
       -------------
       프리셋 전환이 **링크의 onClick 에만** 있었다. 헤더 메뉴에는 있었고
       사이드바 메뉴에는 없었다. 그래서 사이드바로 'AI 워크스페이스' 에
       들어가면 URL 은 ?workspace=ai 인데 화면은 기본 프리셋 그대로였고,
       AI 코파일럿 위젯이 아예 마운트되지 않았다. 그 결과 차트 툴바의
       'AI 분석' 버튼도 동작할 수 없었다(코파일럿이 없으므로).

       왜 URL 을 근거로 하는가
       ---------------------
       링크마다 onClick 을 붙이는 방식은 링크를 추가할 때마다 잊는다 —
       실제로 잊었다. 주소가 상태를 결정하게 하면 어느 경로로 들어와도
       같은 화면이 나온다(주소 복사·새로고침·뒤로가기 포함).
    */
    /*
       짧은 별칭. 링크에 쓰기 편한 이름을 실제 프리셋 id 로 옮긴다.

       ★ 별칭에 없는 값이라도 **실제 프리셋 id 이면 그대로 받아들인다.**
         전에는 이 표에 있는 세 개만 동작했고, 프리셋을 추가할 때마다 여기에
         한 줄 넣는 것을 잊으면 `?workspace=<새 프리셋>` 이 조용히 무시됐다
         (실제로 dual-chart 를 추가하고 그렇게 됐다). 표를 잊어도 동작하게
         한다 — 잊을 수 있는 곳을 하나 줄인다.
    */
    /*
       ★ `multi` 별칭은 남긴다 — 멀티차트 **탭**은 없어졌지만 같은 이름의
         레이아웃 프리셋은 그대로 있고, 공유된 옛 링크가 그 배치를 연다.
    */
    const QUERY_PRESET_ALIAS = { ai: 'ai-workspace', chart: 'chart-focus', multi: 'multi-chart', dual: 'dual-chart' };
    function presetFromQuery(v) {
      if (!v) return null;
      const key = String(v);
      if (QUERY_PRESET_ALIAS[key]) return QUERY_PRESET_ALIAS[key];
      const presets = window.QT && window.QT.LAYOUT_PRESETS;
      return presets && presets[key] ? key : null;
    }
    /*
       ★★ 쿼리로 들어온 프리셋은 **일시적**이다 — 되돌려야 한다.

         전에는 적용만 하고 복귀 경로가 없었다. 그래서 `?workspace=ai` 로 한 번
         들어가면 그 배치가 영구히 남았고, 사이드바에서 `Trade` 를 눌러도
         **화면이 그대로**였다(주소만 바뀐다). 이용자에게는 "탭을 눌러도 아무
         반응이 없다" 로 보인다 — 실제로 그렇게 신고받았다.

       ★ 이용자가 그 사이에 직접 프리셋을 바꿨으면 복귀하지 않는다. 명시적인
         선택이 저장된 기억보다 우선한다 — 아니면 이용자가 고른 배치를 우리가
         되돌려 버린다.
    */
    const queryPresetRef = useRef({ applied: null, restoreTo: null });
    useEffect(() => {
      const wanted = presetFromQuery(route.query.workspace) || presetFromQuery(route.query.preset);

      if (wanted) {
        if (tweaks.presetId === wanted) return;
        // 돌아갈 곳을 적어 둔다. 이미 적어 뒀으면 덮지 않는다(중첩 이동).
        if (queryPresetRef.current.restoreTo === null) {
          queryPresetRef.current.restoreTo = tweaks.presetId;
        }
        queryPresetRef.current.applied = wanted;
        setTweaks({ presetId: wanted });
        return;
      }

      // 쿼리가 없어졌다 — 우리가 적용한 프리셋이 아직 그대로면 되돌린다.
      const memo = queryPresetRef.current;
      if (memo.applied && memo.restoreTo && tweaks.presetId === memo.applied) {
        const back = memo.restoreTo;
        queryPresetRef.current = { applied: null, restoreTo: null };
        setTweaks({ presetId: back });
        return;
      }
      /*
         ★ 이용자가 직접 다른 프리셋을 골랐으면 기억을 버린다. 남겨 두면
           나중에 엉뚱한 시점에 되돌려 버린다.
      */
      if (memo.applied && tweaks.presetId !== memo.applied) {
        queryPresetRef.current = { applied: null, restoreTo: null };
      }
    }, [route.query.workspace, route.query.preset, tweaks.presetId]);

    // Layout engine
    const engine = window.useLayoutEngine(tweaks.presetId);
    /*
       ★ 패널을 접거나 펴면 다시 그려야 한다. 이 구독이 없으면 접기 버튼을
         눌러도 격자가 그대로 남는다(공간이 이웃에게 넘어가지 않는다).
    */
    if (window.QTPanelState && window.QTPanelState.useCollapsedVersion) {
      window.QTPanelState.useCollapsedVersion();
    }
    useEffect(() => {
      if (engine.presetId !== tweaks.presetId) engine.applyPreset(tweaks.presetId);
    }, [tweaks.presetId]);
    useEffect(() => {
      // Reflect engine-driven preset changes back into Tweaks (so tweaks panel highlights the current preset)
      if (engine.presetId !== tweaks.presetId) setTweaks({ presetId: engine.presetId });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.presetId]);

    // Market state / candles / stream
    /*
       ★★ URL 의 `?symbol=` 을 존중한다.

         이것이 없어서 `#/trade?symbol=ETHUSDT` 로 들어와도 BTC 화면이 열렸다.
         Markets 목록의 'Trade' 버튼이 이 형식으로 링크하므로, 사용자가 SUI 를
         누르고 BTC 주문 패널을 보게 된다 — 잘못된 종목에 주문할 수 있다.

       ★ 없거나 모르는 심볼이면 BTC 로 둔다(기존 동작). 조용히 빈 화면을
         보여주는 것보다 낫다.
    */
    const marketFromQuery = useCallback((raw) => {
      if (!raw) return null;
      const want = String(raw).toUpperCase().replace(/[^A-Z]/g, '');
      if (!want) return null;
      return QT.MARKETS.find((m) => (m.base + m.quote).toUpperCase() === want)
        || QT.MARKETS.find((m) => m.base.toUpperCase() === want)
        || null;
    }, []);
    const [market, setMarket] = useState(
      () => marketFromQuery(route.query.symbol) || QT.MARKETS.find(m => m.base === 'BTC'),
    );
    // 라우트의 심볼이 바뀌면 따라간다(목록에서 다른 종목을 누른 경우).
    useEffect(() => {
      const next = marketFromQuery(route.query.symbol);
      if (next && next !== market) setMarket(next);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.query.symbol]);
    const [timeframe, setTimeframe] = useState('15m');

    /*
       서버 설정(거래 모드·실주문 여부).

       ★★ 훅은 **조건 없이** 같은 순서로 호출해야 한다. 처음에 상단 띠 안에서
         `window.QTApi && window.QTApi.useConfig ? useConfig() : null` 로
         호출했다가 "Rendered more hooks than during the previous render" 로
         **화면 전체가 렌더되지 않았다**(버튼 1개만 남았다). QTApi 스크립트가
         첫 렌더보다 늦게 준비되면 훅 개수가 바뀐다.
         그래서 useState + useEffect 로 고정 개수만 쓴다.
    */
    const [serverCfg, setServerCfg] = useState(
      () => (window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null),
    );
    useEffect(() => {
      if (!window.QTApi || !window.QTApi.subscribeConfig) return undefined;
      return window.QTApi.subscribeConfig((next) => setServerCfg(next));
    }, []);

    // 실데이터 브릿지: 실캔들/실시세가 도착하면 liveVersion 이 올라가고
    // 아래 useMemo 가 다시 계산된다. 백엔드가 없으면 항상 0 이며 목업이 쓰인다.
    const liveVersion = window.QTLive ? window.QTLive.useLiveVersion() : 0;

    // 활성 심볼/타임프레임을 브릿지에 알린다. 이 심볼만 WebSocket 으로 구독된다.
    useEffect(() => {
      if (window.QTLive) window.QTLive.setActiveSymbol(market.base + market.quote);
    }, [market.base, market.quote]);

    // 심볼이 바뀌면 헤더/주문창이 이전 심볼 가격을 들고 있지 않게 즉시 갱신한다.
    // market.price 는 마켓 목록 폴링으로 21개 심볼 모두 실시간 값이 채워져 있다.
    useEffect(() => {
      if (market.price > 0) {
        setLastPrice(market.price);
        setPrevPrice(market.price);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market.base, market.quote]);

    // 심볼이 바뀌면 이전 심볼의 오더북/체결을 즉시 버린다.
    // 그러지 않으면 ETH 화면에 BTC 체결가(68,4xx)가 남아 섞여 보인다.
    //
    // 심볼 전환 직후에는 실데이터가 아직 도착하지 않아 목업이 시딩된다.
    // 그래서 실데이터가 들어올 때까지(liveVersion 변화) 재시딩을 반복하고,
    // 실데이터를 한 번 받으면 멈춘다. 계속 재시딩하면 누적된 실시간 체결이
    // 매번 지워지기 때문이다.
    // 실데이터 여부는 symbol 필드 유무로 판별한다(목업에는 없다).
    const seededRef = useRef(null);
    useEffect(() => {
      const key = market.base + market.quote;
      if (seededRef.current === key) return;

      const book = QT.generateOrderBook(market.price);
      const tape = QT.generateTrades(market.price, 60);
      setOrderBook(book);
      setTrades(tape);

      const bookIsLive = book && book.symbol === key;
      const tapeIsLive = tape.length > 0 && tape[0].symbol === key;
      if (bookIsLive && tapeIsLive) seededRef.current = key;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market.base, market.quote, liveVersion]);
    useEffect(() => {
      if (window.QTLive) window.QTLive.setActiveTimeframe(timeframe);
    }, [timeframe]);

    const candles = useMemo(() => QT.generateCandles({ symbol: market.base + market.quote, tf: timeframe, count: 220, endPrice: market.price }), [market.base, market.quote, timeframe, market.price, liveVersion]);
    const [lastPrice, setLastPrice] = useState(market.price);
    const [prevPrice, setPrevPrice] = useState(market.price);
    const [orderBook, setOrderBook] = useState(() => QT.generateOrderBook(market.price));
    const [trades, setTrades] = useState(() => QT.generateTrades(market.price, 60));
    const [conn, setConn] = useState('live');
    const [latency, setLatency] = useState(34);

    /*
       데이터 신선도.

       1초마다 다시 계산한다. 고정 표시('0s')면 스트림이 죽어도 사용자는
       실시간이라고 믿고, 그 가격으로 주문하면 옛 값에 체결된다.
       null = 아직 데이터를 받은 적 없다 → '—'. 0s 로 채우지 않는다.
    */
    const [dataAgeMs, setDataAgeMs] = useState(null);
    useEffect(() => {
      const read = () => setDataAgeMs(
        window.QTLive && window.QTLive.getDataAgeMs ? window.QTLive.getDataAgeMs() : null,
      );
      read();
      const id = setInterval(read, 1000);
      return () => clearInterval(id);
    }, []);

    const dataAgeLabel = (() => {
      if (dataAgeMs === null) return '—';
      const sec = Math.floor(dataAgeMs / 1000);
      if (sec < 60) return sec + 's';
      const min = Math.floor(sec / 60);
      if (min < 60) return min + 'm';
      return Math.floor(min / 60) + 'h';
    })();

    useEffect(() => {
      const offTick = QT.stream.on('tick', (s) => {
        setPrevPrice(lp => (lp !== s.price ? lp : lp));
        setLastPrice(s.price);
        setLatency(Math.round(s.latencyMs));
      });
      const offOb = QT.stream.on('orderbook', (ob) => setOrderBook(ob));
      const offTrade = QT.stream.on('trade', (tr) => setTrades(prev => [tr, ...prev].slice(0, 80)));
      const offConn = QT.stream.on('connection', (c) => setConn(c.state));
      QT.stream.start();
      return () => { offTick(); offOb(); offTrade(); offConn(); QT.stream.stop(); };
    }, []);

    // Overlays (AI signals + user drawings)
    //
    // 오버레이는 심볼에 귀속된다. ChartCanvas 가 오버레이 가격을 Y축 범위에
    // 포함시키기 때문에(클리핑 방지), 다른 심볼의 오버레이가 남아 있으면
    // 가격대가 다른 심볼로 전환했을 때 캔들이 짜부라진다.
    // 예: BTC 오버레이 67,285 가 남은 상태에서 ETH(1,871) 를 보면
    //     Y범위가 [-3457, 73000] 이 되어 차트가 직선이 된다. (실제로 재현했다)
    // 그래서 각 오버레이에 symbol 을 달고, 현재 심볼 것만 차트에 넘긴다.
    /*
       오버레이 초기값.

       ★★ 전에는 목업 주문·포지션 두 개가 박혀 있었다:
             'Open Order · Long 0.05 @ 67,800'
             'Position Entry · Long 0.185'

         차트에 그려진 글자는 innerText 로 읽히지 않아 목업 탐지에 걸리지
         않았고, 실제 포지션(0.05 @ 64,809)이 있는데도 화면에는 존재하지 않는
         0.185 @ 67,285 선이 보였다. 사용자는 그 가격을 자기 진입가로 읽는다.

         더 나쁜 것: ChartCanvas 는 오버레이 가격을 Y축 범위에 포함시킨다
         (선이 잘리지 않게). 그래서 현재가 64,889 와 3,000 차이 나는 목업 선
         때문에 **캔들이 화면 아래에 납작하게 눌렸다.** 차트를 읽을 수 없는
         상태였다.

       ★ 빈 배열로 시작하고, 실제 주문·포지션이 도착하면 아래 effect 가 채운다.
    */
    const [overlays, setOverlays] = useState([]);
    const activeSymbolKey = market.base + market.quote;
    const addOverlay = useCallback((ov) => setOverlays(prev => [...prev.filter(x => x.id !== ov.id), { symbol: activeSymbolKey, ...ov }]), [activeSymbolKey]);
    const updateOverlay = useCallback((id, patch) => setOverlays(prev => prev.map(o => o.id === id ? { symbol: o.symbol, ...patch } : o)), []);
    const removeOverlay = useCallback((id) => setOverlays(prev => prev.filter(o => o.id !== id)), []);
    const clearAIOverlays = useCallback(() => setOverlays(prev => prev.filter(o => o.source !== 'ai-draft' && o.source !== 'ai-approved')), []);

    /*
       실제 주문·포지션을 차트 선으로 그린다.

       ★ 목업 오버레이를 지운 자리다. 사용자가 차트에서 자기 진입가와 미체결
         주문 가격을 봐야 하고, 그 값은 실제여야 한다.

       ★ 우선순위: 거래소 실주문(키 검증 필요) → 우리 DB 기록(모의 포함).
         `/order-history` 와 같은 규칙을 쓴다 — 화면마다 다르면 한쪽이 거짓이 된다.

       ★ 심볼을 반드시 달아둔다. ChartCanvas 가 오버레이 가격을 Y축 범위에
         포함시키므로, 다른 심볼의 선이 남으면 캔들이 납작해진다(위 주석 참고).

       ★ 사용자가 그린 도형(source: 'user-draw')과 AI 오버레이는 건드리지 않는다.
         주문·포지션 선만 교체한다.
    */
    useEffect(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) {
        return undefined;
      }
      /*
         ★ 로그인 완료 전에는 부르지 않는다.

           이 effect 가 마운트 시 한 번만 돌면 세션이 아직 확립되지 않아 401 을
           받는다(실제로 그랬다). 그러면 오버레이가 비어 있고, 사용자는 자기
           포지션 선이 차트에 없는 것을 본다.

           QTAuth 구독으로 로그인 상태가 확정된 뒤 다시 부른다.
      */
      let cancelled = false;

      const num = (v) => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      const load = () => {
        // 로그인하지 않았으면 요청하지 않는다 — 401 이 콘솔에 쌓인다.
        const auth = window.QTAuth;
        if (!auth || !auth.isLoggedIn || !auth.isLoggedIn()) return;

      Promise.all([
        api.localOpenOrders ? api.localOpenOrders({ limit: 50 }).catch(() => null) : Promise.resolve(null),
        api.localPositions ? api.localPositions().catch(() => null) : Promise.resolve(null),
      ]).then(([openOrders, positions]) => {
        if (cancelled) return;
        const next = [];

        ((openOrders && openOrders.items) || []).forEach((o) => {
          const px = num(o.price);
          // 시장가 주문은 가격이 없다. 선을 그릴 수 없으므로 건너뛴다.
          if (!px) return;
          next.push({
            id: `ord-${o.id}`,
            type: 'horizontal',
            source: 'order',
            symbol: String(o.symbol || '').toUpperCase(),
            points: [{ price: px, time: Date.now() }],
            label: `${t('chart_ov_order')} · ${o.side === 'long' ? t('side_long') : t('side_short')} ${o.quantity} @ ${px}`,
          });
        });

        ((positions && positions.items) || []).forEach((p) => {
          const px = num(p.entryPrice);
          // 진입가를 모르면 선을 그리지 않는다. 0 으로 그리면 Y축이 망가진다.
          if (!px) return;
          next.push({
            id: `pos-${p.id}`,
            type: 'horizontal',
            source: p.side === 'short' ? 'position-short' : 'position-long',
            symbol: String(p.symbol || '').toUpperCase(),
            points: [{ price: px, time: Date.now() }],
            label: `${t('chart_ov_entry')} · ${p.side === 'long' ? t('side_long') : t('side_short')} ${p.size}`,
          });
        });

        // 주문·포지션 선만 교체한다. 사용자 도형과 AI 오버레이는 유지.
        setOverlays((prev) => [
          ...prev.filter((o) => o.source !== 'order' && o.source !== 'position-long' && o.source !== 'position-short'),
          ...next,
        ]);
      });
      };

      load();
      // 로그인 상태가 바뀌면 다시 읽는다 (로그인 직후·로그아웃 후 재로그인).
      const off = (window.QTAuth && window.QTAuth.subscribe)
        ? window.QTAuth.subscribe(() => load())
        : null;

      return () => { cancelled = true; if (off) off(); };
    }, []);

    // 차트/위젯에 넘길 오버레이. 심볼이 지정되지 않은 것(구버전 저장분)은
    // 어느 심볼에서도 가격축을 망치지 않도록 현재 심볼에서만 보여준다.
    const visibleOverlays = useMemo(
      () => overlays.filter(o => !o.symbol || o.symbol === activeSymbolKey),
      [overlays, activeSymbolKey]
    );

    // AI signal state (Flow 5)
    const [currentSignal, setCurrentSignal] = useState(null);
    const [orderDraft, setOrderDraft] = useState(null);   // { price, size, side, tpsl }

    // Click on order book price → prefill Order Entry
    const handleClickPrice = useCallback((price) => {
      setOrderDraft(d => ({ ...(d || { size: 0.05, side: 'long' }), price }));
      pushToast({ title: t('toast_price_filled', { price: fmtPrice(price) }), desc: t('toast_price_filled_desc'), variant: 'info', duration: 2000 });
    }, []);

    const [orderPreview, setOrderPreview] = useState(null); // modal
    const [flowStep, setFlowStep] = useState('idle'); // idle | draft | user-review | approved | order-draft | preview | risk-check | confirm | submitted

    const proposeSignal = useCallback((sig) => {
      setCurrentSignal({ ...sig, status: 'draft' });
      setFlowStep('user-review');
    }, []);
    const approveSignal = useCallback(() => {
      setCurrentSignal(s => s ? { ...s, status: 'approved' } : s);
      // Also flip AI overlays to approved variant
      setOverlays(prev => prev.map(o => o.source === 'ai-draft' && o.id.startsWith('sig') ? { ...o, source: 'ai-approved', style: { ...(o.style||{}), dashed: false } } : o));
      setFlowStep('approved');
      pushToast({ title: t('toast_signal_approved'), desc: t('toast_signal_approved_desc'), variant: 'success' });
    }, [pushToast]);
    const rejectSignal = useCallback(() => {
      setCurrentSignal(null);
      clearAIOverlays();
      setFlowStep('idle');
      pushToast({ title: t('toast_signal_rejected'), desc: t('toast_signal_rejected_desc'), variant: 'warning' });
    }, [clearAIOverlays, pushToast]);
    const createOrderDraft = useCallback(() => {
      if (!currentSignal) return;
      setOrderDraft({
        /* 출처를 남긴다 — 주문 확인창의 AI 경고와 확신도는 이 값으로만 켠다. */
        source: 'ai',
        confidence: typeof currentSignal.confidence === 'number' ? currentSignal.confidence : null,
        side: currentSignal.direction,
        price: (currentSignal.entryZone[0] + currentSignal.entryZone[1]) / 2,
        size: 0.05,
        tpsl: {
          tp: currentSignal.takeProfits,
          sl: currentSignal.stopLoss,
        }
      });
      setFlowStep('order-draft');
      pushToast({ title: t('toast_draft_created'), desc: t('toast_draft_created_desc'), variant: 'ai' });
    }, [currentSignal, pushToast]);

    // ---- Order flow ----
    /**
     * 1단계 — 주문 검증.
     *
     * 서버가 수수료·청산가·필요증거금을 계산해 준다. 클라이언트 계산값을
     * 그대로 보여주면 서버와 어긋날 수 있고, 사용자는 화면 숫자를 믿고 주문한다.
     * 그래서 서버 값이 오면 그것으로 덮어쓴다.
     */
    const placeOrder = useCallback((data) => {
      if (data.hasErrors) {
        pushToast({ title: t('toast_order_invalid'), desc: t('toast_order_invalid_desc'), variant: 'error' });
        return;
      }

      /*
         AI 초안에서 온 주문인지 표시를 함께 넘긴다.

         ★ 전에는 확인창이 모든 주문에 "AI 분석이 만든 초안" 경고를 붙였다.
           손으로 낸 주문에도 붙어서, 경고가 사실이 아닌 채로 항상 떠 있었다.
      */
      const withOrigin = orderDraft && orderDraft.source === 'ai'
        ? Object.assign({}, data, { ai: { confidence: orderDraft.confidence } })
        : data;

      // 백엔드가 없으면 화면 흐름만 보여준다 (정적 프리뷰 계약).
      if (!window.QTApi || !window.QTApi.orders) {
        setOrderPreview(withOrigin);
        setFlowStep('preview');
        return;
      }

      setOrderPreview(withOrigin);
      setFlowStep('preview');

      window.QTApi.orders.createDraft({
        symbol: market.symbol || (market.base + market.quote),
        side: data.side,
        orderType: data.type,
        price: data.price,
        quantity: data.size,
        leverage: data.leverage || market.leverage || 10,
        reduceOnly: data.reduceOnly,
        postOnly: data.postOnly,
        tif: data.tif,
      })
        .then((res) => {
          // 서버 계산값으로 미리보기를 교체한다. 화면 숫자와 실제 체결 조건을 일치시킨다.
          setOrderPreview((prev) => (prev ? { ...prev, draft: res, serverPreview: res.preview } : prev));
        })
        .catch((err) => {
          setFlowStep('idle');
          setOrderPreview(null);
          pushToast({
            title: t('toast_order_rejected'),
            desc: (err && err.message) || t('toast_order_invalid_desc'),
            variant: 'error',
          });
        });
    }, [pushToast, market, orderDraft]);

    /**
     * 2단계 — 사용자가 확인을 누른 시점.
     *
     * 서버 확인 게이트가 두 겹이다(토큰 일치 + userConfirmed). 여기서만
     * userConfirmed 를 보낸다 — 자동으로 붙이면 게이트가 무의미해진다.
     */
    const confirmOrder = useCallback(async () => {
      const draft = orderPreview && orderPreview.draft;

      if (!window.QTApi || !window.QTApi.orders || !draft) {
        // 정적 프리뷰 또는 검증 응답 대기 중. 화면 흐름만 진행한다.
        setFlowStep('risk-check');
        await new Promise(r => setTimeout(r, 500));
        setFlowStep('confirm');
        await new Promise(r => setTimeout(r, 400));
        setFlowStep('submitted');
        pushToast({
          title: t('toast_order_accepted', { side: t(orderPreview.side === 'long' ? 'side_long' : 'side_short') }),
          desc: t('toast_order_accepted_desc', { size: fmt(orderPreview.size, 4), base: market.base, price: fmt(orderPreview.price, 1) }),
          variant: 'success'
        });
        setTimeout(() => { setOrderPreview(null); setFlowStep('idle'); }, 1000);
        return;
      }

      setFlowStep('risk-check');
      try {
        /*
           주문 경로는 거래 모드가 정한다.

             paper   → 시뮬레이션. 거래소로 나가지 않는다.
             futures → 실주문. 킬스위치·리스크 게이트를 모두 통과해야 나간다.

           경로를 화면 상태로 추측하지 않고 QTMode.getOrderPath() 한 곳에서만
           판단한다. 두 곳에서 판단하면 어긋나고, 그 어긋남이 "모의인데 실주문"
           이라는 사고가 된다.
        */
        const path = window.QTMode ? window.QTMode.getOrderPath() : 'sim';

        if (path === 'live' && window.QTApi.orders.submitLive) {
          const live = await window.QTApi.orders.submitLive({
            symbol: market.symbol || (market.base + market.quote),
            side: orderPreview.side,
            orderType: orderPreview.type,
            price: orderPreview.price,
            quantity: orderPreview.size,
            leverage: orderPreview.leverage || market.leverage || 10,
            reduceOnly: orderPreview.reduceOnly,
            // 서버 확인 게이트. 사용자가 확인을 누른 이 시점에만 보낸다.
            confirmationToken: draft.confirmationToken,
            idempotencyKey: draft.clientOrderId,
          });

          setFlowStep(live.ok ? 'submitted' : 'idle');

          if (live.ok) {
            pushToast({
              title: t('toast_order_accepted', { side: t(orderPreview.side === 'long' ? 'side_long' : 'side_short') }),
              desc: t('toast_order_live_desc', {
                size: fmt(orderPreview.size, 4), base: market.base, price: fmt(orderPreview.price, 1),
              }),
              variant: 'success',
            });
          } else if (live.outcome === 'SUBMIT_UNKNOWN') {
            /*
               가장 위험한 상태. 주문이 나갔는지 알 수 없다.
               "다시 시도" 를 권하면 중복 주문이 된다 — 조회로 확인하라고 알린다.
            */
            pushToast({
              title: t('toast_order_unknown'),
              desc: t('toast_order_unknown_desc'),
              variant: 'warning',
              duration: 12000,
            });
          } else {
            // 차단 사유를 그대로 보여준다. "실패" 만 알리면 무엇을 고쳐야 할지 모른다.
            pushToast({
              title: t('toast_order_blocked'),
              desc: (live.reasons || []).slice(0, 2).join(' · ') || t('toast_order_invalid_desc'),
              variant: 'error',
              duration: 9000,
            });
          }
          setTimeout(() => { setOrderPreview(null); setFlowStep('idle'); }, live.ok ? 1200 : 400);
          return;
        }

        // --- 모의 주문 (거래소로 나가지 않는다) ---
        const res = await window.QTApi.orders.confirm(draft);
        setFlowStep('confirm');
        const order = res && res.order;
        setFlowStep('submitted');
        pushToast({
          title: t('toast_order_accepted', { side: t(orderPreview.side === 'long' ? 'side_long' : 'side_short') }),
          // 서버가 알려준 실제 상태를 보여준다. '접수됨'과 '체결됨'은 다른 사실이다.
          // 모의 주문임을 문구에 넣는다. 실제로 체결된 줄 알면 안 된다.
          desc: t('toast_order_paper_desc', {
            status: (order && order.status) || 'ACCEPTED',
            size: fmt(Number((order && order.quantity) || orderPreview.size), 4),
            base: market.base,
            price: fmt(Number((order && order.price) || orderPreview.price), 1),
          }),
          variant: 'success',
        });
        setTimeout(() => { setOrderPreview(null); setFlowStep('idle'); }, 1200);
      } catch (err) {
        setFlowStep('idle');
        pushToast({
          title: t('toast_order_rejected'),
          desc: (err && err.message) || t('toast_order_invalid_desc'),
          variant: 'error',
        });
        setTimeout(() => setOrderPreview(null), 300);
      }
    }, [orderPreview, market, pushToast]);

    // ---- Enter Edit Mode ----
    useEffect(() => {
      const isEdit = route.query.mode === 'layout-edit';
      engine.setIsEditing(isEdit);
    }, [route.query.mode]);

    // Keyboard shortcuts
    useEffect(() => {
      const onKey = (e) => {
        if (e.target.matches('input, textarea')) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); engine.undo(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); engine.redo(); }
        else if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); engine.save(); pushToast({ title: t('layout_saved_title'), variant: 'success' }); }
        else if (e.key === 'Escape' && engine.isEditing) {
          if (engine.dirty && !confirm(t('confirm_unsaved_leave'))) return;
          pushRoute('/trade');
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [engine, pushRoute, pushToast]);

    // ---- Compute layout with drag preview ----
    // (Widget positions are updated on-the-fly during drag/resize via engine.updateWidget)

    const bodyRef = useRef(null);
    const isBeginner = !tweaks.pro;

    /*
       AI 코파일럿에 넘기는 차트 맥락.

       ★ 활성 지표는 **차트가 스스로 알려준 것**만 쓴다.

         코파일럿의 맥락 칩에 `Indicators · MA20 · MA60 · MA120` 이 박혀 있었다.
         사용자가 무엇을 켜 두었는지와 무관한 글자다. 사용자는 그 칩을 보고
         "AI 가 이 지표들을 보고 있다" 고 이해하므로, 사실과 다르면 대화의 전제가
         틀어진다.

       ★ 차트 인스턴스는 ChartWidget 안에만 있다(getChart 는 여기서 접근할 수
         없다). 그래서 차트가 지표를 바꿀 때 QTChartState 에 적어 두고, 여기서는
         그것을 읽는다. 읽지 못하면 null 이며, 화면은 칩을 그리지 않는다 —
         빈 값을 '없음' 으로 적으면 "하나도 켜지 않았다" 로 읽힌다.
    */
    const chartIndicators = window.QTChartState && window.QTChartState.useIndicators
      ? window.QTChartState.useIndicators()
      : null;
    const chartContext = useMemo(() => ({
      symbol: market.base + '/' + market.quote,
      tf: timeframe,
      price: lastPrice,
      candles,
      indicators: chartIndicators,
    }), [market, timeframe, lastPrice, candles, chartIndicators]);

    // ---- shellProps for new-page components ----
    const shellProps = {
      activePath: route.path,
      /*
         주소의 쿼리. 화면이 `?section=pricing` 처럼 주소로 전달된 의도를 읽을 수
         있어야 한다 — 공유된 링크가 약속한 자리를 보여주려면 필요하다.
      */
      query: route.query,
      // 서버 세션 등급. 비로그인이면 null 이다 — 'user' 로 가정하지 않는다.
      role: auth.role,
      // 등급을 아직 확인 중인지. 화면이 권한 판단을 미룰 수 있게 넘긴다.
      roleLoading: auth.loading,
      user: auth.user,
      /*
         화면 설정(테마·밀도·언어·숫자형식). 설정 페이지의 버튼들이 죽어 있었는데,
         기능은 이미 동작하고 있었고 값을 넘겨주지 않아 배선을 못 했던 것이다.
      */
      tweaks,
      setTweaks,
      onNavigate: (fullPath) => {
        // fullPath like "/markets" or "/trade?symbol=BTCUSDT"
        const [path, qs] = fullPath.split('?');
        const q = Object.fromEntries(new URLSearchParams(qs || ''));
        pushRoute(path, q);
      },
    };

    // ---- Route dispatch — return early for non-trade routes ----
    const isTradeRoute = route.path === '/trade' || !route.path;
    // Auth/Landing routes have no sim-stripe, no header, no sidebar (fully custom shell)
    /*
       자체 레이아웃을 쓰는 라우트 (헤더·사이드바·시뮬레이션 띠 없음).

       법적 문서를 여기 넣는 이유: 로그인 전에 열려야 하므로 로그인 상태를
       전제하는 PageShell 을 쓸 수 없다.
    */
    const isAuthRoute = [
      '/', '/login', '/signup', '/verify-email', '/kyc', '/password-reset',
      '/terms', '/privacy', '/risk', '/security', '/refund',
    ].includes(route.path);

    // All known routes — anything not in this list is 404
    const ALL_KNOWN_ROUTES = [
      '/', '/login', '/signup', '/verify-email', '/kyc', '/password-reset',
      // 법적 문서 — 로그인 없이 열린다.
      '/terms', '/privacy', '/risk', '/security', '/refund',
      '/trade',
      '/markets', '/ai-strategies', '/ai-strategies/detail', '/ai-strategies/my',
      '/portfolio', '/analytics',
      '/wallet', '/wallet/transactions',
      '/referral', '/points', '/fees', '/help', '/settings', '/notifications', '/order-history',
      '/admin', '/admin/users', '/admin/users/detail', '/admin/trades', '/admin/ai-ops',
      '/admin/design-ops', '/admin/risk', '/admin/assets', '/admin/kyc',
      '/admin/deposits', '/admin/withdrawals', '/admin/referral', '/admin/points', '/admin/legal', '/admin/fees', '/admin/notices',
      '/admin/notices/new', '/admin/system', '/admin/audit', '/admin/broadcast', '/admin/cs',
    ];

    // 구현 상태 표시(provenance.js)가 "상태 등록을 빠뜨린 라우트" 를 찾을 수 있게
    // 목록을 노출한다. 라우트를 추가하고 상태 등록을 잊으면 audit() 이 잡아낸다.
    window.QT_ALL_ROUTES = ALL_KNOWN_ROUTES;
    const isKnownRoute = ALL_KNOWN_ROUTES.includes(route.path);

    /*
       라우팅 가드 — 등급이 없으면 화면을 열지 않는다.

       예전에는 사이드바에서 메뉴만 숨겼다. 그건 숨김일 뿐이라 주소창에
       #/admin 을 직접 치면 일반 사용자도 관리자 화면이 열렸다.

       ★ 이건 1겹(화면)이다. 실제 차단은 서버가 401/403 으로 한다.
         화면을 막아도 그 화면이 부르던 API 는 그대로 열려 있기 때문이다.

       등급 확인 중에는 막지 않는다(roleLoading). 확인 전에 차단하면 새로고침할
       때마다 권한 있는 사용자에게 "권한 없음" 이 한 번 번쩍인다.
    */
    const access = (window.QTAccess && isKnownRoute && !auth.loading)
      ? window.QTAccess.canAccess(route.path, auth.role)
      : { allowed: true, reason: 'checking', required: 'user' };

    // 알 수 없는 라우트와 권한 없는 라우트를 같은 화면으로 처리한다.
    // 다만 사유는 구분해 보여준다 — "없는 페이지" 와 "권한 없음" 은 다른 사실이다.
    const isNotFound = !isKnownRoute || !access.allowed;
    const blockedMessage = !isKnownRoute
      ? undefined
      : access.reason === 'login_required' ? t('access_login_required')
      : access.reason === 'under_development' ? t('access_under_development')
      : access.reason === 'insufficient_tier' ? t('access_insufficient_tier', { required: t('tier_' + access.required) })
      : access.reason === 'unknown_tier' ? t('access_unknown_tier')
      : undefined;

    // ============================================================
    // RENDER
    // ============================================================
    // Auth/Landing/NotFound routes render fully-custom shells (no header/sidebar/sim-stripe)
    if (isAuthRoute || isNotFound) {
      return (
        <>
          {route.path === '/'               && <window.LandingPage        shellProps={shellProps}/>}
          {/* 법적 문서 — route 를 넘겨 어느 문서인지 판단한다. */}
          {['/terms','/privacy','/risk','/security','/refund'].includes(route.path) && <window.LegalPage route={route}/>}
          {route.path === '/login'          && <window.LoginPage          shellProps={shellProps}/>}
          {route.path === '/signup'         && <window.SignupPage         shellProps={shellProps}/>}
          {route.path === '/verify-email'   && <window.EmailVerifyPage    shellProps={shellProps}/>}
          {route.path === '/kyc'            && <window.KYCOnboardingPage  shellProps={shellProps}/>}
          {route.path === '/password-reset' && <window.PasswordResetPage  shellProps={shellProps}/>}
          {isNotFound && <window.NotFoundPage shellProps={shellProps} message={blockedMessage || t('notfound_path', { path: route.path })}/>}

          {/* Toasts still render even in auth mode */}
          <div className="toast-region">
            {toasts.map(t => (
              <div key={t.id} className={`toast toast--${t.variant || 'info'}`}>
                <div className="toast__title">{t.title}</div>
                {t.desc && <div className="toast__desc">{t.desc}</div>}
              </div>
            ))}
          </div>
        </>
      );
    }

    return (
      <div className={`app-shell app-shell--v2 ${isTradeRoute && !navPrefs.collapsed ? 'has-expanded-nav' : ''}`}>
        <window.DisclaimerGate/>
        {/*
           최상단 상태 띠.

           ★★ 원래 "SIMULATION · Mock data · No real funds at risk · Prototype demo ·
             Session SIM-2026-08-KURI · Data seed deterministic" 가 **하드코딩**돼
             있었다. 네 가지가 사실과 다르다:
               · 시세는 거래소 실시간이다 — "Mock data" 가 아니다
               · 실서비스에서 "Prototype demo" 는 거짓이고, 사용자가 신뢰하지 않는다
               · 세션 ID 가 가짜다
               · 실시세는 결정적이지 않다 — "Data seed deterministic" 은 거짓
             ★ 무엇보다 **실주문을 열면 "No real funds at risk" 가 위험한 거짓**이
               된다. 실제 돈이 걸린 화면에 위험이 없다고 적혀 있으면, 그 표시를
               믿은 사용자가 손실을 본다.

           ★ 띠를 지우지 않는다(디자이너 UI 계약). 문구만 실제 상태로 만든다.
        */}
        {(() => {
          /*
             ★★ 실제 주문 경로는 **서버**가 정한다. `QTMode` 는 사용자가 화면에서
               고른 모드일 뿐이고 기본값이 `futures`(orderPath='live') 이므로,
               그것으로 판단하면 서버가 MOCK 인데도 "실거래" 라고 띄운다.
               반대 방향(실주문인데 모의라고 표시)이 훨씬 위험하지만, 둘 다 거짓이다.
               서버 설정(`liveOrdersEnabled` + `tradingMode`)을 쓴다.
          */
          const cfg = serverCfg;
          const realService = window.QTMockPolicy ? window.QTMockPolicy.isRealService() : false;
          const dataSrc = window.QTLive && window.QTLive.getSource ? window.QTLive.getSource() : 'mock';

          // 서버 설정을 아직 못 받았으면 단정하지 않는다 — 판정 중에 잘못 말하면
          // 사용자가 그 문구를 기억한다.
          const liveOrders = cfg ? Boolean(cfg.liveOrdersEnabled) && /LIVE/i.test(String(cfg.tradingMode || '')) : null;

          let badge, note, isLive = false;
          if (!realService) {
            badge = t('stripe_preview'); note = t('stripe_preview_note');
          } else if (liveOrders === null) {
            badge = t('stripe_checking'); note = t('stripe_checking_note');
          } else if (liveOrders) {
            badge = t('stripe_live'); note = t('stripe_live_note'); isLive = true;
          } else {
            badge = t('stripe_sim'); note = t('stripe_sim_note');
          }

          return (
            <div className={`sim-stripe ${isLive ? 'sim-stripe--live' : ''}`} style={{gridColumn:'1 / -1', ...(isLive ? {background:'var(--color-trade-short-bg)'} : {})}}>
              <div className="sim-stripe__left">
                <span className="sim-stripe__badge" style={isLive ? {background:'var(--color-trade-short)', color:'#fff'} : undefined}>{badge}</span>
                <span>{note}</span>
              </div>
              <div className="sim-stripe__right">
                <span>{t('stripe_data', { src: t(dataSrc === 'live' ? 'stripe_data_live' : 'stripe_data_mock') })}</span>
              </div>
            </div>
          );
        })()}

        {/* HEADER */}
        <header className="app-header" style={{gridColumn:'1 / -1'}}>
          {/*
            사이드바 서랍 열기 (좁은 화면 전용).

            휴대폰에서 사이드바가 56px 을 상시 점유하면 본문이 너무 좁아진다.
            CSS 로 서랍으로 바꾸고, 이 버튼이 html[data-qt-drawer] 를 토글한다.
            데스크톱에서는 CSS 가 이 버튼을 숨긴다 — 마크업은 하나만 유지한다.
          */}
          <button
            className="qt-drawer-toggle"
            type="button"
            aria-label={t('nav_open_menu')}
            title={t('nav_open_menu')}
            onClick={() => {
              const el = document.documentElement;
              el.setAttribute('data-qt-drawer', el.getAttribute('data-qt-drawer') === 'open' ? 'closed' : 'open');
            }}
          >
            {/* 햄버거 모양. icons.jsx 에 Menu 가 없어 CSS 로 만든다 —
                아이콘 파일(디자이너 산출물)을 수정하지 않기 위한 선택이다. */}
            <span className="qt-drawer-toggle__bars" aria-hidden="true"/>
          </button>
          <a className="app-brand" href="#/trade">
            <img className="app-brand__logo" src="/src/ccai-logo.png" alt={window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'}/>
            <span className="app-brand__name">{window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI'}</span>
            
          </a>

          <div className="seg" style={{marginRight: 8}}>
            {/*
              거래 모드. 마크업·클래스는 그대로 두고 동작만 붙였다.
              지원하지 않는 모드(현물)는 버튼을 지우지 않고, 눌렀을 때 이유를 알린다 —
              눌러도 아무 일 없으면 사용자는 고장이라고 생각한다.
            */}
            {['spot','futures','paper'].map(m => {
              const avail = window.QTMode ? window.QTMode.isAvailable(m) : m === 'futures';
              return (
                <button
                  key={m}
                  className={`seg__opt ${tradeMode === m ? 'is-active' : ''} ${!avail ? 'seg__opt--pending' : ''}`}
                  onClick={() => {
                    if (!window.QTMode) return;
                    const r = window.QTMode.setMode(m);
                    if (!r.ok) {
                      pushToast({ title: t('mode_' + m), desc: t(r.reasonKey), variant: 'info' });
                    }
                  }}
                  title={avail ? t('mode_switch_to', { mode: t('mode_' + m) }) : t(window.QTMode ? window.QTMode.reasonKeyFor(m) : 'feature_pending')}
                  aria-pressed={tradeMode === m}
                  aria-disabled={!avail}
                >
                  {t('mode_' + m)}
                  {/*
                     ★ 미지원 모드임을 눌러보기 전에 알 수 있게 한다.

                       원래는 눌러야 토스트로 알았다. 현물은 어댑터가 없어 한동안
                       안 되는데, 모르면 "왜 안 되지" 하고 반복해서 누른다.

                     ★ 버튼을 지우지 않는다(디자이너 UI 계약). 표시만 덧붙이고,
                       준비되면 MODES 의 available 을 true 로 바꾸는 것만으로
                       이 표시가 사라진다.
                  */}
                  {!avail && (
                    <span className="seg__opt-pending" aria-hidden="true">{t('mode_pending_mark')}</span>
                  )}
                </button>
              );
            })}
          </div>

          <nav className="app-nav">
            <a className="app-nav__item" href="#/markets"><I.Grid size={13}/>{t('nav_markets')}</a>
            <a className={`app-nav__item ${route.path === '/trade' ? 'is-active' : ''}`} href="#/trade"><I.Chart size={13}/>{t('nav_trade')}</a>
            {/*
               ★★ AI 탭을 숨긴다 (지시받음).

                 코파일럿은 이제 거래 화면 기본 배치(standard-trader)에 접힌 채로
                 들어 있다. 그래서 이 탭이 없어도 코파일럿에 닿을 수 있다.

               ★ 태그를 지우지 않고 주석으로 둔다 — 되살릴 때 위치와 프리셋
                 연결(presetId: 'ai-workspace')을 다시 찾지 않아도 되게 한다.
                 `ai-workspace` 프리셋 자체는 남아 있어 레이아웃 편집에서 고를 수 있다.

              <a className="app-nav__item" href="#/trade?workspace=ai" onClick={() => setTweaks({ presetId: 'ai-workspace' })}><I.Sparkles size={13}/>{t('nav_ai')}</a>
            */}
            <a className="app-nav__item" href="#/portfolio"><I.Wallet size={13}/>{t('nav_portfolio')}</a>
            <a className="app-nav__item" href="#/analytics"><I.Book size={13}/>{t('nav_analytics')}</a>
          </nav>

          <div className="app-header__right">
            {/*
              등급 스위치 — 디자이너가 화면을 미리 보는 도구다. 버튼은 그대로 둔다.
              백엔드가 붙으면 서버 등급이 우선하므로 이 스위치는 효력이 없다.
              그 사실을 title 로 알려준다 (눌러도 아무 일 없으면 버그로 보인다).
            */}
            {/*
              등급 스위치는 개발·디자인 미리보기 도구다.

              백엔드가 붙으면 서버 등급이 우선하므로 효력이 없는데, 일반
              사용자에게 비활성 버튼 4개가 보이면 "권한을 바꿀 수 있나" 하고
              오해한다. 승인된 방침(개발용은 super·admin 만)에 맞춰 감춘다.
              백엔드가 없는 디자인 미리보기에서는 그대로 보인다 — 그때는
              실제로 화면을 바꾸는 도구이기 때문이다.
            */}
            {/*
              ★ 실서비스에서는 아예 렌더하지 않는다.

              백엔드가 붙으면 서버 등급이 우선하므로 이 스위치는 **효력이 없다**
              (disabled 상태로 남는다). 그런데 폭을 180px 차지해서, 1440px
              노트북에서 오른쪽 끝의 프로필·알림 버튼을 화면 밖으로 밀어냈다
              (실측: 1621px 내용 / 1440px 화면).

              아무 일도 하지 않는 컨트롤이 실제로 쓰는 버튼을 가리는 것은
              분명한 손해다. 스위치가 실제로 동작하는 경우(=백엔드 없는
              디자인 미리보기)에만 보여준다.
            */}
            {!auth.switchActive ? null : (
            <div
              className="role-switcher"
              title={auth.switchActive
                ? t('role_switch_preview')
                : t('role_switch_disabled', { role: auth.role || t('role_none') })}
            >
              {['user','ops','admin','super'].map(r => (
                <button
                  key={r}
                  className={`role-switcher__opt ${(auth.switchActive ? tweaks.role : auth.role) === r ? 'is-active' : ''}`}
                  onClick={() => setTweaks({ role: r })}
                  disabled={!auth.switchActive}
                >
                  {r === 'super' ? 'SUPER' : r.toUpperCase()}
                </button>
              ))}
            </div>
            )}
            {/*
              연결 표시(WS/지연/데이터 신선도)는 사용자 요청으로 상단바에서 제거했다.
              conn/latency/dataAge 상태 자체는 오래된 데이터 가드 등에서 계속 쓰이므로
              계산은 유지하고, 눈에 보이는 클러스터만 뺀다.
            */}
            {/*
              알림 벨. 마크업·스타일은 그대로 두고 동작만 붙였다.

              빨간 점을 항상 켜두면 의미가 없다 — 실제 위험이 있을 때만 켠다.
              위험이 없으면 점을 숨겨서, 점이 보일 때 사용자가 반응하게 만든다.
            */}
            <button
              className="header-tool header-tool--icon"
              title={riskAlerts.length
                ? t('risk_bell_active', { count: riskAlerts.length })
                : t('risk_bell_idle')}
              onClick={() => {
                if (riskAlerts.length === 0) {
                  pushToast({ title: t('risk_bell_idle'), variant: 'info', duration: 3000 });
                  return;
                }
                // 가장 위험한 포지션의 심볼로 차트를 옮긴다. 사용자가 바로 조치할 수 있게.
                const worst = riskAlerts[0];
                riskAlerts.forEach((a) => { if (a.level === 'danger') { /* danger 우선 */ } });
                const target = riskAlerts.find((a) => a.level === 'danger') || worst;
                pushToast({
                  title: t('risk_liq_' + target.level, { symbol: target.symbol }),
                  desc: t('risk_liq_desc', { distance: target.distancePct.toFixed(1), liq: fmt(target.liq, 1) }),
                  variant: target.level === 'danger' ? 'error' : 'warning',
                  duration: 12000,
                });
                pushRoute('/trade', { symbol: target.symbol });
              }}
            >
              <I.Bell size={14}/>
              {riskAlerts.length > 0 && (
                <span style={{position:'absolute', top:4, right:4, width:6, height:6, borderRadius:999, background: riskAlerts.some(a=>a.level==='danger') ? 'var(--color-danger)' : 'var(--color-warning)'}}/>
              )}
            </button>
            <button className="header-tool header-tool--icon" onClick={() => setTweaks({ theme: tweaks.theme === 'dark' ? 'light' : 'dark' })} title={t('toggle_theme')}>
              {tweaks.theme === 'dark' ? <I.Moon size={14}/> : <I.Sun size={14}/>}
            </button>
            {/*
               Trade Ex — 자동맞춤(auto-fit) 실험 토글. 켜면 패널 내용이 크기에 맞춰
               촘촘해지고(컨테이너 쿼리), Order Entry 제출 버튼이 하단에 고정되며,
               좁은 표는 부차 열을 접는다. 기본은 꺼짐(현재 UI 그대로) — 켠 채로 두면 적용.
            */}
            <button
              className={`header-tool header-tool--icon ${tweaks.autofit ? 'is-active' : ''}`}
              onClick={() => setTweaks({ autofit: !tweaks.autofit })}
              title={t('autofit_toggle')}
              aria-pressed={!!tweaks.autofit}
            >
              <I.Expand size={14}/>
            </button>
            {/*
               언어 선택.

               ★★ 전에는 누를 때마다 **한 칸씩 순환**했다. 언어가 3개라 원하는
                 언어까지 최대 2번 눌러야 하고, 지나치면 한 바퀴를 더 돌았다.
                 목록을 펼쳐 바로 고른다.

               ★ 목록은 i18n 레지스트리(`available()`)가 단일 출처다.
                 `src/locales/<code>.js` 를 추가하고 index.html 에 한 줄 넣으면
                 여기에 자동으로 나타난다 — 이 파일을 고칠 필요가 없다.
            */}
            <div className="qt-langwrap">
              <button
                className="header-tool"
                title={t('lang_switch_title')}
                aria-haspopup="listbox"
                aria-expanded={langOpen}
                onClick={() => setLangOpen((v) => !v)}
              >
                <I.Globe size={13}/>
                <span style={{fontFamily:'var(--font-mono)', fontSize: 11}}>{tweaks.lang.toUpperCase()}</span>
              </button>
              {langOpen && (
                <div className="qt-langmenu" role="listbox" aria-label={t('lang_switch_title')}>
                  {(window.QTI18n && window.QTI18n.available
                    ? window.QTI18n.available()
                    // i18n 이 아직 없을 때의 최소 폴백. 없는 언어를 넣지 않는다.
                    : [{ code: 'en', label: 'English' }]
                  ).map((x) => {
                    const code = typeof x === 'string' ? x : x.code;
                    // 사전이 자기 이름을 자기 언어로 준다(label). 없으면 코드로.
                    const label = (typeof x === 'object' && x.label) || code.toUpperCase();
                    return (
                      <button
                        key={code}
                        type="button"
                        className="qt-langmenu__opt"
                        role="option"
                        aria-checked={tweaks.lang === code}
                        aria-selected={tweaks.lang === code}
                        onClick={() => { setTweaks({ lang: code }); setLangOpen(false); }}
                      >
                        <span>{label}</span>
                        <span className="qt-langmenu__code">{code.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {/*
              디자인 시스템·핸드오프·라이브러리 — 개발/디자인 문서다.

              ★ 실서비스 화면에서는 관리자에게도 보이지 않는다.

                전에는 super·admin 에게 보여줬다. 그런데 이 문서들은 컴포넌트
                명세와 "무엇이 아직 안 됐는지" 를 그대로 담고 있어 운영자가
                볼 이유가 없고, 헤더 폭을 3개 항목만큼 차지해 실제로 쓰는
                버튼(알림·테마·입금)을 좁은 화면에서 밀어냈다.

                파일(design-system.html 등)은 지우지 않는다 — 디자이너 산출물이고
                주소로 직접 열 수 있다. 여기서는 링크만 내린다.

              ★ `auth.offline` 은 백엔드가 없는 디자인 미리보기다. 그 환경에서는
                이 링크가 본래 용도로 쓰이므로 남긴다.
            */}
            {auth.offline && (
              <>
                <a className="header-tool" href="design-system.html" target="_blank" rel="noopener noreferrer" title="Design System" /* qt-i18n-ignore: 개발자 전용 링크 — auth.offline 에서만 보인다 */>
                  <I.Book size={13}/><span /* qt-i18n-ignore: 개발자 전용 링크 (auth.offline 에서만 보인다) */>Design</span>
                </a>
                <a className="header-tool" href="developer-handoff.html" target="_blank" rel="noopener noreferrer" title="Developer Handoff" /* qt-i18n-ignore: 개발자 전용 링크 — auth.offline 에서만 보인다 */>
                  <I.LayoutIcon size={13}/><span /* qt-i18n-ignore: 개발자 전용 링크 (auth.offline 에서만 보인다) */>Handoff</span>
                </a>
                <a className="header-tool" href="design-library/index.html" target="_blank" rel="noopener noreferrer" title="Design Library" /* qt-i18n-ignore: 개발자 전용 링크 — auth.offline 에서만 보인다 */>
                  <I.Layers size={13}/><span /* qt-i18n-ignore: 개발자 전용 링크 (auth.offline 에서만 보인다) */>Library</span>
                </a>
              </>
            )}
            <button className="header-tool" onClick={() => pushRoute('/trade', { mode: 'layout-edit' })}>
              <I.LayoutIcon size={13}/> {t('layout_manager')}
            </button>
            {/*
              입금 버튼.

              우리는 자금을 보관하지 않는다(비수탁). 고객은 자기 거래소 계정에
              입금하고, 우리는 그 계정을 API 로 조작한다. 그래서 이 버튼은
              "우리에게 돈을 보내는" 버튼이 아니라 거래소 입금으로 안내하는 버튼이다.

              키를 연결하지 않았으면 먼저 연결 화면으로 보낸다 — 입금해도 우리가
              그 자금을 볼 수 없기 때문이다.
            */}
            {/*
               ★★ 헤더의 '입금' 버튼도 주석으로 내렸다 (요청: 우리 페이지에서 입출금을 하지 않는다).

                 이 버튼은 이미 정직하게 동작했다 — 입금은 거래소에서 한다고 알리고
                 /wallet 으로 보냈다. 그래도 헤더에 '입금' 이 있으면 우리가 입금을
                 받는 것처럼 읽힌다. 기대를 만들지 않는 편이 낫다.

               ★ 되살릴 때는 이 주석만 풀면 된다(문구 키 deposit·deposit_hint·
                 deposit_needs_key·deposit_at_exchange 는 사전에 그대로 있다).

            <button
              className="btn btn--sm btn--primary"
              title={t('deposit_hint')}
              onClick={() => {
                const linked = window.QTAccount && window.QTAccount.isLive();
                if (!linked) {
                  pushToast({ title: t('deposit'), desc: t('deposit_needs_key'), variant: 'info', duration: 7000 });
                  pushRoute('/wallet');
                  return;
                }
                pushToast({ title: t('deposit'), desc: t('deposit_at_exchange'), variant: 'info', duration: 7000 });
                pushRoute('/wallet');
              }}
            >
              <I.Plus size={12}/> {t('deposit')}
            </button>
            */}
            {/*
              프로필 버튼 — 즉시 로그아웃 대신 아래로 열리는 드롭다운(개인설정·포인트·로그아웃).
            */}
            <window.ProfileMenu auth={auth} pushRoute={pushRoute}/>
          </div>
        </header>

        {/*
          사이드바 — 일반 페이지와 **같은** 컴포넌트를 쓴다.

          이전에는 거래 화면만 별도 아이콘 레일(.app-sidebar)을 썼다.
          그래서 두 가지가 어긋났다:
            · 접기 상태가 공유되지 않았다 — 한쪽에서 접어도 다른 쪽은 펼쳐짐
            · 메뉴 구성이 달랐다 — 거래 화면 레일에는 5개, 일반 화면엔 30개
          사용자가 "포트폴리오 누르면 메뉴가 쭉 나온다" 고 한 것이 이 차이다.

          거래 화면 고유 도구(레이아웃 편집·Tweaks·디자인 문서)는 삭제하지 않고
          extraTools 로 넘긴다 — 사이드바 안 '도구' 구역에 그대로 남는다.
        */}
        {isTradeRoute && (
          <window.AppSidebar
            activePath={route.path}
            role={auth.role || 'user'}
            collapsed={navPrefs.collapsed}
            onToggleCollapsed={navPrefs.toggleCollapsed}
            onNavigate={(r, e) => { if (e) e.preventDefault(); pushRoute(r); }}
            extraTools={
              <>
                <button className="sb-item-v2" onClick={() => pushRoute('/trade', { mode: 'layout-edit' })} title={t('layout_edit')}>
                  <span className="sb-item-v2__icon"><I.LayoutIcon size={15}/></span>
                  {!navPrefs.collapsed && <span className="sb-item-v2__label">{t('layout_edit')}</span>}
                </button>
                <button className="sb-item-v2" onClick={() => setTweaksOpen(v => !v)} title={t('tweaks')}>
                  <span className="sb-item-v2__icon"><I.Cog size={15}/></span>
                  {!navPrefs.collapsed && <span className="sb-item-v2__label">{t('tweaks')}</span>}
                </button>
                {/* 디자인 문서는 개발·디자인용 — 백엔드 없는 미리보기에서만 보인다
                    (헤더 쪽과 같은 판단. 실서비스에서는 관리자에게도 내린다). */}
                {auth.offline && (
                  <>
                    <a className="sb-item-v2" href="design-system.html" target="_blank" rel="noopener noreferrer" title="Design System" /* qt-i18n-ignore: 개발자 전용 링크 — auth.offline 에서만 보인다 */>
                      <span className="sb-item-v2__icon"><I.Book size={15}/></span>
                      {!navPrefs.collapsed && <span className="sb-item-v2__label" /* qt-i18n-ignore: 개발자 전용 사이드바 링크 */>Design System</span>}
                    </a>
                    <a className="sb-item-v2" href="developer-handoff.html" target="_blank" rel="noopener noreferrer" title="Developer Handoff" /* qt-i18n-ignore: 개발자 전용 링크 — auth.offline 에서만 보인다 */>
                      <span className="sb-item-v2__icon"><I.LayoutIcon size={15}/></span>
                      {!navPrefs.collapsed && <span className="sb-item-v2__label" /* qt-i18n-ignore: 개발자 전용 사이드바 링크 */>Developer Handoff</span>}
                    </a>
                  </>
                )}
              </>
            }
          />
        )}

        {/*
           공지 팝업.

           ★★ 라우트 분기 **밖**에 둔다 — 어느 화면에 있어도 떠야 한다.
             거래 화면에만 두면 다른 화면을 보는 이용자는 점검 공지를 못 본다.

           ★ 컴포넌트 스스로 판단한다: 로그인 여부, 주문 패널이 열렸는지(그때는
             보류), 이미 읽었는지(서버 기록). 여기서 조건을 또 쓰면 두 곳이
             어긋난다.
        */}
        {window.NoticePopup ? <window.NoticePopup/> : null}

        {/* ============================================================
             ROUTE DISPATCH — non-trade pages
             Each page renders its own PageShell (sidebar + main).
             ============================================================ */}
        {!isTradeRoute && (
          <div style={{gridColumn: '1 / -1', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0}}>
            <div style={{flex: 1, minHeight: 0, overflow: 'auto'}}>
            {/* USER PAGES */}
            {route.path === '/markets'        && <window.MarketsPage        shellProps={shellProps}/>}
            {route.path === '/ai-strategies'  && <window.AIStrategiesPage   shellProps={shellProps}/>}
            {route.path === '/ai-strategies/detail' && <window.StrategyDetailPage shellProps={shellProps} strategyId={route.query.id}/>}
            {route.path === '/ai-strategies/my' && <window.MyStrategiesPage shellProps={shellProps}/>}
            {route.path === '/portfolio'      && <window.PortfolioPage      shellProps={shellProps}/>}
            {route.path === '/analytics'      && <window.AnalyticsPage      shellProps={shellProps}/>}
            {route.path === '/wallet'         && <window.WalletPage         shellProps={shellProps}/>}
            {/*
               ★★ 입금·출금 화면을 주석으로 내렸다 (요청: 우리 페이지에서 입출금을 하지 않는다).

                 비수탁이므로 우리에게는 입금 주소도 출금 권한도 없다. 이 화면들은
                 "거래소에서 하세요" 안내만 하던 자리였다. 지갑 화면의 탭도 함께 내렸으므로
                 여기로 오는 링크는 앱 안에 없다.

               ★ 컴포넌트(pages-more.jsx 의 DepositPage · WithdrawPage)는 지우지 않았다.
                 되살릴 때 이 두 줄과 지갑 탭 주석을 풀면 된다.
            */}
            {/* {route.path === '/wallet/deposit' && <window.DepositPage        shellProps={shellProps}/>} */}
            {/* {route.path === '/wallet/withdraw'&& <window.WithdrawPage       shellProps={shellProps}/>} */}
            {route.path === '/wallet/transactions' && <window.TransactionHistoryPage shellProps={shellProps}/>}
            {route.path === '/referral'       && <window.ReferralPage       shellProps={shellProps}/>}
            {route.path === '/points'         && <window.PointsPage         shellProps={shellProps}/>}
            {route.path === '/fees'           && auth.role !== 'user' && <window.FeeRebatePage      shellProps={shellProps}/>}
            {route.path === '/help'           && <window.HelpCenterPage     shellProps={shellProps}/>}
            {route.path === '/settings'       && <window.SettingsPage       shellProps={shellProps}/>}
            {route.path === '/notifications'  && <window.NotificationsPage  shellProps={shellProps}/>}
            {route.path === '/order-history'  && <window.OrderHistoryPage   shellProps={shellProps}/>}

            {/* ADMIN routes */}
            {route.path === '/admin'              && <window.AdminDashboardPage  shellProps={shellProps}/>}
            {route.path === '/admin/users'        && <window.AdminUsersPage      shellProps={shellProps}/>}
            {route.path === '/admin/users/detail' && <window.AdminUserDetailPage shellProps={shellProps} userId={route.query.id}/>}
            {route.path === '/admin/trades'       && <window.AdminTradesPage     shellProps={shellProps}/>}
            {route.path === '/admin/ai-ops'       && <window.AdminAIOpsPage      shellProps={shellProps}/>}
            {route.path === '/admin/design-ops'   && <window.AdminDesignOpsPage  shellProps={shellProps}/>}
            {route.path === '/admin/risk'         && <window.AdminRiskPage       shellProps={shellProps}/>}
            {route.path === '/admin/assets'       && <window.AdminAssetsHiFiPage shellProps={shellProps}/>}
            {route.path === '/admin/kyc'          && <window.AdminKYCQueuePage   shellProps={shellProps}/>}
            {route.path === '/admin/deposits'     && <window.AdminDepositsPage   shellProps={shellProps}/>}
            {route.path === '/admin/withdrawals'  && <window.AdminWithdrawalsPage shellProps={shellProps}/>}
            {route.path === '/admin/fees'         && <window.AdminFeesPage       shellProps={shellProps}/>}
            {route.path === '/admin/notices'      && <window.AdminNoticesPage    shellProps={shellProps}/>}
            {route.path === '/admin/notices/new'  && <window.AdminNoticeEditorPage shellProps={shellProps}/>}
            {route.path === '/admin/system'       && <window.AdminSystemPage     shellProps={shellProps}/>}
            {route.path === '/admin/audit'        && <window.AdminAuditPage      shellProps={shellProps}/>}
            {route.path === '/admin/broadcast'    && <window.AdminBroadcastPage  shellProps={shellProps}/>}
            {route.path === '/admin/referral'     && <window.AdminReferralPage   shellProps={shellProps}/>}
            {route.path === '/admin/points'       && <window.AdminPointsPage    shellProps={shellProps}/>}
            {route.path === '/admin/legal'        && <window.AdminLegalPage     shellProps={shellProps}/>}
            {route.path === '/admin/cs'           && <window.AdminCSTicketPage   shellProps={shellProps} ticketId={route.query.id}/>}

            {/* NotFound is handled in the isAuthRoute block above */}
            </div>
            <window.AppFooter/>
          </div>
        )}

        {/* MAIN — trade route only */}
        {isTradeRoute && (
        <main className="app-main">
          {/* Layout edit toolbar + preset ribbon */}
          {engine.isEditing && (
            <>
              <window.LayoutEditToolbar
                engine={engine}
                onExit={() => {
                  if (engine.dirty && !confirm(t('confirm_unsaved_leave'))) return;
                  pushRoute('/trade');
                }}
                onSaveAs={() => {
                  const name = prompt(t('prompt_layout_name'), t('prompt_layout_default'));
                  if (name) {
                    engine.save();
                    pushToast({ title: t('toast_layout_saved', { name }), desc: t('toast_layout_saved_desc'), variant: 'success' });
                  }
                }}
                t={t}
              />
              <window.PresetRibbon engine={engine}/>
            </>
          )}

          {/* Symbol Header */}
          <window.SymbolHeader price={lastPrice} prev={prevPrice} market={market} t={t}/>

          {/* Body Grid */}
          <div
            ref={bodyRef}
            className={`trade-body ${engine.isEditing ? 'is-editing' : ''}`}
            style={{ gridTemplateRows: `repeat(auto-fill, ${40}px)` }}
          >
            {/*
               ★★ 접힌 패널의 공간을 이웃에게 넘겨 그린다.

                 저장된 레이아웃은 건드리지 않는다 — 접기는 표시 상태이고
                 배치가 아니다. 저장본을 고치면 접었다 펴는 동작이 이용자가
                 손으로 맞춘 배치를 영구히 망친다.
            */}
            {(window.QTPanelState ? window.QTPanelState.applyTo(engine.layout.widgets) : engine.layout.widgets).map(w => (
              <window.WidgetHost
                key={w.id}
                widget={w}
                trackRef={bodyRef}
                cols={engine.layout.cols}
                rowH={40}
                gap={6}
                isEditing={engine.isEditing}
                isLocked={engine.isLocked}
                isSelected={engine.selectedId === w.id}
                onSelect={engine.setSelectedId}
                onHide={engine.hideWidget}
                onDuplicate={engine.duplicateWidget}
                onLock={engine.toggleLock}
                onSettings={() => pushToast({ title: t('pending_title_named', { label: t('widget_settings') }), desc: t('pending_generic'), variant: 'info' })}
                onMaximize={() => pushToast({ title: t('pending_title_named', { label: t('widget_maximize') }), desc: t('pending_generic'), variant: 'info' })}
                label={widgetLabel(w.type, t)}
                allWidgets={engine.layout.widgets}
                /*
                   ★ 마지막으로 만진 창을 맨 위로. 드래그를 놓은 뒤에도 위에 남는다.
                     쌓임 순서는 보는 방식이라 배치(layout)에 저장하지 않는다.
                */
                raisedOrder={(engine.raised && engine.raised[w.id]) || 0}
                onRaise={engine.raiseWidget}
                /* 닫기 안내의 '되살리기' 가 이것을 부른다. */
                onOpenLibrary={() => engine.setLibraryOpen(true)}
                onChange={(patch) => engine.updateWidget(w.id, patch)}
              >
                <WidgetContent
                  widget={w}
                  market={market}
                  lastPrice={lastPrice}
                  prevPrice={prevPrice}
                  candles={candles}
                  timeframe={timeframe}
                  setTimeframe={setTimeframe}
                  orderBook={orderBook}
                  trades={trades}
                  overlays={visibleOverlays}
                  /*
                     ★ 격자의 보조 칸이 **자기 종목**의 오버레이를 골라 쓴다.
                       활성 종목으로 이미 걸러진 visibleOverlays 를 넘기면
                       ETH 차트에 BTC 진입가 선이 그려진다.
                  */
                  allOverlays={overlays}
                  addOverlay={addOverlay}
                  updateOverlay={updateOverlay}
                  removeOverlay={removeOverlay}
                  onSelectMarket={setMarket}
                  onPlaceOrder={placeOrder}
                  onClickPrice={handleClickPrice}
                  pushToast={pushToast}
                  chartContext={chartContext}
                  currentSignal={currentSignal}
                  proposeSignal={proposeSignal}
                  approveSignal={approveSignal}
                  createOrderDraft={createOrderDraft}
                  rejectSignal={rejectSignal}
                  orderDraft={orderDraft}
                  isBeginner={isBeginner}
                  onChange={(patch) => engine.updateWidget(w.id, patch)}
                  t={t}
                />
              </window.WidgetHost>
            ))}
          </div>
        </main>
        )}

        {/*
           숨긴 위젯 라이브러리.

           ★★ 전에는 `isEditing && libraryOpen` 이었다. 창을 닫은 뒤 되살리려면
             (1) Layout 을 눌러 편집 모드에 들어가고 (2) 라이브러리를 또 열어야
             했다. 두 단계를 모르면 닫은 창을 영원히 못 찾는다.

           ★ libraryOpen 만으로도 열리게 한다. 라이브러리 안에서 '＋ ADD' 를
             누르면 위젯이 돌아오므로 편집 모드일 필요가 없다.
        */}
        {engine.libraryOpen && (
          <window.WidgetLibrary engine={engine} onClose={() => engine.setLibraryOpen(false)}/>
        )}

        {/* Toasts */}
        <div className="toast-region">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast--${t.variant || 'info'}`}>
              <div className="toast__title">{t.title}</div>
              {t.desc && <div className="toast__desc">{t.desc}</div>}
              {/*
                 ★★ 안내에 행동 버튼을 붙일 수 있게 한다.

                   전에는 title·desc 만 그렸다. 그래서 `action` 을 넘겨도 조용히
                   무시됐다 — 부르는 쪽은 버튼이 나온다고 믿는데 화면엔 없다.
                   "창을 닫았습니다 → 되살리기" 처럼 다음 행동이 분명한 안내에
                   필요하다.
              */}
              {t.action && t.action.label && (
                <button
                  className="toast__action"
                  onClick={() => {
                    try { t.action.onClick && t.action.onClick(); } catch (e) { /* 안내가 화면을 죽이지 않는다 */ }
                    dismissToast(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Order preview modal */}
        {orderPreview && (
          <OrderPreviewModal
            order={orderPreview}
            step={flowStep}
            onCancel={() => { setOrderPreview(null); setFlowStep('idle'); }}
            onConfirm={confirmOrder}
            market={market}
            lastPrice={lastPrice}
            t={t}
          />
        )}

        {/* Tweaks panel */}
        <window.TweaksPanel
          tweaks={tweaks}
          setTweaks={setTweaks}
          open={tweaksOpen}
          onClose={() => setTweaksOpen(false)}
          t={t}
        />

        {/* Tweaks toggle button (floating) */}
        {!tweaksOpen && (
          <button
            onClick={() => setTweaksOpen(true)}
            style={{
              position: 'fixed', bottom: 20, right: 20, zIndex: 100,
              width: 44, height: 44, borderRadius: '50%',
              background: 'var(--color-brand)', color: 'var(--color-text-inverse)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--shadow-3)'
            }}
            title={t('open_tweaks')}
          >
            <I.Cog size={18}/>
          </button>
        )}
      </div>
    );
  };

  // ============================================================
  // Widget dispatcher
  // ============================================================
  function widgetLabel(type, t) {
    const map = {
      marketWatch: t('market_watch'),
      chart: 'Chart',
      orderBook: t('order_book'),
      recentTrades: t('recent_trades'),
      orderEntry: t('order_entry'),
      positions: t('positions'),
      assetsRisk: t('assets_risk'),
      aiCopilot: t('ai_copilot'),
      miniChart: 'Mini Chart',
    };
    return map[type] || type;
  }

  function WidgetContent(props) {
    /*
       자산 요약 — 실계정이 있으면 그 값을 쓴다.

       QT.ASSETS 는 고정 목업이다(가용 9,840.22 · 유지증거금 218.42 …).
       주문 패널의 '가용 자산' 과 수량 % 버튼이 이 값을 쓰므로, 목업이면
       실제로 넣을 수 없는 수량을 계산해 보여준다 — 거래소가 주문을 거절하고
       사용자는 이유를 모른다.

       값이 없으면 0 으로 둔다. % 버튼이 0 을 만들고 '잔고 부족' 이 뜬다 —
       목업 잔고로 주문 가능한 것처럼 보이는 쪽이 더 나쁘다.
    */
    const liveAssets = (() => {
      const acct = window.QTAccount;
      if (!acct || !acct.isLive || !acct.isLive()) {
        /*
           ★★ 실서비스에서는 목업 잔고를 쓰지 않는다.

             전에는 거래소 키가 없으면 무조건 QT.ASSETS(가용 9,840.22 ·
             미실현 396.77 · 자산 12,820.14)를 썼다. 주문 패널의 '가용 자산' 과
             수량 % 버튼이 이 값을 읽으므로, 사용자는 **넣을 수 없는 수량**을
             계산해 주문을 시도하고 거래소가 거절한다. 이유는 화면에 없다.

           ★ 0 으로 둔다. % 버튼이 0 을 만들고 "잔고 부족" 이 뜬다 — 목업
             잔고로 주문 가능한 것처럼 보이는 쪽이 훨씬 나쁘다.

           ★ 미리보기(백엔드 없음)에서는 목업을 유지한다 — 디자이너가 주문
             패널의 숫자 배치를 확인해야 한다.
        */
        if (window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) {
          return {
            walletBalance: 0, availableBalance: 0, marginBalance: 0,
            usedMargin: 0, maintenanceMargin: 0, unrealizedPnl: 0,
            marginRatio: 0, riskLevel: 'safe', equity: 0,
          };
        }
        return QT.ASSETS;
      }
      const rows = acct.getBalances() || [];
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const total = rows.reduce((a, x) => a + num(x.equity), 0);
      const avail = rows.reduce((a, x) => a + num(x.available), 0);
      const used = rows.reduce((a, x) => a + num(x.used), 0);
      const pos = acct.getPositions() || [];
      const unreal = pos.reduce((a, x) => a + num(x.unPnl), 0);
      return {
        walletBalance: total,
        availableBalance: avail,
        marginBalance: total,
        usedMargin: used,
        // 유지증거금은 거래소가 계정 단위로 주지 않는다. 만들지 않고 0 으로 둔다.
        maintenanceMargin: 0,
        unrealizedPnl: unreal,
        marginRatio: total > 0 ? used / total : 0,
        riskLevel: total > 0 && used / total > 0.8 ? 'danger' : (total > 0 && used / total > 0.5 ? 'warning' : 'safe'),
        equity: total,
      };
    })();

    const { widget } = props;
    // 실 잔고·포지션이 도착하면 재렌더한다. 이 훅이 없으면 위젯이 최초 렌더의
    // 목업을 계속 보여준다 (QT.POSITIONS 를 바꿔치기해도 React 는 모른다).
    if (window.useAccountData) window.useAccountData();
    switch (widget.type) {
      case 'marketWatch':
        return <window.MarketWatch current={props.market.base + props.market.quote} onSelect={props.onSelectMarket} t={props.t}/>;
      case 'chart':
        /*
           ★★ 차트 자리를 격자로 감싼다 — 거래 화면 안에서 멀티차트가 된다.

             전에는 여러 차트를 보려면 `/multi-chart` 탭으로 옮겨야 했다. 그
             탭에서는 **주문을 낼 수 없다.** 여러 종목을 비교하는 목적은 그중
             하나에 진입하는 것인데, 탭을 옮기는 동안 호가가 바뀐다.

           ★★ 칸마다 **완전한 차트**다(축소판이 아니다). 지표·드로잉이 칸마다 따로
             있다. 포커스된 칸이 활성 종목이므로 왼쪽 목록·AI 대화·주문 패널이
             모두 그 칸을 따라간다.

           ★ 1칸이 기본이다. 저장된 배치가 없으면 지금까지와 똑같이 보인다.
        */
        return window.ChartGrid ? (
          <window.ChartGrid
            activeSymbol={props.market ? props.market.base + props.market.quote : ''}
            activeTimeframe={props.timeframe}
            onSelectSymbol={props.onSelectMarket ? (sym) => {
              /*
                 ★ 활성 종목 변경은 시장 목록과 같은 경로를 쓴다. 여기서 따로
                   상태를 바꾸면 MarketWatch 선택과 어긋난다.
              */
              const got = (window.QTMarkets && window.QTMarkets.list) ? window.QTMarkets.list() : null;
              const hit = ((got && got.rows) || []).find((m) => String(m.base) + String(m.quote) === sym);
              if (hit) props.onSelectMarket(hit);
            } : null}
            onSelectTimeframe={props.setTimeframe}
            renderPane={({ symbol, timeframe, focused, paneId, setTimeframe }) => {
              /*
                 포커스된 칸은 거래 화면이 이미 들고 있는 값을 그대로 쓴다
                 (캔들·오버레이·시세). 다시 만들면 같은 데이터를 두 벌 들고
                 있게 되고, 한쪽만 갱신되는 순간 두 값이 어긋난다.
              */
              if (focused) {
                return <ChartWidget {...props} paneId={paneId} focused={true}/>;
              }
              /*
                 보조 칸은 자기 종목·주기의 캔들을 직접 읽는다.

                 ★ QT.generateCandles 는 동기 계약이다(캐시 히트 시 실캔들,
                   미스 시 요청을 걸고 목업 반환). 여기서 부르는 것이 안전하다.

                 ★★ 오버레이는 **그 칸의 종목**으로 걸러야 한다. 활성 종목의
                   오버레이를 그대로 넘기면 ETH 차트에 BTC 진입가 선이 그려지고,
                   이용자는 자기가 ETH 포지션을 들고 있다고 읽는다.
              */
              const paneCandles = (window.QT && window.QT.generateCandles)
                ? window.QT.generateCandles({ symbol, tf: timeframe, count: 220 })
                : [];
              const paneOverlays = (props.allOverlays || []).filter((o) => o.symbol === symbol);
              const last = paneCandles.length ? paneCandles[paneCandles.length - 1].close : null;
              return (
                <ChartWidget
                  {...props}
                  paneId={paneId}
                  focused={false}
                  /*
                     ★ market 객체를 통째로 넘기지 않고 심볼만 바꾼 사본을 만든다.
                       원본을 넘기면 이 칸이 활성 종목의 정보(승수·수수료)를 쓴다.
                  */
                  market={{ ...props.market, base: symbol.replace(/USDT$|USDC$|BTC$/, ''), quote: symbol.replace(/^.*?(USDT|USDC|BTC)$/, '$1'), symbol }}
                  candles={paneCandles}
                  lastPrice={last}
                  prevPrice={paneCandles.length > 1 ? paneCandles[paneCandles.length - 2].close : null}
                  timeframe={timeframe}
                  setTimeframe={setTimeframe}
                  overlays={paneOverlays}
                />
              );
            }}
          />
        ) : <ChartWidget {...props}/>;
      case 'miniChart':
        return <MiniChartWidget {...props}/>;
      case 'orderBook': {
        // 실서비스에서 라이브가 아닌 종목은 가짜 호가를 그리지 않는다(미지원 종목 mock 차단).
        const k = props.market ? props.market.base + props.market.quote : '';
        const maskMock = Boolean(window.QTMockPolicy && window.QTMockPolicy.isRealService() && window.QTLive && typeof window.QTLive.isLive === 'function' && k && !window.QTLive.isLive(k));
        if (maskMock) return <div className="panel" style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--color-text-tertiary)', fontSize:12}}>{props.t('no_live_data')}</div>;
        return <window.OrderBook book={props.orderBook} lastPrice={props.lastPrice} prevPrice={props.prevPrice} onClickPrice={props.onClickPrice} t={props.t}/>;
      }
      case 'recentTrades': {
        const k = props.market ? props.market.base + props.market.quote : '';
        const maskMock = Boolean(window.QTMockPolicy && window.QTMockPolicy.isRealService() && window.QTLive && typeof window.QTLive.isLive === 'function' && k && !window.QTLive.isLive(k));
        if (maskMock) return <div className="panel" style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--color-text-tertiary)', fontSize:12}}>{props.t('no_live_data')}</div>;
        return <window.RecentTrades trades={props.trades} t={props.t}/>;
      }
      case 'orderEntry':
        return <window.OrderEntry
          lastPrice={props.lastPrice} market={props.market} assets={liveAssets}
          marginMode="CROSS" leverage={20}
          prefillPrice={props.orderDraft?.price}
          prefillSize={props.orderDraft?.size}
          prefillSide={props.orderDraft?.side}
          tpsl={props.orderDraft?.tpsl}
          onPlaceOrder={props.onPlaceOrder}
          isBeginner={props.isBeginner}
          t={props.t}
        />;
      case 'positions':
        /*
           포지션·미체결 패널.

           ★★ 전에는 `QT.POSITIONS` / `QT.OPEN_ORDERS`(목업)를 그대로 넘겼다.
             거래 화면 하단에 목업 포지션 3개(0.185 BTC @ 67,285 · ETH 1.5 @ 3,568)가
             항상 떠 있었고, 사용자는 자기 포지션으로 읽는다. '전량 청산' 버튼도
             그 옆에 있다.

           ★ 거래소 실포지션이 있으면 그것을, 없으면 실서비스에서는 빈 목록을
             넘긴다. 미리보기에서는 목업을 유지한다.
        */
        return <window.PositionsPanel
          lastPrice={props.lastPrice}
          positions={(() => {
            const acct = window.QTAccount;
            if (acct && acct.isLive && acct.isLive()) return acct.getPositions() || [];
            if (window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) return [];
            return QT.POSITIONS;
          })()}
          orders={(() => {
            const acct = window.QTAccount;
            if (acct && acct.isLive && acct.isLive()) return acct.getOpenOrders() || [];
            if (window.QTMockPolicy && !window.QTMockPolicy.allowMockData()) return [];
            return QT.OPEN_ORDERS;
          })()}
          /* 'Symbol만' 필터가 기준으로 쓸 현재 심볼. */
          currentSymbol={props.market ? `${props.market.base}${props.market.quote}` : null}
          t={props.t}
        />;
      case 'assetsRisk':
        return <window.AssetsRisk assets={liveAssets} t={props.t}/>;
      case 'aiCopilot':
        return <window.AICopilot
          /* ★ 격자 id 를 넘긴다 — 접으면 이 칸의 공간이 차트로 넘어간다. */
          widgetId={widget.id}
          context={props.chartContext}
          isBeginner={props.isBeginner}
          overlays={props.overlays}
          addOverlay={props.addOverlay}
          updateOverlay={props.updateOverlay}
          removeOverlay={props.removeOverlay}
          currentSignal={props.currentSignal}
          onProposeSignal={props.proposeSignal}
          onApproveSignal={props.approveSignal}
          onCreateOrderDraft={props.createOrderDraft}
          onRejectSignal={props.rejectSignal}
          t={props.t}
        />;
      default:
        return <div className="panel"><div className="empty"><span>Unknown widget: {widget.type}</span></div></div>;
    }
  }

  // ============================================================
  // Chart widget wrapper (with toolbar + draw tools)
  // ============================================================
  function ChartWidget({
    market, lastPrice, candles, timeframe, setTimeframe, overlays, updateOverlay, addOverlay: _addOverlay, pushToast, t,
    /*
       ★★ 격자에서 여러 개가 동시에 살아 있을 수 있다.

         `focused` 는 "이 칸이 지금 이용자가 고른 칸인가" 다. 전역 단일값
         (QTChartState 활성지표 · QTChartDebug)은 **포커스된 칸만** 쓴다.
         전부 쓰면 마지막에 렌더된 칸의 값이 남아, AI 코파일럿이 이용자가
         보고 있지 않은 차트의 지표를 말한다.

       ★ 기본값 true — 격자를 쓰지 않는 화면(단일 차트)에서 지금까지와 같이
         동작해야 한다.
    */
    focused = true, _paneId = 'main',
  }) {
    const [activeTool, setActiveTool] = useState('cursor');
    const [showMA, setShowMA] = useState(true);
    // 지표 패널. 버튼 마크업은 그대로 두고 패널만 아래에 띄운다.
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [compareOpen, setCompareOpen] = useState(false);
    // KLineChart 인스턴스. 지표 패널이 이걸 통해 지표를 켜고 끈다.
    const chartInstRef = useRef(null);
    const [chartGen, setChartGen] = useState(0);
    const handleChartReady = useCallback((chart) => {
      chartInstRef.current = chart;
      /*
         차트 상태를 콘솔에서 확인할 수 있게 노출한다.

         지표·드로잉이 실제로 적용됐는지 화면만 보고는 확인이 어렵다
         (선이 겹쳐 있거나 화면 밖에 그려질 수 있다). 검증 스크립트와
         운영 중 문제 추적에 쓴다. 읽기 전용 진단이며 렌더링에 영향이 없다.
      */
      /*
         ★★ 포커스된 칸만 전역 진단을 차지한다.

           격자에서 6칸이 모두 덮어쓰면 `QTChartDebug.instance()` 가 마지막에
           렌더된 칸을 가리킨다. 검증 스크립트가 "지표가 안 켜졌다" 고 보고하는데
           실제로는 다른 칸을 본 것이다 — 원인을 찾을 수 없는 종류의 오보다.
      */
      if (!focused) return;
      window.QTChartDebug = {
        instance: () => chartInstRef.current,
        indicators: () => {
          const c = chartInstRef.current;
          if (!c || !c.getIndicators) return null;
          const got = c.getIndicators();
          // KLineChart 10 은 Map 또는 객체를 돌려준다. 둘 다 처리한다.
          if (got instanceof Map) return [...got.values()].flat().map((i) => i.name);
          if (Array.isArray(got)) return got.map((i) => i.name);
          return Object.values(got || {}).flat().map((i) => i && i.name);
        },
        overlays: () => {
          const c = chartInstRef.current;
          if (!c || !c.getOverlays) return null;
          const got = c.getOverlays();
          const list =
            got instanceof Map ? [...got.values()].flat()
            : Array.isArray(got) ? got
            : Object.values(got || {}).flat();
          // points 를 함께 돌려준다. 점이 없으면 "그리는 중(미완성)" 이고,
          // 그 상태에서 다른 도구를 고르면 KLineChart 가 지운다.
          return list.filter(Boolean).map((o) => ({
            name: o.name,
            points: Array.isArray(o.points) ? o.points.filter((pt) => pt && (pt.timestamp || pt.dataIndex !== undefined)).length : 0,
            paneId: o.paneId,
          }));
        },
      };
      // 인스턴스가 바뀌면 패널이 상태를 다시 읽어야 한다.
      setChartGen(g => g + 1);
      /*
         ★ focused 를 의존성에 넣는다. 넣지 않으면 포커스를 옮겨도 이 콜백이
           예전 focused 값을 계속 보고, 전역 진단이 옮겨지지 않는다.
      */
    }, [focused]);
    const getChart = useCallback(() => chartInstRef.current, []);
    const supportsIndicators = Boolean(window.ChartIndicatorPanel && window.klinecharts);
    // 비교는 KLineChart 지표 등록이 필요하다. 자체 Canvas 엔진에서는 쓸 수 없다.
    const supportsCompare = Boolean(window.ChartComparePanel && window.klinecharts);

    // 차트 액션 (스크린샷·전체화면·드로잉 등). KLineChart API 는 chart-actions.js 가 감싼다.
    const bodyElRef = useRef(null);
    const actions = useMemo(
      () => (window.ChartActions
        ? window.ChartActions.create(getChart, {
            getContainer: () => bodyElRef.current,
            notify: (msg) => pushToast && pushToast(msg),
            // 도형의 가격 라벨 자리수를 심볼 tickSize 에서 구하기 위해 넘긴다.
            getSymbol: () => `${market.base}${market.quote}`,
          })
        : null),
      [getChart, pushToast, market.base, market.quote],
    );

    /*
       진단 창구.

       드로잉·지표가 실제로 만들어졌는지 밖에서 확인할 방법이 없었다.
       화면 안 상태라 콘솔에서도, 자동 검증에서도 볼 수 없었다 — "버튼은
       눌리는데 도형이 생겼는지 모르는" 상태였다.

       읽기 전용으로만 노출한다. 조작 함수를 내보내면 콘솔에서 주문 화면의
       상태를 바꿀 수 있게 되고, 그건 진단이 아니라 우회로가 된다.
    */
    useEffect(() => {
      window.QTChartDiag = {
        /** 사용자가 그린 도형 목록. name 과 source 만 준다. */
        drawings: () => {
          const c = getChart();
          if (!c || !c.getOverlays) return null;
          try {
            return c.getOverlays().map((o) => ({
              id: o.id,
              name: o.name,
              source: (o.extendData && o.extendData.source) || null,
              points: Array.isArray(o.points) ? o.points.length : 0,
              locked: Boolean(o.lock),
              visible: o.visible !== false,
            }));
          } catch (e) { return null; }
        },
        /** 적용된 지표 목록. */
        indicators: () => {
          const c = getChart();
          if (!c || !c.getIndicators) return null;
          try {
            const out = [];
            const got = c.getIndicators();
            // KLineChart 버전에 따라 Map 또는 배열을 준다.
            if (got && typeof got.forEach === 'function') {
              got.forEach((v, k) => {
                if (Array.isArray(v)) v.forEach((x) => out.push({ pane: String(k), name: x.name }));
                else out.push({ pane: String(k), name: v && v.name });
              });
            }
            return out;
          } catch (e) { return null; }
        },
        /** 이 배포에서 그릴 수 있는 도형 이름. */
        supported: () => (window.ChartActions ? window.ChartActions.supportedOverlays() : null),
        /** 도구 ID → 오버레이 이름 대응. */
        toolMap: () => (window.ChartActions ? window.ChartActions.DRAW_TOOL_OVERLAY : null),
        chartReady: () => Boolean(getChart()),
        /*
           진단용 도형 생성.

           클릭 시뮬레이션 없이 오버레이 생성만 확인한다. 자동 검증에서
           "그려지는가" 와 "클릭이 전달되는가" 를 분리해야 원인을 특정할 수 있다.
           읽기 전용 원칙에서 예외를 두는 이유: 이것 없이는 2점 도구가 왜
           하나만 남는지 알 수 없었다.
        */
        probeCreate: (overlayName) => {
          const c = getChart();
          if (!c || !c.createOverlay) return null;
          try {
            const id = c.createOverlay({ name: overlayName, extendData: { source: 'diag-probe' } });
            return { id: String(id), total: c.getOverlays().length };
          } catch (e) { return { error: String(e && e.message) }; }
        },
      };
      return () => { delete window.QTChartDiag; };
    }, [getChart]);

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [magnetMode, setMagnetMode] = useState('normal');
    const [drawingsLocked, setDrawingsLocked] = useState(false);
    const [drawingsHidden, setDrawingsHidden] = useState(false);
    const [isFull, setIsFull] = useState(false);

    // 브라우저 전체화면 상태는 ESC 로도 바뀌므로 이벤트로 추적한다.
    useEffect(() => {
      const onFs = () => {
        setIsFull(Boolean(document.fullscreenElement));
        const chart = getChart();
        if (chart) setTimeout(() => { try { chart.resize(); } catch (e) { /* noop */ } }, 120);
      };
      document.addEventListener('fullscreenchange', onFs);
      return () => document.removeEventListener('fullscreenchange', onFs);
    }, [getChart]);

    /** 드로잉 도구 선택. 그리기 가능한 도구면 KLineChart 그리기를 시작한다. */
    const pickTool = useCallback((toolId) => {
      setActiveTool(toolId);
      if (actions) actions.startDrawing(toolId, magnetMode);
    }, [actions, magnetMode]);

    return (
      <div className="panel chart-panel">
        <div className="chart-toolbar">
          <div className="chart-tf">
            {['1m','5m','15m','30m','1H','4H','1D'].map(tf => (
              <button key={tf} className={`chart-tf__btn ${timeframe===tf?'is-active':''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
            ))}
          </div>
          <div className="chart-tool-wrap">
            <button
              className={`chart-tool ${indicatorsOpen ? 'is-active' : ''}`}
              onClick={() => supportsIndicators && setIndicatorsOpen(o => !o)}
              title={supportsIndicators ? t('indicators') : t('indicators_unavailable')}
              aria-expanded={indicatorsOpen}
            >
              {t('indicators')} <I.ChevronDown size={10}/>
            </button>
            {indicatorsOpen && supportsIndicators && (
              <window.ChartIndicatorPanel
                getChart={getChart}
                version={chartGen}
                onClose={() => setIndicatorsOpen(false)}
                /*
                   ★ 포커스된 칸만 활성 지표를 전역에 게시한다. AI 코파일럿과
                     학습 기록이 그 값을 읽으므로, 여러 칸이 게시하면 이용자가
                     보고 있지 않은 차트의 지표가 기록된다.
                */
                publish={focused}
              />
            )}
          </div>
          {/* 심볼 비교. 비교선은 상대 변화로 정규화해 그린다 (chart-compare.jsx). */}
          <div className="chart-tool-wrap">
            <button
              className={`chart-tool ${compareOpen ? 'is-active' : ''}`}
              title={supportsCompare ? t('chart_compare') : t('feature_pending')}
              aria-expanded={compareOpen}
              onClick={() => {
                if (!supportsCompare) {
                  pushToast && pushToast({ title: t('chart_compare'), desc: t('feature_pending'), variant: 'info' });
                  return;
                }
                setCompareOpen(o => !o);
              }}
            >
              {t('chart_compare')}
            </button>
            {compareOpen && supportsCompare && (
              <window.ChartComparePanel
                getChart={getChart}
                version={chartGen}
                baseSymbol={`${market.base}${market.quote}`}
                timeframe={timeframe}
                notify={pushToast}
                onClose={() => setCompareOpen(false)}
              />
            )}
          </div>
          <div className="chart-tool-wrap">
            <button
              className={`chart-tool ${templatesOpen ? 'is-active' : ''}`}
              title={t('chart_templates')}
              aria-expanded={templatesOpen}
              onClick={() => setTemplatesOpen(o => !o)}
            >
              {t('chart_templates')}
            </button>
            {templatesOpen && window.ChartTemplatePanel && (
              <window.ChartTemplatePanel
                getChart={getChart}
                version={chartGen}
                symbol={`${market.base}${market.quote}`}
                timeframe={timeframe}
                notify={pushToast}
                onClose={() => setTemplatesOpen(false)}
              />
            )}
          </div>
          <div className="chart-toolbar__sep"/>
          <button
            className="chart-tool"
            style={{color:'var(--color-ai)'}}
            title={t('chart_ai_analyze')}
            onClick={() => {
              // AI Copilot 이 이미 분석 흐름을 갖고 있다. 그쪽을 호출한다.
              if (window.QTAiBridge && window.QTAiBridge.requestAnalysis) {
                window.QTAiBridge.requestAnalysis({ symbol: `${market.base}/${market.quote}`, timeframe });
              } else if (pushToast) {
                pushToast({ title: t('chart_ai_analyze'), desc: t('ai_open_copilot'), variant: 'ai' });
              }
            }}
          >
            <I.Sparkles size={12}/> {t('chart_ai_analyze')}
          </button>
          <div style={{marginLeft:'auto', display:'inline-flex', gap: 2}}>
            {/* Replay 는 과거 재생 기능이라 설계가 필요하다. 지금은 "최신 캔들로 이동"으로
                실제 동작을 준다 — 죽은 버튼으로 두지 않되 없는 기능을 있다고 하지 않는다. */}
            <button
              className="chart-tool"
              title={t('chart_scroll_latest')}
              onClick={() => actions && actions.scrollToLatest()}
            >
              <I.Refresh size={12}/>
            </button>
            <button
              className="chart-tool"
              title={t('chart_screenshot')}
              onClick={() => actions && actions.screenshot({
                symbol: `${market.base}${market.quote}`,
                timeframe,
              })}
            >
              <I.Camera size={12}/>
            </button>
            <button
              className={`chart-tool ${isFull ? 'is-active' : ''}`}
              title={t('chart_fullscreen')}
              aria-pressed={isFull}
              onClick={() => actions && actions.toggleFullscreen()}
            >
              <I.Expand size={12}/>
            </button>
            <div className="chart-tool-wrap">
              <button
                className={`chart-tool ${settingsOpen ? 'is-active' : ''}`}
                title={t('chart_settings')}
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(o => !o)}
              >
                <I.Cog size={12}/>
              </button>
              {settingsOpen && window.ChartSettingsPanel && (
                <window.ChartSettingsPanel
                  getChart={getChart}
                  version={chartGen}
                  showMA={showMA}
                  onToggleMA={setShowMA}
                  onClose={() => setSettingsOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="chart-body" ref={bodyElRef}>
          <div className="chart-drawtools">
            {/* 도구 목록. 라벨은 사전에서 가져오고, 현재 렌더러가 지원하지 않는
                도구는 비활성 표시만 한다 — 버튼을 없애지 않는다. */}
            {[
              { id: 'cursor', icon: I.Cursor, key: 'tool_cursor' },
              { id: 'trend-line', icon: I.Line, key: 'tool_trend_line' },
              { id: 'horizontal', icon: I.Horizontal, key: 'tool_horizontal' },
              { id: 'fib', icon: I.Fib, key: 'tool_fib' },
              { id: 'long', icon: I.LongPos, key: 'tool_long' },
              { id: 'short', icon: I.ShortPos, key: 'tool_short' },
              { id: 'measure', icon: I.Measure, key: 'tool_measure' },
              { id: 'text', icon: I.Text, key: 'tool_text' },
            ].map(tool => {
              const available = !window.ChartActions || window.ChartActions.isDrawToolAvailable(tool.id);
              return (
                <button
                  key={tool.id}
                  className={`chart-drawtool ${activeTool===tool.id?'is-active':''}`}
                  onClick={() => pickTool(tool.id)}
                  title={available ? t(tool.key) : `${t(tool.key)} — ${t('draw_tool_unavailable')}`}
                  aria-pressed={activeTool===tool.id}
                  style={available ? undefined : { opacity: 0.4 }}
                >
                  <tool.icon size={14}/>
                </button>
              );
            })}
            <div className="chart-drawtool-sep"/>
            <button
              className={`chart-drawtool ${magnetMode !== 'normal' ? 'is-active' : ''}`}
              title={`${t('tool_magnet')} · ${t('magnet_' + magnetMode)}`}
              aria-pressed={magnetMode !== 'normal'}
              onClick={() => actions && setMagnetMode(actions.cycleMagnet(magnetMode))}
            >
              <I.Magnet size={14}/>
            </button>
            <button
              className={`chart-drawtool ${drawingsLocked ? 'is-active' : ''}`}
              title={t('tool_lock')}
              aria-pressed={drawingsLocked}
              onClick={() => {
                if (!actions) return;
                const next = !drawingsLocked;
                actions.setDrawingsLocked(next);
                setDrawingsLocked(next);
              }}
            >
              <I.Lock size={14}/>
            </button>
            <button
              className={`chart-drawtool ${drawingsHidden ? 'is-active' : ''}`}
              title={t('tool_hide')}
              aria-pressed={drawingsHidden}
              onClick={() => {
                if (!actions) return;
                const nextHidden = !drawingsHidden;
                actions.setDrawingsVisible(!nextHidden);
                setDrawingsHidden(nextHidden);
              }}
            >
              <I.EyeOff size={14}/>
            </button>
            <button
              className="chart-drawtool"
              title={t('tool_remove_all')}
              onClick={() => actions && actions.removeAllDrawings()}
            >
              <I.Trash size={14}/>
            </button>
          </div>

          {/* 차트 렌더러.
              기본은 KLineChart(지표 27종·드로잉 16종·정확한 시간축). 자체 Canvas
              엔진은 삭제하지 않고 폴백으로 남겨둔다 — localStorage 에
              qt.chartEngine='canvas' 를 넣으면 즉시 되돌릴 수 있고,
              klinecharts 로드 실패 시에도 자동으로 자체 엔진이 쓰인다. */}
          {(() => {
            const Renderer = window.ChartRenderer ? window.ChartRenderer() : window.ChartCanvas;
            return (
              <Renderer
                candles={candles}
                timeframe={timeframe}
                symbol={`${market.base}/${market.quote}`}
                overlays={overlays}
                onOverlayChange={(id, ov) => updateOverlay(id, ov)}
                lastPrice={lastPrice}
                showMA={showMA}
                activeTool={activeTool}
                onChartReady={handleChartReady}
              />
            );
          })()}
        </div>
      </div>
    );
  }

  /*
     소형 차트 위젯 — 멀티차트의 구성 단위.

     ★ 위젯마다 **자기 심볼**을 갖는다.

       전에는 전역 `market` 을 그대로 넘겼다. 그래서 차트를 4개 띄워도 4개가
       같은 심볼을 보여줬고, 멀티차트라는 이름과 달리 비교할 수가 없었다.

       심볼은 `widget.symbol` 에 저장한다. 레이아웃과 같은 곳에 저장되므로
       기기 저장(localStorage 'qt.layout')과 서버 템플릿 동기화에 자동으로
       포함된다 — 저장 경로를 새로 만들지 않는다.

       값이 없으면 전역 심볼을 따른다(기존 동작). 이렇게 하면 예전에 저장된
       레이아웃도 그대로 열린다.
  */
  function MiniChartWidget({ widget, market, timeframe, onChange, pushToast, t }) {
    const [picking, setPicking] = React.useState(false);

    const own = widget && widget.symbol ? String(widget.symbol) : null;
    // 표시용 'BTC/USDT' 와 조회용 'BTCUSDT' 를 구분한다.
    const display = own || `${market.base}/${market.quote}`;
    const tf = (widget && widget.timeframe) || timeframe;

    /*
       고를 수 있는 심볼은 서버가 아는 것만 쓴다.

       하드코딩한 목록을 쓰면 미상장 심볼을 고를 수 있게 되고, 그 화면은
       봉이 없는 채로 열린다. 시세 목록이 아직 없으면 선택기를 열지 않고
       이유를 알린다.
    */
    const symbols = React.useMemo(() => {
      const src = (window.QTApp && Array.isArray(window.QTApp.MARKETS) && window.QTApp.MARKETS)
        || (window.QT && Array.isArray(window.QT.MARKETS) && window.QT.MARKETS)
        || [];
      const out = [];
      for (const m of src) {
        const base = m.base || m.symbol || '';
        const quote = m.quote || 'USDT';
        if (!base) continue;
        const label = base.includes('/') ? base : `${base}/${quote}`;
        if (!out.includes(label)) out.push(label);
      }
      return out;
    }, []);

    function pick() {
      if (!symbols.length) {
        if (pushToast) pushToast({ title: t('mc_pick_symbol'), desc: t('mc_symbols_unavailable'), variant: 'info' });
        return;
      }
      setPicking((v) => !v);
    }

    return (
      /*
         ★ width:100% 가 필요하다.

           위젯 칸(부모)은 flex 컨테이너다. 이 래퍼에 폭을 주지 않으면 내용
           크기로 줄어들어, 12칸(681px)을 배정받은 차트가 258px 만 쓰고
           나머지가 빈 공간으로 남았다(실측). 봉이 좁아져 비교가 어려워진다.
      */
      <div style={{ position: 'relative', height: '100%', width: '100%', minWidth: 0 }}>
        <window.MiniChart
          symbol={display}
          timeframe={tf}
          onPickSymbol={onChange ? pick : null}
        />
        {picking && (
          /*
             심볼 선택 목록.

             모달을 쓰지 않는다 — 차트 두 개를 나란히 비교하는 중이므로
             화면을 덮으면 비교 대상이 가려진다.
          */
          <div
            className="panel"
            role="listbox"
            aria-label={t('mc_pick_symbol')}
            style={{
              position:'absolute', top: 28, left: 8, zIndex: 40,
              maxHeight: 220, overflowY:'auto', minWidth: 130,
              boxShadow:'var(--shadow-lg, 0 8px 24px rgba(0,0,0,.4))',
            }}
          >
            {symbols.map((s) => (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={s === display}
                className={`btn btn--ghost btn--sm ${s === display ? 'is-active' : ''}`}
                style={{ display:'block', width:'100%', textAlign:'left' }}
                onClick={() => {
                  setPicking(false);
                  if (onChange) onChange({ symbol: s });
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // Risk Checklist — multi-signal safety
  // ============================================================
  function RiskChecklist({ order, lastPrice }) {
    const px = order.price;
    const isLong = order.side === 'long';
    const priceDev = ((px - lastPrice) / lastPrice) * 100;
    const tp = Array.isArray(order.tpsl?.tp) ? order.tpsl.tp[0] : order.tpsl?.tp;
    const sl = order.tpsl?.sl;

    const checks = [];
    // 1. SL direction
    if (sl != null) {
      const slValid = isLong ? sl < px : sl > px;
      checks.push({
        state: slValid ? 'ok' : 'fail',
        label: t('risk_sl_direction'),
        detail: t(slValid ? 'risk_sl_ok' : 'risk_sl_fail'),
        meta: `SL ${fmt(sl,1)} vs Entry ${fmt(px,1)}`,
      });
    }
    // 2. TP direction
    if (tp != null) {
      const tpValid = isLong ? tp > px : tp < px;
      checks.push({
        state: tpValid ? 'ok' : 'fail',
        label: t('risk_tp_direction'),
        detail: t(tpValid ? 'risk_tp_ok' : 'risk_tp_fail'),
        meta: `TP ${fmt(tp,1)} vs Entry ${fmt(px,1)}`,
      });
    }
    /*
       3. 레버리지.

       ★★ `const leverage = 20;` 이 박혀 있었다. 주문이 다른 배율로 나가도 확인창은
         언제나 20× 라고 적었다. 실주문을 열면 이 줄이 사용자를 오도한다 — 확인창은
         마지막으로 판단하는 화면이다. 주문에 실린 값을 쓰고, 없으면 시장 기본값을 쓴다.
    */
    const leverage = Number(order.leverage) > 0
      ? Number(order.leverage)
      : (Number(order.market && order.market.leverage) > 0 ? Number(order.market.leverage) : 20);
    checks.push({
      state: leverage > 50 ? 'warn' : 'ok',
      label: t('risk_leverage'),
      detail: t(leverage > 50 ? 'risk_lev_high' : 'risk_lev_normal', { lev: leverage }),
      meta: `${leverage}×`,
    });
    // 4. Liquidation distance
    const liqDistPct = Math.abs(((order.estLiq - px) / px) * 100);
    checks.push({
      state: liqDistPct < 3 ? 'fail' : liqDistPct < 6 ? 'warn' : 'ok',
      label: t('risk_liq_distance'),
      detail: t(liqDistPct < 3 ? 'risk_liq_danger_close' : liqDistPct < 6 ? 'risk_liq_warn' : 'risk_liq_safe'),
      meta: `-${liqDistPct.toFixed(2)}%`,
    });
    // 5. Price deviation
    checks.push({
      state: Math.abs(priceDev) > 3 ? 'warn' : 'ok',
      label: t('risk_price_dev'),
      detail: t(Math.abs(priceDev) > 3 ? 'risk_dev_far' : 'risk_dev_near'),
      meta: `${priceDev >= 0 ? '+' : ''}${priceDev.toFixed(2)}%`,
    });
    /*
       6. 데이터 출처·지연.

       ★★ 전에는 `'Live · 24ms · Mock stream'` 이 문자열로 박혀 있었다. 24ms 는
         아무도 계측하지 않은 숫자이고, 목업 스트림인데 'Live' 라고 적혀 있었다.
         주문 확인창은 사용자가 마지막으로 판단하는 화면이다 — 여기서 거짓을
         보여주면 그 판단이 무의미해진다.

       ★ 이제 QTLive 의 실측값만 쓴다. 계측되지 않았으면 계측되지 않았다고 쓴다.
    */
    {
      const L = window.QTLive;
      const source = L && typeof L.getSource === 'function' ? L.getSource() : null;
      const ms = L && typeof L.getLatency === 'function' ? Math.round(L.getLatency()) : 0;
      const isLiveFeed = source === 'live';
      checks.push({
        state: isLiveFeed ? 'ok' : 'warn',
        label: t('risk_data_state'),
        detail: isLiveFeed
          ? (ms > 0 ? t('risk_data_live', { ms: ms }) : t('risk_data_unmeasured'))
          : t('risk_data_mock'),
        meta: isLiveFeed ? 'WS' : '—',
      });
    }
    /*
       7. AI 확신도 — 승인한 신호가 있을 때만 보여준다.

       ★★ 전에는 모든 주문에 '74%' 가 붙었다. 손으로 낸 주문에도 AI 가 74%
         확신한다고 적혀 있었다. 어떤 모델도 계산하지 않은 숫자다.
    */
    if (order.ai && typeof order.ai.confidence === 'number') {
      checks.push({
        state: 'ok',
        label: t('ai_confidence'),
        detail: t('risk_ai_conf_from_signal'),
        meta: `${order.ai.confidence}%`,
      });
    }

    const failCount = checks.filter(c => c.state === 'fail').length;
    const warnCount = checks.filter(c => c.state === 'warn').length;

    return (
      <div className="risk-checklist">
        <div className="risk-checklist__title">
          <span>{t('op_risk_title')}</span>
          <span style={{fontFamily:'var(--font-mono)', textTransform:'none', letterSpacing:'0.02em'}}>
            {failCount > 0 ? <span style={{color:'var(--color-danger)'}}>{t('risk_fail_n', { n: failCount })}</span> : warnCount > 0 ? <span style={{color:'var(--color-warning)'}}>{t('risk_warn_n', { n: warnCount })}</span> : <span style={{color:'var(--color-success)'}}>{t('risk_all_clear')}</span>}
          </span>
        </div>
        {checks.map((c, i) => (
          <div key={i} className={`risk-check is-${c.state}`}>
            <span className="risk-check__icon">{c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : '✗'}</span>
            <span>{c.label}</span>
            <span style={{color:'var(--color-text-tertiary)', fontSize: 10, marginLeft: 8}}>{c.detail}</span>
            <span className="risk-check__meta">{c.meta}</span>
          </div>
        ))}
      </div>
    );
  }

  // ============================================================
  // Order Preview Modal (multi-step)
  // ============================================================
  function OrderPreviewModal({ order, step, onCancel, onConfirm, market, lastPrice, t }) {
    /*
       서버가 계산한 값이 오면 그것을 보여준다.
       클라이언트 추정치를 그대로 두면 화면 숫자와 실제 체결 조건이 어긋난다.
       사용자는 화면 숫자를 믿고 확인을 누르므로, 이 불일치는 그대로 손실이 된다.
       서버 응답이 아직 없으면 클라이언트 추정치를 쓴다 (빈 화면보다 낫다).
    */
    const sp = order.serverPreview || null;
    const shown = {
      notional: sp && sp.positionValue !== undefined ? Number(sp.positionValue) : order.totalUSDT,
      fee: sp && sp.estFee !== undefined ? Number(sp.estFee) : order.fee,
      liq: sp && sp.estLiquidationPrice !== undefined ? Number(sp.estLiquidationPrice) : order.estLiq,
      margin: sp && sp.requiredMargin !== undefined ? Number(sp.requiredMargin) : order.requiredMargin,
      /** 서버 검증을 통과했는지. 통과 전에는 확인 버튼을 누를 수 없다. */
      verified: Boolean(sp),
    };
    const isFinal = step === 'submitted';
    const submitting = step === 'risk-check' || step === 'confirm';
    return (
      <div className="overlay" onClick={onCancel}>
        <div className="modal" style={{width: 640}} onClick={e => e.stopPropagation()}>
          <div className="modal__header">
            <div>
              <div className="modal__title">
                {t('op_title')} · {order.side === 'long' ? t('side_long_arrow') : t('side_short_arrow')}
                <span className={`badge ${order.side==='long'?'badge--long':'badge--short'}`} style={{marginLeft: 8}}>{order.type}</span>
              </div>
              {/*
                 ★★ 실제 주문 경로를 그대로 말한다 ★★

                   전에는 모드와 무관하게 항상 'op_sim_notice'
                   ("실제 자금은 사용되지 않는 시뮬레이션입니다. 프로토타입 데모.")
                   를 보여줬다. 실주문 모드에서 이 문장은 **거짓**이고, 사용자가
                   연습이라고 믿고 큰 수량을 넣게 만든다. 잃는 것은 실제 돈이다.

                 ★ 경로 판단은 QTMode.getOrderPath() 한 곳만 쓴다 — 화면이
                   따로 추측하면 두 판단이 갈린다.
              */}
              {(() => {
                const path = (window.QTMode && window.QTMode.getOrderPath)
                  ? window.QTMode.getOrderPath()
                  : null;
                /*
                   ★ 화면 모드와 **서버 상태**를 함께 본다.

                     화면이 선물 모드여도 서버가 실주문을 열지 않았으면 그 주문은
                     전송되지 않는다. 그때 "실제 돈을 잃을 수 있다" 고 쓰면 틀린 경고다.
                     반대로 서버가 실주문인데 모의라고 쓰면 위험을 축소한다 — 그래서
                     설정을 아직 못 받았으면(null) 실주문으로 간주해 경고를 남긴다.
                */
                const cfg = window.QTApi && window.QTApi.getConfig ? window.QTApi.getConfig() : null;
                const serverLive = cfg
                  ? (Boolean(cfg.liveOrdersEnabled) && /LIVE/i.test(String(cfg.tradingMode || '')))
                  : true;
                const isLive = path === 'live' && serverLive;
                return (
                  <div style={{
                    fontSize: 12, marginTop: 3, fontWeight: isLive ? 600 : 400,
                    color: isLive ? 'var(--color-danger)' : 'var(--color-text-tertiary)',
                  }}>
                    {isLive ? t('op_live_notice') : t('op_paper_notice')}
                  </div>
                );
              })()}
            </div>
            <button className="btn btn--icon" onClick={onCancel}><I.X size={14}/></button>
          </div>

          <div className="op-flow-steps">
            <span className={`op-step ${['user-review','approved','order-draft','preview','risk-check','confirm','submitted'].includes(step) ? 'is-done' : ''}`}>{t('op_step_1')}</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['approved','order-draft','preview','risk-check','confirm','submitted'].includes(step) ? 'is-done' : ''}`}>{t('op_step_2')}</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['order-draft','preview','risk-check','confirm','submitted'].includes(step) ? 'is-done' : ''}`}>{t('op_step_3')}</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['preview','risk-check','confirm','submitted'].includes(step) ? (step === 'preview' ? 'is-active' : 'is-done') : ''}`}>{t('op_step_4')}</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${['risk-check','confirm','submitted'].includes(step) ? (step === 'risk-check' ? 'is-active' : 'is-done') : ''}`}>{t('op_step_5')}</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${step==='confirm' ? 'is-active' : step === 'submitted' ? 'is-done' : ''}`}>{t('op_step_6')}</span>
            <span className="op-step-arrow">→</span>
            <span className={`op-step ${step==='submitted' ? 'is-active' : ''}`}>{t('op_step_7')}</span>
          </div>

          <div className="modal__body">
            <div className="op-grid">
              <div className="op-row"><span className="op-row__k">{t('fld_symbol')}</span><span className="op-row__v">{market.base}/{market.quote} · PERP</span></div>
              <div className="op-row"><span className="op-row__k">{t('op_side_type')}</span><span className="op-row__v"><span className={order.side==='long'?'t-long':'t-short'}>{order.side === 'long' ? t('side_long_arrow') : t('side_short_arrow')}</span> · {order.type === 'market' ? t('market') : t('limit')}</span></div>
              <div className="op-row"><span className="op-row__k">{t('fld_price')}</span><span className="op-row__v">{fmt(order.price, 1)} USDT</span></div>
              <div className="op-row"><span className="op-row__k">{t('fld_size')}</span><span className="op-row__v">{fmt(order.size, 4)} {market.base}</span></div>
              <div className="op-row"><span className="op-row__k">{t('op_notional')}</span><span className="op-row__v">{fmt(shown.notional)} USDT</span></div>
              {/*
                 ★★ 레버리지를 코드에 박지 않는다.

                   전에는 `20×` 로 고정돼 있었다. 이 창은 **실주문을 내기 직전의
                   확인 화면**이다. 10배로 주문하는 사람에게 20배라고 보여주면
                   필요 증거금과 청산가를 완전히 다르게 이해한 채 확인을 누른다.
                   값을 모르면 '—' 를 보여주는 것이 낫다.
              */}
              <div className="op-row"><span className="op-row__k">{t('op_leverage')}</span><span className="op-row__v">{Number.isFinite(Number(order.leverage)) ? `${Number(order.leverage)}×` : t('dash')}</span></div>
              <div className="op-row"><span className="op-row__k">{t('fld_required_margin')}</span><span className="op-row__v">{fmt(shown.margin)} USDT</span></div>
              {/*
                 수수료 요율은 거래소 계약 사양에서 온다(market.takerFeeRate).
                 모르면 요율을 말하지 않고 값도 '—' 로 둔다 — 0 으로 채우면
                 "수수료가 없다" 로 읽힌다.
              */}
              <div className="op-row">
                <span className="op-row__k">
                  {Number.isFinite(Number(market.takerFeeRate))
                    ? t('oe_est_fee_pct', { pct: (Number(market.takerFeeRate) * 100).toFixed(3) })
                    : t('oe_est_fee')}
                </span>
                <span className="op-row__v">{shown.fee == null ? t('dash') : `${fmt(shown.fee, 4)} USDT`}</span>
              </div>
              <div className="op-row"><span className="op-row__k">{t('oe_est_liq')}</span><span className="op-row__v t-warning">{fmt(shown.liq, 1)}</span></div>
              <div className="op-row"><span className="op-row__k">TIF</span><span className="op-row__v">{order.tif || 'GTC'}</span></div>
              {order.tpsl && (
                <>
                  <div className="op-row"><span className="op-row__k">{t('op_take_profit')}</span><span className="op-row__v t-long">{Array.isArray(order.tpsl.tp) ? order.tpsl.tp.map(t2 => fmt(t2,0)).join(' / ') : fmt(order.tpsl.tp, 1)}</span></div>
                  <div className="op-row"><span className="op-row__k">{t('op_stop_loss')}</span><span className="op-row__v t-short">{fmt(order.tpsl.sl, 1)}</span></div>
                </>
              )}
            </div>

            {/* Multi-signal Risk Checklist */}
            <RiskChecklist order={order} lastPrice={lastPrice}/>

            {order.ai && (
              <div className="oe-warn" style={{marginTop: 12}}>
                <span className="oe-warn__icon"><I.Alert size={14}/></span>
                <div>
                  <strong>{t('op_ai_warn_label')}</strong> {t('op_ai_warn_body')}
                </div>
              </div>
            )}

            {submitting && (
              <div style={{marginTop:16, padding: 12, background:'var(--color-bg-panel)', borderRadius: 6, textAlign:'center'}}>
                <div className="dot dot--live" style={{marginRight: 6}}/>
                {t(step === 'risk-check' ? 'op_risk_checking' : 'op_submitting')}
              </div>
            )}
            {isFinal && (
              <div style={{marginTop:16, padding: 12, background:'oklch(74% 0.14 150 / 0.14)', border:'1px solid var(--color-success)', borderRadius: 6, color:'var(--color-success)', textAlign:'center'}}>
                <I.Check size={16} style={{display:'inline', verticalAlign:'-3px', marginRight: 4}}/>
                <strong>{t('op_accepted')}</strong> · Order ID: SIM-{Math.random().toString(36).slice(2,8).toUpperCase()}
              </div>
            )}
          </div>

          <div className="modal__footer">
            {!isFinal && !submitting && (
              <>
                <button className="btn" onClick={onCancel}>{t('cancel')}</button>
                {/*
                  서버 검증(주문 초안)이 끝나기 전에는 확인을 막는다.
                  검증 전에 확인하면 서버가 계산한 수수료·청산가를 보지 않은 채
                  주문하는 셈이다. 백엔드가 없는 정적 프리뷰에서는 그대로 진행한다.
                */}
                <button
                  className={`btn btn--${order.side}`}
                  onClick={onConfirm}
                  style={{minWidth: 180}}
                  disabled={Boolean(window.QTApi && window.QTApi.orders) && !shown.verified}
                  title={Boolean(window.QTApi && window.QTApi.orders) && !shown.verified ? t('op_verifying') : undefined}
                >
                  <I.Check size={14}/> {shown.verified || !(window.QTApi && window.QTApi.orders) ? t('op_final_confirm') : t('op_verifying')}
                </button>
              </>
            )}
            {submitting && <button className="btn" disabled>{t('op_submitting_short')}</button>}
            {isFinal && <button className="btn btn--primary" onClick={onCancel}>{t('close')}</button>}
          </div>
        </div>
      </div>
    );
  }
})();
