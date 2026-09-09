/* ============================================================
   Filipino — AI Copilot 사전
   ------------------------------------------------------------
   ★ 마크다운 기호(**강조**, - 목록, \n\n)를 그대로 유지한다.
   ★ 치환자는 그대로 남긴다.
   ★★ ai_fu_* 에 매수·매도 권유 문구를 넣지 않는다. 투자자문 등록이 없다.
   ★ 트레이딩 용어(long/short/stop/entry/support/resistance)는 영어를 유지한다 —
     필리핀 트레이딩 커뮤니티의 실제 사용 형태(Taglish)다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'fil',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: 'Kinukuha ang chart data · BTC/USDT 15m · 220 candles',
      ai_think_swinglow: 'Hinahanap ang mga kasalukuyang swing low (tinitingnan ang RSI divergence)',
      ai_think_trendcand: 'May dalawa o higit pang low na nakita → kinakalkula ang mga posibleng trendline',
      ai_think_mtf: 'Tinitingnan ang pagkakatugma ng maraming timeframe (15m / 1H / 4H)',
      ai_think_atr: 'Kinakalkula ang distansya ng entry at stop mula sa ATR',
      ai_think_rr: 'Sinusubukan ang tatlong kandidatong naka-optimize sa R:R',
      ai_think_swings: 'Iniinspeksyon ang mga pangunahing swing high at low',
      ai_think_volnodes: 'Hinahango ang mga bahaging may mataas na volume',
      ai_think_context: 'Binabasa ang konteksto',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: 'Nai-load na ang konteksto. {symbol} · {tf} · {bars} candles.',
      ai_ctx_loaded_ind: 'Nai-load na ang konteksto. {symbol} · {tf} · {bars} candles · {n} indicator na aktibo.',
      ai_welcome_beginner:
        'Kumusta, ito ang Copilot ng {brand}. Tinitingnan ko ang chart ng **{symbol}**. '
        + 'Magtanong sa simpleng salita at makakaguhit ako ng trendline, support at resistance mismo sa chart, '
        + 'at makakapagmungkahi ng entry, stop-loss at take-profit na antas. Isa akong tool — ang tunay na order ay ipinapadala lamang matapos ang huling pag-apruba mo.',
      ai_welcome_pro:
        'Handa na ang Copilot. Symbol: **{symbol}** · TF: **{tf}** · Huli: **{price}** · Data noong {time}. '
        + 'Humiling ng trendline, S/R, entry/SL/TP, R:R.',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 Naidagdag sa chart ang draft na trendline · layer: AI Draft',
      ai_overlay_updated: '✏️ Na-update ang {fields}',
      ai_overlay_updated_partial: '✏️ Na-update ang {done}. Hindi mababago ang {skipped} — ang kulay at kapal ng linya ay itinatakda ng chart at hindi maaayos.',
      ai_overlay_update_unsupported: 'Hindi ko mababago ang {fields}. Ang kulay at kapal ng linya ay itinatakda ng chart (putol-putol ang mga draft ng AI, tuloy-tuloy ang sarili mong linya) at hindi maaayos mula rito.',
      ai_drew_trendline: '📐 Gumuhit ako ng trendline mula {from} hanggang {to}',
      ai_drew_level: '📍 Gumuhit ako ng antas sa {price}',
      ai_drew_support: '📍 Gumuhit ako ng support sa {price}',
      ai_drew_resistance: '📍 Gumuhit ako ng resistance sa {price}',
      ai_drew_entry_zone: '🎯 Iginuhit ko ang entry zone na {lo} – {hi}',
      ai_drew_stop: '🛑 Iginuhit ko ang stop-loss na linya sa {price}',
      ai_drew_target: '🎯 Iginuhit ko ang target {n} sa {price}',
      ai_drew_invalidation: '⚠ Iginuhit ko ang invalidation na antas sa {price}',
      ai_drew_long_marker: '▲ Minarkahan ang long sa {price}',
      ai_drew_short_marker: '▼ Minarkahan ang short sa {price}',
      sv_plan_required: 'Kailangan ng bayad na plan para makapag-save',
      sv_name_label: 'Pangalanan ito',
      sv_save: 'I-save',
      ai_my_setup: '◉ ANG SETUP KO',
      ai_setup_checked: 'NASURI',
      ai_setup_missing: 'Kulang',
      ai_setup_against: 'Mga ebidensyang kontra sa setup mo',
      ai_setup_against_hint: 'Hindi ito dahilan para tumigil — ito ang kailangang matiis ng setup mo.',
      ai_setup_drawn: '📊 Gumuhit ako ng {n} sa chart · {items}',
      ai_setup_nothing_drawn: 'Walang naguhit — walang magamit na antas sa setup.',
      ai_setup_no_entry: 'Walang entry price ang setup na ito, kaya hindi makakagawa ng draft.',
      toast_draft_failed: 'Hindi nagawa ang draft',
      ai_step_validating: 'Sinusuri ang kahilingan',
      ai_step_tool: 'Gumagamit ng {name}',
      ai_tool_edited: '✍️ Na-apply ang binago mo · {detail}',
      ai_hint_drag: '📌 I-drag ang mga bilog sa dulo ng trendline para iayos ito. Lumalabas sa usapan ang mga binago mo.',
      ai_invalidation_note: '· awtomatikong nawawalan ng bisa ang signal kapag nangyari ang kondisyong ito',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        'Ito ang nakita ko. Gumuhit ako ng pataas na trendline na nagdudugtong sa dalawang pinakabagong low.\n\n'
        + '- **Bisa**: may bisa habang humahawak ito bilang support ng 3 beses o higit nang walang bagong low\n'
        + '- **Kailan nawawalan ng bisa**: kapag ang 15m ay nagsara sa ilalim ng linya\n'
        + '- **Tandaan**: ang trendline ay isang sanggunian, hindi isang desisyon. Kumpirmahin sa ibang indicator.\n\n'
        + 'Kung gusto mo, makakadagdag din ako ng support at resistance na antas.',
      ai_reply_trendline_pro:
        'Naiguhit ang trendline mula swing low **A** hanggang **B**.\n\n'
        + '- Slope: +42.6 USDT / 15m bar\n'
        + '- Touches: 3\n'
        + '- Invalidation: 15m close < linya\n'
        + '- RSI divergence: wala\n'
        + '- Order book absorption malapit sa linya: BID 68,150 (+3.2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        'Tapos na ang analysis. Naglagay ako ng **long entry na senaryo** sa card sa ibaba.\n\n'
        + '- **Entry zone**: pahinay-hinay na pagpasok sa 68,120 hanggang 68,360\n'
        + '- **Stop loss**: lumabas agad kapag nabasag ang 67,480 (mga -1.1%)\n'
        + '- **Target**: tatlong bahagi (68,980 / 69,640 / 70,420)\n'
        + '- **Risk/reward**: 1 : 2.8\n'
        + '- **Confidence**: 74% (may mga bahaging hindi lubos na tiyak)\n'
        + '- **Tandaan**: analysis ito ng AI at maaaring mawalan ng bisa dahil sa biglaang paggalaw ng merkado.',
      ai_reply_signal_pro:
        'Handa na ang long setup.\n\n'
        + '- Entry: 68,120–68,360 (pahinay-hinay)\n'
        + '- SL: 67,480 · R 1.1%\n'
        + '- TP: 68,980 / 69,640 / 70,420\n'
        + '- R:R 1 : 2.8 · confidence 74%\n'
        + '- Invalidation: 15m close < 67,480',

      // --- 일반 응답 ---
      ai_reply_general:
        'Natukoy na tanong: "{text}".\n\nSubukan ang mga utos tulad ng "gumuhit ng trendline", "magmungkahi ng entry/SL/TP" o "hanapin ang support at resistance".',

      // --- 퀵 칩 ---
      ai_chip_trendline: '🎯 Gumuhit ng pataas na trendline',
      ai_chip_trendline_cmd: 'gumuhit ng pataas na trendline mula sa mga kasalukuyang low',
      ai_chip_signal: '📊 Senaryo ng entry',
      ai_chip_signal_cmd: 'tulungan mo akong markahan ang entry, stop loss at take profit ko',
      ai_chip_sr: '📍 Hanapin ang support / resistance',
      ai_chip_sr_cmd: 'hanapin ang support at resistance',
      ai_chip_fib: '📐 Fibonacci',
      ai_chip_rr: '🔀 R:R calculator',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: 'Paano makakatulong? hal. gumuhit ng trendline',
      ai_input_pro: 'Maglagay ng utos… (hal. gumuhit ng trendline / i-draft ang setup ko / hanapin ang S/R)',
      ai_reason_beginner: '💡 Bakit',
      ai_reason_pro: 'Dahilan',

      // --- 후속 제안 칩 ---
      ai_fu_title: 'Sunod ay maaari mong itanong',
      ai_fu_risk_open_position: '⚠ Tingnan ang risk ng bukás na posisyon ko',
      ai_fu_risk_open_position_q: 'May bukás akong posisyon. Gaano kalayo ang liquidation ko at ano ang magpapawalang-bisa nito?',
      ai_fu_invalidation: '❓ Saan ako magiging mali?',
      ai_fu_invalidation_q: 'Gumuhit ako ng entry at stop pero walang invalidation na antas. Saang punto ko dapat tanggapin na mali ang ideyang ito?',
      ai_fu_no_stop: '🛑 Wala akong stop na antas',
      ai_fu_no_stop_q: 'Gumuhit ako ng entry zone pero walang stop na antas. Ipaliwanag ang mga structural na antas sa ilalim at itaas nito.',
      ai_fu_open_orders: '📋 Suriin ang mga nakabinbing order ko',
      ai_fu_open_orders_q: 'May mga nakabinbing order ako. Tugma pa ba ang mga ito sa kasalukuyang estruktura?',
      ai_fu_counter_case: '🔄 Ipagtanggol ang kabaligtaran',
      ai_fu_counter_case_q: 'Ngayon ipagtanggol ang kabaligtaran ng sinabi mo. Ano ang pinakamatibay na argumento kontra rito?',
      ai_fu_review_trades: '📖 Suriin ang mga nakaraang trade ko',
      ai_fu_review_trades_q: 'Suriin ang mga nakaraang trade ko. Sinunod ko ba ang sarili kong plano, at saan ako lumihis?',
      ai_fu_higher_tf: '🔍 Tingnan ang mas mataas na timeframe',
      ai_fu_higher_tf_q: 'Sumasang-ayon ba ang mas mataas na timeframe sa pagbasang ito, o hindi?',
      ai_fu_add_indicator: '📈 Magmungkahi ng indicator para dito',
      ai_fu_add_indicator_q: 'Walang indicator sa chart ko. Alin ang makakatulong dito, at ano ang mga limitasyon nila?',
      ai_fu_funding: '💰 Ano ang ginagawa ng funding?',
      ai_fu_funding_q: 'Ano ang sinasabi ng funding rate tungkol sa positioning ngayon?',
      ai_fu_order_book: '📊 Basahin ang order book',
      ai_fu_order_book_q: 'Ano ang ipinapakita ng lalim ng order book malapit sa kasalukuyang presyo?',
      ai_fu_explain_levels: '📍 Ipaliwanag ang mahahalagang antas',
      ai_fu_explain_levels_q: 'Ipaliwanag ang mahahalagang antas sa {symbol} at kung paano mo natukoy ang bawat isa.',

      // --- 저장 / 알림 결과 ---
      ai_points_insufficient: 'Kulang ang points para i-save ito. Mag-top up sa Points page.',
      ai_alert_no_price: 'Walang entry price ang signal na ito, kaya walang mapag-aalertuhan.',
      ai_alert_created: 'Naka-set ang alert sa {price}. Sasabihan ka kapag naabot ng presyo ito.',
      ai_alert_failed: 'Hindi na-set ang alert. Walang na-save — subukan muli.',

      ai_layer_hide: 'Itago ang layer na ito sa chart',
      ai_layer_show: 'Ipakita ang layer na ito sa chart',
    },
    { label: 'Filipino', bcp47: 'fil-PH' },
  );
})();
