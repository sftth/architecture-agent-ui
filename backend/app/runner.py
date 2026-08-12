import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from .agents_catalog import find_agent
from .config import CLAUDE_BIN, CLAUDE_PERMISSION_MODE, MAX_LOG_EVENTS_PER_RUN
from .models import LogEvent, RunSummary


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunState:
    def __init__(self, run_id: str, user_id: str, agent_dir: str, stage_key: str,
                 stage_title: str, agent_key: str, agent_label: str, prompt: str,
                 full_prompt: str):
        self.id = run_id
        self.user_id = user_id
        self.agent_dir = agent_dir
        self.stage_key = stage_key
        self.stage_title = stage_title
        self.agent_key = agent_key
        self.agent_label = agent_label
        self.prompt = prompt
        self.full_prompt = full_prompt
        self.status = "running"
        self.started_at = _now()
        self.ended_at: Optional[str] = None
        self.exit_code: Optional[int] = None
        self.events: List[LogEvent] = []
        self.subscribers: List[asyncio.Queue] = []
        self.process: Optional[asyncio.subprocess.Process] = None
        self._seq = 0

    def summary(self) -> RunSummary:
        return RunSummary(
            id=self.id,
            agent_key=self.agent_key,
            agent_label=self.agent_label,
            stage_key=self.stage_key,
            stage_title=self.stage_title,
            prompt=self.prompt,
            full_prompt=self.full_prompt,
            status=self.status,
            started_at=self.started_at,
            ended_at=self.ended_at,
            exit_code=self.exit_code,
            event_count=len(self.events),
        )

    def _emit(self, kind: str, *, text: Optional[str] = None, data=None,
               parent_tool_use_id: Optional[str] = None):
        self._seq += 1
        event = LogEvent(
            seq=self._seq,
            ts=_now(),
            kind=kind,
            parent_tool_use_id=parent_tool_use_id,
            data=data,
            text=text,
        )
        self.events.append(event)
        if len(self.events) > MAX_LOG_EVENTS_PER_RUN:
            self.events.pop(0)
        for queue in list(self.subscribers):
            queue.put_nowait(event)

    def _finish(self, status: str, exit_code: Optional[int]):
        self.status = status
        self.exit_code = exit_code
        self.ended_at = _now()
        self._emit("run_end", text=status, data={"exit_code": exit_code})
        for queue in list(self.subscribers):
            queue.put_nowait(None)  # sentinel: stream closed


def _truncate(value: str, limit: int = 4000) -> str:
    if value is None:
        return value
    return value if len(value) <= limit else value[:limit] + "\n...(truncated)"


def _handle_stream_line(run: RunState, raw_line: str):
    raw_line = raw_line.strip()
    if not raw_line:
        return
    try:
        raw = json.loads(raw_line)
    except json.JSONDecodeError:
        run._emit("raw", text=_truncate(raw_line))
        return

    ev_type = raw.get("type", "")
    subtype = raw.get("subtype", "")
    parent_id = raw.get("parent_tool_use_id")

    if "hook" in ev_type or "hook" in subtype:
        run._emit("hook", text=f"{ev_type}/{subtype}", data=raw, parent_tool_use_id=parent_id)
        return

    if ev_type == "system":
        run._emit("system", text=f"세션 시작 (subtype={subtype})", data=raw)
        return

    if ev_type == "rate_limit_event":
        status = (raw.get("rate_limit_info") or {}).get("status", "unknown")
        run._emit("system", text=f"rate limit 상태: {status}", data=raw)
        return

    if ev_type in ("assistant", "user"):
        message = raw.get("message", {}) or {}
        content = message.get("content", [])
        if isinstance(content, str):
            run._emit(ev_type, text=_truncate(content), parent_tool_use_id=parent_id)
            return
        for block in content:
            btype = block.get("type")
            if btype == "text":
                run._emit("assistant", text=_truncate(block.get("text", "")),
                           parent_tool_use_id=parent_id)
            elif btype == "thinking":
                run._emit("thinking", text=_truncate(block.get("thinking", "")),
                           parent_tool_use_id=parent_id)
            elif btype == "tool_use":
                summary = f"{block.get('name')}({json.dumps(block.get('input', {}), ensure_ascii=False)[:300]})"
                run._emit("tool_use", text=_truncate(summary), data=block,
                           parent_tool_use_id=parent_id)
            elif btype == "tool_result":
                result_content = block.get("content", "")
                if isinstance(result_content, list):
                    result_content = "\n".join(
                        c.get("text", "") for c in result_content if isinstance(c, dict)
                    )
                run._emit("tool_result", text=_truncate(str(result_content)), data=block,
                           parent_tool_use_id=parent_id)
            else:
                run._emit("raw", text=_truncate(json.dumps(block, ensure_ascii=False)[:500]))
        return

    if ev_type == "result":
        text = raw.get("result") or subtype or "완료"
        run._emit("result", text=_truncate(str(text)), data=raw)
        return

    run._emit("raw", text=_truncate(json.dumps(raw, ensure_ascii=False)[:500]), data=raw)


