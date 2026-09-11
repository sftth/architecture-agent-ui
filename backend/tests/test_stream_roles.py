import json
import unittest
from unittest.mock import Mock

from app.runner import _handle_stream_line


class StreamRoleTests(unittest.TestCase):
    def test_text_preserves_role_and_parent_for_both_content_shapes(self):
        for role in ("user", "assistant"):
            for parent in (None, "agent-call"):
                for content in ("점검 지시", [{"type": "text", "text": "점검 지시"}]):
                    with self.subTest(role=role, parent=parent, content=content):
                        run = Mock()
                        _handle_stream_line(run, json.dumps({
                            "type": role,
                            "parent_tool_use_id": parent,
                            "message": {"role": role, "content": content},
                        }))
                        run._emit.assert_called_once_with(
                            role, text="점검 지시", parent_tool_use_id=parent,
                        )

    def test_user_tool_result_still_pairs_with_its_tool(self):
        run = Mock()
        block = {"type": "tool_result", "tool_use_id": "agent-call",
                 "content": [{"type": "text", "text": "점검 완료"}]}
        _handle_stream_line(run, json.dumps({
            "type": "user", "message": {"content": [block]},
        }))
        run._emit.assert_called_once_with(
            "tool_result", text="점검 완료", data=block, parent_tool_use_id=None,
        )


if __name__ == "__main__":
    unittest.main()
