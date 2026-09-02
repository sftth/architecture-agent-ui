import { memo } from "react";
import type { ReactNode } from "react";
import "./Markdown.css";

/**
 * 최소한의 마크다운 렌더러.
 *
 * 라이브러리를 붙이지 않은 이유는 두 가지다. 하나는 의존성 없이 필요한 문법
 * (제목·목록·표·코드·강조)만 다루면 충분하다는 것, 다른 하나는 결과를 HTML 문자열이
 * 아니라 React 노드로 만들어 에이전트가 뱉은 글이 그대로 마크업이 되는 길을 막는 것이다.
 * 로그에 실려 오는 것은 전부 신뢰할 수 없는 텍스트라, dangerouslySetInnerHTML은 쓰지 않는다.
 */
/**
 * 글이 그대로면 다시 파싱하지 않는다.
 *
 * 이 컴포넌트는 그릴 때마다 본문 전체를 다시 훑는다. 그런데 로그는 한 번 그려지면
 * 좀처럼 바뀌지 않는 반면, 부모(콘솔)는 지시문을 한 글자 칠 때마다 다시 그려진다.
 * 그 사이에 아무 상관 없는 옛 로그 수백 덩어리가 통째로 다시 파싱되고 있었다.
 */
function Markdown({ text }: { text: string }) {
  return <div className="md">{render(text)}</div>;
}

export default memo(Markdown);

const BLOCK_START = /^\s*(```|#{1,6}\s|>|[-*+]\s|\d+\.\s|\||---)/;

function render(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  const at = (n: number): string => lines[n] ?? "";
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = at(i);

    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(at(i))) code.push(at(i++));
      i++; // 닫는 펜스
      out.push(
        <pre key={key++} className="md-code">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // 대화 본문 안이므로 한 단계 낮춰서 h3~h5로 쓴다.
      const level = Math.min((heading[1] ?? "#").length + 2, 5);
      const Tag = `h${level}` as "h3" | "h4" | "h5";
      out.push(<Tag key={key++}>{inline(heading[2] ?? "")}</Tag>);
      i++;
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(at(i))) {
        quoted.push(at(i++).replace(/^\s*>\s?/, ""));
      }
      out.push(<blockquote key={key++}>{render(quoted.join("\n"))}</blockquote>);
      continue;
    }

    // 표 — 첫 줄과 구분줄이 모두 파이프로 시작할 때만
    if (line.trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(at(i + 1))) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).trim().startsWith("|")) rows.push(cells(at(i++)));
      out.push(
        <div key={key++} className="md-table">
          <table>
            <thead>
              <tr>
                {header.map((cell, n) => (
                  <th key={n}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, m) => (
                    <td key={m}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(at(i))) {
        items.push(at(i++).replace(/^\s*([-*+]|\d+\.)\s+/, ""));
      }
      const children = items.map((item, n) => <li key={n}>{inline(item)}</li>);
      out.push(ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && at(i).trim() && !BLOCK_START.test(at(i))) {
      paragraph.push(at(i++));
    }
    // 블록 시작 줄과 마주쳐 한 줄도 못 담았으면 그 줄을 그대로 문단으로 삼아 무한루프를 막는다.
    if (paragraph.length === 0) paragraph.push(at(i++));
    out.push(<p key={key++}>{inline(paragraph.join("\n"))}</p>);
  }

  return out;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
