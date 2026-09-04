import asyncio
import functools
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from . import accounts, store
from .agents_catalog import find_agent
from .config import CLAUDE_BIN, CLAUDE_PERMISSION_MODE, MAX_LOG_EVENTS_PER_RUN
from .models import LogEvent, RateLimit, RunSummary, RunUsage


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# 세션 목록 한 줄에 들어가는 길이. 이보다 길면 어차피 화면에서 잘린다.
MAX_TITLE_CHARS = 80


def default_title(prompt: str) -> str:
    """지시문 첫 줄을 그대로 이름으로 쓴다 — 목록에서 찾는 단서는 결국 무엇을 시켰나다."""
    first = next((line.strip() for line in (prompt or "").splitlines() if line.strip()), "")
    if not first:
        return "제목 없음"
    return first if len(first) <= MAX_TITLE_CHARS else first[:MAX_TITLE_CHARS] + "..."


# claude --output-format stream-json은 이미지 Read 결과(base64)처럼 수 MB짜리 JSON을
# "한 줄"로 내보낸다. 한 줄이 이만큼을 넘으면 메모리를 지키기 위해 잘라낸다.
MAX_LINE_BYTES = 8 << 20

# 이벤트 하나가 들고 갈 원본(data)의 상한. 이걸 넘으면 요약으로 대체한다.
MAX_EVENT_DATA_CHARS = 32 * 1024

# 지목한 agent 가 세션에 등록될 때까지 다시 띄우는 최대 횟수.
#
# 실패한 시도는 init 에서 끊으므로 API 를 한 번도 부르지 않는다 — 토큰 0, 비용은 CLI
# 기동 몇 초뿐이다. 그래서 넉넉하게 준다. 부하에서 실패율이 절반이라 해도 여섯 번이면
# 남는 실패 확률은 2% 아래다.
AGENT_REGISTER_ATTEMPTS = 6


