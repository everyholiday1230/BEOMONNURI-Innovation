"""CoinGecko API 기반 자동 종목 메타데이터 조회.

용도:
- 신규 종목 추가 시 한글명/영문명/이미지 URL 자동 매핑
- DB의 누락된 종목 일괄 업데이트
- 한글명 매핑은 자체 사전 + CoinGecko 영문명 + 음차 변환 결합

사용 예시:
    from src.services.symbol_metadata import lookup_symbol_metadata
    meta = await lookup_symbol_metadata("BTC")
    # → {"name_en": "Bitcoin", "name_ko": "비트코인", "img_url": "https://..."}
"""
from __future__ import annotations
import asyncio
import json
from typing import Optional

import httpx
import structlog

log = structlog.get_logger(__name__)

# ────── 한글 사전 (자주 쓰이는 토큰) ──────
KO_DICT: dict[str, str] = {
    # Top tier
    "BTC": "비트코인", "ETH": "이더리움", "BNB": "바이낸스코인", "XRP": "리플",
    "SOL": "솔라나", "ADA": "에이다", "DOGE": "도지코인", "AVAX": "아발란체",
    "DOT": "폴카닷", "MATIC": "폴리곤", "POL": "폴리곤", "TRX": "트론",
    "LINK": "체인링크", "LTC": "라이트코인", "BCH": "비트코인캐시",
    "UNI": "유니스왑", "ATOM": "코스모스", "XLM": "스텔라루멘", "NEAR": "니어프로토콜",
    "APT": "앱토스", "FIL": "파일코인", "ARB": "아비트럼", "OP": "옵티미즘",
    "INJ": "인젝티브", "TIA": "셀레스티아", "SUI": "수이", "SEI": "세이",
    "STRK": "스타크넷", "MANTA": "만타네트워크", "JUP": "주피터",

    # Meme
    "SHIB": "시바이누", "PEPE": "페페", "WIF": "도그위프햇", "BONK": "봉크",
    "FLOKI": "플로키", "MEME": "미밈", "BOME": "북오브미밈",
    "MEW": "캣인어독스월드",

    # DeFi
    "AAVE": "아베", "MKR": "메이커", "CRV": "커브", "COMP": "컴파운드",
    "SNX": "신세틱스", "SUSHI": "스시스왑", "LDO": "리도", "RNDR": "렌더토큰",
    "GMX": "지엠엑스", "DYDX": "디와이디엑스",

    # AI / Web3
    "FET": "페치에이아이", "AGIX": "싱귤래리티넷", "OCEAN": "오션프로토콜",
    "GRT": "더그래프", "WLD": "월드코인", "AKT": "아카시네트워크",
    "TAO": "비트텐서", "RNDR": "렌더", "AI": "에이아이",

    # Gaming / NFT
    "AXS": "엑시인피니티", "SAND": "샌드박스", "MANA": "디센트럴랜드",
    "GALA": "갈라", "ENJ": "엔진코인", "IMX": "이뮤터블엑스",
    "BLUR": "블러", "PIXEL": "픽셀", "BEAM": "빔", "RON": "로닌",
    "A2Z": "아레나지",

    # Layer 1/2
    "FTM": "팬텀", "ROSE": "오아시스네트워크", "ICP": "인터넷컴퓨터",
    "EGLD": "멀티버스엑스", "FLOW": "플로우", "ALGO": "알고랜드",
    "VET": "비체인", "HBAR": "헤데라", "MINA": "미나프로토콜",
    "KAVA": "카바", "ZIL": "질리카", "QTUM": "퀀텀",
    "EOS": "이오스", "NEO": "네오", "WAVES": "웨이브즈",
    "ZK": "지케이싱크", "BLAST": "블라스트", "TON": "톤코인",
    "JTO": "지토", "DYM": "다임",

    # Privacy
    "XMR": "모네로", "ZEC": "지캐시", "DASH": "대시",

    # Exchange
    "OKB": "오케이비", "CRO": "크로노스", "FTT": "에프티엑스토큰",
    "HT": "후오비토큰", "GT": "게이트토큰", "KCS": "쿠코인",

    # Stablecoins
    "USDT": "테더", "USDC": "유에스디씨", "BUSD": "바이낸스유에스디",
    "DAI": "다이", "TUSD": "트루유에스디", "FDUSD": "퍼스트디지털유에스디",

    # Meme / Trending
    "ORDI": "오디", "SATS": "사츠", "RATS": "랫츠", "1000SATS": "1000사츠",
    "PYTH": "파이스", "JTO": "지토", "ETHFI": "이더파이", "ENA": "이더나",
    "W": "웜홀", "RUNE": "토르체인", "OSMO": "오스모시스",

    # 추가 (자동추가된 변동성 종목)
    "ALT": "알트레이어", "BSB": "블록스트리트", "GENIUS": "지니어스 터미널",
    "MITO": "미토시스", "JCT": "잭션", "IOTA": "아이오타", "ARPA": "아르파",
    "LAB": "랩 프로토콜", "AMD": "에이엠디", "ATU": "에이티유",
    "DENT": "덴트", "FIO": "에프아이오 프로토콜", "NIL": "닐",

    # 알트코인
    "DOT": "폴카닷", "BAT": "베이직어텐션토큰", "ZRX": "제로엑스",
    "REN": "렌", "BNT": "방코르", "OMG": "오미세고",
    "CHZ": "칠리즈", "ICX": "아이콘", "ZEN": "호라이즌",
    "RVN": "레이븐코인", "WIN": "윙크링크", "CELR": "셀러네트워크",
    "ANKR": "앵커", "SXP": "스와이프", "STMX": "스톰엑스",
    "RLC": "아이엑스",
}


