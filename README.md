# architecture-agent-ui

[architecture-agent](https://github.com/sftth/architecture-agent) 프로젝트의 sub-agent 파이프라인을
브라우저에서 실행하고 실시간으로 모니터링하는 관제 콘솔입니다.

## 동작 방식

- 백엔드는 `claude` CLI를 서브프로세스로 실행하면서 `cwd`를 architecture-agent 프로젝트 경로로
  지정합니다. 그 경로의 `CLAUDE.md` / `.claude/agents` / `.claude/hooks`가 그대로 적용됩니다.
- 이 UI는 여러 사람이 하나의 백엔드 프로세스를 공유해서 쓰되, **이메일/비밀번호 계정마다**
  자기가 clone해 둔 architecture-agent 경로를 환경 설정으로 저장해두고 사용합니다(경로가 사람마다
  달라도 됨). 로그인하면 저장된 경로로 바로 실행되므로 접속할 때마다 경로를 입력할 필요가 없고,
  다른 브라우저/기기에서 로그인해도 같은 설정이 따라옵니다.
- 경로 변경, 비밀번호 변경, 로그아웃은 헤더의 **환경 설정**(또는 경로 배지)에서 합니다.
- run 기록과 실시간 로그는 계정 단위로 격리되어 다른 사람의 run은 조회되지 않습니다.

## 사전 준비

- Python 3.12, [uv](https://docs.astral.sh/uv/)
- Node.js 18+, npm
- [`claude` CLI](https://docs.claude.com/en/docs/claude-code) 설치 및 로그인 완료. 최신 버전 권장 —
  `backend/app/runner.py`가 쓰는 `--forward-subagent-text` 플래그가 없는 구버전(예: 2.1.123)에서는
  `error: unknown option '--forward-subagent-text'`가 남. `claude update`로 갱신하면 해결됨
  (2.1.220에서 확인)
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
| `USER_STORE_PATH` | `backend/data/users.json` | 계정(이메일/비밀번호 해시)과 계정별 architecture-agent 경로를 저장할 파일 위치 |
| `SESSION_STORE_PATH` | `backend/data/sessions.json` | 로그인 토큰(해시)을 저장할 파일 위치. 백엔드를 재시작해도 로그인이 유지됩니다 |
| `SESSION_TTL_DAYS` | `30` | 로그인 유효 기간(일) |
| `PBKDF2_ITERATIONS` | `240000` | 비밀번호 해싱 반복 횟수 |

> 계정 파일에는 비밀번호 해시(PBKDF2-SHA256 + salt)와 세션 토큰 해시가 들어 있어 `0600`으로
> 저장됩니다. `backend/data/`는 `.gitignore` 대상이라 커밋되지 않습니다.
>
> 인증 토큰은 `Authorization: Bearer` 헤더로 평문 전송되므로, 사내망 밖에 노출하는 경우
> nginx 등 앞단에서 HTTPS를 적용하세요.

## 프론트엔드 기동

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173`에서 접속합니다. Vite dev 서버가 `/api`, `/ws` 요청을 `http://localhost:8000`
백엔드로 프록시합니다(`frontend/vite.config.ts`). 백엔드를 다른 포트/호스트로 띄웠다면 이 설정을
맞춰 수정하세요.

> **원격 서버(EC2 등)에 띄워 다른 PC 브라우저로 접속하는 경우**: `npm run dev`는 기본적으로
> `127.0.0.1`(루프백)에만 바인딩되어 서버 밖에서는 접속할 수 없습니다. 반드시 `--host`를 붙이세요.
>
> ```bash
> npm run dev -- --host 0.0.0.0 --port 5173
> ```
>
> 백엔드는 vite가 같은 서버 안에서 `localhost:8000`으로 내부 프록시하므로 `127.0.0.1` 바인딩 그대로
> 둬도 됩니다(외부에 직접 노출할 필요 없음). 그래도 브라우저에서 접속이 안 되면 AWS 보안그룹 등에서
> 5173 포트 인바운드가 열려 있는지 확인하세요.

## 첫 실행 시

1. 브라우저로 프론트엔드(`http://localhost:5173`)에 접속하면 로그인 화면이 뜹니다.
2. **회원가입** 탭에서 이메일 / 비밀번호(8자 이상)와 함께, 로컬에 clone해 둔 architecture-agent의
   절대 경로(예: `/home/사용자명/architecture-agent`)를 입력합니다. 경로는 비워두고 가입한 뒤
   환경 설정 화면에서 나중에 지정해도 됩니다.
3. 저장한 경로에 `.claude/agents`가 확인되면 파이프라인 화면으로 넘어갑니다. 확인되지 않으면
   환경 설정 화면이 먼저 뜨고, 경로를 고치면 바로 콘솔로 넘어갑니다.
4. 이후에는 로그인만 하면 저장된 경로로 곧바로 실행됩니다. 로그인 상태는 브라우저
   `localStorage`의 토큰으로 유지되며 기본 30일간 유효합니다.

## 환경 설정 화면

헤더의 **환경 설정** 버튼(또는 경로 배지)을 누르면 열립니다.

- **architecture-agent 경로**: 절대 경로를 저장합니다. 저장 시 서버에서 디렉토리 존재 여부와
  `.claude/agents` 유무를 확인해 상태를 표시합니다.
- **비밀번호 변경**: 현재 비밀번호 확인 후 변경합니다. 변경하면 지금 쓰는 브라우저를 제외한
  다른 기기의 로그인은 모두 해제됩니다.
- **로그아웃**: 현재 브라우저의 토큰을 서버에서 폐기합니다.

## 서버에 상시 구동시키기 (systemd)

SSH 세션을 끊거나 서버를 재부팅해도 계속 떠 있게 하려면 systemd 서비스로 등록하세요.
`ExecStart`의 경로는 실제 설치 경로/사용자에 맞게 바꾸세요(`uv`, node 버전 등은 `which uv`,
`which node`로 절대경로를 확인해서 채우면 됩니다 — systemd는 로그인 셸의 PATH를 쓰지 않습니다).

> **중요**: `claude` CLI가 `~/.local/bin` 등 PATH에만 등록돼 있고 systemd 서비스 환경에는
> 없는 경우, 실행 시 `'claude' 실행 파일을 찾을 수 없습니다`가 납니다. 아래처럼 `CLAUDE_BIN`을
> `which claude`로 확인한 절대경로로 지정하세요.

`/etc/systemd/system/architecture-agent-ui-backend.service`:

```ini
[Unit]
Description=architecture-agent-ui backend (FastAPI/uvicorn)
After=network.target

[Service]
Type=simple
User=ec2-user
Environment=CLAUDE_BIN=/home/ec2-user/.local/bin/claude
WorkingDirectory=/home/ec2-user/architecture-agent-ui/backend
ExecStart=/home/ec2-user/architecture-agent-ui/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/architecture-agent-ui-frontend.service`:

```ini
[Unit]
Description=architecture-agent-ui frontend (vite dev server)
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/architecture-agent-ui/frontend
ExecStart=/home/ec2-user/.nvm/versions/node/v24.14.1/bin/node /home/ec2-user/architecture-agent-ui/frontend/node_modules/.bin/vite --host 0.0.0.0 --port 5173
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

등록 및 기동:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now architecture-agent-ui-backend architecture-agent-ui-frontend
```

상태 확인 / 로그:

```bash
systemctl status architecture-agent-ui-backend architecture-agent-ui-frontend
journalctl -u architecture-agent-ui-backend -f
journalctl -u architecture-agent-ui-frontend -f
```

## 프로덕션 빌드

```bash
cd frontend
npm run build   # frontend/dist 생성
```

정적 파일을 백엔드 앞단(nginx 등)에 서빙하거나 별도 정적 호스팅에 배포하고, `/api`, `/ws`를
백엔드로 프록시하도록 구성하세요.
