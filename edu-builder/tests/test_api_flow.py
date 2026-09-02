#!/usr/bin/env python3
"""API 전 흐름 통합 테스트.

관리자 로그인 → 반 생성 → 학생 참여 → 프로젝트 생성(템플릿) → AI 편집 →
도움 요청 → 관리자 개입(대화 숨김 확인) → 공개 → 공개페이지 확인 →
학생이 개입 대화를 못 보는지(보안 불변식) 확인.
"""
import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8010"
P, F = 0, 0


def call(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            ct = r.headers.get("content-type", "")
            raw = r.read().decode()
            return r.status, (json.loads(raw) if "json" in ct else raw)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


def check(name, cond, detail=""):
    global P, F
    if cond:
        P += 1; print(f"  OK   {name}")
    else:
        F += 1; print(f"  ★★   {name}  {detail}")


print("## 1. 관리자 로그인")
st, r = call("POST", "/api/auth/admin/login", {"username": "admin", "password": "change-this-admin-pw"})
check("로그인 성공", st == 200, str(r))
admin_token = r.get("token") if isinstance(r, dict) else None
st, r = call("POST", "/api/auth/admin/login", {"username": "admin", "password": "WRONG"})
check("오답 거부(401)", st == 401)

print("\n## 2. 반 생성")
st, cls = call("POST", "/api/admin/classes", {"name": "1학년 3반"}, token=admin_token)
check("반 생성", st == 200 and cls.get("code"), str(cls))
code = cls.get("code")
print(f"       반 코드: {code}")

print("\n## 3. 학생 참여")
st, r = call("POST", "/api/auth/join", {"code": code, "name": "김학생"})
check("코드로 참여", st == 200 and r.get("token"), str(r))
stu_token = r.get("token") if isinstance(r, dict) else None
st, r = call("POST", "/api/auth/join", {"code": "ZZZZZZ", "name": "x"})
check("잘못된 코드 거부(404)", st == 404)

print("\n## 4. 템플릿 목록 + 프로젝트 생성 + 가이드 시작")
st, r = call("GET", "/api/templates")
check("템플릿 목록", st == 200 and len(r.get("templates", [])) >= 5)
st, proj = call("POST", "/api/projects", {"template_id": "blank", "title": "내 홈페이지"}, token=stu_token)
check("프로젝트 생성", st == 200 and proj.get("id"), str(proj))
pid = proj.get("id")
check("생성 직후 가이드 단계=purpose", proj.get("doc", {}).get("flow", {}).get("stage") == "purpose",
      str(proj.get("doc", {}).get("flow")))
# 생성 시 AI 첫 질문(인사)이 저장됨
st, pv = call("GET", f"/api/projects/{pid}", token=stu_token)
greeting = [m for m in pv.get("messages", []) if m["role"] == "assistant"]
check("AI 첫 질문 저장됨", len(greeting) >= 1)

print("\n## 5. 가이드 흐름 (AI가 단계별로 질문·완성)")
# 1) 목적
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "카페 만들고 싶어요"}, token=stu_token)
check("목적→이름 단계 이동", r.get("stage") == "name", str(r.get("stage")))
check("템플릿 적용됨(블록 생성)", len(r.get("doc", {}).get("blocks", [])) >= 4)
check("예시 답변(suggestions) 제공", len(r.get("suggestions", [])) >= 1)
# 2) 이름·소개
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "행복 카페 / 매일 볶는 신선한 커피"}, token=stu_token)
check("이름→분위기 단계 이동", r.get("stage") == "mood")
hero_title = next((b["props"].get("title", "") for b in r["doc"]["blocks"] if b["type"] == "hero"), "")
check("hero 제목이 상호로 설정됨", "행복 카페" in hero_title, f"title={hero_title}")
# 3) 분위기·색
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "따뜻하게"}, token=stu_token)
check("분위기→내용 단계 이동", r.get("stage") == "content")
check("분위기에 맞는 색 적용", r["doc"]["theme"].get("accent") == "#d9772b", str(r["doc"]["theme"]))
# 4) 내용
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "아메리카노, 라떼, 크로플"}, token=stu_token)
check("내용→사진 단계 이동", r.get("stage") == "images")
# 5) 사진
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "예시 사진으로 채워줘"}, token=stu_token)
check("사진→연락처 단계 이동", r.get("stage") == "contact")
# 6) 연락처
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "전화 02-123-4567, 이메일 hi@cafe.com"}, token=stu_token)
check("연락처→다듬기 단계 이동", r.get("stage") == "polish")
# 7) 다듬기 → 완성
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "이대로 완성할래요"}, token=stu_token)
check("다듬기→완성 단계 이동", r.get("stage") == "done")
check("남은 횟수 반환", isinstance(r.get("remaining"), int))
# 8) 완성 후 자유 편집(반응형)
st, r = call("POST", f"/api/projects/{pid}/chat", {"message": "색을 초록으로 바꿔줘"}, token=stu_token)
check("완성 후 자유 편집(색 변경)", r["doc"]["theme"].get("accent") == "#0aa06e")

