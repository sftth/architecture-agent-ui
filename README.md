# architecture-agent-ui

[architecture-agent](https://github.com/sftth/architecture-agent) 프로젝트의 sub-agent 파이프라인을
브라우저에서 실행하고 실시간으로 모니터링하는 관제 콘솔입니다.

## 동작 방식

- 백엔드는 `claude` CLI를 서브프로세스로 실행하면서 `cwd`를 architecture-agent 프로젝트 경로로
  지정합니다. 그 경로의 `CLAUDE.md` / `.claude/agents` / `.claude/hooks`가 그대로 적용됩니다.
- 이 UI는 여러 사람이 하나의 백엔드 프로세스를 공유해서 쓰되, 각자 자신의 브라우저에 저장된
  `client_id`를 기준으로 **자기가 clone해 둔 architecture-agent 경로**를 서버에 저장해두고
  사용합니다(경로가 사람마다 달라도 됨). 최초 접속 시 경로 입력 화면이 뜨고, 이후에는 헤더의
  경로 배지를 눌러 언제든 변경할 수 있습니다.

## 사전 준비

- Python 3.12, [uv](https://docs.astral.sh/uv/)
- Node.js 18+, npm
- [`claude` CLI](https://docs.claude.com/en/docs/claude-code) 설치 및 로그인 완료
- 실행할 [architecture-agent](https://github.com/sftth/architecture-agent) 프로젝트를 로컬에 clone

## 백엔드 기동

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

기본적으로 `http://localhost:8000`에서 API 서버가 뜹니다. 헬스체크: `curl http://localhost:8000/api/health`

### 백엔드 환경변수 (선택)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CLAUDE_BIN` | `claude` | 실행할 claude CLI 바이너리 경로 |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | claude CLI 권한 프롬프트 처리 방식 (비대화형 실행이라 우회 필요) |
| `CLIENT_CONFIG_PATH` | `backend/data/client_configs.json` | 사용자별 architecture-agent 경로 설정을 저장할 파일 위치 |

## 프론트엔드 기동

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173`에서 접속합니다. Vite dev 서버가 `/api`, `/ws` 요청을 `http://localhost:8000`
백엔드로 프록시합니다(`frontend/vite.config.ts`). 백엔드를 다른 포트/호스트로 띄웠다면 이 설정을
맞춰 수정하세요.

## 첫 실행 시

1. 브라우저로 프론트엔드(`http://localhost:5173`)에 접속하면 architecture-agent 경로 입력 화면이 뜹니다.
2. 로컬에 clone해 둔 architecture-agent의 절대 경로(예: `/home/사용자명/architecture-agent`)를 입력하고 저장합니다.
3. 저장한 경로에 `.claude/agents`가 확인되면 파이프라인 화면으로 넘어갑니다.
4. 경로는 브라우저(`localStorage`)에 저장된 `client_id` 기준으로 서버에 저장되므로, 다른 브라우저/기기로
   접속하면 다시 경로를 입력해야 합니다.

## 프로덕션 빌드

```bash
cd frontend
npm run build   # frontend/dist 생성
```

정적 파일을 백엔드 앞단(nginx 등)에 서빙하거나 별도 정적 호스팅에 배포하고, `/api`, `/ws`를
백엔드로 프록시하도록 구성하세요.
