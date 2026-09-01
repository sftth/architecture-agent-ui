import type {
  DirListing,
  FileText,
  LogEvent,
  ModelDef,
  ProjectDef,
  RunSummary,
  StageDef,
  UsageSummary,
  UserProfile,
} from "../types";

const TOKEN_KEY = "architecture-agent-ui:token";

// 토큰이 만료/폐기됐을 때(401) App이 로그인 화면으로 되돌리기 위해 쓰는 이벤트.
export const AUTH_EXPIRED_EVENT = "architecture-agent-ui:auth-expired";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// credentialCheck: 로그인/회원가입처럼 401이 "세션 만료"가 아니라 "자격 증명 오류"인 요청.
// 이 경우 세션 만료 처리로 가로채지 않고 서버 메시지를 그대로 올린다.
async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { credentialCheck?: boolean } = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && !options.credentialCheck) {
    clearToken();
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    throw new Error("로그인이 필요합니다");
  }
  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function errorMessage(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) return parsed.detail.map((d: any) => d.msg).join(", ");
  } catch {
    /* JSON이 아니면 원문을 그대로 쓴다 */
  }
  return body || `${res.status} ${res.statusText}`;
}

interface AuthResponse {
  token: string;
  user: UserProfile;
}

export async function register(
  email: string,
  password: string,
  architectureAgentDir?: string
): Promise<UserProfile> {
  const res = await request<AuthResponse>(
    "/api/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        architecture_agent_dir: architectureAgentDir || null,
      }),
    },
    { credentialCheck: true }
  );
  setToken(res.token);
  return res.user;
}

export async function login(email: string, password: string): Promise<UserProfile> {
  const res = await request<AuthResponse>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
    { credentialCheck: true }
  );
  setToken(res.token);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  } finally {
    clearToken();
  }
}

export async function fetchMe(): Promise<UserProfile> {
  return request<UserProfile>("/api/auth/me");
}

export async function updateAgentDir(architectureAgentDir: string): Promise<UserProfile> {
  return request<UserProfile>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ architecture_agent_dir: architectureAgentDir }),
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await request<{ ok: boolean }>("/api/auth/password", {
    method: "PUT",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export async function getCatalog(): Promise<{ stages: StageDef[] }> {
  return request<{ stages: StageDef[] }>("/api/catalog");
}

export async function getProjects(): Promise<{ projects: ProjectDef[] }> {
  return request<{ projects: ProjectDef[] }>("/api/projects");
}

export async function createRun(
  agentKey: string,
  prompt: string,
  project?: string | null,
  model?: string | null,
  effort?: string | null
): Promise<RunSummary> {
  return request<RunSummary>("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      agent_key: agentKey,
      prompt,
      project: project || null,
      model: model || null,
      effort: effort || null,
    }),
  });
}

export async function getModels(): Promise<{ models: ModelDef[] }> {
  return request<{ models: ModelDef[] }>("/api/models");
}

