"""SQLite 데이터 계층.

의존성을 최소화하기 위해 표준 라이브러리 sqlite3 만 사용한다.
FastAPI 라우트에서 짧게 열고 닫는 연결 패턴(요청당 커넥션)을 쓰되,
편의를 위해 모듈 수준 헬퍼로 감싼다.

엔티티:
  admins        관리자(선생님) 계정
  classes       반 (참여 코드 보유)
  students      학생 (반에 소속, 이름만)
  projects      학생의 홈페이지 프로젝트 (블록 문서 JSON, 공개 slug)
  messages      학생↔AI 대화 로그 (관리자 개입 메시지는 hidden 플래그)
  help_requests 도움 요청 (학생→관리자)
"""
from __future__ import annotations

import json
import secrets
import sqlite3
import string
import time
import uuid
from pathlib import Path
from typing import Any

from .config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS admins (
  id         TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  pw_hash    TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT UNIQUE NOT NULL,
  admin_id   TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  class_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  doc_json    TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  published   INTEGER NOT NULL DEFAULT 0,
  created_at  REAL NOT NULL,
  updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  role        TEXT NOT NULL,        -- 'user' | 'assistant' | 'system'
  content     TEXT NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,  -- 1이면 학생에게 숨김(관리자↔AI 대화)
  created_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS help_requests (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  class_id    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',  -- open | active | resolved
  created_at  REAL NOT NULL,
  resolved_at REAL
);
CREATE TABLE IF NOT EXISTS ai_usage (
  student_id  TEXT NOT NULL,
  day         TEXT NOT NULL,        -- YYYY-MM-DD
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, day)
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_projects_student ON projects(student_id);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
CREATE INDEX IF NOT EXISTS idx_help_class ON help_requests(class_id, status);
"""


def _conn() -> sqlite3.Connection:
    Path(settings.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(settings.DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_SCHEMA)


def _now() -> float:
    return time.time()


def _id() -> str:
    return uuid.uuid4().hex


def _code(n: int = 6) -> str:
    # 사람이 읽기 쉬운 반 코드(혼동되는 0/O/1/I 제외)
    alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alpha) for _ in range(n))


def _slug() -> str:
    return secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8].lower()


# ── 관리자 ────────────────────────────────────────────────────

def create_admin(username: str, pw_hash: str) -> dict:
    row = {"id": _id(), "username": username, "pw_hash": pw_hash, "created_at": _now()}
    with _conn() as c:
        c.execute("INSERT INTO admins(id,username,pw_hash,created_at) VALUES(?,?,?,?)",
                  (row["id"], row["username"], row["pw_hash"], row["created_at"]))
    return row


def get_admin_by_username(username: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM admins WHERE username=?", (username,)).fetchone()
    return dict(r) if r else None


def get_admin(admin_id: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM admins WHERE id=?", (admin_id,)).fetchone()
    return dict(r) if r else None


# ── 반 ────────────────────────────────────────────────────────

def create_class(name: str, admin_id: str) -> dict:
    with _conn() as c:
        for _ in range(10):
            code = _code()
            if not c.execute("SELECT 1 FROM classes WHERE code=?", (code,)).fetchone():
                break
        cid = _id()
        c.execute("INSERT INTO classes(id,name,code,admin_id,created_at) VALUES(?,?,?,?,?)",
                  (cid, name, code, admin_id, _now()))
        r = c.execute("SELECT * FROM classes WHERE id=?", (cid,)).fetchone()
    return dict(r)


def get_class_by_code(code: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM classes WHERE code=?", (code.upper().strip(),)).fetchone()
    return dict(r) if r else None


def get_class(class_id: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM classes WHERE id=?", (class_id,)).fetchone()
    return dict(r) if r else None


def list_classes(admin_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT c.*, "
            "(SELECT COUNT(*) FROM students s WHERE s.class_id=c.id) AS student_count "
            "FROM classes c WHERE admin_id=? ORDER BY created_at DESC", (admin_id,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── 학생 ──────────────────────────────────────────────────────

def create_student(class_id: str, name: str) -> dict:
    sid = _id()
    with _conn() as c:
        c.execute("INSERT INTO students(id,class_id,name,created_at) VALUES(?,?,?,?)",
                  (sid, class_id, name, _now()))
        r = c.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    return dict(r)


def get_student(student_id: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    return dict(r) if r else None


def list_students(class_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT s.*, "
            "(SELECT COUNT(*) FROM projects p WHERE p.student_id=s.id) AS project_count "
            "FROM students s WHERE class_id=? ORDER BY created_at", (class_id,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── 프로젝트 ──────────────────────────────────────────────────

def create_project(student_id: str, class_id: str, title: str, doc: dict) -> dict:
    pid = _id()
    with _conn() as c:
        for _ in range(10):
            slug = _slug()
            if not c.execute("SELECT 1 FROM projects WHERE slug=?", (slug,)).fetchone():
                break
        t = _now()
        c.execute(
            "INSERT INTO projects(id,student_id,class_id,title,doc_json,slug,published,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,0,?,?)",
            (pid, student_id, class_id, title, json.dumps(doc, ensure_ascii=False), slug, t, t),
        )
        r = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    return _project_row(r)


def get_project(project_id: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    return _project_row(r) if r else None


def get_project_by_slug(slug: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM projects WHERE slug=?", (slug,)).fetchone()
    return _project_row(r) if r else None


def list_projects_by_student(student_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM projects WHERE student_id=? ORDER BY updated_at DESC",
                         (student_id,)).fetchall()
    return [_project_row(r) for r in rows]


def update_project_doc(project_id: str, doc: dict, title: str | None = None) -> dict | None:
    with _conn() as c:
        if title is not None:
            c.execute("UPDATE projects SET doc_json=?, title=?, updated_at=? WHERE id=?",
                      (json.dumps(doc, ensure_ascii=False), title, _now(), project_id))
        else:
            c.execute("UPDATE projects SET doc_json=?, updated_at=? WHERE id=?",
                      (json.dumps(doc, ensure_ascii=False), _now(), project_id))
        r = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    return _project_row(r) if r else None


def set_published(project_id: str, published: bool) -> None:
    with _conn() as c:
        c.execute("UPDATE projects SET published=?, updated_at=? WHERE id=?",
                  (1 if published else 0, _now(), project_id))


def _project_row(r: sqlite3.Row | None) -> dict | None:
    if not r:
        return None
    d = dict(r)
    d["doc"] = json.loads(d.pop("doc_json"))
    d["published"] = bool(d["published"])
    return d


# ── 메시지 ────────────────────────────────────────────────────

def add_message(project_id: str, role: str, content: str, hidden: bool = False) -> dict:
    mid = _id()
    with _conn() as c:
        c.execute("INSERT INTO messages(id,project_id,role,content,hidden,created_at) VALUES(?,?,?,?,?,?)",
                  (mid, project_id, role, content, 1 if hidden else 0, _now()))
        r = c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
    return dict(r)


def list_messages(project_id: str, include_hidden: bool = False) -> list[dict]:
    with _conn() as c:
        if include_hidden:
            rows = c.execute("SELECT * FROM messages WHERE project_id=? ORDER BY created_at",
                             (project_id,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM messages WHERE project_id=? AND hidden=0 ORDER BY created_at",
                             (project_id,)).fetchall()
    return [dict(r) for r in rows]


# ── 도움 요청 ─────────────────────────────────────────────────

def create_help_request(project_id: str, student_id: str, class_id: str, note: str = "") -> dict:
    hid = _id()
    with _conn() as c:
        # 이미 열린 요청이 있으면 재사용(중복 방지)
        existing = c.execute(
            "SELECT * FROM help_requests WHERE project_id=? AND status IN('open','active')",
            (project_id,)).fetchone()
        if existing:
            return dict(existing)
        c.execute(
            "INSERT INTO help_requests(id,project_id,student_id,class_id,note,status,created_at)"
            " VALUES(?,?,?,?,?,'open',?)",
            (hid, project_id, student_id, class_id, note, _now()))
        r = c.execute("SELECT * FROM help_requests WHERE id=?", (hid,)).fetchone()
    return dict(r)


def list_help_requests(class_id: str | None = None, status: str | None = None) -> list[dict]:
    q = ("SELECT h.*, s.name AS student_name, p.title AS project_title, p.slug AS project_slug "
         "FROM help_requests h "
         "JOIN students s ON s.id=h.student_id "
         "JOIN projects p ON p.id=h.project_id WHERE 1=1")
    args: list[Any] = []
    if class_id:
        q += " AND h.class_id=?"; args.append(class_id)
    if status:
        q += " AND h.status=?"; args.append(status)
    q += " ORDER BY h.created_at DESC"
    with _conn() as c:
        rows = c.execute(q, args).fetchall()
    return [dict(r) for r in rows]


def set_help_status(help_id: str, status: str) -> None:
    with _conn() as c:
        if status == "resolved":
            c.execute("UPDATE help_requests SET status=?, resolved_at=? WHERE id=?",
                      (status, _now(), help_id))
        else:
            c.execute("UPDATE help_requests SET status=? WHERE id=?", (status, help_id))


def get_help_request(help_id: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM help_requests WHERE id=?", (help_id,)).fetchone()
    return dict(r) if r else None


# ── AI 사용량 (일일 한도) ─────────────────────────────────────

def bump_ai_usage(student_id: str, day: str) -> int:
    """오늘 사용량을 1 늘리고 누적값을 반환."""
    with _conn() as c:
        c.execute(
            "INSERT INTO ai_usage(student_id,day,count) VALUES(?,?,1) "
            "ON CONFLICT(student_id,day) DO UPDATE SET count=count+1",
            (student_id, day))
        r = c.execute("SELECT count FROM ai_usage WHERE student_id=? AND day=?",
                      (student_id, day)).fetchone()
    return int(r["count"]) if r else 1


def get_ai_usage(student_id: str, day: str) -> int:
    with _conn() as c:
        r = c.execute("SELECT count FROM ai_usage WHERE student_id=? AND day=?",
                      (student_id, day)).fetchone()
    return int(r["count"]) if r else 0
