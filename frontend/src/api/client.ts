import type { LogEvent, RunSummary, StageDef } from "../types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function getCatalog(): Promise<{ stages: StageDef[] }> {
  return json(await fetch("/api/catalog"));
}

export async function createRun(agentKey: string, prompt: string): Promise<RunSummary> {
  return json(
    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_key: agentKey, prompt }),
    })
  );
}

export async function listRuns(): Promise<RunSummary[]> {
  return json(await fetch("/api/runs"));
}

export async function getRun(runId: string): Promise<{ summary: RunSummary; events: LogEvent[] }> {
  return json(await fetch(`/api/runs/${runId}`));
}

export async function stopRun(runId: string): Promise<void> {
  await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
}

export function openRunSocket(runId: string, onEvent: (event: LogEvent | null) => void): () => void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws/runs/${runId}`);
  socket.onmessage = (msg) => {
    const parsed = JSON.parse(msg.data) as LogEvent;
    onEvent(parsed);
    if (parsed.kind === "run_end") {
      onEvent(null);
    }
  };
  return () => socket.close();
}
