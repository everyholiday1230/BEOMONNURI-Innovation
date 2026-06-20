"""AI 가격 예측 — Transformer 모델 연동.

⚠️ 모델 제한사항:
- 학습 데이터: BTCUSDT 1시간봉 기준
- 다른 심볼에 적용 시 정확도 보장 안 됨
- 예측은 참고용이며 투자 판단의 근거로 사용하지 마세요
"""
import structlog
from pathlib import Path
import numpy as np

logger = structlog.get_logger(__name__)

_model = None
_device = None
TRAINED_SYMBOL = "BTCUSDT"  # 학습된 심볼

BASE_DIR = Path(__file__).resolve().parent.parent.parent
MODEL_DIR = BASE_DIR / "models" / "ai_model"
CHECKPOINT_V2 = MODEL_DIR / "checkpoints" / "model_BTCUSDT_v2.pt"
CHECKPOINT = CHECKPOINT_V2 if CHECKPOINT_V2.exists() else MODEL_DIR / "checkpoints" / "model_BTCUSDT.pt"


def _load_model():
    global _model, _device
    if _model is not None:
        return _model, _device
    import sys
    import torch
    sys.path.insert(0, str(MODEL_DIR.parent))
    from ai_model.model import TradingTransformer
    _device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    _model = TradingTransformer(n_features=14, d_model=128, nhead=8, num_layers=4, dim_ff=256, n_classes=3)
    if CHECKPOINT.exists():
        state = torch.load(str(CHECKPOINT), map_location=_device, weights_only=True)
        _model.load_state_dict(state, strict=False)
    _model.eval()
    return _model, _device


def _compute_features_from_candles(candles: list[dict]) -> np.ndarray:
    o = np.array([float(c.get("open") or c.get("o", 0)) for c in candles])
    h = np.array([float(c.get("high") or c.get("h", 0)) for c in candles])
    l = np.array([float(c.get("low") or c.get("l", 0)) for c in candles])
    c = np.array([float(c.get("close") or c.get("c", 0)) for c in candles])
    v = np.array([float(c.get("volume") or c.get("v", 0)) for c in candles])
    n = len(c)

    def ema(data, span):
        a = 2 / (span + 1); r = np.empty_like(data); r[0] = data[0]
        for i in range(1, len(data)): r[i] = a * data[i] + (1 - a) * r[i - 1]
        return r
    def sma(data, period):
        r = np.empty_like(data); cs = np.cumsum(data)
        r[:period-1] = cs[:period-1] / np.arange(1, period)
        r[period-1:] = (cs[period-1:] - np.concatenate([[0], cs[:len(data)-period]])) / period
        return r
    def rma(data, period):
        r = np.empty_like(data); r[0] = data[0]; a = 1 / period
        for i in range(1, len(data)): r[i] = a * data[i] + (1 - a) * r[i - 1]
        return r

    sk, lk = ema(c, 50), ema(c, 150)
    kalman_dir = np.where(sk > lk, 1, -1).astype(float)
    kalman_str = np.abs(sk - lk) / np.maximum(c, 1e-8)
    e12, e26 = ema(c, 12), ema(c, 26)
    macd = e12 - e26; macd_sig = ema(macd, 9)
    adx_macd = np.where(macd > macd_sig, 1, -1).astype(float)
    sma75 = sma(c, 75)
    std75 = np.array([np.std(c[max(0, i-74):i+1]) for i in range(n)])
    with np.errstate(divide='ignore', invalid='ignore'):
        zscore = np.where(std75 > 1e-10, (c - sma75) / std75, 0)
    speed = np.gradient(c, 5)
    csimacd = np.sign(macd - macd_sig).astype(float)
    lowess = np.where(ema(c, 30) > ema(c, 60), 1, -1).astype(float)
    market = np.where(c > sma(c, 50), 1, -1).astype(float)
    atr14 = rma(h - l, 14)
    range_f = np.where(c > ema(c, 50) + atr14, 1, np.where(c < ema(c, 50) - atr14, -1, 0)).astype(float)
    adaptive = np.where(ema(c, 20) > ema(c, 50), 1, -1).astype(float)
    composite = (kalman_dir + adx_macd + lowess + market + adaptive) / 5
    highest22 = np.array([np.max(h[max(0, i-21):i+1]) for i in range(n)])
    ce = np.where(c > highest22 - 3 * atr14, 1, -1).astype(float)
    returns_1 = np.concatenate([[0], np.diff(c) / np.maximum(c[:-1], 1e-8)])
    returns_5 = np.concatenate([[0]*5, (c[5:] - c[:-5]) / np.maximum(c[:-5], 1e-8)])

    return np.column_stack([kalman_dir, kalman_str, adx_macd, zscore, speed,
        csimacd, lowess, market, range_f, adaptive, composite, ce, returns_1, returns_5])


