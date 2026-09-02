"""사전 제작 템플릿.

학생이 빈 화면에서 시작하지 않도록, 완성형에 가까운 블록 문서를 여러 개 제공한다.
학생은 템플릿을 고른 뒤 AI에게 "카페 이름을 우리 가게로 바꿔줘" 처럼 말하며 수정한다.

이미지는 외부 무료 소스(picsum) 자리표시자를 쓴다. 실제 서비스에서는 업로드/생성으로 대체.
각 템플릿은 render_document 가 이해하는 {theme, blocks} 구조를 그대로 갖는다.
"""
from __future__ import annotations

import copy
import uuid


def _b(btype: str, **props) -> dict:
    return {"id": uuid.uuid4().hex[:12], "type": btype, "props": props}


def _img(seed: str, w: int = 1200, h: int = 800) -> str:
    return f"https://picsum.photos/seed/{seed}/{w}/{h}"


# ── 템플릿 정의 ────────────────────────────────────────────────
# 각 항목: id, name(한글), desc, emoji, theme, blocks

_TEMPLATES: list[dict] = [
    {
        "id": "blank",
        "name": "빈 페이지",
        "desc": "아무것도 없는 상태에서 자유롭게 시작해요.",
        "emoji": "📄",
        "theme": {"accent": "#2f6df6", "bg": "#ffffff", "fg": "#1a1a1a", "font": "sans"},
        "blocks": [
            _b("hero", title="새 홈페이지", subtitle="AI에게 원하는 내용을 말해보세요.",
               button_text="시작하기", button_url="#", align="center"),
        ],
    },
    {
        "id": "cafe",
        "name": "카페 · 음식점",
        "desc": "메뉴와 위치를 소개하는 아늑한 가게 홈페이지.",
        "emoji": "☕",
        "theme": {"accent": "#b5651d", "bg": "#fdf8f3", "fg": "#2b2118", "font": "serif"},
        "blocks": [
            _b("hero", title="따뜻한 하루,\n한 잔의 여유", subtitle="매일 아침 로스팅하는 스페셜티 원두",
               button_text="메뉴 보기", button_url="#menu", align="center", image=_img("cafe-hero")),
            _b("heading", text="우리의 메뉴", align="center"),
            _b("cards", columns=3, items=[
                {"icon": "☕", "title": "핸드드립", "desc": "그날의 원두를 정성껏 내립니다."},
                {"icon": "🥐", "title": "베이커리", "desc": "매장에서 직접 구운 빵과 디저트."},
                {"icon": "🌿", "title": "브런치", "desc": "건강한 재료로 만든 아침 메뉴."},
            ]),
            _b("image", url=_img("cafe-interior", 1200, 600), alt="카페 내부", caption="편안한 공간에서 쉬어가세요"),
            _b("contact", title="찾아오시는 길", phone="02-123-4567",
               address="서울시 어딘가 12길 34", email="hello@cafe.com"),
        ],
    },
    {
        "id": "portfolio",
        "name": "포트폴리오",
        "desc": "내 작업과 소개를 담는 개인 포트폴리오.",
        "emoji": "🎨",
        "theme": {"accent": "#111111", "bg": "#ffffff", "fg": "#111111", "font": "sans"},
        "blocks": [
            _b("hero", title="안녕하세요,\n디자이너 홍길동입니다", subtitle="브랜드와 화면을 디자인합니다.",
               button_text="작업 보기", button_url="#works", align="left"),
            _b("heading", text="주요 작업", align="left"),
            _b("gallery", columns=3, images=[
                {"url": _img("work1", 600, 600), "alt": "작업 1"},
                {"url": _img("work2", 600, 600), "alt": "작업 2"},
                {"url": _img("work3", 600, 600), "alt": "작업 3"},
                {"url": _img("work4", 600, 600), "alt": "작업 4"},
                {"url": _img("work5", 600, 600), "alt": "작업 5"},
                {"url": _img("work6", 600, 600), "alt": "작업 6"},
            ]),
            _b("heading", text="소개", align="left"),
            _b("text", text="5년간 스타트업과 브랜드의 디자인을 맡아왔습니다. 사용자의 문제를 시각적으로 푸는 일을 좋아합니다.", align="left"),
            _b("contact", title="연락", email="hello@portfolio.com"),
        ],
    },
    {
        "id": "academy",
        "name": "학원 · 교육",
        "desc": "수업과 강사를 소개하고 상담을 받는 페이지.",
        "emoji": "📚",
        "theme": {"accent": "#2f6df6", "bg": "#f7f9fc", "fg": "#16213e", "font": "sans"},
        "blocks": [
            _b("hero", title="꿈을 키우는 배움터", subtitle="한 명 한 명에게 맞춘 수업으로 성장을 돕습니다.",
               button_text="상담 신청", button_url="#contact", align="center", image=_img("academy-hero")),
            _b("cards", columns=3, items=[
                {"icon": "✏️", "title": "맞춤 커리큘럼", "desc": "수준별 소수정예 수업."},
                {"icon": "👩\u200d🏫", "title": "경력 강사진", "desc": "풍부한 경험의 선생님들."},
                {"icon": "📈", "title": "성적 관리", "desc": "정기 점검과 피드백."},
            ]),
            _b("heading", text="개설 강좌", align="center"),
            _b("cards", columns=2, items=[
                {"title": "초등 기초반", "desc": "학습 습관을 잡아주는 기초 과정."},
                {"title": "중등 심화반", "desc": "내신과 사고력을 함께 잡는 과정."},
            ]),
            _b("contact", title="상담 문의", phone="031-000-0000", address="경기도 학원로 10", email="edu@academy.com"),
        ],
    },
    {
        "id": "event",
        "name": "행사 · 초대",
        "desc": "행사·모임·발표회를 알리는 초대 페이지.",
        "emoji": "🎉",
        "theme": {"accent": "#e0316b", "bg": "#141018", "fg": "#f5f0f6", "font": "rounded"},
        "blocks": [
            _b("hero", title="2026 봄 발표회", subtitle="여러분을 특별한 자리에 초대합니다.",
               button_text="참가 신청", button_url="#rsvp", align="center", image=_img("event-hero")),
            _b("heading", text="행사 안내", align="center"),
            _b("cards", columns=3, items=[
                {"icon": "📅", "title": "일시", "desc": "2026년 3월 15일 오후 2시"},
                {"icon": "📍", "title": "장소", "desc": "시민회관 대공연장"},
                {"icon": "🎟️", "title": "입장", "desc": "무료 · 사전 신청"},
            ]),
            _b("text", text="가족과 친구를 모두 초대해주세요. 잊지 못할 하루를 준비했습니다.", align="center"),
            _b("button", text="지금 신청하기", url="#rsvp", align="center"),
        ],
    },
    {
        "id": "profile",
        "name": "자기소개 · 이력",
        "desc": "나를 소개하는 한 장짜리 프로필 페이지.",
        "emoji": "🙋",
        "theme": {"accent": "#0aa06e", "bg": "#ffffff", "fg": "#132a22", "font": "sans"},
        "blocks": [
            _b("hero", title="김하늘", subtitle="개발자 · 여행가 · 커피 애호가", align="center", image=_img("profile-hero", 1200, 700)),
            _b("heading", text="이런 일을 해요", align="center"),
            _b("cards", columns=3, items=[
                {"icon": "💻", "title": "개발", "desc": "웹과 앱을 만듭니다."},
                {"icon": "✈️", "title": "여행", "desc": "20개국을 다녀왔어요."},
                {"icon": "📷", "title": "사진", "desc": "일상을 기록합니다."},
            ]),
            _b("text", text="새로운 것을 배우고 만드는 걸 좋아합니다. 함께 좋은 것을 만들어요!", align="center"),
            _b("contact", title="연락처", email="hi@haneul.me"),
        ],
    },
    {
        "id": "shop",
        "name": "제품 · 소개",
        "desc": "하나의 제품·서비스를 소개하는 랜딩 페이지.",
        "emoji": "🛍️",
        "theme": {"accent": "#6b3ff2", "bg": "#ffffff", "fg": "#1c1630", "font": "sans"},
        "blocks": [
            _b("hero", title="당신의 하루를 바꾸는\n작은 습관", subtitle="지금 만나보세요.",
               button_text="구매하기", button_url="#buy", align="left", image=_img("shop-hero")),
            _b("heading", text="이런 점이 좋아요", align="center"),
            _b("cards", columns=3, items=[
                {"icon": "⚡", "title": "빠른 효과", "desc": "쓰는 순간 느껴지는 변화."},
                {"icon": "🌱", "title": "안심 성분", "desc": "믿을 수 있는 원료만."},
                {"icon": "💝", "title": "선물하기 좋은", "desc": "예쁜 패키지로 배송."},
            ]),
            _b("image", url=_img("shop-product", 1200, 700), alt="제품 사진"),
            _b("button", text="지금 구매하기", url="#buy", align="center"),
            _b("contact", title="문의", email="shop@brand.com", phone="1600-0000"),
        ],
    },
]


def list_templates() -> list[dict]:
    """갤러리 표시용 메타(문서 본문 제외)."""
    return [
        {"id": t["id"], "name": t["name"], "desc": t["desc"], "emoji": t["emoji"]}
        for t in _TEMPLATES
    ]


def get_template_doc(template_id: str) -> dict | None:
    """선택한 템플릿의 편집 가능한 문서 사본을 반환(원본 불변)."""
    for t in _TEMPLATES:
        if t["id"] == template_id:
            return copy.deepcopy({"theme": t["theme"], "blocks": t["blocks"], "title": t["name"]})
    return None
