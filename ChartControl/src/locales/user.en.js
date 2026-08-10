/* ============================================================
   English — 사용자 화면 (pages-user.jsx) 사전
   ------------------------------------------------------------
   기준 언어. 다른 언어에서 키가 빠지면 이 값으로 폴백한다.
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'en',
    {
      // --- Analytics: AI 인사이트 ---
      analytics_171e3e: '🎯 AI signal win rate 82%',
      analytics_19b9a2: 'Trades based on AI signals significantly outperform discretionary trades.',
      analytics_c511d6: '✓ Afternoon session outperforms',
      analytics_4b3b6f: 'Trades between 12:00–16:00 UTC average 34% higher PnL than other hours.',
      analytics_d6aabf: '⚠ Nervous trades lose 40% of the time',
      analytics_4fa8b3: "Entering while mood is 'nervous' raises loss probability by 2.3×.",

      // --- Notifications ---
      notifications_f53a6e: 'Filter',
      notifications_f6bc37: 'Mark all read',

      // --- Order history ---
      order_history_ea8391: 'All orders · open · filled · cancelled',

      // --- Wallet ---
      wallet_ed546c: 'Exchange connections',
      wallet_95195c: 'Supported exchanges · API key management · assets · deposits and withdrawals',
      wallet_ea90da: '🎁 {brand} partner exchanges',
      wallet_ceef92: 'The exchanges below are our partners and offer ',
      wallet_cbe9e9: 'fee rebates and a welcome bonus',
      wallet_fc0c97: '. Sign up through the referral link, create an API key, and connect it on this page.',
      wallet_ecb4cc: 'Sign up',
      wallet_f23807: 'Asset balances',
      wallet_b9ca11: 'Deposit',
      wallet_972169: 'Withdraw',
      wallet_57177e: 'Go to deposit →',
      wallet_d3cdff: 'Go to withdrawal →',

      // --- Settings: 탭 ---
      settings_2d430b: 'Profile · security · notifications · API keys · accessibility',
      settings_14fab1: 'Profile',
      settings_cfaa68: 'Security · 2FA',
      settings_e29d14: 'Notifications',
      settings_643822: 'Preferences',
      settings_3a4173: 'Accessibility',
      settings_5a4346: 'Account',

      // --- Settings: 프로필 ---
      settings_0d64b7: 'Profile details',
      settings_b7909f: 'Change photo',
      settings_9aa18e: 'Name',
      settings_3c3776: 'Email',
      settings_84b6d0: 'Country',
      settings_76245e: 'Time zone',
      settings_6e081b: 'Korean',
      settings_1f1712: 'Save',
      settings_19b2d1: 'Cancel',

      // --- Settings: 보안 ---
      settings_965a8c: 'Password & 2FA',
      settings_819738: 'Password',
      settings_9074af: 'Last changed 63 days ago',
      settings_ce0109: 'Change',
      settings_a5d18c: 'Two-factor authentication (TOTP)',
      settings_e33c1f: '✓ Enabled · Google Authenticator',
      settings_ee3963: 'Reset',
      settings_872543: 'SMS verification',
      settings_4bd28a: 'Login sessions',
      settings_2ac6ff: '3 active sessions',
      settings_b7a78a: 'Current session',
      settings_3c8a15: '2d ago · ⚠ different location',
      settings_cafdc6: 'End',
      settings_8eb853: 'Connected exchange API keys · permissions · IP restrictions',

      // --- Settings: 알림 ---
      settings_16930c: 'Notification settings',
      settings_b83309: 'AI signal generated',
      settings_37397b: 'Order filled · cancelled',
      settings_716902: 'Margin · liquidation warnings',
      settings_15d236: 'Announcements',
      settings_2207de: 'Promotions · events',

      // --- Settings: 접근성 ---
      settings_12d487: 'Reduce motion',
      settings_dc3d8a: 'Minimize animations and transitions (WCAG 2.3.3)',
      settings_02bb1c: 'High contrast',
      settings_a63c4a: 'Stronger colour contrast (WCAG AAA)',
      settings_a5d169: 'Colour-blind support',
      settings_3f9048: 'Show long/short with patterns and icons as well',
      settings_c56d3c: 'Large text',
      settings_bbb99f: 'Increase all font sizes by 20%',
      settings_816538: 'Strong focus ring',
      settings_fa2fee: '2px → 3px outline · colour emphasis',
      settings_c35257: 'Keyboard-only mode',
      settings_4599e3: 'Reach every feature without a mouse',
      settings_625fc6: 'Screen reader optimisation',
      settings_da0cf0: 'Enhanced ARIA labels · reordered traversal',
      settings_a2d19e: 'Restore defaults',

      // --- Settings: 데이터 / 계정 ---
      settings_be6117: 'Data management',
      settings_2508a1: 'Download data (GDPR)',
      settings_d15b63: 'Full JSON export of account, trades and settings',
      settings_74e36c: 'Request',
      settings_0207e4: 'Download API usage log',
      settings_c523ec: 'Last 90 days · CSV',
      settings_f1d559: '⚠ Danger zone',
      settings_7cbf79: 'Suspend account',
      settings_4957e1: 'Deactivate for up to 90 days · can be reactivated later',
      settings_340d4e: 'Suspend',
      settings_009e27: 'Delete account permanently',
      settings_560adc: 'Erases all data · not recoverable · requires 2FA + email confirmation',
      settings_254a82: 'Request deletion',
    },
    { label: 'English', bcp47: 'en-US' },
  );
})();
