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


# claude --output-format stream-json은 이미지 Read 결과(base64)처럼 수 MB짜리 JSON을
# "한 줄"로 내보낸다. StreamReader 기본 버퍼(64KB)로는 그 줄에서 스트림이 끊기므로 넉넉히 잡는다.
STREAM_LIMIT = 1 << 20

# 그래도 한 줄이 이만큼을 넘으면 메모리를 지키기 위해 잘라낸다(잘린 줄은 raw 이벤트로 남는다).
MAX_LINE_BYTES = 8 << 20

# 이벤트 하나가 들고 갈 원본(data)의 상한. 이걸 넘으면 요약으로 대체한다.
MAX_EVENT_DATA_CHARS = 32 * 1024


class RunState:
    def __init__(self, run_id: str, user_id: str, agent_dir: str, stage_key: str,
                 stage_title: str, agent_key: str, agent_label: str, prompt: str,
                 full_prompt: str, project: Optional[str] = None,
                 model: str = "", effort: str = ""):
        self.id = run_id
        self.user_id = user_id
        self.agent_dir = agent_dir
        self.stage_key = stage_key
        self.stage_title = stage_title
        self.project = project
        self.model = model
        self.effort = effort
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
            project=self.project,
            model=self.model or None,
            effort=self.effort or None,
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
            data=_shrink_data(data),
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


def _shrink_data(data):
    """이벤트에 실어 보낼 원본(data)이 너무 크면 요약만 남긴다.

    이미지 Read의 tool_result에는 base64가 통째로 들어와 한 건이 수 MB다. 그대로 두면
    run.events(최대 5000건)와 WebSocket 전송이 함께 부담을 진다. 화면은 text만 그리고
    data는 run_end의 exit_code만 읽으므로, 큰 원본은 요약으로 대체해도 손실이 없다.
    """
    if data is None:
        return None
    try:
        encoded = json.dumps(data, ensure_ascii=False)
    except (TypeError, ValueError):
        return {"omitted": "직렬화할 수 없는 데이터"}
    if len(encoded) <= MAX_EVENT_DATA_CHARS:
        return data
    summary = {"omitted": f"원본 {len(encoded)}자 (크기 초과로 생략)"}
    if isinstance(data, dict):
        for key in ("type", "subtype", "name", "id", "tool_use_id"):
            if key in data and isinstance(data[key], (str, int, float, bool)):
                summary[key] = data[key]
    return summary


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


async def _read_lines(stream: asyncio.StreamReader):
    """길이 제한 없이 한 줄씩 돌려준다.

    `async for line in stream`(= readline)은 버퍼 한도를 넘는 줄을 만나면
    ValueError("Separator is found, but chunk is longer than limit")를 던지고 스트림 전체를
    끊어버린다. 실제로 intent 분석이 요구사항 이미지를 Read하는 순간 이 예외로 run이 죽었다.
    여기서는 LimitOverrunError를 받아 조각을 이어붙이는 방식으로 긴 줄도 끝까지 읽는다.
    """
    buf = bytearray()
    while True:
        try:
            chunk = await stream.readuntil(b"\n")
        except asyncio.LimitOverrunError as exc:
            # 한도 안에서 개행을 못 찾음 -> 지금까지 확인한 만큼 가져와 이어붙이고 계속 찾는다.
            buf += await stream.readexactly(exc.consumed)
            if len(buf) > MAX_LINE_BYTES:
                del buf[MAX_LINE_BYTES:]
            continue
        except asyncio.IncompleteReadError as exc:
            buf += exc.partial
            if buf:
                yield bytes(buf)
            return
        buf += chunk
        yield bytes(buf[:MAX_LINE_BYTES])
        buf.clear()


async def _pump_stdout(run: RunState):
    assert run.process is not None
    assert run.process.stdout is not None
    async for line_bytes in _read_lines(run.process.stdout):
        _handle_stream_line(run, line_bytes.decode("utf-8", errors="replace"))


async def _pump_stderr(run: RunState):
    assert run.process is not None
    assert run.process.stderr is not None
    async for line_bytes in _read_lines(run.process.stderr):
        line = line_bytes.decode("utf-8", errors="replace").rstrip()
        if line:
            run._emit("stderr", text=_truncate(line))


async def _terminate(process: asyncio.subprocess.Process):
    if process.returncode is not None:
        return
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except asyncio.TimeoutError:
        process.kill()


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
    # 고르지 않았으면 붙이지 않는다 = CLI 기본값을 그대로 쓴다.
    # 값은 llm_models.check_choice를 통과한 것만 들어온다(argv에 나가므로).
    if run.model:
        argv += ["--model", run.model]
    if run.effort:
        argv += ["--effort", run.effort]
    try:
        run.process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=run.agent_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=STREAM_LIMIT,
        )
    except FileNotFoundError:
        run._emit("stderr", text=f"'{CLAUDE_BIN}' 실행 파일을 찾을 수 없습니다. PATH를 확인하세요.")
        run._finish("error", None)
        return

    run._emit("system", text=f"claude CLI 실행: {' '.join(argv[:3])} ... (cwd={run.agent_dir})")

    try:
        # return_exceptions=True: 한쪽 pump가 죽어도 다른 쪽 로그를 끝까지 받아 UI에 남긴다.
        results = await asyncio.gather(
            _pump_stdout(run), _pump_stderr(run), return_exceptions=True
        )
        failures = [r for r in results if isinstance(r, Exception)]
        for failure in failures:
            run._emit("stderr", text=f"로그 스트림 처리 실패: {failure!r}")
        if failures:
            # 파이프를 더 못 읽으면 자식이 write에서 막혀 wait()가 끝나지 않는다. 먼저 종료시킨다.
            await _terminate(run.process)
        exit_code = await run.process.wait()
        status = "error" if failures or exit_code != 0 else "success"
        run._finish(status, exit_code)
    except asyncio.CancelledError:
        # 취소된 태스크에서는 await가 곧바로 다시 취소될 수 있으므로 시그널만 보내고 끝낸다.
        if run.process.returncode is None:
            run.process.terminate()
        run._finish("stopped", None)
        raise
    except Exception as exc:  # noqa: BLE001 - surface any unexpected failure to the UI
        run._emit("stderr", text=f"실행 중 예외 발생: {exc}")
        await _terminate(run.process)
        run._finish("error", None)


class RunManager:
    def __init__(self):
        self.runs: Dict[str, RunState] = {}
        self._tasks: Dict[str, asyncio.Task] = {}

    def create_run(self, user_id: str, agent_dir: str, agent_key: str, prompt: str,
                   project: Optional[str] = None, model: str = "", effort: str = "") -> RunState:
        stage, agent = find_agent(Path(agent_dir), agent_key)
        if agent is None:
            raise ValueError(f"알 수 없는 agent_key: {agent_key}")

        run_id = uuid.uuid4().hex[:12]
        full_prompt = f"@{agent_key} {prompt}".strip()
        if project:
            # 프로젝트를 명시하지 않으면 에이전트가 후보를 나열하고 사용자 확인을 기다리는데
            # (CLAUDE.md Input File Management Rules), 비대화형 실행에서는 거기서 끝나버린다.
            full_prompt = f"{full_prompt} (프로젝트: {project})"
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
            project=project,
            model=model,
            effort=effort,
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
