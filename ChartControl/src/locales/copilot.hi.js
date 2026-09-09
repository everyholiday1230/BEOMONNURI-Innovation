/* ============================================================
   हिन्दी — AI Copilot 사전
   ------------------------------------------------------------
   ★ 마크다운 기호(**강조**, - 목록, \n\n)를 그대로 유지한다.
   ★ 치환자는 그대로 남긴다.
   ★★ ai_fu_* 에 매수·매도 권유 문구를 넣지 않는다. 투자자문 등록이 없다.
   ★ 트레이딩 용어(long/short/stop/RSI/ATR/R:R/funding)는 영어를 유지한다 —
     인도 트레이더의 실제 사용 형태이고, 억지 번역은 오히려 뜻이 흐려진다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'hi',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: 'चार्ट डेटा इकट्ठा किया जा रहा है · BTC/USDT 15m · 220 कैंडल',
      ai_think_swinglow: 'हाल के swing low पहचाने जा रहे हैं (RSI डाइवर्जेंस जाँची जा रही है)',
      ai_think_trendcand: 'दो या अधिक low मिले → संभावित trendline की गणना हो रही है',
      ai_think_mtf: 'कई टाइमफ़्रेम का तालमेल जाँचा जा रहा है (15m / 1H / 4H)',
      ai_think_atr: 'ATR से entry और stop की दूरी निकाली जा रही है',
      ai_think_rr: 'R:R के हिसाब से तीन बेहतर विकल्प सिम्युलेट किए जा रहे हैं',
      ai_think_swings: 'मुख्य swing high और low स्कैन किए जा रहे हैं',
      ai_think_volnodes: 'अधिक वॉल्यूम वाले क्षेत्र निकाले जा रहे हैं',
      ai_think_context: 'संदर्भ पढ़ा जा रहा है',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: 'संदर्भ लोड हो गया। {symbol} · {tf} · {bars} कैंडल।',
      ai_ctx_loaded_ind: 'संदर्भ लोड हो गया। {symbol} · {tf} · {bars} कैंडल · {n} इंडिकेटर चालू।',
      ai_welcome_beginner:
        'नमस्ते, यह {brand} Copilot है। मैं **{symbol}** का चार्ट देख रहा हूँ। '
        + 'मुझसे सामान्य भाषा में कुछ भी पूछें — मैं चार्ट पर सीधे trendline, support और resistance खींच सकता हूँ, '
        + 'और entry, stop-loss तथा take-profit स्तर सुझा सकता हूँ। मैं एक साधन हूँ — असली ऑर्डर केवल आपकी अंतिम मंज़ूरी के बाद ही जाते हैं।',
      ai_welcome_pro:
        'Copilot तैयार। सिंबल: **{symbol}** · TF: **{tf}** · अंतिम: **{price}** · डेटा {time} तक। '
        + 'trendline, S/R, entry/SL/TP, R:R माँगें।',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 ड्राफ़्ट trendline चार्ट पर जोड़ी गई · लेयर: AI Draft',
      ai_overlay_updated: '✏️ {fields} अपडेट किया',
      ai_overlay_updated_partial: '✏️ {done} अपडेट किया। {skipped} नहीं बदला जा सका — लाइन का रंग और मोटाई चार्ट तय करता है और यह बदली नहीं जा सकती।',
      ai_overlay_update_unsupported: 'मैं {fields} नहीं बदल सका। लाइन का रंग और मोटाई चार्ट तय करता है (AI के ड्राफ़्ट डैश वाले होते हैं, आपकी लाइनें ठोस) और इसे यहाँ से नहीं बदला जा सकता।',
      ai_drew_trendline: '📐 {from} से {to} तक trendline खींची',
      ai_drew_level: '📍 {price} पर एक स्तर खींचा',
      ai_drew_support: '📍 {price} पर support खींचा',
      ai_drew_resistance: '📍 {price} पर resistance खींचा',
      ai_drew_entry_zone: '🎯 {lo} – {hi} का entry ज़ोन खींचा',
      ai_drew_stop: '🛑 stop-loss लाइन {price} पर खींची',
      ai_drew_target: '🎯 लक्ष्य {n} को {price} पर खींचा',
      ai_drew_invalidation: '⚠ invalidation स्तर {price} पर खींचा',
      ai_drew_long_marker: '▲ {price} पर long चिह्नित किया',
      ai_drew_short_marker: '▼ {price} पर short चिह्नित किया',
      sv_plan_required: 'सहेजने के लिए सशुल्क प्लान चाहिए',
      sv_name_label: 'इसे नाम दें',
      sv_save: 'सहेजें',
      ai_my_setup: '◉ मेरा सेटअप',
      ai_setup_checked: 'जाँचा गया',
      ai_setup_missing: 'अनुपलब्ध',
      ai_setup_against: 'आपके सेटअप के विरुद्ध प्रमाण',
      ai_setup_against_hint: 'यह रुकने का कारण नहीं है — यह वह है जिसे आपके सेटअप को झेलना है।',
      ai_setup_drawn: '📊 चार्ट पर {n} खींचा · {items}',
      ai_setup_nothing_drawn: 'कुछ नहीं खींचा गया — सेटअप में उपयोग योग्य कोई स्तर नहीं था।',
      ai_setup_no_entry: 'इस सेटअप में entry कीमत नहीं है, इसलिए ड्राफ़्ट तैयार नहीं किया जा सकता।',
      toast_draft_failed: 'ड्राफ़्ट तैयार नहीं हो सका',
      ai_step_validating: 'अनुरोध जाँचा जा रहा है',
      ai_step_tool: '{name} का उपयोग हो रहा है',
      ai_tool_edited: '✍️ आपका बदलाव लागू हुआ · {detail}',
      ai_hint_drag: '📌 trendline के दोनों सिरों पर बने गोलों को खींचकर उसे समायोजित करें। आपके बदलाव बातचीत में दिखते हैं।',
      ai_invalidation_note: '· यह स्थिति आने पर सिग्नल स्वतः अमान्य हो जाता है',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        'मुझे यह मिला। मैंने हाल के दो low को जोड़ती हुई एक चढ़ती trendline खींची है।\n\n'
        + '- **वैधता**: जब तक यह नया low बनाए बिना 3 या अधिक बार support की तरह टिकती है\n'
        + '- **अमान्य कब**: 15m का बंद भाव लाइन से नीचे\n'
        + '- **ध्यान दें**: trendline एक संदर्भ है, निर्णय नहीं। दूसरे इंडिकेटर से पुष्टि करें।\n\n'
        + 'चाहें तो मैं support और resistance स्तर भी जोड़ सकता हूँ।',
      ai_reply_trendline_pro:
        'trendline swing low **A** से **B** तक खींची गई।\n\n'
        + '- ढलान: +42.6 USDT / 15m बार\n'
        + '- स्पर्श: 3\n'
        + '- अमान्य: 15m बंद < लाइन\n'
        + '- RSI डाइवर्जेंस: नहीं दिखी\n'
        + '- लाइन के पास order book अवशोषण: BID 68,150 (+3.2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        'विश्लेषण पूरा हुआ। मैंने नीचे कार्ड में एक **long entry परिदृश्य** रखा है।\n\n'
        + '- **entry ज़ोन**: 68,120 और 68,360 के बीच हिस्सों में प्रवेश\n'
        + '- **stop loss**: 67,480 टूटने पर तुरंत बाहर (लगभग -1.1%)\n'
        + '- **लक्ष्य**: तीन चरण (68,980 / 69,640 / 70,420)\n'
        + '- **जोखिम/लाभ**: 1 : 2.8\n'
        + '- **विश्वास**: 74% (कुछ हिस्से पूरी तरह निश्चित नहीं)\n'
        + '- **ध्यान दें**: यह AI का विश्लेषण है और बाज़ार की अचानक चाल से अमान्य हो सकता है।',
      ai_reply_signal_pro:
        'long सेटअप तैयार।\n\n'
        + '- Entry: 68,120–68,360 (हिस्सों में)\n'
        + '- SL: 67,480 · R 1.1%\n'
        + '- TP: 68,980 / 69,640 / 70,420\n'
        + '- R:R 1 : 2.8 · विश्वास 74%\n'
        + '- अमान्य: 15m बंद < 67,480',

      // --- 일반 응답 ---
      ai_reply_general:
        'पहचाना गया प्रश्न: "{text}"।\n\n"trendline खींचो", "entry/SL/TP सुझाओ" या "support और resistance खोजो" जैसे आदेश आज़माएँ।',

      // --- 퀵 칩 ---
      ai_chip_trendline: '🎯 चढ़ती trendline खींचें',
      ai_chip_trendline_cmd: 'हाल के low से एक चढ़ती trendline खींचो',
      ai_chip_signal: '📊 entry परिदृश्य',
      ai_chip_signal_cmd: 'मेरी entry, stop loss और take profit चिह्नित करने में मदद करो',
      ai_chip_sr: '📍 support / resistance खोजें',
      ai_chip_sr_cmd: 'support और resistance खोजो',
      ai_chip_fib: '📐 Fibonacci',
      ai_chip_rr: '🔀 R:R कैलकुलेटर',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: 'कैसे मदद करूँ? जैसे: trendline खींचो',
      ai_input_pro: 'कोई आदेश लिखें… (जैसे: trendline खींचो / मेरा सेटअप ड्राफ़्ट करो / S/R खोजो)',
      ai_reason_beginner: '💡 क्यों',
      ai_reason_pro: 'कारण',

      // --- 후속 제안 칩 ---
      ai_fu_title: 'आगे आप यह पूछ सकते हैं',
      ai_fu_risk_open_position: '⚠ मेरी खुली पोज़िशन का जोखिम जाँचें',
      ai_fu_risk_open_position_q: 'मेरी एक पोज़िशन खुली है। मेरी liquidation दूरी कितनी है और उसे क्या अमान्य करेगा?',
      ai_fu_invalidation: '❓ मैं कहाँ ग़लत होऊँगा?',
      ai_fu_invalidation_q: 'मैंने entry और stop खींचा है पर invalidation स्तर नहीं। किस बिंदु पर मुझे मान लेना चाहिए कि यह विचार ग़लत है?',
      ai_fu_no_stop: '🛑 मेरा कोई stop स्तर नहीं है',
      ai_fu_no_stop_q: 'मैंने entry ज़ोन खींचा है पर stop स्तर नहीं। उसके नीचे और ऊपर के संरचनात्मक स्तर समझाएँ।',
      ai_fu_open_orders: '📋 मेरे लंबित ऑर्डर की समीक्षा करें',
      ai_fu_open_orders_q: 'मेरे लंबित ऑर्डर हैं। क्या वे अब भी वर्तमान संरचना के अनुरूप हैं?',
      ai_fu_counter_case: '🔄 उलटा पक्ष रखें',
      ai_fu_counter_case_q: 'अब आपने जो कहा उसका उलटा तर्क रखें। इसके विरुद्ध सबसे मज़बूत तर्क क्या है?',
      ai_fu_review_trades: '📖 मेरे पिछले ट्रेड की समीक्षा करें',
      ai_fu_review_trades_q: 'मेरे पिछले ट्रेड की समीक्षा करें। क्या मैंने अपनी ही योजना का पालन किया, और कहाँ भटका?',
      ai_fu_higher_tf: '🔍 बड़े टाइमफ़्रेम की जाँच करें',
      ai_fu_higher_tf_q: 'क्या बड़ा टाइमफ़्रेम इस पढ़त से सहमत है या असहमत?',
      ai_fu_add_indicator: '📈 इसके लिए इंडिकेटर सुझाएँ',
      ai_fu_add_indicator_q: 'मेरे चार्ट पर कोई इंडिकेटर नहीं है। यहाँ कौन-से उपयोगी होंगे, और उनकी सीमाएँ क्या हैं?',
      ai_fu_funding: '💰 funding क्या दिखा रहा है?',
      ai_fu_funding_q: 'funding दर इस समय बाज़ार की पोज़िशनिंग के बारे में क्या बता रही है?',
      ai_fu_order_book: '📊 order book पढ़ें',
      ai_fu_order_book_q: 'वर्तमान कीमत के आसपास order book की गहराई क्या दिखाती है?',
      ai_fu_explain_levels: '📍 मुख्य स्तर समझाएँ',
      ai_fu_explain_levels_q: '{symbol} के मुख्य स्तर समझाएँ और यह भी कि आपने हर एक को कैसे पहचाना।',

      // --- 저장 / 알림 결과 ---
      ai_points_insufficient: 'इसे सहेजने के लिए पर्याप्त पॉइंट नहीं हैं। पॉइंट पेज पर टॉप-अप करें।',
      ai_alert_no_price: 'इस सिग्नल में entry कीमत नहीं है, इसलिए अलर्ट लगाने के लिए कुछ नहीं है।',
      ai_alert_created: '{price} पर अलर्ट लगा दिया गया। कीमत वहाँ पहुँचने पर आपको बताया जाएगा।',
      ai_alert_failed: 'अलर्ट नहीं लगाया जा सका। कुछ भी सहेजा नहीं गया — दोबारा कोशिश करें।',

      ai_layer_hide: 'चार्ट पर यह लेयर छिपाएँ',
      ai_layer_show: 'चार्ट पर यह लेयर दिखाएँ',
    },
    { label: 'हिन्दी', bcp47: 'hi' },
  );
})();
