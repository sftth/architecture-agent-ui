import { Look } from "./look";

/**
 * 한 사람이 겪는 상태와, 상태마다 어떤 파츠를 어떻게 겹치는가.
 * docs/design/agent-minime.md §4
 */
export type MinimeState =
  | "idle"
  | "breathe"
  | "chat"
  | "coffee"
  | "glance"
  | "doze"
  | "surprise"
  | "run"
  | "typing"
  | "thinking"
  | "success"
  | "error"
  | "stopped"
  | "ghost";

/** 대기 비트 — 판이 한 번에 한 명에게만 주는 짧은 움직임. */
export const IDLE_BEATS: { state: MinimeState; ms: number }[] = [
  { state: "breathe", ms: 1600 },
  { state: "chat", ms: 1600 },
  { state: "coffee", ms: 2000 },
  { state: "glance", ms: 800 },
];

/** 일이 들어왔을 때의 전이 시간. */
export const SURPRISE_MS = 600;
export const RUN_MS = 900;
export const SUCCESS_MS = 900;
/** 마지막 run 이 끝난 뒤 이만큼 아무 일이 없으면 졸기 시작한다. */
export const DOZE_AFTER_MS = 5 * 60_000;

export interface Frame {
  legs: "m-legs-stand" | "m-legs-a" | "m-legs-b";
  face: string;
  hands: "m-neck-hands" | "m-neck" | "m-hands-type-a" | "m-hands-type-b" | "m-hands-up";
  /** 캐릭터 좌표의 소품(노트북·머그) */
  props: string[];
  /** 캔버스 좌표의 머리 위 소품(말풍선·스파크·느낌표·zzz) */
  top: string[];
  /** 몸 전체를 위아래로 */
  dy: number;
}

const base: Frame = {
  legs: "m-legs-stand",
  face: "f-idle",
  hands: "m-neck-hands",
  props: [],
  top: [],
  dy: 0,
};

const f = (over: Partial<Frame>): Frame => ({ ...base, ...over });

/** 상태 → 프레임 1·2·4장. 프레임 수가 곧 애니메이션 종류다(1 정지 · 2 숨/타이핑 · 4 걷기). */
export function framesOf(state: MinimeState): Frame[] {
  switch (state) {
    case "breathe":
      return [f({}), f({ dy: 1 })];
    case "chat":
      return [f({ face: "f-look", top: ["p-bubble"] })];
    case "coffee":
      return [f({ hands: "m-neck", props: ["p-mug"] })];
    case "glance":
      return [f({ face: "f-look" })];
    case "doze":
    case "stopped":
      return [f({ face: "f-sleep", top: ["p-zzz"] })];
    case "surprise":
      return [f({ face: "f-surprise", hands: "m-hands-up", top: ["p-bang"] })];
    case "run":
      return [f({ legs: "m-legs-a" }), f({ dy: -1 }), f({ legs: "m-legs-b" }), f({ dy: -1 })];
    case "typing":
      return [
        f({ face: "f-focus", hands: "m-hands-type-a", props: ["p-laptop"] }),
        f({ face: "f-focus", hands: "m-hands-type-b", props: ["p-laptop"] }),
      ];
    case "thinking":
      return [f({ face: "f-think", top: ["p-bubble"] })];
    case "success":
      return [f({ face: "f-happy", top: ["p-spark"] })];
    case "error":
      return [f({ face: "f-error", top: ["p-alert"] })];
    case "idle":
    case "ghost":
    default:
      return [f({})];
  }
}

/** 프레임 한 장의 `<use>` 순서. 뒤가 앞을 덮는다 — 머리 → 얼굴 → 손 → 몸 → 다리 → 표정 → 소품. */
export function layersOf(look: Look, frame: Frame): string[] {
  return [
    look.hair,
    "m-head-skin",
    frame.hands,
    "m-body",
    frame.legs,
    frame.face,
    ...(look.acc ? [look.acc] : []),
    ...frame.props,
  ];
}

/** 일하고 있는 상태 — 발밑이 amber 로 켜지고 명패가 굵어진다. */
export function isBusy(state: MinimeState): boolean {
  return state === "surprise" || state === "run" || state === "typing";
}

/** 대기 비트를 받을 수 있는 상태. */
export function isRestful(state: MinimeState): boolean {
  return state === "idle" || state === "doze";
}
