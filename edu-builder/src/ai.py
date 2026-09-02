"""AI 어댑터 — 자연어 대화를 블록 문서 편집으로 변환하고, 완성까지 단계적으로 안내한다.

두 가지 제공자:
  MockAI    키 없이 규칙 기반으로 동작. 개발·시연·오프라인용. 가이드 흐름도 지원.
  OpenAIAI  ChatGPT 함수콜링. 자연스러운 인터뷰 + 상용 수준 카피/디자인 생성.

동일 인터페이스:
    adapter.start(doc) -> {"doc","reply","suggestions","stage"}   # 첫 인사 + 첫 질문
    adapter.edit(doc, message, history) -> {"doc","reply","ops","suggestions","stage"}

가이드 흐름(진행 단계)은 doc["flow"] 에 저장된다:
    doc["flow"] = {"stage": <STAGE>, "answers": {...}, "suggestions": [...]}
renderer 는 doc["blocks"]/doc["theme"] 만 읽으므로 flow 는 렌더에 영향을 주지 않는다.

모든 편집은 apply_ops() 라는 단일 안전 관문을 통과한다(알 수 없는 op/필드/블록타입 무시).
"""
from __future__ import annotations

import json
import re
from typing import Any

from .blocks import BLOCK_CATALOG, new_block
from .config import settings

# ── 진행 단계 ─────────────────────────────────────────────────
STAGES = ["purpose", "name", "mood", "content", "images", "contact", "polish", "done"]
STAGE_LABEL = {
    "purpose": "① 무엇을 만들까요", "name": "② 이름 짓기", "mood": "③ 분위기·색",
    "content": "④ 핵심 내용", "images": "⑤ 사진", "contact": "⑥ 연락처",
    "polish": "⑦ 다듬기", "done": "✓ 완성",
}


def stage_index(stage: str) -> int:
    return STAGES.index(stage) if stage in STAGES else 0


# 분위기 → 조화로운 팔레트(accent/bg/fg/font)
_MOOD_PALETTES = {
    "따뜻": {"accent": "#d9772b", "bg": "#fdf8f2", "fg": "#3a2a1c", "font": "serif"},
    "시원": {"accent": "#2f8fd6", "bg": "#f5fbff", "fg": "#12303f", "font": "sans"},
    "모던": {"accent": "#111111", "bg": "#ffffff", "fg": "#111111", "font": "sans"},
    "귀여": {"accent": "#f06aa8", "bg": "#fff7fb", "fg": "#4a2338", "font": "rounded"},
    "고급": {"accent": "#9a7b4f", "bg": "#faf8f5", "fg": "#22201c", "font": "serif"},
    "활기": {"accent": "#f2801f", "bg": "#fffdf7", "fg": "#26200f", "font": "rounded"},
    "차분": {"accent": "#5b7a6b", "bg": "#f6f8f6", "fg": "#26302b", "font": "sans"},
    "자연": {"accent": "#4b9e5f", "bg": "#f5faf3", "fg": "#20301f", "font": "sans"},
}

# 업종/목적 → 시작 템플릿
_PURPOSE_TEMPLATE = {
    "카페": "cafe", "음식": "cafe", "식당": "cafe", "베이커리": "cafe", "커피": "cafe",
    "포트폴리오": "portfolio", "작업": "portfolio", "디자이너": "portfolio",
    "학원": "academy", "교육": "academy", "과외": "academy", "강의": "academy",
    "행사": "event", "초대": "event", "발표": "event", "모임": "event",
    "소개": "profile", "자기소개": "profile", "이력": "profile", "프로필": "profile",
    "제품": "shop", "쇼핑": "shop", "판매": "shop", "브랜드": "shop", "가게": "shop",
}


# ── 문서에 도구 연산 적용 (모든 편집의 단일 관문) ──────────────

_ALLOWED_THEME = {"accent", "bg", "fg", "font"}


