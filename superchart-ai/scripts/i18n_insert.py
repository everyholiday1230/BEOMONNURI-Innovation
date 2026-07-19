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
    "요금제 표시/설명 카탈로그를 관리합니다(요금제명·가격·결제주기·AI 분석 횟수 표기·기능 설명·활성). 실제 기능 제한 강제값은 tier_guard가 단일 출처이며, 본 화면의 'AI 분석 횟수'는 표시용입니다.": "Manages the plan display/description catalog (plan name, price, billing cycle, AI-analysis count label, feature description, active). The actual enforced feature limits come solely from tier_guard; the 'AI analysis count' on this screen is for display only.",
}
JA = {
}
ZH = {
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
