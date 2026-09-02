from fastapi import APIRouter, WebSocket

from ..runner import run_manager
from ..users import resolve_session

router = APIRouter()


# 브라우저 WebSocket은 헤더를 지정할 수 없어 로그인 토큰을 쿼리스트링으로 받는다.
@router.websocket("/ws/runs/{run_id}")
async def ws_run(websocket: WebSocket, run_id: str, token: str = ""):
    await websocket.accept()
    user = resolve_session(token)
    if user is None:
        await websocket.send_json({"kind": "error", "text": "unauthorized"})
        await websocket.close()
        return

    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        await websocket.send_json({"kind": "error", "text": "run not found"})
        await websocket.close()
        return

    queue = run_manager.subscribe(run_id)
    if queue is None:
        # get_run과 subscribe 사이에 run이 지워졌을 수 있다(삭제 / 백엔드 재시작).
        # 여기서 None을 그대로 두면 아래 queue.get()이 터지고, 화면에는 아무 말 없이
        # 소켓만 닫혀 "연결 중"이 영원히 남는다.
        await websocket.send_json({"kind": "error", "text": "run not found"})
        await websocket.close()
        return

    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            await websocket.send_json(event.model_dump())
        await websocket.close()
    except Exception:
        pass
    finally:
        run_manager.unsubscribe(run_id, queue)
