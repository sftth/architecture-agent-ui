import { useState } from "react";
import { ClaudeAccounts, RateLimit } from "../types";
import Menu, { MenuItem } from "./Menu";
import "./AccountChip.css";

/** 실행에 쓰는 Claude 계정을 가리키는 값 — 등록된 계정이 아니라 기기 로그인. */
export const DEVICE = "device";

const SUBSCRIPTION: Record<string, string> = {
  enterprise: "Enterprise",
  team: "Team",
  max: "Max",
  pro: "Pro",
};

/**
 * 머리에 서는 계정 칩. 지금 어느 Claude 계정으로 실행되는지를 늘 보이고, 누르면 바꾼다.
 *
 * 한도에 걸렸을 때 가장 먼저 눌러야 하는 자리라 사용량 띠 바로 옆이다 — 띠가 "차단"을
 * 말하는 순간 그 옆에 다른 계정으로 가는 길이 있어야 한다. 그때 칩은 amber 로 소리 낸다.
 *
 * 계정을 더하고 지우는 일은 환경 설정에서 한다. 여기는 고르는 자리다.
 */
export default function AccountChip({
  accounts,
  limit,
  onSelect,
  onManage,
}: {
  accounts: ClaudeAccounts | null;
  /** 지금 고른 계정의 제한 창 상태. 막혔으면 칩이 그것을 말한다. */
  limit: RateLimit | null;
  onSelect: (id: string) => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!accounts) return null;

  const device = accounts.device;
  const deviceLabel = device.logged_in
    ? `기기 로그인 · ${device.email ?? ""}`.replace(/ · $/, "")
    : "기기 로그인 없음";
  const deviceSub = device.logged_in
    ? [SUBSCRIPTION[device.subscription ?? ""] ?? device.subscription, device.org_name]
        .filter(Boolean)
        .join(" · ")
    : "터미널에서 claude login 을 하지 않았습니다";

  const current = accounts.accounts.find((a) => a.id === accounts.active);
  const label = current ? current.name : device.logged_in ? (device.email ?? "기기 로그인") : "계정 없음";
  const blocked = limit ? limit.status !== "allowed" && limit.status !== "allowed_warning" : false;

  const items: MenuItem[] = [
    {
      value: DEVICE,
      label: deviceLabel,
      desc: deviceSub,
    },
    ...accounts.accounts.map((a) => ({
      value: a.id,
      label: a.name,
      hint: a.kind === "api_key" ? "API 키" : "구독 토큰",
      desc: describe(a.rate_limit_status, a.check_ok, a.check_note),
    })),
    {
      value: "__manage__",
      label: "계정 추가·관리…",
      desc: "claude setup-token 으로 만든 토큰을 등록합니다",
    },
  ];

  return (
    <div className="account">
      <button
        type="button"
        className={`account-chip${blocked ? " account-chip--blocked" : ""}${open ? " account-chip--on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={
          blocked
            ? "이 계정이 한도에 걸렸습니다\n다른 계정으로 바꾸고 이어서 보내면 같은 세션으로 계속됩니다"
            : "실행에 쓰는 Claude 계정\n누르면 바꿉니다 — 다음 턴부터 적용"
        }
      >
        <span className={`account-dot${blocked ? " account-dot--blocked" : ""}`} aria-hidden="true" />
        <span className="account-name">{label}</span>
        {blocked && <span className="account-flag">한도</span>}
        <svg className="account-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <Menu
          items={items}
          value={accounts.active}
          title="실행에 쓰는 Claude 계정"
          placement="down"
          align="right"
          onSelect={(value) => {
            if (value === "__manage__") onManage();
            else onSelect(value);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** 목록 한 줄의 부연 — 마지막으로 알려진 상태만 말한다. 모르면 모른다고 한다. */
function describe(limit: string | null, ok: boolean | null, note: string | null): string {
  if (limit && limit !== "allowed" && limit !== "allowed_warning") return `한도에 걸림 (${limit})`;
  if (ok === false) return `연결 실패 — ${note ?? ""}`.trim();
  if (limit === "allowed_warning") return "여유 적음";
  if (ok === true) return "연결 확인됨";
  return "아직 확인 안 함";
}
