/* ============================================================
   Filipino — 메인 사전 (src/locales/en.js 대응)
   ------------------------------------------------------------
   키는 en.js 와 완전히 동일하다. 값만 번역한다.

   ★ 이 파일은 2,500키가 넘어 register() 블록을 여러 번 나눠 붙였다.
     register 는 Object.assign 으로 합치므로 블록이 몇 개든 결과는 같다.

   ★ 치환자는 그대로 남긴다: {qty} {base} {quote} {q} {step} {total} {n}
     {pct} {symbol} {brand} {email} {min} {cur} {ok} …
   ★ 문장 조각 키(_pre/_em/_post, _a/_b/_c, sec_tip_*, wiz_*, a11y_* 등)는
     화면에서 이어 붙는다. 앞뒤 공백 위치를 그대로 두고 어순만 맞춘다.

   ★ 필리핀 사용자는 영어·타갈로그 혼용(Taglish)이 실제 사용 형태다. 금융·기술
     용어(order, long, short, stop, entry, API key, KYC, funding, margin, PnL,
     liquidation, backtest, order book)는 영어를 유지한다 — 억지 번역 금지.
   ★ locale 코드는 'fil'. 'tl-PH' 로만 설정된 브라우저는 자동감지에 걸리지
     않지만 헤더의 언어 목록에서 직접 고를 수 있다.

   ★ 절대 부드럽게 고치지 말 것:
     - 비수탁: 자금은 고객의 거래소 계정에 있다. 출금 권한은 '의도적으로' 제외한다.
       지갑도 입금 주소도 없다.
     - 수익 보장 없음 / 투자 조언 아님.
     - 측정되지 않은 값은 지어내지 않는다(null 은 '실행 안 됨'이지 0 이 아니다).
     - 실패 메시지는 "아무것도 저장/전송되지 않았다"를 반드시 남긴다.
     - na_* / kyc_na_* 는 '구조상 없음'이지 '아직 없음'이 아니다 — 'pa' 넣지 말 것.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'fil',
    {
      // --- 입력 필드 라벨 ---
      fld_email: 'Email',
      fld_password: 'Password',
      fld_confirm: 'Kumpirmahin',
      fld_country: 'Bansa',
      fld_first_name: 'Pangalan',
      fld_last_name: 'Apelyido',
      fld_address: 'Address',
      fld_city: 'Lungsod',
      fld_postal: 'Postal code',
      fld_label: 'Label',
      fld_api_key: 'API Key',
      fld_api_secret: 'API Secret',
      fld_passphrase: 'Passphrase',
      fld_amount: 'Halaga',
      fld_symbol: 'Symbol',
      fld_from: 'Mula',
      fld_to: 'Hanggang',
      fld_initial_capital: 'Panimulang kapital',
      fld_position_size: 'Laki ng position',
      fld_max_concurrent: 'Pinakamaraming sabay',
      fld_stop_copy_dd: 'Ihinto ang copy sa drawdown na',
      fld_note: 'Tala',
      fld_date: 'Petsa',
      fld_time_utc: 'Oras (UTC)',
      fld_price: 'Presyo',
      fld_trigger: 'Trigger',
      fld_size: 'Laki',
      fld_tp: 'TP',
      fld_sl: 'SL',
      fld_2fa_code: '2FA Code',
      fld_auto_copy: 'Auto-copy',
      fld_required_margin: 'Kailangang margin',
      fld_email_ph: 'ikaw@halimbawa.com',

      // --- 주문 입력 ---
      oe_pay_amount: 'Halagang bibilhin',
      oe_margin_amount: 'Margin',
      oe_max: 'Max',
      oe_max_buyable: 'Pinakamaraming mabibili: {qty} {base}  ·  balanse {quote} {q}',
      oe_equiv_spot: 'Babayaran {q} {quote} → bibili ng {qty} {base}',
      oe_equiv_futures:
        'Margin {margin} {quote} × {lev}x → position {notional} {quote} = {qty} {base}',
      oe_err_no_exchange:
        'Ikonekta muna ang exchange account mo — sa sarili mong exchange tumatakbo ang order, '
        + 'kaya kailangan namin ang API keys mo bago ka makapag-trade.',
      oe_tpsl_spot_note:
        'Hindi kayang magdala ng TP/SL ang spot order sa entry — wala nitong daan sa exchange. '
        + 'Bumili muna, pagkatapos maglagay ng OCO exit. Sinusuportahan ito ng futures.',
      oe_tp_pnl: 'Tubo sa TP',
      oe_sl_pnl: 'Lugi sa SL',
      oe_err_tp_long:
        'Para sa long, ang take profit ay dapat NASA ITAAS ng entry price. Sa ganitong setting, '
        + 'agad itong magsasara nang lugi.',
      oe_err_tp_short:
        'Para sa short, ang take profit ay dapat NASA IBABA ng entry price. Sa ganitong setting, '
        + 'agad itong magsasara nang lugi.',
      oe_err_sl_long: 'Para sa long, ang stop loss ay dapat NASA IBABA ng entry price.',
      oe_err_sl_short: 'Para sa short, ang stop loss ay dapat NASA ITAAS ng entry price.',
      oe_order_value: 'Halaga ng order',
      oe_est_fee: 'Tantiyang fee',
      oe_est_fee_pct: 'Tantiyang fee ({pct}%)',
      oe_est_liq: 'Tantiyang liq. price',
      oe_avail_after: 'Matitira pagkatapos ng order',

      // --- 추천 리베이트 (아직 시작 안 함) ---
      ref_rebate_pending_title: 'Hindi pa nagsisimula ang rebate sharing',
      ref_rebate_pending_body:
        'Nasusubaybayan na ang pag-imbita ng kaibigan mula ngayon, pero wala pang rebate share na '
        + 'ibabayad — kaya walang rate, payout threshold o settlement date na ipinapangako dito. Kung '
        + 'may tumatakbong points reward, nakalagay ito sa itaas. Ilalagay namin ang mga tuntunin dito '
        + 'bago magsimula ang anumang sharing.',

      // --- 구글 로그인 ---
      login_google: 'Magpatuloy gamit ang Google',
      login_google_failed:
        'Hindi natapos ang Google sign-in ({reason}). Subukan muli o gamitin ang email at password mo.',

      // --- 오류 경계 ---
      err_boundary_title: 'Hindi maipakita ang screen na ito',
      err_boundary_body:
        'Maaaring pansamantala lang ito. Subukan ang mga hakbang sa baba nang sunod-sunod. Kung '
        + 'paulit-ulit itong nangyayari, maaaring sira na ang naka-save na settings mo.',
      err_boundary_retry: 'Subukan muli',
      err_boundary_reload: 'I-reload',
      err_boundary_reset: 'I-reset ang settings at i-reload (mananatili kang naka-sign in)',

      // --- 마법사 / 할 일 ---
      wiz_step_of: 'Hakbang {step} sa {total}',
      todo_title: 'Gagawin',

      // --- Tweaks 패널 ---
      tw_1_preset: '1. Layout preset',
      tw_2_density: '2. Density',
      tw_3_mode: '3. Mode',
      tw_4_theme: '4. Theme',
      tw_5_longshort: '5. Long / Short',
      tw_6_brand: '6. Brand palette',
      tw_7_language: '7. Wika',
      tw_8_numfmt: '8. Format ng numero',

      // --- 레이아웃 편집 ---
      lay_drag: 'I-drag para ilipat',
      lay_unlock: 'I-unlock',
      lay_duplicate: 'I-duplicate',
      lay_maximize: 'Palakihin',
      lay_hide: 'Itago',
      lay_library: 'Library',
      lay_library_title: 'Library ng nakatagong widget',
      lay_undo_hint: 'I-undo (Ctrl+Z)',
      lay_redo_hint: 'I-redo (Ctrl+Shift+Z)',
      lay_reset_hint: 'Ibalik sa default ng preset',
      lay_add_new: 'Magdagdag',
      lay_locked: 'Naka-lock',
      lay_hidden_widgets: 'Nakatagong widget',

      // --- 주문 미리보기 열 ---
      op_side_type: 'Side / Type',
      op_notional: 'Notional',
      op_leverage: 'Leverage',
      op_take_profit: 'Take profit',
      op_stop_loss: 'Stop loss',
      toggle_theme: 'Palitan ang light / dark',
      open_tweaks: 'Buksan ang settings ng anyo',

      // --- 주문 단계 ---
      op_risk_title: 'Risk check · bago isumite',
      op_step_1: '1. AI analysis',
      op_step_2: '2. Pagsusuri mo',
      op_step_3: '3. Aprubahan',
      op_step_4: '4. Preview',
      op_step_5: '5. Risk check',
      op_step_6: '6. Huling kumpirmasyon',
      op_step_7: '7. Naisumite',

      // --- 국가 ---
      country_kr: '🇰🇷 South Korea',
      country_us: '🇺🇸 Estados Unidos',
      country_jp: '🇯🇵 Japan',
      country_cn: '🇨🇳 China',
      country_tw: '🇹🇼 Taiwan',
      country_sg: '🇸🇬 Singapore',
      country_hk: '🇭🇰 Hong Kong',
      country_gb: '🇬🇧 United Kingdom',
      country_de: '🇩🇪 Germany',
      country_other: '🌐 Iba pa',
      country_search_ph: 'Mag-type para maghanap ng bansa…',
      country_search_open: 'Piliin ang bansa mo',
      country_no_match: 'Walang bansang tumutugma sa “{q}”.',
      country_guessed: 'Hinulaan mula sa browser mo — tingnan mo kung tama.',
      country_count: '{n} bansa',

      // --- 거래소 연결 대기 ---
      ex_connect_pending_bitmart:
        'Hindi pa handa ang koneksyon sa BitMart. May broker agreement kami sa BitMart at umaandar ang '
        + 'exchange, pero ginagawa pa ang integration namin para dito — KuCoin lang ang maikokonekta ngayon.',

      // --- 인증 화면 / 랜딩 ---
      auth_hero_badge: 'Software para sa AI chart analysis',
      landing_exchanges_title: 'Mga suportadong exchange',
      demo_label: 'Demo:',
      nf_title_attr: '404 · Hindi natagpuan',
      sig_none: 'Walang AI signal',
    },
    { label: 'Filipino', bcp47: 'fil-PH' },
  );
})();

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'fil',
    {
      // --- 관심목록 / 마켓 ---
      wl_search_ph: 'Maghanap ng symbol…',
      wl_price_vol: 'Presyo / Vol',
      wl_pair: 'Pair',
      mk_perp_usdt: 'Perpetual · USDT-margined',
      wg_alerts: 'Alerts',

      // --- 공유 ---
      sh_share_link: 'Ibahagi ang market na ito',
      sh_link_copied: 'Nakopya ang link',
      sh_copy_symbol: 'Kopyahin ang symbol',
      sh_symbol_copied: 'Nakopya ang symbol',
      sh_copy_price: 'Kopyahin ang huling presyo',
      sh_price_copied: 'Nakopya ang presyo',
      sh_no_price: 'Wala pang presyo — hindi pa dumating ang market data',
      sh_open_exchange: 'Buksan sa exchange',
      landing_foot_board: 'Inquiry board',

      // --- 이메일 인증 ---
      verify_processing: 'Bineberipika ang email mo…',
      verify_success: 'Beripikado na ang email mo. Maaari ka nang mag-sign in.',
      verify_failed:
        'Ang verification link na ito ay hindi balido o expired na. Mag-sign in muli para makatanggap ng bago.',
      verify_check_email:
        'Nagpadala kami ng verification link sa email mo. Buksan ito para maberipika ang address mo, '
        + 'pagkatapos mag-sign in. Maaaring tumagal ng isang minuto — tingnan din ang spam.',
      verify_go_login: 'Pumunta sa sign in',
      verify_resend_login:
        'Mag-sign in muli at awtomatikong ipapadala naming muli ang verification email.',

      // --- 비밀번호 재설정 ---
      pwreset_new_hint: 'Pumili ng bagong password para sa account mo (kahit 10 karakter).',
      pwreset_new_pw: 'Bagong password',
      pwreset_new_pw2: 'Kumpirmahin ang bagong password',
      pwreset_submit: 'Itakda ang bagong password',
      pwreset_too_short: 'Ang password ay dapat kahit 10 karakter.',
      pwreset_mismatch: 'Hindi magkatugma ang dalawang password.',
      pwreset_link_invalid:
        'Ang reset link na ito ay hindi balido o expired na. Humiling ng bago sa sign-in page.',
      pwreset_done: 'Napalitan na ang password mo. Maaari ka nang mag-sign in.',

      // --- 문의 불러오기 실패 ---
      help_tickets_load_failed:
        'Hindi ma-load ang mga mensahe mo. Hindi ito nawala — problema lang ito sa pag-load.',
      help_thread_load_failed: 'Hindi ma-load ang usapang ito.',

      // --- 관리자: 이메일 확인 상태 ---
      adm_email_verified: 'EMAIL OK',
      adm_email_unverified: 'EMAIL HINDI BERIPIKADO',
      adm_email_verified_hint: 'Kinumpirma na ng user ang address na ito.',
      adm_email_unverified_hint:
        'Hindi pa kinumpirma — hindi makakapag-sign in ang user na ito hangga\u2019t hindi nila binuksan ang verification link.',

      // --- 포지션 계산기 ---
      calc_title: 'Position calculator',
      calc_entry: 'Entry price (USDT)',
      calc_qty: 'Dami',
      calc_leverage: 'Leverage (x)',
      calc_exit: 'Exit / target price (opsyonal)',
      calc_exit_ph: 'para sa P&L',
      calc_position_value: 'Halaga ng position',
      calc_initial_margin: 'Panimulang margin',
      calc_liq_price: 'Tantiyang liquidation price',
      calc_pnl: 'P&L sa exit',
      calc_roe: 'Kita sa margin (ROE)',
      calc_liq_note:
        'Ang liquidation price ay tantiya para sa isolated margin — hindi kasama ang fee, funding at '
        + 'ang maintenance-margin tiers ng exchange. Ang exchange mo ang nagtatakda ng totoong halaga.',
      calc_enter_values: 'Ilagay ang entry price, dami at leverage para makalkula.',

      // --- 가격 알림 ---
      alert_title: 'Price alert',
      alert_above: 'Umakyat sa ≥',
      alert_below: 'Bumaba sa ≤',
      alert_target: 'Target price (USDT)',
      alert_notify_email: 'I-email din sa akin',
      alert_create: 'Gumawa ng alert',
      alert_created: 'Nagawa ang alert. Sasabihan ka namin kapag ito ay tumama.',
      alert_create_failed: 'Hindi nagawa ang alert.',
      alert_target_invalid: 'Maglagay ng target price na higit sa 0.',
      alert_my_active: 'Mga aktibong alert ko ({n})',
      alert_none: 'Wala pang aktibong alert.',
      alert_cancel: 'Kanselahin',
      alert_load_failed: 'Hindi ma-load ang mga alert mo.',
      alert_unsupported: 'Hindi available ang price alerts sa deployment na ito.',

      // --- 관리자: 사용자에게 이메일 ---
      adm_email_title: 'I-email ang user',
      adm_email_subject: 'Subject',
      adm_email_body_ph: 'Isulat ang mensaheng ipapadala sa user na ito…',
      adm_email_send: 'Ipadala ang email',
      adm_email_sent: 'Naipadala ang email sa user.',
      adm_email_failed: 'Hindi naipadala ang email.',
      adm_email_not_configured:
        'Hindi naka-configure ang email sa deployment na ito, kaya walang naipadala.',
      adm_email_need_fields: 'Maglagay ng subject at mensahe.',

      // --- 지갑 / 잔고 ---
      wal_balances_connect_first:
        'Ikonekta ang exchange key para makita ang balanse mo. Ang totoong balanse mo mula sa exchange '
        + 'ang ipinapakita namin — wala munang lalabas hangga\u2019t hindi ito nakakonekta.',
      wal_balances_empty: 'Walang natagpuang balanse sa nakakonektang exchange account mo.',
      wal_spot_title: 'Spot account',
      wal_spot_sub: 'Ang KuCoin spot (trading) account mo — hiwalay sa futures.',
      wal_spot_unsupported: 'Hindi available ang spot balances sa deployment na ito.',
      wal_spot_empty:
        'Walang spot balance. Lalabas dito ang pondong ide-deposito mo sa spot account.',
      col_total: 'Kabuuan',

      // --- 포인트 ---
      points_unit_default: 'puntos',
      ref_terms_points_sub:
        'Ikinredito ang puntos kapag nag-sign up ang inimbita mo — magagamit sa AI runs at features.',

      // --- AI 오류 / 상태 ---
      ai_stream_error: 'Nabigo ang AI response: {msg}',
      ai_unsafe_output:
        'Pinigil ang sagot na ito dahil hindi ito pumasa sa safety check namin (halimbawa, may '
        + 'ipinahiwatig na garantisadong tubo, o may sinabing pananaw habang luma na ang market data). '
        + 'Magtanong muli.',
      ai_need_points: 'Kailangan mo ng puntos para patakbuhin ang AI. Buksan ang Puntos para mag-top up.',
      ai_cmd_applied: 'Nailapat sa chart',
      ai_indicator_added: 'Naidagdag ang {name} indicator',
      ai_indicator_unsupported: 'Hindi suportado ang indicator: {name}',
      ai_indicator_removed: 'Naalis ang {name} indicator',
      ai_overlay_removed: 'Naalis ang overlay',
      ai_overlay_hidden: 'Nakatago ang overlay — nandiyan pa ito, hindi lang naguguhit',
      ai_err_session:
        'Kailangang i-refresh ang session mo. I-reload ang page at magtanong muli — nasa iyo pa rin ang usapan.',
      ai_err_signin: 'Mag-sign in muli para magpatuloy.',
      ai_err_disabled: 'Nakapatay ang AI assistant ngayon. Subukan muli mamaya.',
      ai_err_unavailable: 'Hindi available ang AI assistant ngayon. Subukan muli sa ilang sandali.',
      ai_err_network: 'Nawala ang koneksyon bago natapos ang sagot. Magtanong muli.',
      ai_err_ungrounded:
        'Hindi ko nabasa ang live market data, kaya hindi ako nagbigay ng price levels. Karaniwang '
        + 'umuubra ang muling pagtatanong — hindi ako magbibigay ng levels na hindi ko mabeberipika.',
      ai_err_invalid:
        'May sinubukan akong iguhit na hindi pumasa sa validation, kaya walang naguhit. Magtanong muli, '
        + 'mas mainam kung may presyong nasa isip mo.',
      ai_err_injection:
        'Mukhang tangka ang mensaheng iyon na baguhin ang mga instruksyon ko, kaya hindi ko ito '
        + 'pinroseso. Sabihin muli sa ibang paraan kung ano ang gusto mong tingnan.',
      ai_err_stream: 'May nasira habang isinusulat ang sagot. Magtanong muli.',
      ai_err_generic:
        'May nagkamali at hindi natapos ang sagot. Magtanong muli. (ref: {code})',
      ai_cmd_unknown:
        'Hindi ko nailapat ang "{command}" — hindi pa suportado ang chart action na ito, kaya walang naguhit.',
      ai_chip_fib_cmd: 'Iguhit ang Fibonacci retracement levels sa kasalukuyang swing.',
      ai_chip_rr_cmd: 'Tantiyahin ang risk/reward para sa isang makatuwirang setup dito.',

      // --- 동의 항목 ---
      consent_all: 'Sumasang-ayon ako sa lahat ng nasa itaas',
      consent_required: '(kailangan)',
      consent_optional: '(opsyonal)',
      consent_expand: 'buksan',
      consent_collapse: 'isara',
      consent_read_full: 'Basahin ang buong dokumento',
      consent_terms: 'Mga Tuntunin ng Serbisyo',
      consent_terms_body:
        'Ang mga patakaran sa paggamit ng Serbisyo: ano ang ibinibigay namin, ano ang hindi, at ang hangganan '
        + 'ng responsibilidad namin. Software ito para sa analysis — ikaw ang naglalagay ng sarili mong order '
        + 'sa sarili mong exchange account.',
      consent_privacy: 'Pagkolekta at paggamit ng personal na data',
      consent_privacy_body:
        'Email address, bansa, sign-in records at ang datos na kailangan para patakbuhin ang Serbisyo. '
        + 'Kailangan ito para maibigay ang Serbisyo — hindi namin mapapatakbo ang account mo nang wala ito.',
      consent_risk: 'Pagsisiwalat ng risk sa leveraged trading',
      consent_risk_body:
        'Sa leveraged trading, maaari kang malugi ng higit pa sa idineposito mo, at mabilis mangyari ang '
        + 'liquidation. Walang anumang bahagi ng Serbisyong ito ang payo sa pag-iinvest, at walang '
        + 'kinalabasang ginagarantiyahan.',
      consent_ai_training: 'Paggamit ng trading records ko para i-train ang AI',
      consent_ai_training_body:
        'Ang mga order mo, ang mga indicator na bukas noon, at kung paano napunta ang mga trade na iyon — '
        + 'gagamitin para i-train ang AI namin matapos ang pseudonymisation. Pareho lang gumagana ang '
        + 'assistant kung tumanggi ka, at maaari mo itong baguhin anumang oras.',
      consent_marketing: 'Mga mensaheng marketing at promo',
      consent_marketing_body:
        'Bagong features, guides at offers sa email. Walang nagbabago sa Serbisyo kung tatanggi ka, at '
        + 'maaari kang mag-unsubscribe anumang oras.',

      // --- AI 학습 동의 요청 ---
      ai_training_ask_title: 'Maaari ba kaming mag-aral mula sa trading records mo?',
      ai_training_ask_body:
        'Gusto naming gamitin ang mga order mo, ang mga indicator na bukas noon, at kung paano napunta ang '
        + 'mga trade na iyon para i-train ang AI namin. Pinapa-pseudonymise muna ang records mo. Opsyonal '
        + 'ito — pareho lang gumagana ang assistant sa alinmang paraan, at maaari mong baguhin ang sagot mo '
        + 'anumang oras.',
      ai_training_ask_yes: 'Oo, maaari',
      ai_training_ask_no: 'Huwag na lang',
    },
    { label: 'Filipino', bcp47: 'fil-PH' },
  );
})();
