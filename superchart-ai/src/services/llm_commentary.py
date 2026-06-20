"""LLM 차트 분석 — chartos-ai (qwen2.5:3b 커스텀)."""
import structlog
logger = structlog.get_logger(__name__)
import httpx
import os

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
MODEL = os.getenv("OLLAMA_MODEL", "kanana-chart")


async def generate_commentary(indicator_data: dict) -> str:
    """지표 데이터를 LLM에 전달하여 분석 코멘터리 생성."""
    prompt = f"""당신은 차트 분석가입니다. 아래 데이터를 보고 한국어로 3~5줄의 짧은 분석을 작성하세요.

규칙 (반드시 지킬 것):
- "100%", "확정", "무조건", "보장" 등 단정 표현 금지
- "~로 보입니다", "~할 가능성이 있습니다", "~경향이 있습니다" 등 확률·추정 표현 사용
- 매수/매도 추천 금지 (참고 정보만 제공)
- "투자 조언 아님" 톤 유지

종목: {indicator_data.get('symbol', 'BTCUSDT')} ({indicator_data.get('timeframe', '1h')}봉)
현재가: ${indicator_data.get('price', 0):,.0f}
추세강도: {indicator_data.get('signal_sum', 0)}/12
RSI: {indicator_data.get('rsi', 50):.0f}
강도측정: {indicator_data.get('uprsi', 0):+.2f}
과열분석: {indicator_data.get('upstoch', 0):+.2f}
매매압력: RSI={indicator_data.get('scaled_rsi', 0):.2f} MFI={indicator_data.get('scaled_mfi', 0):.2f}
추세전환: {indicator_data.get('stc', 0):.2f}
거래밀집구간: {indicator_data.get('ob_info', '없음')}
추세선: {indicator_data.get('trendline_info', '없음')}"""

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(OLLAMA_URL, json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": 300},
            })
            if resp.status_code == 200:
                text = resp.json().get("response", "")
                if text.strip():
                    return text
    except Exception as _e:
        logger.debug("services.llm_commentary.silent_except", error=str(_e)[:100])
    # ── 폴백: 지표 기반 자동 해설 ──
    return _fallback_commentary(indicator_data)


def _fallback_commentary(d: dict) -> str:
    """Ollama 미실행 시 지표 데이터로 자동 해설 생성."""
    sym = d.get("symbol", "BTCUSDT")
    tf = d.get("timeframe", "1h")
    price = d.get("price", 0)
    ss = d.get("signal_sum", 0)
    rsi = d.get("rsi", 50)

    # 추세 판단
    if ss >= 7:
        trend = "강한 상승 추세"
    elif ss >= 3:
        trend = "약한 상승 추세"
    elif ss >= -2:
        trend = "횡보/중립"
    elif ss >= -6:
        trend = "약한 하락 추세"
    else:
        trend = "강한 하락 추세"

    # RSI 판단
    if rsi > 70:
        rsi_msg = f"RSI {rsi:.0f}로 과매수 구간입니다. 단기 조정 가능성에 유의하세요."
    elif rsi < 30:
        rsi_msg = f"RSI {rsi:.0f}로 과매도 구간입니다. 반등 가능성을 주시하세요."
    else:
        rsi_msg = f"RSI {rsi:.0f}로 중립 구간입니다."

    return (
        f"[자동 분석] {sym} {tf}봉 — 현재가 ${price:,.0f}\n"
        f"추세: {trend} (시그널 {ss}/12)\n"
        f"{rsi_msg}\n"
        f"※ LLM 서버 미연결로 자동 생성된 분석입니다."
    )
