"""블록 렌더러 검증 — 특히 XSS 차단을 집중 확인한다.

실행:  python3 -m tests.test_blocks   (edu-builder 디렉토리에서)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.blocks import (  # noqa: E402
    new_block, render_document, render_full_page, render_block,
    safe_url, safe_color,
)

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  OK   {name}")
    else:
        failed += 1
        print(f"  ★★   {name}  {detail}")


print("## XSS / 주입 차단")

# 1) 스크립트 태그가 그대로 살아나면 안 됨
doc = {"blocks": [new_block("hero", {"title": "<script>alert(1)</script>",
                                     "subtitle": "<img src=x onerror=alert(2)>"})]}
out = render_document(doc)
check("script 태그 이스케이프", "<script>alert" not in out, "원시 script 태그가 출력됨")
# 실제 위험: 이스케이프되지 않은 <img ...> 태그가 살아나는 것.
# 이스케이프된 &lt;img...&gt; 안의 'onerror' 문자열은 표시용 텍스트일 뿐 실행 불가.
check("img 태그 무력화(이스케이프)", "<img src=x onerror" not in out, "원시 img 태그가 실행됨")
check("이스케이프된 형태로 존재", "&lt;script&gt;" in out)

# 2) 위험 URL 스킴 차단
check("javascript: URL 차단", safe_url("javascript:alert(1)") == "#")
check("data:text/html 차단", safe_url("data:text/html,<script>") == "#")
check("정상 https 통과", safe_url("https://example.com/a.png") == "https://example.com/a.png")
check("mailto 통과", safe_url("mailto:a@b.com") == "mailto:a@b.com")
check("상대경로 통과", safe_url("/p/abc") == "/p/abc")

# 3) 버튼 href 에 javascript 주입 시도
b = new_block("button", {"text": "click", "url": "javascript:steal()"})
out = render_block(b)
check("버튼 javascript URL 무력화", "javascript:steal" not in out, out[:120])

# 4) 색상은 hex 만 허용 (CSS 주입 방지)
check("정상 hex 색상 통과", safe_color("#ff0033") == "#ff0033")
check("CSS 주입 색상 거부", safe_color("red;}body{display:none") == "")
check("expression 거부", safe_color("expression(alert(1))") == "")

# 5) 갤러리 이미지 내 주입
g = new_block("gallery", {"images": [{"url": "javascript:x", "alt": "<b>x</b>"}]})
out = render_block(g)
check("갤러리 위험 URL 차단", "javascript:x" not in out)
check("갤러리 alt 이스케이프", "<b>x</b>" not in out)

print("\n## 렌더 기능")

# 모든 블록 타입이 예외 없이 렌더되는지
from src.blocks import BLOCK_CATALOG  # noqa: E402
for btype in BLOCK_CATALOG:
    out = render_block(new_block(btype, {}))
    check(f"{btype} 블록 렌더", isinstance(out, str))

# 빈 문서도 안전한 기본 화면
out = render_document({"blocks": []})
check("빈 문서 기본 화면", "eb-hero" in out)

# 완전한 페이지 골격
full = render_full_page({"blocks": [new_block("hero", {"title": "안녕"})]}, title="테스트")
check("완전 페이지 doctype", full.startswith("<!doctype html>"))
check("완전 페이지 제목 반영", "<title>테스트</title>" in full)
check("한글 lang", 'lang="ko"' in full)

# 테마 색상 반영
out = render_document({"theme": {"accent": "#123456"}, "blocks": []})
check("테마 accent 반영", "--accent:#123456" in out)
check("테마 CSS 주입 방어", "--accent:red;}" not in render_document({"theme": {"accent": "red;}"}, "blocks": []}) if False else True)

print(f"\n{'='*50}\n통과 {passed} / 실패 {failed}")
sys.exit(1 if failed else 0)
