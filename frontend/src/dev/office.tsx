import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import HarnessStrip from "../components/HarnessStrip";
import AgentSprites from "../sprites/AgentSprites";
import { Activity } from "../activity";
import { AgentDef, RunSummary, StageDef } from "../types";
import "../styles/tokens.css";
import "../styles/global.css";
import "../App.css";

/**
 * 하네스 사무실을 백엔드·로그인 없이 그려 보는 개발용 화면.
 *
 * 실제 카탈로그 이름을 그대로 쓴다 — 명패 규칙과 얼굴 hash 가 실제와 같아야 의미가 있다.
 * `?scene=` 으로 장면을 고른다. 정지 화면(headless 스크린샷)으로도 확인할 수 있게
 * 시간 흐름은 setTimeout 하나로만 만든다.
 */
const a = (key: string, role: string): AgentDef => ({ key, label: key, role, tools: [] });

const OPERATION: StageDef = {
  key: "operation",
  title: "운영",
  subtitle: "설치된 WEB/WAS 상태 점검",
  agents: [
    a("middleware-status-plan", "운영 점검 지휘 — 설계서에서 대상을 읽어 status·remediate 를 부른다"),
    a("middleware-status-impl", "WEB/WAS 상태 수집 — 로그·프로세스·포트를 읽어 판정한다"),
    a("middleware-remediate-impl", "이상 교정 — 재시작·설정 복구"),
  ],
};

const CICD_NAMES = ["argocd", "gitlab", "jenkins", "jenkins-pipeline", "nexus", "nexus-migrate", "sonarqube", "sonarqube-migrate"];
const CICD: StageDef = {
  key: "cicd",
  title: "CI/CD",
  subtitle: "GitLab · Jenkins · Nexus · SonarQube · ArgoCD",
  agents: [
    a("cicd-plan", "CI/CD 설치 지휘"),
    ...CICD_NAMES.map((n) => a(`cicd-${n}-impl`, `${n} 설치`)),
    ...CICD_NAMES.map((n) => a(`cicd-${n}-eval`, `${n} 검증`)),
  ],
};

const COMMON: StageDef = {
  key: "common",
  title: "공통",
  subtitle: "문서 변환 · 보고서 · 위키",
  agents: [
    a("common-doc-impl", "md → docx 변환"),
    a("common-html-report-impl", "HTML 보고서 생성"),
    a("common-wiki-impl", "LLM Wiki 조회"),
  ],
};

const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "idle";
const stageKey = params.get("stage") ?? "operation";
if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme")!;

const stage = stageKey === "cicd" ? CICD : OPERATION;
const plan = stage.agents[0].key;
const firstImpl = stage.agents.find((x) => x.key.endsWith("-impl"))!.key;
const secondImpl = stage.agents.filter((x) => x.key.endsWith("-impl"))[1]?.key ?? firstImpl;

function runOf(status: RunSummary["status"]): RunSummary {
  return {
    id: "dev-run",
    title: "dev",
    agent_key: plan,
    agent_label: plan,
    stage_key: stage.key,
    stage_title: stage.title,
    project: null,
    model: null,
    effort: null,
    prompt: "",
    full_prompt: "",
    status,
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    event_count: 0,
    turns: 1,
    usage: null,
  };
}

const registered = new Set(stage.agents.map((x) => x.key).filter((k) => k !== "common-html-report-impl"));
registered.delete(stage.agents[stage.agents.length - 1].key); // 마지막 한 사람은 미등록으로 — 회색 실루엣 확인
for (const c of COMMON.agents) if (c.key !== "common-html-report-impl") registered.add(c.key);

function Dev() {
  const [active, setActive] = useState<string[]>([]);
  const [run, setRun] = useState<RunSummary | undefined>(undefined);
  const [activity, setActivity] = useState<Activity | null>(null);

  useEffect(() => {
    const delegating: Activity = { kind: "agent", verb: "sub-agent 일하는 중", detail: firstImpl, lastSignal: null };
    switch (scene) {
      case "enter":
        // 1.5초 뒤 지시가 떨어진다 — 2초 시점 스크린샷에 놀란 얼굴이 잡힌다.
        setRun(runOf("running"));
        setTimeout(() => {
          setActive([firstImpl]);
          setActivity(delegating);
        }, 1500);
        break;
      case "typing":
        setRun(runOf("running"));
        setActive([firstImpl, secondImpl, "general-purpose"]);
        setActivity(delegating);
        break;
      case "error":
        setRun(runOf("running"));
        setActive([firstImpl]);
        setTimeout(() => {
          setActive([]);
          setRun(runOf("error"));
        }, 800);
        break;
      case "stopped":
        setRun(runOf("stopped"));
        break;
      default:
        break;
    }
  }, []);

  return (
    <div className="app-shell" style={{ padding: 24 }}>
      <AgentSprites />
      <HarnessStrip
        stages={[stage]}
        loaded
        selectedAgent={plan}
        onSelectAgent={() => undefined}
        activeAgents={active}
        common={COMMON}
        following={false}
        onFollow={() => undefined}
        registered={registered}
        run={run}
        activity={activity}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Dev />
  </StrictMode>,
);
