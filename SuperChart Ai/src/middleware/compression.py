"""GZip 압축 미들웨어.

1KB 이상 응답에 대해 GZip 압축을 수행합니다.
Brotli 미들웨어(별도)가 있는 경우, Brotli가 우선 적용됩니다.
"""
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware


# 기존 main.py와 동일 설정
MIN_SIZE = 1024
COMPRESS_LEVEL = 6


def register(app: FastAPI) -> None:
    """GZip 미들웨어를 앱에 등록."""
    app.add_middleware(GZipMiddleware, minimum_size=MIN_SIZE, compresslevel=COMPRESS_LEVEL)


__all__ = ["register", "MIN_SIZE", "COMPRESS_LEVEL"]
