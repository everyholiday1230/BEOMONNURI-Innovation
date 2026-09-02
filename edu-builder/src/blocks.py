"""블록 모델 + 안전한 HTML 렌더러.

설계 핵심:
  - 페이지는 "블록"의 순서 있는 목록이다. 각 블록은 type + props(사전).
  - AI/학생/관리자는 모두 이 블록 문서(JSON)만 편집한다. 날것의 HTML 을 다루지
    않으므로, 렌더 단계에서 모든 텍스트를 이스케이프하면 XSS 가 원천 차단된다.
  - 색/폰트/이미지 URL 등 "코드가 아닌 값"만 받아들이고, 화이트리스트로 검증한다.

지원 블록(비전공자가 이해하기 쉬운 최소 집합):
  hero      큰 제목 + 부제 + 버튼 (첫 화면)
  heading   섹션 제목
  text      문단
  image     이미지 (URL + 대체텍스트)
  gallery   이미지 3~N개 격자
  button    링크 버튼
  cards     카드 목록 (제목/설명 반복)
  contact   연락처 정보 (이메일/전화/주소)
  spacer    여백
  divider   구분선
"""
from __future__ import annotations

import html
import re
import uuid
from typing import Any

# ── 안전 검증 유틸 ─────────────────────────────────────────────

_HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# 이미지/링크로 허용할 스킴. javascript:, data:text/html 등은 배제.
_SAFE_URL = re.compile(r"^(?:https?://|/|mailto:|tel:)", re.IGNORECASE)
_DANGEROUS_URL = re.compile(r"^\s*(?:javascript|vbscript|data)\s*:", re.IGNORECASE)


def esc(v: Any) -> str:
    """모든 사용자 텍스트는 이 함수를 거쳐 HTML 에 들어간다(속성/본문 겸용)."""
    return html.escape("" if v is None else str(v), quote=True)


def safe_color(v: Any, fallback: str = "") -> str:
    s = str(v or "").strip()
    return s if _HEX_COLOR.match(s) else fallback


def safe_url(v: Any) -> str:
    """위험 스킴은 버리고 '#' 로 무력화. 허용 스킴만 통과."""
    s = str(v or "").strip()
    if not s:
        return ""
    if _DANGEROUS_URL.match(s):
        return "#"
    if _SAFE_URL.match(s) or not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", s):
        # 허용 스킴이거나, 스킴이 아예 없는 상대경로/앵커면 통과
        return s
    return "#"


