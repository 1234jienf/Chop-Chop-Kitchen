"""Combined multiplayer WebSocket and GPT review server for Chop-Chop Kitchen.

Run:  uvicorn py.multiplayer_api:app --host 0.0.0.0 --port 8001
"""
from dataclasses import dataclass, field
from typing import Dict, List
import re

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

try:
    from .review_api import router as review_router
except ImportError:
    from review_api import router as review_router

app = FastAPI(title="Chop-Chop Kitchen API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://1234jienf.github.io",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
app.include_router(review_router)
ROOM_RE = re.compile(r"[^A-Z0-9_-]")


@dataclass
class Player:
    id: str
    name: str
    socket: WebSocket
    ready: bool = False


@dataclass
class Room:
    code: str
    players: Dict[str, Player] = field(default_factory=dict)
    order: List[str] = field(default_factory=list)
    current_step: int = 0
    results: List[int] = field(default_factory=list)
    ingredient_cuts: Dict[str, int] = field(default_factory=dict)
    started: bool = False
    shared_state: dict = field(default_factory=dict)


rooms: Dict[str, Room] = {}


@app.get("/health")
async def health():
    return {"ok": True, "service": "multiplayer-and-review"}


def clean_code(value: str) -> str:
    return ROOM_RE.sub("", (value or "KITCHEN").upper())[:12] or "KITCHEN"


def snapshot(room: Room):
    return {
        "type": "snapshot",
        "room": room.code,
        "players": [{"id": p.id, "name": p.name, "ready": p.ready} for p in room.players.values()],
        "game": {
            "started": room.started,
            "order": room.order,
            "currentStep": room.current_step,
            "results": room.results,
            "ingredientCuts": room.ingredient_cuts,
            "sharedState": room.shared_state,
        },
    }


async def broadcast(room: Room):
    dead = []
    for pid, player in room.players.items():
        try:
            await player.socket.send_json(snapshot(room))
        except Exception:
            dead.append(pid)
    for pid in dead:
        room.players.pop(pid, None)


async def broadcast_activity(room: Room, activity: dict):
    message = {"type": "activity", "activity": activity}
    for member in list(room.players.values()):
        try:
            await member.socket.send_json(message)
        except Exception:
            pass


async def error(ws: WebSocket, message: str):
    await ws.send_json({"type": "error", "message": message})


@app.websocket("/ws")
async def multiplayer_socket(ws: WebSocket):
    await ws.accept()
    room = None
    player = None
    try:
        first = await ws.receive_json()
        if first.get("type") != "join":
            await error(ws, "join 메시지가 먼저 필요합니다.")
            return
        code = clean_code(first.get("room"))
        room = rooms.setdefault(code, Room(code))
        if len(room.players) >= 3:
            await error(ws, "이 방은 이미 3명이 모두 참가했습니다.")
            return
        pid = next(candidate for candidate in ("p1", "p2", "p3") if candidate not in room.players)
        player = Player(pid, str(first.get("name") or f"셰프 {len(room.players) + 1}")[:12], ws)
        room.players[pid] = player
        if pid not in room.order:
            room.order.append(pid)
        await ws.send_json({"type": "welcome", "playerId": pid, "room": code})
        await broadcast(room)

        while True:
            message = await ws.receive_json()
            kind = message.get("type")
            if kind == "name":
                player.name = str(message.get("name") or player.name)[:12]
            elif kind == "set_order":
                order = message.get("order", [])
                if len(room.players) != 3 or sorted(order) != sorted(room.players):
                    await error(ws, "3명이 입장한 뒤 세 명 모두를 포함한 순서로 정해 주세요.")
                    continue
                if room.started:
                    await error(ws, "게임이 시작된 뒤에는 릴레이 순서를 바꿀 수 없습니다.")
                    continue
                room.order = order
                for member in room.players.values():
                    member.ready = False
                if not room.shared_state and isinstance(message.get("sharedState"), dict):
                    room.shared_state = message["sharedState"]
            elif kind == "ready":
                if len(room.players) != 3 or len(room.order) != 3:
                    await error(ws, "3명이 모두 입장해야 준비할 수 있습니다.")
                    continue
                player.ready = bool(message.get("ready", True))
                if not room.shared_state and isinstance(message.get("sharedState"), dict):
                    room.shared_state = message["sharedState"]
                if all(member.ready for member in room.players.values()):
                    room.started = True
            elif kind == "step":
                if not room.started or room.order[room.current_step % 3] != player.id:
                    await error(ws, "현재 조리 담당자만 공정을 완료할 수 있습니다.")
                    continue
                room.results.append(max(20, min(100, int(message.get("accuracy", 0)))))
                room.current_step += 1
                room.ingredient_cuts.update(message.get("ingredientCuts") or {})
            elif kind == "activity":
                if room.started and room.order[room.current_step % 3] == player.id:
                    activity = message.get("activity")
                    if isinstance(activity, dict):
                        await broadcast_activity(room, activity)
                continue
            elif kind == "next_day":
                room.current_step = 0
                room.results = []
                room.ingredient_cuts = {}
                if isinstance(message.get("sharedState"), dict):
                    room.shared_state = message["sharedState"]
            await broadcast(room)
    except WebSocketDisconnect:
        pass
    finally:
        if room and player:
            room.players.pop(player.id, None)
            room.started = False
            room.order = [pid for pid in room.order if pid != player.id]
            for remaining in room.players.values():
                remaining.ready = False
            await broadcast(room)
            if not room.players:
                rooms.pop(room.code, None)
