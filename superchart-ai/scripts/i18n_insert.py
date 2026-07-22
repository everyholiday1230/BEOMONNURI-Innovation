#!/usr/bin/env python3
"""i18n.js 의 en/ja/zh 블록에 번역 쌍을 안전하게 삽입.

사용: 이 파일의 EN / JA / ZH 딕셔너리에 '한국어키':'번역' 을 채운 뒤 실행.
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
    "공유": "Share",
    "현재 종목·타임프레임 링크 복사": "Copy a link to the current symbol & timeframe",
    "공유할 종목을 먼저 선택해 주세요": "Please select a symbol to share first",
    "차트 링크가 복사되었습니다": "Chart link copied",
    "링크 복사에 실패했습니다. 직접 복사해 주세요: ": "Could not copy the link. Please copy it manually: ",
    "공유 링크 생성 중 오류가 발생했습니다": "An error occurred while creating the share link",
}
JA = {
    "공유": "共有",
    "현재 종목·타임프레임 링크 복사": "現在の銘柄・時間軸のリンクをコピー",
    "공유할 종목을 먼저 선택해 주세요": "共有する銘柄を先に選択してください",
    "차트 링크가 복사되었습니다": "チャートのリンクをコピーしました",
    "링크 복사에 실패했습니다. 직접 복사해 주세요: ": "リンクのコピーに失敗しました。手動でコピーしてください: ",
    "공유 링크 생성 중 오류가 발생했습니다": "共有リンクの作成中にエラーが発生しました",
}
ZH = {
    "공유": "分享",
    "현재 종목·타임프레임 링크 복사": "复制当前品种·时间周期链接",
    "공유할 종목을 먼저 선택해 주세요": "请先选择要分享的品种",
    "차트 링크가 복사되었습니다": "图表链接已复制",
    "링크 복사에 실패했습니다. 직접 복사해 주세요: ": "链接复制失败，请手动复制：",
    "공유 링크 생성 중 오류가 발생했습니다": "生成分享链接时发生错误",
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
