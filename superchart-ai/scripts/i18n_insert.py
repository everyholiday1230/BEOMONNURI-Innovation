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
    "대회 순위": "Rankings",
    "🏆 모의투자 대회 순위": "🏆 Paper Trading Rankings",
    "모의주문 누적 손익 기준 순위입니다. 진입가·종료가·수량·방향으로 서버가 재계산해 검증한 종료 거래만 불변 원장에 기록되어 순위에 반영됩니다.": "Rankings by cumulative paper-trading P&L. Only closed trades re-verified by the server (entry/exit price, size, direction) are recorded to an immutable ledger and counted.",
    "순위를 불러오는 중입니다...": "Loading rankings...",
    "아직 완료된 모의 거래가 없습니다. 모의주문 탭에서 매수·매도로 첫 거래를 남기면 순위에 반영됩니다.": "No completed paper trades yet. Make your first buy/sell on the Paper Trading tab to appear on the rankings.",
    "순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.": "Could not load rankings. Please try again shortly.",
    "상위 50명까지 표시됩니다. 계좌를 초기화하거나 화면 기록을 지워도 원장과 순위는 유지됩니다. 모의투자 결과는 참고용이며 실제 수익을 보장하지 않습니다.": "Top 50 are shown. The ledger and rankings persist even if you reset your account or clear local history. Paper-trading results are for reference only and do not guarantee real returns.",
    "모의투자 대회 순위": "Paper Trading Rankings",
}
JA = {
    "대회 순위": "ランキング",
    "🏆 모의투자 대회 순위": "🏆 デモ取引ランキング",
    "모의주문 누적 손익 기준 순위입니다. 진입가·종료가·수량·방향으로 서버가 재계산해 검증한 종료 거래만 불변 원장에 기록되어 순위에 반영됩니다.": "デモ取引の累計損益によるランキングです。エントリー価格・決済価格・数量・方向でサーバーが再計算し検証した決済取引のみが不変の台帳に記録され、順位に反映されます。",
    "순위를 불러오는 중입니다...": "ランキングを読み込み中...",
    "아직 완료된 모의 거래가 없습니다. 모의주문 탭에서 매수·매도로 첫 거래를 남기면 순위에 반영됩니다.": "完了したデモ取引がまだありません。デモ取引タブで買い・売りの最初の取引を行うとランキングに反映されます。",
    "순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.": "ランキングを読み込めませんでした。しばらくしてからもう一度お試しください。",
    "상위 50명까지 표시됩니다. 계좌를 초기화하거나 화면 기록을 지워도 원장과 순위는 유지됩니다. 모의투자 결과는 참고용이며 실제 수익을 보장하지 않습니다.": "上位50名まで表示されます。口座をリセットしたり画面の記録を消しても、台帳と順位は保持されます。デモ取引の結果は参考用であり、実際の収益を保証しません。",
    "모의투자 대회 순위": "デモ取引ランキング",
}
ZH = {
    "대회 순위": "排行榜",
    "🏆 모의투자 대회 순위": "🏆 模拟交易排行榜",
    "모의주문 누적 손익 기준 순위입니다. 진입가·종료가·수량·방향으로 서버가 재계산해 검증한 종료 거래만 불변 원장에 기록되어 순위에 반영됩니다.": "按模拟交易累计盈亏排名。仅由服务器根据入场价、离场价、数量、方向重新计算并验证的已平仓交易，才会记入不可变账本并计入排名。",
    "순위를 불러오는 중입니다...": "正在加载排行榜...",
    "아직 완료된 모의 거래가 없습니다. 모의주문 탭에서 매수·매도로 첫 거래를 남기면 순위에 반영됩니다.": "尚无已完成的模拟交易。在模拟交易标签页进行首次买入/卖出后即可进入排行榜。",
    "순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.": "无法加载排行榜，请稍后再试。",
    "상위 50명까지 표시됩니다. 계좌를 초기화하거나 화면 기록을 지워도 원장과 순위는 유지됩니다. 모의투자 결과는 참고용이며 실제 수익을 보장하지 않습니다.": "最多显示前50名。即使重置账户或清除本地记录，账本与排名仍会保留。模拟交易结果仅供参考，不保证实际收益。",
    "모의투자 대회 순위": "模拟交易排行榜",
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
