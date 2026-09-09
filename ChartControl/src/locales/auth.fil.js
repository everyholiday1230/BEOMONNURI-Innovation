/* ============================================================
   Filipino — 인증 화면 (pages-auth.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.

   ★ 빠진 키는 i18n 이 en 으로 자동 폴백한다.
   ★ {brand} {step} {total} {email} 치환자는 그대로 남긴다.
   ★ 필리핀 사용자는 영어·타갈로그 혼용(Taglish)이 실제 사용 형태다. 금융·기술
     용어는 영어를 유지하는 편이 오히려 정확하다 — 'ordinansa' 식 억지 번역 금지.
   ★ locale 코드는 'fil' 이다. 'tl-PH' 로만 설정된 브라우저는 자동감지에 걸리지
     않지만 헤더의 언어 목록에서 직접 고를 수 있다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'fil',
    {
      // --- 공용 푸터 / 브랜드 패널 ---
      auth_3b9e30: 'Mga Tuntunin',
      auth_d629d0: 'Privacy',
      auth_a5e5da: 'Seguridad',
      auth_e2654a: 'Tulong',
      auth_77edb5: 'Magtanong tungkol sa kahit anong chart.',
      auth_9ab22f: 'nasa iyo pa rin ang kontrol sa bawat order.',
      auth_7e2510:
        'Ang {brand} ay software para sa chart analysis. Magtanong tungkol sa isang chart sa simpleng salita at '
        + 'ipapaliwanag ng AI ang ibig sabihin ng mga indicator; kung magpasya kang kumilos, tatakbo ang order sa '
        + 'sarili mong exchange account matapos mong aprubahan. Hindi namin hawak ang pera mo, hindi namin ito '
        + 'pinamamahalaan, at hindi kami nagrerekomenda ng dapat mong bilhin.',
      auth_833f52: 'Simpleng salita → ikaw ang gumuguhit ng overlay → ikaw ang gumagawa ng sarili mong setup',
      auth_66cdd9: 'I-drag, i-resize at i-preset ang sarili mong layout',
      auth_2d0495: 'Aprubahan ≠ Isumite · maraming antas ng risk check',

      // --- 로그인 ---
      login_e225a6: 'Mag-sign in',
      login_3f05db: 'Mag-sign in sa iyong {brand} account',
      login_92c6f3: 'Nakalimutan ang password',
      login_a89650: 'Tandaan ang device na ito (30 araw)',
      login_33c1f7: 'Bineberipika…',
      login_e2d231: 'Mag-sign in →',
      login_46bed0: 'o',
      login_68a92d: 'Wala pang account?',
      login_49f561: 'Mag-sign up →',
      login_13d6ae: 'Maglagay ng kahit anong email at password, pagkatapos kahit anong 6-digit na 2FA code para makapasok sa app',
      login_241c96: 'Beripikahin →',
      login_f3047a: 'Hindi dumating ang code?',
      login_6adb8b: 'Ipadala muli sa SMS',
      login_f787eb: '← Bumalik',

      // --- 회원가입 ---
      signup_ecb4cc: 'Gumawa ng account',
      signup_a6f945: 'Tumatagal ng humigit-kumulang isang minuto',
      signup_1ff941: 'Account',
      signup_32b217: 'Email',
      signup_d284fa: 'KYC',
      signup_10c83d: 'Hindi bababa sa 10 karakter',
      signup_711154: 'Ilagay muli ang password',
      signup_5ca401: 'Dapat hindi bababa sa 8 karakter ang password',
      signup_dd3243: 'Hindi tugma ang mga password',
      signup_591c17: 'Napakahina',
      signup_24bb15: 'Mahina',
      signup_2179da: 'Katamtaman',
      signup_5f67e6: 'Malakas',
      signup_dff519: 'Napakalakas',
      signup_b329a3: '🇰🇷 South Korea',
      signup_44650a: 'Iba pa',
      signup_75a112: 'Sumasang-ayon ako (kailangan)',
      signup_532136: 'Privacy Policy',
      signup_21e2e3: 'Tumanggap ng marketing emails (opsyonal)',
      signup_24cd06: 'Pinoproseso…',
      signup_3929bb: 'Gumawa ng account →',
      signup_9922a0: 'May account na?',

      // --- 이메일 인증 ---
      email_verify_5eb00e: 'Nagpadala kami ng verification link sa iyong email address. Buksan ito para mag-verify, pagkatapos mag-sign in.',
      email_verify_0fa353: 'Kung hindi dumating, tingnan ang spam folder mo.',
      email_verify_37a414: 'Ipadala muli',
      email_verify_089bb3: '✓ Naipadala muli',
      email_verify_455f7c: 'Magpatuloy →',

      // --- KYC ---
      k_y_c_onboarding_5f6780: 'Pagberipika ng pagkakakilanlan (KYC)',
      k_y_c_onboarding_9334ed: '👤 Pangunahing impormasyon',
      k_y_c_onboarding_31fbff: 'Petsa ng kapanganakan',
      k_y_c_onboarding_ff63ca: 'Nasyonalidad',
      k_y_c_onboarding_c22557: 'Pumili',
      k_y_c_onboarding_ebce71: '🏠 Address',
      k_y_c_onboarding_dad291: 'Address line 2',
      k_y_c_onboarding_02220b: 'Ang proof of address ay ia-upload sa susunod na hakbang.',
      k_y_c_onboarding_8ff495: '🪪 ID document · selfie',
      k_y_c_onboarding_3f327d: 'Piliin ang uri ng ID mo.',
      k_y_c_onboarding_3ba1d5: 'National ID (PhilSys, atbp.)',
      k_y_c_onboarding_311122: "Driver's licence",
      k_y_c_onboarding_8e5bec: 'Pasaporte',
      k_y_c_onboarding_26c302: 'Harap ng ID',
      k_y_c_onboarding_2b9e56: 'Likod ng ID',
      k_y_c_onboarding_f8bbc7: 'Hindi kailangan para sa pasaporte',
      k_y_c_onboarding_51672c: 'I-upload',
      k_y_c_onboarding_6cfe7d: 'JPG · PNG · PDF (hanggang 10MB)',
      k_y_c_onboarding_de4a5c: 'Live selfie',
      k_y_c_onboarding_90745c: 'Kunan ang mukha mo kasama ang ID mo',
      k_y_c_onboarding_e07e2e: 'Buksan ang camera',
      k_y_c_onboarding_0f797f: '📋 Pinagmulan ng pera · layunin',
      k_y_c_onboarding_f01127: 'Pinagmulan ng pera',
      k_y_c_onboarding_edd43e: 'Kita sa trabaho',
      k_y_c_onboarding_7fb985: 'Kita sa negosyo',
      k_y_c_onboarding_f27c14: 'Kita sa investment',
      k_y_c_onboarding_98ae59: 'Naipong pera',
      k_y_c_onboarding_7340b7: 'Mana o regalo',
      k_y_c_onboarding_898ed0: 'Layunin sa pag-trade',
      k_y_c_onboarding_aa6c8f: 'Pangmatagalang investment',
      k_y_c_onboarding_e18ea9: 'Speculation · panandaliang kita',
      k_y_c_onboarding_5d5aea: 'Hedging · pamamahala ng risk',
      k_y_c_onboarding_d66780: 'Arbitrage',
      k_y_c_onboarding_810016: '← Bumalik',
      k_y_c_onboarding_c5798c: 'Susunod →',
      k_y_c_onboarding_4f67fa: 'Isumite para sa review →',
      k_y_c_onboarding_dc301f: 'Naisumite para sa review',
      k_y_c_onboarding_2ecb11: 'Naisumite ang KYC 🎉',
      k_y_c_onboarding_55af46: 'Aaprubahan sa loob ng 1-24 oras · aabisuhan ka sa email',
      k_y_c_onboarding_03e1e5: 'Simulan ang app →',
      kyc_step_progress: 'Hakbang {step} / {total} · mga 3-5 min',

      // --- 비밀번호 재설정 ---
      password_reset_8d8082: 'I-reset ang password',
      password_reset_d196c8: 'Ipapadala namin sa email ang reset link sa iyong nakarehistrong address',
      password_reset_7badb1: 'Ipadala ang reset link →',
      password_reset_5ee6ba: '← Bumalik sa sign in',
      password_reset_d09993: 'Naipadala ang email',
      password_reset_a40b90: 'Pumunta sa sign in →',
      pwreset_link_sent: 'Naipadala ang reset link sa {email}.',

      // --- 랜딩 ---
      landing_66a662: 'Kami ay isang software company. Hindi namin hawak ang pera mo, hindi namin ito pinamamahalaan, at hindi namin sinasabi sa iyo ang dapat mong bilhin.',
      landing_7bbd5b: 'Magsimula nang libre',
      landing_1ea899: 'Tingnan ang demo',
      landing_4c1fc3: 'Sumasagot ang AI',
      landing_af3947: ' — ikaw ang magpapasya sa gagawin.',
      landing_5f6b64: 'Magtanong sa simpleng salita at tutulungan ka ng ChartControl AI na markahan ang support/resistance, trend lines at mga indicator sa chart na tinitingnan mo, gamit ang live na market data. Draft lang ang lahat na ikaw ang gumagawa at nagpapasya — isa itong charting tool, hindi payo sa investment.',
      landing_44cbb3: 'Malayang i-drag at i-resize · 7 preset (Standard / Scalper / Multi / AI at iba pa)',
      landing_40f668: 'Pag-apruba ng AI ≠ pagsumite ng order · 9-gate risk check · laging nakikita ang simulation stripe',
      landing_69704c: 'Mood tags · performance ayon sa oras ng araw · automatic na pag-detect ng pattern',
      landing_1351e7: 'Para sa mga nagsisimula',
      landing_74f8f5: 'Para sa full-time traders',
      landing_b7f95d: 'Institutional · high frequency',
      landing_b8adca: 'Magsimula nang libre',
      landing_0077f3: 'Simulan ang Pro',
      landing_531f6a: 'Makipag-ugnayan sa amin',
      landing_0fc1ee: 'Contact',
      landing_04b7df: '/buwan',
      landing_9c7f54: '5 paboritong symbol',
      landing_4f403f: 'Lahat ng symbol',
      landing_724991: 'AI chart tools · 5 kada araw',
      landing_6e9bb1: 'AI chart tools · walang limitasyon',
      landing_8466e2: 'Pangunahing indicator',
      landing_d3219e: 'Pangunahing trading',
      landing_bc5424: 'Multi-chart',
      landing_c3d5f3: 'Advanced order types',
      landing_1a4272: 'Strategy backtesting',
      landing_91e9d6: 'Real-time alerts',
      landing_633158: 'Dedicated manager',
      landing_6587f1: 'Dedicated API',
      landing_860f96: 'Negosasyon sa fee',
      landing_0af146: 'On-premise option',

      // --- 404 ---
      not_found_eeedd6: 'Hindi namin nahanap ang page na iyon',
      not_found_9acdbe: 'Maaaring mali ang address o inalis na ang page.',
      not_found_e62d56: 'Subukan ang isa sa mga page na ito:',
      not_found_e87cf6: 'Trade →',
      not_found_7f5914: 'Markets',
      not_found_d9477a: 'Portfolio',
      not_found_1c767f: 'Landing page →',
    },
    { label: 'Filipino', bcp47: 'fil-PH' },
  );
})();