def _to_korean_phonetic(name_en: str) -> str:
    """영문명을 한글 음차로 단순 변환 (사전에 없을 때 fallback).

    매우 단순한 매핑이므로 정확하지 않을 수 있음. 사용자가 수동 보정 필요.
    """
    # 일반적인 음차 패턴
    rules = [
        ("Protocol", "프로토콜"), ("Network", "네트워크"), ("Coin", "코인"),
        ("Token", "토큰"), ("Chain", "체인"), ("Finance", "파이낸스"),
        ("Wallet", "월렛"), ("Capital", "캐피털"), ("Dao", "다오"),
        ("DAO", "다오"), ("Inu", "이누"), ("Doge", "도지"), ("Cat", "캣"),
        ("Bit", "비트"), ("Coin", "코인"),
    ]
    result = name_en
    for en, ko in rules:
        result = result.replace(en, ko)
    # 한글 변환되지 않은 부분은 그대로 (사용자가 수동 보정)
    return result if any('\u3131' <= c <= '\u318e' or '\uAC00' <= c <= '\uD7A3' for c in result) else name_en


# ────── CoinGecko API ──────
COINGECKO_API = "https://api.coingecko.com/api/v3"
_symbol_to_id_cache: dict[str, str] = {}
_metadata_cache: dict[str, dict] = {}


async def _build_symbol_to_id_map() -> dict[str, str]:
    """CoinGecko의 전체 코인 리스트로 symbol→id 매핑 빌드 (1회만).

    같은 심볼이 여러 개 있으면 시총 순 (markets API 기반)으로 우선순위 결정.
    """
    if _symbol_to_id_cache:
        return _symbol_to_id_cache
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # 1) 시총 상위 250위까지 — 같은 심볼이 여러 개면 시총 큰 것 우선
            ranked_count = 0
            for page in (1, 2):
                try:
                    rm = await client.get(
                        f"{COINGECKO_API}/coins/markets",
                        params={"vs_currency": "usd", "order": "market_cap_desc", "per_page": 250, "page": page},
                    )
                    if rm.status_code != 200:
                        log.warning("symbol_metadata.markets_status", status=rm.status_code)
                        await asyncio.sleep(2.0)
                        continue
                    markets = rm.json()
                    if not isinstance(markets, list):
                        log.warning("symbol_metadata.markets_not_list", body=str(markets)[:200])
                        await asyncio.sleep(2.0)
                        continue
                    for m in markets:
                        if not isinstance(m, dict):
                            continue
                        sym = m.get("symbol", "").upper()
                        cid = m.get("id", "")
                        if sym and cid and sym not in _symbol_to_id_cache:
                            _symbol_to_id_cache[sym] = cid
                            ranked_count += 1
                except Exception as e:
                    log.warning("symbol_metadata.markets_iter_fail", page=page, err=str(e)[:120])
                await asyncio.sleep(1.5)

            # 2) 전체 리스트로 보충 (시총 외 심볼)
            try:
                r = await client.get(f"{COINGECKO_API}/coins/list")
                if r.status_code == 200:
                    coins = r.json()
                    if isinstance(coins, list):
                        for c in coins:
                            if not isinstance(c, dict):
                                continue
                            sym = c.get("symbol", "").upper()
                            cid = c.get("id", "")
                            if sym and cid and sym not in _symbol_to_id_cache:
                                _symbol_to_id_cache[sym] = cid
            except Exception as e:
                log.warning("symbol_metadata.list_fail", err=str(e)[:120])

        log.info("symbol_metadata.cg_list_loaded", total=len(_symbol_to_id_cache), ranked=ranked_count)
    except Exception as e:
        log.warning("symbol_metadata.cg_list_fail", err=str(e)[:120])
    return _symbol_to_id_cache