class RunState:
    def __init__(self, run_id: str, user_id: str, agent_dir: str, stage_key: str,
                 stage_title: str, agent_key: str, agent_label: str, prompt: str,
                 full_prompt: str, project: Optional[str] = None,
                 model: str = "", effort: str = "", title: str = "",
                 session_id: str = "", turns: int = 0):
        self.id = run_id
        # claude CLI 쪽 대화 식별자. 첫 턴은 --session-id 로 지정하고, 이후 턴은
        # --resume 으로 그 대화를 이어받는다. 이것이 없으면 "같은 세션"은 화면에서만
        # 같고 에이전트는 앞 이야기를 하나도 모른다.
        self.session_id = session_id or str(uuid.uuid4())
        # 지금까지 이 세션에 보낸 지시문 수. 0 이면 아직 한 번도 안 돌린 세션이다.
        self.turns = turns
        # CLI 쪽에 이어받을 대화가 실제로 있는가. 이 기능이 생기기 전에 만들어진 세션은
        # meta 에 session_id 가 없어서, 있다고 치고 --resume 하면 "No conversation found"
        # 로 실패한다. 그런 세션은 새 대화로 열되 그 사실을 화면에 말한다.
        self.resumable = bool(session_id)
        self.title = title or default_title(prompt)
        # 디스크에서 되살린 run 은 이벤트를 아직 안 읽었다는 뜻(목록에는 필요 없다).
        self.restored = False
        self._log = None
        # result 이벤트가 와야 채워진다.
        self.usage: Optional[RunUsage] = None
        # 이 턴을 어느 Claude 계정으로 돌렸나. 턴마다 다시 정해진다 — 한도에 걸려 바꿔 타면
        # 같은 세션의 다음 턴은 다른 계정이다.
        self.account_id = accounts.DEVICE
        self.account_name: Optional[str] = None
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
        self.process: Optional[subprocess.Popen] = None
        # 이 턴을 몇 번째로 띄우고 있나. 1 이면 첫 시도다(재시도 사유는 아래 두 값).
        self.attempt = 0
        # 지목한 agent 가 이 CLI 세션에 등록됐는가. init 이벤트가 오기 전에는 모른다(None).
        self.agent_registered: Optional[bool] = None
        self._restart_wanted = False
        self._seq = 0

    def summary(self) -> RunSummary:
        return RunSummary(
            id=self.id,
            title=self.title,
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
            usage=self.usage,
            turns=self.turns,
            account_name=self.account_name,
        )

    def record(self) -> dict:
        """디스크에 남길 요약. summary() 에는 없는 값(user_id·agent_dir)을 함께 싣는다 —
        되살릴 때 누구의 것이고 어느 저장소를 향한 실행이었는지 알아야 하기 때문이다."""
        data = self.summary().model_dump()
        data["user_id"] = self.user_id
        data["agent_dir"] = self.agent_dir
        # 백엔드를 다시 띄워도 이어서 말할 수 있어야 한다 — CLI 대화 식별자를 함께 남긴다.
        data["session_id"] = self.session_id
        return data

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
        # 화면이 들고 있는 양은 제한하되, 디스크에는 자른 것까지 전부 남긴다.
        if len(self.events) > MAX_LOG_EVENTS_PER_RUN:
            self.events.pop(0)
        store.append_event(self._log, event)
        for queue in list(self.subscribers):
            queue.put_nowait(event)

    def _finish(self, status: str, exit_code: Optional[int]):
        self.status = status
        self.exit_code = exit_code
        self.ended_at = _now()
        self._emit("run_end", text=status, data={"exit_code": exit_code})
        if self._log is not None:
            try:
                self._log.close()
            finally:
                self._log = None
        store.save_meta(self.id, self.record())
        # 구독자에게 끝을 알린다. 세션은 계속 살아 있고, 다음 턴이 오면 다시 연결한다.
        for queue in list(self.subscribers):
            queue.put_nowait(None)  # sentinel: stream closed
        self.subscribers.clear()


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

    # 우리가 준 --session-id 를 CLI 가 그대로 쓰는지는 CLI 사정이다. 실제로 쓴 값을
    # 받아 두어야 다음 턴의 --resume 이 빗나가지 않는다.
    said = raw.get("session_id")
    if isinstance(said, str) and said and said != run.session_id:
        run.session_id = said
        store.save_meta(run.id, run.record())

    if "hook" in ev_type or "hook" in subtype:
        run._emit("hook", text=f"{ev_type}/{subtype}", data=raw, parent_tool_use_id=parent_id)
        return

    if ev_type == "system":
        if subtype == "init":
            _check_agent_registered(run, raw)
        run._emit("system", text=f"세션 시작 (subtype={subtype})", data=raw)
        return

    if ev_type == "rate_limit_event":
        info = raw.get("rate_limit_info") or {}
        status = info.get("status", "unknown")
        # 제한 창은 run 이 아니라 **계정**에 걸리는 값이다. 계정을 바꿔 탈 수 있게 된 뒤로는
        # 계정마다 따로 들고 있어야 한다 — Max 가 막혔다는 표시가 Enterprise 로 바꾼 뒤에도
        # 남아 있으면 안 되고, 반대로 Enterprise 가 막힌 것을 Max 의 것으로 읽어도 안 된다.
        limit = RateLimit(
            status=str(status),
            kind=info.get("rateLimitType"),
            resets_at=info.get("resetsAt"),
            using_overage=bool(info.get("isUsingOverage")),
        )
        run_manager.rate_limits[(run.user_id, run.account_id)] = limit
        accounts.note_rate_limit(run.user_id, run.account_id, str(status))
        # allowed 는 "아무 일 없음"이라 화면에서 걸러지는 잡음이지만, 그 밖의 상태는
        # 실행이 여기서 멈춘 이유일 수 있다. 걸릴 자리에 두려면 종류부터 달라야 한다 —
        # 화면이 문구를 뒤져 판정하게 만들지 않는다.
        if status == "allowed":
            run._emit("system", text=f"rate limit 상태: {status}", data=raw)
        else:
            who = run.account_name or "기기 로그인"
            run._emit(
                "stderr",
                text=f"rate limit: {status} — {who} 계정이 한도에 걸렸습니다. "
                     "위쪽 계정 칩에서 다른 계정으로 바꾸고 이어서 보내면 같은 세션으로 계속됩니다.",
                data=raw,
            )
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
        # 이 run 이 실제로 쓴 양. 화면 상단 사용량 띠가 이걸 모아 더한다.
        usage = raw.get("usage") or {}
        run.usage = RunUsage(
            input_tokens=int(usage.get("input_tokens") or 0),
            output_tokens=int(usage.get("output_tokens") or 0),
            cache_read_tokens=int(usage.get("cache_read_input_tokens") or 0),
            cache_write_tokens=int(usage.get("cache_creation_input_tokens") or 0),
            cost_usd=float(raw.get("total_cost_usd") or 0.0),
        )
        text = raw.get("result") or subtype or "완료"
        run._emit("result", text=_truncate(str(text)), data=raw)
        return

    run._emit("raw", text=_truncate(json.dumps(raw, ensure_ascii=False)[:500]), data=raw)


