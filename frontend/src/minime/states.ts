import { Look } from "./look";

/**
 * 한 사람이 겪는 상태와, 상태마다 어떤 파츠를 어떻게 겹치는가.
 * docs/design/agent-minime.md §4
 */
export type MinimeState =
  // 쉬는 사람
  | "idle"
  | "breathe"
  | "chat"
  | "coffee"
  | "glance"
  | "stretch"
  | "walk"
  | "hop"
  | "yawn"
  | "doze"
  // 일하는 사람
  | "surprise"
  | "run"
  | "typing"
  | "peek"
  | "thinking"
  // 결과
  | "success"
  | "error"
  | "stopped"
  | "ghost";

export interface Beat {
  state: MinimeState;
  ms: number;
}

/** 빈둥거림 — 쉬는 사람이 저마다의 시계로 하나씩 고른다. */
export const IDLE_BEATS: Beat[] = [
  { state: "breathe", ms: 1600 },
  { state: "chat", ms: 1800 },
  { state: "coffee", ms: 2400 },
  { state: "glance", ms: 900 },
  { state: "stretch", ms: 1200 },
  { state: "walk", ms: 1900 },
  { state: "hop", ms: 700 },
  { state: "yawn", ms: 1400 },
];

/** 일하는 사람이 타이핑 사이에 끼우는 짧은 움직임 — 뛰어가고, 옆을 보고. */
export const WORK_BURSTS: Beat[] = [
  { state: "run", ms: 1100 },
  { state: "peek", ms: 1300 },
  { state: "run", ms: 900 },
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

const WALK: Frame[] = [f({ legs: "m-legs-a" }), f({ dy: -1 }), f({ legs: "m-legs-b" }), f({ dy: -1 })];

/** 상태 → 프레임 1·2·4장. 프레임 수가 곧 애니메이션 종류다(1 정지 · 2 번갈아 · 4 걷기). */
export function framesOf(state: MinimeState): Frame[] {
  switch (state) {
    case "breathe":
      return [f({}), f({ dy: 1 })];
    case "chat":
      return [f({ face: "f-look", top: ["p-bubble"] }), f({ face: "f-look", top: ["p-bubble"], dy: 1 })];
    case "coffee":
      return [f({ hands: "m-neck", props: ["p-mug"] }), f({ hands: "m-neck", props: ["p-mug"], face: "f-sleep" })];
    case "glance":
      return [f({ face: "f-look" })];
    case "stretch":
      return [f({ hands: "m-hands-up", face: "f-sleep" }), f({ hands: "m-hands-up", face: "f-sleep", dy: -1 })];
    case "walk":
    case "run":
      return WALK;
    case "hop":
      return [f({}), f({ dy: -2 })];
    case "yawn":
      return [f({ face: "f-surprise" }), f({ face: "f-sleep" })];
    case "doze":
    case "stopped":
      return [f({ face: "f-sleep", top: ["p-zzz"] })];
    case "surprise":
      return [f({ face: "f-surprise", hands: "m-hands-up", top: ["p-bang"] })];
    case "typing":
      // 손이 오르내리고 머리가 1px 끄덕인다 — 손만 움직이면 32px 에서는 서 있는 것과 같다.
      return [
        f({ face: "f-focus", hands: "m-hands-type-a", props: ["p-laptop"] }),
        f({ face: "f-focus", hands: "m-hands-type-b", props: ["p-laptop"], dy: 1 }),
      ];
    case "peek":
      return [
        f({ face: "f-look", hands: "m-hands-type-a", props: ["p-laptop"] }),
        f({ face: "f-focus", hands: "m-hands-type-a", props: ["p-laptop"] }),
      ];
    case "thinking":
      return [f({ face: "f-think", top: ["p-bubble"] }), f({ face: "f-think", top: ["p-bubble"], dy: 1 })];
    case "success":
      return [f({ face: "f-happy", top: ["p-spark"] }), f({ face: "f-happy", top: ["p-spark"], dy: -1 })];
    case "error":
      return [f({ face: "f-error", top: ["p-alert"] })];
    case "idle":
    case "ghost":
    default:
      return [f({})];
  }
}

/** 프레임 한 바퀴의 길이(ms). 프레임이 하나면 의미 없다. */
export function cycleMsOf(state: MinimeState): number {
  switch (state) {
    case "run":
      return 480;
    case "walk":
      return 640;
    case "typing":
      return 420;
    case "hop":
      return 350;
    case "success":
      return 450;
    case "stretch":
      return 1200;
    case "peek":
      return 1300;
    case "coffee":
      return 2400;
    case "yawn":
      return 1400;
    case "breathe":
    case "chat":
    case "thinking":
    default:
      return 900;
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
  return state === "surprise" || state === "run" || state === "typing" || state === "peek";
}
