import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.models import ContinueRunRequest, CreateRunRequest
from app.orchestration import MAIN_AGENT_KEY
from app.runner import RunManager, _check_agent_registered


class MainAgentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for target, kwargs in (
            ("app.runner.store.load_metas", {"return_value": []}),
            ("app.runner.store.open_log", {}),
            ("app.runner.store.save_meta", {}),
            ("app.runner._execute", {"new_callable": AsyncMock}),
        ):
            patcher = patch(target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.manager = RunManager()

    async def asyncTearDown(self):
        await asyncio.gather(*self.manager._tasks.values())

    def create_main(self):
        request = CreateRunRequest(prompt="설계서를 작성해줘", project="sample")
        return self.manager.create_run(
            "test-user", "unused-workspace", request.agent_key, request.prompt,
            request.project, "sonnet", "high",
        )

    async def test_new_request_needs_no_subagent_selection_or_catalog_entry(self):
        with patch("app.runner.find_agent") as find:
            run = self.create_main()
        find.assert_not_called()
        self.assertEqual(run.agent_key, MAIN_AGENT_KEY)
        self.assertEqual(run.summary().agent_label, "Main agent")
        self.assertTrue(run.full_prompt.startswith("설계서를 작성해줘 (프로젝트: sample)"))
        self.assertIn("<main-agent-policy>", run.full_prompt)
        self.assertIn("subagent_type", run.full_prompt)
        self.assertNotIn("@main", run.full_prompt)
        self.assertEqual((run.model, run.effort), ("sonnet", "high"))

    async def test_legacy_session_continues_with_main_and_keeps_context(self):
        run = self.create_main()
        await self.manager._tasks[run.id]
        run.agent_key = "intent-plan"
        run.stage_key = "intent"
        run.status = "success"
        run.turns = 2
        session_id = run.session_id
        request = ContinueRunRequest(prompt="계속 진행해줘")
        continued = self.manager.continue_run(run.id, request.prompt, request.agent_key)
        self.assertIs(continued, run)
        self.assertEqual(continued.session_id, session_id)
        self.assertEqual(continued.turns, 2)
        self.assertEqual(continued.agent_key, MAIN_AGENT_KEY)
        self.assertEqual(continued.stage_key, "main")
        self.assertIn("(프로젝트: sample)", continued.full_prompt)
        self.assertIn("<main-agent-policy>", continued.full_prompt)
        self.assertNotIn("@intent-plan", continued.full_prompt)
        self.assertEqual((continued.model, continued.effort), ("sonnet", "high"))

    async def test_main_does_not_restart_when_absent_from_subagent_registry(self):
        run = self.create_main()
        run.process = Mock(returncode=None)
        _check_agent_registered(run, {"agents": ["intent-plan"]})
        self.assertFalse(run._restart_wanted)
        run.process.terminate.assert_not_called()

    async def test_explicit_legacy_subagent_still_checks_registration(self):
        with patch("app.runner.find_agent", return_value=(
            {"key": "intent", "title": "분석"}, {"label": "intent-plan"},
        )):
            run = self.manager.create_run("test-user", "unused-workspace", "intent-plan", "분석해줘")
        self.assertEqual(run.full_prompt, "@intent-plan 분석해줘")
        run.process = Mock(returncode=None)
        _check_agent_registered(run, {"agents": []})
        self.assertTrue(run._restart_wanted)
        run.process.terminate.assert_called_once()

    async def test_unknown_explicit_agent_remains_an_error(self):
        with patch("app.runner.find_agent", return_value=(None, None)):
            with self.assertRaisesRegex(ValueError, "알 수 없는 agent_key"):
                self.manager.create_run("test-user", "unused-workspace", "unknown", "분석해줘")
        self.assertFalse(self.manager.runs)


if __name__ == "__main__":
    unittest.main()
