"""input/{project}/ 입력 자료를 훑어 실행 대상 프로젝트 목록을 만든다.

architecture-agent가 단일 files/ 입력에서 input/{project}/{doc,img} 구조로 바뀌면서
한 작업 공간이 여러 프로젝트를 동시에 다룬다(chess / asset-management / axra ...).
게다가 CLAUDE.md의 Input File Management Rules는 프로젝트가 명시되지 않으면
에이전트가 자동 선택하지 말고 사용자에게 되묻도록 규정한다. 이 UI는 비대화형
(claude -p)으로 실행하므로 되묻는 순간 run이 아무 일도 못 하고 끝난다.
그래서 실행 전에 UI에서 프로젝트를 고르고 프롬프트에 실어 보낸다.
"""

import re
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException

# {project} 토큰은 input·output·report 전 구간에서 같은 이름을 쓴다(CLAUDE.md).
# 이름을 바꾸거나 지울 때 이 셋을 함께 다뤄야 산출물이 미아가 되지 않는다.
SIBLING_ROOTS = ("input", "output", "report")

# 경로 조각으로 쓰이는 이름이라 구분자·상위 이동·숨김을 모두 막는다.
NAME_RE = re.compile(r"^[0-9A-Za-z가-힣][0-9A-Za-z가-힣 _-]{0,63}$")


def list_projects(agent_dir: Path) -> list[dict]:
    root = agent_dir / "input"
    if not root.is_dir():
        return []

    projects = []
    for path in sorted(root.iterdir()):
        if not path.is_dir() or path.name.startswith("."):
            continue

        doc_dir = path / "doc"
        docs = (
            sorted(p.name for p in doc_dir.iterdir() if p.is_file() and not p.name.startswith("."))
            if doc_dir.is_dir()
            else []
        )

        img_dir = path / "img"
        # img/{doc_id}/page_NNN.png — 변환된 문서 단위로 디렉토리가 하나씩 생긴다.
        image_docs = (
            sorted(p.name for p in img_dir.iterdir() if p.is_dir() and not p.name.startswith("."))
            if img_dir.is_dir()
            else []
        )

        # doc/img 어느 쪽도 없으면 입력 프로젝트가 아니라 다른 용도의 디렉토리로 본다.
        if not docs and not image_docs:
            continue

        projects.append({"key": path.name, "docs": docs, "image_docs": image_docs})
    return projects


def project_exists(agent_dir: Path, project: str) -> bool:
    return any(p["key"] == project for p in list_projects(agent_dir))


def check_name(raw: str) -> str:
    name = (raw or "").strip()
    if not name:
        raise HTTPException(400, "프로젝트 이름을 입력하세요")
    if not NAME_RE.match(name):
        raise HTTPException(
            400,
            "이름에는 한글·영문·숫자와 - _ 공백만 쓸 수 있고, 64자를 넘을 수 없습니다",
        )
    return name


def create_project(agent_dir: Path, raw_name: str) -> dict:
    """input/{project}/{doc,img} 를 만든다. output·report는 에이전트가 산출할 때 생긴다."""
    name = check_name(raw_name)
    target = agent_dir / "input" / name
    if target.exists():
        raise HTTPException(409, f"이미 있는 프로젝트입니다: {name}")

    (target / "doc").mkdir(parents=True)
    (target / "img").mkdir()
    return {"name": name, "created": [f"input/{name}/doc", f"input/{name}/img"]}


def rename_project(agent_dir: Path, raw_old: str, raw_new: str) -> dict:
    """input·output·report의 같은 이름을 함께 옮긴다."""
    old = check_name(raw_old)
    new = check_name(raw_new)
    if old == new:
        return {"name": new, "moved": []}

    sources = [(root, agent_dir / root / old) for root in SIBLING_ROOTS]
    if not any(path.is_dir() for _, path in sources):
        raise HTTPException(404, f"없는 프로젝트입니다: {old}")

    # 하나라도 충돌하면 손대지 않는다 — 절반만 바뀐 상태가 가장 나쁘다.
    for root, source in sources:
        if source.is_dir() and (agent_dir / root / new).exists():
            raise HTTPException(409, f"이미 있습니다: {root}/{new}")

    moved = []
    for root, source in sources:
        if not source.is_dir():
            continue
        source.rename(agent_dir / root / new)
        moved.append(f"{root}/{old} -> {root}/{new}")
    return {"name": new, "moved": moved}


def delete_project(agent_dir: Path, raw_name: str, stamp: str | None = None) -> dict:
    """지우지 않고 temp/trash 로 옮긴다.

    여기 들어 있는 것은 고객 요건 문서 원본과 설계 산출물이다. 잘못 누른 한 번으로
    복구할 수 없게 만들지 않는다. 실제로 비우는 일은 사람이 temp/trash에서 한다.
    """
    name = check_name(raw_name)
    sources = [(root, agent_dir / root / name) for root in SIBLING_ROOTS]
    if not any(path.is_dir() for _, path in sources):
        raise HTTPException(404, f"없는 프로젝트입니다: {name}")

    stamp = stamp or datetime.now().strftime("%Y%m%d-%H%M%S")
    trash = agent_dir / "temp" / "trash" / f"{name}-{stamp}"
    trash.mkdir(parents=True, exist_ok=True)

    moved = []
    for root, source in sources:
        if not source.is_dir():
            continue
        shutil.move(str(source), str(trash / root))
        moved.append(f"{root}/{name}")
    return {"name": name, "moved": moved, "trash": str(trash.relative_to(agent_dir))}
