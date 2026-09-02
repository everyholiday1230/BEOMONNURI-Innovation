#!/usr/bin/env python3
"""브라우저 E2E — 실제 UI로 전 흐름을 클릭/입력해 검증한다.

A) 관리자 로그인 → 반 생성 → 코드 확보
B) 학생 참여 → 카페 템플릿 → AI 채팅 편집 → 미리보기 반영 → 도움요청
C) 관리자 실시간 도움요청 수신 → 개입 → 학생 '수정중'→결과 반영
   + 학생 채팅에 관리자 대화 미노출(보안 불변식)
D) 학생 공개 → 공개 URL 접근
"""
import re
import sys

from playwright.sync_api import sync_playwright

CHROME = "/home/test1/.cache/ms-playwright/chromium-1129/chrome-linux/chrome"
BASE = "http://127.0.0.1:8010"
P = F = 0


def ok(n, c, d=""):
    global P, F
    if c:
        P += 1; print(f"  OK   {n}")
    else:
        F += 1; print(f"  \u2605\u2605   {n}  {d}")


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME,
                           args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])

    print("## A) 관리자: 로그인 → 반 생성")
    actx = b.new_context()
    ap = actx.new_page()
    ap.on("dialog", lambda d: d.accept("E2E 테스트반"))
    ap.goto(f"{BASE}/admin.html", wait_until="load")
    ap.fill("#u", "admin"); ap.fill("#p", "change-this-admin-pw")
    ap.click("#loginBtn")
    ap.wait_for_selector("#dashView", state="visible", timeout=8000)
    ok("관리자 로그인 성공", ap.is_visible("#dashView"))
    ap.click("#newClassBtn")
    ap.wait_for_selector(".code-box .code", timeout=8000)
    code = ap.inner_text(".code-box .code").strip()
    ok("반 생성 + 코드 표시", bool(re.match(r"^[A-Z0-9]{6}$", code)), f"code={code}")

    print("\n## B) 학생: 참여 → 템플릿 → AI 편집")
    sctx = b.new_context()
    sp = sctx.new_page()
    sp.goto(f"{BASE}/", wait_until="load")
    sp.fill("#code", code); sp.fill("#name", "이학생")
    sp.click("#joinBtn")
    sp.wait_for_url("**/build.html", timeout=8000)
    ok("학생 참여 → 작업목록 이동", "build.html" in sp.url)
    sp.wait_for_selector("#templates .tmpl", timeout=8000)
    target = None
    for el in sp.query_selector_all("#templates .tmpl"):
        if "카페" in el.inner_text():
            target = el; break
    target.click()
    sp.wait_for_url("**/builder.html", timeout=8000)
    sp.wait_for_selector("#preview", timeout=8000)
    sp.wait_for_timeout(1600)
    ok("템플릿 선택 → 빌더 진입", "builder.html" in sp.url)
    # 가이드 흐름: AI 첫 질문 + 예시 칩이 떠 있어야 함
    ok("AI 첫 질문(봇 메시지) 표시", sp.locator(".msg.bot").count() >= 1)
    ok("예시 답변 칩 표시", sp.locator("#chips .chip").count() >= 1)
    frame = sp.frame_locator("#preview")

    # 이름 단계로 진행: 칩이 아니라 직접 입력으로 상호를 답한다
    # (blank 템플릿으로 시작했으므로 먼저 목적을 답해야 하지만, 여기선 chip 클릭으로 목적 답변)
    sp.locator("#chips .chip", has_text="카페").first.click()
    sp.wait_for_timeout(1600)
    ok("목적 답변 후 미리보기 갱신", len(frame.locator("body").inner_text()) > 20)
    # 이름·소개 입력
    sp.fill("#input", "이학생 카페 / 매일 볶는 커피")
    sp.click("#send")
    sp.wait_for_timeout(1800)
    prev = frame.locator("body").inner_text()
    ok("상호가 제목으로 반영됨", "이학생 카페" in prev, prev[:60])
    ok("진행 표시 업데이트", sp.locator("#progressLabel").inner_text() != "시작")

    sp.click("#helpBtn")
    sp.wait_for_timeout(1300)

    print("\n## C) 관리자: 도움요청 수신 → 개입 (대화 숨김 검증)")
    ap.wait_for_timeout(1500)
    # 도움 요청이 오면 학생 목록이 갱신되고 도움 배너가 나타난다.
    # 배너의 '도와주기' 버튼으로 개입을 시작한다(교사의 실제 동선).
    ap.wait_for_selector("#helpBanner:not(.hidden)", timeout=8000)
    ap.click("#helpBanner button")
    ap.wait_for_selector("#modal.show", timeout=6000)
    ap.fill("#mvInput", "버튼을 추가하고 문구는 주문하기로 해줘")
    ap.click("#mvCompose button[type=submit]")
    ap.wait_for_timeout(2000)

    sp.wait_for_timeout(1600)
    prev_text3 = frame.locator("body").inner_text()
    ok("개입 결과가 학생 미리보기에 반영", "주문하기" in prev_text3, prev_text3[:80])

    student_msgs = sp.locator("#msgs").inner_text()
    ok("학생 화면에 관리자 지시문 미노출",
       "주문하기로 해줘" not in student_msgs and "[관리자]" not in student_msgs,
       "관리자 대화 유출됨")
    ok("학생에겐 도움 완료 안내만 표시",
       ("도와" in student_msgs or "업데이트" in student_msgs))

    print("\n## D) 학생: 공개 → 공개 URL")
    sp.on("dialog", lambda d: d.accept())
    with sctx.expect_page() as newp_info:
        sp.click("#publishBtn")
    pub = newp_info.value
    pub.wait_for_load_state("load", timeout=8000)
    ok("공개 페이지 새 탭 열림", "/p/" in pub.url, pub.url)
    ok("공개 페이지에 내용 렌더", "이학생 카페" in pub.locator("body").inner_text(), "")

    b.close()

print(f"\n{'='*52}\n통과 {P} / 실패 {F}")
sys.exit(1 if F else 0)
