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
uv run uvicorn app.main:app --reload --port 9000 --timeout-graceful-shutdown 5
```

기본적으로 `http://localhost:9000`에서 API 서버가 뜹니다. 헬스체크: `curl http://localhost:9000/api/health`

> `--timeout-graceful-shutdown 5`를 빼지 마세요. `--reload`는 백엔드 파일이 바뀔 때마다
> 워커를 재시작하는데, uvicorn은 그 전에 열린 연결이 닫히기를 기다립니다. 화면이 실행 로그를
> 보고 있으면 WebSocket이 계속 열려 있으므로 그 기다림이 끝나지 않고, supervisor가
> `join()`에서 멈춘 채 리스닝 소켓을 쥐고 있어 API 전체가 응답하지 않게 됩니다.
> 이 옵션이 5초 뒤 강제로 끊어 재시작을 끝냅니다.

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

`http://localhost:5274`에서 접속합니다. Vite dev 서버가 `/api`, `/ws` 요청을 `http://localhost:9000`
백엔드로 프록시합니다(`frontend/vite.config.ts`). 백엔드를 다른 포트/호스트로 띄웠다면 이 설정을
맞춰 수정하세요.

> **원격 서버(EC2 등)에 띄워 다른 PC 브라우저로 접속하는 경우**: `npm run dev`는 기본적으로
> `127.0.0.1`(루프백)에만 바인딩되어 서버 밖에서는 접속할 수 없습니다. 반드시 `--host`를 붙이세요.
>
> ```bash
> npm run dev -- --host 0.0.0.0 --port 5274
> ```
>
> 백엔드는 vite가 같은 서버 안에서 `localhost:9000`으로 내부 프록시하므로 `127.0.0.1` 바인딩 그대로
> 둬도 됩니다(외부에 직접 노출할 필요 없음). 그래도 브라우저에서 접속이 안 되면 AWS 보안그룹 등에서
> 5274 포트 인바운드가 열려 있는지 확인하세요.

## 첫 실행 시

1. 브라우저로 프론트엔드(`http://localhost:5274`)에 접속하면 로그인 화면이 뜹니다.
2. **회원가입** 탭에서 이메일 / 비밀번호(8자 이상)와 함께, 로컬에 clone해 둔 architecture-agent의
   절대 경로(예: `/home/사용자명/architecture-agent`)를 입력합니다. 경로는 비워두고 가입한 뒤
   환경 설정 화면에서 나중에 지정해도 됩니다.
3. 저장한 경로에 `.claude/agents`가 확인되면 파이프라인 화면으로 넘어갑니다. 확인되지 않으면
   환경 설정 화면이 먼저 뜨고, 경로를 고치면 바로 콘솔로 넘어갑니다.
4. 이후에는 로그인만 하면 저장된 경로로 곧바로 실행됩니다. 로그인 상태는 브라우저
   `localStorage`의 토큰으로 유지되며 기본 30일간 유효합니다.

## 프로젝트 선택 (input/{project})

architecture-agent는 입력 자료를 `input/{project}/doc`, `input/{project}/img/{doc_id}` 로
프로젝트별 격리해 여러 프로젝트를 동시에 수행합니다. 그리고 프로젝트가 명시되지 않으면
에이전트가 자동으로 고르지 않고 **후보를 나열한 뒤 사용자 확인을 기다립니다**(CLAUDE.md의
Input File Management Rules). 이 UI는 `claude -p` 비대화형으로 실행하므로 그 되물음에
답할 수 없어, 확인을 기다리다 아무 작업도 못 하고 끝납니다.

그래서 **좌측 레일 맨 위**에 프로젝트 선택기를 두었습니다. 단계·스테이지·입력/산출물 경로를
모두 가르는 값이라 화면에서 가장 먼저 정하는 자리에 둡니다.

- 목록은 실행 대상 경로의 `input/*/` 를 읽어 채웁니다(문서 수 / 변환된 이미지 문서 수 표시).
- 선택하면 실행 시 지시문 뒤에 `(프로젝트: {key})` 가 붙어 나갑니다. 우측 입력판에도 지금 값이
  표시되며(미지정이면 앰버로), 고른 값은 모든 단계에 함께 적용됩니다.
- **프로젝트를 지정하지 않고 실행하면 경고 창이 먼저 뜹니다.** 거기서 바로 프로젝트를 골라
  실행할 수 있고, 프로젝트가 필요 없는 에이전트(공통 유틸리티 등)를 위해 "프로젝트 없이 그대로
  실행"으로 빠져나갈 수도 있습니다.
- `공통 유틸리티`처럼 프로젝트가 필요 없는 에이전트를 위해 **프로젝트 지정 안 함**을 고르면
  지시문은 그대로 전달됩니다.

## 모델 · effort 선택

입력판 아래 **MODEL** 칩을 누르면 모델과 effort를 고르는 메뉴가 위로 열립니다
(claude CLI의 `--model` / `--effort`).