def apply_ops(doc: dict, ops: list[dict]) -> dict:
    doc = json.loads(json.dumps(doc or {}))  # 깊은 복사 (flow 포함 보존)
    doc.setdefault("blocks", [])
    doc.setdefault("theme", {})
    blocks: list[dict] = doc["blocks"]

    def _find(bid: str) -> int:
        for i, b in enumerate(blocks):
            if b.get("id") == bid:
                return i
        return -1

    def _find_type(btype: str) -> int:
        for i, b in enumerate(blocks):
            if b.get("type") == btype:
                return i
        return -1

    for op in ops or []:
        kind = (op or {}).get("op")
        if kind == "add_block":
            btype = op.get("type", "text")
            if btype not in BLOCK_CATALOG:
                continue
            blk = new_block(btype, op.get("props") or {})
            pos = op.get("position")
            if isinstance(pos, int) and 0 <= pos <= len(blocks):
                blocks.insert(pos, blk)
            else:
                blocks.append(blk)
        elif kind == "update_block":
            i = _find(op.get("block_id", ""))
            # block_id 대신 type 으로도 지정 가능(첫 해당 블록)
            if i < 0 and op.get("type"):
                i = _find_type(op["type"])
            if i >= 0 and isinstance(op.get("props"), dict):
                blocks[i].setdefault("props", {}).update(op["props"])
        elif kind == "remove_block":
            i = _find(op.get("block_id", ""))
            if i >= 0:
                blocks.pop(i)
        elif kind == "move_block":
            i = _find(op.get("block_id", ""))
            pos = op.get("position")
            if i >= 0 and isinstance(pos, int) and 0 <= pos < len(blocks):
                blocks.insert(pos, blocks.pop(i))
        elif kind == "set_theme":
            for k, v in (op.get("theme") or {}).items():
                if k in _ALLOWED_THEME:
                    doc["theme"][k] = v
        elif kind == "apply_template":
            from .templates_data import get_template_doc
            td = get_template_doc(op.get("template_id", ""))
            if td:
                doc["theme"] = td.get("theme", {})
                doc["blocks"] = td.get("blocks", [])
                blocks = doc["blocks"]
    return doc


def _get_flow(doc: dict) -> dict:
    f = (doc or {}).get("flow") or {}
    f.setdefault("stage", "purpose")
    f.setdefault("answers", {})
    return f


def _set_flow(doc: dict, stage: str, suggestions: list[str], answers: dict | None = None) -> None:
    doc.setdefault("flow", {})
    doc["flow"]["stage"] = stage
    doc["flow"]["suggestions"] = suggestions
    if answers is not None:
        doc["flow"]["answers"] = answers


# ── OpenAI 함수콜링 스펙 ──────────────────────────────────────

def _tools_spec() -> list[dict]:
    types = list(BLOCK_CATALOG.keys())
    return [{
        "type": "function",
        "function": {
            "name": "edit_page",
            "description": "홈페이지 블록 문서를 편집하고, 학생에게 다음 안내(질문)를 준다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ops": {
                        "type": "array",
                        "description": "이번 턴에 적용할 편집 연산(없으면 빈 배열). 질문만 할 때는 비운다.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": [
                                    "add_block", "update_block", "remove_block",
                                    "move_block", "set_theme", "apply_template"]},
                                "type": {"type": "string", "enum": types},
                                "block_id": {"type": "string"},
                                "props": {"type": "object"},
                                "position": {"type": "integer"},
                                "theme": {"type": "object", "properties": {
                                    "accent": {"type": "string"}, "bg": {"type": "string"},
                                    "fg": {"type": "string"},
                                    "font": {"type": "string", "enum": ["sans", "serif", "rounded", "mono"]}}},
                                "template_id": {"type": "string"},
                            },
                            "required": ["op"],
                        },
                    },
                    "reply": {"type": "string", "description": "학생에게 보여줄 따뜻한 한국어 안내/질문 (한두 문장)"},
                    "stage": {"type": "string", "enum": STAGES,
                              "description": "이번 응답 이후의 진행 단계"},
                    "suggestions": {"type": "array", "items": {"type": "string"},
                                    "description": "학생이 눌러서 답할 예시 3~5개(짧게)"},
                },
                "required": ["ops", "reply", "stage", "suggestions"],
            },
        },
    }]


