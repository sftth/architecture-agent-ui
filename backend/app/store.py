"""실행 기록을 디스크에 남긴다.

전에는 RunManager 의 dict 에만 있었다. 백엔드가 한 번 뜨고 내리는 사이의 기록이라,
--reload 가 한 번 돌거나 사람이 Ctrl+C 를 누르면 세션 목록도 이름도 로그도 통째로
사라졌다. 화면은 "세션"이라 부르면서 실제로는 프로세스 수명을 넘기지 못했다.

저장 자리는 backend/runs/ 다. 이 디렉터리는 최초 커밋부터 .gitkeep 만 들고 비어 있었는데,
참조하는 코드가 한 줄도 없었다 — 자리만 잡아 두고 배선을 안 한 것이라 여기에 채운다.

한 run 이 디렉터리 하나다:
    runs/{run_id}/meta.json      요약(제목·상태·프로젝트·모델·토큰/비용). 바뀔 때마다 덮어쓴다.
    runs/{run_id}/events.jsonl   로그. 한 줄에 이벤트 하나, 끝에 붙이기만 한다.

meta 와 events 를 나눈 이유는 쓰는 방식이 다르기 때문이다. 요약은 작고 자주 갱신되니
통째로 덮어쓰는 편이 간단하고, 로그는 수천 줄까지 늘어나므로 붙이기만 해야 한다.
목록 화면은 meta 만 읽으면 되므로, 세션 서랍을 열 때 로그를 통째로 읽는 일도 없다.
"""

import json
import logging
import shutil
from pathlib import Path
from typing import Iterator, Optional

from .config import RUNS_DIR
from .models import LogEvent

logger = logging.getLogger(__name__)


def _dir(run_id: str) -> Path:
    return RUNS_DIR / run_id


def save_meta(run_id: str, meta: dict) -> None:
    """요약을 덮어쓴다. 임시 파일에 쓰고 갈아끼워, 쓰다 죽어도 반쪽 파일이 남지 않게 한다."""
    target = _dir(run_id)
    try:
        target.mkdir(parents=True, exist_ok=True)
        tmp = target / "meta.json.tmp"
        tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(target / "meta.json")
    except OSError as exc:
        # 기록을 못 남기는 것이 실행을 막을 이유는 안 된다 — 남기고 계속 간다.
        logger.warning("run %s 요약 저장 실패: %s", run_id, exc)


def open_log(run_id: str):
    """이벤트를 붙여 쓸 파일을 연다. run 이 끝날 때까지 열어 둔다 —
    이벤트마다 열고 닫으면 수천 번 여닫게 된다."""
    try:
        _dir(run_id).mkdir(parents=True, exist_ok=True)
        return (_dir(run_id) / "events.jsonl").open("a", encoding="utf-8")
    except OSError as exc:
        logger.warning("run %s 로그 열기 실패: %s", run_id, exc)
        return None


def append_event(handle, event: LogEvent) -> None:
    if handle is None:
        return
    try:
        handle.write(event.model_dump_json() + "\n")
        handle.flush()
    except (OSError, ValueError) as exc:
        logger.warning("이벤트 기록 실패: %s", exc)


def load_metas() -> Iterator[dict]:
    """저장된 모든 요약. 깨진 파일 하나가 목록 전체를 막지 않도록 건별로 건너뛴다."""
    if not RUNS_DIR.exists():
        return
    for path in sorted(RUNS_DIR.iterdir()):
        meta = path / "meta.json"
        if not meta.is_file():
            continue
        try:
            yield json.loads(meta.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("%s 를 읽지 못해 건너뜁니다: %s", meta, exc)


def load_events(run_id: str) -> list[LogEvent]:
    """그 run 의 로그. 목록에는 필요 없고 실제로 열어 볼 때만 읽는다."""
    path = _dir(run_id) / "events.jsonl"
    if not path.is_file():
        return []
    events: list[LogEvent] = []
    try:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(LogEvent.model_validate_json(line))
                except ValueError:
                    # 쓰다 죽어 잘린 마지막 줄일 수 있다. 거기까지만 읽는다.
                    break
    except OSError as exc:
        logger.warning("run %s 로그 읽기 실패: %s", run_id, exc)
    return events


def remove(run_id: str) -> None:
    try:
        shutil.rmtree(_dir(run_id), ignore_errors=True)
    except OSError as exc:
        logger.warning("run %s 삭제 실패: %s", run_id, exc)


def last_seq(events: list[LogEvent]) -> Optional[int]:
    return events[-1].seq if events else None
