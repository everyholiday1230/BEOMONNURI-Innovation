#!/usr/bin/env python3
"""i18n.js 의 ja/zh 블록에 번역 쌍을 안전하게 삽입.

사용: 이 파일의 JA / ZH 딕셔너리에 '한국어키':'번역' 을 채운 뒤 실행.
- 이미 해당 블록에 존재하는 키는 건너뜀(중복 방지).
- 각 블록의 'texts: {' 바로 다음 줄에 삽입.
- 문자열 이스케이프(작은따옴표) 처리.
"""
from __future__ import annotations
import re
from pathlib import Path

I18N = Path(__file__).resolve().parent.parent / "static" / "i18n.js"

# 여기에 번역을 채운다 (실행 시마다 새 배치로 교체 가능)
EN = {
    "차트 설정 저장": "Save Chart Settings",
    "현재 차트 설정 저장": "Save current chart settings",
    "현재 종목·타임프레임·지표·드로잉을 저장합니다. 로그인하면 그대로 복원됩니다.": "Saves the current symbol, timeframe, indicators and drawings. They are restored when you log in.",
    "저장하면 다음에 로그인할 때 종목·타임프레임·지표·드로잉이 그대로 복원됩니다.": "Once saved, your symbol, timeframe, indicators and drawings are restored the next time you log in.",
    "차트 설정이 저장되었습니다. 로그인하면 그대로 복원됩니다.": "Chart settings saved. They will be restored when you log in.",
    "지표를 클릭하면 차트에 적용되며 설정 팝업이 자동으로 열립니다. 설정 팝업의 기본값 버튼으로 초기값 복원. 차트 설정 저장 버튼을 누르면 현재 종목·타임프레임·지표·드로잉이 저장되어, 다음에 로그인할 때 그대로 복원됩니다.": "Click an indicator to apply it to the chart; its settings popup opens automatically. Use the Default button in the popup to restore initial values. Press Save Chart Settings to store your current symbol, timeframe, indicators and drawings, so they are restored the next time you log in.",
}
JA = {
    "차트 설정 저장": "チャート設定を保存",
    "현재 차트 설정 저장": "現在のチャート設定を保存",
    "현재 종목·타임프레임·지표·드로잉을 저장합니다. 로그인하면 그대로 복원됩니다.": "現在の銘柄・時間足・指標・描画を保存します。ログインすると復元されます。",
    "저장하면 다음에 로그인할 때 종목·타임프레임·지표·드로잉이 그대로 복원됩니다.": "保存すると、次回ログイン時に銘柄・時間足・指標・描画がそのまま復元されます。",
    "차트 설정이 저장되었습니다. 로그인하면 그대로 복원됩니다.": "チャート設定を保存しました。ログインすると復元されます。",
    "지표를 클릭하면 차트에 적용되며 설정 팝업이 자동으로 열립니다. 설정 팝업의 기본값 버튼으로 초기값 복원. 차트 설정 저장 버튼을 누르면 현재 종목·타임프레임·지표·드로잉이 저장되어, 다음에 로그인할 때 그대로 복원됩니다.": "指標をクリックするとチャートに適用され、設定ポップアップが自動で開きます。ポップアップの「デフォルト」ボタンで初期値に戻せます。「チャート設定を保存」を押すと、現在の銘柄・時間足・指標・描画が保存され、次回ログイン時にそのまま復元されます。",
}
ZH = {
    "차트 설정 저장": "保存图表设置",
    "현재 차트 설정 저장": "保存当前图表设置",
    "현재 종목·타임프레임·지표·드로잉을 저장합니다. 로그인하면 그대로 복원됩니다.": "保存当前的交易品种、时间周期、指标和绘图。登录后即可恢复。",
    "저장하면 다음에 로그인할 때 종목·타임프레임·지표·드로잉이 그대로 복원됩니다.": "保存后，下次登录时会自动恢复交易品种、时间周期、指标和绘图。",
    "차트 설정이 저장되었습니다. 로그인하면 그대로 복원됩니다.": "图表设置已保存。登录后即可恢复。",
    "지표를 클릭하면 차트에 적용되며 설정 팝업이 자동으로 열립니다. 설정 팝업의 기본값 버튼으로 초기값 복원. 차트 설정 저장 버튼을 누르면 현재 종목·타임프레임·지표·드로잉이 저장되어, 다음에 로그인할 때 그대로 복원됩니다.": "点击指标即可应用到图表，并自动打开设置弹窗。用弹窗中的“默认”按钮恢复初始值。点击“保存图表设置”后，当前的交易品种、时间周期、指标和绘图将被保存，下次登录时自动恢复。",
}


def _existing_keys(block: str) -> set[str]:
    return set(re.findall(r"^\s*'((?:\\.|[^'])*)'\s*:", block, re.M))


def _esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace("'", "\\'")


def insert(lang_marker: str, next_marker: str | None, mapping: dict[str, str], src: str) -> str:
    i = src.find(lang_marker)
    if i < 0:
        raise SystemExit(f"marker not found: {lang_marker}")
    open_idx = src.find("texts: {", i)
    line_end = src.find("\n", open_idx)
    if next_marker:
        j = src.find(next_marker)
    else:
        # 마지막 언어(zh) 블록은 TRANSLATIONS 객체 이후의 별도 사전(EN_GLOSSARY 등)을
        # 존재키 판정에 포함하지 않도록 경계를 그 앞으로 제한한다.
        g = src.find("EN_GLOSSARY", i)
        j = g if g > 0 else len(src)
    block = src[i:j]
    have = _existing_keys(block)
    lines = []
    for k, v in mapping.items():
        if not v:
            continue
        if k in have:
            continue
        lines.append(f"      '{_esc(k)}': '{_esc(v)}',")
    if not lines:
        return src
    inject = "\n" + "\n".join(lines)
    return src[:line_end] + inject + src[line_end:]


def main():
    s = I18N.read_text(encoding="utf-8")
    if "EN" in globals() and EN:
        s = insert("en: { flag", "ja: { flag", EN, s)
    if JA:
        s = insert("ja: { flag", "zh: { flag", JA, s)
    if ZH:
        s = insert("zh: { flag", None, ZH, s)
    I18N.write_text(s, encoding="utf-8")
    print(f"inserted en={len(EN) if 'EN' in globals() else 0} ja={len(JA)} zh={len(ZH)}")


if __name__ == "__main__":
    main()