def predict(candles: list[dict], seq_len: int = 60, symbol: str = "") -> dict:
    """가격 방향 예측. symbol이 BTCUSDT가 아니면 정확도 경고 포함."""
    if len(candles) < 60:
        return {"direction": "데이터 부족", "confidence": 0, "label": "NO_TRADE"}
    warning = None
    if symbol and symbol != TRAINED_SYMBOL:
        warning = f"모델은 {TRAINED_SYMBOL} 기준 학습됨. {symbol} 예측은 참고용입니다."
        logger.warning("ai_predict.symbol_mismatch", requested=symbol, trained=TRAINED_SYMBOL)
    try:
        import torch
        model, device = _load_model()
        features = _compute_features_from_candles(candles)
        seq = np.nan_to_num(features[-seq_len:], nan=0, posinf=0, neginf=0)
        mean, std = seq.mean(axis=0), seq.std(axis=0) + 1e-8
        seq = (seq - mean) / std
        x = torch.tensor(seq, dtype=torch.float32).unsqueeze(0).to(device)
        with torch.no_grad():
            logits, conf = model(x)
        probs = torch.softmax(logits, dim=-1).squeeze().cpu().numpy()
        confidence = float(conf.squeeze().cpu().item())
        pred = int(np.argmax(probs))
        labels = ["SHORT", "NO_TRADE", "LONG"]
        directions = {"SHORT": "하락", "NO_TRADE": "중립", "LONG": "상승"}
        label = labels[pred]
        result = {"direction": directions[label], "label": label,
                "confidence": round(confidence * 100, 1),
                "probabilities": {"하락": round(float(probs[0]) * 100, 1),
                                  "중립": round(float(probs[1]) * 100, 1),
                                  "상승": round(float(probs[2]) * 100, 1)}}
        if warning:
            result["warning"] = warning
        return result
    except Exception:
        return _fallback_predict(candles)


def _fallback_predict(candles: list[dict]) -> dict:
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    n = len(c)
    def ema(data, span):
        a = 2 / (span + 1); r = np.empty_like(data, dtype=float); r[0] = data[0]
        for i in range(1, len(data)): r[i] = a * data[i] + (1 - a) * r[i - 1]
        return r
    score = 0
    if n >= 50: score += 1 if ema(c, 20)[-1] > ema(c, 50)[-1] else -1
    if n >= 15:
        d = np.diff(c)
        rsi = 100 - 100 / (1 + np.mean(np.where(d > 0, d, 0)[-14:]) / max(np.mean(np.where(d < 0, -d, 0)[-14:]), 1e-10))
        if rsi > 70: score -= 1
        elif rsi < 30: score += 1
    if n >= 26:
        macd = ema(c, 12)[-1] - ema(c, 26)[-1]
        score += 1 if macd > ema(ema(c, 12) - ema(c, 26), 9)[-1] else -1
    if n >= 10:
        ret5 = (c[-1] - c[-6]) / max(c[-6], 1e-10)
        score += 1 if ret5 > 0.01 else (-1 if ret5 < -0.01 else 0)
    conf = min(abs(score) / 4 * 100, 95)
    if score >= 2: d, lb = "상승", "LONG"
    elif score <= -2: d, lb = "하락", "SHORT"
    else: d, lb = "중립", "NO_TRADE"
    return {"direction": d, "label": lb, "confidence": round(conf, 1), "model": "기술적 분석"}
