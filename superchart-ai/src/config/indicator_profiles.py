"""지표 프로파일 — 각 지표의 메타데이터, 권장 설정, 권한 정보."""

INDICATOR_PROFILES = {
    "ultra": {"name": "범온 캔들", "tier": "pro", "category": "trend", "timeframes": ["5m", "15m", "1h"]},
    "bimaco2": {"name": "범온 캔들 PRO", "tier": "pro", "category": "trend", "timeframes": ["5m", "15m"]},
    "darak": {"name": "범온MA", "tier": "member", "category": "trend", "timeframes": ["5m", "15m", "1h", "4h"]},
    "ob": {"name": "거래밀집구간", "tier": "member", "category": "structure", "timeframes": ["15m", "1h", "4h"]},
    "obsig": {"name": "범온 추세시작", "tier": "pro", "category": "signal", "timeframes": ["5m", "15m", "1h"]},
    "ttr": {"name": "단타 익절", "tier": "pro", "category": "exit", "timeframes": ["1m", "3m", "5m"]},
    "align": {"name": "정/역배열", "tier": "pro", "category": "trend", "timeframes": ["1h", "4h", "1d"]},
    "autotrend": {"name": "자동추세선", "tier": "member", "category": "structure", "timeframes": ["15m", "1h", "4h"]},
    "bimaco_tp": {"name": "AI목표", "tier": "pro", "category": "exit", "timeframes": ["5m", "15m", "1h"]},
    "beom_free": {"name": "범온캔들(무료)", "tier": "free", "category": "trend", "timeframes": ["5m", "15m", "1h"]},
    "bb": {"name": "볼린저밴드", "tier": "free", "category": "volatility", "timeframes": ["5m", "15m", "1h", "4h"]},
    "supertrend": {"name": "슈퍼트렌드", "tier": "free", "category": "trend", "timeframes": ["15m", "1h", "4h"]},
    "ichimoku": {"name": "일목균형표", "tier": "free", "category": "trend", "timeframes": ["1h", "4h", "1d"]},
    "psar": {"name": "추세반전", "tier": "free", "category": "signal", "timeframes": ["5m", "15m", "1h"]},
    "vwap": {"name": "VWAP", "tier": "free", "category": "volume", "timeframes": ["1m", "5m", "15m", "1h"]},
    "rsi": {"name": "RSI", "tier": "free", "category": "momentum", "timeframes": ["5m", "15m", "1h", "4h"]},
    "macd": {"name": "MACD", "tier": "free", "category": "momentum", "timeframes": ["15m", "1h", "4h"]},
    "stoch": {"name": "스토캐스틱", "tier": "free", "category": "momentum", "timeframes": ["5m", "15m", "1h"]},
}

CATEGORIES = {
    "trend": "추세 확인",
    "signal": "진입 신호",
    "exit": "청산/손절",
    "momentum": "과열/강도",
    "structure": "구조/매물대",
    "volatility": "변동성",
    "volume": "거래량",
}

STRATEGY_PROFILES = {
    "ladder": {
        "5m": {"near_pct": 0.01, "target_pct": 2.0, "sl_pct": 1.0},
        "15m": {"near_pct": 0.015, "target_pct": 3.0, "sl_pct": 1.5},
        "1h": {"near_pct": 0.02, "target_pct": 4.0, "sl_pct": 2.0},
        "4h": {"near_pct": 0.03, "target_pct": 6.0, "sl_pct": 3.0},
    },
}
