"""WS graceful shutdown 회귀 — CancelledError 가 종료를 실패시키지 않도록.

배경: close_all() 이 취소한 flush 태스크를 await 할 때 `except Exception` 으로만
잡으면, CancelledError 는 BaseException 상속이라 잡히지 않아 "Application shutdown
failed" 로 이어졌다. `except (asyncio.CancelledError, Exception)` 로 수정.
"""
import asyncio


def test_cancelled_error_is_baseexception_not_exception():
    # 근본 원인: CancelledError 는 Exception 이 아니라 BaseException.
    assert issubclass(asyncio.CancelledError, BaseException)
    assert not issubclass(asyncio.CancelledError, Exception)


def test_shutdown_await_pattern_swallows_cancel():
    # 수정된 close_all 과 동일한 처리: 취소된 태스크 await 시 깔끔히 무시.
    async def run():
        async def flusher():
            try:
                while True:
                    await asyncio.sleep(3600)
            except asyncio.CancelledError:
                raise
        t = asyncio.create_task(flusher())
        await asyncio.sleep(0)  # 태스크 시작
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            return "clean"
        return "clean"

    assert asyncio.run(run()) == "clean"


def test_gateway_close_all_uses_cancellederror_guard():
    # 소스에 실제로 CancelledError 를 잡는 가드가 들어갔는지 확인.
    import inspect
    from src.ws import gateway
    src = inspect.getsource(gateway)
    assert "except (asyncio.CancelledError, Exception)" in src