async def _fetch_coin_detail(coin_id: str) -> Optional[dict]:
    """CoinGecko에서 coin 상세 조회."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{COINGECKO_API}/coins/{coin_id}",
                params={
                    "localization": "true",  # 한글 포함
                    "tickers": "false",
                    "market_data": "false",
                    "community_data": "false",
                    "developer_data": "false",
                },
            )
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        log.warning("symbol_metadata.cg_detail_fail", coin_id=coin_id, err=str(e)[:80])
    return None


async def lookup_symbol_metadata(base_asset: str) -> dict:
    """
    base_asset (예: "BTC")로 메타데이터 조회.

    전략:
    - 한글명: KO_DICT 우선, 없으면 CoinGecko 한글, 없으면 음차
    - 영문명: CoinGecko 우선, 없으면 base_asset
    - 이미지: CoinGecko 우선

    Returns:
        {
            "name_en": "Bitcoin",
            "name_ko": "비트코인",
            "img_url": "https://coin-images.coingecko.com/...",
            "source": "dict" | "coingecko" | "phonetic" | "fallback"
        }
    """
    base = base_asset.upper()
    if base in _metadata_cache:
        return _metadata_cache[base]

    name_ko_from_dict = KO_DICT.get(base)
    name_ko = name_ko_from_dict
    name_en = base
    img_url = None
    cg_used = False

    # CoinGecko 조회 (영문/이미지 보강 + 한글 fallback)
    try:
        symbol_to_id = await _build_symbol_to_id_map()
        coin_id = symbol_to_id.get(base)
        if coin_id:
            detail = await _fetch_coin_detail(coin_id)
            if detail:
                cg_name_en = detail.get("name", "")
                if cg_name_en:
                    name_en = cg_name_en
                cg_ko = (detail.get("localization") or {}).get("ko", "")
                if not name_ko and cg_ko:
                    name_ko = cg_ko
                images = detail.get("image", {})
                img_url = images.get("large") or images.get("small") or images.get("thumb")
                cg_used = True
    except Exception as e:
        log.warning("symbol_metadata.cg_lookup_fail", base=base, err=str(e)[:80])

    # 한글명 음차 fallback
    source = "fallback"
    if name_ko_from_dict:
        source = "dict+coingecko" if cg_used else "dict"
    elif cg_used and name_ko:
        source = "coingecko"
    elif not name_ko:
        name_ko = _to_korean_phonetic(name_en)
        source = "phonetic" if cg_used else "fallback"

    result = {
        "name_en": name_en,
        "name_ko": name_ko or base,
        "img_url": img_url,
        "source": source,
    }
    _metadata_cache[base] = result
    return result


async def lookup_many(base_assets: list[str], rate_limit_ms: int = 1500) -> dict[str, dict]:
    """여러 종목 일괄 조회 (CoinGecko Free API rate limit 대응).

    CoinGecko Free Tier: 분당 ~30회. 안전하게 1.5초 간격.
    """
    results = {}
    for i, base in enumerate(base_assets):
        results[base] = await lookup_symbol_metadata(base)
        if i < len(base_assets) - 1:
            await asyncio.sleep(rate_limit_ms / 1000)
    return results


# ────── DB 일괄 업데이트 헬퍼 ──────
async def update_db_metadata(only_missing: bool = True) -> dict:
    """DB의 종목 메타데이터를 자동 업데이트.

    Args:
        only_missing: True면 display_name_ko == base_asset 인 종목만 업데이트

    Returns:
        {"updated": int, "skipped": int, "failed": int}
    """
    from src.db.session import SessionLocal
    from sqlalchemy import text

    stats = {"updated": 0, "skipped": 0, "failed": 0}

    async with SessionLocal() as db:
        if only_missing:
            rows = (await db.execute(text(
                "SELECT symbol_code, base_asset FROM symbols "
                "WHERE asset_class='crypto' AND status='active' "
                "AND (display_name_ko = base_asset OR display_name_ko IS NULL)"
            ))).fetchall()
        else:
            rows = (await db.execute(text(
                "SELECT symbol_code, base_asset FROM symbols WHERE asset_class='crypto' AND status='active'"
            ))).fetchall()

        targets = [r[1] for r in rows]
        log.info("symbol_metadata.update_start", count=len(targets))

        for code, base in rows:
            try:
                meta = await lookup_symbol_metadata(base)
                if meta["source"] in ("coingecko", "dict"):
                    # 좋은 데이터 → 업데이트
                    update_metadata = (
                        "UPDATE symbols SET "
                        "display_name_ko=:ko, display_name_en=:en, "
                        "metadata = COALESCE(metadata, '{}'::jsonb) || :meta_json::jsonb, "
                        "updated_at=now() "
                        "WHERE symbol_code=:code"
                    )
                    extra = {"img_url": meta["img_url"]} if meta["img_url"] else {}
                    await db.execute(text(update_metadata), {
                        "ko": meta["name_ko"],
                        "en": meta["name_en"],
                        "meta_json": json.dumps(extra),
                        "code": code,
                    })
                    stats["updated"] += 1
                    log.info("symbol_metadata.updated", code=code, ko=meta["name_ko"], src=meta["source"])
                else:
                    stats["skipped"] += 1
                    log.info("symbol_metadata.skipped", code=code, reason=meta["source"])
                # Rate limit
                await asyncio.sleep(1.5)
            except Exception as e:
                stats["failed"] += 1
                log.warning("symbol_metadata.fail", code=code, err=str(e)[:80])

        await db.commit()

    log.info("symbol_metadata.update_done", **stats)
    return stats
