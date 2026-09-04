import { FormEvent, useEffect, useState } from "react";
import {
  activateClaudeAccount,
  addClaudeAccount,
  checkClaudeAccount,
  deleteClaudeAccount,
  listClaudeAccounts,
} from "../api/client";
import { ClaudeAccount, ClaudeAccounts } from "../types";
import { DEVICE } from "./AccountChip";
import "./ClaudeAccountsSection.css";

const SUBSCRIPTION: Record<string, string> = {
  enterprise: "Enterprise",
  team: "Team",
  max: "Max",
  pro: "Pro",
};

/**
 * 환경 설정의 "Claude 계정" 절. 계정을 더하고, 확인하고, 지우고, 활성으로 고른다.
 *
 * 왜 토큰을 붙여 넣는가 — `claude login` 은 브라우저를 열어야 해서 서버가 대신 해 줄 수
 * 없다(공식 문서: 비대화형 로그인 없음). 대신 CLI 는 `claude setup-token` 으로 1년짜리
 * 토큰을 만들어 주고, 그것을 환경변수로 받는다. 계정마다 한 번 만들어 여기 두면
 * 그 뒤로 바꿔 타기는 머리의 칩에서 클릭 하나다.
 */
export default function ClaudeAccountsSection({
  onChanged,
}: {
  /** 목록이 바뀌었을 때 머리의 칩도 같이 갱신하도록 알린다. */
  onChanged?: (accounts: ClaudeAccounts) => void;
}) {
  const [data, setData] = useState<ClaudeAccounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 지금 도는 동작의 계정 id

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"oauth_token" | "api_key">("oauth_token");
  const [secret, setSecret] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    try {
      const next = await listClaudeAccounts();
      setData(next);
      onChanged?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAdding(true);
    try {
      await addClaudeAccount(name, kind, secret);
      setName("");
      setSecret("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setError(null);
    setBusy(id);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const device = data?.device;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Claude 계정</h2>
      <p className="settings-desc">
        한도에 걸린 계정을 다른 계정으로 바꿔 타는 자리입니다. <code>claude login</code> 은 기기에
        하나뿐이라, 계정마다 <code>claude setup-token</code> 으로 만든 토큰을 등록해 두고 실행할 때
        고릅니다. 바꾼 계정은 <strong>다음 턴부터</strong> 쓰이고, 같은 세션이 그대로 이어집니다.
      </p>

      {data && (
        <ul className="acct-list">
          {/* 기기 로그인 — 늘 첫 줄. 지울 수 없고 고를 수만 있다. */}
          <li className={`acct-row${data.active === DEVICE ? " acct-row--on" : ""}`}>
            <label className="acct-pick">
              <input
                type="radio"
                name="claude-account"
                checked={data.active === DEVICE}
                disabled={busy !== null}
                onChange={() => void act(DEVICE, () => activateClaudeAccount(DEVICE))}
              />
              <span className="acct-main">
                <span className="acct-name">
                  기기 로그인
                  {device?.logged_in && device.email && (
                    <span className="acct-email">{device.email}</span>
                  )}
                </span>
                <span className="acct-sub">
                  {device?.logged_in
                    ? [SUBSCRIPTION[device.subscription ?? ""] ?? device.subscription, device.org_name]
                        .filter(Boolean)
                        .join(" · ") || "로그인됨"
                    : "터미널에서 claude login 을 하지 않았습니다"}
                </span>
              </span>
            </label>
          </li>

          {data.accounts.map((a) => (
            <li key={a.id} className={`acct-row${a.active ? " acct-row--on" : ""}`}>
              <label className="acct-pick">
                <input
                  type="radio"
                  name="claude-account"
                  checked={a.active}
                  disabled={busy !== null}
                  onChange={() => void act(a.id, () => activateClaudeAccount(a.id))}
                />
                <span className="acct-main">
                  <span className="acct-name">
                    {a.name}
                    <span className="acct-kind">{a.kind === "api_key" ? "API 키" : "구독 토큰"}</span>
                    <span className="acct-hint">{a.hint}</span>
                  </span>
                  <AccountState account={a} />
                </span>
              </label>
              <span className="acct-actions">
                <button
                  type="button"
                  className="acct-btn"
                  disabled={busy !== null}
                  onClick={() => void act(a.id, () => checkClaudeAccount(a.id))}
                  title={"연결 확인\n가장 짧은 호출을 한 번 해서 토큰이 맞는지, 지금 한도에 걸렸는지 봅니다. 몇백 토큰이 듭니다."}
                >
                  {busy === a.id ? "확인 중…" : "연결 확인"}
                </button>
                <button
                  type="button"
                  className="acct-btn acct-btn--danger"
                  disabled={busy !== null}
                  onClick={() => void act(a.id, () => deleteClaudeAccount(a.id))}
                  title="이 계정을 목록에서 지웁니다. 토큰 자체는 취소되지 않습니다."
                >
                  삭제
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="acct-form" onSubmit={handleAdd}>
        <div className="acct-form-head">계정 추가</div>
        <ol className="acct-steps">
          <li>
            터미널에서 <code>claude setup-token</code> 을 실행하고, 열리는 브라우저에서 <strong>등록할
            계정</strong>으로 로그인합니다. 터미널에 <code>sk-ant-oat…</code> 로 시작하는 토큰이 찍힙니다.
          </li>
          <li>그 토큰을 아래에 붙여 넣고 알아볼 이름을 붙입니다 (예: Max 개인, Enterprise).</li>
        </ol>
        <div className="acct-form-row">
          <input
            className="settings-input"
            type="text"
            placeholder="이름 (예: Max 개인)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
          />
          <select
            className="settings-input acct-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as "oauth_token" | "api_key")}
          >
            <option value="oauth_token">구독 토큰 (setup-token)</option>
            <option value="api_key">Console API 키</option>
          </select>
        </div>
        <div className="acct-form-row">
          <input
            className="settings-input settings-input--mono"
            type="password"
            placeholder={kind === "api_key" ? "sk-ant-api03-…" : "sk-ant-oat01-…"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="settings-submit"
            type="submit"
            disabled={adding || !name.trim() || !secret.trim()}
          >
            {adding ? "추가 중…" : "추가"}
          </button>
        </div>
        <p className="settings-hint">
          토큰은 이 백엔드의 <code>backend/data/claude_accounts.json</code> 에 소유자만 읽을 수 있게
          저장됩니다. 이 기계 밖으로 나가면 그 계정으로 CLI 를 쓸 수 있으니 서버를 공유할 때 유의하세요.
        </p>
      </form>

      {error && <div className="settings-error">{error}</div>}
    </section>
  );
}

/** 마지막으로 알려진 상태 한 줄. 모르면 모른다고 적는다. */
function AccountState({ account: a }: { account: ClaudeAccount }) {
  const limited =
    a.rate_limit_status && a.rate_limit_status !== "allowed" && a.rate_limit_status !== "allowed_warning";
  if (limited) {
    return <span className="acct-sub acct-sub--bad">한도에 걸림 · {a.rate_limit_status}</span>;
  }
  if (a.check_ok === false) {
    return <span className="acct-sub acct-sub--bad">연결 실패 · {a.check_note}</span>;
  }
  if (a.check_ok === true) {
    return (
      <span className="acct-sub acct-sub--ok">
        연결 확인됨
        {a.rate_limit_status === "allowed_warning" && " · 여유 적음"}
        {a.checked_at && ` · ${new Date(a.checked_at).toLocaleString("ko-KR", { hour12: false })}`}
      </span>
    );
  }
  return <span className="acct-sub">아직 확인 안 함</span>;
}
