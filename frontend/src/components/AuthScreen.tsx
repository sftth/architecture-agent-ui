import { FormEvent, useState } from "react";
import { login, register } from "../api/client";
import { UserProfile } from "../types";
import "./AuthScreen.css";

interface Props {
  onAuthenticated: (user: UserProfile) => void;
}

type Mode = "login" | "register";

export default function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [agentDir, setAgentDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword("");
    setPasswordConfirm("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register" && password !== passwordConfirm) {
      setError("비밀번호가 서로 다릅니다");
      return;
    }

    setBusy(true);
    try {
      const user =
        mode === "login"
          ? await login(email.trim(), password)
          : await register(email.trim(), password, agentDir.trim());
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    (mode === "login" || passwordConfirm.length > 0);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-eyebrow">ARCHITECTURE-AGENT · CONTROL CONSOLE</div>
        <h1 className="auth-title">
          {mode === "login" ? "로그인" : "계정 만들기"}
        </h1>
        <p className="auth-desc">
          계정마다 자신의 <code>architecture-agent</code> 경로를 저장해 둡니다. 로그인하면 저장된
          경로로 바로 실행되므로 매번 경로를 입력할 필요가 없습니다.
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`auth-tab ${mode === "login" ? "auth-tab--active" : ""}`}
            onClick={() => switchMode("login")}
          >
            로그인
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`auth-tab ${mode === "register" ? "auth-tab--active" : ""}`}
            onClick={() => switchMode("register")}
          >
            회원가입
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span className="auth-label">이메일</span>
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              autoFocus
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">비밀번호</span>
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
            {mode === "register" && <span className="auth-hint">8자 이상</span>}
          </label>

          {mode === "register" && (
            <>
              <label className="auth-field">
                <span className="auth-label">비밀번호 확인</span>
                <input
                  className="auth-input"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              <label className="auth-field">
                <span className="auth-label">architecture-agent 경로</span>
                <input
                  className="auth-input auth-input--mono"
                  type="text"
                  placeholder="/home/사용자명/architecture-agent"
                  value={agentDir}
                  onChange={(e) => setAgentDir(e.target.value)}
                  spellCheck={false}
                />
                <span className="auth-hint">
                  지금 비워둬도 됩니다. 나중에 환경 설정 화면에서 지정할 수 있습니다.
                </span>
              </label>
            </>
          )}

          <button className="auth-submit" type="submit" disabled={busy || !canSubmit}>
            {busy ? "처리 중..." : mode === "login" ? "로그인" : "가입하고 시작하기"}
          </button>
        </form>

        {error && <div className="auth-error">{error}</div>}
      </div>
    </div>
  );
}