def _clamp(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


# ── 테마 ──────────────────────────────────────────────────────

_FONTS = {
    "sans": "'Pretendard Variable', Pretendard, system-ui, sans-serif",
    "serif": "'Nanum Myeongjo', Georgia, serif",
    "rounded": "'Jua', 'Pretendard Variable', sans-serif",
    "mono": "'JetBrains Mono', ui-monospace, monospace",
}


def render_theme(theme: dict[str, Any]) -> str:
    theme = theme or {}
    accent = safe_color(theme.get("accent"), "#2f6df6")
    bg = safe_color(theme.get("bg"), "#ffffff")
    fg = safe_color(theme.get("fg"), "#1a1a1a")
    font_key = theme.get("font") if theme.get("font") in _FONTS else "sans"
    font = _FONTS[font_key]
    return (
        ":root{"
        f"--accent:{accent};--bg:{bg};--fg:{fg};--font:{font};"
        "--muted:color-mix(in srgb,var(--fg) 55%,var(--bg));"
        "--line:color-mix(in srgb,var(--fg) 12%,var(--bg));"
        "--soft:color-mix(in srgb,var(--accent) 8%,var(--bg));"
        "}"
    )


# ── 블록 렌더러 ────────────────────────────────────────────────
# 각 렌더 함수는 props(dict) 를 받아 안전한 HTML 문자열을 반환한다.


def _r_hero(p: dict) -> str:
    title = esc(p.get("title", "제목을 입력하세요"))
    subtitle = esc(p.get("subtitle", ""))
    btn_text = esc(p.get("button_text", ""))
    btn_url = safe_url(p.get("button_url", ""))
    align = p.get("align") if p.get("align") in ("left", "center") else "center"
    img = safe_url(p.get("image", ""))
    style = f' style="background-image:linear-gradient(color-mix(in srgb,var(--bg) 55%,transparent),var(--bg)),url({esc(img)});background-size:cover;background-position:center"' if img else ""
    btn = (
        f'<a class="eb-btn" href="{esc(btn_url)}">{btn_text}</a>'
        if btn_text else ""
    )
    sub = f'<p class="eb-hero-sub">{subtitle}</p>' if subtitle else ""
    return (
        f'<section class="eb-hero eb-align-{align}"{style}>'
        f'<div class="eb-wrap"><h1 class="eb-hero-title">{title}</h1>{sub}{btn}</div>'
        f"</section>"
    )


def _r_heading(p: dict) -> str:
    text = esc(p.get("text", "섹션 제목"))
    align = p.get("align") if p.get("align") in ("left", "center", "right") else "left"
    return f'<section class="eb-sec"><div class="eb-wrap"><h2 class="eb-h2 eb-align-{align}">{text}</h2></div></section>'


def _r_text(p: dict) -> str:
    # 문단 내 줄바꿈만 <br> 로 허용하고 나머지는 전부 이스케이프.
    body = esc(p.get("text", "여기에 내용을 입력하세요.")).replace("\n", "<br>")
    align = p.get("align") if p.get("align") in ("left", "center", "right") else "left"
    return f'<section class="eb-sec"><div class="eb-wrap"><p class="eb-text eb-align-{align}">{body}</p></div></section>'


def _r_image(p: dict) -> str:
    url = safe_url(p.get("url", ""))
    if not url:
        return '<section class="eb-sec"><div class="eb-wrap"><div class="eb-imgph">이미지를 추가하세요</div></div></section>'
    alt = esc(p.get("alt", ""))
    cap = esc(p.get("caption", ""))
    caption = f'<figcaption class="eb-cap">{cap}</figcaption>' if cap else ""
    return (
        f'<section class="eb-sec"><div class="eb-wrap"><figure class="eb-fig">'
        f'<img class="eb-img" src="{esc(url)}" alt="{alt}" loading="lazy">{caption}'
        f"</figure></div></section>"
    )


def _r_gallery(p: dict) -> str:
    items = p.get("images") or []
    cells = []
    for it in items[:12]:
        if isinstance(it, str):
            it = {"url": it}
        url = safe_url((it or {}).get("url", ""))
        if not url:
            continue
        alt = esc((it or {}).get("alt", ""))
        cells.append(f'<img class="eb-gimg" src="{esc(url)}" alt="{alt}" loading="lazy">')
    if not cells:
        cells = ['<div class="eb-imgph">갤러리 이미지를 추가하세요</div>']
    cols = _clamp(p.get("columns"), 2, 4, 3)
    return (
        f'<section class="eb-sec"><div class="eb-wrap">'
        f'<div class="eb-gallery" style="grid-template-columns:repeat({cols},1fr)">'
        + "".join(cells)
        + "</div></div></section>"
    )


def _r_button(p: dict) -> str:
    text = esc(p.get("text", "버튼"))
    url = safe_url(p.get("url", "#"))
    align = p.get("align") if p.get("align") in ("left", "center", "right") else "center"
    return f'<section class="eb-sec"><div class="eb-wrap eb-align-{align}"><a class="eb-btn" href="{esc(url)}">{text}</a></div></section>'


def _r_cards(p: dict) -> str:
    items = p.get("items") or []
    cells = []
    for it in items[:12]:
        it = it or {}
        t = esc(it.get("title", ""))
        d = esc(it.get("desc", "")).replace("\n", "<br>")
        icon = esc(it.get("icon", ""))
        ic = f'<div class="eb-card-ic">{icon}</div>' if icon else ""
        cells.append(f'<div class="eb-card">{ic}<h3 class="eb-card-t">{t}</h3><p class="eb-card-d">{d}</p></div>')
    if not cells:
        cells = ['<div class="eb-card"><h3 class="eb-card-t">카드 제목</h3><p class="eb-card-d">설명</p></div>']
    cols = _clamp(p.get("columns"), 1, 4, min(3, len(cells)) or 1)
    return (
        f'<section class="eb-sec"><div class="eb-wrap">'
        f'<div class="eb-cards" style="grid-template-columns:repeat({cols},1fr)">'
        + "".join(cells)
        + "</div></div></section>"
    )


def _r_contact(p: dict) -> str:
    rows = []
    if p.get("email"):
        e = esc(p["email"])
        rows.append(f'<a class="eb-contact-row" href="mailto:{e}">✉ {e}</a>')
    if p.get("phone"):
        ph = esc(p["phone"])
        rows.append(f'<a class="eb-contact-row" href="tel:{esc(str(p["phone"]).replace(" ", ""))}">☎ {ph}</a>')
    if p.get("address"):
        rows.append(f'<div class="eb-contact-row">📍 {esc(p["address"])}</div>')
    if not rows:
        rows = ['<div class="eb-contact-row">연락처를 입력하세요</div>']
    title = esc(p.get("title", "연락처"))
    return (
        f'<section class="eb-sec eb-contact"><div class="eb-wrap">'
        f'<h2 class="eb-h2">{title}</h2><div class="eb-contact-list">'
        + "".join(rows)
        + "</div></div></section>"
    )


def _r_spacer(p: dict) -> str:
    h = _clamp(p.get("size"), 8, 200, 40)
    return f'<div style="height:{h}px"></div>'


def _r_divider(p: dict) -> str:
    return '<section class="eb-sec"><div class="eb-wrap"><hr class="eb-hr"></div></section>'


_RENDERERS = {
    "hero": _r_hero,
    "heading": _r_heading,
    "text": _r_text,
    "image": _r_image,
    "gallery": _r_gallery,
    "button": _r_button,
    "cards": _r_cards,
    "contact": _r_contact,
    "spacer": _r_spacer,
    "divider": _r_divider,
}

# AI/프론트가 알아야 하는 블록 카탈로그 (타입 → 편집 가능한 필드)
BLOCK_CATALOG: dict[str, dict] = {
    "hero": {"label": "히어로(첫 화면)", "fields": ["title", "subtitle", "button_text", "button_url", "image", "align"]},
    "heading": {"label": "섹션 제목", "fields": ["text", "align"]},
    "text": {"label": "문단", "fields": ["text", "align"]},
    "image": {"label": "이미지", "fields": ["url", "alt", "caption"]},
    "gallery": {"label": "갤러리", "fields": ["images", "columns"]},
    "button": {"label": "버튼", "fields": ["text", "url", "align"]},
    "cards": {"label": "카드 목록", "fields": ["items", "columns"]},
    "contact": {"label": "연락처", "fields": ["title", "email", "phone", "address"]},
    "spacer": {"label": "여백", "fields": ["size"]},
    "divider": {"label": "구분선", "fields": []},
}


def new_block(btype: str, props: dict | None = None) -> dict:
    """새 블록 생성(고유 id 부여). 알 수 없는 타입은 text 로 대체."""
    if btype not in _RENDERERS:
        btype = "text"
    return {"id": uuid.uuid4().hex[:12], "type": btype, "props": props or {}}


def render_block(block: dict) -> str:
    btype = (block or {}).get("type")
    fn = _RENDERERS.get(btype)
    if not fn:
        return ""
    try:
        return fn((block or {}).get("props") or {})
    except Exception:
        # 렌더 중 예외가 나도 전체 페이지가 죽지 않도록 방어
        return ""


def render_document(doc: dict) -> str:
    """블록 문서 전체를 <body> 내부 HTML 로 렌더.

    doc = {"theme": {...}, "blocks": [ {id,type,props}, ... ]}
    반환은 <style> + 블록 HTML. 이 문자열을 안전한 셸(HTML 골격)에 끼운다.
    """
    doc = doc or {}
    blocks = doc.get("blocks") or []
    body = "".join(render_block(b) for b in blocks)
    if not body.strip():
        body = '<section class="eb-hero eb-align-center"><div class="eb-wrap"><h1 class="eb-hero-title">새 페이지</h1><p class="eb-hero-sub">왼쪽에서 AI에게 원하는 내용을 말해보세요.</p></div></section>'
    return f"<style>{render_theme(doc.get('theme') or {})}\n{BASE_CSS}</style>{body}"


def render_full_page(doc: dict, title: str = "") -> str:
    """공개용 완전한 HTML 문서."""
    inner = render_document(doc)
    t = esc(title or (doc or {}).get("title") or "내 홈페이지")
    return (
        "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>{t}</title>"
        "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">"
        "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>"
        "<link href=\"https://fonts.googleapis.com/css2?family=Jua&family=Nanum+Myeongjo:wght@400;700;800&display=swap\" rel=\"stylesheet\">"
        "<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css\">"
        f"</head><body class=\"eb-body\">{inner}</body></html>"
    )


# 블록·공개페이지·미리보기가 공유하는 기본 스타일. 반응형 포함.
BASE_CSS = """
*{box-sizing:border-box}
.eb-body{margin:0;font-family:var(--font);color:var(--fg);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
.eb-wrap{max-width:960px;margin:0 auto;padding:0 20px}
.eb-sec{padding:clamp(28px,5vw,56px) 0}
.eb-align-left{text-align:left}.eb-align-center{text-align:center}.eb-align-right{text-align:right}
.eb-hero{padding:clamp(56px,12vw,140px) 0;background:var(--soft)}
.eb-hero.eb-align-center .eb-wrap{margin-inline:auto}
.eb-hero-title{font-size:clamp(32px,6vw,64px);line-height:1.12;margin:0 0 16px;letter-spacing:-.02em}
.eb-hero-sub{font-size:clamp(16px,2.2vw,21px);color:var(--muted);margin:0 0 28px;max-width:60ch}
.eb-align-center .eb-hero-sub{margin-inline:auto}
.eb-h2{font-size:clamp(24px,4vw,38px);margin:0 0 18px;letter-spacing:-.01em}
.eb-text{font-size:clamp(15px,2vw,18px);margin:0;white-space:normal;word-break:keep-all}
.eb-btn{display:inline-block;background:var(--accent);color:#fff;padding:14px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;transition:filter .15s}
.eb-btn:hover{filter:brightness(1.08)}
.eb-fig{margin:0}.eb-img{width:100%;height:auto;border-radius:14px;display:block}
.eb-cap{color:var(--muted);font-size:14px;margin-top:10px;text-align:center}
.eb-imgph{background:var(--soft);border:2px dashed var(--line);border-radius:14px;padding:64px 20px;text-align:center;color:var(--muted)}
.eb-gallery{display:grid;gap:12px}
.eb-gimg{width:100%;height:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px}
.eb-cards{display:grid;gap:18px}
.eb-card{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:26px}
.eb-card-ic{font-size:30px;margin-bottom:12px}
.eb-card-t{font-size:19px;margin:0 0 8px}
.eb-card-d{color:var(--muted);font-size:15px;margin:0}
.eb-contact .eb-wrap{text-align:center}
.eb-contact-list{display:inline-flex;flex-direction:column;gap:12px;margin-top:12px}
.eb-contact-row{color:var(--fg);text-decoration:none;font-size:17px}
.eb-hr{border:0;border-top:1px solid var(--line)}
@media(max-width:640px){.eb-gallery{grid-template-columns:repeat(2,1fr)!important}.eb-cards{grid-template-columns:1fr!important}}
"""