async def _pump_stdout(run: RunState):
    assert run.process is not None
    assert run.process.stdout is not None
    async for line_bytes in run.process.stdout:
        try:
            line = line_bytes.decode("utf-8", errors="replace")
        except Exception:
            continue
        _handle_stream_line(run, line)


async def _pump_stderr(run: RunState):
    assert run.process is not None
    assert run.process.stderr is not None
    async for line_bytes in run.process.stderr:
        line = line_bytes.decode("utf-8", errors="replace").rstrip()
        if line:
            run._emit("stderr", text=_truncate(line))


async def _execute(run: RunState):
    argv = [
        CLAUDE_BIN,
        "-p", run.full_prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--permission-mode", CLAUDE_PERMISSION_MODE,
        "--forward-subagent-text",
        "--include-hook-events",
        "--no-session-persistence",
    ]
    try:
        run.process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=run.agent_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        run._emit("stderr", text=f"'{CLAUDE_BIN}' 실행 파일을 찾을 수 없습니다. PATH를 확인하세요.")
        run._finish("error", None)
        return

    run._emit("system", text=f"claude CLI 실행: {' '.join(argv[:3])} ... (cwd={run.agent_dir})")

    try:
        await asyncio.gather(_pump_stdout(run), _pump_stderr(run))
        exit_code = await run.process.wait()
        run._finish("success" if exit_code == 0 else "error", exit_code)
    except asyncio.CancelledError:
        run._finish("stopped", None)
        raise
    except Exception as exc:  # noqa: BLE001 - surface any unexpected failure to the UI
        run._emit("stderr", text=f"실행 중 예외 발생: {exc}")
        run._finish("error", None)


class RunManager:
    def __init__(self):
        self.runs: Dict[str, RunState] = {}
        self._tasks: Dict[str, asyncio.Task] = {}

    def create_run(self, user_id: str, agent_dir: str, agent_key: str, prompt: str) -> RunState:
        stage, agent = find_agent(Path(agent_dir), agent_key)
        if agent is None:
            raise ValueError(f"알 수 없는 agent_key: {agent_key}")

        run_id = uuid.uuid4().hex[:12]
        full_prompt = f"@{agent_key} {prompt}".strip()
        run = RunState(
            run_id=run_id,
            user_id=user_id,
            agent_dir=agent_dir,
            stage_key=stage["key"],
            stage_title=stage["title"],
            agent_key=agent_key,
            agent_label=agent["label"],
            prompt=prompt,
            full_prompt=full_prompt,
        )
        self.runs[run_id] = run
        self._tasks[run_id] = asyncio.create_task(_execute(run))
        return run

    def get_run(self, run_id: str) -> Optional[RunState]:
        return self.runs.get(run_id)

    def list_runs(self, user_id: str) -> List[RunSummary]:
        return [r.summary() for r in sorted(
            (r for r in self.runs.values() if r.user_id == user_id),
            key=lambda r: r.started_at, reverse=True,
        )]

    async def stop_run(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if run is None or run.process is None or run.status != "running":
            return False
        run.process.terminate()
        try:
            await asyncio.wait_for(run.process.wait(), timeout=5)
        except asyncio.TimeoutError:
            run.process.kill()
        return True

    def subscribe(self, run_id: str) -> Optional[asyncio.Queue]:
        run = self.runs.get(run_id)
        if run is None:
            return None
        queue: asyncio.Queue = asyncio.Queue()
        for event in run.events:
            queue.put_nowait(event)
        if run.status != "running":
            queue.put_nowait(None)
        else:
            run.subscribers.append(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue):
        run = self.runs.get(run_id)
        if run and queue in run.subscribers:
            run.subscribers.remove(queue)


run_manager = RunManager()
