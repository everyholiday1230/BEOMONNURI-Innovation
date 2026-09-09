/* ============================================================
   English — AI Copilot 사전
   ------------------------------------------------------------
   기준 언어. Copilot 의 사고 단계·응답문·의도 키워드가 모두 여기에 있다.

   중요: 응답문은 마크다운을 포함한다 (**강조**, - 목록). 번역 시 마크다운
   기호는 유지해야 하며, 숫자와 통화 표기는 해당 지역 관례에 맞춰도 된다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'en',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: 'Collecting chart data · BTC/USDT 15m · 220 candles',
      ai_think_swinglow: 'Detecting recent swing lows (checking for RSI divergence)',
      ai_think_trendcand: 'Two or more lows found → computing trendline candidates',
      ai_think_mtf: 'Checking multi-timeframe alignment (15m / 1H / 4H)',
      ai_think_atr: 'Computing entry and stop distance from ATR',
      ai_think_rr: 'Simulating three R:R-optimised candidates',
      ai_think_swings: 'Scanning major swing highs and lows',
      ai_think_volnodes: 'Extracting high-volume nodes',
      ai_think_context: 'Reading context',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: 'Context loaded. {symbol} · {tf} · {bars} candles.',
      ai_ctx_loaded_ind: 'Context loaded. {symbol} · {tf} · {bars} candles · {n} indicator(s) active.',
      ai_welcome_beginner:
        "Hello, this is the {brand} Copilot. I'm analysing the **{symbol}** chart. "
        + 'Ask me anything in plain words and I can draw trendlines, support and resistance directly on the chart, '
        + 'and suggest entry, stop-loss and take-profit levels. I am a tool — real orders are only ever placed after your final approval.',
      ai_welcome_pro:
        'Copilot ready. Symbol: **{symbol}** · TF: **{tf}** · Last: **{price}** · Data as of {time}. '
        + 'Ask for trend lines, S/R, entry/SL/TP, R:R.',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 Draft trendline added to chart · layer: AI Draft',
      /*
         ★★ 무엇을 **어느 가격에** 그렸는지 말한다.

           전에는 6개 명령이 'Applied to chart' 만 돌려줬다. 고객은 무엇이 어디에
           그려졌는지 알 수 없어 차트를 눈으로 뒤져야 했다.

         ★★ 그리고 ai_tool_sr 은 '2 levels added' 였다 — 이 명령은 선을 **한 개**
           그린다. 개수를 문구에 박아 사실과 다른 보고가 나갔다('5 overlays created'
           사고와 같은 종류다). 이제 개수·종류·가격을 전부 실제 인자에서 만든다.

         ★ 가격을 함께 적는 이유: "지지선 그렸습니다" 만으로는 고객이 자기가 생각한
           자리에 그려졌는지 확인할 수 없다. 확인할 수 없는 보고는 보고가 아니다.
      */
      /*
         ★★ 반영된 것과 반영되지 않은 것을 **둘 다** 말한다.

           색·굵기는 렌더러가 읽지 않는다(출처로만 정해진다). 운영 결정으로 지원하지
           않기로 했으므로, 지원하지 않는다고 말해야 한다 — 조용히 성공한 척하는 것이
           이 저장소가 반복해서 고쳐 온 실패다.
      */
      ai_overlay_updated: '✏️ Updated {fields}',
      ai_overlay_updated_partial: '✏️ Updated {done}. Could not change {skipped} — line colour and thickness are set by the chart and are not adjustable.',
      ai_overlay_update_unsupported: 'I could not change {fields}. Line colour and thickness are set by the chart (AI drafts are dashed, your own lines are solid) and cannot be adjusted from here.',
      ai_drew_trendline: '📐 Drew a trendline from {from} to {to}',
      ai_drew_level: '📍 Drew a level at {price}',
      ai_drew_support: '📍 Drew support at {price}',
      ai_drew_resistance: '📍 Drew resistance at {price}',
      ai_drew_entry_zone: '🎯 Drew the entry zone {lo} – {hi}',
      ai_drew_stop: '🛑 Drew the stop-loss line at {price}',
      ai_drew_target: '🎯 Drew target {n} at {price}',
      ai_drew_invalidation: '⚠ Drew the invalidation level at {price}',
      ai_drew_long_marker: '▲ Marked long at {price}',
      ai_drew_short_marker: '▼ Marked short at {price}',
      /*
         ★ AI 가 답하기 전 진행 단계. 서버가 보내는 state·tool 이벤트로 채운다
           (전에는 이 목록이 항상 비어 있었다 — ai-copilot.jsx 주석 참조).
         ★ 도구 이름은 번역하지 않는다. 14개 도구에 언어별 사전을 만들면 도구가
           늘 때마다 사전이 뒤처지고, 뒤처진 사전은 빈 칸으로 나타난다.
      */
      /* ★ AI 가 그린 선·신호에 이름을 붙여 저장한다. 무료 플랜은 저장 불가(운영 결정). */
      sv_plan_required: 'Saving needs a paid plan',
      sv_name_label: 'Name this',
      sv_save: 'Save',
      /* ★ 운영 결정(2026-09-08): 신호는 고객이 만들고 AI 는 서포트한다. */
      ai_my_setup: '◉ MY SETUP',
      ai_setup_checked: 'CHECKED',
      ai_setup_missing: 'Missing',
      ai_setup_against: 'Evidence against your setup',
      ai_setup_against_hint: 'This is not a reason to stop — it is what your setup has to survive.',
      ai_setup_drawn: '📊 Drew {n} on the chart · {items}',
      ai_setup_nothing_drawn: 'Nothing was drawn — the setup had no usable levels.',
      ai_setup_no_entry: 'No entry price in this setup, so a draft cannot be prepared.',
      toast_draft_failed: 'Could not prepare the draft',
      ai_step_validating: 'Checking the request',
      ai_step_tool: 'Using {name}',
      ai_tool_signal: '📊 5 overlays created · entry zone / SL / TP1-3 / long marker',
      ai_tool_edited: '✍️ Your edit applied · {detail}',
      ai_hint_drag: '📌 Drag the circles at either end of the trendline to adjust it. Your edits are reflected in the conversation.',
      ai_invalidation_note: '· signal is invalidated automatically when this condition occurs',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        'Here is what I found. I drew an ascending trendline connecting the two most recent lows.\n\n'
        + '- **Validity**: valid while it holds as support 3+ times without a new low\n'
        + '- **Invalidation**: a 15m close below the line\n'
        + '- **Note**: a trendline is a reference, not a decision. Confirm with other indicators.\n\n'
        + 'I can add support and resistance levels too if you like.',
      ai_reply_trendline_pro:
        'Trend line drawn from swing low **A** to **B**.\n\n'
        + '- Slope: +42.6 USDT / 15m bar\n'
        + '- Touches: 3\n'
        + '- Invalidation: 15m close < line\n'
        + '- RSI div: none observed\n'
        + '- Order book absorption near line: BID 68,150 (+3.2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        'Analysis complete. I put a **long entry scenario** in the card below.\n\n'
        + '- **Entry zone**: scale in between 68,120 and 68,360\n'
        + '- **Stop loss**: exit immediately on a break of 67,480 (about -1.1%)\n'
        + '- **Targets**: three stages (68,980 / 69,640 / 70,420)\n'
        + '- **Risk/reward**: 1 : 2.8\n'
        + '- **Confidence**: 74% (some parts are not fully certain)\n'
        + '- **Note**: this is AI analysis and can be invalidated by sudden market moves.',
      ai_reply_signal_pro:
        'Long setup ready.\n\n'
        + '- Entry: 68,120–68,360 (scale-in)\n'
        + '- SL: 67,480 · R 1.1%\n'
        + '- TP: 68,980 / 69,640 / 70,420\n'
        + '- R:R 1 : 2.8 · confidence 74%\n'
        + '- Invalidation: 15m close < 67,480',

      // --- 일반 응답 ---
      ai_reply_general:
        'Detected question: "{text}".\n\nTry commands such as "draw a trendline", "propose entry/SL/TP" or "find support and resistance".',

      // --- 퀵 칩 (라벨 + 실제로 보낼 명령문) ---
      ai_chip_trendline: '🎯 Draw ascending trendline',
      ai_chip_trendline_cmd: 'draw an ascending trendline from the recent lows',
      ai_chip_signal: '📊 Entry scenario',
      ai_chip_signal_cmd: 'help me mark my entry, stop loss and take profit',
      ai_chip_sr: '📍 Find support / resistance',
      ai_chip_sr_cmd: 'find support and resistance',
      ai_chip_fib: '📐 Fibonacci',
      ai_chip_rr: '🔀 R:R calculator',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: 'How can I help? e.g. draw a trendline',
      ai_input_pro: 'Enter a command… (e.g. draw trendline / draft my setup / find S/R)',
      ai_reason_beginner: '💡 Why',
      ai_reason_pro: 'Reason',

      /* ============================================================
         후속 제안 칩 (follow-up suggestions)
         ------------------------------------------------------------
         ★★ 답변만 하고 끝내지 않는다. 다음에 확인할 것을 제시한다.

           고객이 매번 "무엇을 물어야 하나" 를 스스로 떠올려야 하는 부담을 없앤다.
           문구는 서버 규칙이 고르고(모델이 만들지 않는다), 여기서 언어별로 옮긴다.

         ★★ **매수·매도 권유 문구를 절대 넣지 말 것.**

           사업자 유형은 소프트웨어 개발·공급이고 투자자문 등록이 없다. "지금 사세요"
           같은 문구가 들어가는 순간 투자권유가 된다. 제안은 검증·위험 점검·복기
           범위로 제한한다. 테스트가 이 파일을 훑어 금지 표현을 막는다.
         ============================================================ */
      ai_fu_title: 'Next you could ask',
      ai_fu_risk_open_position: '⚠ Check my open position risk',
      ai_fu_risk_open_position_q: 'I have an open position. What is my liquidation distance and what would invalidate it?',
      ai_fu_invalidation: '❓ Where would I be wrong?',
      ai_fu_invalidation_q: 'I drew an entry and a stop but no invalidation level. At what point should I accept this idea is wrong?',
      ai_fu_no_stop: '🛑 I have no stop level',
      ai_fu_no_stop_q: 'I drew an entry zone but no stop level. Explain the structural levels below and above it.',
      ai_fu_open_orders: '📋 Review my resting orders',
      ai_fu_open_orders_q: 'I have resting orders. Are they still consistent with the current structure?',
      ai_fu_counter_case: '🔄 Argue the opposite case',
      ai_fu_counter_case_q: 'Now argue the opposite of what you just said. What is the strongest case against it?',
      ai_fu_review_trades: '📖 Review my past trades',
      ai_fu_review_trades_q: 'Review my past trades. Did I follow my own plan, and where did I deviate?',
      ai_fu_higher_tf: '🔍 Check the higher timeframe',
      ai_fu_higher_tf_q: 'Does the higher timeframe agree with this read, or disagree?',
      ai_fu_add_indicator: '📈 Suggest indicators for this',
      ai_fu_add_indicator_q: 'No indicators are on my chart. Which would be informative here, and what are their limits?',
      ai_fu_funding: '💰 What is funding doing?',
      ai_fu_funding_q: 'What is the funding rate telling us about positioning right now?',
      ai_fu_order_book: '📊 Read the order book',
      ai_fu_order_book_q: 'What does the order book depth show near the current price?',
      ai_fu_explain_levels: '📍 Explain the key levels',
      ai_fu_explain_levels_q: 'Explain the key levels on {symbol} and how you identified each one.',

      /*
         시그널 카드의 저장·알림 결과 문구.

         ★ 눌렀는데 아무 표시가 없으면 됐는지 알 수 없다. 고객은 다시 누르고, 알림이 두 개
           생긴다. 그래서 성공과 실패를 모두 말한다 — 실패는 "아무것도 저장되지 않았다" 까지
           말해야 재시도 여부를 판단할 수 있다.
      */
      ai_points_insufficient: 'Not enough points to save this. Top up on the Points page.',
      ai_alert_no_price: 'This signal has no entry price, so there is nothing to alert on.',
      ai_alert_created: 'Alert set at {price}. You will be told when price reaches it.',
      ai_alert_failed: 'Could not set the alert. Nothing was saved — try again.',

      /* ★ 레이어 표시/숨김. 상태에 따라 문구가 바뀐다 — 같은 라벨이면 무엇이 일어날지 알 수 없다. */
      ai_layer_hide: 'Hide this layer on the chart',
      ai_layer_show: 'Show this layer on the chart',
    },
    { label: 'English', bcp47: 'en-US' },
  );
})();
