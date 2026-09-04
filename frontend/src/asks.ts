/**
 * 에이전트가 답을 기다리는 말을 알아본다.
 *
 * 비대화형으로 도는 하네스라 되묻고 기다릴 수 없다. 대신 agent 는 [결정 필요] 나
 * "…알려주세요" 로 적고 그 자리에서 끝낸다 — 사람이 답을 보내면 같은 세션의 다음 턴으로
 * 이어진다. 그 말이 긴 보고 안에 묻히면 아무도 답하지 않으므로, 화면이 알아보고
 * **답할 자리를 그 밑에 바로 세운다** — 고를 것이 적혀 있으면 단추로, 아니면 입력칸으로.
 */

export interface AskOption {
  /** 에이전트가 붙인 번호·글자 (A / B / 1 / 2). 답에 그대로 실어 보낸다. */
  key: string;
  label: string;
}

export interface Ask {
  asks: boolean;
  options: AskOption[];
}

const NONE: Ask = { asks: false, options: [] };

/** 답을 기다린다는 말들. 문서마다 표현이 달라 한 가지만 보면 대부분 놓친다. */
const ASKING =
  /\[결정\s*필요\]|결정이 필요|확인 게이트|알려\s?주세요|알려주시|선택해\s?주세요|선택하세요|택하실|답을 주시면|답해\s?주세요|입력해\s?주시|확인해\s?주시|어느 쪽|진행할까요|진행할지/;

/**
 * 고를 것 한 줄. `A. 문서 추가` / `B) 경로 지정` / `1. 중단` / `- **A.** …` 를 받는다.
 * 굵게(**) 감싼 것은 벗긴다.
 */
const OPTION = /^\s*(?:[-*]\s+)?(?:\*\*)?([A-Za-z]|\d{1,2})[.)]\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/;

/** 이보다 긴 줄은 고를 것이 아니라 설명이다 — 단추에 실을 수 없다. */
const MAX_LABEL = 100;

export function detectAsk(text: string): Ask {
  if (!ASKING.test(text)) return NONE;
  return { asks: true, options: pickOptions(text) };
}

/**
 * 연달아 선 선택지 묶음 가운데 가장 그럴듯한 것 하나.
 *
 * 글자(A/B/C)로 매긴 묶음이 있으면 그것이다 — 이 저장소의 plan 들이 "진행 방식" 을 그렇게
 * 적는다. 없으면 숫자 묶음 가운데 **짧은 줄로만** 된 것을 고른다. 번호 매긴 긴 문단은
 * 작업 규칙이지 선택지가 아니다. 2개 미만이면 선택이 아니고, 8개를 넘으면 단추가 아니다.
 */
function pickOptions(text: string): AskOption[] {
  const lines = text.split("\n");
  const groups: AskOption[][] = [];
  let run: AskOption[] = [];
  const flush = () => {
    if (run.length >= 2 && run.length <= 8) groups.push(run);
    run = [];
  };

  for (const raw of lines) {
    const m = OPTION.exec(raw);
    if (m && (m[2] ?? "").length <= MAX_LABEL && !/[│|]/.test(m[2] ?? "")) {
      const key = m[1] ?? "";
      // 종류가 바뀌면(글자 → 숫자) 다른 묶음이다.
      if (run.length > 0 && isLetter(run[0].key) !== isLetter(key)) flush();
      run.push({ key: key.toUpperCase(), label: (m[2] ?? "").replace(/\*\*/g, "").trim() });
      continue;
    }
    // 빈 줄은 묶음을 끊지 않는다 — 선택지 사이에 한 줄 띄는 문서가 많다.
    if (raw.trim() === "") continue;
    flush();
  }
  flush();

  const lettered = groups.find((g) => isLetter(g[0].key));
  if (lettered) return lettered;
  // 숫자 묶음은 1 부터 이어지는 것만 — 긴 항목 1·2 가 걸러지고 짧은 3·4 만 남은 것은
  // 선택지가 아니라 목록의 꼬리다.
  return groups.find((g) => g.every((o, i) => Number(o.key) === i + 1)) ?? [];
}

function isLetter(key: string): boolean {
  return /^[A-Za-z]$/.test(key);
}

/** 단추를 눌렀을 때 보낼 답. 번호와 글을 함께 실어야 에이전트가 무엇을 골랐는지 안다. */
export function answerFor(option: AskOption): string {
  return `${option.key}. ${option.label}`;
}
