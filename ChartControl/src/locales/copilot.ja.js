/* ============================================================
   日本語 — AI Copilot 辞書
   ------------------------------------------------------------
   キーは tools/i18n-extract.py が生成したものであり変更しない。

   ★★ これらの文言は AI が接続されている場合にのみ表示される。
     未接続時は ja.js の `ai_unavailable_reply`（価格の数値を作らない旨）が
     返る。訳文で価格や水準を作らないこと。
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'ja',
    {
      ai_think_collect: "チャートデータを収集中 · BTC/USDT 15m · 220 本",
      ai_think_swinglow: "直近のスイングロー検出（RSI ダイバージェンスの有無を確認）",
      ai_think_trendcand: "低点を2つ以上確保 → トレンドライン候補を算出",
      ai_think_mtf: "マルチタイムフレームの整合を確認（15m / 1H / 4H）",
      ai_think_atr: "ATR に基づくエントリー・損切り幅の計算",
      ai_think_rr: "リスクリワード最適化の候補3つをシミュレーション",
      ai_think_swings: "主要なスイング高値・安値をスキャン",
      ai_think_volnodes: "出来高が集中する価格帯を抽出",
      ai_think_context: "コンテキストを把握中",
      ai_ctx_loaded: 'コンテキストを読み込みました。{symbol} · {tf} · {bars} 本。',
      ai_ctx_loaded_ind: 'コンテキストを読み込みました。{symbol} · {tf} · {bars} 本 · 指標 {n} 件が有効。',

      ai_tool_trendline: "📐 チャートにドラフトのトレンドラインを追加 · レイヤー: AI Draft",
      ai_tool_signal: "📊 オーバーレイ5件を生成 · エントリー帯 / 損切り / 利確1-3 / ロングマーカー",
      ai_tool_sr: "📍 サポート・レジスタンスを2件追加",
      ai_tool_edited: "✍️ 利用者の修正を反映 · {detail}",
      ai_hint_drag: "📌 トレンドライン両端の円をドラッグして位置を調整できます。修正すると会話に反映されます。",
      ai_invalidation_note: "· この条件が発生した場合、シグナルは自動的に無効化されます",

      ai_chip_trendline: "🎯 上昇トレンドラインを描く",
      ai_chip_trendline_cmd: "直近の安値を基準に上昇トレンドラインを描いて",
      ai_chip_signal: "📊 エントリーの想定",
      ai_chip_signal_cmd: "エントリー・損切り・利確の水準を提案して",
      ai_chip_sr: "📍 サポート・レジスタンスを探す",
      ai_chip_sr_cmd: "サポートとレジスタンスを探して",
      ai_chip_fib: "📐 フィボナッチ",
      ai_chip_rr: "🔀 リスクリワード計算",

      ai_input_beginner: "何をお手伝いしましょうか？ 例）トレンドラインを描いて",
      ai_input_pro: "コマンドを入力…（例: draw trendline / propose signal / find S/R）",
      ai_reason_beginner: "💡 理由",
      ai_reason_pro: "根拠",
      /* ★ 未翻訳だったため、コパイロットを開いた最初の一文が英語で出ていた */
      ai_welcome_pro:
        'コパイロットの準備ができました。銘柄: **{symbol}** · 時間足: **{tf}** · 最終価格: **{price}** · データ時点 {time}。'
        + 'トレンドライン・サポレジ・エントリー/損切り/利確・リスクリワードをお尋ねください。',
      ai_welcome_beginner:
        'こんにちは、{brand} コパイロットです。**{symbol}** のチャートを見ています。'
        + '普通の言葉で聞いてください。トレンドラインやサポート・レジスタンスをチャートに直接描き、'
        + 'エントリー・損切り・利確の水準を提案できます。私は道具です — 実際の注文は必ずあなたの最終承認の後にのみ出されます。',
    },
    { label: "日本語", bcp47: 'ja-JP' },
  );
})();
