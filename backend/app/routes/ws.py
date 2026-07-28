from fastapi import APIRouter, WebSocket

from ..runner import run_manager

router = APIRouter()


@router.websocket("/ws/runs/{run_id}")
async def ws_run(websocket: WebSocket, run_id: str):
    await websocket.accept()
    queue = run_manager.subscribe(run_id)
    if queue is None:
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