print("\n## 6. 도움 요청")
st, r = call("POST", f"/api/projects/{pid}/help", None, token=stu_token)
check("도움 요청 생성", st == 200 and r.get("ok"))
st, r = call("GET", "/api/admin/help?status=open", token=admin_token)
check("관리자가 도움요청 확인", st == 200 and len(r.get("help_requests", [])) >= 1, str(r)[:150])

print("\n## 7. 관리자 개입 (대화 숨김 검증)")
st, r = call("POST", f"/api/admin/projects/{pid}/intervene",
             {"message": "버튼을 추가하고 문구는 '주문하기'로 해줘"}, token=admin_token)
check("개입 성공", st == 200 and r.get("ok"), str(r)[:150])

# 학생 조회 — 개입 대화가 보이면 안 됨 (보안 불변식)
st, sview = call("GET", f"/api/projects/{pid}", token=stu_token)
check("학생 프로젝트 조회", st == 200)
student_msgs = sview.get("messages", [])
leaked = [m for m in student_msgs if "[관리자]" in m.get("content", "")]
check("학생에게 관리자 지시 안 보임", len(leaked) == 0,
      f"유출된 메시지 {len(leaked)}개")
# 개입 결과(버튼)는 문서에 반영되어야 함
has_button = any(b["type"] == "button" for b in sview["project"]["doc"]["blocks"])
check("개입 결과는 문서에 반영됨", has_button)

# 관리자 조회 — 전체 대화(개입 포함) 보임
st, aview = call("GET", f"/api/admin/projects/{pid}", token=admin_token)
admin_sees = any("[관리자]" in m.get("content", "") for m in aview.get("messages", []))
check("관리자는 개입 대화 볼 수 있음", admin_sees)

print("\n## 8. 공개")
st, r = call("POST", f"/api/projects/{pid}/publish", None, token=stu_token)
check("공개 처리", st == 200 and r.get("slug"), str(r))
slug = r.get("slug")
st, html = call("GET", f"/p/{slug}")
check("공개 페이지 HTML", st == 200 and "<!doctype html>" in str(html))
check("공개 페이지에 제목 반영", "행복 카페" in str(html))
check("공개 페이지 XSS 안전(닫힌 script 없음)", "<script>alert" not in str(html))

print("\n## 9. 권한 격리")
st, r = call("GET", f"/api/projects/{pid}")  # 토큰 없음
check("비인증 접근 거부", st in (401, 403))
st, r = call("GET", "/api/admin/classes", token=stu_token)  # 학생이 관리자 API
check("학생의 관리자 API 접근 거부", st == 403)

print(f"\n{'='*52}\n통과 {P} / 실패 {F}")
sys.exit(1 if F else 0)