def _doc_summary(doc: dict) -> str:
    lines = []
    theme = doc.get("theme") or {}
    lines.append(f"theme: accent={theme.get('accent','')}, font={theme.get('font','sans')}")
    for i, b in enumerate(doc.get("blocks") or []):
        p = b.get("props") or {}
        hint = str(p.get("title") or p.get("text") or p.get("url") or "")[:40]
        lines.append(f"[{i}] id={b.get('id')} type={b.get('type')} · {hint}")
    return "\n".join(lines) or "(빈 페이지)"


_SYSTEM_PROMPT = """너는 '홈페이지 만들기 선생님' AI야. 코딩을 전혀 모르는 학생이 수업 시간(약 40~50분) 안에
상용 수준의 홈페이지 한 페이지를 완성하도록, 정해진 순서로 하나씩 질문하고 그때그때 페이지를 만들어 간다.

## 진행 원칙
- 반드시 한 번에 하나만 질문해. 질문은 짧고 쉽게, 이해를 돕는 예시를 곁들여.
- 학생 답이 오면: (1) edit_page의 ops로 페이지를 실제로 바꾸고 (2) reply에 다음 단계 질문을 담아.
- 매 응답에 suggestions(학생이 눌러 답할 예시 3~5개)를 꼭 제공해. 짧고 구체적으로.
- stage로 현재 진행 단계를 정확히 표시해. 정보가 모이면 다음 단계로 넘어가.
- 학생이 "알아서 해줘/다 만들어줘"라고 하면, 지금까지 답을 바탕으로 남은 단계를 한 번에 완성해.

## 단계 순서
purpose  어떤 홈페이지인지(업종/목적). 답이 오면 가장 가까운 템플릿을 apply_template로 적용하고 name으로.
name     상호/이름과 한 줄 소개. hero의 title/subtitle을 update_block으로 채우고 mood로.
mood     분위기·색感. set_theme으로 업종에 맞는 조화로운 팔레트 지정 후 content로.
content  핵심 내용(메뉴/서비스/소개 항목). cards나 text로 실제 내용을 채우고 images로.
images   사진 분위기. URL이 있으면 반영, 없으면 예시 이미지로 자리 채움. contact로.
contact  연락처(전화/이메일/주소/영업시간). contact 블록을 채우고 polish로.
polish   전체를 상용 수준으로 다듬기(색·여백·문구). 개선 1~2가지를 제안하고 done으로.
done     완성 축하 + "공개하기" 안내. 이후엔 학생 요청을 자유롭게 반영.

## 품질 기준 (상용 수준)
- 문구는 실제로 쓸 수 있는 완성된 한국어로. 빈칸/placeholder 금지.
- 색은 업종·분위기에 맞는 조화로운 팔레트(accent/bg/fg)로. 대비를 충분히.
- 구조: hero → 핵심 소개 → 카드/갤러리 → 연락처 순으로 자연스럽게.
- 이미 있는 블록은 새로 쌓지 말고 update_block으로 다듬어.
- 전문 용어 쓰지 말고, 학생을 칭찬하며 이끌어."""


def _stage_hint(doc: dict) -> str:
    f = _get_flow(doc)
    return (f"현재 단계: {f.get('stage')}\n"
            f"지금까지 파악한 정보: {json.dumps(f.get('answers', {}), ensure_ascii=False)}")


