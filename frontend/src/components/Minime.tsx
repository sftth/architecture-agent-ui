import { CSSProperties } from "react";
import { Look } from "../minime/look";
import { MinimeState, cycleMsOf, framesOf, layersOf } from "../minime/states";
import "./Minime.css";

export type MinimeRole = "plan" | "impl" | "eval" | "common";

/**
 * 직원 한 사람. 파츠 시트(`AgentSprites`)의 심볼을 겹쳐 그린다.
 *
 * 프레임이 둘 이상이면 `<svg>` 를 겹쳐 놓고 CSS 가 steps(1) 로 번갈아 보인다 — 킷의
 * preview 방식 그대로다. 프레임 하나면 `<svg>` 하나뿐이라 서 있는 여덟 명이 무겁지 않다.
 *
 * 색은 셔츠(부서색, 클래스)와 머리·피부(사람, 인라인 변수) 두 갈래다. 그 밖은 시트의 기본값.
 * 글자는 옆의 명패가 말하므로 여기는 장식이다(aria-hidden).
 */
export default function Minime({
  look,
  role,
  state,
  size = 2,
  className,
}: {
  look: Look;
  role: MinimeRole;
  state: MinimeState;
  /** 1 = 16×24, 2 = 32×48. 정수 배율만 — 그래야 픽셀이 선다. */
  size?: 1 | 2;
  className?: string;
}) {
  const frames = framesOf(state);
  const w = 16 * size;
  const h = 24 * size;
  const style = {
    "--hair": look.hairColor,
    "--skin": look.skin,
    "--cycle": `${cycleMsOf(state)}ms`,
    width: w,
    height: h,
  } as CSSProperties;
  const cls = ["minime", `minime--${role}`, `minime--${state}`, `minime--f${frames.length}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={cls} style={style} aria-hidden="true">
      {frames.map((frame, i) => (
        <svg key={i} viewBox="0 0 16 24" width={w} height={h}>
          <g transform={`translate(0,${3 + frame.dy})`}>
            {layersOf(look, frame).map((id) => (
              <use key={id} href={`#${id}`} />
            ))}
          </g>
          {frame.top.map((id) => (
            <use key={id} href={`#${id}`} />
          ))}
        </svg>
      ))}
    </span>
  );
}
