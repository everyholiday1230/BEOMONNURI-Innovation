#!/usr/bin/env python3
"""i18n 커버리지 점검 도구.

목적: 화면에 표시되는 한국어 문구 중 en 사전(TRANSLATIONS.en)에 없는 것을 찾는다.
- 한국어 자체는 "원문(source)"이므로 문제 아님. 사전에 대응 항목이 없으면 영어 화면에도 한국어가 남음.
- 이 스크립트는 완벽한 파서가 아니라 '누락 후보'를 뽑아 사람이 검토하도록 돕는 보조 도구다.

사용: python3 scripts/i18n_coverage.py
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "static"
I18N = ROOT / "i18n.js"

HANGUL = re.compile(r"[\uac00-\ud7a3]")


def load_en_keys() -> set[str]:
    s = I18N.read_text(encoding="utf-8")
    i = s.find("en: { flag")
    j = s.find("ja: { flag")
    en = s[i:j] if (i >= 0 and j > i) else s
    keys = set()
    for m in re.finditer(r"""(['"])((?:\\.|(?!\1).)*?)\1\s*:""", en):
        key = m.group(2)
        if HANGUL.search(key):
            keys.add(key.strip())
    return keys


def extract_korean_snippets(text: str) -> list[str]:
    out = []
    for m in re.finditer(r"""(['"])((?:\\.|(?!\1).)*?)\1""", text):
        v = m.group(2).strip()
        if HANGUL.search(v):
            out.append(v)
    for m in re.finditer(r">([^<>{}]*?[\uac00-\ud7a3][^<>{}]*?)<", text):
        v = m.group(1).strip()
        if HANGUL.search(v):
            out.append(v)
    return out


# HTML 태그를 제거하고 태그 사이 텍스트 노드만 뽑는다 (자동번역은 텍스트노드 단위).
_TAG = re.compile(r"<[^>]+>")


def text_nodes_only(snip: str) -> list[str]:
    # 조각이 태그를 포함하면 태그 사이 텍스트만 분리
    if "<" in snip and ">" in snip:
        parts = _TAG.split(snip)
        return [normalize(p) for p in parts if HANGUL.search(p) and normalize(p)]
    return [normalize(snip)] if HANGUL.search(snip) else []


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def main():
    import sys
    only = sys.argv[1] if len(sys.argv) > 1 else None
    en_keys = load_en_keys()
    en_norm = {normalize(k) for k in en_keys}
    print(f"[en dict] korean keys loaded: {len(en_keys)}")

    targets = [ROOT / "index.html"]
    targets += sorted((ROOT / "js").glob("*.js"))
    targets += sorted((ROOT / "js" / "modules").glob("*.js"))

    missing = {}
    seen = set()
    for f in targets:
        if not f.exists() or f.name == "i18n.js":
            continue
        if only and only not in f.name:
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        for snip in extract_korean_snippets(text):
            for node in text_nodes_only(snip):
                n = normalize(node)
                if n in en_norm or n in seen:
                    continue
                seen.add(n)
                missing.setdefault(f.name, []).append(node)

    total = sum(len(v) for v in missing.values())
    print(f"[missing candidates] {total}\n")
    for fname, snips in missing.items():
        print(f"-- {fname} ({len(snips)}) --")
        for s in snips[:400]:
            print(f"   {s}")
        print()


if __name__ == "__main__":
    main()
