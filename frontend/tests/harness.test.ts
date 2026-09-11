import assert from "node:assert/strict";
import { test } from "node:test";
import { activeSubAgents } from "../src/harness";
import type { LogEvent } from "../src/types";

const keys = ["middleware-status-impl", "middleware-remediate-impl"];
function event(kind: LogEvent["kind"], data: unknown = null, text: string | null = null): LogEvent {
  return { seq: 1, kind, data, text, parent_tool_use_id: null, ts: "2026-09-11T00:00:00Z" };
}
const start = (id: string, key: string) => event("tool_use", {
  id, name: "Agent", input: { subagent_type: key },
});
const finish = (id: string) => event("tool_result", { tool_use_id: id });

test("returned agents stay inactive even when their name remains in progress or result text", () => {
  const events = [event("assistant", null, `Calling ${keys[0]}`), start("a", keys[0])];
  assert.deepEqual(activeSubAgents(events, keys), [keys[0]]);
  events.push(finish("a"), event("assistant", null, `${keys[0]} finished successfully`));
  assert.deepEqual(activeSubAgents(events, keys), []);
});

test("parallel calls for the same agent stay busy until every call returns", () => {
  const events = [start("a", keys[0]), start("b", keys[0]), start("c", keys[1]), finish("a")];
  assert.deepEqual(activeSubAgents(events, keys), keys);
  events.push(finish("b"));
  assert.deepEqual(activeSubAgents(events, keys), [keys[1]]);
  events.push(finish("c"));
  assert.deepEqual(activeSubAgents(events, keys), []);
});

test("a returned agent can start another explicit task in the same turn", () => {
  assert.deepEqual(activeSubAgents([
    start("a", keys[0]), finish("a"), start("b", keys[0]),
  ], keys), [keys[0]]);
});

test("built-in agents outside the catalog follow explicit start and return events", () => {
  const events = [start("a", "general-purpose")];
  assert.deepEqual(activeSubAgents(events, keys), ["general-purpose"]);
  events.push(finish("a"));
  assert.deepEqual(activeSubAgents(events, keys), []);
});

test("text-only dispatch still works in a new turn after an explicit task ended", () => {
  const events = [start("a", keys[0]), finish("a"), event("run_end"), event("assistant", null, `@${keys[1]}`)];
  assert.deepEqual(activeSubAgents(events, keys), [keys[1]]);
  assert.deepEqual(activeSubAgents([event("assistant", null, `@${keys[0]}`)], keys), [keys[0]]);
});
