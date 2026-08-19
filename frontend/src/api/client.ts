import type {
  DirListing,
  FileText,
  LogEvent,
  ModelDef,
  ProjectDef,
  RunSummary,
  StageDef,
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

export async function listRuns(): Promise<RunSummary[]> {
  return request<RunSummary[]>("/api/runs");
}

export async function getRun(runId: string): Promise<{ summary: RunSummary; events: LogEvent[] }> {
  return request<{ summary: RunSummary; events: LogEvent[] }>(`/api/runs/${runId}`);
}

export async function stopRun(runId: string): Promise<void> {
  await request<{ stopped: boolean }>(`/api/runs/${runId}/stop`, { method: "POST" });
}

// WebSocket은 브라우저에서 헤더를 붙일 수 없어 토큰을 쿼리스트링으로 넘긴다.
export function openRunSocket(runId: string, onEvent: (event: LogEvent | null) => void): () => void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(
    `${protocol}://${window.location.host}/ws/runs/${runId}?token=${encodeURIComponent(getToken() ?? "")}`
  );
  socket.onmessage = (msg) => {
    const parsed = JSON.parse(msg.data) as LogEvent;
    if ((parsed as { kind: string }).kind === "error") {
      onEvent(null);
      return;
    }
    onEvent(parsed);
    if (parsed.kind === "run_end") {
      onEvent(null);
    }
  };
  return () => socket.close();
}
