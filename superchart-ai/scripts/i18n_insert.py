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
    "프리셋 '": "Preset '", "' 저장됨": "' saved", "' 적용": "' applied",
    '코드': 'Code', '코드 복사됨': 'Code copied',
    '과매수': 'Overbought', '과매도': 'Oversold',
    '범온 포인트 · 지인 초대': 'Beomon Points · Invite Friends',
    '업데이트': 'Update', '이벤트': 'Event', '베타 테스트 안내': 'Beta Test Notice',
    '현재 범온 AI 슈퍼차트는 베타 테스트 중입니다. 이용 중 불편하거나 개선이 필요한 점은 피드백으로 알려주시면 빠르게 반영하겠습니다. 감사합니다.': 'BEOMON AI SuperChart is currently in beta testing. If you find anything inconvenient or in need of improvement, please let us know via feedback and we will address it promptly. Thank you.',
    '불러오는 중...': 'Loading...', '📌 고정': '📌 Pinned',
    '예고 없이 로그아웃되는': 'being logged out without notice',
}
JA = {
    "프리셋 '": "プリセット '", "' 저장됨": "' を保存しました", "' 적용": "' を適用",
    '코드': 'コード', '코드 복사됨': 'コードをコピーしました',
    '과매수': '買われすぎ', '과매도': '売られすぎ',
    '범온 포인트 · 지인 초대': 'BEOMON ポイント · 友達招待',
    '업데이트': 'アップデート', '이벤트': 'イベント', '베타 테스트 안내': 'ベータテストのお知らせ',
    '현재 범온 AI 슈퍼차트는 베타 테스트 중입니다. 이용 중 불편하거나 개선이 필요한 점은 피드백으로 알려주시면 빠르게 반영하겠습니다. 감사합니다.': '現在BEOMON AIスーパーチャートはベータテスト中です。ご利用中に不便な点や改善が必要な点はフィードバックでお知らせいただければ、速やかに反映いたします。ありがとうございます。',
    '불러오는 중...': '読み込み中...', '📌 고정': '📌 固定',
    '예고 없이 로그아웃되는': '予告なくログアウトされる',
}
ZH = {
    "프리셋 '": "预设 '", "' 저장됨": "' 已保存", "' 적용": "' 已应用",
    '코드': '代码', '코드 복사됨': '已复制代码',
    '과매수': '超买', '과매도': '超卖',
    '범온 포인트 · 지인 초대': 'BEOMON 积分 · 邀请好友',
    '업데이트': '更新', '이벤트': '活动', '베타 테스트 안내': '公测说明',
    '현재 범온 AI 슈퍼차트는 베타 테스트 중입니다. 이용 중 불편하거나 개선이 필요한 점은 피드백으로 알려주시면 빠르게 반영하겠습니다. 감사합니다.': 'BEOMON AI超级图表目前处于公测阶段。使用中如有不便或需要改进之处，请通过反馈告知我们，我们将尽快处理。谢谢。',
    '불러오는 중...': '加载中...', '📌 고정': '📌 置顶',
    '예고 없이 로그아웃되는': '在无预警的情况下被登出',
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
    j = src.find(next_marker) if next_marker else len(src)
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
