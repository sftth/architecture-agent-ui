/**
 * status-middleware.json 을 읽는 규칙.
 *
 * 화면이 값을 만들어 내지 않는다 — 판정도, 기준도 전부 agent 가 적어 둔 것을 그대로 쓴다.
 * 여기 있는 것은 "그 문서의 어디에 무엇이 적혀 있는가"뿐이다.
 */

export type Verdict = "OK" | "WARN" | "CRIT" | "INFO" | "NA";

export interface StatusCheck {
  id: string;
  name: string;
  value: unknown;
  rule: string | null;
  verdict: Verdict;
  note?: string | null;
}

export interface StatusTarget {
  id: string;
  ip?: string;
  private_ip?: string;
  hostname?: string;
  role?: string;
  engine?: string;
  instance?: string;
  design_ref?: string;
  verdict: Verdict;
  checks?: StatusCheck[];
  notes?: string[];
  sample_count?: number;
}

export interface StatusDoc {
  schema?: string;
  generated_at?: string;
  run?: {
    project?: string;
    env?: string;
    mode?: string;
    interval_sec?: number | null;
    sample_count?: number;
    design_source?: string;
    started_at?: string;
    finished_at?: string;
  };
  targets?: StatusTarget[];
  verdict?: Verdict;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  OK: "정상",
  WARN: "주의",
  CRIT: "위험",
  INFO: "정보",
  NA: "미확인",
};

/** 심각한 순. 여러 판정을 하나로 접을 때 쓴다. */
const RANK: Record<Verdict, number> = { CRIT: 4, WARN: 3, NA: 2, INFO: 1, OK: 0 };

export function worst(list: Verdict[]): Verdict {
  return list.reduce<Verdict>((a, b) => (RANK[b] > RANK[a] ? b : a), "OK");
}

export function checksOf(target: StatusTarget): StatusCheck[] {
  return target.checks ?? [];
}

/** 같은 id 의 첫 항목. 대부분의 지표는 대상당 하나뿐이다. */
export function pick(target: StatusTarget, id: string): StatusCheck | null {
  return checksOf(target).find((c) => c.id === id) ?? null;
}

export function pickAll(target: StatusTarget, id: string): StatusCheck[] {
  return checksOf(target).filter((c) => c.id === id);
}

