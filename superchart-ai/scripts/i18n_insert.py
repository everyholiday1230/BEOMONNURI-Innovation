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
    "/년": "/yr",
    "전 지표 + AI 무제한": "All indicators + Unlimited AI",
    "VIP 전체 + 우선 혜택": "Everything in VIP + Priority perks",
    "VIP 플랜 전체 기능 포함": "Includes everything in the VIP plan",
    "자동매매 시그널 (Paper Trading)": "Auto-trading signals (Paper Trading)",
    "우선 고객 지원": "Priority customer support",
    "향후 프리미엄 신규 기능 우선 제공": "Early access to future premium features",
    "정밀 추세 분석·시그널": "Precision trend analysis & signals",
    "지지·저항 자동 감지": "Automatic support/resistance detection",
    "추세 시작 진입 시그널": "Trend-start entry signal",
    "단기 익절 타이밍 감지": "Short-term take-profit timing detection",
    "과열·침체 구간 감지": "Overbought/oversold zone detection",
    "거래량 흐름 기반 추세": "Volume-flow based trend",
    "복합 지표 종합 시그널": "Composite multi-indicator signal",
    "모의주문·알림·차트설정 저장": "Paper trading, alerts, saved chart settings",
    "범온 독자 지표": "BEOM proprietary indicators",
    "회원 지표 전체 (범온MA·자동추세선·매매압력·자금흐름 등)": "All member indicators (BEOM MA, Auto Trendline, Trade Pressure, Fund Flow, etc.)",
    "AI 분석·예측·챗": "AI analysis, prediction & chat",
    "무제한": "Unlimited",
    "합계": "Subtotal",
    "묶음 할인": "Bundle discount",
    "결제 금액": "Payment amount",
    "충전하기": "Charge",
    "지표를 선택하세요": "Select an indicator",
    "개 구매하기 · ": " indicators · Buy for ",
    "기본 적립": "Standard rate",
    "결제 시스템이 곧 오픈됩니다. 사전 등록하시면 오픈 시 안내드립니다.": "Payments are launching soon. Pre-register and we'll notify you at launch.",
    "토스페이먼츠 SDK 로드 실패": "Failed to load the Toss Payments SDK",
    "결제 시스템 설정이 아직 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.": "Payment system setup is not complete yet. Please try again shortly.",
    "결제를 시작하지 못했습니다: ": "Could not start payment: ",
    "알 수 없는 오류": "Unknown error",
    "결제가 취소되었거나 실패했습니다.": "Payment was canceled or failed.",
    "결제 정보가 올바르지 않습니다.": "Payment information is invalid.",
    "결제가 완료되었습니다. 이용해 주셔서 감사합니다!": "Payment complete. Thank you for your purchase!",
    "결제 승인 확인 중 오류가 발생했습니다. 고객센터로 문의해 주세요.": "An error occurred while confirming payment. Please contact support.",
    "범온 지표 구매": "BEOM Indicator Purchase",
    "구독 플랜을 확인하고 기능을 활성화해보세요.": "Check out subscription plans to unlock this feature.",
    "지금 로그인하고 모든 기능을 사용해보세요.": "Log in now to use every feature.",
    "오픈 시 가장 먼저 사용하실 수 있도록 안내해드릴게요.": "We'll let you know first when it launches.",
    "분석 결과 (": "Analysis Result (",
    "개 봉)": " bars)",
    "클릭: 켜기/끄기 · 우클릭: 제거": "Click: toggle on/off · Right-click: remove",
    "우클릭으로 제거": "Right-click to remove",
    "마지막 갱신": "Last updated",
    "분 전": " min ago",
    "초 전": " sec ago",
    "금속": "Metals",
    "외환": "Forex",
    "지수": "Indices",
    "자산": "Asset",
    "등락률": "Change %",
    "관심도": "Attention",
    "순위변화": "Rank Change",
    "기준": "Sort by",
    "가격 데이터가 없는": "Symbols with no price data",
    "개 종목은 랭킹 계산에서 제외되었습니다.": " were excluded from the ranking calculation.",
    "기준 데이터는 준비 중입니다. 현재 수치는 24h 기준으로 표시됩니다.": "Data for this basis is being prepared. Current figures are shown on a 24h basis.",
    "가상 잔고가 부족합니다. 사용 가능: ": "Insufficient virtual balance. Available: ",
    "비로그인 상태에서는 임시 모의 포지션을 최대": "While logged out, you can practice up to",
    "개까지 연습할 수 있으며 저장은 제한됩니다.": " temporary paper positions, with limited saving.",
    "하면 모의 주문 기록과 복기 메모를 저장할 수 있습니다.": " to save your paper trade history and review notes.",
    "비로그인은 임시 모의 포지션": "While logged out, you can practice up to",
    "개까지 연습할 수 있습니다": " temporary paper positions",
    "모의 주문이 체결되었습니다": "paper order filled",
    "모의 포지션을 종료 처리했습니다": "paper position closed",
    "해당 카테고리의 상품이 준비 중입니다.": "Products in this category are coming soon.",
    "상품 카탈로그를 불러오지 못해 기본 구성을 표시합니다.": "Could not load the product catalog; showing the default set.",
    "사용 내역이 없습니다.": "No usage history.",
    "적립 내역이 없습니다.": "No earning history.",
    "포인트 내역이 없습니다.": "No point history.",
    "범온 슈퍼차트 AI에 초대합니다. 추천 코드: ": "You're invited to BEOM AI SuperChart. Referral code: ",
    "포인트가 부족합니다": "Not enough points",
    " P 더 필요합니다.": " more P needed.",
    "개의 신호": " signals",
    "비공개 전략": "Private strategy",
    "개 (제작자만 열람 가능)": " conditions (creator only)",
    "개 — 제작자(": " conditions — only the creator (",
    ")만 열람할 수 있습니다.": ") can view this.",
    "다음 티어(": "Next tier (",
    ")까지": ") in",
    "명 남음": " more referrals",
    "개 차트 레이아웃": "-chart layout",
    "전략 적용": " strategy applied",
    "개 표시했습니다.": " shown.",
}
JA = {
    "/년": "/年",
    "전 지표 + AI 무제한": "全指標 + AI無制限",
    "VIP 전체 + 우선 혜택": "VIP全機能 + 優先特典",
    "VIP 플랜 전체 기능 포함": "VIPプランの全機能を含む",
    "자동매매 시그널 (Paper Trading)": "自動売買シグナル（ペーパートレード）",
    "우선 고객 지원": "優先カスタマーサポート",
    "향후 프리미엄 신규 기능 우선 제공": "今後のプレミアム新機能を先行提供",
    "정밀 추세 분석·시그널": "精密トレンド分析・シグナル",
    "지지·저항 자동 감지": "サポート・レジスタンス自動検出",
    "추세 시작 진입 시그널": "トレンド開始エントリーシグナル",
    "단기 익절 타이밍 감지": "短期利確タイミング検出",
    "과열·침체 구간 감지": "過熱・低迷ゾーン検出",
    "거래량 흐름 기반 추세": "出来高フローに基づくトレンド",
    "복합 지표 종합 시그널": "複合指標総合シグナル",
    "모의주문·알림·차트설정 저장": "ペーパートレード・アラート・チャート設定の保存",
    "범온 독자 지표": "BEOM独自指標",
    "회원 지표 전체 (범온MA·자동추세선·매매압력·자금흐름 등)": "会員指標全体（BEOM MA・自動トレンドライン・売買圧力・資金フロー等）",
    "AI 분석·예측·챗": "AI分析・予測・チャット",
    "무제한": "無制限",
    "합계": "小計",
    "묶음 할인": "まとめ割引",
    "결제 금액": "決済金額",
    "충전하기": "チャージする",
    "지표를 선택하세요": "指標を選択してください",
    "개 구매하기 · ": "個購入する・",
    "기본 적립": "標準積立",
    "결제 시스템이 곧 오픈됩니다. 사전 등록하시면 오픈 시 안내드립니다.": "決済システムは近日公開予定です。事前登録すると公開時にご案内します。",
    "토스페이먼츠 SDK 로드 실패": "Toss Payments SDKの読み込みに失敗しました",
    "결제 시스템 설정이 아직 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.": "決済システムの設定がまだ完了していません。しばらくしてから再度お試しください。",
    "결제를 시작하지 못했습니다: ": "決済を開始できませんでした: ",
    "알 수 없는 오류": "不明なエラー",
    "결제가 취소되었거나 실패했습니다.": "決済がキャンセルまたは失敗しました。",
    "결제 정보가 올바르지 않습니다.": "決済情報が正しくありません。",
    "결제가 완료되었습니다. 이용해 주셔서 감사합니다!": "決済が完了しました。ご利用ありがとうございます！",
    "결제 승인 확인 중 오류가 발생했습니다. 고객센터로 문의해 주세요.": "決済承認の確認中にエラーが発生しました。サポートにお問い合わせください。",
    "범온 지표 구매": "BEOM指標購入",
    "구독 플랜을 확인하고 기능을 활성화해보세요.": "サブスクプランを確認して機能を有効にしましょう。",
    "지금 로그인하고 모든 기능을 사용해보세요.": "今すぐログインしてすべての機能をご利用ください。",
    "오픈 시 가장 먼저 사용하실 수 있도록 안내해드릴게요.": "公開時に一番先にご案内します。",
    "분석 결과 (": "分析結果（",
    "개 봉)": "本）",
    "클릭: 켜기/끄기 · 우클릭: 제거": "クリック：オン/オフ・右クリック：削除",
    "우클릭으로 제거": "右クリックで削除",
    "마지막 갱신": "最終更新",
    "분 전": "分前",
    "초 전": "秒前",
    "금속": "金属",
    "외환": "外国為替",
    "지수": "指数",
    "자산": "資産",
    "등락률": "変動率",
    "관심도": "注目度",
    "순위변화": "順位変動",
    "기준": "基準",
    "가격 데이터가 없는": "価格データがない",
    "개 종목은 랭킹 계산에서 제외되었습니다.": "銘柄はランキング計算から除外されました。",
    "기준 데이터는 준비 중입니다. 현재 수치는 24h 기준으로 표시됩니다.": "この基準のデータは準備中です。現在の数値は24時間基準で表示されています。",
    "가상 잔고가 부족합니다. 사용 가능: ": "仮想残高が不足しています。利用可能：",
    "비로그인 상태에서는 임시 모의 포지션을 최대": "未ログイン時は最大",
    "개까지 연습할 수 있으며 저장은 제한됩니다.": "件の仮想ポジションを練習でき、保存は制限されます。",
    "하면 모의 주문 기록과 복기 메모를 저장할 수 있습니다.": "すると、ペーパートレード履歴と振り返りメモを保存できます。",
    "비로그인은 임시 모의 포지션": "未ログインでは仮想ポジションを最大",
    "개까지 연습할 수 있습니다": "件まで練習できます",
    "모의 주문이 체결되었습니다": "ペーパー注文が成立しました",
    "모의 포지션을 종료 처리했습니다": "ペーパーポジションを終了しました",
    "해당 카테고리의 상품이 준비 중입니다.": "このカテゴリーの商品は準備中です。",
    "상품 카탈로그를 불러오지 못해 기본 구성을 표시합니다.": "商品カタログを読み込めなかったため、デフォルト構成を表示します。",
    "사용 내역이 없습니다.": "利用履歴がありません。",
    "적립 내역이 없습니다.": "獲得履歴がありません。",
    "포인트 내역이 없습니다.": "ポイント履歴がありません。",
    "범온 슈퍼차트 AI에 초대합니다. 추천 코드: ": "BEOM AI SuperChartにご招待します。紹介コード：",
    "포인트가 부족합니다": "ポイントが不足しています",
    " P 더 필요합니다.": " P必要です。",
    "개의 신호": "件のシグナル",
    "비공개 전략": "非公開戦略",
    "개 (제작자만 열람 가능)": "件（作成者のみ閲覧可能）",
    "개 — 제작자(": "件 — 作成者（",
    ")만 열람할 수 있습니다.": "）のみ閲覧できます。",
    "다음 티어(": "次のティア（",
    ")까지": "）まで",
    "명 남음": "人",
    "개 차트 레이아웃": "チャートレイアウト",
    "전략 적용": "戦略を適用",
    "개 표시했습니다.": "件表示しました。",
}
ZH = {
    "/년": "/年",
    "전 지표 + AI 무제한": "全部指标 + AI无限",
    "VIP 전체 + 우선 혜택": "VIP全部功能 + 优先权益",
    "VIP 플랜 전체 기능 포함": "包含VIP套餐全部功能",
    "자동매매 시그널 (Paper Trading)": "自动交易信号（模拟交易）",
    "우선 고객 지원": "优先客户支持",
    "향후 프리미엄 신규 기능 우선 제공": "优先体验未来高级新功能",
    "정밀 추세 분석·시그널": "精准趋势分析与信号",
    "지지·저항 자동 감지": "自动检测支撑/阻力",
    "추세 시작 진입 시그널": "趋势启动进场信号",
    "단기 익절 타이밍 감지": "短线止盈时机检测",
    "과열·침체 구간 감지": "超买/超卖区间检测",
    "거래량 흐름 기반 추세": "基于成交量流的趋势",
    "복합 지표 종합 시그널": "复合指标综合信号",
    "모의주문·알림·차트설정 저장": "模拟交易、提醒、图表设置保存",
    "범온 독자 지표": "范温独家指标",
    "회원 지표 전체 (범온MA·자동추세선·매매압력·자금흐름 등)": "全部会员指标（范温均线、自动趋势线、买卖压力、资金流向等）",
    "AI 분석·예측·챗": "AI分析·预测·聊天",
    "무제한": "无限",
    "합계": "小计",
    "묶음 할인": "组合折扣",
    "결제 금액": "支付金额",
    "충전하기": "充值",
    "지표를 선택하세요": "请选择指标",
    "개 구매하기 · ": "个购买 · ",
    "기본 적립": "标准积分",
    "결제 시스템이 곧 오픈됩니다. 사전 등록하시면 오픈 시 안내드립니다.": "支付系统即将上线，预先登记即可在上线时收到通知。",
    "토스페이먼츠 SDK 로드 실패": "Toss Payments SDK 加载失败",
    "결제 시스템 설정이 아직 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.": "支付系统尚未配置完成，请稍后再试。",
    "결제를 시작하지 못했습니다: ": "无法开始支付：",
    "알 수 없는 오류": "未知错误",
    "결제가 취소되었거나 실패했습니다.": "支付已取消或失败。",
    "결제 정보가 올바르지 않습니다.": "支付信息不正确。",
    "결제가 완료되었습니다. 이용해 주셔서 감사합니다!": "支付已完成，感谢您的使用！",
    "결제 승인 확인 중 오류가 발생했습니다. 고객센터로 문의해 주세요.": "确认支付时发生错误，请联系客服。",
    "범온 지표 구매": "范温指标购买",
    "구독 플랜을 확인하고 기능을 활성화해보세요.": "请查看订阅套餐以启用该功能。",
    "지금 로그인하고 모든 기능을 사용해보세요.": "立即登录以使用全部功能。",
    "오픈 시 가장 먼저 사용하실 수 있도록 안내해드릴게요.": "上线时我们会第一时间通知您。",
    "분석 결과 (": "分析结果（",
    "개 봉)": "根K线）",
    "클릭: 켜기/끄기 · 우클릭: 제거": "点击：开/关 · 右键：删除",
    "우클릭으로 제거": "右键点击删除",
    "마지막 갱신": "最后更新",
    "분 전": "分钟前",
    "초 전": "秒前",
    "금속": "金属",
    "외환": "外汇",
    "지수": "指数",
    "자산": "资产",
    "등락률": "涨跌幅",
    "관심도": "关注度",
    "순위변화": "排名变化",
    "기준": "排序依据",
    "가격 데이터가 없는": "无价格数据的",
    "개 종목은 랭킹 계산에서 제외되었습니다.": "个品种已从排名计算中排除。",
    "기준 데이터는 준비 중입니다. 현재 수치는 24h 기준으로 표시됩니다.": "该排序依据的数据正在准备中，当前数值以24小时为基准显示。",
    "가상 잔고가 부족합니다. 사용 가능: ": "虚拟余额不足。可用余额：",
    "비로그인 상태에서는 임시 모의 포지션을 최대": "未登录状态下最多可练习",
    "개까지 연습할 수 있으며 저장은 제한됩니다.": "个临时模拟仓位，保存功能受限。",
    "하면 모의 주문 기록과 복기 메모를 저장할 수 있습니다.": "后可保存模拟交易记录和复盘笔记。",
    "비로그인은 임시 모의 포지션": "未登录最多可练习",
    "개까지 연습할 수 있습니다": "个临时模拟仓位",
    "모의 주문이 체결되었습니다": "模拟订单已成交",
    "모의 포지션을 종료 처리했습니다": "模拟仓位已平仓",
    "해당 카테고리의 상품이 준비 중입니다.": "该分类的商品正在准备中。",
    "상품 카탈로그를 불러오지 못해 기본 구성을 표시합니다.": "无法加载商品目录，显示默认配置。",
    "사용 내역이 없습니다.": "暂无使用记录。",
    "적립 내역이 없습니다.": "暂无获得记录。",
    "포인트 내역이 없습니다.": "暂无积分记录。",
    "범온 슈퍼차트 AI에 초대합니다. 추천 코드: ": "邀请您使用范温AI超级图表。推荐码：",
    "포인트가 부족합니다": "积分不足",
    " P 더 필요합니다.": " P。",
    "개의 신호": "个信号",
    "비공개 전략": "私密策略",
    "개 (제작자만 열람 가능)": "个条件（仅创建者可查看）",
    "개 — 제작자(": "个 — 仅创建者（",
    ")만 열람할 수 있습니다.": "）可查看。",
    "다음 티어(": "下一等级（",
    ")까지": "）还需",
    "명 남음": "人",
    "개 차트 레이아웃": "图布局",
    "전략 적용": "策略已应用",
    "개 표시했습니다.": "个已显示。",
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
