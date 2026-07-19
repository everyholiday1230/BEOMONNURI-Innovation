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
    '의 문제입니다. 슈퍼차트 AI는 이 네 가지를 성능 목표로 설계되고, 조직의 리서치 워크플로에 맞춰 합의된 기준으로 측정·개선합니다.': '. SuperChart AI is designed with these four as performance goals, measured and improved against criteria agreed upon to fit your organization’s research workflow.',
    '페이지 메타 정보': 'Page meta info',
    '무료로 차트 시작 →': 'Start charting free →', 'LIVE · 실시간 서비스 운영 중': 'LIVE · Service running in real time',
    '시장을': 'the market', '한 화면에': 'on one screen', '복잡한 차트와 지표를': 'Complex charts and indicators,',
    '자체 개발 AI': 'our in-house AI', '가 해설·예측하고,': ' explains & predicts, and',
    '범온누리 캔들 중심': 'centered on Beomon candles,',
    '차트 화면에서 바로 확인합니다. 자체 Canvas 엔진 ·': ' checked right on the chart. Proprietary Canvas engine ·',
    'Transformer 예측': 'Transformer prediction', 'LLM 해설': 'LLM commentary', '을 한 번에.': ' all at once.',
    '무료로 차트 시작하기': 'Start charting for free', '성능 기준 보기': 'View performance criteria', '지표·도구': 'Indicators & Tools',
    '범온 캔들 · 정/역배열 · AI 목표 · 슈퍼트렌드 등': 'Beomon Candle · Bull/Bear Alignment · AI Target · Supertrend, etc.',
    'WebSocket 직결 · 실시간 시세 데이터 파이프라인': 'Direct WebSocket · real-time market data pipeline',
    '해설·예측': 'Commentary & Prediction', 'Transformer 예측 + LLM(Ollama) 자연어 해설': 'Transformer prediction + LLM (Ollama) natural-language commentary',
    '운영 중': 'In operation', 'chart.beomonnuri.com — 브라우저에서 즉시 실행': 'chart.beomonnuri.com — runs instantly in your browser',
    '범온누리 4개 AI 라인업 · 금융 리서치': 'Beomonnuri 4 AI lineup · financial research', 'WebSocket · 실시간 시세': 'WebSocket · real-time quotes',
    '자체 학습 모델 · Ollama 서빙': 'In-house trained model · Ollama serving', '성능 기준으로': 'By performance criteria', '설계된': 'designed', 'AI 차트': 'AI Chart',
    'AI 차트 분석은 결국': 'AI chart analysis ultimately comes down to', '지연시간': 'Latency', '신호 정확도': 'Signal Accuracy',
    '자동화율': 'Automation Rate', '운영 안정성': 'Operational Stability',
    '지연시간 관리': 'Latency management',
    '실시간 데이터 반영 속도와 알림 전달 흐름을 함께 점검해 체감 지연을 최소화합니다.': 'We review real-time data reflection speed and alert delivery flow together to minimize perceived latency.',
    'WebSocket 직결 스트림': 'Direct WebSocket stream', '경보 감지~전달 시간 측정': 'Measure alert detection-to-delivery time',
    '시장 급변 구간 별도 모니터링': 'Separate monitoring for sudden market moves', '신호 정확도 검증': 'Signal accuracy validation',
    'AI 지표와 자동 분석 결과를 백테스트 관점으로 검증해 전략 신뢰도를 높입니다.': 'We validate AI indicators and automated analysis from a backtesting perspective to increase strategy reliability.',
    '신호 분류 정확도 기준 설정': 'Set signal-classification accuracy criteria', '오탐·미탐 케이스 분리 분석': 'Separate analysis of false positives/negatives',
    '주기별 성능 리포트 생성': 'Generate periodic performance reports', '분석 자동화율': 'Analysis automation rate',
    '반복 차트 판독과 조건 탐색을 자동화해 트레이더가 의사결정에 집중하도록 설계했습니다.': 'We automate repetitive chart reading and condition search so traders can focus on decisions.',
    '지표 신호 요약 자동 생성': 'Auto-generate indicator signal summaries', 'LLM 해설로 판독 시간 단축': 'Cut reading time with LLM commentary',
    '조건 기반 스마트 알림': 'Condition-based smart alerts',
    '실시간 수집·분석·알림 파이프라인을 모니터링해 예측 가능한 운영 품질을 유지합니다.': 'We monitor the real-time collect/analyze/alert pipeline to maintain predictable operational quality.',
    '수집 · 분석 · 알림 파이프라인': 'Collect · Analyze · Alert pipeline', '접근 권한 · 로그 정책 점검': 'Access rights · log policy review',
    '리스크 이벤트 대응 플로우': 'Risk event response flow', '차트·지표·AI가': 'Charts, indicators & AI,', '하나로': 'as one',
    '캔들·라인·영역 차트, 드로잉, 실시간 데이터, AI 예측, LLM 해설, 알림 — 여섯 개의 핵심 모듈이 하나의 화면에서 유기적으로 작동합니다.': 'Candle/line/area charts, drawing, real-time data, AI prediction, LLM commentary, and alerts — six core modules work organically on one screen.',
    '자체 Canvas 차트 엔진': 'Proprietary Canvas chart engine',
    'HTML5 Canvas 기반의 자체 개발 차트 UI로 캔들·라인·영역 차트와 드로잉 워크플로를 제공합니다.': 'A self-developed chart UI on HTML5 Canvas providing candle/line/area charts and drawing workflows.',
    '캔들 · 라인 · 영역 차트': 'Candle · Line · Area charts', '확대·이동 (줌/스크롤)': 'Zoom/scroll (pan)',
    '추세선 · 피보나치 · 수평선': 'Trendline · Fibonacci · Horizontal line', '리플레이 모드': 'Replay mode', '실시간 데이터': 'Real-time data',
    '실시간 가격·캔들·거래량을 차트에 반영해 현재 시장 흐름을 즉시 확인할 수 있습니다.': 'Reflects real-time price/candle/volume on the chart so you can instantly see current market flow.',
    '실시간 시세 파이프라인': 'Real-time quote pipeline', '거래량 · VWAP 실시간 반영': 'Real-time volume · VWAP', 'AI 분석 엔진': 'AI analysis engine',
    '자체 개발 AI 분석 엔진이 지표 조합을 해석해 차트 해설과 가격 예측 정보를 제공합니다.': 'Our in-house AI analysis engine interprets indicator combinations to provide chart commentary and price prediction.',
    'Transformer 기반 가격 예측': 'Transformer-based price prediction', 'LLM(Ollama · kanana-chart) 해설': 'LLM (Ollama · kanana-chart) commentary',
    '다중 지표 신호 통합 판독': 'Integrated reading of multi-indicator signals', '스마트 알림': 'Smart alerts',
    '가격 조건, RSI 조건, BEOM_SIGNAL 조건 기반 알림을 저장하고 트리거 이력을 제공합니다.': 'Save alerts based on price, RSI, and BEOM_SIGNAL conditions and view trigger history.',
    '가격 · RSI · MACD 조건': 'Price · RSI · MACD conditions', 'BEOM_SIGNAL 커스텀 트리거': 'BEOM_SIGNAL custom trigger',
    '알림 이력 저장 · 재조회': 'Save & re-view alert history', 'AI 지표': 'AI Indicators',
    '범온 캔들, 정/역배열, AI 목표 등 독자 지표로 추세·진입·리스크를 구조적으로 확인합니다.': 'Structurally check trend/entry/risk with proprietary indicators like Beomon Candle, bull/bear alignment, and AI Target.',
    '범온 캔들 · 범온 캔들 PRO': 'Beomon Candle · Beomon Candle PRO', '정배열 · 역배열 자동 판별': 'Auto-detect bull/bear alignment',
    'AI 목표 · 단타 익절': 'AI Target · scalp take-profit', 'AI 자동분석 · 퀀트 리서치': 'AI auto-analysis · quant research',
    '지표 신호 요약과 AI 해설·예측 API를 통해 차트 판독 시간을 줄이고 의사결정 준비를 돕습니다.': 'Through indicator signal summaries and AI commentary/prediction APIs, we cut chart-reading time and aid decision prep.',
    '지표 신호 자동 요약': 'Auto-summarize indicator signals', '퀀트 리서치용 API 접근': 'API access for quant research',
    '전략 검증 흐름 지원': 'Support strategy-validation flow', '범온 지표로': 'With Beomon indicators,', '보는': 'view', '시장 신호': 'market signals',
    '추세부터 청산까지, 여섯 개 카테고리로 조직화된 지표 라이브러리.': 'From trend to liquidation — an indicator library organized into six categories.',
    '등 자체 개발': ' and other proprietary', 'Pro 지표': 'Pro indicators', '는 시장 판독의 관점 자체를 바꿉니다.': ' change the very perspective of reading the market.',
    '범온MA': 'Beomon MA', '신호': 'Signal', '청산 ·': 'Liquidation ·', '과열 ·': 'Overheating ·', '강도': 'Strength',
    '구조 ·': 'Structure ·', '매물대': 'Volume Profile', '변동성 ·': 'Volatility ·', '외부 의존성 없이': 'With no external dependencies',
    'FastAPI 백엔드부터 자체 Canvas 렌더러까지, 슈퍼차트 AI의 모든 계층은': 'From the FastAPI backend to the proprietary Canvas renderer, every layer of SuperChart AI is',
    '범온누리가 직접 설계·운영': 'designed and operated by Beomonnuri itself',
    '합니다. 외부 SaaS 종속 없이 성능·보안·확장성을 조직 기준에 맞춰 최적화합니다.': '. Without external SaaS dependency, we optimize performance, security, and scalability to your organization’s standards.',
    '백엔드': 'Backend',
    '비동기 처리, 초당 수천 요청 처리. SQLAlchemy ORM + Redis 캐싱으로 밀리초 단위 응답.': 'Async processing, thousands of requests per second. Millisecond responses via SQLAlchemy ORM + Redis caching.',
    'AI 엔진': 'AI Engine',
    '자체 학습 Transformer 모델로 가격 예측. Ollama LLM이 차트 상황을 자연어로 해설합니다.': 'Price prediction with an in-house trained Transformer model. Ollama LLM explains chart situations in natural language.',
    'WebSocket 직결': 'Direct WebSocket',
    '실시간 데이터 파이프라인을 통해 차트 화면에 가격·캔들·거래량을 안정적으로 반영합니다.': 'Reliably reflects price/candle/volume on the chart via a real-time data pipeline.',
    '차트 엔진': 'Chart Engine', '자체 Canvas 렌더러': 'Proprietary Canvas renderer',
    'HTML5 Canvas 기반 자체 개발. 외부 의존성 제로. TypedArray 버퍼로 메모리 효율 극대화.': 'Self-developed on HTML5 Canvas. Zero external dependencies. Maximizes memory efficiency with TypedArray buffers.',
    '검색되는': 'searched', '키워드로': 'by keyword', '정리': 'organized',
    '많이 찾는 검색어 그대로 정리했습니다. 각 키워드는 슈퍼차트 AI가 실제로 다루는 핵심 기능 영역과 대응합니다.': 'Organized around the most-searched terms. Each keyword maps to a core feature area SuperChart AI actually covers.',
    'AI 자동분석': 'AI Auto-analysis', 'AI 차트분석': 'AI Chart Analysis', '지연시간 최소화': 'Latency minimization',
    '퀀트 리서치': 'Quant Research', '트레이딩 자동화': 'Trading Automation',
    '는 여러 시장 신호를 조합해 추세·진입·리스크를 구조적으로 판단합니다.': ' combines multiple market signals to structurally judge trend/entry/risk.',
    '은 지표 신호 요약과 LLM 해설로 차트 판독 시간을 줄이고,': ' cuts chart-reading time with indicator summaries and LLM commentary, and',
    'AI 차트·AI 차트분석': 'AI Chart · AI Chart Analysis',
    '은 실시간 데이터·다중 지표·리스크 이벤트를 한 화면에서 통합합니다.': ' integrates real-time data, multi-indicators, and risk events on one screen.',
    '관점에서는 지표 신호·AI 코멘터리를 함께 보며 전략 검증 흐름을 지원합니다.': ' From this perspective, view indicator signals and AI commentary together to support strategy validation.',
    '자주 묻는': 'Frequently Asked',
    '가장 많이 받는 질문 다섯 가지를 정리했습니다. 더 궁금한 점은 범온누리 이노베이션 홈페이지의 도입 진단 문의를 이용해 주세요.': 'We’ve gathered the five most common questions. For more, please use the adoption consultation inquiry on the Beomonnuri Innovation website.',
    '무료로 사용할 수 있나요?': 'Can I use it for free?',
    '기본 차트와 일부 무료 지표(': 'Basic charts and some free indicators (',
    'RSI, MACD, 볼린저밴드, 슈퍼트렌드': 'RSI, MACD, Bollinger Bands, Supertrend',
    '등)를 사용할 수 있습니다. 범온 Pro 지표(범온 캔들, AI 목표, 단타 익절 등)와 고급 기능은 멤버십·상품 정책에 따라 제공됩니다.': ', etc.) are available. Beomon Pro indicators (Beomon Candle, AI Target, scalp take-profit, etc.) and advanced features are provided per membership/product policy.',
    '어떤 종목을 지원하나요?': 'Which symbols are supported?',
    '심볼 검색에 노출되는': 'shown in symbol search',
    '암호화폐·주식': 'crypto & stocks',
    '종목을 지원합니다. 지원 목록은 데이터 연동 및 운영 정책에 따라 지속적으로 업데이트됩니다.': ' symbols are supported. The list is continuously updated per data integration and operating policy.',
    'AI 예측의 정확도는 어떤가요?': 'How accurate are the AI predictions?',
    'AI 예측은': 'AI predictions are provided as', '참고 정보': 'reference information',
    '로 제공되며, 투자 결정의 유일한 근거로 사용해서는 안 됩니다. Transformer 모델은 과거 패턴 학습 기반이며, 시장 상황에 따라 정확도가 달라질 수 있습니다. 조직 도입 시 백테스트 관점의 정확도 목표를 함께 합의해 측정합니다.': ' and must not be the sole basis for investment decisions. The Transformer model is based on learning past patterns, and accuracy may vary with market conditions. For organizational adoption, we agree on and measure accuracy targets from a backtesting perspective.',
    '모바일에서도 사용할 수 있나요?': 'Can I use it on mobile?', '네,': 'Yes,', '반응형 웹': 'responsive web',
    '으로 설계되어 모바일 브라우저에서 바로 사용 가능합니다. 별도 앱 설치가 필요 없으며, 초보 집중 모드·모바일 퀵 액션 등 모바일 전용 UX 개선이 반영되어 있습니다.': ' — designed so you can use it right in a mobile browser. No app install needed, with mobile-specific UX improvements like beginner focus mode and mobile quick actions.',
    'AI 지표와 일반 기술 지표의 차이는 무엇인가요?': 'What is the difference between AI indicators and regular technical indicators?',
    '범온 캔들 · 정/역배열 · AI 목표': 'Beomon Candle · bull/bear alignment · AI Target',
    '같은 AI 지표는 여러 시장 신호를 조합해 추세·진입·리스크를 구조적으로 판단합니다. 일반 지표(RSI, MACD 등)는 개별 관점만 제공하지만, AI 지표는 지표 간 상호작용까지 반영해 의사결정 준비 시간을 줄입니다.': ' — these AI indicators combine multiple market signals to structurally judge trend/entry/risk. Regular indicators (RSI, MACD, etc.) offer only individual perspectives, while AI indicators reflect inter-indicator interactions to cut decision-prep time.',
    'AI 지표·': 'AI indicators ·', '을 지금': ' now', '시작하세요.': 'Get started.',
    '가입 후 기본 차트와 AI 분석 탭을 바로 확인할 수 있습니다. 유료 기능은 지표·멤버십 정책에 따라 제공됩니다.': 'After signing up, you can immediately access basic charts and the AI analysis tab. Paid features are provided per indicator/membership policy.',
    '엔터프라이즈 도입 진단': 'Enterprise adoption consultation',
    '주요 내비게이션': 'Main navigation', '범온누리 이노베이션 로고': 'Beomonnuri Innovation logo', '주요 성능 지표': 'Key performance metrics',
    '범온 슈퍼차트 AI — AI 지표·AI 차트분석·퀀트 리서치': 'BEOMON SuperChart AI — AI Indicators · AI Chart Analysis · Quant Research',
    '범온 슈퍼차트 AI — AI 지표·AI 차트분석': 'BEOMON SuperChart AI — AI Indicators · AI Chart Analysis',
}
JA = {}
ZH = {}

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
