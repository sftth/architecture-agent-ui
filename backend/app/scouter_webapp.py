"""Scouter webapp 사이드카 — 백엔드가 Desktop Client 노릇을 하기 위한 자식 프로세스.

6100 은 Scouter 고유의 이진 프로토콜이라 Python 구현체가 없다. Scouter 가 배포하는
webapp 은 그 프로토콜로 Collector 에 로그인해 값을 받아 REST 로 내주는 공식 클라이언트다.
그것을 이 백엔드 옆에 띄우고 127.0.0.1 로만 읽는다 — `claude` CLI 를 자식 프로세스로
띄우는 것과 같은 방식이다.

수명 — 화면이 읽기를 걸 때 없으면 띄우고(ensure), 한동안 아무도 읽지 않으면 내린다(reap).
백엔드가 내려갈 때도 함께 내린다. 프로세스는 백엔드 하나에 하나다: Collector 가 여럿인
경우(프로젝트마다 다른 Collector)는 대상이 바뀔 때 갈아 띄운다.

계정 — Collector 로그인 id·비밀번호. 사용자·프로젝트마다 저장하고 webapp conf 에만 풀어
쓴다. 파일은 0600, 화면에는 id 와 "설정됨" 만 돌려준다.
"""

import json
import os
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple

from .config import (
    SCOUTER_ACCOUNTS_PATH,
    SCOUTER_IDLE_STOP_SEC,
    SCOUTER_JAVA,
    SCOUTER_WEBAPP_DIR,
    SCOUTER_WEBAPP_PORT,
)

# ---------------------------------------------------------------- 계정

_acct_lock = threading.Lock()


def _read_accounts() -> dict:
    path = SCOUTER_ACCOUNTS_PATH
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_accounts(data: dict) -> None:
    path = SCOUTER_ACCOUNTS_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def get_account(user_id: str, project: str) -> Optional[Tuple[str, str]]:
    with _acct_lock:
        raw = (_read_accounts().get(user_id) or {}).get(project)
    if not isinstance(raw, dict):
        return None
    uid, pw = raw.get("id"), raw.get("password")
    return (uid, pw) if isinstance(uid, str) and isinstance(pw, str) and uid and pw else None


