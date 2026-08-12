import { FormEvent, useState } from "react";
import { changePassword, updateAgentDir } from "../api/client";
import { UserProfile } from "../types";
import "./SettingsScreen.css";

interface Props {
  user: UserProfile;
  onUpdated: (user: UserProfile) => void;
  onClose: () => void;
  onLogout: () => void;
}

export default function SettingsScreen({ user, onUpdated, onClose, onLogout }: Props) {
  const [pathValue, setPathValue] = useState(user.architecture_agent_dir ?? "");
  const [pathBusy, setPathBusy] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathSaved, setPathSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const pathReady = user.path_exists && user.path_has_agents;

  async function handlePathSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pathValue.trim()) return;
    setPathBusy(true);
    setPathError(null);
    setPathSaved(false);
    try {
      onUpdated(await updateAgentDir(pathValue.trim()));
      setPathSaved(true);
    } catch (err) {
      setPathError(err instanceof Error ? err.message : String(err));
    } finally {
      setPathBusy(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword !== newPasswordConfirm) {
      setPasswordError("새 비밀번호가 서로 다릅니다");
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : String(err));
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="settings-screen">
      <header className="settings-header">
        <div>
          <div className="settings-eyebrow">ARCHITECTURE-AGENT · 환경 설정</div>
          <h1 className="settings-title">환경 설정</h1>
        </div>
        <div className="settings-header-actions">
          {pathReady && (
            <button className="settings-ghost" type="button" onClick={onClose}>
              콘솔로 돌아가기
            </button>
          )}
          <button className="settings-ghost settings-ghost--danger" type="button" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      {!pathReady && (
        <div className="settings-notice">
          {user.architecture_agent_dir
            ? "저장된 경로에서 architecture-agent 프로젝트를 확인하지 못했습니다. 경로를 다시 지정하세요."
            : "실행할 architecture-agent 경로가 아직 없습니다. 경로를 지정하면 이후 로그인부터는 바로 콘솔로 들어갑니다."}
        </div>
      )}

      <section className="settings-section">
        <h2 className="settings-section-title">계정</h2>
        <dl className="settings-meta">
          <div>
            <dt>이메일</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>가입일</dt>
            <dd>{new Date(user.created_at).toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">architecture-agent 경로</h2>
        <p className="settings-desc">
          각자 clone해 둔 <code>architecture-agent</code> 프로젝트의 절대 경로입니다. 이 계정으로
          실행하는 모든 agent는 이 경로를 작업 디렉토리로 사용합니다.
        </p>

        {user.architecture_agent_dir && (
          <div className="settings-status">
            <div className="settings-current">{user.architecture_agent_dir}</div>
            <div className="settings-chips">
              <span className={`settings-chip ${user.path_exists ? "settings-chip--ok" : "settings-chip--bad"}`}>
                {user.path_exists ? "경로 존재" : "경로 없음"}
              </span>
              <span
                className={`settings-chip ${user.path_has_agents ? "settings-chip--ok" : "settings-chip--bad"}`}
              >
                {user.path_has_agents ? ".claude/agents 확인됨" : ".claude/agents 없음"}
              </span>
            </div>
          </div>
        )}

        <form className="settings-row-form" onSubmit={handlePathSubmit}>
          <input
            className="settings-input settings-input--mono"
            type="text"
            placeholder="/home/사용자명/architecture-agent"
            value={pathValue}
            onChange={(e) => {
              setPathValue(e.target.value);
              setPathSaved(false);
            }}
            spellCheck={false}
            autoFocus={!pathReady}
          />
          <button className="settings-submit" type="submit" disabled={pathBusy || !pathValue.trim()}>
            {pathBusy ? "저장 중..." : "저장"}
          </button>
        </form>
        {pathError && <div className="settings-error">{pathError}</div>}
        {pathSaved && !pathError && <div className="settings-ok">경로를 저장했습니다.</div>}
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">비밀번호 변경</h2>
        <p className="settings-desc">
          비밀번호를 바꾸면 다른 브라우저/기기에 남아 있던 로그인은 모두 해제됩니다.
        </p>

        <form className="settings-form" onSubmit={handlePasswordSubmit}>
          <label className="settings-field">
            <span className="settings-label">현재 비밀번호</span>
            <input
              className="settings-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="settings-field">
            <span className="settings-label">새 비밀번호</span>
            <input
              className="settings-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <span className="settings-hint">8자 이상</span>
          </label>
          <label className="settings-field">
            <span className="settings-label">새 비밀번호 확인</span>
            <input
              className="settings-input"
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <button
            className="settings-submit settings-submit--block"
            type="submit"
            disabled={passwordBusy || !currentPassword || !newPassword || !newPasswordConfirm}
          >
            {passwordBusy ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
        {passwordError && <div className="settings-error">{passwordError}</div>}
        {passwordSaved && !passwordError && <div className="settings-ok">비밀번호를 변경했습니다.</div>}
      </section>
    </div>
  );
}
