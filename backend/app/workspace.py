"""architecture-agent 작업 공간의 input/output 파일을 읽기 전용으로 들여다본다.

에이전트가 무엇을 받아 무엇을 냈는지 화면에서 확인할 수 없으면, 실행 로그만 보고
"됐다더라"를 믿는 수밖에 없다. 그래서 단계별 입력·산출물 경로를 그대로 열어 준다.

읽기 전용이다. 쓰기·삭제·이동은 제공하지 않는다.
"""

from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

# 이 세 뿌리 밖은 보여 주지 않는다(.claude, .git, 소스 코드 등이 새 나가지 않도록).
ALLOWED_ROOTS = ("input", "output", "report")

MAX_PREVIEW_BYTES = 256 * 1024

TEXT_SUFFIXES = {
    ".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".log",
    ".sh", ".ps1", ".py", ".rego", ".ini", ".conf", ".html", ".xml",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def _kind(path: Path) -> str:
    if path.is_dir():
        return "dir"
    suffix = path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return "text"
    if suffix in IMAGE_SUFFIXES:
        return "image"
    return "binary"


def safe_path(agent_dir: Path, rel: str) -> Path:
    """상대 경로를 작업 공간 안의 실제 경로로 바꾼다. 밖으로 나가면 거부한다."""
    cleaned = (rel or "").strip().strip("/")
    if not cleaned:
        raise HTTPException(400, "경로가 비어 있습니다")

    root = cleaned.split("/", 1)[0]
    if root not in ALLOWED_ROOTS:
        raise HTTPException(403, f"열람할 수 없는 경로입니다: {cleaned}")

    base = agent_dir.resolve()
    # resolve()로 ../ 와 심볼릭 링크를 모두 편 뒤 작업 공간 안인지 확인한다.
    target = (base / cleaned).resolve()
    if target != base and base not in target.parents:
        raise HTTPException(403, f"작업 공간을 벗어난 경로입니다: {cleaned}")
    return target


def _entry(base: Path, path: Path) -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path.relative_to(base)),
        "kind": _kind(path),
        "size": None if path.is_dir() else stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def list_dir(agent_dir: Path, rel: str) -> dict:
    base = agent_dir.resolve()
    target = safe_path(agent_dir, rel)

    if not target.exists():
        # 아직 안 만들어진 산출물 경로는 오류가 아니라 "빈 상태"다.
        return {"path": rel.strip("/"), "exists": False, "entries": []}
    if not target.is_dir():
        raise HTTPException(400, "디렉토리가 아닙니다")

    entries = []
    for child in target.iterdir():
        if child.name.startswith("."):
            continue
        try:
            entries.append(_entry(base, child))
        except OSError:
            continue
    # 디렉토리 먼저, 그 다음 이름순
    entries.sort(key=lambda e: (e["kind"] != "dir", e["name"].lower()))
    return {"path": str(target.relative_to(base)), "exists": True, "entries": entries}


def read_text(agent_dir: Path, rel: str) -> dict:
    target = safe_path(agent_dir, rel)
    if not target.is_file():
        raise HTTPException(404, "파일을 찾을 수 없습니다")

    size = target.stat().st_size
    kind = _kind(target)
    if kind == "image":
        raise HTTPException(400, "이미지는 raw로 받아야 합니다")

    data = target.read_bytes()[:MAX_PREVIEW_BYTES]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        # docx/pptx 처럼 열어 봐야 소용없는 파일은 미리보기 대신 그렇다고 알린다.
        return {"path": rel, "kind": "binary", "size": size, "text": None, "truncated": False}
    return {
        "path": rel,
        "kind": "text",
        "size": size,
        "text": text,
        "truncated": size > MAX_PREVIEW_BYTES,
    }