def _check_agent_registered(run: "RunState", raw: dict) -> None:
    """지목한 agent 가 이 CLI 세션에 실제로 등록됐는지 init 이벤트로 확인한다.

    `.claude/agents/**` 스캔은 CLI 기동과 경쟁한다. 머신이 한가하면 전부 등록되지만
    (같은 저장소에서 단독 순차 10회 모두 59/59), 다른 claude 프로세스와 겹치면 최상위
    디렉터리 한두 개까지만 훑고 끊긴다 — 59개 중 5~6개만 남은 실행을 여러 번 관측했다.
    대화형 세션을 켜 둔 채 이 UI 를 돌리는 것이 바로 그 조건이다.

    그때 메인 모델의 도구 목록에는 우리가 지목한 이름이 없다. 모델은 대신
    general-purpose 를 부르고 실행은 **성공으로 끝난다.** 시킨 일과 다른 일을 하고도
    화면에서 구분되지 않는 거짓 성공이라, 이쪽이 조용히 넘기면 아무도 못 잡는다.

    init 은 첫 API 요청 **전에** 오므로, 여기서 걸러내면 토큰을 한 톨도 쓰지 않고 다시
    띄울 수 있다. 그래서 판정하는 즉시 프로세스를 끊는다 — 살려 두면 그 순간부터
    잘못된 실행에 돈이 든다.
    """
    names = raw.get("agents")
    if not isinstance(names, list):
        # 목록을 주지 않는 CLI 버전이면 판정하지 않는다. 모른다는 이유로 막지는 않는다.
        return
    run.agent_registered = run.agent_key in names
    if run.agent_registered:
        return
    run._restart_wanted = True
    if run.process is not None and run.process.returncode is None:
        run.process.terminate()


def _pump(run: "RunState", stream, loop: asyncio.AbstractEventLoop, is_stderr: bool) -> None:
    """자식 프로세스의 파이프 한 쪽을 스레드에서 끝까지 읽는다.

    읽기는 스레드에서 하되 이벤트를 만드는 일은 반드시 이벤트 루프에서 해야 한다 —
    run.events 추가와 asyncio.Queue.put_nowait는 스레드 안전하지 않다. 그래서 줄만
    스레드에서 뽑고 해석은 call_soon_threadsafe로 루프에 넘긴다.
    """
    for raw in iter(stream.readline, b""):
        # stream-json 한 줄이 수 MB(이미지 Read의 base64)까지 커진다. 메모리를 지키려 자른다.
        line = raw[:MAX_LINE_BYTES].decode("utf-8", errors="replace")
        if is_stderr:
            text = line.rstrip()
            if text:
                loop.call_soon_threadsafe(
                    functools.partial(run._emit, "stderr", text=_truncate(text))
                )
        else:
            loop.call_soon_threadsafe(_handle_stream_line, run, line)


