"""실시간 채널 (WebSocket).

용도:
  - 학생 화면: 자기 프로젝트 룸을 구독. 관리자가 개입하면
    "수정 중" 상태와 "완료(새 문서)" 만 받는다. 관리자↔AI 대화는 절대 전송하지 않는다.
  - 관리자 대시보드: 반 룸을 구독. 새 도움 요청 알림을 실시간으로 받는다.

룸 키:
  project:{project_id}   해당 프로젝트를 보는 학생(+ 개입 중인 관리자)
  class:{class_id}       해당 반을 보는 관리자들

메시지 형식(JSON): {"type": ..., ...}
  학생 수신 가능 타입: intervene_start, intervene_end(+doc), doc_updated(+doc), help_ack
  관리자 수신 가능 타입: help_new, help_resolved
서버는 학생 룸으로 절대 관리자 프롬프트/AI 원문을 보내지 않는다(설계 불변식).
"""
from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def join(self, room: str, ws: WebSocket) -> None:
        async with self._lock:
            self._rooms[room].add(ws)

    async def leave(self, room: str, ws: WebSocket) -> None:
        async with self._lock:
            self._rooms.get(room, set()).discard(ws)
            if room in self._rooms and not self._rooms[room]:
                del self._rooms[room]

    async def leave_all(self, ws: WebSocket) -> None:
        async with self._lock:
            for room in list(self._rooms.keys()):
                self._rooms[room].discard(ws)
                if not self._rooms[room]:
                    del self._rooms[room]

    async def broadcast(self, room: str, message: dict) -> None:
        async with self._lock:
            targets = list(self._rooms.get(room, set()))
        dead = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.leave_all(ws)


hub = Hub()


def project_room(project_id: str) -> str:
    return f"project:{project_id}"


def class_room(class_id: str) -> str:
    return f"class:{class_id}"
