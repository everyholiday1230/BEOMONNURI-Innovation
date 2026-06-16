"""Brotli 압축 미들웨어.

Accept-Encoding에 'br'이 있는 요청에 대해
텍스트 계열 응답을 Brotli로 압축합니다.
gzip 대비 약 20% 더 작은 사이즈.
"""
from fastapi import FastAPI

try:
    import brotli as _brotli
    _BROTLI_OK = True
except ImportError:
    _BROTLI_OK = False


async def _brotli_middleware(request, call_next):
    """Accept-Encoding에 br 있으면 Brotli 압축."""
    response = await call_next(request)
    accept = request.headers.get("accept-encoding", "")
    if "br" not in accept.lower():
        return response
    # 이미 압축된 것은 스킵
    if response.headers.get("content-encoding"):
        return response
    # 텍스트 계열만 압축
    content_type = response.headers.get("content-type", "")
    if not any(t in content_type for t in ("text/", "application/json", "application/javascript", "image/svg")):
        return response
    # body 수집
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    if len(body) < 1024:
        # 1KB 미만 스킵 (재조립)
        from starlette.responses import Response
        resp = Response(content=body, status_code=response.status_code, headers=dict(response.headers), media_type=content_type or None)
        _copy_set_cookies(response, resp)
        return resp
    # Brotli 압축
    compressed = _brotli.compress(body, quality=5)
    from starlette.responses import Response
    new_headers = dict(response.headers)
    new_headers["content-encoding"] = "br"
    new_headers["content-length"] = str(len(compressed))
    # GZip의 content-length 제거 (기존 main.py와 동일 로직)
    if "content-length" in new_headers and new_headers.get("content-encoding") == "br":
        new_headers["content-length"] = str(len(compressed))
    resp = Response(content=compressed, status_code=response.status_code, headers=new_headers, media_type=content_type)
    _copy_set_cookies(response, resp)
    return resp


def _copy_set_cookies(src, dst):
    """원본 응답의 모든 Set-Cookie 헤더를 새 응답으로 보존.

    dict(headers)는 동일 키(set-cookie)를 1개로 합쳐 refresh/csrf 쿠키가 유실되므로,
    raw_headers에서 set-cookie 바이트를 직접 복사한다.
    """
    try:
        # 새 응답에서 기존 set-cookie 제거(중복 방지) 후 원본 것 전부 추가
        dst.raw_headers = [(k, v) for (k, v) in dst.raw_headers if k.lower() != b"set-cookie"]
        for (k, v) in src.raw_headers:
            if k.lower() == b"set-cookie":
                dst.raw_headers.append((k, v))
    except Exception:
        pass


def register(app: FastAPI) -> bool:
    """Brotli 미들웨어를 앱에 등록. brotli 라이브러리 없으면 skip.

    Returns:
        True: 등록 성공
        False: brotli 라이브러리 미설치로 skip
    """
    if not _BROTLI_OK:
        return False
    app.middleware("http")(_brotli_middleware)
    return True


__all__ = ["register", "_BROTLI_OK"]
