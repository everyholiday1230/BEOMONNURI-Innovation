#!/usr/bin/env python3
"""
로컬 레이아웃 미리보기 서버.

- 로컬 superchart-ai/static/ 의 변경된 정적 파일(index.html, js, css 등)을 우선 서빙
- 로컬에 없는 경로(/v1 API, 차트 시세 등)는 라이브(chart.beomonnuri.com)로 프록시
  → 제가 수정한 UI를 보면서 차트 데이터까지 실제로 표시됨

실행:  python3 scripts/local_preview.py [PORT]
기본 포트: 8080
"""
import http.server
import os
import socketserver
import sys
import urllib.request
import urllib.error

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
UPSTREAM = "https://chart.beomonnuri.com"

# 로컬 static 에서 직접 서빙할 경로 prefix (그 외 동적 경로는 업스트림 프록시)
LOCAL_PREFIXES = ("/static/", "/js/", "/css/", "/chart-engine/")
LOCAL_FILES = {"/", "/index.html", "/i18n.js", "/favicon.png", "/favicon.svg",
               "/manifest.json", "/landing.html", "/faq.html",
               "/terms.html", "/privacy.html", "/terms", "/privacy", "/faq"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _serve_local(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            return True
        # /static/foo → static/foo (directory 가 이미 static 이므로 /static prefix 제거)
        if path.startswith("/static/"):
            self.path = self.path[len("/static"):]
            return True
        if path in LOCAL_FILES:
            return True
        if path.startswith(("/js/", "/css/", "/chart-engine/")):
            return True
        return False

    def _proxy(self):
        url = UPSTREAM + self.path
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else None
            req = urllib.request.Request(url, data=body, method=self.command)
            for h in ("Content-Type", "Accept", "Authorization", "Cookie"):
                if self.headers.get(h):
                    req.add_header(h, self.headers.get(h))
            req.add_header("User-Agent", "local-preview")
            with urllib.request.urlopen(req, timeout=20) as resp:
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() in ("transfer-encoding", "connection", "content-encoding", "content-length"):
                        continue
                    self.send_header(k, v)
                data = resp.read()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(f"proxy error: {e}".encode())

    def do_GET(self):
        if self._serve_local():
            return super().do_GET()
        return self._proxy()

    def do_POST(self):
        return self._proxy()

    def log_message(self, fmt, *args):
        pass  # quiet


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Local preview on http://0.0.0.0:{PORT}  (static={STATIC_DIR}, api->{UPSTREAM})")
    httpd.serve_forever()
