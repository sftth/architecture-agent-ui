import { useEffect, useMemo, useRef, useState } from "react";
import { ModelDef } from "../types";
import "./ModelMenu.css";

/** effort 점 위에 띄울 우리말 설명 */
const EFFORT_NOTE: Record<string, string> = {
  low: "빠르게, 얕은 추론",
  medium: "속도와 깊이 절충",
  high: "깊은 추론 (기본)",
  xhigh: "코딩·에이전트 작업 권장",
  max: "최대 추론",
};

/**
 * 실행에 쓸 모델과 effort를 고르는 팝업 (claude CLI의 --model / --effort).
 * effort는 왼쪽이 낮고 오른쪽이 높은 점 트랙으로 고른다. 지원하지 않는 모델은 그 자리에 안내가 뜬다.
 */
export default function ModelMenu({
  models,
  model,
  effort,
  onChange,
  onClose,
}: {
  models: ModelDef[];
  model: string;
  effort: string;
  onChange: (model: string, effort: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLDivElement>(null);

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

  const current = models.find((m) => m.value === model) ?? models[0];

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((m) => m.label.toLowerCase().includes(needle));
  }, [models, filter]);

  return (
    <div className="mm" ref={box} role="menu">
      <input
        autoFocus
        className="mm-filter"
        value={filter}
        placeholder="모델 이름으로 거르기…"
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className="mm-scroll">
        <div className="mm-section">모델</div>
        {shown.length === 0 && <p className="mm-empty">해당 모델 없음</p>}
        {shown.map((option) => (
          <button
            key={option.value || "default"}
            type="button"
            role="menuitemradio"
            aria-checked={option.value === model}
            className={`mm-row${option.value === model ? " mm-row--on" : ""}`}
            title={option.note}
            onClick={() => {
              // 고른 모델이 지금 effort를 지원하지 않으면 effort는 비운다.
              onChange(option.value, option.efforts.includes(effort) ? effort : "");
            }}
          >
            <span className="mm-row-main">
              <span className="mm-row-label">{option.label}</span>
              <span className="mm-row-note">{option.note}</span>
            </span>
            {option.value === model && (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        ))}

        <div className="mm-section">Effort</div>
        {current && current.efforts.length > 0 ? (
          <div className="mm-effort">
            <span className="mm-effort-label">
              Effort <em>{effort || "기본"}</em>
            </span>
            <span className="mm-track">
              <button
                type="button"
                className={`mm-dot mm-dot--none${effort === "" ? " mm-dot--on" : ""}`}
                title="지정 안 함 — CLI 기본값을 그대로 쓴다"
                aria-label="지정 안 함"
                onClick={() => onChange(model, "")}
              />
              <span className="mm-track-split" aria-hidden="true" />
              {current.efforts.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`mm-dot${level === effort ? " mm-dot--on" : ""}`}
                  title={`${level} — ${EFFORT_NOTE[level] ?? ""}`}
                  aria-label={level}
                  onClick={() => onChange(model, level)}
                />
              ))}
            </span>
          </div>
        ) : (
          <p className="mm-empty">이 모델은 effort 설정을 지원하지 않습니다</p>
        )}
      </div>
    </div>
  );
}
