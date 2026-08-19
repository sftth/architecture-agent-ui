import { useEffect, useMemo, useRef, useState } from "react";
import "./Menu.css";

export interface MenuItem {
  value: string;
  label: string;
  /** 라벨 오른쪽에 붙는 짧은 수치(도구 수, 문서 수 등) */
  hint?: string;
  /** 라벨 아래 한 줄 설명 */
  desc?: string;
  /** 실제 변경을 일으킬 수 있는 항목 표시 */
  flag?: boolean;
}

/**
 * 목록에서 하나를 고르는 팝업. 항목이 열 개를 넘어가면 알약 버튼을 늘어놓는 것보다
 * 이름으로 걸러 고르는 편이 빠르다(CI/CD 스테이지에만 sub-agent가 16개다).
 * 바깥 클릭과 Esc로 닫히고, 열리면 걸르개(없으면 지금 고른 줄)로 초점이 간다.
 */
export default function Menu({
  items,
  value,
  onSelect,
  onClose,
  title,
  filterPlaceholder = "이름으로 거르기…",
  emptyText = "해당 항목 없음",
  placement = "up",
  align = "left",
}: {
  items: MenuItem[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  title?: string;
  filterPlaceholder?: string;
  emptyText?: string;
  placement?: "up" | "down";
  /** 칩이 화면 오른쪽에 붙어 있으면 메뉴도 오른쪽 끝을 맞춰야 화면 밖으로 나가지 않는다. */
  align?: "left" | "right";
}) {
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // 걸르개는 고를 것이 여럿일 때만 의미가 있다.
  const showFilter = items.length > 6;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 걸르개가 없으면 아무 데도 초점이 가지 않아, 키보드로 연 사람이 메뉴를 쓸 수 없다.
  useEffect(() => {
    if (showFilter) return;
    const rows = box.current?.querySelectorAll<HTMLButtonElement>(".menu-row");
    const current = box.current?.querySelector<HTMLButtonElement>(".menu-row--on");
    (current ?? rows?.[0])?.focus();
  }, [showFilter]);

  function moveFocus(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(box.current?.querySelectorAll<HTMLButtonElement>(".menu-row") ?? []);
    if (rows.length === 0) return;
    e.preventDefault();
    const here = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      here < 0
        ? e.key === "ArrowDown"
          ? 0
          : rows.length - 1
        : (here + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
    rows[next]?.focus();
  }

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.desc ?? "").toLowerCase().includes(needle),
    );
  }, [items, filter]);

  return (
    <div
      className={`menu menu--${placement} menu--${align}`}
      ref={box}
      role="menu"
      onKeyDown={moveFocus}
    >
      {showFilter && (
        <input
          autoFocus
          className="menu-filter"
          value={filter}
          placeholder={filterPlaceholder}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      <div className="menu-scroll">
        {title && <div className="menu-section">{title}</div>}
        {shown.length === 0 && <div className="menu-empty">{emptyText}</div>}
        {shown.map((item) => (
          <button
            key={item.value}
            role="menuitemradio"
            aria-checked={item.value === value}
            className={`menu-row${item.value === value ? " menu-row--on" : ""}`}
            onClick={() => {
              onSelect(item.value);
              onClose();
            }}
          >
            <span className="menu-row-main">
              <span className="menu-row-label">
                {item.label}
                {item.flag && <span className="menu-row-flag" aria-label="변경 가능" />}
                {item.hint && <em className="menu-row-hint">{item.hint}</em>}
              </span>
              {item.desc && <span className="menu-row-desc">{item.desc}</span>}
            </span>
            {item.value === value && <CheckIcon />}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="menu-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
