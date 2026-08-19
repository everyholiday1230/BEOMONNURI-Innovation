/* ============================================================
   日本語 — 管理画面 辞書
   ------------------------------------------------------------
   キーは tools/i18n-extract.py が生成したものであり変更しない。

   ★ 管理画面には未実装の機能が含まれる。未実装の表示は access.js の
     UNDEVELOPED 判定により黄色で示され、super/admin にのみ見える。
     ここでの訳は画面ラベルであり、機能の存在を保証しない。

   ★ 「清算」ではなく「ロスカット」を用いる（日本の取引所表記）。
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'ja',
    {
      admin_a_i_ops_50ede2: "💡 v1.4.2 は v1.3.9 比でヒット率が7ポイント改善。今週末に全トラフィックの移行を推奨。",
      admin_a_i_ops_ed2648: "3日前 · 権ヌリ",

      admin_assets_16f852: "全ウォレット残高（ホット / コールド）",
      admin_assets_293d08: "資産移動 · 照合（夜間バッチ）",
      admin_assets_657644: "AML アラートの絞り込み",
      admin_assets_7c2e10: "ウォレット · 入出金の承認 · 資産移動",
      admin_assets_d52d75: "入金 · 出金の承認待ちキュー",
      admin_assets_hi_fi_24e2e8: "コールドウォレット · 資産別",
      admin_assets_hi_fi_48aeb1: "資産移動の申請（ホット → コールド、コールド → ホット）",
      admin_assets_hi_fi_4b4b97: "利用者残高との比較",
      admin_assets_hi_fi_503c9d: "即時出金可能",
      admin_assets_hi_fi_60cb06: "ウォレット · 資産移動 · 照合",
      admin_assets_hi_fi_dc00b9: "ホットウォレット · 資産別",

      admin_broadcast_050529: "7日間のアクティブ（820名）",
      admin_broadcast_078b3a: "件名",
      admin_broadcast_1395f0: "KYC L3（312名）",
      admin_broadcast_140c08: "想定コスト:",
      admin_broadcast_1a8f0f: "本文を入力してください。Markdown 対応（**bold** · `code` · [link](url)）。",
      admin_broadcast_1a911b: "予約配信",
      admin_broadcast_265106: "予約を登録",
      admin_broadcast_4c0460: "想定リーチ",
      admin_broadcast_626099: "今すぐ配信",
      admin_broadcast_63c075: "🎉 8月のプロモーション（1,242名）",
      admin_broadcast_743fe1: "📢 定期メンテナンスのお知らせ（1,242名）",
      admin_broadcast_7aeb7e: "配信チャネル",
      admin_broadcast_90bbad: "配信対象",
      admin_broadcast_95066f: "全員（1,242名）",
      admin_broadcast_9c1758: "カスタム条件",
      admin_broadcast_a7bc1f: "例: 8月のリベート企画のご案内",
      admin_broadcast_b7f563: "全体通知 · メール · プッシュの配信",
      admin_broadcast_bc4cc1: "📄 利用規約の改定（1,242名）",
      admin_broadcast_be1a1a: "Pro/VIP のみ（642名）",
      admin_broadcast_c67b87: "本文",
      admin_broadcast_e6f9c4: "下書きを保存",
      admin_broadcast_f1f368: "最近の配信",
      admin_broadcast_f724cc: "メッセージの作成",

      admin_c_s_ticket_00ecd1: "最近の取引",
      admin_c_s_ticket_15e878: "クイック操作",
      admin_c_s_ticket_165627: "はい、ご確認をお願いします。",
      admin_c_s_ticket_291781: "お問い合わせありがとうございます。確認のうえご回答いたします。少しお待ちください。",
      admin_c_s_ticket_3f0669: "保存（内部）",
      admin_c_s_ticket_5be08a: "確認の結果、ご提出書類の一部が不鮮明なため再確認が必要です。下記のリンクから再提出をお願いします:",
      admin_c_s_ticket_5c50d9: "利用者",
      admin_c_s_ticket_5c8747: "チケット情報",
      admin_c_s_ticket_65b9cf: "利用者プロフィール",
      admin_c_s_ticket_95bf7b: "回答を送信",
      admin_c_s_ticket_a6c22d: "回答を入力…",
      admin_c_s_ticket_c65f61: "やり取り",
      admin_c_s_ticket_e31e52: " について問い合わせます。数日経っても処理されず困っています。",
      admin_c_s_ticket_efefae: "定型文",

      admin_dashboard_0ccafd: "プラットフォームの稼働状況 · 異常取引 · リスク · AI · システム",

      admin_deposits_48f252: "入金キュー",
      admin_deposits_df0901: "オンチェーン入金 · 承認数 · AML レビュー",
      admin_deposits_e9e567: "入金の承認",

      admin_design_ops_127e5c: "新しいページ · コンポーネント · ポップアップを作成して登録",
      admin_design_ops_23188a: "モーダルのスニペットをコピー",
      admin_design_ops_247f98: "UI トークン · コンポーネント · ページ管理 · 今後の新規ページ/コンポーネントの登録",
      admin_design_ops_341930: "ガイド文書",
      admin_design_ops_376325: "コンポーネントカタログに追加",
      admin_design_ops_454af0: "作業手順 · 規約",
      admin_design_ops_631818: "新しいページ",
      admin_design_ops_ad367e: "テンプレートから選んで開始",
      admin_design_ops_b1169b: "新しいポップアップ/モーダル",
      admin_design_ops_b31be6: "新しいコンポーネント",

      admin_fees_65feac: "手数料ティア · リベート · プロモーション · キャッシュバック",

      admin_k_y_c_queue_46072a: "本人確認の審査",
      admin_k_y_c_queue_d167fe: "金ドヒョン",

      admin_notice_editor_0a94de: "公開オプション",
      admin_notice_editor_102c1f: "権ヌリ",
      admin_notice_editor_11a5df: "（公開時に自動）",
      admin_notice_editor_189dd9: "📌 上部に固定",
      admin_notice_editor_3d991a: "新しいお知らせの登録 · Markdown 対応",
      admin_notice_editor_41c60b: "ランディングページに表示",
      admin_notice_editor_492974: "プッシュ通知",
      admin_notice_editor_61187b: "メール配信",
      admin_notice_editor_7148d7: "公開",
      admin_notice_editor_a2ee94: "お知らせの件名",
      admin_notice_editor_a2fa30: "全利用者へのアプリ内バナー",
      admin_notice_editor_a8e5c8: "（件名なし）",
      admin_notice_editor_c3d57e: "本文（Markdown 対応）&#10;&#10;例:&#10;## 小見出し&#10;内容を記載してください…&#1",
      admin_notice_editor_c4c626: "（本文なし）",
      admin_notice_editor_db8cc8: "お知らせの作成",

      admin_notices_11300f: "お知らせの公開 · お問い合わせの管理",
      admin_notices_15d236: "お知らせ",

      /* ★ ロスカット表記 */
      admin_risk_a1edf2: "ポジションの偏り · ロスカットのキュー · 市場リスク",
      admin_trades_bc077b: "リアルタイム注文 · 約定 · 異常取引の検知",

      admin_user_detail_0057bd: "本人確認書類",
      admin_user_detail_04f2aa: "パスワードのリセット",
      admin_user_detail_106e43: "検索 · 絞り込み · CSV 書き出し",
      admin_user_detail_12614e: "タイムライン · 集計ビュー",
      admin_user_detail_170f7b: "登録日",
      admin_user_detail_19b2d1: "キャンセル",
      admin_user_detail_1d441e: "停止",
      admin_user_detail_219da4: "L3 に昇格",
      admin_user_detail_22d6d2: "30日間の取引量",
      admin_user_detail_2d003e: "AML/CTF の懸念",
      admin_user_detail_33103c: "累計手数料",
      admin_user_detail_3f4319: "本人確認書類",
      admin_user_detail_40ce13: "資産",
      admin_user_detail_43a4e1: "操作ログ",
      admin_user_detail_44650a: "その他",
      admin_user_detail_4def42: "利用者を停止しました（シミュレーション）",
      admin_user_detail_63c279: "理由",
      admin_user_detail_80a094: "取引の履歴",
      admin_user_detail_81922a: "ポジション",
      admin_user_detail_82d3e7: "アカウントの停止",
      admin_user_detail_851473: "本人確認の再依頼",
      admin_user_detail_8797eb: "取引明細",
      admin_user_detail_8dd7e4: "セキュリティイベント",
      admin_user_detail_8f5d10: "操作ログ · 直近20件",
      admin_user_detail_915cf6: "管理者ノート",
      admin_user_detail_941ad1: "メールを送る",
      admin_user_detail_94cd06: "⚠ アカウントの停止",
      admin_user_detail_96330a: "メッセージ",
      admin_user_detail_a1d12d: "異常取引の検知",
      admin_user_detail_a43b70: "本人確認の審査結果",
      admin_user_detail_a5e5da: "セキュリティ",
      admin_user_detail_a74a3f: "本人確認の再確認が必要",
      admin_user_detail_afc528: "再確認の依頼",
      admin_user_detail_bd464c: "停止すると利用者へメールで自動通知され、監査ログに記録されます。",
      admin_user_detail_ca5360: "利用者からの申請",
      admin_user_detail_d65b24: "自動計算",
      admin_user_detail_e03d2f: "2FA の再設定",
      admin_user_detail_e4ec3e: "資産の照会",
      admin_user_detail_ebe503: "この利用者を本当に停止しますか？",
      admin_user_detail_f35682: "管理者メモ（監査ログに記録されます）",
      admin_user_detail_f63bf7: "停止の解除",
      admin_user_detail_ff8aa0: "停止の確認",

      admin_users_3fefdf: "氏名 · メール · ID で検索",

      admin_withdrawals_372dac: "出金の承認",
      admin_withdrawals_4af6f5: "2FA 完了 · 承認待ちの出金申請",
      admin_withdrawals_d336c8: "出金キュー",
    },
    { label: "日本語", bcp47: 'ja-JP' },
  );
})();
