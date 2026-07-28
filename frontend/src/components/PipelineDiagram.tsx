import { RunSummary, RunStatus } from "../types";
import "./PipelineDiagram.css";

interface Node {
  id: string;
  num: string;
  label: string;
  stageKeys: string[];
  isGate?: boolean;
}

const NODES: Node[] = [
  { id: "req", num: "00", label: "요구사항\n이미지", stageKeys: [] },
  { id: "intent", num: "01", label: "분석", stageKeys: ["intent"] },
  { id: "register", num: "02", label: "ArcadeDB\n등록", stageKeys: ["intent"] },
  { id: "design", num: "03", label: "설계", stageKeys: ["design"] },
  { id: "gate", num: "04", label: "Policy\nGate", stageKeys: ["design"], isGate: true },
  { id: "eval", num: "05", label: "Evaluator", stageKeys: ["design"] },
  {
    id: "install",
    num: "06",
    label: "설치",
    stageKeys: ["infra", "middleware", "cicd", "db", "backing", "k8s", "monitoring"],
  },
  {
    id: "verify",
    num: "07",
    label: "검증",
    stageKeys: ["infra", "middleware", "cicd", "db", "backing", "k8s", "monitoring"],
  },
];

function latestStatus(runs: RunSummary[], stageKeys: string[]): RunStatus | "idle" {
  if (stageKeys.length === 0) return "idle";
  const candidates = runs.filter((r) => stageKeys.includes(r.stage_key));
  if (candidates.length === 0) return "idle";
  candidates.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return candidates[0].status;
}

function scrollToStage(stageKey: string) {
  const el = document.getElementById(`stage-${stageKey}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("pipeline-highlight-target");
    window.setTimeout(() => el.classList.remove("pipeline-highlight-target"), 1400);
  }
}

export default function PipelineDiagram({ runs }: { runs: RunSummary[] }) {
  return (
    <div className="pipeline-diagram" role="group" aria-label="architecture-agent 파이프라인">
      {NODES.map((node, i) => {
        const status = latestStatus(runs, node.stageKeys);
        return (
          <div className="pipeline-segment" key={node.id}>
            <button
              type="button"
              className={`pipeline-node pipeline-node--${status}${node.isGate ? " pipeline-node--gate" : ""}`}
              onClick={() => node.stageKeys[0] && scrollToStage(node.stageKeys[0])}
              disabled={node.stageKeys.length === 0}
              title={node.stageKeys.length ? "해당 스테이지로 이동" : undefined}
            >
              <span className="pipeline-node-num">{node.num}</span>
              {node.isGate ? (
                <span className="pipeline-gate-glyph" aria-hidden="true">
                  <span className="pipeline-gate-leaf pipeline-gate-leaf--l" />
                  <span className="pipeline-gate-leaf pipeline-gate-leaf--r" />
                </span>
              ) : null}
              <span className="pipeline-node-label">
                {node.label.split("\n").map((line, idx) => (
                  <span key={idx} className="pipeline-node-line">
                    {line}
                  </span>
                ))}
              </span>
            </button>
            {i < NODES.length - 1 && (
              <span
                className={`pipeline-pipe${
                  status === "running" ? " pipeline-pipe--running" : ""
                }`}
                aria-hidden="true"
              >
                <span className="pipeline-pipe-line" />
                <span className="pipeline-pipe-pulse" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
