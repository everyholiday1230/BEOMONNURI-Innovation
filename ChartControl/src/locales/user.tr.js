/* ============================================================
   Türkçe — 사용자 화면 (pages-user.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {brand} {msg} 치환자는 그대로 남긴다.
   ★ {brand} 뒤에 격조사를 직접 붙이지 않는다 — 모음 조화가 브랜드명에 따라 달라진다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'tr',
    {
      // --- Analytics: AI 인사이트 ---
      analytics_19b9a2: 'Yapay zeka sinyallerine dayalı işlemler, kendi kararıyla yapılan işlemlerden belirgin biçimde daha iyi sonuç veriyor.',
      analytics_c511d6: '✓ Öğleden sonra seansı daha iyi sonuç veriyor',
      analytics_4b3b6f: '12:00–16:00 UTC arasındaki işlemlerin ortalama PnL’i diğer saatlerden %34 daha yüksek.',
      analytics_d6aabf: '⚠ Tedirginken yapılan işlemler %40 oranında zararla kapanıyor',
      analytics_4fa8b3: 'Ruh hali "tedirgin" iken pozisyon açmak zarar olasılığını 2,3 kat artırıyor.',

      // --- Notifications ---
      notifications_f53a6e: 'Filtre',
      notifications_f6bc37: 'Tümünü okundu işaretle',

      // --- Order history ---
      order_history_ea8391: 'Tüm emirler · açık · gerçekleşen · iptal edilen',

      // --- Wallet ---
      wallet_ed546c: 'Borsa bağlantıları',
      wallet_95195c: 'Desteklenen borsalar · API key yönetimi · varlıklar · yatırma ve çekme',
      wallet_ea90da: '🎁 {brand} iş ortağı borsalar',
      wallet_ceef92: 'Aşağıdaki borsalar iş ortaklarımızdır ve şunları sunar: ',
      wallet_cbe9e9: 'komisyon iadesi ve hoş geldin bonusu',
      wallet_fc0c97: '. Referans bağlantısından kayıt olun, bir API key oluşturun ve bu sayfada bağlayın.',
      wallet_ecb4cc: 'Kayıt ol',
      wallet_f23807: 'Varlık bakiyeleri',
      wallet_b9ca11: 'Yatır',
      wallet_972169: 'Çek',
      wallet_57177e: 'Yatırma sayfasına git →',
      wallet_d3cdff: 'Çekme sayfasına git →',

      // --- Settings: 탭 ---
      settings_2d430b: 'Profil · güvenlik · bildirimler · API key’ler · erişilebilirlik',
      settings_14fab1: 'Profil',
      settings_cfaa68: 'Güvenlik · 2FA',
      settings_e29d14: 'Bildirimler',
      settings_643822: 'Tercihler',
      settings_3a4173: 'Erişilebilirlik',
      settings_5a4346: 'Hesap',

      // --- Settings: 프로필 ---
      settings_0d64b7: 'Profil bilgileri',
      settings_b7909f: 'Fotoğrafı değiştir',
      settings_9aa18e: 'Ad',
      settings_3c3776: 'E-posta',
      settings_84b6d0: 'Ülke',
      settings_76245e: 'Saat dilimi',
      settings_6e081b: 'Korece',
      settings_1f1712: 'Kaydet',
      settings_19b2d1: 'İptal',

      // --- Settings: 보안 ---
      settings_965a8c: 'Şifre ve 2FA',
      settings_819738: 'Şifre',
      settings_9074af: 'En son 63 gün önce değiştirildi',
      settings_ce0109: 'Değiştir',
      settings_a5d18c: 'İki adımlı doğrulama (TOTP)',
      settings_e33c1f: '✓ Etkin · Google Authenticator',
      settings_ee3963: 'Sıfırla',
      settings_872543: 'SMS doğrulama',
      settings_4bd28a: 'Oturumlar',
      settings_2ac6ff: '3 etkin oturum',
      settings_b7a78a: 'Geçerli oturum',
      settings_3c8a15: '2 gün önce · ⚠ farklı konum',
      settings_cafdc6: 'Sonlandır',
      settings_8eb853: 'Bağlı borsa API key’leri · izinler · IP kısıtlamaları',

      // --- Settings: 알림 ---
      settings_16930c: 'Bildirim ayarları',
      settings_b83309: 'Yapay zeka sinyali oluştu',
      settings_37397b: 'Emir gerçekleşti · iptal edildi',
      settings_716902: 'Marjin · likidasyon uyarıları',
      settings_15d236: 'Duyurular',
      settings_2207de: 'Kampanyalar · etkinlikler',

      // --- Settings: 접근성 ---
      settings_12d487: 'Hareketi azalt',
      settings_dc3d8a: 'Animasyon ve geçişleri en aza indir (WCAG 2.3.3)',
      settings_02bb1c: 'Yüksek kontrast',
      settings_a63c4a: 'Daha güçlü renk kontrastı (WCAG AAA)',
      settings_a5d169: 'Renk körlüğü desteği',
      settings_3f9048: 'Long/short’u desen ve simgelerle de göster',
      settings_c56d3c: 'Büyük yazı',
      settings_bbb99f: 'Tüm yazı boyutlarını %20 büyüt',
      settings_816538: 'Belirgin odak çerçevesi',
      settings_fa2fee: '2px → 3px çerçeve · renk vurgusu',
      settings_c35257: 'Yalnızca klavye modu',
      settings_4599e3: 'Fare olmadan her özelliğe erişin',
      settings_625fc6: 'Ekran okuyucu iyileştirmesi',
      settings_da0cf0: 'Geliştirilmiş ARIA etiketleri · gezinme sırası yeniden düzenlendi',
      settings_a2d19e: 'Varsayılanlara dön',

      // --- Settings: 데이터 / 계정 ---
      settings_be6117: 'Veri yönetimi',
      settings_2508a1: 'Verileri indir (GDPR)',
      settings_d15b63: 'Hesap, işlemler ve ayarların tam JSON dışa aktarımı',
      settings_74e36c: 'Talep et',
      settings_0207e4: 'API kullanım kaydını indir',
      settings_c523ec: 'Son 90 gün · CSV',
      settings_f1d559: '⚠ Riskli alan',
      settings_7cbf79: 'Hesabı askıya al',
      settings_4957e1: '90 güne kadar devre dışı bırak · sonra yeniden etkinleştirilebilir',
      settings_340d4e: 'Askıya al',
      settings_009e27: 'Hesabı kalıcı olarak sil',
      settings_560adc: 'Tüm verileri siler · geri alınamaz · 2FA + e-posta onayı gerekir',
      settings_254a82: 'Silme talebi',

      wal_revoke_confirm: 'Bu API key iptal edilsin mi? Emir gönderimi ve bakiye okuma hemen duracak. Geri alınamaz — sonrasında yeni bir key bağlayabilirsiniz.',
      wal_revoke_failed: 'Key iptal edilemedi: {msg}. Hâlâ etkin — tekrar deneyin veya borsadan kaldırın.',

      strat_needs_key: 'Bunu kullanmak için bir borsa API key bağlayın — bunlar örnek stratejilerdir.',
    },
    { label: 'Türkçe', bcp47: 'tr' },
  );
})();
