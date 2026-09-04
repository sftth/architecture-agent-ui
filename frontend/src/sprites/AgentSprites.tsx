import sheet from "./agent-sprites.svg?raw";

/**
 * 미니미 파츠 시트를 문서에 한 번 심는다.
 *
 * `<img src="sprites.svg#id">` 로는 CSS 변수가 스프라이트 안까지 들어가지 않는다 — 셔츠를
 * 부서색으로, 머리를 사람마다 다르게 칠하려면 심볼이 같은 문서 안에 있어야 한다.
 * App 최상단에 한 번만 둔다. 시트는 .svg 파일 그대로 읽어 들이므로 파츠를 고칠 때 TSX 를
 * 건드리지 않는다.
 *
 * `hidden`(display:none) 으로 감추지 않는다 — 브라우저에 따라 display:none 안의 심볼을
 * `<use>` 가 못 가져온다. 시트 자체가 0×0 이라 자리를 차지하지 않는다.
 */
export default function AgentSprites() {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      dangerouslySetInnerHTML={{ __html: sheet }}
    />
  );
}
