"""Normalize credit windows from Claude rate limit events."""
import math
from .models import RateLimit, RateWindow


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def parse_rate_limit(info: dict) -> RateLimit:
    windows = []
    unified = info.get("unifiedWindows")
    if isinstance(unified, dict):
        for kind, value in unified.items():
            if isinstance(value, dict) and number(value.get("utilization")):
                reset = value.get("resetsAt")
                windows.append(RateWindow(kind=kind, utilization=value["utilization"],
                                          resets_at=int(reset) if number(reset) else None))
    kind = info.get("rateLimitType")
    utilization = info.get("utilization")
    reset = info.get("resetsAt")
    if not number(utilization):
        primary = next((w for w in windows if w.kind == kind), None)
        primary = primary or max(windows, key=lambda w: w.utilization, default=None)
        utilization = primary.utilization if primary else None
        if primary:
            kind, reset = primary.kind, primary.resets_at
    return RateLimit(
        status=str(info.get("status", "unknown")),
        kind=kind if isinstance(kind, str) else None,
        resets_at=int(reset) if number(reset) else None,
        using_overage=bool(info.get("isUsingOverage")),
        utilization=utilization, windows=windows,
    )
