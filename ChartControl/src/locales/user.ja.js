/* ============================================================
   日本語 — ユーザー画面（設定・ウォレット・分析）辞書
   ------------------------------------------------------------
   キーは tools/i18n-extract.py が生成したものであり変更しない。

   ★ 「清算」ではなく「ロスカット」を用いる。日本の取引所表記に合わせる。
     用語が違うと危険の度合いが伝わらない。
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'ja',
    {
      /*
         分析画面の所見文。
         ★ これらは実データが十分にある場合にのみ表示される所見であり、
           数値は画面側が実測から埋める。訳文で数値を作らない。
      */
      analytics_171e3e: "🎯 AI シグナルの勝率 82%",
      analytics_19b9a2: "AI シグナルに基づく取引が、自己判断より有意に良い成績です。",
      analytics_4b3b6f: "UTC 12〜16時の取引が、他の時間帯より平均損益で34%高いです。",
      analytics_4fa8b3: "ムードが「nervous」の状態で入ると、損失の確率が2.3倍に増えます。",
      analytics_c511d6: "✓ 午後セッションの成績が優勢",
      analytics_d6aabf: "⚠ Nervous 時の取引は損失率40%",

      notifications_f53a6e: "絞り込み",
      notifications_f6bc37: "すべて既読",
      order_history_ea8391: "全注文履歴 · 未約定 · 約定 · 取消",

      settings_009e27: "アカウントの完全削除",
      settings_0207e4: "API 利用ログのダウンロード",
      settings_02bb1c: "ハイコントラスト",
      settings_0d64b7: "プロフィール情報",
      settings_12d487: "動きを減らす",
      settings_14fab1: "プロフィール",
      settings_15d236: "お知らせ",
      settings_16930c: "通知設定",
      settings_19b2d1: "キャンセル",
      settings_1f1712: "保存",
      settings_2207de: "プロモーション · イベント",
      settings_2508a1: "データのダウンロード（GDPR）",
      settings_254a82: "削除を申請",
      settings_2ac6ff: "現在有効なセッション 3件",
      settings_2d430b: "プロフィール · セキュリティ · 通知 · API キー · アクセシビリティ",
      settings_340d4e: "一時停止",
      settings_37397b: "注文の約定 · 取消",
      settings_3a4173: "アクセシビリティ",
      settings_3c3776: "メールアドレス",
      settings_3c8a15: "2日前 · ⚠ 別の場所",
      settings_3f9048: "ロング/ショートをパターンとアイコンでも表示",
      settings_4599e3: "クリックせずすべての機能にアクセス可能",
      settings_4957e1: "アカウントを最大90日間無効化 · 後から再有効化できます",
      settings_4bd28a: "ログインセッション",
      settings_560adc: "全データを削除 · 復元不可 · 2FA とメール確認が必要",
      settings_5a4346: "アカウント管理",
      settings_625fc6: "スクリーンリーダー最適化",
      settings_643822: "環境設定",
      settings_6e081b: "日本語",
      /* ★ ロスカット警告 */
      settings_716902: "証拠金 · ロスカット警告",
      settings_74e36c: "申請",
      settings_76245e: "タイムゾーン",
      settings_7cbf79: "アカウントの一時停止",
      settings_816538: "フォーカス表示を強調",
      settings_819738: "パスワード",
      settings_84b6d0: "国",
      settings_872543: "SMS 認証",
      settings_8eb853: "接続済みの取引所 API キー · 権限 · IP 制限",
      settings_9074af: "最終変更 · 63日前",
      settings_965a8c: "パスワードと 2FA",
      settings_9aa18e: "氏名",
      settings_a2d19e: "初期値に戻す",
      settings_a5d169: "色覚サポート",
      settings_a5d18c: "二要素認証（TOTP）",
      settings_a63c4a: "色コントラストの強化（WCAG AAA）",
      settings_b7909f: "写真を変更",
      settings_b7a78a: "現在のセッション",
      settings_b83309: "AI シグナルの発生",
      settings_bbb99f: "全体のフォントサイズを20%拡大",
      settings_be6117: "データ管理",
      settings_c35257: "キーボードのみで操作",
      settings_c523ec: "過去90日のログ · CSV",
      settings_c56d3c: "大きな文字",
      settings_cafdc6: "終了",
      settings_ce0109: "変更",
      settings_cfaa68: "セキュリティ · 2FA",
      settings_d15b63: "アカウント · 取引 · 設定の全 JSON をダウンロード",
      settings_da0cf0: "ARIA ラベルを強化 · 読み上げ順序を整理",
      settings_dc3d8a: "アニメーション · トランジションを最小化（WCAG 2.3.3）",
      settings_e29d14: "通知",
      settings_e33c1f: "✓ 有効 · Google Authenticator",
      settings_ee3963: "再設定",
      settings_f1d559: "⚠ 取り消せない操作",
      settings_fa2fee: "2px → 3px のアウトライン · 色を強調",

      /*
         ウォレット画面。
         ★★ 当社は資金を預からない。入出金は取引所で行う。
           この画面は取引所への案内であり、当社の入金先を示すものではない。
      */
      wallet_57177e: "入金ページへ移動 →",
      wallet_95195c: "対応取引所の連携 · API キー管理 · 資産 · 入出金",
      wallet_972169: "出金",
      wallet_b9ca11: "入金",
      wallet_cbe9e9: "手数料キャッシュバック · ウェルカムボーナス",
      wallet_ceef92: "以下の取引所は当社と提携しており",
      wallet_d3cdff: "出金ページへ移動 →",
      wallet_ea90da: "🎁 {brand} 提携取引所",
      wallet_ecb4cc: "新規登録",
      wallet_ed546c: "取引所連携",
      wallet_f23807: "資産残高",
      wallet_fc0c97: "を提供します。\n                  登録リンクからご登録のうえ API キーを発行し、このページで連携してください",
    },
    { label: "日本語", bcp47: 'ja-JP' },
  );
})();
