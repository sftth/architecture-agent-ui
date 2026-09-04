"""Scouter APM 값을 백엔드가 직접 읽는다 — agent 를 거치지 않는다.

배경 — 로그 점검(middleware-status)은 사람이 「지금 점검」을 눌러 agent 가 한 번 도는 일이라
토큰이 들어도 된다. 그런데 APM 수치는 30초마다 새로 봐야 하는 값이다. 그것을 agent 로
읽으면 화면을 켜 둔 만큼 토큰이 흘러나간다. 그래서 여기는 **프로그램**이 읽는다.

어떻게 닿는가 — 백엔드 옆에 Scouter webapp 을 자식 프로세스로 띄운다(scouter_webapp.py).
webapp 은 Desktop Client 와 같은 6100 프로토콜로 Collector 에 로그인하는 공식 클라이언트고,
이 백엔드는 그것이 127.0.0.1 에 낸 REST 를 읽는다. 서버에는 아무것도 새로 놓지 않고,
보안그룹도 그대로다 — 6100 은 Desktop Client 용으로 이미 열려 있다.

어디서 값을 얻는가 — Collector 주소·포트는 `output/{project}/confirmed/infra_confirmed.json`
의 `monitoring_targets.scouter` 에 planner 가 적어 둔 것이고, 로그인 계정은 사용자가 화면에서
넣어 둔 것이다. 여기 없는 값을 지어내지 않는다.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel

from . import scouter_webapp as webapp

# 화면에 보일 카운터. 이름은 Scouter counters.xml 의 name 그대로다(대소문자 포함).
JAVA_COUNTERS = ["TPS", "ActiveService", "ElapsedTime", "ErrorRate", "HeapUsed", "HeapTotal",
                 "GcCount", "GcTime", "ProcCpu"]
HOST_COUNTERS = ["Cpu", "Mem", "Swap", "NetRxBytes", "NetTxBytes"]

# webapp 에 묻는 objType. Java Agent 는 Tomcat 에 붙었으니 tomcat, Host Agent 는 linux.
JAVA_TYPES = ["tomcat", "java"]
HOST_TYPES = ["linux", "host"]


class ApmObject(BaseModel):
    obj_hash: int
    obj_name: str
    obj_type: str
    address: Optional[str] = None
    alive: bool = True
    # counterName -> 값. 그 객체에 없는 카운터는 키가 없다.
    counters: Dict[str, float] = {}


class ApmCollector(BaseModel):
    hostname: str
    ip: str
    tcp_port: int
    scouter_home: Optional[str] = None
    # /info/server 가 준 값(연결됐을 때만).
    server_name: Optional[str] = None
    version: Optional[str] = None


class ApmSidecar(BaseModel):
    running: bool
    pid: Optional[int] = None
    started_at: Optional[str] = None
    port: int
    java: str
    last_error: Optional[str] = None


class ApmSnapshot(BaseModel):
    """한 번 읽은 결과. ok 가 아니면 stage 가 어디서 막혔는지 말한다."""

    ok: bool
    # not_configured | no_account | starting | webapp_down | collector_unreachable | ok
    stage: str
    note: Optional[str] = None
    checked_at: str
    collector: Optional[ApmCollector] = None
    # 지금 저장된 Collector 로그인 id(비밀번호는 오지 않는다). 없으면 null.
    account_id: Optional[str] = None
    sidecar: Optional[ApmSidecar] = None
    objects: List[ApmObject] = []


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _str(v) -> Optional[str]:
    return v if isinstance(v, str) and v.strip() else None


def load_collector(agent_dir: str, project: str) -> Tuple[Optional[ApmCollector], Optional[str]]:
    """infra_confirmed.json 에서 Collector 주소를 읽는다. 돌려주는 것: (collector, 못 읽은 이유)."""
    path = Path(agent_dir) / "output" / project / "confirmed" / "infra_confirmed.json"
    if not path.is_file():
        return None, f"확정값 파일이 없습니다: output/{project}/confirmed/infra_confirmed.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"infra_confirmed.json 을 읽지 못했습니다: {exc}"

    scouter = ((raw.get("monitoring_targets") or {}).get("scouter")) or {}
    if not scouter:
        return None, "infra_confirmed.json 에 monitoring_targets.scouter 가 없습니다 — Scouter 설치 계획(@monitoring-plan)이 먼저입니다"
    common = scouter.get("common") or {}
    nodes = [n for n in (scouter.get("nodes") or []) if isinstance(n, dict)]
    node = next((n for n in nodes if n.get("install_collector")), None)
    if node is None:
        return None, "Collector 노드(install_collector=true)가 확정값에 없습니다"
    # 이 백엔드는 VPC 밖에 있으니 공인 IP 로 간다 — Desktop Client 가 쓰는 주소와 같다.
    ip = _str(node.get("ip")) or _str(common.get("collector_ip"))
    if not ip:
        return None, "Collector 노드의 ip 가 없습니다"
    port = common.get("tcp_port")
    return ApmCollector(
        hostname=_str(node.get("hostname")) or ip,
        ip=ip,
        tcp_port=int(port) if isinstance(port, (int, float)) else 6100,
        scouter_home=_str(common.get("scouter_home")),
    ), None


def _sidecar_info() -> ApmSidecar:
    return ApmSidecar(**webapp.sidecar.info())


# webapp 은 숫자를 문자열로 준다 — "objHash": "-644648111", "value": "0.36945814",
# "resultCode": "0". 실측으로 확인한 모양이라 여기서 너그럽게 받는다.
def _int(v) -> Optional[int]:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _float(v) -> Optional[float]:
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def _ok_code(env) -> bool:
    return isinstance(env, dict) and str(env.get("resultCode", "")).strip() in ("0", "")


def fetch_snapshot(agent_dir: str, project: str, user_id: str) -> ApmSnapshot:
    collector, why = load_collector(agent_dir, project)
    if collector is None:
        return ApmSnapshot(ok=False, stage="not_configured", note=why, checked_at=_now(), sidecar=_sidecar_info())

    account = webapp.get_account(user_id, project)
    if account is None:
        return ApmSnapshot(
            ok=False, stage="no_account",
            note="Collector 로그인 계정이 없습니다 — Desktop Client 로 쓰는 id·비밀번호를 넣어 주세요",
            checked_at=_now(), collector=collector, sidecar=_sidecar_info(),
        )
    login_id, password = account

    stage, note = webapp.sidecar.ensure(collector.ip, collector.tcp_port, login_id, password)
    if stage != "ok":
        return ApmSnapshot(
            ok=False, stage=stage, note=note, checked_at=_now(), collector=collector,
            account_id=login_id, sidecar=_sidecar_info(),
        )
    webapp.sidecar.touch()

    # /info/server — webapp 이 Collector 에 실제로 붙었는가. 계정이 틀리면 여기서 드러난다.
    status, info = webapp.http_get("/info/server")
    servers = (info or {}).get("result") if isinstance(info, dict) else None
    if status != 200 or not _ok_code(info) or not isinstance(servers, list) or not servers:
        msg = (info or {}).get("message") if isinstance(info, dict) else None
        return ApmSnapshot(
            ok=False, stage="collector_unreachable",
            note=f"webapp 이 Collector({collector.ip}:{collector.tcp_port})에 붙지 못했습니다"
                 + (f" — {msg}" if msg else " — 계정·비밀번호 또는 6100 도달을 확인하세요"),
            checked_at=_now(), collector=collector, account_id=login_id, sidecar=_sidecar_info(),
        )
    first = servers[0] if isinstance(servers[0], dict) else {}
    collector.server_name = _str(first.get("name")) or _str(str(first.get("id") or "")) or None
    collector.version = _str(first.get("version"))

    objects: Dict[int, ApmObject] = {}
    _status, env = webapp.http_get("/object")
    for item in (env or {}).get("result") or []:
        if not isinstance(item, dict):
            continue
        h = _int(item.get("objHash"))
        if h is None:
            continue
        alive = item.get("alive", True)
        objects[h] = ApmObject(
            obj_hash=h,
            obj_name=str(item.get("objName") or h),
            obj_type=str(item.get("objType") or ""),
            address=_str(item.get("address")),
            alive=(alive is True or str(alive).lower() == "true"),
        )

    def pull(counters: List[str], types: List[str]) -> None:
        for t in types:
            _s, env2 = webapp.http_get(f"/counter/realTime/{','.join(counters)}/ofType/{t}")
            for item in (env2 or {}).get("result") or []:
                if not isinstance(item, dict):
                    continue
                h = _int(item.get("objHash"))
                # 카운터 이름 키는 실측상 "name" 이다(문서의 counterName 과 다르다). 둘 다 받는다.
                name = item.get("name") or item.get("counterName") or item.get("counter")
                value = _float(item.get("value"))
                if h is None or not isinstance(name, str) or value is None:
                    continue
                target = objects.get(h)
                if target is None:
                    target = objects[h] = ApmObject(obj_hash=h, obj_name=str(item.get("objName") or h), obj_type=t)
                target.counters[name] = value

    pull(JAVA_COUNTERS, JAVA_TYPES)
    pull(HOST_COUNTERS, HOST_TYPES)

    return ApmSnapshot(
        ok=True, stage="ok", checked_at=_now(), collector=collector, account_id=login_id,
        sidecar=_sidecar_info(),
        objects=sorted(objects.values(), key=lambda o: (o.obj_type, o.obj_name)),
    )


# ---------------------------------------------------------------- 마지막 값

import threading  # noqa: E402

_lock = threading.Lock()
_last: Dict[Tuple[str, str], ApmSnapshot] = {}


def remember(user_id: str, project: str, snap: ApmSnapshot) -> None:
    with _lock:
        _last[(user_id, project)] = snap


def last(user_id: str, project: str) -> Optional[ApmSnapshot]:
    with _lock:
        return _last.get((user_id, project))
