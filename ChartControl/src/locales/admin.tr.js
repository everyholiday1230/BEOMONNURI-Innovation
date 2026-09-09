/* ============================================================
   Türkçe — 관리자 화면 (pages-admin.jsx / pages-admin-more.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {tab} {n} {pending} 치환자는 그대로 남긴다.
   ★ 사람 이름은 표본 데이터다 — 번역하지 않는다. HTML 엔티티(&#10;)는 유지한다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'tr',
    {
      // --- 대시보드 / 목록 부제 ---
      admin_dashboard_0ccafd: 'Canlı platform durumu · anormallikler · risk · yapay zeka · sistem',
      admin_users_3fefdf: 'Ad · e-posta · kimlik ara',
      admin_trades_bc077b: 'Canlı emirler · gerçekleşmeler · anormallik tespiti',
      admin_risk_a1edf2: 'Pozisyon maruziyeti · likidasyon kuyruğu · piyasa riski',
      admin_fees_65feac: 'Komisyon kademeleri · iadeler · kampanyalar · geri ödeme',
      admin_notices_15d236: 'Duyurular',
      admin_notices_11300f: 'Duyuru yayınla · müşteri taleplerini yönet',

      // --- 사용자 상세 ---
      admin_user_detail_106e43: 'Ara · filtrele · CSV dışa aktar',
      admin_user_detail_170f7b: 'Katılım',
      admin_user_detail_22d6d2: '30 günlük hacim',
      admin_user_detail_33103c: 'Kümülatif ücretler',
      admin_user_detail_3f4319: 'Kimlik belgesi',
      admin_user_detail_0057bd: 'KYC belgeleri',
      admin_user_detail_43a4e1: 'Etkinlik kaydı',
      admin_user_detail_8f5d10: 'Etkinlik kaydı · son 20 kayıt',
      admin_user_detail_8797eb: 'İşlem geçmişi',
      admin_user_detail_80a094: 'Alım satım geçmişi',
      admin_user_detail_81922a: 'Pozisyonlar',
      admin_user_detail_40ce13: 'Varlıklar',
      admin_user_detail_e4ec3e: 'Varlıkları görüntüle',
      admin_user_detail_a5e5da: 'Güvenlik',
      admin_user_detail_8dd7e4: 'Güvenlik olayları',
      admin_user_detail_915cf6: 'Operatör notları',
      admin_user_detail_f35682: 'Operatör notu (denetim kaydına işlenir)',
      admin_user_detail_12614e: 'Zaman çizelgesi · toplu görünüm',
      admin_user_detail_d65b24: 'Otomatik hesaplanır',
      admin_user_detail_44650a: 'Diğer',
      admin_user_detail_a43b70: 'KYC inceleme sonucu',
      admin_user_detail_a74a3f: 'KYC yeniden doğrulaması gerekiyor',
      admin_user_detail_851473: 'KYC’yi tekrar talep et',
      admin_user_detail_219da4: 'L3’e yükselt',
      admin_user_detail_afc528: 'Yeniden inceleme talep et',
      admin_user_detail_a1d12d: 'Anormal işlem tespit edildi',
      admin_user_detail_2d003e: 'AML/CTF sorunu',
      admin_user_detail_ca5360: 'Kullanıcı talebi',
      admin_user_detail_63c279: 'Gerekçe',
      admin_user_detail_96330a: 'Mesaj',
      admin_user_detail_941ad1: 'E-posta gönder',
      admin_user_detail_04f2aa: 'Sıfırlama bağlantısını e-postayla gönder',
      admin_user_detail_e03d2f: '2FA’yı sıfırla',
      admin_user_detail_82d3e7: 'Hesabı askıya al',
      admin_user_detail_94cd06: '⚠ Hesabı askıya al',
      admin_user_detail_1d441e: 'Askıya al',
      admin_user_detail_f63bf7: 'Askıyı kaldır',
      admin_user_detail_ebe503: 'Bu kullanıcıyı askıya almak istediğinizden emin misiniz?',
      admin_user_detail_bd464c: 'Askıya alındığında kullanıcı otomatik olarak e-postayla bilgilendirilir ve işlem denetim kaydına işlenir.',
      admin_user_detail_ff8aa0: 'Askıya almayı onayla',
      admin_user_detail_19b2d1: 'İptal',
      admin_user_detail_4def42: 'Kullanıcı askıya alındı (simülasyon)',
      admin_user_tab_data: 'Bu kullanıcı için {tab} verileri gösteriliyor',
      admin_users_subtitle: 'Toplam {n} kullanıcı · KYC · izinler · askıya alma · denetim',

      // --- KYC 심사 ---
      admin_k_y_c_queue_46072a: 'KYC incelemesi',
      admin_k_y_c_queue_d167fe: 'Dohyun Kim',
      admin_kyc_sla: '{pending} beklemede · SLA 24 saat',
      flag_auto_detected: ' · otomatik tespit edildi · ',
      flag_investigate: 'incele',

      // --- 입출금 승인 ---
      admin_deposits_e9e567: 'Yatırma onayı',
      admin_deposits_48f252: 'Yatırma kuyruğu',
      admin_deposits_df0901: 'Zincir üstü yatırmalar · onaylar · AML incelemesi',
      admin_withdrawals_372dac: 'Çekme onayı',
      admin_withdrawals_d336c8: 'Çekme kuyruğu',
      admin_withdrawals_4af6f5: '2FA tamam · bekleyen çekme talepleri',

      // --- 지갑 / 자산 ---
      admin_assets_7c2e10: 'Cüzdanlar · yatırma ve çekme onayı · varlık hareketi',
      admin_assets_16f852: 'Toplam cüzdan bakiyesi (hot / cold)',
      admin_assets_d52d75: 'Yatırma ve çekme onay kuyruğu',
      admin_assets_293d08: 'Varlık hareketi · mutabakat (gece toplu işi)',
      admin_assets_657644: 'AML uyarı filtresi',
      admin_assets_hi_fi_60cb06: 'Cüzdanlar · varlık hareketi · mutabakat',
      admin_assets_hi_fi_dc00b9: 'Hot cüzdan · varlığa göre',
      admin_assets_hi_fi_24e2e8: 'Cold cüzdan · varlığa göre',
      admin_assets_hi_fi_503c9d: 'Anında çekilebilir',
      admin_assets_hi_fi_4b4b97: 'Kullanıcı bakiyelerine karşı',
      admin_assets_hi_fi_48aeb1: 'Varlık hareketi talebi (hot → cold, cold → hot)',

      // --- AI Ops ---
      admin_a_i_ops_50ede2: '💡 v1.4.2, v1.3.9’a kıyasla isabet oranını 7 puan artırıyor. Tüm trafiğin bu hafta sonu taşınması öneriliyor.',
      admin_a_i_ops_ed2648: '3 gün önce · Kuri Kwon',

      // --- 공지 에디터 ---
      admin_notice_editor_db8cc8: 'Duyuru yaz',
      admin_notice_editor_3d991a: 'Yeni duyuru · Markdown desteklenir',
      admin_notice_editor_a2ee94: 'Duyuru başlığı',
      admin_notice_editor_c3d57e: 'Gövde (Markdown desteklenir)&#10;&#10;örn.&#10;## Alt başlık&#10;İçeriğinizi yazın…&#10;- Madde 1&#10;- Madde 2&#10;&#10;**kalın** · [bağlantı](url)',
      admin_notice_editor_a8e5c8: '(başlık yok)',
      admin_notice_editor_c4c626: '(gövde yok)',
      admin_notice_editor_0a94de: 'Yayın seçenekleri',
      admin_notice_editor_189dd9: '📌 En üste sabitle',
      admin_notice_editor_a2fa30: 'Tüm kullanıcılar için uygulama içi banner',
      admin_notice_editor_41c60b: 'Ana sayfada göster',
      admin_notice_editor_492974: 'Anlık bildirim',
      admin_notice_editor_61187b: 'E-posta gönder',
      admin_notice_editor_11a5df: '(yayınlanırken otomatik ayarlanır)',
      admin_notice_editor_102c1f: 'Kuri Kwon',
      admin_notice_editor_7148d7: 'Yayınla',

      // --- 전체 발송 (Broadcast) ---
      admin_broadcast_b7f563: 'Uygulama içi · e-posta · anlık bildirim toplu gönderimi',
      admin_broadcast_f724cc: 'Mesaj yaz',
      admin_broadcast_078b3a: 'Konu',
      admin_broadcast_a7bc1f: 'örn. Ağustos komisyon iadesi kampanyası',
      admin_broadcast_c67b87: 'Gövde',
      admin_broadcast_1a8f0f: 'Gövdeyi yazın. Markdown desteklenir (**kalın** · `kod` · [bağlantı](url)).',
      admin_broadcast_90bbad: 'Hedef kitle',
      admin_broadcast_95066f: 'Herkes (1.242)',
      admin_broadcast_be1a1a: 'Yalnızca Pro/VIP (642)',
      admin_broadcast_1395f0: 'KYC L3 (312)',
      admin_broadcast_050529: '7 gün içinde etkin (820)',
      admin_broadcast_9c1758: 'Özel filtre',
      admin_broadcast_7aeb7e: 'Kanallar',
      admin_broadcast_4c0460: 'Tahmini erişim',
      admin_broadcast_140c08: 'Tahmini maliyet:',
      admin_broadcast_626099: 'Şimdi gönder',
      admin_broadcast_1a911b: 'Zamanla',
      admin_broadcast_265106: 'Gönderimi zamanla',
      admin_broadcast_e6f9c4: 'Taslağı kaydet',
      admin_broadcast_f1f368: 'Son gönderilenler',
      admin_broadcast_743fe1: '📢 Planlı bakım duyurusu (1.242)',
      admin_broadcast_63c075: '🎉 Ağustos kampanyası (1.242)',
      admin_broadcast_bc4cc1: '📄 Hizmet koşulları güncellemesi (1.242)',
      admin_bc_recipients: 'alıcı · {n} kanal',

      // --- CS 티켓 ---
      admin_c_s_ticket_5c8747: 'Talep ayrıntıları',
      admin_c_s_ticket_5c50d9: 'Kullanıcı',
      admin_c_s_ticket_65b9cf: 'Kullanıcı profili',
      admin_c_s_ticket_00ecd1: 'Son işlemler',
      admin_c_s_ticket_c65f61: 'Yazışma',
      admin_c_s_ticket_a6c22d: 'Bir yanıt yazın…',
      admin_c_s_ticket_95bf7b: 'Yanıtı gönder',
      admin_c_s_ticket_3f0669: 'Kaydet (dahili)',
      admin_c_s_ticket_15e878: 'Hızlı işlemler',
      admin_c_s_ticket_efefae: 'Hazır yanıtlar',
      admin_c_s_ticket_291781: 'Merhaba. Kontrol edip kısa süre içinde size döneceğiz. Beklediğiniz için teşekkür ederiz.',
      admin_c_s_ticket_5be08a: 'KYC belgelerinizin bazıları çok bulanık tarandığı için yeniden incelenmesi gerekiyor. Lütfen buradan tekrar gönderin: /kyc/resubmit',
      admin_c_s_ticket_165627: 'Evet, lütfen onaylayın.',
      admin_c_s_ticket_e31e52: ' — Bu konuda bir sorum var. Günlerdir bir gelişme yok ve bu beni rahatsız ediyor.',

      // --- Design Ops ---
      admin_design_ops_247f98: 'Arayüz token’ları · bileşenler · sayfa yönetimi · yeni sayfa ve bileşen kaydı',
      admin_design_ops_127e5c: 'Yeni sayfa, bileşen ve iletişim kutusu oluştur ve kaydet',
      admin_design_ops_631818: 'Yeni sayfa',
      admin_design_ops_ad367e: 'Bir şablondan başla',
      admin_design_ops_b31be6: 'Yeni bileşen',
      admin_design_ops_376325: 'Bileşen kataloğuna ekle',
      admin_design_ops_b1169b: 'Yeni iletişim kutusu / modal',
      admin_design_ops_23188a: 'Modal parçacığını kopyala',
      admin_design_ops_454af0: 'İş akışı · kurallar',
      admin_design_ops_341930: 'Kılavuz belge',
    },
    { label: 'Türkçe', bcp47: 'tr' },
  );
})();
