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
    '범온 슈퍼차트 AI · AI 지표·AI 자동분석·AI 차트분석 — BEOMONNURI': 'BEOMON SuperChart AI · AI Indicators · AI Auto-analysis · AI Chart Analysis — BEOMONNURI',
    '범온누리 이노베이션이 만든 AI 차트 분석 플랫폼. 자체 학습 Transformer + LLM으로 AI 지표, AI 자동분석, 실시간 AI 차트를 하나의 화면에. 신호 정확도·지연시간·자동화율·운영 안정성을 기준으로 설계된 퀀트 리서치 AI.': 'An AI chart-analysis platform built by Beomonnuri Innovation. In-house Transformer + LLM bring AI indicators, AI auto-analysis, and real-time AI charts to one screen. A quant research AI designed around signal accuracy, latency, automation rate, and operational stability.',
    'AI 지표, AI 자동분석, AI 차트, AI 차트분석, 퀀트, 슈퍼차트 AI, 범온누리, BEOMONNURI, 실시간 차트, Transformer 예측, LLM 해설, 금융 리서치 AI, 트레이딩 자동화, 신호 정확도, 지연시간, RSI, MACD, 볼린저밴드, 범온 캔들': 'AI indicators, AI auto-analysis, AI chart, AI chart analysis, quant, SuperChart AI, Beomonnuri, BEOMONNURI, real-time chart, Transformer prediction, LLM commentary, financial research AI, trading automation, signal accuracy, latency, RSI, MACD, Bollinger Bands, Beomon Candle',
    '자체 Canvas 차트 엔진 + Transformer 예측 + LLM 해설. AI 지표·AI 자동분석·AI 차트를 한 화면에. 성능 기준(지연시간·정확도·자동화율·안정성)으로 설계.': 'Proprietary Canvas chart engine + Transformer prediction + LLM commentary. AI indicators · AI auto-analysis · AI charts on one screen. Designed around performance criteria (latency, accuracy, automation rate, stability).',
    'Transformer + LLM 기반 AI 차트 분석. 자체 Canvas 엔진. WebSocket 실시간. AI 지표·AI 자동분석 통합.': 'Transformer + LLM based AI chart analysis. Proprietary Canvas engine. Real-time WebSocket. Integrated AI indicators & AI auto-analysis.',
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
