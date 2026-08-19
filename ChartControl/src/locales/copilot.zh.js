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
      ai_chip_signal_cmd: '给出入场、止损和止盈建议',
      ai_chip_sr: '📍 寻找支撑 / 阻力',
      ai_chip_sr_cmd: '寻找支撑与阻力',
      ai_chip_fib: '📐 斐波那契',
      ai_chip_rr: '🔀 盈亏比计算器',
      ai_input_beginner: '需要什么帮助？例如：画一条趋势线',
      ai_input_pro: '输入指令…（例如：画趋势线 / 给出信号 / 找支撑阻力）',
      ai_reason_beginner: '💡 理由',
      ai_reason_pro: '理由',
    },
    { label: '简体中文', bcp47: 'zh-CN' },
  );
})();
