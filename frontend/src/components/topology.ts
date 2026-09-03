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
  /** 주소로 상대를 특정하지 못해 포트로 되짚은 선인가. 화면이 그 사실을 밝힌다. */
  inferred: boolean;
}

const UP_RE = /\(([\d.]+):(\d+)\)/;

/**
 * 주소로 상대를 특정한다.
 *
 * 주소만으로는 부족하다 — web 과 was 가 한 host 에 같이 사는 구성이 흔하고, 그러면 같은
 * IP 를 가진 대상이 둘이다. 그 포트를 실제로 물고 있는 쪽이 상대다.
 */
function targetAt(all: StatusTarget[], host: string, port: number): StatusTarget | null {
  return (
    all.find(
      (t) => (t.private_ip === host || t.ip === host) && portsOf(t).some((p) => p.port === port),
    ) ?? null
  );
}

/** 그 포트를 물고 있는 대상 전부. 주소로 못 고를 때의 차선이다. */
function targetsOnPort(all: StatusTarget[], port: number): StatusTarget[] {
  return all.filter((t) => portsOf(t).some((p) => p.port === port));
}

/**
 * 층 사이의 선.
 *
 * A05 는 "업스트림 도달성 (172.31.45.153:8109)" 처럼 **사설** 주소를 적는데, 대상 쪽에
 * 그 주소가 늘 있는 것은 아니다(산출물에서 private_ip 가 빠진 판이 있었고, 그러면 호스트가
 * 어디에도 안 맞아 선이 조용히 0개가 됐다 — 관계가 사라진 것을 화면이 "관계 없음"으로
 * 보여 주는 것이 가장 나쁜 실패다).
 *
 * 그래서 두 단으로 간다. 주소가 맞으면 그대로 잇고, 안 맞으면 **그 포트를 물고 있는
 * 대상**으로 되짚는다. 되짚은 선은 inferred 로 표시해 화면이 추정임을 밝힌다.
 */