class OpenAIAI:
    provider = "openai"

    def __init__(self) -> None:
        from openai import OpenAI
        self._client = OpenAI(api_key=settings.OPENAI_API_KEY)
        self._model = settings.OPENAI_MODEL
        self._fallback = MockAI()

    def start(self, doc: dict) -> dict:
        # 첫 인사는 결정적으로(비용/일관성) 고정 질문을 쓴다.
        return self._fallback.start(doc)

    def edit(self, doc: dict, message: str, history: list[dict] | None = None,
             guided: bool = True) -> dict:
        if guided:
            sys_prompt = _SYSTEM_PROMPT
            extra = [{"role": "system", "content": _stage_hint(doc)}]
        else:
            # 관리자 개입/자유 편집: 인터뷰 없이 지시만 정확히 반영한다.
            sys_prompt = (
                "너는 홈페이지 편집 도우미다. 사용자의 지시를 edit_page 도구로 정확히 반영해라. "
                "새 질문을 하거나 인터뷰를 진행하지 마라. stage 는 현재 값을 그대로 두고, "
                "suggestions 는 비워도 된다. reply 는 무엇을 바꿨는지 한 문장으로."
            )
            extra = []
        msgs = [
            {"role": "system", "content": sys_prompt},
            {"role": "system", "content": "현재 페이지 상태:\n" + _doc_summary(doc)},
            *extra,
        ]
        for h in (history or [])[-8:]:
            if h.get("role") in ("user", "assistant") and not h.get("hidden"):
                msgs.append({"role": h["role"], "content": str(h["content"])[:600]})
        msgs.append({"role": "user", "content": message})

        cur_stage = _get_flow(doc).get("stage")
        try:
            resp = self._client.chat.completions.create(
                model=self._model, messages=msgs, tools=_tools_spec(),
                tool_choice={"type": "function", "function": {"name": "edit_page"}},
                temperature=0.5, max_tokens=1500,
            )
            call = resp.choices[0].message.tool_calls[0]
            args = json.loads(call.function.arguments)
            ops = args.get("ops", []) or []
            reply = args.get("reply") or "좋아요!"
            stage = (args.get("stage") if (guided and args.get("stage") in STAGES) else cur_stage)
            suggestions = args.get("suggestions") or ([] if not guided else [])
            new_doc = apply_ops(doc, ops)
            _set_flow(new_doc, stage, suggestions or _get_flow(doc).get("suggestions", []))
            return {"doc": new_doc, "reply": reply, "ops": ops,
                    "suggestions": suggestions, "stage": stage}
        except Exception as e:
            out = self._fallback.edit(doc, message, history, guided=guided)
            out["reply"] += "\n(지금은 간단 모드로 도와드렸어요.)"
            out["error"] = str(e)[:120]
            return out


