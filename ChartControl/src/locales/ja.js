/* ============================================================
   日本語 (ja)
   ------------------------------------------------------------
   基準言語は src/locales/en.js である。ここでキーが欠けている場合は
   自動的に英語へフォールバックするため、翻訳が未完了でも画面は壊れない。

   ★ 翻訳方針
     · 取引・金融用語は日本の取引所で一般的な表記に合わせる
       (ロング/ショート · 指値/成行 · 証拠金 · 建玉 · ロスカット)
     · 「清算」ではなく「ロスカット」を使う — 日本語圏の取引所表記に合わせる
     · 危険を伝える文はぼかさない。原文が強く書いてある箇所は強さを保つ
       (資金が失われる可能性のある操作だから)
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'ja',
    {
      // --- 共通 ---
      dash: '—',
      close: '閉じる',
      cancel: 'キャンセル',
      save: '保存',
      clear: 'すべて解除',
      search: '検索',
      none: 'なし',
      loading: '読み込み中…',
      no_match: '該当なし',
      retry: '再試行',

      // --- サイドバー ナビゲーション ---
      nav_trade: 'トレード',
      nav_ai_workspace: 'AI ワークスペース',
      nav_multi_chart: 'マルチチャート',
      nav_markets: 'マーケット',
      nav_ai_strategies: 'AI 戦略',
      nav_analytics: '分析',
      nav_portfolio: 'ポートフォリオ',
      nav_wallet: 'ウォレット',
      nav_order_history: '注文履歴',
      nav_notifications: '通知',
      nav_referral: '友達招待',
      nav_fees_rebates: '手数料 · リベート',
      nav_settings: '設定',
      nav_help: 'ヘルプ',
      nav_admin_home: '管理者ホーム',
      nav_users: 'ユーザー',
      nav_kyc_queue: 'KYC 審査',
      nav_trade_monitor: '取引モニター',
      nav_risk_queue: 'リスクキュー',
      nav_deposits: '入金承認',
      nav_withdrawals: '出金承認',
      nav_assets_vault: '資産 · ウォレット',
      nav_ai_ops: 'AI 運用',
      nav_fees_promo: '手数料 · プロモーション',
      nav_notices_cs: 'お知らせ · お問い合わせ',
      nav_broadcast: '一斉送信',
      nav_system_health: 'システム状態',
      nav_audit_log: '監査ログ',
      nav_design_ops: 'デザイン運用',
      nav_section_trading: 'トレーディング',
      nav_section_market: 'マーケット',
      nav_section_account: 'アカウント',
      nav_section_admin: '管理者',
      nav_open_menu: 'メニューを開く',
      nav_expand: 'サイドバーを開く',
      nav_collapse: 'サイドバーを折りたたむ',

      // --- 取引モード ---
      mode_spot: '現物',
      mode_futures: '先物',
      mode_paper: 'デモ',
      mode_switch_to: '{mode} モードに切り替え',
      mode_spot_unavailable: '現物取引はまだ対応していません — 先物・デモをご利用ください',
      mode_unknown: '不明な取引モード',
      mode_pending_mark: '準備中',

      // --- アクセス制御 ---
      access_login_required: 'このページを表示するにはログインが必要です',
      access_under_development: '開発中の画面のため管理者にのみ表示されます',
      access_insufficient_tier: '{required} 権限が必要なページです',
      access_unknown_tier: 'アカウント権限を確認できません',
      tier_user: '一般ユーザー',
      tier_ops: 'オペレーター',
      tier_admin: '管理者',
      tier_super: '最高管理者',

      // --- 注文・トースト ---
      side_long: 'ロング',
      side_short: 'ショート',
      side_long_arrow: '▲ ロング',
      side_short_arrow: '▼ ショート',
      buy_long: '買い · ロング',
      sell_short: '売り · ショート',
      /*
         ★ 「取引所へ送信された」と「デモ」を明確に分ける。
           ここを曖昧にすると、本番だと思ってデモで練習する（またはその逆）。
      */
      toast_order_live_desc: '取引所へ送信 · {size} {base} @ {price}',
      toast_order_paper_desc: 'デモ · {status} · {size} {base} @ {price}（取引所へは送信されません）',
      toast_order_blocked: '注文は取引所へ届く前にブロックされました',
      /*
         ★★ 結果が不明なときに再注文すると建玉が二重になる。だから
           「再試行しないでください」を明示する。
      */
      toast_order_unknown: '注文の状態が不明です — 再試行しないでください',
      toast_order_unknown_desc: '取引所が受け付けた可能性があります。未約定一覧を確認してから再度ご注文ください。',
      toast_order_invalid: '注文の検証に失敗しました',
      toast_order_invalid_desc: '入力内容をご確認ください。',
      toast_order_accepted: '注文を受け付けました · {side}',
      toast_order_accepted_desc: '{size} {base} @ {price}（シミュレーション）',
      toast_price_filled: '価格を入力しました: {price}',
      toast_price_filled_desc: '注文入力パネルに価格が入りました。',
      toast_draft_created: '注文ドラフトを作成',
      toast_draft_created_desc: '注文入力パネルに値が入りました。',
      toast_signal_approved: 'シグナルを承認しました',
      toast_signal_approved_desc: 'AI シグナルが承認されました。ドラフトが実線に切り替わります。',
      toast_signal_rejected: 'シグナルを破棄しました',
      toast_signal_rejected_desc: 'AI シグナルを破棄しました。',
      toast_layout_saved: '「{name}」を保存しました',
      toast_layout_saved_desc: 'カスタムレイアウト一覧に追加されました。',
      confirm_unsaved_leave: '保存されていない変更があります。移動してもよろしいですか？',
      prompt_layout_name: 'レイアウト名を入力してください:',
      prompt_layout_default: 'My Layout',
      notfound_path: 'パス · {path}',

      // --- チャート ツールバー ---
      chart_compare: '比較',
      chart_templates: 'テンプレート',
      chart_ai_analyze: 'AI 分析',
      chart_replay: 'リプレイ',
      chart_screenshot: 'スクリーンショット',
      chart_fullscreen: '全画面',
      chart_settings: '設定',
      chart_scroll_latest: '最新へ移動',

      // --- 描画ツール ---
      tool_cursor: 'カーソル',
      tool_trend_line: 'トレンドライン',
      tool_horizontal: '水平線',
      tool_fib: 'フィボナッチ',
      tool_long: 'ロングポジション',
      tool_short: 'ショートポジション',
      tool_measure: '計測',
      tool_text: 'テキスト',
      tool_magnet: 'マグネット',
      tool_lock: '描画をロック',
      tool_hide: '描画を非表示',
      tool_remove_all: '描画をすべて削除',
      draw_tool_unavailable: '現在のレンダラーでは使用できないツールです',
      drawings_removed: '描画を削除しました',
      drawings_none: '削除する描画がありません',
      drawings_locked: '描画をロックしました',
      drawings_unlocked: '描画のロックを解除しました',
      drawings_shown: '描画を表示します',
      drawings_hidden: '描画を非表示にしました',
      magnet_normal: 'マグネット オフ',
      magnet_weak_magnet: 'マグネット: 弱',
      magnet_strong_magnet: 'マグネット: 強',
      screenshot_saved: 'スクリーンショットを保存しました',
      screenshot_failed: 'スクリーンショットの保存に失敗しました',
      fullscreen_failed: '全画面表示を利用できません',
      feature_pending: '準備中 — データ接続作業が残っています',
      ai_open_copilot: 'AI Copilot ウィジェットから分析を実行してください',

      // --- 指標パネル ---
      indicators: '指標',
      indicators_search_placeholder: '指標を検索…',
      indicators_none_active: '選択された指標はありません',
      indicators_group_trend: 'トレンド',
      indicators_group_momentum: 'モメンタム',
      indicators_group_volatility: 'ボラティリティ',
      indicators_group_volume: '出来高',

      // --- テンプレート ---
      template_name_placeholder: 'テンプレート名…',
      template_none: '保存されたテンプレートはありません',
      template_untitled: '名称未設定',
      template_apply: '適用',
      template_delete: '削除',
      template_saved: '「{name}」を保存しました',
      template_synced_note: 'アカウントに保存されます — 他の端末でも表示されます',
      template_local_only_note: 'この端末にのみ保存されます — ログインすると端末間で同期します',
      template_saved_local_only: '「{name}」をこの端末にのみ保存しました',
      template_sync_failed: 'アカウントに同期できませんでした。他の端末では表示されません。',
      template_delete_sync_failed: '「{name}」はここでのみ削除しました — サーバーに残り再表示される場合があります',

      // --- シンボル比較 ---
      cmp_search_placeholder: '比較するシンボルを検索…',
      cmp_base_note: '{symbol} · {tf} 基準の比較（相対変化で正規化）',
      cmp_active: '比較中',
      cmp_available: '追加できる銘柄',
      cmp_remove: '{symbol} を削除',
      cmp_err_unsupported: 'このチャートでは比較を利用できません',

      // --- 取引モード表示帯 ---
      stripe_live: '本番取引',
      stripe_sim: 'デモ取引',
      stripe_preview: 'プレビュー',
      stripe_checking: '確認中',
      stripe_live_note: '実際の注文が取引所へ送信されます · お客様の資金が使われます',
      stripe_sim_note: '注文はサーバー上でシミュレーションされ、取引所へは送信されません',
      stripe_preview_note: 'デザインプレビュー · バックエンド未接続 · サンプルデータ',
      stripe_checking_note: '注文が取引所へ送信されるか確認しています…',
      stripe_data: '相場 · {src}',
      stripe_data_live: '取引所リアルタイム',
      stripe_data_mock: 'サンプル',

      // --- ロスカット警告 ---
      /*
         ★★ 「清算」より「ロスカット」を使う。日本の取引所表記に合わせる。
           用語が違うと、危険の度合いが伝わらない。
      */
      risk_liq_warning: 'ロスカット価格まで {pct}% です',
      risk_liq_critical: 'ロスカットが近づいています — 残り {pct}%',
      risk_liq_unknown: 'ロスカット価格を取得できません',

      // --- 取引所連携 ---
      ex_not_partnered: '未提携',
      ex_not_partnered_hint: 'まだ連携していません — 接続できません',
      ex_not_partnered_note: '管理者にのみ表示されます。この取引所はブローカー提携と連携がまだ無いため API キーを使用できません。',
      ex_loading: '取引所を読み込み中…',
      ex_none: '接続できる取引所がありません。サーバー設定をご確認ください。',
      ex_hidden_note: '{n} 件の取引所は準備中のため表示していません。',
      ex_referral_tbd: '手数料キャッシュバック（条件確定前）',
      lang_switch_title: '言語を変更',
      market_not_listed: '取引所に未上場',

      // --- AI Copilot ---
      ai_copilot: 'AI Copilot',
      ai_collapse: 'Copilot を折りたたむ',
      ai_expand: 'Copilot を開く',
      ai_clear_chat: '会話をクリア',
      ai_state_beta: 'ベータ · AI 未接続',
      ai_state_beta_note: '分析はまだ接続されていません — チャートツールとメモは正常に動作します',
      /*
         ★★ AI が未接続のときに価格を作らない理由をそのまま伝える。
           モデル無しで答えるのは、エントリー価格と損切り価格を捏造することになる。
      */
      ai_unavailable_reply: 'AI 分析がまだ接続されていないため、価格の数値は作成しません。モデル無しで回答すると、エントリー価格や損切り価格を捏造することになります。その間もチャートツール・描画・メモは通常どおりご利用いただけます。',
      oe_err_not_listed: '取引所に上場していない銘柄です — 注文できません',
    },
    { label: '日本語', bcp47: 'ja-JP' },
  );
})();
