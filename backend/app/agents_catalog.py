"""architecture-agent의 .claude/agents/**/*.md frontmatter를 직접 읽어 카탈로그를 구성한다.

README.md의 Sub-agents 표는 실제 등록된 agent 이름과 어긋나 있었다(예: README의
`design-implementer`는 실제로는 `design-impl`). 문서가 프로젝트 변경을 못 따라가는 문제를
피하기 위해, 이 파일은 하드코딩된 목록 대신 항상 .claude/agents/ 원본에서 직접 읽는다.
"""

import re
from pathlib import Path
from typing import Optional

import yaml

from .config import ARCHITECTURE_AGENT_DIR

AGENTS_ROOT = ARCHITECTURE_AGENT_DIR / ".claude" / "agents"

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?\n)---\s*\n", re.DOTALL)

MUTATING_TOOLS = {"Bash", "Write"}

# 도메인 폴더 -> (표시 순서, 한글 타이틀, 부제). 실제 파이프라인 의존 순서를 따른다
# (예: infra-account-impl은 middleware 설치보다 먼저 실행되어야 함).
STAGE_META = {
    "intent": (0, "분석", "요구사항 -> spec_requirements.md (plan -> impl -> eval)"),
    "standard": (1, "표준 데이터", "standarddb 표준 후보 조사/모델링/등록 (2단계 휴먼 승인)"),
    "design": (2, "설계", "standarddb 기반 설계서 생성 + 평가 (합격 90점)"),
    "infra": (3, "인프라 기반", "OS 계정 / Docker / OpenSSL 등 설치 전 준비 작업"),
    "middleware": (4, "미들웨어", "Apache / Tomcat / Nginx"),
    "cicd": (5, "CI/CD", "GitLab / Jenkins / Nexus / SonarQube / Argo CD"),
    "db": (6, "데이터베이스", "Kubernetes OSS DB / MSSQL(Windows)"),
    "backing": (7, "Backing Service", "Redis 설치 / Tomcat 세션 연동 / RedisInsight"),
    "k8s": (8, "Kubernetes", "Helm chart 생성 / 클러스터 관리"),
    "monitoring": (9, "모니터링", "Prometheus / Grafana / Scouter APM"),
    "common": (10, "공통 유틸리티", "ArcadeDB CRUD / 문서·보고서 변환 / LLM Wiki"),
}


def _domain_for_path(path: Path) -> str:
    parts = path.relative_to(AGENTS_ROOT).parts
    if parts[0] != "implement":
        return parts[0]
    rest = parts[1:]
    if rest[0] == "infra":
        return "infra"
    # implement/swa/{cicd,db,k8s,middleware,monitoring,redis}/...
    domain = rest[1]
    return "backing" if domain == "redis" else domain


def _parse_agent_file(path: Path) -> Optional[dict]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = FRONTMATTER_RE.match(text)
    if not match:
        return None
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return None

    name = meta.get("name")
    if not name:
        return None

    tools_raw = meta.get("tools", "")
    if isinstance(tools_raw, list):
        tool_names = [str(t).strip() for t in tools_raw]
    else:
        tool_names = [t.strip() for t in str(tools_raw).split(",") if t.strip()]

    description = str(meta.get("description", "")).strip()

    return {
        "key": str(name).strip(),
        "description": description,
        "tools": tool_names,
        "mutating": any(t in MUTATING_TOOLS for t in tool_names),
    }


def _build_stages() -> list:
    if not AGENTS_ROOT.exists():
        return []

    by_domain: dict[str, list] = {}
    for path in sorted(AGENTS_ROOT.rglob("*.md")):
        agent = _parse_agent_file(path)
        if agent is None:
            continue
        domain = _domain_for_path(path)
        by_domain.setdefault(domain, []).append(agent)

    stages = []
    for key, (order, title, subtitle) in sorted(STAGE_META.items(), key=lambda kv: kv[1][0]):
        agents = by_domain.get(key)
        if not agents:
            continue
        agents.sort(key=lambda a: a["key"])
        stages.append(
            {
                "key": key,
                "title": title,
                "subtitle": subtitle,
                "agents": [
                    {
                        "key": a["key"],
                        "label": a["key"],
                        "role": a["description"],
                        "mutating": a["mutating"],
                        "tools": a["tools"],
                    }
                    for a in agents
                ],
            }
        )

    # 도메인 폴더 구조상 STAGE_META에 없는 domain이 나타나면(향후 신규 카테고리) 맨 뒤에 추가
    for domain, agents in by_domain.items():
        if domain in STAGE_META:
            continue
        agents.sort(key=lambda a: a["key"])
        stages.append(
            {
                "key": domain,
                "title": domain,
                "subtitle": "",
                "agents": [
                    {
                        "key": a["key"],
                        "label": a["key"],
                        "role": a["description"],
                        "mutating": a["mutating"],
                        "tools": a["tools"],
                    }
                    for a in agents
                ],
            }
        )
    return stages


STAGES = _build_stages()


def find_agent(agent_key: str):
    for stage in STAGES:
        for agent in stage["agents"]:
            if agent["key"] == agent_key:
                return stage, agent
    return None, None
