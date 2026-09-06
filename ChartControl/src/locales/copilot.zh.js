/* ============================================================
   简体中文 — AI 副驾驶词典
   ------------------------------------------------------------
   ★ 翻译原则

     · 交易术语沿用中文交易所的常见写法
       （做多/做空 · 限价/市价 · 保证金 · 持仓 · 强制平仓）
     · 「止损/止盈」不写成「停止损失」——中文交易界面通用的是前者
     · AI 的输出是**建议**，不是保证。原文语气克制的地方保持克制，
       不要译得更肯定：用户会照着下单，语气会影响他的资金。
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'zh',
    {
      ai_think_collect: '正在收集图表数据 · BTC/USDT 15m · 220 根K线',
      ai_think_swinglow: '正在识别近期波段低点（检查 RSI 背离）',
      ai_think_trendcand: '已找到两个以上低点 → 正在计算趋势线候选',
      ai_think_mtf: '正在核对多周期一致性（15m / 1H / 4H）',
      ai_think_atr: '正在用 ATR 计算入场与止损距离',
      ai_think_rr: '正在模拟三个按盈亏比优化的方案',
      ai_think_swings: '正在扫描主要波段高点与低点',
      ai_think_volnodes: '正在提取高成交量节点',
      ai_think_context: '正在读取上下文',
      ai_ctx_loaded: '上下文已载入。{symbol} · {tf} · {bars} 根K线。',
      ai_ctx_loaded_ind: '上下文已载入。{symbol} · {tf} · {bars} 根K线 · {n} 个指标启用中。',
      ai_tool_trendline: '📐 已在图表上添加趋势线草稿 · 图层：AI 草稿',
      ai_tool_signal: '📊 已创建 5 个图形 · 入场区间 / 止损 / TP1-3 / 做多标记',
      ai_tool_sr: '📍 已添加 2 条支撑/阻力位',
      ai_tool_edited: '✍️ 已应用你的修改 · {detail}',
      ai_hint_drag: '📌 拖动趋势线两端的圆点即可调整。你的修改会同步到对话中。',
      ai_invalidation_note: '· 出现该条件时，信号将自动作废',
      ai_chip_trendline: '🎯 画上升趋势线',
      ai_chip_trendline_cmd: '从近期低点画一条上升趋势线',
      ai_chip_signal: '📊 入场方案',
      ai_chip_signal_cmd: '帮我标注我的入场、止损和止盈',
      ai_chip_sr: '📍 寻找支撑 / 阻力',
      ai_chip_sr_cmd: '寻找支撑与阻力',
      ai_chip_fib: '📐 斐波那契',
      ai_chip_rr: '🔀 盈亏比计算器',
      ai_input_beginner: '需要什么帮助？例如：画一条趋势线',
      ai_input_pro: '输入指令…（例如：画趋势线 / 拟定我的方案 / 找支撑阻力）',
      ai_reason_beginner: '💡 理由',
      ai_reason_pro: '理由',
      /* ★ 未翻译，导致打开副驾驶时的第一句话是英文 */
      ai_welcome_pro:
        '副驾驶已就绪。交易对：**{symbol}** · 周期：**{tf}** · 最新价：**{price}** · 数据时间 {time}。'
        + '可以让我画趋势线、找支撑阻力、给出入场/止损/止盈与盈亏比。',
      ai_welcome_beginner:
        '你好，我是 {brand} 副驾驶，正在看 **{symbol}** 的图表。'
        + '用日常说法提问就行。我可以直接在图上画趋势线和支撑阻力，'
        + '并给出入场、止损、止盈的位置。我只是工具 — 真实下单一定要经过你最后确认。',

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
      ai_fu_title: '接下来可以问',
      ai_fu_risk_open_position: '⚠ 检查持仓风险',
      ai_fu_risk_open_position_q: '我有持仓。距离强平还有多远，什么情况下前提会失效？',
      ai_fu_invalidation: '❓ 什么时候该承认判断错了',
      ai_fu_invalidation_q: '我画了入场和止损，但没有失效位。到什么程度应该承认这个想法是错的？',
      ai_fu_no_stop: '🛑 我没有止损位',
      ai_fu_no_stop_q: '我画了入场区间但没有止损。请说明上下方的结构性价位。',
      ai_fu_open_orders: '📋 检查未成交委托',
      ai_fu_open_orders_q: '我有未成交的委托。它们与当前结构还一致吗？',
      ai_fu_counter_case: '🔄 请论证相反的一面',
      ai_fu_counter_case_q: '请论证与刚才相反的观点。反对它最有力的理由是什么？',
      ai_fu_review_trades: '📖 复盘我过去的交易',
      ai_fu_review_trades_q: '请复盘我过去的交易。我有遵守自己的计划吗，在哪里偏离了？',
      ai_fu_higher_tf: '🔍 看更大周期',
      ai_fu_higher_tf_q: '更大周期支持这个判断，还是相反？',
      ai_fu_add_indicator: '📈 建议合适的指标',
      ai_fu_add_indicator_q: '我的图上没有指标。这里哪些有参考价值，它们的局限是什么？',
      ai_fu_funding: '💰 资金费率如何',
      ai_fu_funding_q: '当前资金费率反映了怎样的持仓偏向？',
      ai_fu_order_book: '📊 解读盘口',
      ai_fu_order_book_q: '当前价格附近的盘口深度说明了什么？',
      ai_fu_explain_levels: '📍 说明关键价位',
      ai_fu_explain_levels_q: '请说明 {symbol} 的关键价位，以及你如何判断每一个。',
    },
    { label: '简体中文', bcp47: 'zh-CN' },
  );
})();