async def _terminate(process: subprocess.Popen) -> None:
    if process.returncode is not None:
        return
    process.terminate()
    try:
        await asyncio.wait_for(asyncio.to_thread(process.wait), timeout=5)
    except asyncio.TimeoutError:
        process.kill()


async def _execute(run: RunState):
    """claude CLI를 돌리고 그 출력을 이벤트로 흘려보낸다.

    프로세스는 asyncio가 아니라 스레드 위의 subprocess.Popen으로 띄운다. 윈도우에서
    uvicorn을 --reload로 켜면 이벤트 루프가 SelectorEventLoop가 되는데(uvicorn
    loops/asyncio.py: use_subprocess면 Selector), 이 루프는 asyncio 서브프로세스를
    아예 지원하지 않아 create_subprocess_exec가 NotImplementedError를 던졌다. 그 예외는
    아무도 회수하지 않는 태스크 안에서 조용히 사라졌고, run은 영원히 "running"인 채
    이벤트가 한 건도 안 나와 화면에는 "연결 중"만 남았다. 스레드+Popen은 루프 종류를
    가리지 않으므로, 어떻게 띄운 백엔드에서도 똑같이 돈다.

    한 턴이 프로세스 하나로 끝나지 않을 수 있다. 지목한 agent 가 세션에 등록되지 않은
    채 뜨면(_check_agent_registered) init 에서 끊고 다시 띄운다. 그러니 아래는
    "턴을 준비하는 부분"과 "그 턴을 띄우는 부분"으로 갈라져 있다 — 턴 수·대화 모드는
    한 번만 정하고, 재시도는 띄우는 쪽만 반복한다.
    """
    # 이 턴에 무엇을 물었는지 로그에 남긴다 — 한 세션에 여러 번 물으면 콘솔이 그 자리를
    # 알아야 질문과 답을 짝지어 보여 줄 수 있다.
    run._emit("user", text=run.prompt, data={"full_prompt": run.full_prompt, "turn": run.turns + 1})

    # 첫 턴은 대화를 열고, 이후 턴은 그 대화를 이어받는다.
    #
    # 전에는 --no-session-persistence 를 붙여 CLI 가 대화를 디스크에 남기지 않게 했다.
    # 그래서 이어서 물을 방법이 아예 없었고, 화면도 그 사실에 맞춰 "보낼 때마다 새 run"
    # 이었다. 이어 말하기를 되살리려면 저장이 먼저다 — 이 세션의 것만 남는다.
    if run.turns > 0 and not run.resumable:
        run._emit(
            "stderr",
            text="이 세션은 이어 말하기가 생기기 전에 만들어져 앞 대화를 넘겨받을 수 없습니다. "
                 "새 대화로 이어갑니다 — 위쪽 기록은 화면에만 남고 에이전트는 모릅니다.",
        )
    # 이 턴을 이어받기로 여는가. 재시도가 이 값을 다시 계산하면 턴 수가 부풀고 첫 턴이
    # 여러 번 "새 대화 열기"로 세어지므로, 루프 밖에서 한 번만 정한다.
    resume = run.turns > 0 and run.resumable
    run.turns += 1
    # 이 턴부터는 이어받을 대화가 생긴다.
    run.resumable = True

    if run._log is None:
        run._log = store.open_log(run.id)

    loop = asyncio.get_running_loop()

    for attempt in range(1, AGENT_REGISTER_ATTEMPTS + 1):
        run.attempt = attempt
        run.agent_registered = None
        run._restart_wanted = False

        argv = [
            CLAUDE_BIN,
            "-p", run.full_prompt,
            "--output-format", "stream-json",
            "--verbose",
            "--permission-mode", CLAUDE_PERMISSION_MODE,
            "--forward-subagent-text",
            "--include-hook-events",
        ]
        argv += ["--resume", run.session_id] if resume else ["--session-id", run.session_id]
        # 고르지 않았으면 붙이지 않는다 = CLI 기본값을 그대로 쓴다.
        # 값은 llm_models.check_choice를 통과한 것만 들어온다(argv에 나가므로).
        if run.model:
            argv += ["--model", run.model]
        if run.effort:
            argv += ["--effort", run.effort]

        # 어느 Claude 계정으로 띄우나. 이 사용자가 화면에서 고른 것을 환경변수로 싣는다 —
        # 고른 것이 없으면 기기 로그인 그대로(전에 하던 대로). 턴마다 다시 정하므로, 한도에
        # 걸린 뒤 계정을 바꾸고 이어 보내면 이 턴부터 다른 계정이 같은 대화를 잇는다.
        env, run.account_id, run.account_name = accounts.env_for(run.user_id)
        store.save_meta(run.id, run.record())

        outcome = await _run_once(run, argv, env, loop, attempt)
        if outcome != "retry":
            return
        if not resume:
            # 끊은 시도가 이 session-id 를 이미 잡아 뒀을 수 있다. 같은 값으로 다시
            # --session-id 를 주면 "이미 있다"로 거부당하므로 새로 딴다.
            run.session_id = str(uuid.uuid4())

    # 여섯 번을 띄웠는데도 등록되지 않았다. 여기서 성공으로 끝내면 지목한 agent 가 아닌
    # 것이 일한 결과를 성공이라고 보고하는 셈이다. 그러지 않는다.
    run._emit(
        "stderr",
        text=f"'{run.agent_key}' 가 CLI 세션에 등록되지 않아 {AGENT_REGISTER_ATTEMPTS}회 모두 "
             "실행하지 못했습니다. 다른 claude 프로세스가 함께 돌면 agent 탐색이 끊깁니다 — "
             "무거운 병렬 작업을 멈추고 다시 보내주세요.",
    )
    run._finish("error", None)


