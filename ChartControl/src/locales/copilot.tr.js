/* ============================================================
   Türkçe — AI Copilot 사전
   ------------------------------------------------------------
   ★ 마크다운 기호(**강조**, - 목록, \n\n)를 그대로 유지한다.
   ★ 치환자는 그대로 남긴다. {brand} 뒤에 격조사를 직접 붙이지 않는다.
   ★★ ai_fu_* 에 매수·매도 권유 문구를 넣지 않는다. 투자자문 등록이 없다.
   ★ 터키 숫자 표기: 천단위 '.', 소수점 ',' (68.120 / %1,1)
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'tr',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: 'Grafik verileri toplanıyor · BTC/USDT 15m · 220 mum',
      ai_think_swinglow: 'Son dip noktaları belirleniyor (RSI uyumsuzluğu kontrol ediliyor)',
      ai_think_trendcand: 'İki veya daha fazla dip bulundu → trend çizgisi adayları hesaplanıyor',
      ai_think_mtf: 'Çoklu zaman dilimi uyumu kontrol ediliyor (15m / 1H / 4H)',
      ai_think_atr: 'Giriş ve stop mesafesi ATR üzerinden hesaplanıyor',
      ai_think_rr: 'R:R açısından optimize edilmiş üç aday simüle ediliyor',
      ai_think_swings: 'Önemli tepe ve dip noktaları taranıyor',
      ai_think_volnodes: 'Yüksek hacimli bölgeler çıkarılıyor',
      ai_think_context: 'Bağlam okunuyor',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: 'Bağlam yüklendi. {symbol} · {tf} · {bars} mum.',
      ai_ctx_loaded_ind: 'Bağlam yüklendi. {symbol} · {tf} · {bars} mum · {n} gösterge etkin.',
      ai_welcome_beginner:
        'Merhaba, ben {brand} Copilot. **{symbol}** grafiğini inceliyorum. '
        + 'Bana gündelik dille sorun; grafiğin üzerine doğrudan trend çizgileri, destek ve direnç çizebilirim, '
        + 'giriş, zarar kes ve kâr al seviyeleri önerebilirim. Ben bir aracım — gerçek emirler yalnızca sizin son onayınızdan sonra gönderilir.',
      ai_welcome_pro:
        'Copilot hazır. Sembol: **{symbol}** · TF: **{tf}** · Son: **{price}** · Veri tarihi {time}. '
        + 'Trend çizgisi, S/R, giriş/SL/TP, R:R isteyin.',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 Taslak trend çizgisi grafiğe eklendi · katman: AI Draft',
      ai_overlay_updated: '✏️ {fields} güncellendi',
      ai_overlay_updated_partial: '✏️ {done} güncellendi. {skipped} değiştirilemedi — çizgi rengi ve kalınlığı grafik tarafından belirlenir ve ayarlanamaz.',
      ai_overlay_update_unsupported: '{fields} değiştirilemedi. Çizgi rengi ve kalınlığı grafik tarafından belirlenir (yapay zeka taslakları kesik çizgi, sizin çizgileriniz düz çizgidir) ve buradan ayarlanamaz.',
      ai_drew_trendline: '📐 {from} ile {to} arasında trend çizgisi çizdim',
      ai_drew_level: '📍 {price} seviyesinde bir çizgi çizdim',
      ai_drew_support: '📍 {price} seviyesine destek çizdim',
      ai_drew_resistance: '📍 {price} seviyesine direnç çizdim',
      ai_drew_entry_zone: '🎯 {lo} – {hi} giriş bölgesini çizdim',
      ai_drew_stop: '🛑 Zarar kes çizgisini {price} seviyesine çizdim',
      ai_drew_target: '🎯 {n}. hedefi {price} seviyesine çizdim',
      ai_drew_invalidation: '⚠ Geçersizlik seviyesini {price} olarak çizdim',
      ai_drew_long_marker: '▲ {price} seviyesinde long işaretledim',
      ai_drew_short_marker: '▼ {price} seviyesinde short işaretledim',
      sv_plan_required: 'Kaydetmek için ücretli plan gerekir',
      sv_name_label: 'Buna bir ad verin',
      sv_save: 'Kaydet',
      ai_my_setup: '◉ BENİM KURULUMUM',
      ai_setup_checked: 'KONTROL EDİLDİ',
      ai_setup_missing: 'Eksik',
      ai_setup_against: 'Kurulumunuza karşı olan kanıtlar',
      ai_setup_against_hint: 'Bu durmak için bir sebep değil — kurulumunuzun dayanması gereken şey.',
      ai_setup_drawn: '📊 Grafiğe {n} çizdim · {items}',
      ai_setup_nothing_drawn: 'Hiçbir şey çizilmedi — kurulumda kullanılabilir seviye yoktu.',
      ai_setup_no_entry: 'Bu kurulumda giriş fiyatı yok, bu yüzden taslak hazırlanamaz.',
      toast_draft_failed: 'Taslak hazırlanamadı',
      ai_step_validating: 'İstek kontrol ediliyor',
      ai_step_tool: '{name} kullanılıyor',
      ai_tool_edited: '✍️ Değişikliğiniz uygulandı · {detail}',
      ai_hint_drag: '📌 Trend çizgisinin iki ucundaki daireleri sürükleyerek ayarlayın. Değişiklikleriniz sohbete yansır.',
      ai_invalidation_note: '· bu koşul gerçekleştiğinde sinyal otomatik olarak geçersiz olur',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        'Bulduklarım şöyle. En son iki dibi birleştiren yükselen bir trend çizgisi çizdim.\n\n'
        + '- **Geçerlilik**: yeni bir dip oluşmadan destek olarak 3 veya daha fazla kez tutunduğu sürece geçerli\n'
        + '- **Geçersizlik**: 15m kapanışının çizginin altında olması\n'
        + '- **Not**: trend çizgisi bir referanstır, bir karar değildir. Başka göstergelerle doğrulayın.\n\n'
        + 'İsterseniz destek ve direnç seviyelerini de ekleyebilirim.',
      ai_reply_trendline_pro:
        'Trend çizgisi **A** dibinden **B** dibine çizildi.\n\n'
        + '- Eğim: +42,6 USDT / 15m mum\n'
        + '- Temas: 3\n'
        + '- Geçersizlik: 15m kapanış < çizgi\n'
        + '- RSI uyumsuzluğu: gözlenmedi\n'
        + '- Çizgiye yakın emir defteri emilimi: BID 68.150 (+3,2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        'Analiz tamamlandı. Aşağıdaki karta bir **long giriş senaryosu** koydum.\n\n'
        + '- **Giriş bölgesi**: 68.120 ile 68.360 arasında kademeli giriş\n'
        + '- **Zarar kes**: 67.480 kırılırsa hemen çık (yaklaşık -%1,1)\n'
        + '- **Hedefler**: üç kademe (68.980 / 69.640 / 70.420)\n'
        + '- **Risk/kazanç**: 1 : 2,8\n'
        + '- **Güven**: %74 (bazı kısımlar tam olarak kesin değil)\n'
        + '- **Not**: bu bir yapay zeka analizidir ve ani piyasa hareketleriyle geçersiz kalabilir.',
      ai_reply_signal_pro:
        'Long kurulumu hazır.\n\n'
        + '- Giriş: 68.120–68.360 (kademeli)\n'
        + '- SL: 67.480 · R %1,1\n'
        + '- TP: 68.980 / 69.640 / 70.420\n'
        + '- R:R 1 : 2,8 · güven %74\n'
        + '- Geçersizlik: 15m kapanış < 67.480',

      // --- 일반 응답 ---
      ai_reply_general:
        'Algılanan soru: "{text}".\n\n"trend çizgisi çiz", "giriş/SL/TP öner" veya "destek ve direnç bul" gibi komutları deneyin.',

      // --- 퀵 칩 ---
      ai_chip_trendline: '🎯 Yükselen trend çizgisi çiz',
      ai_chip_trendline_cmd: 'son diplerden yükselen bir trend çizgisi çiz',
      ai_chip_signal: '📊 Giriş senaryosu',
      ai_chip_signal_cmd: 'girişimi, zarar kes ve kâr al seviyelerimi işaretlememe yardım et',
      ai_chip_sr: '📍 Destek / direnç bul',
      ai_chip_sr_cmd: 'destek ve direnç bul',
      ai_chip_fib: '📐 Fibonacci',
      ai_chip_rr: '🔀 R:R hesaplayıcı',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: 'Nasıl yardımcı olabilirim? örn. trend çizgisi çiz',
      ai_input_pro: 'Bir komut girin… (örn. trend çizgisi çiz / kurulumumu taslakla / S/R bul)',
      ai_reason_beginner: '💡 Neden',
      ai_reason_pro: 'Gerekçe',

      // --- 후속 제안 칩 ---
      ai_fu_title: 'Sırada şunu sorabilirsiniz',
      ai_fu_risk_open_position: '⚠ Açık pozisyonumun riskini kontrol et',
      ai_fu_risk_open_position_q: 'Açık bir pozisyonum var. Likidasyon mesafem nedir ve bunu ne geçersiz kılar?',
      ai_fu_invalidation: '❓ Hangi noktada yanılmış olurum?',
      ai_fu_invalidation_q: 'Bir giriş ve bir stop çizdim ama geçersizlik seviyesi yok. Hangi noktada bu fikrin yanlış olduğunu kabul etmeliyim?',
      ai_fu_no_stop: '🛑 Stop seviyem yok',
      ai_fu_no_stop_q: 'Bir giriş bölgesi çizdim ama stop seviyesi yok. Bunun altındaki ve üstündeki yapısal seviyeleri açıkla.',
      ai_fu_open_orders: '📋 Bekleyen emirlerimi gözden geçir',
      ai_fu_open_orders_q: 'Bekleyen emirlerim var. Bunlar mevcut yapıyla hâlâ tutarlı mı?',
      ai_fu_counter_case: '🔄 Tersini savun',
      ai_fu_counter_case_q: 'Şimdi az önce söylediğinin tersini savun. Buna karşı en güçlü gerekçe nedir?',
      ai_fu_review_trades: '📖 Geçmiş işlemlerimi gözden geçir',
      ai_fu_review_trades_q: 'Geçmiş işlemlerimi gözden geçir. Kendi planıma uydum mu ve nerede saptım?',
      ai_fu_higher_tf: '🔍 Üst zaman dilimini kontrol et',
      ai_fu_higher_tf_q: 'Üst zaman dilimi bu okumayla uyuşuyor mu, uyuşmuyor mu?',
      ai_fu_add_indicator: '📈 Bu durum için gösterge öner',
      ai_fu_add_indicator_q: 'Grafiğimde hiç gösterge yok. Burada hangileri bilgi verir ve sınırları nedir?',
      ai_fu_funding: '💰 Funding ne durumda?',
      ai_fu_funding_q: 'Funding oranı şu anki pozisyonlanma hakkında ne söylüyor?',
      ai_fu_order_book: '📊 Emir defterini oku',
      ai_fu_order_book_q: 'Emir defteri derinliği mevcut fiyatın yakınında ne gösteriyor?',
      ai_fu_explain_levels: '📍 Önemli seviyeleri açıkla',
      ai_fu_explain_levels_q: '{symbol} üzerindeki önemli seviyeleri ve her birini nasıl belirlediğini açıkla.',

      // --- 저장 / 알림 결과 ---
      ai_points_insufficient: 'Bunu kaydetmek için puan yetersiz. Puanlar sayfasından yükleyin.',
      ai_alert_no_price: 'Bu sinyalde giriş fiyatı yok, bu yüzden uyarı kurulacak bir şey yok.',
      ai_alert_created: 'Uyarı {price} seviyesine kuruldu. Fiyat bu seviyeye ulaştığında bilgilendirileceksiniz.',
      ai_alert_failed: 'Uyarı kurulamadı. Hiçbir şey kaydedilmedi — tekrar deneyin.',

      ai_layer_hide: 'Bu katmanı grafikte gizle',
      ai_layer_show: 'Bu katmanı grafikte göster',
    },
    { label: 'Türkçe', bcp47: 'tr' },
  );
})();
