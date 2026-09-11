import assert from "node:assert/strict";
import { test } from "node:test";
import { toBlocks } from "../src/transcript";
import type { LogEvent } from "../src/types";

function event(seq: number, kind: LogEvent["kind"], text: string | null = null,
               parent: string | null = null, data: unknown = null): LogEvent {
  return { seq, kind, text, parent_tool_use_id: parent, data, ts: "2026-09-11T04:41:18Z" };
}

function agent(seq: number, id: string, prompt: string, parent: string | null = null) {
  return event(seq, "tool_use", null, parent, {
    id, name: "Agent", input: { description: "WEB/WAS snapshot", prompt },
  });
}

test("legacy forwarded prompt stays in the collapsed tool; progress and result remain", () => {
  const prompt = "task_id: snapshot\ngoal: 최근 6시간 점검";
  const blocks = toBlocks([
    event(1, "user", "상태 점검해줘"),
    agent(2, "plan", prompt),
    event(3, "assistant", prompt, "plan"),
    event(4, "assistant", "대상 4개를 확인했습니다.", "plan"),
    event(5, "tool_result", "점검 완료", null, { tool_use_id: "plan" }),
    event(6, "assistant", "점검 결과입니다."),
  ]);
  assert.deepEqual(blocks.map(b => b.key), ["1", "2", "6"]);
  const tool = blocks.find(b => b.kind === "tool");
  assert.equal(tool?.kind, "tool");
  if (tool?.kind === "tool") {
    assert.equal(tool.tool.input, prompt);
    assert.equal(tool.tool.output, "점검 완료");
    assert.equal(tool.tool.details, "대상 4개를 확인했습니다.");
  }
  assert.equal(blocks.at(-1)?.kind, "report");
});

test("new internal user input does not create a question or close the current turn", () => {
  const blocks = toBlocks([
    event(1, "user", "점검해줘"),
    event(2, "assistant", "점검을 시작합니다."),
    agent(3, "plan", "내부 지시"),
    event(4, "user", "내부 지시", "plan"),
    event(5, "assistant", "완료했습니다."),
  ]);
  assert.deepEqual(blocks.filter(b => b.kind === "ask").map(b => b.key), ["1"]);
  assert.equal(blocks.find(b => b.key === "2")?.kind, "md");
  assert.equal(blocks.at(-1)?.kind, "report");
});

test("nested worker prompts are suppressed for legacy and new logs", () => {
  for (const kind of ["assistant", "user"] as const) {
    const blocks = toBlocks([
      agent(1, "plan", "planner 지시"),
      event(2, kind, "planner 지시", "plan"),
      agent(3, "worker", "worker 지시", "plan"),
      event(4, kind, "worker 지시", "worker"),
      event(5, "assistant", "worker 진행 상황", "worker"),
    ]);
    assert.deepEqual(blocks.map(b => b.key), ["1", "3"]);
    const worker = blocks.find(b => b.key === "3");
    assert.equal(worker?.kind === "tool" && worker.tool.details, "worker 진행 상황");
  }
});

test("same text outside that parent call and genuine errors stay visible", () => {
  const blocks = toBlocks([
    agent(1, "plan", "동일한 내용"),
    event(2, "assistant", "동일한 내용", "other-agent"),
    event(3, "assistant", "동일한 내용"),
    event(4, "stderr", "접속 실패", "plan"),
    event(5, "user", "동일한 내용"),
  ]);
  assert.deepEqual(blocks.map(b => b.key), ["1", "2", "3", "4", "5"]);
  assert.equal(blocks.find(b => b.key === "2")?.kind, "tool");
  assert.equal(blocks.find(b => b.key === "4")?.kind, "meta");
});

test("legacy and new Skill bodies stay in their Skill card at root and worker scope", () => {
  for (const kind of ["assistant", "user"] as const) {
    for (const parent of [null, "worker"]) {
      const body = "Base directory for this skill: C:\\repo\\.claude\\skills\\status-check\n\n# 로그 수집\n긴 지침";
      const blocks = toBlocks([
        event(1, "tool_use", null, parent, {
          id: "skill", name: "Skill", input: { skill: "middleware:status-check" },
        }),
        event(2, "tool_result", "Launching skill: status-check", parent, { tool_use_id: "skill" }),
        event(3, kind, body, parent),
        event(4, "assistant", "메인 답변"),
      ]);
      assert.deepEqual(blocks.map(b => b.key), ["1", "4"]);
      const skill = blocks[0];
      assert.equal(skill.kind === "tool" && skill.tool.details, body);
      assert.equal(skill.kind === "tool" && skill.tool.output, "Launching skill: status-check");
    }
  }
});

test("Skill body association requires the same scope and matching directory", () => {
  const body = "Base directory for this skill: /repo/skills/status-check\n\n지침";
  const blocks = toBlocks([
    agent(1, "worker-a", "점검 A"),
    agent(2, "worker-b", "점검 B"),
    event(3, "tool_use", null, "worker-a", {
      id: "skill-a", name: "Skill", input: { skill: "status-check" },
    }),
    event(4, "tool_use", null, "worker-b", {
      id: "skill-b", name: "Skill", input: { skill: "status-check" },
    }),
    event(5, "assistant", body, "worker-a"),
    event(6, "assistant", body, "worker-b"),
    event(7, "assistant", body),
  ]);
  for (const key of ["3", "4"]) {
    const skill = blocks.find(b => b.key === key);
    assert.equal(skill?.kind === "tool" && skill.tool.details, body);
  }
  assert.equal(blocks.at(-1)?.kind, "report");
  assert.equal(blocks.at(-1)?.key, "7");
});

test("Bash output and worker report have separate owners, with no duplicate final report", () => {
  const report = "status: partial\n상세 점검 보고";
  const events = [
    agent(1, "worker", "로그 점검"),
    event(2, "tool_use", null, "worker", {
      id: "bash", name: "Bash", input: { command: "wc -c report.md" },
    }),
    event(3, "tool_result", "2322 report.md", "worker", { tool_use_id: "bash" }),
    event(4, "assistant", "점검 대상을 확인했습니다.", "worker"),
    event(5, "assistant", report, "worker"),
  ];
  const streaming = toBlocks(events);
  assert.deepEqual(streaming.map(b => b.key), ["1", "2"]);
  const worker = streaming[0];
  assert.equal(worker.kind === "tool" && worker.tool.output, null);
  assert.ok(worker.kind === "tool" && worker.tool.details?.includes(report));
  const completed = toBlocks([
    ...events,
    event(6, "tool_result", report + "\nagentId: worker\n<usage>...</usage>", null, { tool_use_id: "worker" }),
    event(7, "assistant", "사용자에게 전달할 최종 요약"),
  ]);
  const finished = completed[0];
  assert.equal(finished.kind === "tool" && finished.tool.details, "점검 대상을 확인했습니다.");
  assert.ok(finished.kind === "tool" && finished.tool.output?.startsWith(report));
  const bash = completed[1];
  assert.equal(bash.kind === "tool" && bash.tool.output, "2322 report.md");
  assert.equal(completed.at(-1)?.kind, "report");
});
