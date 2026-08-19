/** 메뉴를 여는 칩 버튼. 지금 고른 값을 그대로 이름표처럼 달고 있다. */
export default function Chip({
  label,
  value,
  open,
  count,
  flag,
  empty,
  title,
  onClick,
}: {
  /** 무엇을 고르는 칩인지 (AGENT / PROJECT) */
  label: string;
  value: string;
  open: boolean;
  /** 이 메뉴에서 고를 수 있는 항목 수. 목록이 접혀 있어도 규모는 보이게 한다. */
  count?: number;
  flag?: boolean;
  /** 아직 고르지 않은 상태 */
  empty?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chip${open ? " chip--on" : ""}${empty ? " chip--empty" : ""}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title={title}
      onClick={onClick}
    >
      {label && <span className="chip-label">{label}</span>}
      <span className="chip-key">{value}</span>
      {count !== undefined && <em className="chip-count">{count}</em>}
      {flag && <span className="chip-flag" aria-label="변경 가능" />}
      <svg className="chip-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path
          d="M2.5 4.5L6 8l3.5-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
