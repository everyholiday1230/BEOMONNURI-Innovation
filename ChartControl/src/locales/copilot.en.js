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
      ai_tool_signal: '📊 5 overlays created · entry zone / SL / TP1-3 / long marker',
      ai_tool_sr: '📍 2 support/resistance levels added',
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
    },
    { label: 'English', bcp47: 'en-US' },
  );
})();
