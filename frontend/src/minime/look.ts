/**
 * 사람마다 다른 생김새 — 이름에서 결정한다.
 *
 * 셔츠는 부서(역할)색이라 여기 없다. 머리 모양·머리색·피부·소품만 이름의 hash 로 고른다.
 * 같은 이름은 어느 세션·어느 화면에서든 같은 얼굴이어야 "그 사람"으로 읽히므로 난수를
 * 쓰지 않는다. docs/design/agent-minime.md §3.2
 */
export type HairStyle = "h-short" | "h-bob" | "h-long" | "h-spiky" | "h-buzz";
export type Accessory = "p-glasses" | "p-headset" | null;

export interface Look {
  hair: HairStyle;
  hairColor: string;
  skin: string;
  acc: Accessory;
}

const HAIR: HairStyle[] = ["h-short", "h-bob", "h-long", "h-spiky", "h-buzz"];
const HAIR_COLOR = ["#4A2E1C", "#1F1F2E", "#E3B341", "#B85C50", "#8A98B8", "#2E2A4A"];
const SKIN = ["#F5CBA7", "#E8B88E", "#C68642", "#8D5524"];
const ACC: Accessory[] = [null, "p-glasses", "p-headset"];

/** FNV-1a 32bit. 짧은 문자열에도 비트가 잘 섞이고 구현이 열 줄이다. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function lookOf(key: string): Look {
  const h = fnv1a(key);
  return {
    hair: HAIR[h % HAIR.length],
    hairColor: HAIR_COLOR[(h >>> 3) % HAIR_COLOR.length],
    skin: SKIN[(h >>> 6) % SKIN.length],
    acc: ACC[(h >>> 9) % ACC.length],
  };
}