async def _run_once(
    run: RunState,
    argv: List[str],
    env: Dict[str, str],
    loop: asyncio.AbstractEventLoop,
    attempt: int,
) -> str:
    """이 턴을 프로세스 하나로 띄운다. "retry" 를 돌려주면 호출자가 다시 띄운다.

    "retry" 가 아니면 run 은 이 안에서 이미 끝맺어져 있다(_finish 호출됨).
    """
    try:
        run.process = await asyncio.to_thread(
            subprocess.Popen,
            argv,
            cwd=run.agent_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError:
        run._emit("stderr", text=f"'{CLAUDE_BIN}' 실행 파일을 찾을 수 없습니다. PATH를 확인하세요.")
        run._finish("error", None)
        return "done"
    except Exception as exc:  # noqa: BLE001 - 어떤 이유로든 못 띄우면 화면에 남겨야 한다
        run._emit("stderr", text=f"claude CLI를 실행하지 못했습니다: {exc!r}")
        run._finish("error", None)
        return "done"

    tail = f" [시도 {attempt}/{AGENT_REGISTER_ATTEMPTS}]" if attempt > 1 else ""
    run._emit(
        "system",
        text=f"claude CLI 실행: {' '.join(argv[:3])} ... "
             f"(cwd={run.agent_dir}, 계정={run.account_name}){tail}",
    )

    try:
        # return_exceptions=True: 한쪽 pump가 죽어도 다른 쪽 로그를 끝까지 받아 UI에 남긴다.
        results = await asyncio.gather(
            asyncio.to_thread(_pump, run, run.process.stdout, loop, False),
            asyncio.to_thread(_pump, run, run.process.stderr, loop, True),
            return_exceptions=True,
        )
        failures = [r for r in results if isinstance(r, Exception)]
        for failure in failures:
            run._emit("stderr", text=f"로그 스트림 처리 실패: {failure!r}")
        if failures:
            # 파이프를 더 못 읽으면 자식이 write에서 막혀 wait()가 끝나지 않는다. 먼저 종료시킨다.
            await _terminate(run.process)
        exit_code = await asyncio.to_thread(run.process.wait)
        if run._restart_wanted:
            # init 에서 걸러 끊은 프로세스다. API 는 한 번도 부르지 않았으므로 이 시도는
            # 토큰을 쓰지 않았다. 실패로 적지 않고 조용히 다시 띄운다.
            if attempt < AGENT_REGISTER_ATTEMPTS:
                run._emit(
                    "system",
                    text=f"'{run.agent_key}' 가 이 세션에 등록되지 않아 다시 띄웁니다 "
                         f"({attempt}/{AGENT_REGISTER_ATTEMPTS}).",
                )
            return "retry"
        if exit_code != 0 and any(
            "No conversation found" in (e.text or "")
            for e in run.events[-12:]
            if e.kind == "stderr"
        ):
            # 대화 기록이 사라진 경우(만료·정리). 다음 턴은 새 대화로 열게 표시해 둔다.
            run.resumable = False
            run._emit(
                "stderr",
                text="이어받을 대화 기록이 CLI 쪽에 없습니다. 다시 보내면 새 대화로 시작합니다.",
            )
        status = "error" if failures or exit_code != 0 else "success"
        run._finish(status, exit_code)
        return "done"
    except asyncio.CancelledError:
        # 취소된 태스크에서는 await가 곧바로 다시 취소될 수 있으므로 시그널만 보내고 끝낸다.
        if run.process.returncode is None:
            run.process.terminate()
        run._finish("stopped", None)
        raise
    except Exception as exc:  # noqa: BLE001 - surface any unexpected failure to the UI
        run._emit("stderr", text=f"실행 중 예외 발생: {exc!r}")
        await _terminate(run.process)
        run._finish("error", None)
        return "done"


class RunManager:
    def __init__(self):
        self.runs: Dict[str, RunState] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        # 마지막으로 확인된 제한 창 상태 — (사용자, 계정) 마다 하나. run 이 돌 때마다 갱신된다.
        self.rate_limits: Dict[tuple, RateLimit] = {}
        self._restore()

    def rate_limit_for(self, user_id: str) -> Optional[RateLimit]:
        """이 사용자가 지금 고른 계정의 제한 창 상태. 바꿔 타면 그 계정의 것이 보인다."""
        _env, account_id, _name = accounts.env_for(user_id)
        return self.rate_limits.get((user_id, account_id))

    def _restore(self) -> None:
        """디스크에 남은 기록을 목록으로 되살린다. 로그는 실제로 열어 볼 때 읽는다."""
        for meta in store.load_metas():
            try:
                run = RunState(
                    run_id=meta["id"],
                    user_id=meta.get("user_id", ""),
                    agent_dir=meta.get("agent_dir", ""),
                    stage_key=meta.get("stage_key", ""),
                    stage_title=meta.get("stage_title", ""),
                    agent_key=meta.get("agent_key", ""),
                    agent_label=meta.get("agent_label", ""),
                    prompt=meta.get("prompt", ""),
                    full_prompt=meta.get("full_prompt", ""),
                    project=meta.get("project"),
                    model=meta.get("model") or "",
                    effort=meta.get("effort") or "",
                    title=meta.get("title", ""),
                    session_id=meta.get("session_id", ""),
                    turns=meta.get("turns", 1),
                )
            except KeyError:
                continue
            run.started_at = meta.get("started_at", run.started_at)
            run.ended_at = meta.get("ended_at")
            run.exit_code = meta.get("exit_code")
            usage = meta.get("usage")
            run.usage = RunUsage(**usage) if usage else None
            run.account_name = meta.get("account_name")
            # 프로세스는 백엔드와 함께 죽었다. "running" 으로 되살리면 영원히 도는
            # 것처럼 보이고 중지도 안 되므로, 끊긴 것으로 표시한다.
            run.status = "stopped" if meta.get("status") == "running" else meta.get("status", "stopped")
            run.restored = True
            self.runs[run.id] = run

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
        run._log = store.open_log(run_id)
        store.save_meta(run_id, run.record())
        self._tasks[run_id] = asyncio.create_task(_execute(run))
        return run

    def continue_run(self, run_id: str, prompt: str, agent_key: str = "",
                     project: Optional[str] = None, model: str = "",
                     effort: str = "") -> RunState:
        """이미 있는 세션에 지시문을 하나 더 보낸다.

        전에는 이런 길이 없었다. 보내기는 늘 create_run 이라, 이력에서 세션을 골라
        무언가를 물으면 그 세션 옆에 새 세션이 하나 더 생겼다. 화면만의 문제가 아니라
        에이전트도 앞 이야기를 몰랐다 — 매번 새 대화였기 때문이다.

        같은 run 에 턴을 덧붙이고, CLI 에는 --resume 으로 같은 대화를 잇는다.
        """
        run = self.runs.get(run_id)
        if run is None:
            raise ValueError(f"세션을 찾을 수 없습니다: {run_id}")
        if run.status == "running":
            raise ValueError("아직 실행 중인 세션입니다")

        # 이어 말할 때도 대상을 바꿀 수 있다 — 같은 대화 안에서 다른 plan 을 부를 수 있어야 한다.
        if agent_key and agent_key != run.agent_key:
            stage, agent = find_agent(Path(run.agent_dir), agent_key)
            if agent is None:
                raise ValueError(f"알 수 없는 agent_key: {agent_key}")
            run.agent_key = agent_key
            run.agent_label = agent["label"]
            run.stage_key = stage["key"]
            run.stage_title = stage["title"]

        if project is not None:
            run.project = project
        if model:
            run.model = model
        if effort:
            run.effort = effort

        run.prompt = prompt
        full_prompt = f"@{run.agent_key} {prompt}".strip()
        if run.project:
            full_prompt = f"{full_prompt} (프로젝트: {run.project})"
        run.full_prompt = full_prompt

        run.status = "running"
        run.ended_at = None
        run.exit_code = None
        # 되살린 run 이면 앞 턴의 로그를 먼저 읽어 둔다 — 안 그러면 seq 가 1부터 다시
        # 시작해 앞 기록과 뒤엉킨다.
        self.load_events(run)
        store.save_meta(run_id, run.record())
        self._tasks[run_id] = asyncio.create_task(_execute(run))
        return run

    def get_run(self, run_id: str) -> Optional[RunState]:
        return self.runs.get(run_id)

    def load_events(self, run: RunState) -> None:
        """되살린 run 의 로그를 그때 읽어 온다. 목록만 볼 때는 읽지 않는다."""
        if not run.restored:
            return
        run.restored = False
        run.events = store.load_events(run.id)
        if run.events:
            run._seq = run.events[-1].seq

    def list_runs(self, user_id: str) -> List[RunSummary]:
        return [r.summary() for r in sorted(
            (r for r in self.runs.values() if r.user_id == user_id),
            key=lambda r: r.started_at, reverse=True,
        )]

    def rename_run(self, run_id: str, title: str) -> Optional[RunState]:
        run = self.runs.get(run_id)
        if run is None:
            return None
        cleaned = (title or "").strip()
        # 빈 이름으로 지우면 목록에서 어느 줄인지 알아볼 수 없게 된다 — 원래 이름으로 되돌린다.
        run.title = (cleaned[:MAX_TITLE_CHARS] or default_title(run.prompt))
        store.save_meta(run_id, run.record())
        return run

    async def delete_run(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if run is None:
            return False
        # 도는 중인 것을 목록에서만 지우면 프로세스는 남아 계속 서버를 건드린다. 먼저 멈춘다.
        if run.status == "running":
            await self.stop_run(run_id)
        task = self._tasks.pop(run_id, None)
        if task and not task.done():
            task.cancel()
        # 구독 중인 WebSocket은 sentinel을 받아야 스스로 닫는다.
        for queue in list(run.subscribers):
            queue.put_nowait(None)
        self.runs.pop(run_id, None)
        store.remove(run_id)
        return True

    async def stop_run(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if run is None or run.process is None or run.status != "running":
            return False
        run.process.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(run.process.wait), timeout=5)
        except asyncio.TimeoutError:
            run.process.kill()
        return True

    def subscribe(self, run_id: str) -> Optional[asyncio.Queue]:
        run = self.runs.get(run_id)
        if run is None:
            return None
        self.load_events(run)
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
