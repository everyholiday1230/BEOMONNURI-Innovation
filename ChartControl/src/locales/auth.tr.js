/* ============================================================
   Türkçe — 인증 화면 (pages-auth.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.

   ★ 빠진 키는 i18n 이 en 으로 자동 폴백한다.
   ★ {brand} {step} {total} {email} 치환자는 그대로 남긴다.
   ★★ {brand} 뒤에 터키어 격조사를 직접 붙이지 않는다 — 브랜드명에 따라 모음
     조화가 달라져 틀린 형태가 나온다. 어순을 바꿔 조사를 피한다.
   ★ SPK(터키 자본시장위원회) 규제상 수익·성과를 암시하는 표현을 넣지 않는다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'tr',
    {
      // --- 공용 푸터 / 브랜드 패널 ---
      auth_3b9e30: 'Koşullar',
      auth_d629d0: 'Gizlilik',
      auth_a5e5da: 'Güvenlik',
      auth_e2654a: 'Yardım',
      auth_77edb5: 'Herhangi bir grafik hakkında soru sorun.',
      auth_9ab22f: 'her emrin kontrolü sizde kalır.',
      auth_7e2510:
        '{brand} bir grafik analizi yazılımıdır. Bir grafik hakkında gündelik dille soru sorun; yapay zeka '
        + 'göstergelerin ne gösterdiğini açıklar. Harekete geçmeye karar verirseniz emir, siz onayladıktan sonra '
        + 'kendi borsa hesabınızda çalışır. Paranızı saklamıyor, yönetmiyor ve ne satın alacağınızı önermiyoruz.',
      auth_833f52: 'Gündelik dil → çizimleri siz yaparsınız → kendi kurulumunuzu taslaklarsınız',
      auth_66cdd9: 'Sürükleyin, boyutlandırın ve kendi düzeninizi hazır ayar olarak kaydedin',
      auth_2d0495: 'Onaylamak ≠ Göndermek · çok aşamalı risk kontrolü',

      // --- 로그인 ---
      login_e225a6: 'Giriş yap',
      login_3f05db: '{brand} hesabınıza giriş yapın',
      login_92c6f3: 'Şifremi unuttum',
      login_a89650: 'Bu cihazı hatırla (30 gün)',
      login_33c1f7: 'Doğrulanıyor…',
      login_e2d231: 'Giriş yap →',
      login_46bed0: 'veya',
      login_68a92d: 'Hesabınız yok mu?',
      login_49f561: 'Kayıt ol →',
      login_13d6ae: 'Uygulamaya girmek için herhangi bir e-posta ve şifre, ardından herhangi bir 6 haneli 2FA kodu girin',
      login_241c96: 'Doğrula →',
      login_f3047a: 'Kod gelmedi mi?',
      login_6adb8b: 'SMS ile yeniden gönder',
      login_f787eb: '← Geri',

      // --- 회원가입 ---
      signup_ecb4cc: 'Hesap oluştur',
      signup_a6f945: 'Yaklaşık bir dakika sürer',
      signup_1ff941: 'Hesap',
      signup_32b217: 'E-posta',
      signup_d284fa: 'KYC',
      signup_10c83d: 'En az 10 karakter',
      signup_711154: 'Şifreyi yeniden girin',
      signup_5ca401: 'Şifre en az 8 karakter olmalıdır',
      signup_dd3243: 'Şifreler eşleşmiyor',
      signup_591c17: 'Çok zayıf',
      signup_24bb15: 'Zayıf',
      signup_2179da: 'Orta',
      signup_5f67e6: 'Güçlü',
      signup_dff519: 'Çok güçlü',
      signup_b329a3: '🇰🇷 Güney Kore',
      signup_44650a: 'Diğer',
      signup_75a112: 'Kabul ediyorum (zorunlu)',
      signup_532136: 'Gizlilik Politikası',
      signup_21e2e3: 'Pazarlama e-postaları almak istiyorum (isteğe bağlı)',
      signup_24cd06: 'İşleniyor…',
      signup_3929bb: 'Hesap oluştur →',
      signup_9922a0: 'Zaten hesabınız var mı?',

      // --- 이메일 인증 ---
      email_verify_5eb00e: 'E-posta adresinize bir doğrulama bağlantısı gönderdik. Doğrulamak için bağlantıyı açın, ardından giriş yapın.',
      email_verify_0fa353: 'Gelmezse spam klasörünüzü kontrol edin.',
      email_verify_37a414: 'Yeniden gönder',
      email_verify_089bb3: '✓ Yeniden gönderildi',
      email_verify_455f7c: 'Devam →',

      // --- KYC ---
      k_y_c_onboarding_5f6780: 'Kimlik doğrulama (KYC)',
      k_y_c_onboarding_9334ed: '👤 Temel bilgiler',
      k_y_c_onboarding_31fbff: 'Doğum tarihi',
      k_y_c_onboarding_ff63ca: 'Uyruk',
      k_y_c_onboarding_c22557: 'Seçin',
      k_y_c_onboarding_ebce71: '🏠 Adres',
      k_y_c_onboarding_dad291: 'Adres satırı 2',
      k_y_c_onboarding_02220b: 'Adres belgesi bir sonraki adımda yüklenir.',
      k_y_c_onboarding_8ff495: '🪪 Kimlik belgesi · selfie',
      k_y_c_onboarding_3f327d: 'Kimlik belgesi türünü seçin.',
      k_y_c_onboarding_3ba1d5: 'Nüfus cüzdanı / kimlik kartı',
      k_y_c_onboarding_311122: 'Sürücü belgesi',
      k_y_c_onboarding_8e5bec: 'Pasaport',
      k_y_c_onboarding_26c302: 'Kimliğin ön yüzü',
      k_y_c_onboarding_2b9e56: 'Kimliğin arka yüzü',
      k_y_c_onboarding_f8bbc7: 'Pasaport için gerekli değil',
      k_y_c_onboarding_51672c: 'Yükle',
      k_y_c_onboarding_6cfe7d: 'JPG · PNG · PDF (en fazla 10MB)',
      k_y_c_onboarding_de4a5c: 'Canlı selfie',
      k_y_c_onboarding_90745c: 'Yüzünüzü kimliğinizle birlikte çekin',
      k_y_c_onboarding_e07e2e: 'Kamerayı aç',
      k_y_c_onboarding_0f797f: '📋 Fon kaynağı · amaç',
      k_y_c_onboarding_f01127: 'Fon kaynağı',
      k_y_c_onboarding_edd43e: 'Ücret geliri',
      k_y_c_onboarding_7fb985: 'Ticari gelir',
      k_y_c_onboarding_f27c14: 'Yatırım getirileri',
      k_y_c_onboarding_98ae59: 'Birikim',
      k_y_c_onboarding_7340b7: 'Miras veya bağış',
      k_y_c_onboarding_898ed0: 'İşlem amacı',
      k_y_c_onboarding_aa6c8f: 'Uzun vadeli yatırım',
      k_y_c_onboarding_e18ea9: 'Spekülasyon · kısa vadeli kazanç',
      k_y_c_onboarding_5d5aea: 'Korunma · risk yönetimi',
      k_y_c_onboarding_d66780: 'Arbitraj',
      k_y_c_onboarding_810016: '← Geri',
      k_y_c_onboarding_c5798c: 'İleri →',
      k_y_c_onboarding_4f67fa: 'İncelemeye gönder →',
      k_y_c_onboarding_dc301f: 'İncelemeye gönderildi',
      k_y_c_onboarding_2ecb11: 'KYC gönderildi 🎉',
      k_y_c_onboarding_55af46: '1-24 saat içinde onaylanır · e-posta ile bilgilendirilirsiniz',
      k_y_c_onboarding_03e1e5: 'Uygulamayı başlat →',
      kyc_step_progress: 'Adım {step} / {total} · yaklaşık 3-5 dk',

      // --- 비밀번호 재설정 ---
      password_reset_8d8082: 'Şifreyi sıfırla',
      password_reset_d196c8: 'Kayıtlı adresinize bir sıfırlama bağlantısı göndereceğiz',
      password_reset_7badb1: 'Sıfırlama bağlantısı gönder →',
      password_reset_5ee6ba: '← Girişe dön',
      password_reset_d09993: 'E-posta gönderildi',
      password_reset_a40b90: 'Girişe git →',
      pwreset_link_sent: 'Sıfırlama bağlantısı {email} adresine gönderildi.',

      // --- 랜딩 ---
      landing_66a662: 'Biz bir yazılım şirketiyiz. Paranızı saklamıyoruz, yönetmiyoruz ve ne satın alacağınızı söylemiyoruz.',
      landing_7bbd5b: 'Ücretsiz başla',
      landing_1ea899: 'Demoyu gör',
      landing_hero_line1: 'Grafiğe gözlerinizi kısmayı bırakın.',
      landing_4c1fc3: 'Sadece sorun.',
      landing_af3947: ' AI ekranda işaretler.',
      landing_5f6b64: 'ChartControl AI’a ne görmek istediğinizi söyleyin; önünüzdeki grafiğe destek, direnç, trend çizgileri ve göstergeleri işaretler. Seviyeler sizin, karar sizin — dakikalar değil saniyeler içinde.',
      landing_44cbb3: '96 kolonlu ızgarada sürükleyip yeniden boyutlandırın · 4 hazır düzen (Standard Trader / AI Workspace / Chart Focus / Scalper)',
      landing_40f668: 'AI onayı ≠ emir gönderimi · 17 aşamalı risk kontrolü · işlem modu şeridi her zaman görünür',
      landing_69704c: 'Duygu etiketleri · serbest notlar · günlük kâr ve zarar',
      landing_1351e7: 'Yeni başlayanlar için',
      landing_74f8f5: 'Tam zamanlı yatırımcılar için',
      landing_b7f95d: 'Kurumsal · yüksek frekans',
      landing_b8adca: 'Ücretsiz başla',
      landing_0077f3: "Pro'ya başla",
      landing_531f6a: 'Bize ulaşın',
      landing_0fc1ee: 'İletişim',
      landing_04b7df: '/ay',
      landing_9c7f54: '5 favori sembol',
      landing_4f403f: 'Tüm semboller',
      landing_724991: 'Yapay zeka grafik araçları · günde 5',
      landing_6e9bb1: 'Yapay zeka grafik araçları · sınırsız',
      landing_8466e2: 'Temel göstergeler',
      landing_d3219e: 'Temel işlem',
      landing_bc5424: 'Çoklu grafik',
      landing_c3d5f3: 'Gelişmiş emir türleri',
      landing_1a4272: 'Strateji geriye dönük testi',
      landing_91e9d6: 'Gerçek zamanlı uyarılar',
      landing_633158: 'Özel müşteri yöneticisi',
      landing_6587f1: 'Özel API',
      landing_860f96: 'Komisyon görüşmesi',
      landing_0af146: 'On-premise seçeneği',

      // --- 404 ---
      not_found_eeedd6: 'Bu sayfayı bulamadık',
      not_found_9acdbe: 'Adres yanlış olabilir veya sayfa kaldırılmış olabilir.',
      not_found_e62d56: 'Şu sayfalardan birini deneyin:',
      not_found_e87cf6: 'İşlem →',
      not_found_7f5914: 'Piyasalar',
      not_found_d9477a: 'Portföy',
      not_found_1c767f: 'Ana sayfa →',
    },
    { label: 'Türkçe', bcp47: 'tr' },
  );
})();