class MockAI:
    """키 없이 동작하는 규칙 기반 어댑터. 가이드 흐름을 스크립트로 구현한다."""

    provider = "mock"

    _COLORS = {
        "빨": "#e23b3b", "빨강": "#e23b3b", "레드": "#e23b3b", "파랑": "#2f6df6",
        "파란": "#2f6df6", "블루": "#2f6df6", "초록": "#0aa06e", "녹색": "#0aa06e",
        "그린": "#0aa06e", "보라": "#6b3ff2", "퍼플": "#6b3ff2", "분홍": "#e0316b",
        "핑크": "#e0316b", "주황": "#f2801f", "오렌지": "#f2801f", "검정": "#111111",
        "검은": "#111111", "블랙": "#111111", "노랑": "#f4c020", "노란": "#f4c020",
    }

    # ── 시작: 첫 질문 ──
    def start(self, doc: dict) -> dict:
        doc = json.loads(json.dumps(doc or {"blocks": [], "theme": {}}))
        sugg = ["카페·음식점", "학원·교육", "포트폴리오", "행사 초대", "제품·브랜드 소개", "자기소개"]
        _set_flow(doc, "purpose", sugg, {})
        reply = ("안녕하세요! 함께 멋진 홈페이지를 만들어 볼까요? 🙂\n"
                 "먼저, **어떤 홈페이지**를 만들고 싶으세요? (아래에서 골라도 좋아요)")
        return {"doc": doc, "reply": reply, "suggestions": sugg, "stage": "purpose", "ops": []}

    # ── 단계별 처리 ──
    def edit(self, doc: dict, message: str, history: list[dict] | None = None,
             guided: bool = True) -> dict:
        flow = _get_flow(doc)
        stage = flow.get("stage", "purpose")
        answers = dict(flow.get("answers", {}))
        m = message.strip()

        # 관리자 개입/자유 편집은 가이드 단계를 따르지 않고 직접 지시로 처리한다.
        if not guided:
            ops, reply, _, sugg = self._reactive(doc, m)
            new_doc = apply_ops(doc, ops)
            # 개입은 진행 단계를 바꾸지 않는다(학생 흐름 보존)
            _set_flow(new_doc, stage, flow.get("suggestions", sugg), answers)
            return {"doc": new_doc, "reply": reply, "ops": ops,
                    "suggestions": flow.get("suggestions", sugg), "stage": stage}

        handler = getattr(self, f"_stage_{stage}", None)
        if handler:
            ops, reply, next_stage, sugg = handler(doc, m, answers)
        else:
            ops, reply, next_stage, sugg = self._reactive(doc, m)

        new_doc = apply_ops(doc, ops)
        _set_flow(new_doc, next_stage, sugg, answers)
        return {"doc": new_doc, "reply": reply, "ops": ops,
                "suggestions": sugg, "stage": next_stage}

    # 1) 목적 → 템플릿 적용
    def _stage_purpose(self, doc, m, answers):
        answers["purpose"] = m
        tid = "profile"
        for k, t in _PURPOSE_TEMPLATE.items():
            if k in m:
                tid = t
                break
        ops = [{"op": "apply_template", "template_id": tid}]
        reply = ("좋아요! 그럼 이 홈페이지의 **이름(상호)**과 **한 줄 소개**를 알려주세요.\n"
                 "예: \"행복 카페 / 매일 아침 직접 볶는 커피\"")
        sugg = ["행복 카페 / 매일 볶는 신선한 커피", "OO공방 / 손으로 만드는 소품",
                "OO학원 / 꿈을 키우는 배움터", "이름은 아직 고민 중이에요"]
        return ops, reply, "name", sugg

    # 2) 이름·소개 → hero 채우기
    def _stage_name(self, doc, m, answers):
        answers["name"] = m
        # "이름 / 소개" 형태 분리
        parts = re.split(r"\s*[/·|–—-]\s*", m, maxsplit=1)
        title = parts[0].strip() if parts and parts[0].strip() else m[:20]
        subtitle = parts[1].strip() if len(parts) > 1 else ""
        ops = [{"op": "update_block", "type": "hero",
                "props": {"title": title, **({"subtitle": subtitle} if subtitle else {})}}]
        reply = (f'"{title}" 멋지네요! 이제 **분위기와 색감**을 정해볼까요?\n'
                 "어떤 느낌이 좋으세요?")
        sugg = ["따뜻하게", "시원하게", "모던하게", "귀엽게", "고급스럽게", "자연스럽게"]
        return ops, reply, "mood", sugg

    # 3) 분위기 → 팔레트
    def _stage_mood(self, doc, m, answers):
        answers["mood"] = m
        ops = []
        picked = None
        for key, pal in _MOOD_PALETTES.items():
            if key in m:
                ops.append({"op": "set_theme", "theme": pal})
                picked = key
                break
        # 색 이름을 직접 말한 경우
        if not ops:
            for word, hexv in self._COLORS.items():
                if word in m:
                    ops.append({"op": "set_theme", "theme": {"accent": hexv}})
                    picked = word
                    break
        reply = ((f"'{picked}' 느낌으로 색을 맞췄어요! " if picked else "색을 정리했어요! ")
                 + "이제 **핵심 내용**을 채워볼게요. 소개하고 싶은 것들을 알려주세요.\n"
                   "예: 메뉴 3가지, 제공 서비스, 소개하고 싶은 점 등")
        sugg = ["메뉴(또는 서비스) 3가지 소개", "우리의 특징·강점", "간단한 소개 글", "예시로 채워줘"]
        return ops, reply, "content", sugg

    # 4) 핵심 내용 → 카드/문단
    def _stage_content(self, doc, m, answers):
        answers["content"] = m
        ops = []
        # 쉼표/줄바꿈으로 항목이 여러 개면 카드로
        items = [x.strip() for x in re.split(r"[,\n·]| 및 ", m) if x.strip()]
        if "예시" in m or "알아서" in m:
            reply = "핵심 소개를 예시로 채웠어요. 마음에 안 드는 문구는 언제든 바꿔달라고 하세요!"
            # 템플릿에 이미 cards가 있으니 그대로 두고 넘어감
        elif len(items) >= 2:
            cards = [{"title": it[:20], "desc": "여기에 자세한 설명을 적을 수 있어요."} for it in items[:6]]
            ops.append({"op": "add_block", "type": "cards", "props": {"items": cards, "columns": min(3, len(cards))}})
            reply = f"{len(cards)}가지를 카드로 정리했어요! 각 카드 설명도 원하면 바꿔드릴게요."
        else:
            ops.append({"op": "add_block", "type": "text", "props": {"text": m or "우리를 소개하는 글입니다."}})
            reply = "소개 글을 넣었어요! 이제 **사진**을 더해볼까요?"
        reply += "\n사진은 어떻게 할까요?"
        sugg = ["예시 사진으로 채워줘", "갤러리(여러 장) 넣어줘", "사진은 나중에 할게요"]
        return ops, reply, "images", sugg

    # 5) 이미지
    def _stage_images(self, doc, m, answers):
        answers["images"] = m
        ops = []
        urls = re.findall(r"https?://\S+", m)
        if urls:
            ops.append({"op": "add_block", "type": "image", "props": {"url": urls[0], "alt": "사진"}})
            reply = "사진을 넣었어요!"
        elif "갤러리" in m or "여러" in m:
            imgs = [{"url": f"https://picsum.photos/seed/g{i}/600/600", "alt": "사진"} for i in range(1, 7)]
            ops.append({"op": "add_block", "type": "gallery", "props": {"images": imgs, "columns": 3}})
            reply = "여러 장을 갤러리로 넣었어요! 나중에 실제 사진으로 바꿀 수 있어요."
        elif "나중" in m or "안" in m or "없" in m:
            reply = "사진은 나중에 추가해도 돼요."
        else:
            ops.append({"op": "add_block", "type": "image",
                        "props": {"url": "https://picsum.photos/seed/main/1200/700", "alt": "대표 사진"}})
            reply = "대표 사진 자리를 넣었어요!"
        reply += "\n이제 **연락처**를 알려주세요. (전화·이메일·주소 중 있는 것만)"
        sugg = ["전화 010-0000-0000", "이메일 hello@example.com", "연락처는 건너뛸게요"]
        return ops, reply, "contact", sugg

    # 6) 연락처
    def _stage_contact(self, doc, m, answers):
        answers["contact"] = m
        props = {}
        email = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", m)
        phone = re.search(r"01[016789][-\s]?\d{3,4}[-\s]?\d{4}|0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}", m)
        if email:
            props["email"] = email.group(0)
        if phone:
            props["phone"] = phone.group(0)
        rest = m
        for g in (email, phone):
            if g:
                rest = rest.replace(g.group(0), "")
        rest = rest.strip(" ,·/")
        if rest and "건너" not in rest and "없" not in rest and len(rest) > 3:
            props["address"] = rest[:60]
        ops = [{"op": "update_block", "type": "contact", "props": props}] if props else []
        reply = ("연락처를 정리했어요! 이제 거의 다 됐어요. 🎉\n"
                 "전체를 한 번 더 다듬을까요? 원하는 걸 골라주세요.")
        sugg = ["색을 더 밝게", "글자를 더 크게", "이대로 완성할래요", "전체를 예쁘게 다듬어줘"]
        return ops, reply, "polish", sugg

    # 7) 다듬기
    def _stage_polish(self, doc, m, answers):
        answers["polish"] = m
        ops = []
        reply = ""
        if "밝게" in m:
            ops.append({"op": "set_theme", "theme": {"bg": "#ffffff"}})
            reply = "배경을 더 밝게 했어요! "
        elif "크게" in m:
            hero = next((b for b in doc.get("blocks", []) if b.get("type") == "hero"), None)
            reply = "제목을 강조했어요! "
        # 색 직접 지정도 허용
        for word, hexv in self._COLORS.items():
            if word in m and "글자" not in m:
                ops.append({"op": "set_theme", "theme": {"accent": hexv}})
                reply = f"색을 {word} 계열로 바꿨어요! "
                break
        reply += ("완성입니다! 🎉 정말 잘 만드셨어요.\n"
                  "오른쪽 위 **공개하기** 버튼을 누르면 친구들에게 주소를 공유할 수 있어요. "
                  "더 바꾸고 싶은 게 있으면 언제든 말씀해주세요!")
        sugg = ["제목 바꾸기", "색 바꾸기", "문단 추가", "사진 넣기"]
        return ops, reply, "done", sugg

    # 완성 이후: 자유 편집(반응형 규칙)
    def _stage_done(self, doc, m, answers):
        ops, reply, _, sugg = self._reactive(doc, m)
        return ops, reply, "done", sugg

    # ── 자유 편집 규칙 (done 단계 또는 흐름 밖) ──
    def _reactive(self, doc, m):
        blocks = doc.get("blocks") or []
        ops = []
        reply = "말씀하신 대로 바꿔봤어요!"
        sugg = ["제목 바꾸기", "색 바꾸기", "문단 추가", "사진 넣기", "버튼 넣기"]

        # 색
        for word, hexv in self._COLORS.items():
            if word in m and ("색" in m or "컬러" in m or "테마" in m or "바꿔" in m):
                ops.append({"op": "set_theme", "theme": {"accent": hexv}})
                return ops, f"색을 {word} 계열로 바꿨어요!", "done", sugg
        # 템플릿
        if "템플릿" in m or "처음부터" in m:
            for k, tid in _PURPOSE_TEMPLATE.items():
                if k in m:
                    return ([{"op": "apply_template", "template_id": tid}],
                            f"{k} 템플릿을 적용했어요.", "done", sugg)
        # 제목
        tm = re.search(r"제목[을를]?\s*[\"'\u201c]?(.+?)[\"'\u201d]?\s*(?:로|으로|라고)?\s*(?:바꿔|변경|해|수정)", m)
        if tm or ("제목" in m and len(m) < 40):
            hero = next((b for b in blocks if b.get("type") == "hero"), None)
            if tm and hero:
                return ([{"op": "update_block", "block_id": hero["id"], "props": {"title": tm.group(1).strip()}}],
                        f'제목을 "{tm.group(1).strip()}" 로 바꿨어요!', "done", sugg)
        # 문단
        if any(k in m for k in ("문단", "내용", "글", "설명")) and any(k in m for k in ("추가", "넣어", "써")):
            q = re.search(r"[\"'\u201c](.+?)[\"'\u201d]", m)
            body = q.group(1) if q else "여기에 내용을 적어보세요."
            return [{"op": "add_block", "type": "text", "props": {"text": body}}], "문단을 추가했어요.", "done", sugg
        # 이미지
        if "이미지" in m or ("사진" in m and any(k in m for k in ("추가", "넣어"))):
            return ([{"op": "add_block", "type": "image", "props": {"url": "https://picsum.photos/seed/new/1200/700", "alt": "이미지"}}],
                    "이미지를 넣었어요.", "done", sugg)
        # 버튼
        if "버튼" in m and any(k in m for k in ("추가", "넣어", "만들")):
            label = None
            mlabel = (re.search(r"문구[는을를]?\s*[\"'\u201c]?(.+?)[\"'\u201d]?\s*(?:로|으로)", m)
                      or re.search(r"[\"'\u201c](.+?)[\"'\u201d]\s*버튼", m)
                      or re.search(r"([가-힣A-Za-z0-9 ]{2,12})\s*버튼", m))
            if mlabel:
                c = mlabel.group(1).strip()
                if c not in ("그", "이", "저", "새"):
                    label = c
            return ([{"op": "add_block", "type": "button", "props": {"text": label or "자세히 보기", "url": "#"}}],
                    f'"{label}" 버튼을 추가했어요.' if label else "버튼을 추가했어요.", "done", sugg)
        # 삭제
        if any(k in m for k in ("삭제", "지워", "없애")) and blocks:
            return [{"op": "remove_block", "block_id": blocks[-1]["id"]}], "마지막 부분을 지웠어요.", "done", sugg

        reply = ("이렇게 말해보세요: \"제목을 ~로 바꿔줘\", \"색을 초록으로\", "
                 "\"소개 문단 추가해줘\", \"사진 넣어줘\", \"버튼 넣어줘\".")
        return ops, reply, "done", sugg


_adapter: Any = None


def get_adapter():
    global _adapter
    if _adapter is None:
        if settings.AI_PROVIDER == "openai" and settings.OPENAI_API_KEY:
            try:
                _adapter = OpenAIAI()
            except Exception:
                _adapter = MockAI()
        else:
            _adapter = MockAI()
    return _adapter
