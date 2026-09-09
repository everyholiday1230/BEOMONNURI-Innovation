/* ============================================================
   हिन्दी — 관리자 화면 (pages-admin.jsx / pages-admin-more.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {tab} {n} {pending} 치환자는 그대로 남긴다.
   ★ 사람 이름은 표본 데이터다 — 번역하지 않는다. HTML 엔티티(&#10;)는 유지한다.
   ★ 운영 용어(KYC / AML / CTF / SLA / hot / cold / on-chain)는 영어를 유지한다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'hi',
    {
      // --- 대시보드 / 목록 부제 ---
      admin_dashboard_0ccafd: 'लाइव प्लेटफ़ॉर्म स्थिति · असामान्यताएँ · जोखिम · AI · सिस्टम',
      admin_users_3fefdf: 'नाम · ईमेल · ID खोजें',
      admin_trades_bc077b: 'लाइव ऑर्डर · fills · असामान्यता पहचान',
      admin_risk_a1edf2: 'पोज़िशन एक्सपोज़र · liquidation कतार · बाज़ार जोखिम',
      admin_fees_65feac: 'फ़ीस स्तर · रिबेट · प्रोमोशन · payback',
      admin_notices_15d236: 'घोषणाएँ',
      admin_notices_11300f: 'घोषणाएँ प्रकाशित करें · ग्राहक पूछताछ प्रबंधित करें',

      // --- 사용자 상세 ---
      admin_user_detail_106e43: 'खोज · फ़िल्टर · CSV एक्सपोर्ट',
      admin_user_detail_170f7b: 'शामिल हुए',
      admin_user_detail_22d6d2: '30-दिन का वॉल्यूम',
      admin_user_detail_33103c: 'संचित शुल्क',
      admin_user_detail_3f4319: 'पहचान दस्तावेज़',
      admin_user_detail_0057bd: 'KYC दस्तावेज़',
      admin_user_detail_43a4e1: 'गतिविधि लॉग',
      admin_user_detail_8f5d10: 'गतिविधि लॉग · अंतिम 20 प्रविष्टियाँ',
      admin_user_detail_8797eb: 'ट्रेड इतिहास',
      admin_user_detail_80a094: 'ट्रेडिंग इतिहास',
      admin_user_detail_81922a: 'पोज़िशन',
      admin_user_detail_40ce13: 'एसेट',
      admin_user_detail_e4ec3e: 'एसेट देखें',
      admin_user_detail_a5e5da: 'सुरक्षा',
      admin_user_detail_8dd7e4: 'सुरक्षा घटनाएँ',
      admin_user_detail_915cf6: 'ऑपरेटर टिप्पणियाँ',
      admin_user_detail_f35682: 'ऑपरेटर टिप्पणी (ऑडिट लॉग में दर्ज होती है)',
      admin_user_detail_12614e: 'टाइमलाइन · समुच्चय दृश्य',
      admin_user_detail_d65b24: 'स्वतः गणना',
      admin_user_detail_44650a: 'अन्य',
      admin_user_detail_a43b70: 'KYC समीक्षा परिणाम',
      admin_user_detail_a74a3f: 'KYC पुनः सत्यापन आवश्यक',
      admin_user_detail_851473: 'KYC फिर से मांगें',
      admin_user_detail_219da4: 'L3 पर प्रोमोट करें',
      admin_user_detail_afc528: 'पुनः समीक्षा का अनुरोध',
      admin_user_detail_a1d12d: 'असामान्य ट्रेडिंग पाई गई',
      admin_user_detail_2d003e: 'AML/CTF मामला',
      admin_user_detail_ca5360: 'उपयोगकर्ता का अनुरोध',
      admin_user_detail_63c279: 'कारण',
      admin_user_detail_96330a: 'संदेश',
      admin_user_detail_941ad1: 'ईमेल भेजें',
      admin_user_detail_04f2aa: 'रीसेट लिंक ईमेल करें',
      admin_user_detail_e03d2f: '2FA रीसेट करें',
      admin_user_detail_82d3e7: 'खाता निलंबित करें',
      admin_user_detail_94cd06: '⚠ खाता निलंबित करें',
      admin_user_detail_1d441e: 'निलंबित करें',
      admin_user_detail_f63bf7: 'निलंबन हटाएँ',
      admin_user_detail_ebe503: 'क्या आप वाकई इस उपयोगकर्ता को निलंबित करना चाहते हैं?',
      admin_user_detail_bd464c: 'निलंबन पर उपयोगकर्ता को स्वतः ईमेल से सूचित किया जाता है और यह कार्रवाई ऑडिट लॉग में दर्ज होती है।',
      admin_user_detail_ff8aa0: 'निलंबन की पुष्टि करें',
      admin_user_detail_19b2d1: 'रद्द करें',
      admin_user_detail_4def42: 'उपयोगकर्ता निलंबित (सिमुलेशन)',
      admin_user_tab_data: 'इस उपयोगकर्ता का {tab} डेटा दिखाया जा रहा है',
      admin_users_subtitle: 'कुल {n} उपयोगकर्ता · KYC · अनुमतियाँ · निलंबन · ऑडिट',

      // --- KYC 심사 ---
      admin_k_y_c_queue_46072a: 'KYC समीक्षा',
      admin_k_y_c_queue_d167fe: 'Dohyun Kim',
      admin_kyc_sla: '{pending} लंबित · SLA 24 घंटे',
      flag_auto_detected: ' · स्वतः पहचाना गया · ',
      flag_investigate: 'जाँच करें',

      // --- 입출금 승인 ---
      admin_deposits_e9e567: 'जमा स्वीकृति',
      admin_deposits_48f252: 'जमा कतार',
      admin_deposits_df0901: 'on-chain जमा · confirmations · AML समीक्षा',
      admin_withdrawals_372dac: 'निकासी स्वीकृति',
      admin_withdrawals_d336c8: 'निकासी कतार',
      admin_withdrawals_4af6f5: '2FA पूर्ण · लंबित निकासी अनुरोध',

      // --- 지갑 / 자산 ---
      admin_assets_7c2e10: 'वॉलेट · जमा और निकासी स्वीकृति · एसेट संचलन',
      admin_assets_16f852: 'कुल वॉलेट बैलेंस (hot / cold)',
      admin_assets_d52d75: 'जमा और निकासी स्वीकृति कतार',
      admin_assets_293d08: 'एसेट संचलन · मिलान (रात्रि batch)',
      admin_assets_657644: 'AML अलर्ट फ़िल्टर',
      admin_assets_hi_fi_60cb06: 'वॉलेट · एसेट संचलन · मिलान',
      admin_assets_hi_fi_dc00b9: 'hot वॉलेट · एसेट अनुसार',
      admin_assets_hi_fi_24e2e8: 'cold वॉलेट · एसेट अनुसार',
      admin_assets_hi_fi_503c9d: 'तुरंत निकासी योग्य',
      admin_assets_hi_fi_4b4b97: 'उपयोगकर्ता बैलेंस के सापेक्ष',
      admin_assets_hi_fi_48aeb1: 'एसेट संचलन अनुरोध (hot → cold, cold → hot)',

      // --- AI Ops ---
      admin_a_i_ops_50ede2: '💡 v1.4.2, v1.3.9 की तुलना में hit rate 7pp बेहतर करता है। इस सप्ताहांत पूरा ट्रैफ़िक माइग्रेट करने का सुझाव है।',
      admin_a_i_ops_ed2648: '3 दिन पहले · Kuri Kwon',

      // --- 공지 에디터 ---
      admin_notice_editor_db8cc8: 'घोषणा लिखें',
      admin_notice_editor_3d991a: 'नई घोषणा · Markdown समर्थित',
      admin_notice_editor_a2ee94: 'घोषणा का शीर्षक',
      admin_notice_editor_c3d57e: 'मुख्य भाग (Markdown समर्थित)&#10;&#10;जैसे&#10;## उपशीर्षक&#10;अपनी सामग्री लिखें…&#10;- मद 1&#10;- मद 2&#10;&#10;**बोल्ड** · [लिंक](url)',
      admin_notice_editor_a8e5c8: '(कोई शीर्षक नहीं)',
      admin_notice_editor_c4c626: '(कोई सामग्री नहीं)',
      admin_notice_editor_0a94de: 'प्रकाशन विकल्प',
      admin_notice_editor_189dd9: '📌 सबसे ऊपर पिन करें',
      admin_notice_editor_a2fa30: 'सभी उपयोगकर्ताओं के लिए इन-ऐप बैनर',
      admin_notice_editor_41c60b: 'लैंडिंग पेज पर दिखाएँ',
      admin_notice_editor_492974: 'पुश सूचना',
      admin_notice_editor_61187b: 'ईमेल भेजें',
      admin_notice_editor_11a5df: '(प्रकाशित करते समय स्वतः सेट)',
      admin_notice_editor_102c1f: 'Kuri Kwon',
      admin_notice_editor_7148d7: 'प्रकाशित करें',

      // --- 전체 발송 (Broadcast) ---
      admin_broadcast_b7f563: 'इन-ऐप · ईमेल · पुश द्वारा सामूहिक प्रेषण',
      admin_broadcast_f724cc: 'संदेश लिखें',
      admin_broadcast_078b3a: 'विषय',
      admin_broadcast_a7bc1f: 'जैसे अगस्त रिबेट प्रोमोशन',
      admin_broadcast_c67b87: 'मुख्य भाग',
      admin_broadcast_1a8f0f: 'मुख्य भाग लिखें। Markdown समर्थित है (**बोल्ड** · `code` · [लिंक](url))।',
      admin_broadcast_90bbad: 'दर्शक वर्ग',
      admin_broadcast_95066f: 'सभी (1,242)',
      admin_broadcast_be1a1a: 'केवल Pro/VIP (642)',
      admin_broadcast_1395f0: 'KYC L3 (312)',
      admin_broadcast_050529: '7 दिनों में सक्रिय (820)',
      admin_broadcast_9c1758: 'कस्टम फ़िल्टर',
      admin_broadcast_7aeb7e: 'चैनल',
      admin_broadcast_4c0460: 'अनुमानित पहुँच',
      admin_broadcast_140c08: 'अनुमानित लागत:',
      admin_broadcast_626099: 'अभी भेजें',
      admin_broadcast_1a911b: 'शेड्यूल',
      admin_broadcast_265106: 'शेड्यूल करें',
      admin_broadcast_e6f9c4: 'ड्राफ़्ट सहेजें',
      admin_broadcast_f1f368: 'हाल में भेजे गए',
      admin_broadcast_743fe1: '📢 नियोजित मेंटेनेंस सूचना (1,242)',
      admin_broadcast_63c075: '🎉 अगस्त प्रोमोशन (1,242)',
      admin_broadcast_bc4cc1: '📄 सेवा शर्तों का अद्यतन (1,242)',
      admin_bc_recipients: 'प्राप्तकर्ता · {n} चैनल',

      // --- CS 티켓 ---
      admin_c_s_ticket_5c8747: 'टिकट विवरण',
      admin_c_s_ticket_5c50d9: 'उपयोगकर्ता',
      admin_c_s_ticket_65b9cf: 'उपयोगकर्ता प्रोफ़ाइल',
      admin_c_s_ticket_00ecd1: 'हाल के ट्रेड',
      admin_c_s_ticket_c65f61: 'बातचीत',
      admin_c_s_ticket_a6c22d: 'उत्तर लिखें…',
      admin_c_s_ticket_95bf7b: 'उत्तर भेजें',
      admin_c_s_ticket_3f0669: 'सहेजें (आंतरिक)',
      admin_c_s_ticket_15e878: 'त्वरित कार्रवाइयाँ',
      admin_c_s_ticket_efefae: 'तैयार उत्तर',
      admin_c_s_ticket_291781: 'नमस्ते। हम जाँच कर शीघ्र ही आपको उत्तर देंगे। प्रतीक्षा के लिए धन्यवाद।',
      admin_c_s_ticket_5be08a: 'आपके कुछ KYC दस्तावेज़ बहुत धुंधले स्कैन हुए हैं और उनकी पुनः समीक्षा आवश्यक है। कृपया यहाँ फिर से जमा करें: /kyc/resubmit',
      admin_c_s_ticket_165627: 'हाँ, कृपया पुष्टि करें।',
      admin_c_s_ticket_e31e52: ' — इस बारे में मेरा एक प्रश्न है। कई दिन बीत गए और कोई प्रगति नहीं हुई, मैं परेशान हूँ।',

      // --- Design Ops ---
      admin_design_ops_247f98: 'UI टोकन · कंपोनेंट · पेज प्रबंधन · नए पेज और कंपोनेंट दर्ज करें',
      admin_design_ops_127e5c: 'नए पेज, कंपोनेंट और डायलॉग बनाएँ और दर्ज करें',
      admin_design_ops_631818: 'नया पेज',
      admin_design_ops_ad367e: 'टेम्पलेट से शुरू करें',
      admin_design_ops_b31be6: 'नया कंपोनेंट',
      admin_design_ops_376325: 'कंपोनेंट कैटलॉग में जोड़ें',
      admin_design_ops_b1169b: 'नया डायलॉग / modal',
      admin_design_ops_23188a: 'modal स्निपेट कॉपी करें',
      admin_design_ops_454af0: 'वर्कफ़्लो · परंपराएँ',
      admin_design_ops_341930: 'गाइड दस्तावेज़',
    },
    { label: 'हिन्दी', bcp47: 'hi' },
  );
})();