def set_account(user_id: str, project: str, login_id: str, password: str) -> None:
    login_id = login_id.strip()
    if not login_id or not password:
        raise ValueError("Collector 계정 id 와 비밀번호를 모두 적어 주세요")
    with _acct_lock:
        data = _read_accounts()
        data.setdefault(user_id, {})[project] = {
            "id": login_id, "password": password,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        _write_accounts(data)


def clear_account(user_id: str, project: str) -> None:
    with _acct_lock:
        data = _read_accounts()
        (data.get(user_id) or {}).pop(project, None)
        _write_accounts(data)


# ---------------------------------------------------------------- 사이드카


def _java() -> str:
    if SCOUTER_JAVA:
        return SCOUTER_JAVA
    home = os.environ.get("JAVA_HOME")
    if home:
        exe = Path(home) / "bin" / ("java.exe" if os.name == "nt" else "java")
        if exe.exists():
            return str(exe)
    return shutil.which("java") or "java"


def base_url() -> str:
    return f"http://127.0.0.1:{SCOUTER_WEBAPP_PORT}/scouter/v1"


def http_get(path: str, timeout: float = 6.0):
    """webapp REST 한 번. (status, json|None). 연결 자체가 안 되면 (0, None)."""
    try:
        with urllib.request.urlopen(f"{base_url()}{path}", timeout=timeout) as res:
            body = res.read().decode("utf-8", errors="replace")
            try:
                return res.status, json.loads(body)
            except json.JSONDecodeError:
                return res.status, None
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (urllib.error.URLError, OSError, ValueError):
        return 0, None


class Sidecar:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.process: Optional[subprocess.Popen] = None
        # 지금 붙어 있는 대상 — (collector_ip, tcp_port, login_id). 바뀌면 갈아 띄운다.
        self.target: Optional[Tuple[str, int, str]] = None
        self.started_at: Optional[str] = None
        self.last_used: float = 0.0
        self.last_error: Optional[str] = None
        self._reaper = threading.Thread(target=self._reap_loop, name="scouter-webapp-reaper", daemon=True)
        self._reaper.start()

    # ── 상태 ──
    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def info(self) -> dict:
        return {
            "running": self.running(),
            "pid": self.process.pid if self.running() else None,
            "started_at": self.started_at if self.running() else None,
            "port": SCOUTER_WEBAPP_PORT,
            "webapp_dir": str(SCOUTER_WEBAPP_DIR),
            "java": _java(),
            "last_error": self.last_error,
        }

    def touch(self) -> None:
        self.last_used = time.monotonic()

    # ── 준비 ──
    def available(self) -> Optional[str]:
        """띄울 수 있는가. 못 띄우면 그 이유."""
        jar = SCOUTER_WEBAPP_DIR / "scouter.webapp.jar"
        if not jar.is_file():
            return (
                f"webapp 배포본이 없습니다: {jar} — Scouter 배포본의 webapp/ 디렉터리를 "
                "backend/vendor/scouter-webapp 에 두거나 SCOUTER_WEBAPP_DIR 로 지정하세요"
            )
        if not (SCOUTER_WEBAPP_DIR / "lib").is_dir():
            return f"webapp lib/ 가 없습니다: {SCOUTER_WEBAPP_DIR / 'lib'}"
        java = _java()
        if not (Path(java).is_file() or shutil.which(java)):
            return f"java 를 찾지 못했습니다: {java} — JDK 8 이상을 두고 SCOUTER_JAVA 또는 JAVA_HOME 을 지정하세요"
        return None

    def _write_conf(self, collector_ip: str, tcp_port: int, login_id: str, password: str) -> None:
        conf_dir = SCOUTER_WEBAPP_DIR / "conf"
        conf_dir.mkdir(parents=True, exist_ok=True)
        (SCOUTER_WEBAPP_DIR / "logs").mkdir(exist_ok=True)
        # webapp 이 읽는 키 그대로(scouterConfSample2.conf). 허용 IP 는 이 기계 안으로만.
        lines = [
            f"net_http_port={SCOUTER_WEBAPP_PORT}",
            f"net_collector_ip_port_id_pws={collector_ip}:{tcp_port}:{login_id}:{password}",
            "net_http_api_auth_ip_enabled=true",
            "net_http_api_allow_ips=127.0.0.1,localhost,::1,0:0:0:0:0:0:0:1",
            "net_http_api_auth_session_enabled=false",
            "net_http_api_auth_bearer_token_enabled=false",
            "net_http_api_swagger_enabled=false",
            "log_dir=./logs",
        ]
        target = conf_dir / "scouter.conf"
        target.write_text("\n".join(lines) + "\n", encoding="utf-8")
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass

    # ── 기동 ──
    def ensure(self, collector_ip: str, tcp_port: int, login_id: str, password: str,
               wait_sec: float = 30.0) -> Tuple[str, Optional[str]]:
        """대상에 맞는 webapp 이 답할 때까지 띄우고 기다린다.
        돌려주는 것: ("ok" | "starting" | "webapp_down" | "not_configured", 메모)."""
        why = self.available()
        if why:
            return "not_configured", why

        want = (collector_ip, tcp_port, login_id)
        with self._lock:
            if self.running() and self.target != want:
                self._stop_locked("대상이 바뀜")
            if not self.running():
                # 우리가 띄운 것은 아닌데 이 포트에서 이미 답하는 webapp 이 있으면 — 백엔드가
                # --reload 로 갈아 뜨는 사이 살아남은 앞 프로세스가 대개 그것이다 — 그대로 읽는다.
                # 새로 띄우면 포트를 못 잡고 죽을 뿐이다. 수명은 못 쥐지만 값은 온다.
                status, _ = http_get("/info/server", timeout=2)
                if status == 200:
                    self.target = want
                    self.touch()
                    return "ok", None
                self._write_conf(collector_ip, tcp_port, login_id, password)
                out = (SCOUTER_WEBAPP_DIR / "logs" / "webapp.out").open("ab")
                cp_sep = ";" if os.name == "nt" else ":"
                # 작은 REST 변환기다 — 기동을 빠르게 하는 쪽으로 JVM 을 잡는다.
                # (실측: 평소 6~7초, 기계가 바쁠 때 100초 넘게 벌어진 적이 있다.)
                argv = [
                    _java(), "-Xmx256m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xshare:auto",
                    "-cp", cp_sep.join(["scouter.webapp.jar", "lib/*", "."]),
                    "scouterx.webapp.main.WebAppMain",
                ]
                try:
                    self.process = subprocess.Popen(
                        argv, cwd=str(SCOUTER_WEBAPP_DIR), stdout=out, stderr=subprocess.STDOUT,
                        stdin=subprocess.DEVNULL,
                    )
                except OSError as exc:
                    self.last_error = f"webapp 을 띄우지 못했습니다: {exc}"
                    return "webapp_down", self.last_error
                self.target = want
                self.started_at = datetime.now(timezone.utc).isoformat()
                self.last_error = None
            self.touch()

        # 답할 때까지. Jetty 가 뜨고 Collector 에 로그인하는 데 몇 초 걸린다.
        deadline = time.monotonic() + wait_sec
        while time.monotonic() < deadline:
            if not self.running():
                self.last_error = f"webapp 이 곧 종료됐습니다 — {self._log_tail()}"
                return "webapp_down", self.last_error
            status, _ = http_get("/info/server", timeout=3)
            if status == 200:
                return "ok", None
            time.sleep(1.0)
        return "starting", "webapp 이 아직 응답하지 않습니다 — 잠시 뒤 다시 읽어 주세요"

    def _log_tail(self, n: int = 6) -> str:
        try:
            lines = (SCOUTER_WEBAPP_DIR / "logs" / "webapp.out").read_text(
                encoding="utf-8", errors="replace"
            ).splitlines()
            # 스택 트레이스보다 원인 줄이 낫다.
            cause = [l for l in lines if "Caused by" in l or "Exception" in l]
            pick = (cause or lines)[-n:]
            return " / ".join(l.strip() for l in pick)[:400]
        except OSError:
            return "(로그 없음)"

    # ── 정지 ──
    def _stop_locked(self, why: str) -> None:
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None
        self.target = None
        self.started_at = None

    def stop(self, why: str = "요청") -> None:
        with self._lock:
            self._stop_locked(why)

    def _reap_loop(self) -> None:
        while True:
            time.sleep(30)
            try:
                if self.running() and self.last_used and time.monotonic() - self.last_used > SCOUTER_IDLE_STOP_SEC:
                    self.stop("한동안 읽지 않음")
            except Exception:  # noqa: BLE001 - 청소 스레드는 죽지 않는다
                pass


sidecar = Sidecar()
