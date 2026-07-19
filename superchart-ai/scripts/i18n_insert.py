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
EN = {}
JA = {}
ZH = {
    '고가저가': '高低',
    '공개': '公开',
    '과매도': '超卖',
    '과매수': '超买',
    '관심': '关注',
    '기본값': '默认值',
    '내 프리셋': '我的预设',
    '돌파': '突破',
    '리플레이': '回放',
    '매매': '交易',
    '매수매도': '买卖',
    '비교': '对比',
    '손익비': '盈亏比',
    '수직선': '垂直线',
    '수직선 그리기 (특정 시점 표시)': '绘制垂直线（标记特定时点）',
    '오류': '错误',
    '저장된 프리셋이 없습니다.': '没有已保存的预设。',
    '전체': '全部',
    '준비 중': '准备中',
    '테마': '主题',
    '현재 구성 저장': '保存当前配置',
    '현재 지표 구성을 내 프리셋으로 저장': '将当前指标配置保存为我的预设',
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