export function num(check: StatusCheck | null): number | null {
  if (!check) return null;
  const v = check.value;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function text(check: StatusCheck | null): string {
  if (!check || check.value === null || check.value === undefined) return "—";
  return String(check.value);
}

/** 리슨 포트. A02 는 이름에 "포트 리슨 (http 80)" 처럼 종류와 번호가 들어 있다. */
export interface PortInfo {
  kind: string;
  port: number;
  state: string;
  verdict: Verdict;
  /** 같은 포트의 커넥션 수(C01). 없으면 null. */
  conns: number | null;
}

const PORT_RE = /\(([a-z]+)\s+(\d+)\)/i;

export function portsOf(target: StatusTarget): PortInfo[] {
  const conns = pickAll(target, "C01");
  return pickAll(target, "A02").flatMap((c) => {
    const m = PORT_RE.exec(c.name);
    if (!m) return [];
    const port = Number(m[2]);
    const paired = conns.find((x) => PORT_RE.exec(x.name)?.[2] === m[2]);
    return [
      {
        kind: m[1].toLowerCase(),
        port,
        state: text(c),
        verdict: c.verdict,
        conns: num(paired ?? null),
      },
    ];
  });
}

/** 두 층을 잇는 선. A05 "업스트림 도달성 (172.31.32.34:8109)" 에서 나온다. */
export interface Edge {
  from: string;
  to: string;
  port: number;
  /** agent 가 실제로 닿아 봤는가. 닿지 않으면 선을 흐르게 두지 않는다. */
  ok: boolean;
  verdict: Verdict;
  label: string;
}

const UP_RE = /\(([\d.]+):(\d+)\)/;

/**
 * 주소만으로는 대상을 못 고른다 — web 과 was 가 한 host 에 같이 사는 구성이 흔하고,
 * 그러면 같은 IP 를 가진 대상이 둘이다. 그 포트를 실제로 물고 있는 쪽이 상대다.
 */
function targetAt(all: StatusTarget[], host: string, port: number): StatusTarget | null {
  return (
    all.find(
      (t) =>
        (t.private_ip === host || t.ip === host) &&
        portsOf(t).some((p) => p.port === port),
    ) ?? null
  );
}

export function edgesOf(all: StatusTarget[]): Edge[] {
  const edges: Edge[] = [];
  for (const from of all) {
    for (const c of pickAll(from, "A05")) {
      const m = UP_RE.exec(c.name);
      if (!m) continue;
      const port = Number(m[2]);
      const to = targetAt(all, m[1], port);
      if (!to || to.id === from.id) continue;
      edges.push({
        from: from.id,
        to: to.id,
        port,
        ok: c.verdict === "OK",
        verdict: c.verdict,
        label: `${m[1]}:${port}`,
      });
    }
  }
  return edges;
}

/**
 * 카드에 세울 대표 게이지.
 *
 * 무엇이 그 대상을 조이고 있는지는 역할마다 다르다 — web 은 워커가, WAS 는 heap 이
 * 먼저 찬다. 색은 다시 계산하지 않고 agent 가 그 항목에 매긴 판정을 그대로 쓴다.
 */
export interface Gauge {
  label: string;
  pct: number;
  value: string;
  rule: string;
  verdict: Verdict;
}

export function gaugeOf(target: StatusTarget): Gauge | null {
  const order =
    (target.role ?? "").toLowerCase() === "web"
      ? [["W01", "워커"], ["R02", "메모리"]]
      : [["J01", "Heap Old"], ["R02", "메모리"]];
  for (const [id, label] of order) {
    const c = pick(target, id);
    const v = num(c);
    if (c && v !== null) {
      return {
        label,
        pct: Math.max(0, Math.min(100, v)),
        value: `${v}%`,
        rule: c.rule ?? "",
        verdict: c.verdict,
      };
    }
  }
  return null;
}

/** 롤오버 표에 세울 줄. 역할에 따라 볼 것이 다르다. */
export interface Row {
  label: string;
  value: string;
  rule: string;
  verdict: Verdict;
}

function row(label: string, c: StatusCheck | null, unit = ""): Row | null {
  if (!c) return null;
  return {
    label,
    value: c.value === null || c.value === undefined ? "—" : `${c.value}${unit}`,
    rule: c.rule ?? "—",
    verdict: c.verdict,
  };
}

export function summaryRows(target: StatusTarget): Row[] {
  const web = (target.role ?? "").toLowerCase() === "web";
  const logs = pickAll(target, "L01");
  const logTotal = logs.reduce((sum, c) => sum + (num(c) ?? 0), 0);
  const oom = pick(target, "L02");

  const rows: (Row | null)[] = [
    row("프로세스", pick(target, "A01")),
    row("응답 코드", pick(target, "A03")),
    row("응답 시간", pick(target, "A04"), "초"),
    row("CPU load", pick(target, "R01")),
    row("메모리", pick(target, "R02"), "%"),
    web ? row("워커", pick(target, "W01"), "%") : row("Heap Old", pick(target, "J01"), "%"),
    web ? null : row("스레드", pick(target, "J04")),
    logs.length > 0
      ? {
          label: `오류 로그 ${logs.length > 1 ? `(${logs.length}개 파일)` : ""}`.trim(),
          value: `${logTotal}건`,
          rule: logs[0].rule ?? "—",
          verdict: worst(logs.map((c) => c.verdict)),
        }
      : null,
    oom && (num(oom) ?? 0) > 0 ? row("OutOfMemory", oom, "건") : null,
  ];
  return rows.filter((r): r is Row => r !== null);
}

/** 주의·위험으로 잡힌 항목만. 배지 숫자와 상세의 머리말이 같은 값을 쓰게 한다. */
export function badChecks(target: StatusTarget): StatusCheck[] {
  return checksOf(target).filter((c) => c.verdict === "WARN" || c.verdict === "CRIT");
}
