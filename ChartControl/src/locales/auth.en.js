/* ============================================================
   English — 인증 화면 (pages-auth.jsx) 사전
   ------------------------------------------------------------
   해외 우선 출시이므로 이 파일이 기준이다. 다른 언어에서 키가 빠지면
   자동으로 이 값으로 폴백한다.

   키는 tools/i18n-extract.py 가 (컴포넌트 + 내용 해시)로 생성한 것이며
   바꾸지 않는다. 번역 작업자는 값만 고친다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'en',
    {
      // --- 공용 푸터 / 브랜드 패널 ---
      auth_3b9e30: 'Terms',
      auth_d629d0: 'Privacy',
      auth_a5e5da: 'Security',
      auth_e2654a: 'Help',
      auth_77edb5: 'Study your chart by conversation,',
      auth_9ab22f: 'execute with one approval.',
      auth_7e2510:
        '{brand} brings Bloomberg-grade information density and an AI Copilot into a single language. '
        + 'Ask for analysis in plain words as if drawing on the chart, then move through signal → draft → risk check → execution on a safe pipeline.',
      auth_833f52: 'Plain language → you draw overlays → draft your own setup',
      auth_66cdd9: 'Drag, resize and preset your own layout',
      auth_2d0495: 'Approve ≠ Submit · multi-stage risk check',

      // --- 로그인 ---
      login_e225a6: 'Sign in',
      login_3f05db: 'Sign in to your {brand} account',
      login_92c6f3: 'Forgot password',
      login_a89650: 'Remember this device (30 days)',
      login_33c1f7: 'Verifying…',
      login_e2d231: 'Sign in →',
      login_46bed0: 'or',
      login_68a92d: "Don't have an account?",
      login_49f561: 'Sign up →',
      login_13d6ae: 'Enter any email and password, then any 6-digit 2FA code to enter the app',
      login_241c96: 'Verify →',
      login_f3047a: "Didn't get the code?",
      login_6adb8b: 'Resend via SMS',
      login_f787eb: '← Back',

      // --- 회원가입 ---
      signup_ecb4cc: 'Create account',
      signup_a6f945: 'It takes about a minute',
      signup_1ff941: 'Account',
      signup_32b217: 'Email',
      signup_d284fa: 'KYC',
      signup_10c83d: 'At least 10 characters',
      signup_711154: 'Re-enter password',
      signup_5ca401: 'Password must be at least 8 characters',
      signup_dd3243: 'Passwords do not match',
      signup_591c17: 'Very weak',
      signup_24bb15: 'Weak',
      signup_2179da: 'Fair',
      signup_5f67e6: 'Strong',
      signup_dff519: 'Very strong',
      signup_b329a3: '🇰🇷 South Korea',
      signup_44650a: 'Other',
      signup_75a112: 'I agree (required)',
      signup_532136: 'Privacy Policy',
      signup_21e2e3: 'Receive marketing emails (optional)',
      signup_24cd06: 'Processing…',
      signup_3929bb: 'Create account →',
      signup_9922a0: 'Already have an account?',

      // --- 이메일 인증 ---
      email_verify_5eb00e: 'We sent a verification link to your email address. Open it to verify, then sign in.',
      email_verify_0fa353: "If it doesn't arrive, check your spam folder.",
      email_verify_37a414: 'Resend',
      email_verify_089bb3: '✓ Resent',
      email_verify_455f7c: 'Continue →',

      // --- KYC ---
      k_y_c_onboarding_5f6780: 'Identity verification (KYC)',
      k_y_c_onboarding_9334ed: '👤 Basic information',
      k_y_c_onboarding_31fbff: 'Date of birth',
      k_y_c_onboarding_ff63ca: 'Nationality',
      k_y_c_onboarding_c22557: 'Select',
      k_y_c_onboarding_ebce71: '🏠 Address',
      k_y_c_onboarding_dad291: 'Address line 2',
      k_y_c_onboarding_02220b: 'Proof of address is uploaded in the next step.',
      k_y_c_onboarding_8ff495: '🪪 ID document · selfie',
      k_y_c_onboarding_3f327d: 'Choose your ID type.',
      k_y_c_onboarding_3ba1d5: 'National ID card',
      k_y_c_onboarding_311122: "Driver's licence",
      k_y_c_onboarding_8e5bec: 'Passport',
      k_y_c_onboarding_26c302: 'ID front',
      k_y_c_onboarding_2b9e56: 'ID back',
      k_y_c_onboarding_f8bbc7: 'Not required for passport',
      k_y_c_onboarding_51672c: 'Upload',
      k_y_c_onboarding_6cfe7d: 'JPG · PNG · PDF (max 10MB)',
      k_y_c_onboarding_de4a5c: 'Live selfie',
      k_y_c_onboarding_90745c: 'Capture your face together with your ID',
      k_y_c_onboarding_e07e2e: 'Open camera',
      k_y_c_onboarding_0f797f: '📋 Source of funds · purpose',
      k_y_c_onboarding_f01127: 'Source of funds',
      k_y_c_onboarding_edd43e: 'Employment income',
      k_y_c_onboarding_7fb985: 'Business income',
      k_y_c_onboarding_f27c14: 'Investment returns',
      k_y_c_onboarding_98ae59: 'Savings',
      k_y_c_onboarding_7340b7: 'Inheritance or gift',
      k_y_c_onboarding_898ed0: 'Trading purpose',
      k_y_c_onboarding_aa6c8f: 'Long-term investment',
      k_y_c_onboarding_e18ea9: 'Speculation · short-term gains',
      k_y_c_onboarding_5d5aea: 'Hedging · risk management',
      k_y_c_onboarding_d66780: 'Arbitrage',
      k_y_c_onboarding_810016: '← Back',
      k_y_c_onboarding_c5798c: 'Next →',
      k_y_c_onboarding_4f67fa: 'Submit for review →',
      k_y_c_onboarding_dc301f: 'Submitted for review',
      k_y_c_onboarding_2ecb11: 'KYC submitted 🎉',
      k_y_c_onboarding_55af46: 'Approved within 1-24 hours · you will be notified by email',
      k_y_c_onboarding_03e1e5: 'Start the app →',
      kyc_step_progress: 'Step {step} / {total} · about 3-5 min',

      // --- 비밀번호 재설정 ---
      password_reset_8d8082: 'Reset password',
      password_reset_d196c8: "We'll email a reset link to your registered address",
      password_reset_7badb1: 'Send reset link →',
      password_reset_5ee6ba: '← Back to sign in',
      password_reset_d09993: 'Email sent',
      password_reset_a40b90: 'Go to sign in →',
      pwreset_link_sent: 'Reset link sent to {email}.',

      // --- 랜딩 ---
      landing_66a662: 'Institutional-grade trading tools for individual traders.',
      landing_7bbd5b: 'Start for free',
      landing_1ea899: 'View demo',
      landing_4c1fc3: 'One approval',
      landing_af3947: 'to execute.',
      landing_5f6b64: 'Ask in plain language and the copilot helps you mark support/resistance, trend lines and indicators on the chart you are viewing, using live market data. Everything is a draft you create and decide on — a charting tool, not investment advice.',
      landing_44cbb3: 'Freely drag and resize · 7 presets (Standard / Scalper / Multi / AI and more)',
      landing_40f668: 'AI approval ≠ order submission · 9-gate risk check · simulation stripe always visible',
      landing_69704c: 'Mood tags · performance by time of day · automatic pattern detection',
      landing_1351e7: 'For beginners',
      landing_74f8f5: 'For full-time traders',
      landing_b7f95d: 'Institutional · high frequency',
      landing_b8adca: 'Start free',
      landing_0077f3: 'Start Pro',
      landing_531f6a: 'Contact us',
      landing_0fc1ee: 'Contact',
      landing_04b7df: '/mo',
      landing_9c7f54: '5 favorite symbols',
      landing_4f403f: 'All symbols',
      landing_724991: 'AI chart tools · 5 per day',
      landing_6e9bb1: 'AI chart tools · unlimited',
      landing_8466e2: 'Core indicators',
      landing_d3219e: 'Core trading',
      landing_bc5424: 'Multi-chart',
      landing_c3d5f3: 'Advanced order types',
      landing_1a4272: 'Strategy backtesting',
      landing_91e9d6: 'Real-time alerts',
      landing_633158: 'Dedicated manager',
      landing_6587f1: 'Dedicated API',
      landing_860f96: 'Fee negotiation',
      landing_0af146: 'On-premise option',

      // --- 404 ---
      not_found_eeedd6: "We couldn't find that page",
      not_found_9acdbe: 'The address may be wrong or the page may have been removed.',
      not_found_e62d56: 'Try one of these pages:',
      not_found_e87cf6: 'Trade →',
      not_found_7f5914: 'Markets',
      not_found_d9477a: 'Portfolio',
      not_found_1c767f: 'Landing page →',
    },
    { label: 'English', bcp47: 'en-US' },
  );
})();