- 모델: Default(세션 기본값) · Opus 5 · Fable 5 · Sonnet 5 · Haiku 4.5. 이름으로 거를 수 있습니다.
- effort: 왼쪽이 낮고 오른쪽이 높은 점 트랙(`low` → `max`)이며, 맨 왼쪽 점은 "지정 안 함"입니다.
  **Haiku 4.5는 effort를 지원하지 않아** 그 자리에 안내가 뜹니다.
- 고르지 않으면 플래그를 아예 붙이지 않아 CLI 기본값으로 실행됩니다.
- 두 값 모두 실행 시 argv로 나가므로, 서버가 목록에 있는 값인지 검증한 뒤에만 붙입니다
  (모르는 모델·잘못된 effort 조합은 400).

## 프로젝트 추가 · 이름 변경 · 삭제

좌측 레일 프로젝트 칸의 **관리** 단추를 누르면 프로젝트 관리 창이 열립니다.

- **추가**: `input/{name}/doc` 와 `input/{name}/img` 를 만듭니다. `output/`·`report/` 는 에이전트가
  산출물을 낼 때 생깁니다. 이름은 한글·영문·숫자와 `- _ 공백`만 쓸 수 있고 64자까지입니다
  (경로 조각으로 쓰이므로 `/`·`..`·앞 점은 서버가 거부합니다).
- **이름 변경**: `{project}` 토큰은 `input/`·`output/`·`report/` 에서 같은 이름을 써야 하므로
  (CLAUDE.md), 세 곳에 있는 같은 이름 디렉토리를 **함께** 옮깁니다. 한 곳이라도 대상 이름이
  이미 있으면 아무것도 옮기지 않고 멈춥니다 — 절반만 바뀐 상태가 가장 나쁩니다.
- **삭제**: 지우지 않고 `temp/trash/{name}-{날짜시각}/` 로 옮깁니다. 여기 들어 있는 것이 고객
  요건 문서 원본이라 한 번의 실수로 복구 불가가 되지 않게 했습니다. 완전히 비우는 일은
  서버에서 사람이 직접 합니다.

## 하네스 표시

가운데 위쪽 띠는 지금 겨누고 있는 sub-agent가 속한 스테이지의 **하네스(plan → impl → eval)** 를
카탈로그에서 직접 읽어 보여 줍니다. 실행 중인 sub-agent는 깜빡이는 점과 앰버로 표시됩니다.

- 이름 끝으로 역할을 나눕니다: `{대상}-plan` / `{대상}-impl` / `{대상}-eval`.
- 한 칸에 6개까지만 세우고 나머지는 `+N개`로 알립니다(CI/CD 스테이지는 impl만 8개).
- 칸의 sub-agent를 누르면 그대로 실행 대상이 됩니다.

## 입력·산출물 확인

각 단계 화면 위쪽에 **입력 · 산출물** 표가 있습니다. 실행 로그는 에이전트가 "했다"고 말한
내용이고, 이 칸에 보이는 파일이 실제로 남은 것입니다. 경로는 architecture-agent의
CLAUDE.md에 정의된 Input/Output File Management Rules를 그대로 따릅니다.

| 단계 | 입력 | 산출물 |
|---|---|---|
| 분석 | `input/{project}/doc` · `input/{project}/img` | `output/{project}/spec` |
| 설계 | `output/{project}/spec` | `output/{project}/design` · `output/{project}/confirmed` |
| 구현 | `output/{project}/design` · `output/{project}/confirmed` | `report/{project}` · `output/{project}/scripts` · `output/{project}/doc` |

- 이름 · 종류 · 크기 · 수정 시각을 표로 보여 주고, 줄마다 **보기**(모달)와 **내려받기**가 있습니다.
- 디렉토리는 눌러서 안으로 들어갑니다(`img/{doc_id}` 등).
- md·json·txt 등은 본문을 그대로 보여 주고(앞 256KB), png 같은 이미지는 모달에 띄웁니다.
  docx·pptx처럼 글로 열 수 없는 파일은 내려받아 확인합니다.
- 지금 보고 있는 run이 시작된 뒤에 바뀐 파일에는 **이번 실행** 표시가 붙습니다(페이지를 새로
  열면 표시는 사라집니다 — 지속 추적이 아니라 이번 화면에서의 비교입니다).
- **읽기 전용입니다.** 이 화면에서 파일을 고치거나 지울 수는 없습니다.
- 열람 범위는 `input/` · `output/` · `report/` 세 곳으로 제한되며, 그 밖의 경로(`.claude/`,
  상위 디렉토리 등)는 서버가 거부합니다.

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
ExecStart=/home/ec2-user/architecture-agent-ui/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 9000 --reload --timeout-graceful-shutdown 5
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
ExecStart=/home/ec2-user/.nvm/versions/node/v24.14.1/bin/node /home/ec2-user/architecture-agent-ui/frontend/node_modules/.bin/vite --host 0.0.0.0 --port 5274
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
