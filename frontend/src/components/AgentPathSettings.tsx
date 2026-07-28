import { FormEvent, useState } from "react";
import { setConfig } from "../api/client";
import { AgentPathConfig } from "../types";
import "./AgentPathSettings.css";

interface Props {
  config: AgentPathConfig | null;
  variant: "gate" | "panel";
  onSaved: (config: AgentPathConfig) => void;
  onClose?: () => void;
}

export default function AgentPathSettings({ config, variant, onSaved, onClose }: Props) {
  const [value, setValue] = useState(config?.architecture_agent_dir ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await setConfig(value.trim());
      onSaved(next);
      if (variant === "panel" && next.exists && next.has_agents) {
        onClose?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.replace(/^\d+ [^:]+:\s*/, ""));
    } finally {
      setSaving(false);
    }
  }

  const showStatus = config?.architecture_agent_dir != null;

  const body = (
    <>
      <p className="path-settings-desc">
        각자 clone해 둔 <code>architecture-agent</code> 프로젝트의 절대 경로를 입력하세요.
        이 UI는 여러 사람이 공유해서 쓰지만, 실행 시 사용할 경로는 사람(브라우저)마다 따로
        저장됩니다.
      </p>

      {showStatus && (
        <div className="path-settings-status">
          <div className="path-settings-current">{config!.architecture_agent_dir}</div>
          <div className="path-settings-chips">
            <span className={`path-chip ${config!.exists ? "path-chip--ok" : "path-chip--bad"}`}>
              {config!.exists ? "경로 존재" : "경로 없음"}
            </span>
            <span className={`path-chip ${config!.has_agents ? "path-chip--ok" : "path-chip--bad"}`}>
              {config!.has_agents ? ".claude/agents 확인됨" : ".claude/agents 없음"}
            </span>
          </div>
        </div>
      )}

      <form className="path-settings-form" onSubmit={handleSubmit}>
        <input
          className="path-settings-input"
          type="text"
          placeholder="/home/사용자명/architecture-agent"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoFocus={variant === "gate"}
        />
        <button className="path-settings-submit" type="submit" disabled={saving || !value.trim()}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </form>
      {error && <div className="path-settings-error">{error}</div>}
    </>
  );

  if (variant === "gate") {
    return (
      <div className="path-settings-gate">
        <div className="path-settings-card">
          <div className="path-settings-eyebrow">ARCHITECTURE-AGENT · 경로 설정</div>
          <h2 className="path-settings-title">architecture-agent 경로가 필요합니다</h2>
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="path-settings-panel">
      <div className="path-settings-panel-header">
        <span>architecture-agent 경로 설정</span>
        <button className="path-settings-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      {body}
    </div>
  );
}
