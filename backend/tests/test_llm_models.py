import unittest

from fastapi import HTTPException

from app.llm_models import check_choice
from app.routes.catalog import get_models


class ModelChoiceTests(unittest.TestCase):
    def test_catalog_includes_fable_5_1_once(self):
        models = get_models(user=None)["models"]
        self.assertNotIn("claude-fable-5", [m["value"] for m in models])
        matches = [m for m in models if m["value"] == "claude-fable-5-1"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["label"], "Fable 5.1")
        self.assertEqual(matches[0]["efforts"], ["low", "medium", "high", "xhigh", "max"])

    def test_fable_5_1_accepts_default_and_all_effort_levels(self):
        for effort in ("", "low", "medium", "high", "xhigh", "max"):
            with self.subTest(effort=effort):
                self.assertEqual(
                    check_choice("claude-fable-5-1", effort),
                    ("claude-fable-5-1", effort),
                )

    def test_existing_choices_remain_valid(self):
        for model in ("", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"):
            with self.subTest(model=model):
                self.assertEqual(check_choice(model, ""), (model, ""))

    def test_invalid_choices_remain_rejected(self):
        for model, effort in (
            ("claude-fable-5", ""),
            ("claude-fable-unknown", ""),
            ("claude-fable-5-1", "invalid"),
            ("claude-haiku-4-5", "high"),
        ):
            with self.subTest(model=model, effort=effort):
                with self.assertRaises(HTTPException) as raised:
                    check_choice(model, effort)
                self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
