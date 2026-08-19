"""architecture-agent의 .claude/agents/**/*.md frontmatter를 직접 읽어 카탈로그를 구성한다.

README.md의 Sub-agents 표는 실제 등록된 agent 이름과 어긋나 있었다(예: README의
`design-implementer`는 실제로는 `design-impl`). 문서가 프로젝트 변경을 못 따라가는 문제를
피하기 위해, 이 파일은 하드코딩된 목록 대신 항상 .claude/agents/ 원본에서 직접 읽는다.

사용자마다 architecture-agent를 clone해둔 경로가 다르므로, 카탈로그는 모듈 로드 시
한 번 계산하는 전역 값이 아니라 요청마다 agent_dir을 받아 그 자리에서 계산한다.
"""

import logging
import re
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?\n)---\s*\n", re.DOTALL)

# frontmatter는 중첩 없는 flat 매핑이므로, 들여쓰기 없는 `key: value` 줄만 새 키로 본다.
LOOSE_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$")

MUTATING_TOOLS = {"Bash", "Write"}

# 도메인 폴더 -> (표시 순서, 한글 타이틀, 부제). 실제 파이프라인 의존 순서를 따른다
# (예: infra-account-impl은 middleware 설치보다 먼저 실행되어야 함).
STAGE_META = {
    "intent": (0, "분석", "input/{project} 문서 -> spec_requirements.md (convert -> impl -> eval)"),
    "design": (2, "설계", "LLM Wiki 지식 기반 설계서 생성 + 평가 (합격 90점)"),
    "infra": (3, "인프라 기반", "OS 계정 / Docker / OpenSSL 등 설치 전 준비 작업"),
    "middleware": (4, "미들웨어", "Apache / Tomcat / Nginx"),
    "cicd": (5, "CI/CD", "GitLab / Jenkins / Nexus / SonarQube / Argo CD"),
    "db": (6, "데이터베이스", "Kubernetes OSS DB / MSSQL(Windows)"),
    "backing": (7, "Backing Service", "Redis 설치 / Tomcat 세션 연동 / RedisInsight"),
    "k8s": (8, "Kubernetes", "Helm chart 생성 / 클러스터 관리"),
    "monitoring": (9, "모니터링", "Prometheus / Grafana / Scouter APM"),
    "common": (10, "공통 유틸리티", "LLM Wiki 조회 / md -> docx·HTML 산출물 변환"),
}


def _domain_for_path(agents_root: Path, path: Path) -> str:
    parts = path.relative_to(agents_root).parts
    if parts[0] != "implement":
        return parts[0]
    rest = parts[1:]
    if rest[0] == "infra":
        return "infra"
    # implement/swa/{cicd,db,k8s,middleware,monitoring,redis}/...
    domain = rest[1]
    return "backing" if domain == "redis" else domain


def _loose_frontmatter(block: str) -> dict:
    """YAML 파서가 거부한 frontmatter를 줄 단위로 최대한 복원한다.

    실제 .claude/agents 중에는 description 값에 `(harness: plan->impl->eval)`처럼
    따옴표 없는 콜론+공백이 들어가 yaml.safe_load가 실패하는 파일이 있다(intent-plan).
    이걸 그냥 버리면 sub-agent 하나가 화면에서 통째로 사라지므로, 중첩 없는 flat
    매핑이라는 점을 이용해 `key: value` 줄만 그대로 읽어들인다.
    """
    meta: dict = {}
    key: Optional[str] = None
    for line in block.splitlines():
        match = LOOSE_KEY_RE.match(line)
        if match:
            key = match.group(1)
            meta[key] = match.group(2).strip().strip("\"'")
        elif key and line.strip():
            # 여러 줄에 걸친 값은 한 줄로 이어붙인다.
            meta[key] = f"{meta[key]} {line.strip()}".strip()
    # `tools: [Bash, Write]` 형태도 콤마 분리로 넘길 수 있게 대괄호를 벗긴다.
    # (안 벗기면 "[Bash"로 읽혀 mutating 판정이 조용히 빠진다.)
    if isinstance(meta.get("tools"), str):
        meta["tools"] = meta["tools"].strip().strip("[]")
    return meta


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
    except yaml.YAMLError as exc:
        # 카탈로그는 요청마다 다시 만들어지므로 warning으로 두면 매 요청 같은 로그가 쌓인다.
        # 복원에 성공하면 debug, 이름조차 못 건지면(=화면에서 사라짐) 그때 warning.
        meta = _loose_frontmatter(match.group(1))
        level = logging.DEBUG if meta.get("name") else logging.WARNING
        logger.log(level, "%s: frontmatter YAML 파싱 실패 (%s)", path, str(exc).splitlines()[0])
    if not isinstance(meta, dict):
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


def build_stages(agent_dir: Path) -> list:
    agents_root = agent_dir / ".claude" / "agents"
    if not agents_root.exists():
        return []

    by_domain: dict[str, list] = {}
    for path in sorted(agents_root.rglob("*.md")):
        agent = _parse_agent_file(path)
        if agent is None:
            continue
        domain = _domain_for_path(agents_root, path)
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


def find_agent(agent_dir: Path, agent_key: str):
    for stage in build_stages(agent_dir):
        for agent in stage["agents"]:
            if agent["key"] == agent_key:
                return stage, agent
    return None, None
