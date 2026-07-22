"""/chart/{symbol} 라우트 테스트 — 종목별 SEO/공유 미리보기(OG·Twitter) 메타태그.

범위:
- 화이트리스트를 통과한 종목은 title/og:title/og:description/og:url/
  twitter:title/twitter:description/canonical이 종목별로 채워지는지
- 화이트리스트를 통과하지 못한 입력(HTML/스크립트 인젝션 시도 포함)은
  안전하게 기본 index.html로 폴백하는지(사용자 입력이 마크업에 섞이지 않음)
- 서로 다른 종목 요청이 서로의 값을 오염시키지 않는지(독립성)
"""
from __future__ import annotations

import re

import pytest
from starlette.responses import FileResponse, HTMLResponse

from src.main import chart_page


def _extract(html: str, pattern: str) -> str | None:
    m = re.search(pattern, html)
    return m.group(1) if m else None


@pytest.mark.asyncio
async def test_chart_page_fills_per_symbol_meta_tags():
    resp = await chart_page("BTCUSDT")
    assert isinstance(resp, HTMLResponse)
    html = resp.body.decode("utf-8")

    assert _extract(html, r"<title>(.*?)</title>") == "BTC/USDT 실시간 차트 — 범온 AI 슈퍼차트"
    assert _extract(html, r'og:title" content="(.*?)"') == "BTC/USDT 실시간 차트 — 범온 AI 슈퍼차트"
    assert _extract(html, r'og:url" content="(.*?)"') == "https://chart.beomonnuri.com/chart/btcusdt"
    assert "BTC/USDT" in (_extract(html, r'og:description" content="(.*?)"') or "")
    assert _extract(html, r'twitter:title" content="(.*?)"') == "BTC/USDT 실시간 차트 — 범온 AI 슈퍼차트"
    assert _extract(html, r'canonical" href="(.*?)"') == "https://chart.beomonnuri.com/chart/btcusdt"


@pytest.mark.asyncio
async def test_chart_page_different_symbols_do_not_leak_into_each_other():
    btc_html = (await chart_page("BTCUSDT")).body.decode("utf-8")
    eth_html = (await chart_page("ETHUSDT")).body.decode("utf-8")

    assert _extract(btc_html, r"<title>(.*?)</title>") != _extract(eth_html, r"<title>(.*?)</title>")
    assert "BTC/USDT" in _extract(btc_html, r"<title>(.*?)</title>")
    assert "ETH/USDT" in _extract(eth_html, r"<title>(.*?)</title>")
    assert "btcusdt" in _extract(btc_html, r'og:url" content="(.*?)"')
    assert "ethusdt" in _extract(eth_html, r'og:url" content="(.*?)"')


@pytest.mark.asyncio
async def test_chart_page_strips_usdt_suffix_for_display_name():
    resp = await chart_page("solusdt")
    html = resp.body.decode("utf-8")
    title = _extract(html, r"<title>(.*?)</title>")
    assert title.startswith("SOL/USDT")


@pytest.mark.parametrize(
    "malicious_symbol",
    [
        "<script>alert(1)</script>",
        "'; DROP TABLE users; --",
        "../../etc/passwd",
        "a\" onmouseover=\"alert(1)",
        "",
        "a" * 21,  # 길이 초과
        "BTC USDT",  # 공백 포함
    ],
)
@pytest.mark.asyncio
async def test_chart_page_rejects_non_whitelisted_symbols(malicious_symbol):
    resp = await chart_page(malicious_symbol)
    # 화이트리스트(^[A-Z0-9]{2,20}$)를 통과하지 못하면 순수 정적 파일로 폴백해야
    # 하며, 사용자 입력이 어떤 형태로도 응답 본문에 삽입되지 않아야 한다.
    assert isinstance(resp, FileResponse)


@pytest.mark.asyncio
async def test_chart_page_preserves_cache_busting_and_buildver_injection():
    resp = await chart_page("BTCUSDT")
    html = resp.body.decode("utf-8")
    assert "window._buildVer=" in html
    assert "?v=" in html
