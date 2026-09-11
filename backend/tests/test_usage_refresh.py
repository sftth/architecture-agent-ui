import asyncio
import json
import subprocess
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.models import RateLimit
from app.runner import RunManager
from app.usage_probe import probe_rate_limit


class UsageProbeTests(unittest.TestCase):
    @patch("app.usage_probe.subprocess.run")
    def test_reads_limits_even_when_account_is_rejected(self, run):
        run.return_value = Mock(returncode=1, stdout="\n".join([
            "not json", "null", "[]",
            json.dumps({"type": "rate_limit_event", "rate_limit_info": {
                "status": "rejected", "utilization": 1, "rateLimitType": "five_hour",
            }}),
            json.dumps({"type": "result", "is_error": True}),
        ]))
        limit = probe_rate_limit({"TEST": "active-account"})
        self.assertEqual(limit.status, "rejected")
        self.assertEqual(limit.utilization, 1)
        args, kwargs = run.call_args
        self.assertEqual(kwargs["env"], {"TEST": "active-account"})
        self.assertEqual(kwargs["timeout"], 60)
        self.assertIn("--no-session-persistence", args[0])
        self.assertIn("--safe-mode", args[0])
        self.assertEqual(args[0][args[0].index("--tools") + 1], "")

    @patch("app.usage_probe.subprocess.run")
    def test_failed_or_missing_response_does_not_invent_usage(self, run):
        for failure in [OSError("missing CLI"), subprocess.TimeoutExpired("claude", 60)]:
            run.side_effect = failure
            self.assertIsNone(probe_rate_limit({}))
        run.side_effect = None
        run.return_value = Mock(stdout='{"type":"result"}\n')
        self.assertIsNone(probe_rate_limit({}))


class UsageRefreshTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for target, kwargs in (
            ("app.runner.store.load_metas", {"return_value": []}),
            ("app.runner.accounts.env_for", {"return_value": ({}, "device", "Device")}),
            ("app.runner.accounts.note_rate_limit", {}),
        ):
            patcher = patch(target, **kwargs)
            mocked = patcher.start()
            self.addCleanup(patcher.stop)
            if target.endswith("env_for"):
                self.env_for = mocked
        self.manager = RunManager()

    @patch("app.runner.asyncio.to_thread", new_callable=AsyncMock)
    async def test_each_manual_refresh_fetches_current_usage_without_runs(self, probe):
        probe.return_value = RateLimit(status="allowed", utilization=.25)
        await self.manager.refresh_rate_limit("user")
        self.assertEqual(self.manager.rate_limit_for("user").utilization, .25)
        self.assertEqual(self.manager.runs, {})
        probe.return_value = RateLimit(status="allowed", utilization=.3)
        await self.manager.refresh_rate_limit("user")
        self.assertEqual(probe.await_count, 2)
        self.assertEqual(self.manager.rate_limit_for("user").utilization, .3)

    @patch("app.runner.asyncio.to_thread", new_callable=AsyncMock)
    async def test_concurrent_tabs_share_one_probe(self, probe):
        async def respond(*args):
            await asyncio.sleep(0)
            return RateLimit(status="allowed", utilization=.4)
        probe.side_effect = respond
        await asyncio.gather(*(self.manager.refresh_rate_limit("user") for _ in range(4)))
        self.assertEqual(probe.await_count, 1)
        self.assertEqual(self.manager.rate_limit_for("user").utilization, .4)

    @patch("app.runner.asyncio.to_thread", new_callable=AsyncMock)
    async def test_failure_preserves_previous_limit_and_allows_manual_retry(self, probe):
        previous = RateLimit(status="allowed", utilization=.5)
        self.manager.rate_limits[("user", "device")] = previous
        probe.return_value = None
        with self.assertRaises(ValueError):
            await self.manager.refresh_rate_limit("user")
        self.assertIs(self.manager.rate_limit_for("user"), previous)
        probe.return_value = RateLimit(status="allowed", utilization=.6)
        await self.manager.refresh_rate_limit("user")
        self.assertEqual(probe.await_count, 2)
        self.assertEqual(self.manager.rate_limit_for("user").utilization, .6)

    @patch("app.runner.asyncio.to_thread", new_callable=AsyncMock)
    async def test_account_switch_during_probe_keeps_results_separate(self, probe):
        async def switch_account(*args):
            self.env_for.return_value = ({}, "other", "Other")
            return RateLimit(status="allowed", utilization=.2)
        probe.side_effect = switch_account
        await self.manager.refresh_rate_limit("user")
        self.assertIsNone(self.manager.rate_limit_for("user"))
        self.assertEqual(self.manager.rate_limits[("user", "device")].utilization, .2)
        probe.side_effect = None
        probe.return_value = RateLimit(status="allowed", utilization=.7)
        await self.manager.refresh_rate_limit("user")
        self.assertEqual(self.manager.rate_limit_for("user").utilization, .7)
        await self.manager.refresh_rate_limit("another-user")
        self.assertEqual(probe.await_count, 3)

    @patch("app.runner.asyncio.to_thread", new_callable=AsyncMock)
    async def test_does_not_overwrite_live_run_update(self, probe):
        current = RateLimit(status="allowed", utilization=.8)
        async def live_update(*args):
            self.manager.rate_limits[("user", "device")] = current
            return RateLimit(status="allowed", utilization=.5)
        probe.side_effect = live_update
        await self.manager.refresh_rate_limit("user")
        self.assertIs(self.manager.rate_limit_for("user"), current)


if __name__ == "__main__":
    unittest.main()
