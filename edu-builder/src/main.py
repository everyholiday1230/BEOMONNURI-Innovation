"""edu-builder 메인 앱.

라우트 그룹:
  /api/auth/*      관리자 로그인, 학생 참여
  /api/admin/*     반 생성/목록, 학생 목록, 도움요청 목록, 개입
  /api/templates   템플릿 목록
  /api/projects/*  프로젝트 조회/AI편집/저장/공개, 도움요청
  /ws/*            실시간 채널
  /p/{slug}        공개 작품 페이지 (완전한 HTML)
  /                정적 프론트(참여/빌더/관리자)

보안 원칙:
  - 학생은 자기 프로젝트만 접근. 관리자는 자기 반의 프로젝트만.
  - 관리자 개입 대화는 hidden=1 로 저장하고, 학생 조회 API 는 hidden 을 절대 반환하지 않음.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel

from . import ai, auth, db
from .blocks import render_full_page
from .config import settings
from .templates_data import get_template_doc, list_templates
from .ws import class_room, hub, project_room

app = FastAPI(title="edu-builder", docs_url=None, redoc_url=None)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()
    auth.ensure_seed_admin()


def _today() -> str:
    return _dt.date.today().isoformat()


# ── 스키마 ────────────────────────────────────────────────────

class AdminLogin(BaseModel):
    username: str
    password: str


class JoinBody(BaseModel):
    code: str
    name: str


class ClassCreate(BaseModel):
    name: str


class NewProject(BaseModel):
    template_id: str = "blank"
    title: str | None = None


class ChatBody(BaseModel):
    message: str


class InterveneBody(BaseModel):
    message: str


class SaveDoc(BaseModel):
    doc: dict
    title: str | None = None


# ── 인증 라우트 ───────────────────────────────────────────────

@app.post("/api/auth/admin/login")
def admin_login(body: AdminLogin):
    a = db.get_admin_by_username(body.username.strip())
    if not a or not auth.verify_password(body.password, a["pw_hash"]):
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    token = auth.make_token(a["id"], "admin")
    return {"token": token, "username": a["username"]}


@app.post("/api/auth/join")
def student_join(body: JoinBody):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "이름을 입력해주세요.")
    cls = db.get_class_by_code(body.code)
    if not cls:
        raise HTTPException(404, "반 코드를 찾을 수 없습니다. 코드를 다시 확인해주세요.")
    student = db.create_student(cls["id"], name)
    token = auth.make_token(student["id"], "student", {"cid": cls["id"], "name": name})
    return {"token": token, "student_id": student["id"],
            "class_name": cls["name"], "name": name}


# ── 관리자 라우트 ─────────────────────────────────────────────

@app.get("/api/admin/me")
def admin_me(admin: dict = Depends(auth.current_admin)):
    return {"username": admin["username"]}


@app.get("/api/admin/classes")
def admin_classes(admin: dict = Depends(auth.current_admin)):
    return {"classes": db.list_classes(admin["id"])}


@app.post("/api/admin/classes")
def admin_create_class(body: ClassCreate, admin: dict = Depends(auth.current_admin)):
    name = body.name.strip() or "새 반"
    cls = db.create_class(name, admin["id"])
    return cls


@app.get("/api/admin/classes/{class_id}/students")
def admin_students(class_id: str, admin: dict = Depends(auth.current_admin)):
    cls = db.get_class(class_id)
    if not cls or cls["admin_id"] != admin["id"]:
        raise HTTPException(404, "반을 찾을 수 없습니다.")
    students = db.list_students(class_id)
    # 각 학생의 프로젝트도 함께
    for s in students:
        s["projects"] = db.list_projects_by_student(s["id"])
    return {"class": cls, "students": students}


@app.get("/api/admin/help")
def admin_help(admin: dict = Depends(auth.current_admin), status: str | None = None):
    # 관리자의 모든 반에 걸친 도움 요청
    classes = {c["id"] for c in db.list_classes(admin["id"])}
    out = []
    for hr in db.list_help_requests(status=status):
        if hr["class_id"] in classes:
            out.append(hr)
    return {"help_requests": out}


def _admin_owns_project(admin: dict, project: dict) -> bool:
    cls = db.get_class(project["class_id"])
    return bool(cls and cls["admin_id"] == admin["id"])


@app.get("/api/admin/projects/{project_id}")
def admin_get_project(project_id: str, admin: dict = Depends(auth.current_admin)):
    p = db.get_project(project_id)
    if not p or not _admin_owns_project(admin, p):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    # 관리자는 전체 대화(개입 포함)를 볼 수 있다
    return {"project": p, "messages": db.list_messages(project_id, include_hidden=True)}


@app.post("/api/admin/projects/{project_id}/intervene")
async def admin_intervene(project_id: str, body: InterveneBody,
                          admin: dict = Depends(auth.current_admin)):
    """관리자가 학생 대신 AI에게 지시해 페이지를 수정한다.

    학생 화면에는 '수정 중'과 '완료(새 문서)'만 전달되고,
    관리자의 지시문과 AI 응답 원문은 hidden 메시지로만 저장된다.
    """
    p = db.get_project(project_id)
    if not p or not _admin_owns_project(admin, p):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    # 1) 학생 화면에 "선생님이 수정 중" 오버레이 표시
    await hub.broadcast(project_room(project_id),
                        {"type": "intervene_start", "by": "teacher"})

    # 2) 관리자 지시를 hidden 으로 기록 (학생에게 안 보임)
    db.add_message(project_id, "user", f"[관리자] {body.message}", hidden=True)

    # 3) AI 편집 수행 (개입은 가이드 흐름이 아닌 직접 지시 = 반응형)
    history = db.list_messages(project_id, include_hidden=True)
    result = ai.get_adapter().edit(p["doc"], body.message, history, guided=False)
    new_doc = result["doc"]
    db.add_message(project_id, "assistant", result["reply"], hidden=True)

    # 4) 문서 저장
    updated = db.update_project_doc(project_id, new_doc)

    # 5) 학생 화면에 결과만 전달 (대화 내용 없음)
    await hub.broadcast(project_room(project_id),
                        {"type": "intervene_end", "doc": new_doc})

    # 6) 도움 요청이 있었다면 해결 처리
    for hr in db.list_help_requests(class_id=p["class_id"], status="open"):
        if hr["project_id"] == project_id:
            db.set_help_status(hr["id"], "resolved")
            await hub.broadcast(class_room(p["class_id"]),
                                {"type": "help_resolved", "help_id": hr["id"]})
    for hr in db.list_help_requests(class_id=p["class_id"], status="active"):
        if hr["project_id"] == project_id:
            db.set_help_status(hr["id"], "resolved")

    return {"ok": True, "doc": new_doc, "reply": result["reply"]}


# ── 템플릿 ────────────────────────────────────────────────────

@app.get("/api/templates")
def templates():
    return {"templates": list_templates()}


@app.post("/api/preview", response_class=HTMLResponse)
def preview(body: SaveDoc, subject: dict = Depends(auth.current_subject)):
    """임의의 블록 문서를 안전한 HTML 로 렌더해 반환한다.
    빌더 화면이 iframe.srcdoc 에 넣어 실시간 미리보기에 쓴다.
    렌더러가 모든 텍스트를 이스케이프하므로 XSS 위험이 없다."""
    return HTMLResponse(render_full_page(body.doc, body.title or ""))


# ── 프로젝트 라우트 (학생) ────────────────────────────────────

def _student_owns(student: dict, project: dict) -> bool:
    return project["student_id"] == student["id"]


@app.get("/api/projects")
def my_projects(student: dict = Depends(auth.current_student)):
    return {"projects": db.list_projects_by_student(student["id"])}


@app.post("/api/projects")
def create_project(body: NewProject, student: dict = Depends(auth.current_student)):
    doc = get_template_doc(body.template_id) or get_template_doc("blank")
    title = (body.title or doc.get("title") or "내 홈페이지").strip()
    # 가이드 흐름 시작: AI가 첫 질문을 던지고 flow 상태를 doc 에 심는다.
    start = ai.get_adapter().start(doc)
    doc = start["doc"]
    p = db.create_project(student["id"], student["class_id"], title, doc)
    db.add_message(p["id"], "assistant", start["reply"])
    return p


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, student: dict = Depends(auth.current_student)):
    p = db.get_project(project_id)
    if not p or not _student_owns(student, p):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    # 학생에게는 hidden 메시지(관리자 개입)를 절대 노출하지 않는다
    return {"project": p, "messages": db.list_messages(project_id, include_hidden=False)}


@app.post("/api/projects/{project_id}/chat")
async def project_chat(project_id: str, body: ChatBody,
                       student: dict = Depends(auth.current_student)):
    p = db.get_project(project_id)
    if not p or not _student_owns(student, p):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    # 일일 사용량 한도
    used = db.get_ai_usage(student["id"], _today())
    if used >= settings.STUDENT_DAILY_AI_LIMIT:
        raise HTTPException(429, "오늘 AI 도움 횟수를 모두 사용했어요. 내일 다시 시도하거나 선생님께 도움을 요청해보세요.")

    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "메시지를 입력해주세요.")

    db.add_message(project_id, "user", msg, hidden=False)
    db.bump_ai_usage(student["id"], _today())

    history = db.list_messages(project_id, include_hidden=False)
    result = ai.get_adapter().edit(p["doc"], msg, history)
    new_doc = result["doc"]
    db.add_message(project_id, "assistant", result["reply"], hidden=False)
    db.update_project_doc(project_id, new_doc)

    # 혹시 이 프로젝트를 보고 있는 관리자에게도 최신 문서 반영
    await hub.broadcast(project_room(project_id),
                        {"type": "doc_updated", "doc": new_doc})

    return {"reply": result["reply"], "doc": new_doc,
            "suggestions": result.get("suggestions", []),
            "stage": result.get("stage", ""),
            "remaining": max(0, settings.STUDENT_DAILY_AI_LIMIT - used - 1)}


@app.put("/api/projects/{project_id}")
def save_project(project_id: str, body: SaveDoc,
                 student: dict = Depends(auth.current_student)):
    p = db.get_project(project_id)
    if not p or not _student_owns(student, p):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    updated = db.update_project_doc(project_id, body.doc, body.title)
    return updated


@app.post("/api/projects/{project_id}/publish")
def publish_project(project_id: str, student: dict = Depends(auth.current_student)):
    p = db.get_project(project_id)
    if not p or not _student_owns(student, p):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    db.set_published(project_id, True)
    return {"ok": True, "url": f"{settings.PUBLIC_BASE_URL}/p/{p['slug']}", "slug": p["slug"]}


@app.post("/api/projects/{project_id}/help")
async def request_help(project_id: str, student: dict = Depends(auth.current_student)):
    p = db.get_project(project_id)
    if not p or not _student_owns(student, p):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    hr = db.create_help_request(project_id, student["id"], student["class_id"])
    # 관리자 대시보드에 실시간 알림
    await hub.broadcast(class_room(student["class_id"]), {
        "type": "help_new",
        "help_id": hr["id"],
        "project_id": project_id,
        "student_name": student["name"],
        "project_title": p["title"],
    })
    return {"ok": True, "help_id": hr["id"]}


# ── 공개 페이지 ───────────────────────────────────────────────

@app.get("/p/{slug}", response_class=HTMLResponse)
def public_page(slug: str):
    p = db.get_project_by_slug(slug)
    if not p or not p["published"]:
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><title>없는 페이지</title>"
            "<div style='font-family:sans-serif;text-align:center;padding:80px'>"
            "<h1>페이지를 찾을 수 없어요</h1><p>아직 공개되지 않았거나 주소가 잘못되었습니다.</p></div>",
            status_code=404,
        )
    return HTMLResponse(render_full_page(p["doc"], p["title"]))


# ── WebSocket ─────────────────────────────────────────────────

def _verify_ws_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALG])
    except JWTError:
        return None


@app.websocket("/ws/project/{project_id}")
async def ws_project(ws: WebSocket, project_id: str, token: str = ""):
    """학생(또는 개입 중 관리자)이 프로젝트 룸을 구독.
    서버→클라이언트 단방향 알림만 사용(수신 메시지는 무시)."""
    payload = _verify_ws_token(token)
    if not payload:
        await ws.close(code=4401)
        return
    p = db.get_project(project_id)
    if not p:
        await ws.close(code=4404)
        return
    # 접근 권한: 소유 학생이거나 반 담당 관리자
    role = payload.get("role")
    allowed = False
    if role == "student" and payload.get("sub") == p["student_id"]:
        allowed = True
    elif role == "admin":
        cls = db.get_class(p["class_id"])
        allowed = bool(cls and cls["admin_id"] == payload.get("sub"))
    if not allowed:
        await ws.close(code=4403)
        return

    await ws.accept()
    room = project_room(project_id)
    await hub.join(room, ws)
    try:
        while True:
            await ws.receive_text()  # keepalive; 내용은 사용하지 않음
    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(room, ws)


@app.websocket("/ws/class/{class_id}")
async def ws_class(ws: WebSocket, class_id: str, token: str = ""):
    """관리자가 반 룸을 구독해 도움 요청 알림을 실시간 수신."""
    payload = _verify_ws_token(token)
    if not payload or payload.get("role") != "admin":
        await ws.close(code=4401)
        return
    cls = db.get_class(class_id)
    if not cls or cls["admin_id"] != payload.get("sub"):
        await ws.close(code=4403)
        return
    await ws.accept()
    room = class_room(class_id)
    await hub.join(room, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(room, ws)


# ── 헬스체크 ──────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"ok": True, "ai_provider": ai.get_adapter().provider}


# ── 정적 프론트 ───────────────────────────────────────────────
# (프론트 파일은 다음 단계에서 static/ 에 생성한다. 마지막에 mount 해야
#  API 라우트가 우선하므로, 파일 존재 시에만 mount.)
import os as _os  # noqa: E402

_static_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "static")
if _os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
