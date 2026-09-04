/**
 * 명패 — 부서 안에서 부르는 이름.
 *
 * 이름을 자르면 안 된다(`middleware-…` 는 지운 것이다). 대신 그 자리에서 이미 말해진 부분을 뗀다.
 *
 * 1. 역할 꼬리(-plan / -impl / -eval) — 레인이 말한다.
 * 2. 스테이지 공통 접두어 — 그 스테이지 카탈로그의 모든 이름이 공유하는 첫 단어들.
 *    cicd 는 `cicd-`, 운영은 `middleware-`, 공통은 `common-`. 접두어만 남는 이름
 *    (cicd-plan → "")은 접두어 자체를 이름으로 쓴다 → "cicd".
 * 3. 하이픈에서 두 줄 — 첫 단어 한 줄, 나머지 한 줄.
 *
 * 카탈로그 밖 이름(general-purpose 같은 CLI 내장 agent)은 접두어 계산에서 빠지고
 * 하이픈에서 그대로 나눈다. 전체 이름은 title 과 전체 목록에 남는다.
 * docs/design/agent-minime.md §3.3
 */
const ROLE_TAIL = /-(plan|impl|eval)$/;

function words(key: string): string[] {
  return key.replace(ROLE_TAIL, "").split("-");
}

/** 카탈로그 이름들이 함께 갖는 첫 단어 수. */
export function sharedPrefixLength(catalogKeys: string[]): number {
  if (catalogKeys.length < 2) return 0;
  const all = catalogKeys.map(words);
  const head = all[0];
  let n = 0;
  // 한 단어짜리(cicd-plan → ["cicd"])는 접두어 그 자체라 판정을 깨지 않는다. 다만 누군가는
  // 그 뒤에 더 있어야 접두어라 부를 수 있다 — 전부 같은 한 단어면 뗄 것이 없다.
  while (
    all.every((w) => (w[n] ?? head[n]) === head[n]) &&
    all.some((w) => w.length > n + 1) &&
    head[n] !== undefined
  ) {
    n++;
  }
  return n;
}

export function givenName(key: string, catalogKeys: string[]): string[] {
  const own = words(key);
  const n = catalogKeys.includes(key) ? sharedPrefixLength(catalogKeys) : 0;
  const rest = own.slice(n);
  const parts = rest.length > 0 ? rest : [own[n - 1] ?? own[0]];
  return parts.length <= 2 ? parts : [parts[0], parts.slice(1).join("-")];
}
