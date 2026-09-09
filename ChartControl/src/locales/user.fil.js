/* ============================================================
   Filipino — 사용자 화면 (pages-user.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {brand} {msg} 치환자는 그대로 남긴다.
   ★ 금융·기술 용어는 영어를 유지한다(Taglish) — 실제 사용 형태에 맞춘다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'fil',
    {
      // --- Analytics: AI 인사이트 ---
      analytics_19b9a2: 'Ang mga trade na batay sa AI signals ay malinaw na mas mahusay kumpara sa mga trade na sariling pasya.',
      analytics_c511d6: '✓ Mas mahusay ang hapon na sesyon',
      analytics_4b3b6f: 'Ang mga trade sa pagitan ng 12:00–16:00 UTC ay may average na PnL na 34% na mas mataas kaysa sa ibang oras.',
      analytics_d6aabf: '⚠ Ang mga trade na ginawa sa kaba ay lumulugi 40% ng panahon',
      analytics_4fa8b3: 'Ang pag-enter habang "kinakabahan" ang mood ay nagpapataas ng tsansa ng pagkalugi ng 2.3×.',

      // --- Notifications ---
      notifications_f53a6e: 'Filter',
      notifications_f6bc37: 'Markahang lahat bilang nabasa',

      // --- Order history ---
      order_history_ea8391: 'Lahat ng order · bukas · napunan · kanselado',

      // --- Wallet ---
      wallet_ed546c: 'Mga koneksyon sa exchange',
      wallet_95195c: 'Mga suportadong exchange · pamamahala ng API key · assets · deposito at withdrawal',
      wallet_ea90da: '🎁 Mga partner exchange ng {brand}',
      wallet_ceef92: 'Ang mga exchange sa ibaba ay partner namin at nag-aalok ng ',
      wallet_cbe9e9: 'fee rebate at welcome bonus',
      wallet_fc0c97: '. Mag-sign up sa referral link, gumawa ng API key, at ikonekta ito sa page na ito.',
      wallet_ecb4cc: 'Mag-sign up',
      wallet_f23807: 'Mga balanse ng asset',
      wallet_b9ca11: 'Magdeposito',
      wallet_972169: 'Mag-withdraw',
      wallet_57177e: 'Pumunta sa deposito →',
      wallet_d3cdff: 'Pumunta sa withdrawal →',

      // --- Settings: 탭 ---
      settings_2d430b: 'Profile · seguridad · notipikasyon · API keys · accessibility',
      settings_14fab1: 'Profile',
      settings_cfaa68: 'Seguridad · 2FA',
      settings_e29d14: 'Mga notipikasyon',
      settings_643822: 'Mga preference',
      settings_3a4173: 'Accessibility',
      settings_5a4346: 'Account',

      // --- Settings: 프로필 ---
      settings_0d64b7: 'Mga detalye ng profile',
      settings_b7909f: 'Palitan ang larawan',
      settings_9aa18e: 'Pangalan',
      settings_3c3776: 'Email',
      settings_84b6d0: 'Bansa',
      settings_76245e: 'Time zone',
      settings_6e081b: 'Koreano',
      settings_1f1712: 'I-save',
      settings_19b2d1: 'Kanselahin',

      // --- Settings: 보안 ---
      settings_965a8c: 'Password at 2FA',
      settings_819738: 'Password',
      settings_9074af: 'Huling binago 63 araw na ang nakalipas',
      settings_ce0109: 'Baguhin',
      settings_a5d18c: 'Two-factor authentication (TOTP)',
      settings_e33c1f: '✓ Aktibo · Google Authenticator',
      settings_ee3963: 'I-reset',
      settings_872543: 'SMS verification',
      settings_4bd28a: 'Mga login session',
      settings_2ac6ff: '3 aktibong session',
      settings_b7a78a: 'Kasalukuyang session',
      settings_3c8a15: '2 araw ang nakalipas · ⚠ ibang lokasyon',
      settings_cafdc6: 'Tapusin',
      settings_8eb853: 'Mga nakakonektang exchange API key · permiso · restriksyon sa IP',

      // --- Settings: 알림 ---
      settings_16930c: 'Mga setting ng notipikasyon',
      settings_b83309: 'May nabuong AI signal',
      settings_37397b: 'Order napunan · kanselado',
      settings_716902: 'Mga babala sa margin · liquidation',
      settings_15d236: 'Mga anunsyo',
      settings_2207de: 'Mga promo · event',

      // --- Settings: 접근성 ---
      settings_12d487: 'Bawasan ang galaw',
      settings_dc3d8a: 'Bawasan ang animation at transition (WCAG 2.3.3)',
      settings_02bb1c: 'Mataas na contrast',
      settings_a63c4a: 'Mas malakas na contrast ng kulay (WCAG AAA)',
      settings_a5d169: 'Suporta sa color blindness',
      settings_3f9048: 'Ipakita ang long/short gamit din ang pattern at icon',
      settings_c56d3c: 'Malaking teksto',
      settings_bbb99f: 'Palakihin ang lahat ng font size ng 20%',
      settings_816538: 'Malinaw na focus ring',
      settings_fa2fee: '2px → 3px outline · pagbibigay-diin sa kulay',
      settings_c35257: 'Keyboard-only mode',
      settings_4599e3: 'Maabot ang lahat ng feature nang walang mouse',
      settings_625fc6: 'Optimisasyon para sa screen reader',
      settings_da0cf0: 'Pinahusay na ARIA labels · muling isinaayos na pagkakasunod-sunod',
      settings_a2d19e: 'Ibalik sa default',

      // --- Settings: 데이터 / 계정 ---
      settings_be6117: 'Pamamahala ng data',
      settings_2508a1: 'I-download ang data (GDPR)',
      settings_d15b63: 'Buong JSON export ng account, mga trade at setting',
      settings_74e36c: 'Humiling',
      settings_0207e4: 'I-download ang API usage log',
      settings_c523ec: 'Huling 90 araw · CSV',
      settings_f1d559: '⚠ Delikadong bahagi',
      settings_7cbf79: 'I-suspend ang account',
      settings_4957e1: 'I-deactivate hanggang 90 araw · maaaring i-activate muli mamaya',
      settings_340d4e: 'I-suspend',
      settings_009e27: 'Permanenteng burahin ang account',
      settings_560adc: 'Binubura ang lahat ng data · hindi na maibabalik · kailangan ng 2FA + kumpirmasyon sa email',
      settings_254a82: 'Humiling ng pagbura',

      wal_revoke_confirm: 'I-revoke ang API key na ito? Titigil agad ang pagsumite ng order at pagbasa ng balanse. Hindi na ito maibabalik — makakakonekta ka ng bagong key pagkatapos.',
      wal_revoke_failed: 'Hindi na-revoke ang key: {msg}. Aktibo pa ito — subukan muli, o alisin ito sa exchange.',

      strat_needs_key: 'Ikonekta ang exchange API key para magamit ito — mga halimbawang strategy lang ang mga ito.',
    },
    { label: 'Filipino', bcp47: 'fil-PH' },
  );
})();
