/* ============================================================
   日本語 — シェル / レイアウト / Tweaks 辞書
   ------------------------------------------------------------
   キーは tools/i18n-extract.py が生成したものであり変更しない。
   ★ 未翻訳のキーは英語(en)に自動フォールバックする。だから部分的に
     訳した状態でも画面が壊れない。
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'ja',
    {
      layout_edit_toolbar_38b2c0: "ウィジェットをクリック → 選択 · ドラッグ → 移動 · 角 → サイズ変更 ·",
      page_placeholder_0db548: "編集:",
      page_placeholder_63aff4: "このページは",
      page_placeholder_8547a6: "フォルダからページテンプレート (list / detail / form / dashboard) をコピーしてご利用ください。",
      page_placeholder_be3553: "状態です。サイドバー · ヘッダー · ページシェルは既に接続されており、本文を埋めれば完成します。",
      page_placeholder_ed5dd4: "レイアウト・スキャフォールディング",
      tweaks_6e081b: "日本語",
      tweaks_da6cbd: "Design Token · Brand Token · リアルタイム反映",
      tweaks_e28dd8: "Beginner: リスク警告を強調、概念説明ツールチップ、主要な注文のみ表示。",
      tweaks_f9b33a: "Pro: 高密度情報、高度な注文タイプを即時表示、AI 応答を簡潔化。",
      widget_library_3b690d: "ウィジェット右上",
      widget_library_f29084: "非表示のウィジェットはありません。",
      widget_library_f7178c: "アイコンで非表示にできます。",
    },
    { label: "日本語", bcp47: 'ja-JP' },
  );
})();