export function edgesOf(all: StatusTarget[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const add = (
    from: string,
    to: string,
    port: number,
    c: StatusCheck,
    inferred: boolean,
    m1: string,
  ) => {
    const key = `${from}>${to}:${port}`;
    const prev = edges.find((e) => `${e.from}>${e.to}:${e.port}` === key);
    if (prev) {
      // 같은 짝이 여러 A05 에서 나오면 가장 나쁜 판정을 남긴다 — 하나라도 못 닿으면
      // 그 경로는 믿을 수 없다.
      if (rankOf(c.verdict) > rankOf(prev.verdict)) {
        prev.verdict = c.verdict;
        prev.ok = c.verdict === "OK";
      }
      return;
    }
    seen.add(key);
    edges.push({
      from,
      to,
      port,
      ok: c.verdict === "OK",
      verdict: c.verdict,
      // 선 위에는 포트만. 추정이라는 사실은 판 아래 한 문장이 이미 말한다.
      label: inferred ? `:${port}` : `${m1}:${port}`,
      inferred,
    });
  };

  for (const from of all) {
    for (const c of pickAll(from, "A05")) {
      const m = UP_RE.exec(c.name);
      if (!m) continue;
      const port = Number(m[2]);
      const exact = targetAt(all, m[1], port);
      if (exact && exact.id !== from.id) {
        add(from.id, exact.id, port, c, false, m[1]);
        continue;
      }
      for (const t of targetsOnPort(all, port)) {
        if (t.id !== from.id) add(from.id, t.id, port, c, true, m[1]);
      }
    }
  }
  return edges;
}

function rankOf(v: Verdict): number {
  return v === "CRIT" ? 3 : v === "WARN" ? 2 : v === "NA" ? 1 : 0;
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

/* ── 알람 ────────────────────────────────────────────────
   점검 결과에서 주의·위험만 뽑아 한 줄씩 세운다. 토폴로지는 "어디가 아픈가"를 보여 주고,
   알람은 "무엇이 잘못됐는가"를 말한다. 사람이 이 줄을 그대로 집어 교정 agent 에게 넘긴다. */

export interface Alarm {
  id: string;
  target: StatusTarget;
  check: StatusCheck;
}

/** 위험이 먼저, 그 다음 주의. 같은 등급이면 대상 순서를 지킨다. */
export function alarmsOf(doc: StatusDoc | null): Alarm[] {
  const out: Alarm[] = [];
  for (const target of doc?.targets ?? []) {
    for (const [i, check] of checksOf(target).entries()) {
      if (check.verdict === "CRIT" || check.verdict === "WARN") {
        out.push({ id: `${target.id}:${check.id}:${i}`, target, check });
      }
    }
  }
  return out.sort((a, b) => rank(b.check.verdict) - rank(a.check.verdict));
}

function rank(v: Verdict): number {
  return v === "CRIT" ? 2 : v === "WARN" ? 1 : 0;
}

/**
 * 알람을 컨텍스트에 끌어다 놓았을 때 들어갈 글.
 *
 * 교정 agent 가 이것만 보고 판단할 수 있어야 한다 — 무엇이, 어디서, 얼마나, 어떤 기준에
 * 걸렸는지, 그리고 원본이 어디 있는지. 사람이 다시 타이핑해 채워 넣게 만들지 않는다.
 */
export function alarmText(alarm: Alarm, doc: StatusDoc | null, source: string): string {
  const t = alarm.target;
  const c = alarm.check;
  const where = [t.role, t.engine, t.private_ip ?? t.ip, t.hostname].filter(Boolean).join(" · ");
  const lines = [
    `[${c.verdict}] ${t.id} (${where})`,
    `  ${c.id} ${c.name}`,
    `  값: ${c.value === null || c.value === undefined ? "—" : String(c.value)}`,
    `  기준: ${c.rule ?? "—"}`,
  ];
  if (c.note) lines.push(`  비고: ${c.note}`);
  if (t.design_ref) lines.push(`  설계 근거: ${t.design_ref}`);
  if (doc?.generated_at) lines.push(`  점검 시각: ${doc.generated_at}`);
  lines.push(`  출처: ${source}`);
  return lines.join("\n");
}

/* ── 설계에서 오는 토폴로지 ────────────────────────────────
   선은 점검이 아니라 **설계**에서 나온다.

   점검(status-middleware.json)이 로그 전용으로 좁혀지면서 업스트림 도달성(A05)이
   사라졌고, 그래서 관계를 그릴 근거가 없어졌다. 하지만 "누가 누구에게 붙도록 설계됐는가"는
   애초에 점검이 아니라 설치 확정값이 아는 것이다 — infra_confirmed.json 이 그 자리다.

   그래서 이 화면은 두 곳을 겹쳐 본다.
     설계(무엇이 어떻게 붙어 있어야 하는가) + 점검(그 대상이 지금 어떤 상태인가)
   선이 말하는 것은 "설계상 연결"이지 "지금 트래픽이 흐른다"가 아니다. */

export interface DesignNode {
  id: string;
  role: "web" | "was";
  hostname: string;
  ip: string;
  privateIp: string | null;
  /** 서비스 포트(web 80 / was 8180). */
  port: number | null;
  /** WAS 가 WEB 의 요청을 받는 포트. */
  ajpPort: number | null;
  instance: string | null;
  jvmRoute: string | null;
}

export interface DesignLink {
  from: string;
  to: string;
  /** 붙는 자리 — 상대의 사설 주소와 포트. */
  address: string;
  port: number;
  /** 그 위로 무엇이 오가는가(AJP/1.3 등). 설계가 정한 값이다. */
  protocol: string;
}

export interface DesignTopology {
  nodes: DesignNode[];
  links: DesignLink[];
  source: string;
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 설치 확정값에서 노드와 간선을 세운다.
 *
 * 간선은 web 마다 모든 was 로 간다 — mod_jk 가 두 WAS 를 worker 로 물고 세션 스티키니스로
 * 나눠 보내는 구성이라, 설계상 둘 다에 붙어 있다. 한쪽만 그리면 그림이 설계를 왜곡한다.
 */
export function designTopology(raw: unknown, source: string): DesignTopology | null {
  const doc = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!doc) return null;

  const mk = (r: Record<string, unknown>, role: "web" | "was", i: number): DesignNode => ({
    id: `${role}-${i + 1}`,
    role,
    hostname: str(r.hostname) ?? `${role}-${i + 1}`,
    ip: str(r.ip) ?? "",
    privateIp: str(r.private_ip),
    port: int(r.inst_port),
    ajpPort: int(r.ajp_port),
    instance: str(r.instance),
    jvmRoute: str(r.jvm_route),
  });

  const webs = rows(doc.web_servers).map((r, i) => mk(r, "web", i));
  const wases = rows(doc.was_servers).map((r, i) => mk(r, "was", i));
  if (webs.length === 0 && wases.length === 0) return null;

  // 프로토콜은 설계가 적어 둔 것을 그대로 쓴다 — 화면이 정하지 않는다.
  const tomcat = doc.tomcat_standard as Record<string, unknown> | undefined;
  const tuning = tomcat?.connector_tuning as Record<string, unknown> | undefined;
  const protocol = str(tuning?.protocol) ?? "AJP";

  const links: DesignLink[] = [];
  for (const w of webs) {
    for (const a of wases) {
      const port = a.ajpPort;
      if (port === null) continue;
      links.push({
        from: w.id,
        to: a.id,
        address: a.privateIp ?? a.ip,
        port,
        protocol,
      });
    }
  }
  return { nodes: [...webs, ...wases], links, source };
}

/** 설계의 마디와 점검 대상을 잇는다. 주소와 역할이 같으면 같은 것이다. */
export function matchStatus(node: DesignNode, targets: StatusTarget[]): StatusTarget | null {
  return (
    targets.find(
      (t) =>
        (t.ip === node.ip || t.private_ip === node.ip || t.ip === node.privateIp) &&
        (t.role ?? "").toLowerCase() === node.role,
    ) ?? null
  );
}