export async function createProject(name: string): Promise<{ name: string; created: string[] }> {
  return request("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
}

export async function renameProject(
  name: string,
  newName: string
): Promise<{ name: string; moved: string[] }> {
  return request(`/api/projects/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ new_name: newName }),
  });
}

/** 지우지 않고 temp/trash 로 옮긴다. 응답의 trash 경로가 어디로 갔는지 알려 준다. */
export async function deleteProject(
  name: string
): Promise<{ name: string; moved: string[]; trash: string }> {
  return request(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function listWorkspace(path: string): Promise<DirListing> {
  return request<DirListing>(`/api/workspace/list?path=${encodeURIComponent(path)}`);
}

export async function readWorkspaceText(path: string): Promise<FileText> {
  return request<FileText>(`/api/workspace/text?path=${encodeURIComponent(path)}`);
}

/** <img src>는 헤더를 못 붙이므로 토큰을 쿼리로 실어 보낸다(WebSocket과 같은 방식). */
export function workspaceRawUrl(path: string): string {
  return `/api/workspace/raw?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken() ?? "")}`;
}

/**
 * 이미 있는 세션에 이어서 묻는다.
 *
 * 전에는 이 길이 없어서 보내기가 늘 createRun 이었다 — 이력에서 세션을 골라 물어도
 * 그 옆에 새 세션이 하나 더 생겼고, 에이전트도 앞 이야기를 몰랐다.
 */
export async function continueRun(
  runId: string,
  prompt: string,
  agentKey: string,
  project: string,
  model: string,
  effort: string,
): Promise<RunSummary> {
  return request<RunSummary>(`/api/runs/${runId}/turn`, {
    method: "POST",
    body: JSON.stringify({
      prompt,
      agent_key: agentKey,
      project: project || null,
      model: model || null,
      effort: effort || null,
    }),
  });
}

export async function listRuns(): Promise<RunSummary[]> {
  return request<RunSummary[]>("/api/runs");
}

export async function getRun(runId: string): Promise<{ summary: RunSummary; events: LogEvent[] }> {
  return request<{ summary: RunSummary; events: LogEvent[] }>(`/api/runs/${runId}`);
}

export async function stopRun(runId: string): Promise<void> {
  await request<{ stopped: boolean }>(`/api/runs/${runId}/stop`, { method: "POST" });
}

export async function getUsage(): Promise<UsageSummary> {
  return request<UsageSummary>("/api/usage");
}

export async function renameRun(runId: string, title: string): Promise<RunSummary> {
  return request<RunSummary>(`/api/runs/${runId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

/** 도는 중이면 서버가 먼저 멈춘 뒤 지운다. */
export async function deleteRun(runId: string): Promise<void> {
  await request<void>(`/api/runs/${runId}`, { method: "DELETE" });
}

// WebSocket은 브라우저에서 헤더를 붙일 수 없어 토큰을 쿼리스트링으로 넘긴다.
/**
 * 로그 스트림을 연다.
 *
 * 실패도 반드시 이벤트로 흘려보낸다. 전에는 서버가 "run not found"를 보내도 null만
 * 넘겨 App이 그대로 버렸고, 화면에는 "연결 중"만 영원히 남아 무엇이 잘못됐는지
 * 알 방법이 없었다. 끊긴 것은 끊겼다고 로그에 적혀야 한다.
 */
export function openRunSocket(runId: string, onEvent: (event: LogEvent | null) => void): () => void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(
    `${protocol}://${window.location.host}/ws/runs/${runId}?token=${encodeURIComponent(getToken() ?? "")}`
  );
  // 정상 종료(run_end)거나 우리가 스스로 닫은 경우엔 onclose에서 또 알리지 않는다.
  let settled = false;

  const report = (text: string) => {
    settled = true;
    onEvent({
      seq: Number.MAX_SAFE_INTEGER,
      ts: new Date().toISOString(),
      kind: "stderr",
      parent_tool_use_id: null,
      data: null,
      text,
    });
    onEvent(null);
  };

  socket.onmessage = (msg) => {
    const parsed = JSON.parse(msg.data) as LogEvent;
    const kind = (parsed as { kind: string }).kind;
    if (kind === "error") {
      const detail = parsed.text ?? "";
      report(
        detail === "run not found"
          ? "이 세션의 로그가 서버에 없습니다. 실행 기록은 백엔드 메모리에만 있어, 백엔드가 다시 뜨면 사라집니다."
          : detail === "unauthorized"
            ? "로그인이 만료되어 로그를 받을 수 없습니다. 다시 로그인하세요."
            : `로그 연결이 거부되었습니다: ${detail}`,
      );
      return;
    }
    onEvent(parsed);
    if (parsed.kind === "run_end") {
      settled = true;
      onEvent(null);
    }
  };

  // onerror 뒤에는 반드시 onclose가 따라오므로, 알리는 것은 한쪽에서만 한다.
  socket.onclose = () => {
    if (settled) return;
    report("로그 연결이 끊어졌습니다. 백엔드가 살아 있는지 확인하세요.");
  };

  return () => {
    settled = true;
    socket.close();
  };
}
