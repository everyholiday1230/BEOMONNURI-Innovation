/* ============================================================
   Filipino — 관리자 화면 (pages-admin.jsx / pages-admin-more.jsx) 사전
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
    'fil',
    {
      // --- 대시보드 / 목록 부제 ---
      admin_dashboard_0ccafd: 'Live na estado ng platform · mga anomalya · risk · AI · sistema',
      admin_users_3fefdf: 'Hanapin ang pangalan · email · ID',
      admin_trades_bc077b: 'Live na order · fills · pagtukoy ng anomalya',
      admin_risk_a1edf2: 'Exposure ng posisyon · pila ng liquidation · risk sa merkado',
      admin_fees_65feac: 'Mga fee tier · rebate · promo · payback',
      admin_notices_15d236: 'Mga anunsyo',
      admin_notices_11300f: 'Maglabas ng anunsyo · pamahalaan ang mga tanong ng customer',

      // --- 사용자 상세 ---
      admin_user_detail_106e43: 'Hanapin · i-filter · i-export sa CSV',
      admin_user_detail_170f7b: 'Sumali noong',
      admin_user_detail_22d6d2: 'Volume sa 30 araw',
      admin_user_detail_33103c: 'Kabuuang bayad',
      admin_user_detail_3f4319: 'ID document',
      admin_user_detail_0057bd: 'Mga dokumentong KYC',
      admin_user_detail_43a4e1: 'Log ng aktibidad',
      admin_user_detail_8f5d10: 'Log ng aktibidad · huling 20 entry',
      admin_user_detail_8797eb: 'Kasaysayan ng trade',
      admin_user_detail_80a094: 'Kasaysayan ng trading',
      admin_user_detail_81922a: 'Mga posisyon',
      admin_user_detail_40ce13: 'Mga asset',
      admin_user_detail_e4ec3e: 'Tingnan ang mga asset',
      admin_user_detail_a5e5da: 'Seguridad',
      admin_user_detail_8dd7e4: 'Mga kaganapan sa seguridad',
      admin_user_detail_915cf6: 'Mga tala ng operator',
      admin_user_detail_f35682: 'Tala ng operator (naitatala sa audit log)',
      admin_user_detail_12614e: 'Timeline · pinagsamang view',
      admin_user_detail_d65b24: 'Awtomatikong kinakalkula',
      admin_user_detail_44650a: 'Iba pa',
      admin_user_detail_a43b70: 'Resulta ng review ng KYC',
      admin_user_detail_a74a3f: 'Kailangan ng muling KYC verification',
      admin_user_detail_851473: 'Humiling muli ng KYC',
      admin_user_detail_219da4: 'I-promote sa L3',
      admin_user_detail_afc528: 'Humiling ng muling review',
      admin_user_detail_a1d12d: 'Natukoy na may anomalyang trading',
      admin_user_detail_2d003e: 'Isyu sa AML/CTF',
      admin_user_detail_ca5360: 'Kahilingan ng user',
      admin_user_detail_63c279: 'Dahilan',
      admin_user_detail_96330a: 'Mensahe',
      admin_user_detail_941ad1: 'Magpadala ng email',
      admin_user_detail_04f2aa: 'I-email ang reset link',
      admin_user_detail_e03d2f: 'I-reset ang 2FA',
      admin_user_detail_82d3e7: 'I-suspend ang account',
      admin_user_detail_94cd06: '⚠ I-suspend ang account',
      admin_user_detail_1d441e: 'I-suspend',
      admin_user_detail_f63bf7: 'Alisin ang suspensyon',
      admin_user_detail_ebe503: 'Sigurado ka bang isususpinde ang user na ito?',
      admin_user_detail_bd464c: 'Kapag sinuspinde, awtomatikong ipapaalam sa user sa email at naitatala ang aksyon sa audit log.',
      admin_user_detail_ff8aa0: 'Kumpirmahin ang suspensyon',
      admin_user_detail_19b2d1: 'Kanselahin',
      admin_user_detail_4def42: 'Sinuspinde ang user (simulation)',
      admin_user_tab_data: 'Ipinapakita ang {tab} na data ng user na ito',
      admin_users_subtitle: '{n} user sa kabuuan · KYC · mga permiso · suspensyon · audit',

      // --- KYC 심사 ---
      admin_k_y_c_queue_46072a: 'Review ng KYC',
      admin_k_y_c_queue_d167fe: 'Dohyun Kim',
      admin_kyc_sla: '{pending} nakabinbin · SLA 24h',
      flag_auto_detected: ' · awtomatikong natukoy · ',
      flag_investigate: 'imbestigahan',

      // --- 입출금 승인 ---
      admin_deposits_e9e567: 'Pag-apruba ng deposito',
      admin_deposits_48f252: 'Pila ng deposito',
      admin_deposits_df0901: 'Mga on-chain na deposito · confirmations · review ng AML',
      admin_withdrawals_372dac: 'Pag-apruba ng withdrawal',
      admin_withdrawals_d336c8: 'Pila ng withdrawal',
      admin_withdrawals_4af6f5: 'Kumpleto ang 2FA · mga nakabinbing kahilingan sa withdrawal',

      // --- 지갑 / 자산 ---
      admin_assets_7c2e10: 'Mga wallet · pag-apruba ng deposito at withdrawal · paggalaw ng asset',
      admin_assets_16f852: 'Kabuuang balanse ng wallet (hot / cold)',
      admin_assets_d52d75: 'Pila ng pag-apruba ng deposito at withdrawal',
      admin_assets_293d08: 'Paggalaw ng asset · reconciliation (batch tuwing gabi)',
      admin_assets_657644: 'Filter ng AML alert',
      admin_assets_hi_fi_60cb06: 'Mga wallet · paggalaw ng asset · reconciliation',
      admin_assets_hi_fi_dc00b9: 'Hot wallet · ayon sa asset',
      admin_assets_hi_fi_24e2e8: 'Cold wallet · ayon sa asset',
      admin_assets_hi_fi_503c9d: 'Agad na maaaring i-withdraw',
      admin_assets_hi_fi_4b4b97: 'Kontra sa balanse ng mga user',
      admin_assets_hi_fi_48aeb1: 'Kahilingan sa paggalaw ng asset (hot → cold, cold → hot)',

      // --- AI Ops ---
      admin_a_i_ops_50ede2: '💡 Mas mataas ng 7pp ang hit rate ng v1.4.2 kaysa v1.3.9. Inirerekomenda na ilipat ang buong traffic ngayong weekend.',
      admin_a_i_ops_ed2648: '3 araw ang nakalipas · Kuri Kwon',

      // --- 공지 에디터 ---
      admin_notice_editor_db8cc8: 'Gumawa ng anunsyo',
      admin_notice_editor_3d991a: 'Bagong anunsyo · suportado ang Markdown',
      admin_notice_editor_a2ee94: 'Pamagat ng anunsyo',
      admin_notice_editor_c3d57e: 'Nilalaman (suportado ang Markdown)&#10;&#10;hal.&#10;## Subheading&#10;Isulat ang nilalaman…&#10;- Item 1&#10;- Item 2&#10;&#10;**bold** · [link](url)',
      admin_notice_editor_a8e5c8: '(walang pamagat)',
      admin_notice_editor_c4c626: '(walang nilalaman)',
      admin_notice_editor_0a94de: 'Mga opsyon sa paglabas',
      admin_notice_editor_189dd9: '📌 I-pin sa itaas',
      admin_notice_editor_a2fa30: 'In-app banner para sa lahat ng user',
      admin_notice_editor_41c60b: 'Ipakita sa landing page',
      admin_notice_editor_492974: 'Push notification',
      admin_notice_editor_61187b: 'Magpadala ng email',
      admin_notice_editor_11a5df: '(awtomatikong itinatakda kapag inilabas)',
      admin_notice_editor_102c1f: 'Kuri Kwon',
      admin_notice_editor_7148d7: 'Ilabas',

      // --- 전체 발송 (Broadcast) ---
      admin_broadcast_b7f563: 'Broadcast sa in-app · email · push',
      admin_broadcast_f724cc: 'Gumawa ng mensahe',
      admin_broadcast_078b3a: 'Paksa',
      admin_broadcast_a7bc1f: 'hal. promo ng rebate sa Agosto',
      admin_broadcast_c67b87: 'Nilalaman',
      admin_broadcast_1a8f0f: 'Isulat ang nilalaman. Suportado ang Markdown (**bold** · `code` · [link](url)).',
      admin_broadcast_90bbad: 'Tatanggap',
      admin_broadcast_95066f: 'Lahat (1,242)',
      admin_broadcast_be1a1a: 'Pro/VIP lang (642)',
      admin_broadcast_1395f0: 'KYC L3 (312)',
      admin_broadcast_050529: 'Aktibo sa loob ng 7 araw (820)',
      admin_broadcast_9c1758: 'Custom na filter',
      admin_broadcast_7aeb7e: 'Mga channel',
      admin_broadcast_4c0460: 'Tinatayang maabot',
      admin_broadcast_140c08: 'Tinatayang gastos:',
      admin_broadcast_626099: 'Ipadala ngayon',
      admin_broadcast_1a911b: 'I-schedule',
      admin_broadcast_265106: 'I-schedule ito',
      admin_broadcast_e6f9c4: 'I-save ang draft',
      admin_broadcast_f1f368: 'Kasalukuyang naipadala',
      admin_broadcast_743fe1: '📢 Abiso ng nakaskedyul na maintenance (1,242)',
      admin_broadcast_63c075: '🎉 Promo ng Agosto (1,242)',
      admin_broadcast_bc4cc1: '📄 Update sa terms of service (1,242)',
      admin_bc_recipients: 'tatanggap · {n} channel',

      // --- CS 티켓 ---
      admin_c_s_ticket_5c8747: 'Detalye ng ticket',
      admin_c_s_ticket_5c50d9: 'User',
      admin_c_s_ticket_65b9cf: 'Profile ng user',
      admin_c_s_ticket_00ecd1: 'Mga kasalukuyang trade',
      admin_c_s_ticket_c65f61: 'Usapan',
      admin_c_s_ticket_a6c22d: 'Magsulat ng sagot…',
      admin_c_s_ticket_95bf7b: 'Ipadala ang sagot',
      admin_c_s_ticket_3f0669: 'I-save (internal)',
      admin_c_s_ticket_15e878: 'Mabilisang aksyon',
      admin_c_s_ticket_efefae: 'Mga macro na sagot',
      admin_c_s_ticket_291781: 'Kumusta. Titingnan namin ito at babalikan kayo sa lalong madaling panahon. Salamat sa paghihintay.',
      admin_c_s_ticket_5be08a: 'Masyadong malabo ang scan ng ilan sa mga dokumentong KYC mo kaya kailangang muling suriin. Isumite muli dito: /kyc/resubmit',
      admin_c_s_ticket_165627: 'Oo, kumpirmahin po.',
      admin_c_s_ticket_e31e52: ' — May tanong ako tungkol dito. Ilang araw na at walang umuusad, at nabibigo na ako.',

      // --- Design Ops ---
      admin_design_ops_247f98: 'Mga UI token · component · pamamahala ng page · irehistro ang bagong page at component',
      admin_design_ops_127e5c: 'Gumawa at magrehistro ng bagong page, component at dialog',
      admin_design_ops_631818: 'Bagong page',
      admin_design_ops_ad367e: 'Magsimula sa isang template',
      admin_design_ops_b31be6: 'Bagong component',
      admin_design_ops_376325: 'Idagdag sa katalogo ng component',
      admin_design_ops_b1169b: 'Bagong dialog / modal',
      admin_design_ops_23188a: 'Kopyahin ang snippet ng modal',
      admin_design_ops_454af0: 'Workflow · mga kombensiyon',
      admin_design_ops_341930: 'Dokumentong gabay',
    },
    { label: 'Filipino', bcp47: 'fil-PH' },
  );
})();
