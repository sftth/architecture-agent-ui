"""Fetch current Claude credit limits with a minimal, isolated CLI turn."""

import json
import os
import subprocess
import tempfile
from typing import Optional

from .config import CLAUDE_BIN
from .models import RateLimit
from .rate_limits import parse_rate_limit

def probe_rate_limit(env: dict[str, str]) -> Optional[RateLimit]:
    # No project context, customizations, tools, or saved conversation are needed.
    argv = [
        CLAUDE_BIN, "-p", "Reply only OK.",
        "--output-format", "stream-json", "--verbose",
        "--max-turns", "1", "--no-session-persistence",
        "--safe-mode", "--tools", "", "--strict-mcp-config",
        "--system-prompt", "Reply only OK.",
    ]
    try:
        with tempfile.TemporaryDirectory(prefix="claude-usage-") as cwd:
            proc = subprocess.run(
                argv, env=env, cwd=cwd, stdin=subprocess.DEVNULL,
                capture_output=True, text=True, timeout=60,
                encoding="utf-8", errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
    except (OSError, subprocess.TimeoutExpired):
        return None

    limit = None
    # Rejected requests can still carry valid limits, even with a nonzero exit.
    for line in (proc.stdout or "").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and event.get("type") == "rate_limit_event":
            info = event.get("rate_limit_info")
            if isinstance(info, dict) and info:
                limit = parse_rate_limit(info)
    return limit
