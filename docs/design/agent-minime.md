# Agent 미니미 — 하네스 패널을 "직원 사무실"로

브랜치 `feat/agent-minime`. 원본 킷은 `Downloads/architecture agent minime/` (README.md · sprites.svg · preview.html).
미리보기: `docs/design/agent-minime-preview.html` — 로컬 HTTP 로 열면 아래 설계가 그대로 그려진다(`?light` 로 밝은 테마).

이 문서는 **무엇을, 어디에, 어떤 규칙으로** 세울지를 정한다. 구현은 이 문서를 따른다.

---

## 0. 한 문장

> sub-agent 는 **architecture-agent 라는 회사의 직원**이다. 부서(Plan·Impl·Eval·Comm)마다 셔츠 색이 다르고, 사람마다 생김새가 다르다. 일이 없으면 빈둥거리고, 일을 시키면 깜짝 놀라 달려가 노트북을 편다.

대상 화면은 `HarnessStrip` 의 `AgentBoard` — 지금 네 레인에 로봇 아이콘 + 이름 줄로 서 있는 자리다. 여기만 바꾼다.

---

## 1. 킷 분석

### 1.1 구조

| 항목 | 내용 |
|---|---|
| 그리드 | 16×24 픽셀. 캐릭터는 16×21, 위 3행은 머리 위 소품 자리(말풍선·스파크·경고·zzz) |
| 렌더 | 1×1 사각형 path 조합, `shape-rendering="crispEdges"`. 정수 배율(16/32/64 폭)에서 선명 |
| 상태 심볼 | `agent-idle` `agent-thinking` `agent-success` `agent-error` `agent-sleep` `agent-working` `agent-cap` |
| 애니 프레임 | `idle-1/2` (0.8s, 머리 1px 바운스) · `walk-1..4` (0.2s/f) |
| 파츠 | `m-hair` `m-head-skin` `m-neck-hands` `m-body` `m-legs-*` — **조합해서 새 상태를 만들 수 있다** |
| 표정 | `f-idle` `f-happy` `f-think` `f-error` `f-sleep` |
| 소품 | `p-headset` `p-glasses` `p-cap` `p-laptop` `p-bubble` `p-spark` `p-alert` `p-zzz` |
| 색 | 13개 CSS 변수(`--hair --skin --blush --eye --mouth --shirt --arm --zip --collar --pants --shoe --gear --accent`) + fallback |

### 1.2 제약 (구현에 그대로 영향)

- **`<img src="sprites.svg#…">` 로는 CSS 변수가 적용되지 않는다.** 시트를 문서에 인라인하고 `<use href="#…">` 로 참조해야 한다.
- 소품 4개는 색이 하드코딩되어 있다(`p-spark #2E9E6E`, `p-alert #E06B5A`, `p-zzz`, `p-bubble`). 우리 토큰과 다르므로 반입할 때 `var(--gate-mint)` `var(--gate-rose)` `var(--paper-500)` `var(--ink-800)` 으로 바꾼다. 화면 어디서나 "합격은 mint, 실패는 rose" 한 말투여야 한다.
- 킷의 상태 심볼(`agent-*`)은 **머리 모양·소품이 고정**이다. 사람마다 다르게 생기려면 상태 심볼을 쓰지 않고 **파츠를 직접 조합**해야 한다. 그래서 4.2 의 `frame()` 이 파츠 단위로 그린다.
- 밝은 테마에서 옷깃(`--collar #E9EEF6`)이 바탕과 겹친다. 옷깃과 장비색(`--gear`) 두 변수만 밝은 테마에서 덮는다. (미리보기 `?light` 로 확인함.)

### 1.3 우리 화면과 맞물리는 지점

| 우리 쪽 | 킷 쪽 | 비고 |
|---|---|---|
| `roleOf()` → plan / impl / eval, 토큰 `--role-*` | `--shirt --arm --zip` | 부서색 = 셔츠. 새 의미색을 들이지 않는다 |
| `activeSubAgents()` → 지금 도는 sub-agent 집합 | 누가 노트북을 펴나 | 이미 레인이 쓰는 값 |
| `activityOf()` → `boot think say tool agent read` | plan 의 말풍선 / 위임 대기 | 콘솔이 쓰는 값 |
| `RunStatus` → `success error stopped` | 스파크 / 경고 / 졸기 | 턴이 끝난 뒤 표정 |
| `registeredAgents()` → 세션 미등록 | 회색 실루엣 | "부를 수 없는 사람" |
| `agent.key` | 외형 hash 의 씨앗 · 명패 | 같은 이름은 늘 같은 얼굴 |

---

## 2. 왜 이렇게 — 그리고 지키는 선

설계 스킬은 "실행 시각화가 인시던트와 주의를 다투면 안 된다"와 "일이 일어난 순간에만 움직인다"(`motion.ts`)를 말한다. 직원 은유는 그 반대편에 서 있는 것처럼 보인다 — 빈둥거리는 것도 움직임이다.

둘을 이렇게 맞춘다.

- **자리를 하네스 판 하나로 못 박는다.** 단계 레일·토폴로지·APM·세션 서랍·입력판에는 서지 않는다. 인프라 상태가 있는 화면과 한 프레임에 같이 들어가는 것은 운영 단계인데, 그때도 미니미는 하네스 안에만 있다.
- **대기 움직임은 판 전체에서 한 번에 한 명.** 사람마다 타이머를 두지 않고 판이 하나의 시계로 3~6초마다 한 명을 골라 짧은 비트를 준다. 여덟 명이 서 있어도 사무실은 "가끔 누가 움직이는" 정도다.
- **일할 때 움직임은 사실에 붙는다.** 놀람·달리기·타이핑은 전부 `activeSubAgents()` 가 켜지는 순간과 켜져 있는 동안에만 있다. 추정으로 움직이지 않는다.
- **줄이기 설정을 따른다.** `prefers-reduced-motion` 이면 대기 비트를 끄고, 일하는 사람도 첫 프레임에 멈춘다. 표정·소품은 남아 정보는 같다.

---

## 3. 화면

### 3.1 판의 구조 — 부서와 바닥선

```
Plan/ 1          Impl/ 8                              Eval/ 8                Comm/ 4
                 🧍   🧍   🧍   🧍  ▸                  🧍   🧍   🧍   🧍  ▸    🧍   🧍   🧍   🧍
🧍               ────────────────────                 ───────────────────    ────────────────
cicd             argocd gitlab jenkins jenkins        argocd gitlab …        doc  html  wiki  general
                                       pipeline                                   report      purpose
```

- 레인은 그대로 넷이되 **부서**가 된다. 제목·색은 지금과 같다(`Plan/` 초록, `Impl/` 청록, `Eval/` 보라, `Comm/` cyan).
- 줄 목록 대신 **바닥선**(`--tick-quiet` 1px) 위에 직원이 옆으로 선다. 슬롯 폭 64px, 스프라이트 32×48(2배율), 그 아래 명패 두 줄.
- **레인 폭은 인원에 비례한다** — `grid-template-columns` 를 `clamp(1, 인원, 3)fr` 로. cicd 처럼 impl·eval 이 8명이면 그 둘이 넓어지고 Plan 은 한 칸이다. 지금의 균등 4분할에서는 Plan 레인 3/4 이 늘 비어 있었다.
- 넘치면 **그 레인만 가로 스크롤**(스크롤바 숨김, 오른쪽 끝에 12px 페이드로 "더 있다"를 말한다). 도는 직원이 시야 밖이면 `scrollIntoView({inline:"nearest"})` 로 끌어온다.
- 판 높이 142 → 150px. 제목 20 + 스프라이트 48 + 명패 26 + 여백.
- 빈 레인은 지금처럼 `—`.

### 3.2 직원 한 사람 — 외형

**셔츠는 부서, 나머지는 사람.** 셔츠·팔·지퍼는 레인의 역할색으로 고정이고, 그 밖은 `agent.key` 의 FNV-1a hash 로 결정한다. 같은 이름은 어느 세션·어느 화면에서든 같은 얼굴이다.

| 축 | 가짓수 | 값 |
|---|---|---|
| 머리 모양 | 5 | `h-short`(원본) `h-bob` `h-long` `h-spiky` `h-buzz` — 새 파츠 4개 |
| 머리색 | 6 | 갈색 · 검정 · 금발 · 적갈색 · 회색 · 남보라 |
| 피부 | 4 | `#F5CBA7 #E8B88E #C68642 #8D5524` |
| 소품 | 3 | 없음 · 안경 · 헤드셋 |

360 조합, 직원 62명. 같은 레인에서 머리모양+머리색이 겹치면 뒤 사람의 머리색을 한 칸 돌린다(구현 시 선택).

역할색 → 셔츠 매핑은 CSS 에만 있다:

```css
.minime--plan   { --shirt: var(--role-plan);  --arm: var(--role-plan-dim);  --zip: color-mix(in srgb, var(--role-plan) 65%, white); }
.minime--impl   { --shirt: var(--role-impl);  --arm: var(--role-impl-dim);  --zip: … }
.minime--eval   { --shirt: var(--role-eval);  --arm: var(--role-eval-dim);  --zip: … }
.minime--common { --shirt: var(--line-cyan);  --arm: var(--line-cyan-dim);  --zip: … }
```

밝은 테마는 `--role-*` 토큰이 이미 바뀌므로 셔츠는 따라온다. 옷깃·장비만 `[data-theme="light"] .minime { --collar:#c9d5e1; --gear:#5b6b8f }`.

### 3.3 명패 — 긴 이름을 어떻게 부르나

이름은 자르면 안 된다(`middleware-…` 는 지운 것이다). 대신 **부서 안에서 부르는 이름**을 쓴다. 규칙은 셋이고 순서대로 적용한다.

1. **역할 꼬리를 뗀다.** `-plan / -impl / -eval` 은 레인이 이미 말한다. (지금 `shortKey()` 가 하는 일)
2. **스테이지 공통 접두어를 뗀다.** 그 스테이지 카탈로그 이름들이 모두 공유하는 첫 단어들이다. cicd 는 `cicd-`, 운영은 `middleware-`, 공통은 `common-`. 접두어만 남는 이름(`cicd-plan` → 빈 문자열)은 접두어 자체를 이름으로 쓴다 → `cicd`.
3. **하이픈에서 두 줄로 나눈다.** 첫 단어가 1줄, 나머지가 2줄. 줄마다 64px 를 넘으면 그 줄만 말줄임.

실제 카탈로그(62개)에 돌린 결과:

| 스테이지 | 원래 이름 | 명패 |
|---|---|---|
| operation | `middleware-status-plan` / `middleware-remediate-impl` | `status` / `remediate` |
| cicd | `cicd-plan` / `cicd-jenkins-pipeline-impl` / `cicd-sonarqube-migrate-eval` | `cicd` / `jenkins`⏎`pipeline` / `sonarqube`⏎`migrate` |
| intent | `intent-plan` / `intent-convert-impl` | `intent` / `convert` |
| k8s | `k8s-helm-create-impl` | `helm`⏎`create` |
| common | `common-html-report-impl` | `html`⏎`report` |
| 밖 | `general-purpose` (카탈로그 밖, CLI 내장) | `general`⏎`purpose` — 접두어 계산에서 뺀다 |

전체 이름과 역할 설명(`agent.role`)은 `title` 과 전체 목록(Roster)에 그대로 있다. Roster 에도 같은 얼굴을 32px 로 세워 "이 사람이 그 사람"임을 잇는다.

### 3.4 발밑 — 고른 사람과 도는 사람

지금 줄의 왼쪽 2px 테두리(`agent-line--selected` cyan / `--live` mint)를 **발밑 받침 2px** 로 옮긴다. 고른 plan 은 `--line-cyan`, 도는 사람은 `--signal-amber`(진행 중 = amber 라는 판 전체의 규칙에 맞춘다 — 지금 레인만 mint 였다). 명패도 같은 색으로 켜진다.

---

## 4. 행동 — 한 사람이 겪는 순서

```
                    ┌──────────── 대기 비트(판에서 한 명씩) ────────────┐
   ▶ idle ──▶ 숨 · 잡담 · 커피 · 곁눈 ──▶ idle       (5분 넘게 아무 run 없음 → 졸기)
      │
      │ activeSubAgents 에 들어옴
      ▼
   surprise 0.6s ──▶ run 0.9s ──▶ typing (도는 동안) ──┬─▶ success 0.9s ──▶ idle
                                                        └─▶ error  (다음 지시까지 남는다)
```

| 상태 | 표정 · 소품 · 손 | 프레임 | 언제 |
|---|---|---|---|
| `idle` | `f-idle`, 채도 55% | 정지 | 기본. 레인 대부분 |
| `breathe` | `f-idle` | 2f 0.9s | 빈둥 — 숨 |
| `chat` | `f-look` + `p-bubble`(…) | 2f 1.8s | 빈둥 — 옆 사람과 잡담 |
| `coffee` | `p-mug`(오른손), 눈 감고 한 모금 | 2f 2.4s | 빈둥 |
| `glance` | `f-look` | 정지 0.9s | 빈둥 — 곁눈질 |
| `stretch` | `m-hands-up` + `f-sleep`, 1px 들림 | 2f 1.2s | 빈둥 — 스트레칭 |
| `walk` | 걷기 4f + 슬롯 안에서 10px 나갔다 돌아옴 | 4f 1.9s | 빈둥 — 어슬렁 |
| `hop` | 2px 점프 | 2f 0.7s | 빈둥 — 깡총 |
| `yawn` | `f-surprise` ↔ `f-sleep` | 2f 1.4s | 빈둥 — 하품 |
| `peek` | 노트북 + `f-look` ↔ `f-focus` | 2f 1.3s | 일하는 중 — 옆을 본다 |
| `doze` | `f-sleep` + `p-zzz` | 정지 | 마지막 run 이 끝난 지 5분 넘음. 다음 비트가 깨운다 |
| `surprise` | `f-surprise`(새) + `m-hands-up`(새) + `p-bang`(amber !, 새) | 정지 0.6s | `activeSubAgents` 에 새로 들어온 순간 |
| `run` | `f-idle`, `walk-1..4` + 몸 ±1px 기울기 | 4f 0.12s/f, 0.9s | surprise 직후 |
| `typing` | `f-focus`(새) + `p-laptop` + `m-hands-type-a/b`(새) | 2f 0.5s | 도는 동안 |
| `thinking` | `f-think` + `p-bubble` | 정지 | **plan 전용** — `activity.kind==="agent"`(위임 걸고 기다림) |
| `success` | `f-happy` + `p-spark`(mint) | 정지 0.9s → idle | 자기 위임이 닫혔고 run 이 살아 있음, 또는 run 이 success 로 끝남 |
| `error` | `f-error` + `p-alert`(rose) | 정지, **남는다** | run 이 error 로 끝났을 때 마지막에 돌던 사람(들) |
| `stopped` | `f-sleep` + `p-zzz` | 정지 | 사람이 멈춤 |
| `ghost` | `f-idle`, 그레이스케일 40% | 정지, 비트 대상 아님 | 세션 미등록 |

### 4.1 사무실의 시계 (2026-09-04 개정)

처음에는 판 전체에서 3~6초에 한 명만 움직이게 했는데, 실제로 보니 일하는 사람도 쉬는 사람도
"가만히 서 있는" 것으로 읽혔다. 사용자의 요청으로 이렇게 바꿨다.

- **일하는 사람은 멈추지 않는다.** 타이핑은 손과 함께 머리가 1px 끄덕이고(손만 움직이면 32px 에선
  정지와 같다), 2.5~6초마다 짧게 뛰어가거나(`run`) 옆을 본다(`peek`). 그 뒤 다시 타이핑.
- **쉬는 사람은 저마다의 시계로 빈둥거린다.** 4~12초마다 여덟 가지 중 하나를 무작위로 —
  숨·잡담·커피·곁눈·스트레칭·어슬렁(한 걸음 나갔다 돌아옴)·깡총·하품. 동시에 셋까지만.
- 시계는 판 하나(500ms 간격)다. 탭이 숨겨지면 멈춘다.
- **줄이기 설정이면 두 배 느리게 간다 — 멈추지 않는다.** 이 저장소의 규칙(b1a7f61)이다.
  `global.css` 가 모든 animation 을 0.001ms·1회로 만드므로 `Minime.css` 가 길이와 반복을
  `!important` 로 되찾고 `--slow: 2` 로 늦춘다.

### 4.2 전이 신호 — 어디서 오나

```
enter  = activeAgents(now) − activeAgents(prev)          → surprise → run → typing
leave  = activeAgents(prev) − activeAgents(now), run 살아 있음 → success flash → idle
run.status: running→error                               → 마지막 activeAgents 를 error 로 고정
run.status: running→success                             → 마지막 activeAgents success flash
run.status: →stopped                                    → 전원 stopped(zzz)… 다음 run 시작에 풀림
새 run 시작 (run.id 바뀜)                               → error/stopped 해제, 전원 idle
```

`usePrev(activeAgents)` (`motion.ts` 에 이미 있다)로 diff 를 만든다. 상태 기계는 사람별 `Map<key, {state, until}>` 하나로 `AgentBoard` 안에 둔다. 값은 만들지 않는다 — 전부 위 세 신호의 매핑이다.

---

## 5. 구현 설계

### 5.1 파일

```
frontend/src/
  sprites/
    agent-sprites.svg      원본 + 확장 파츠. 색 하드코딩 4곳은 토큰으로(§1.2)
    AgentSprites.tsx       ?raw 로 읽어 0×0 div 에 한 번 마운트. App 최상단 (display:none 이면 <use> 가 못 가져온다)
  minime/
    look.ts                fnv(key) → {hair, hairColor, skin, acc}
    name.ts                givenName(key, catalogKeys) → string[] (1~2줄)
    states.ts              MinimeState, 상태→프레임 조립표, 전이 시간
    useCrew.ts             activeAgents·run.status diff → Map<key, state>. 대기 비트 스케줄러도 여기(시계가 하나라서)
  components/
    Minime.tsx             <Minime look role state size/> — 프레임 svg 1~4장
    Minime.css             부서 팔레트 · 프레임 애니 · 채도 · reduced-motion
    HarnessStrip.tsx       Office / Floor / Employee. Roster 에 얼굴 추가
    HarnessStrip.css       .office/.dept/.floor/.emp (옛 .agent-board·.tree·.tnode 는 지웠다)
  dev/office.tsx + /dev-office.html
                           백엔드·로그인 없이 사무실만 그리는 개발용 화면.
                           http://localhost:5274/dev-office.html?scene=idle|enter|typing|error|stopped&stage=operation|cicd&theme=light
                           vite build 의 입력이 아니라 dist 에 들어가지 않는다.
```

### 5.2 새 파츠 (픽셀 좌표는 미리보기 HTML 에 확정되어 있다)

| id | 무엇 |
|---|---|
| `h-bob` `h-long` `h-spiky` `h-buzz` | 머리 4종 (원본 `m-hair` 는 `h-short` 로 이름 바꿈) |
| `f-surprise` | 눈 2×2, 입 벌림 |
| `f-look` | 눈·입 오른쪽 1px |
| `f-focus` | 눈 반쯤 — 타이핑 중 |
| `m-hands-up` | 양손 머리 옆으로 |
| `m-hands-type-a/b` | 노트북 위 손 두 프레임 |
| `m-neck` | 손 없는 목(커피·타이핑에서 기본 손을 빼기 위해) |
| `p-mug` | 오른손 머그 |
| `p-bang` | amber 느낌표 (`p-alert` 와 같은 모양, 색만) |

### 5.3 `Minime` 컴포넌트

```ts
interface MinimeProps {
  look: Look;                 // look.ts 출력
  role: Role | "common";      // 셔츠
  state: MinimeState;         // states.ts
  size?: 1 | 2;               // 16 / 32 폭. 판은 2, Roster 는 2, 그 밖에 안 쓴다
  title?: string;
}
```

- 프레임 수는 상태표가 정한다(1·2·4). 1장이면 `<svg><use…/></svg>` 하나. `position:absolute` 겹침 + `steps(1)` 은 킷 preview 방식 그대로.
- 색은 `style={{"--hair":…, "--skin":…}}` 인라인 두 개 + 클래스 `minime--{role}`. 나머지는 CSS.
- `aria-hidden`. 명패와 `title` 이 글자로 말한다.

### 5.4 판 CSS 요점

```css
.office { display:grid; grid-template-columns: var(--cols); height:150px; border-top:1px solid var(--line-cyan-dim); }
.dept   { min-width:0; padding:10px 12px 0; border-left:1px solid var(--tick-quiet); display:flex; flex-direction:column; }
.floor  { flex:1; display:flex; align-items:flex-end; gap:4px; overflow-x:auto; scrollbar-width:none;
          background: linear-gradient(to top, var(--tick-quiet) 0 1px, transparent 1px) no-repeat 0 calc(100% - 30px) / 100% 100%;
          mask-image: linear-gradient(to right, black calc(100% - 12px), transparent); }
.emp    { width:64px; display:flex; flex-direction:column; align-items:center; position:relative; }
.emp--selected::after, .emp--live::after { /* 발밑 2px 받침 */ }
.emp-name { font: 11px/1.2 var(--font-mono); color: var(--paper-500); }
```

### 5.5 성능·모션 예산

- 정지 직원 1명 = `<svg>` 1개 + `<use>` 9개. 8명 레인 = 72 `<use>`. 문제 없다.
- 동시에 프레임이 도는 사람: 일하는 사람 수(보통 1~2) + 대기 비트 1. 최대 3.
- 대기 비트는 `setTimeout` 하나. 탭 숨김·reduced-motion 이면 없다.
- `color-mix` 는 Chromium 111+. 이 콘솔은 사내 데스크톱 Chrome.

---

## 6. 하지 않는 것

- 사람에게 이름표 외의 정체(별명·성별·나이)를 붙이지 않는다. 얼굴은 hash 다.
- 레인 사이로 실제 걸어가는 연출을 하지 않는다. 달리기는 제자리다. 위임이 어디로 갔는지는 켜진 사람이 말한다.
- 말풍선에 글자를 넣지 않는다. 32px 에서 읽히지 않는다.
- 대기 비트를 사람마다 독립 타이머로 두지 않는다. 판이 하나의 시계다.
- 콘솔 하단 activity 줄·콘솔 머리에는 1차에서 세우지 않는다. 판이 자리 잡은 뒤 다시 본다.

---

## 7. 검증

2026-09-04 구현 시점에 한 것: `tsc --noEmit` · `vite build` 통과. `dev-office.html` 의 다섯 장면
(idle · enter · typing · error, 운영·cicd, 밝은·어두운 테마)을 헤드리스 Chrome 으로 찍어 명패 규칙,
부서 폭, 놀람·타이핑·말풍선·회색 실루엣·발밑 받침을 확인했다. 아래 3·4·6·7 은 실제 run 으로 아직 못 봤다.
헤드리스의 `--virtual-time-budget` 은 타이머만 앞당기고 `Date.now()` 는 그대로라, 시간이 걸리는 전이(성공
스파크·실패 고정)는 그 방식으로는 정지 화면에 잡히지 않는다 — 실제 브라우저에서 본다.

1. `tsc --noEmit` · `vite build`.
2. 어두운/밝은 테마에서 운영·cicd 스테이지 스크린샷 — 셔츠가 레인 제목색과 같은 색으로 읽히는지, 명패가 위 표와 같은지.
3. 실제 run: plan 이 impl 을 부르는 순간 그 impl 이 `surprise → run → typing` 을 지나는지, plan 은 말풍선인지, 위임이 닫히면 스파크 후 idle 인지.
4. error 로 끝난 run 을 서랍에서 열면 마지막에 돌던 사람이 `error` 로 남아 있는지. 새 지시를 보내면 풀리는지.
5. 8명 레인에서 도는 사람이 시야 밖일 때 스크롤이 따라오는지.
6. 5분 동안 판을 켜 두고 "한 번에 한 명만 움직이는지", 졸기가 오는지.
7. OS "애니메이션 줄이기" — 대기 비트 없음, 일하는 사람은 첫 프레임 정지, 표정은 남는지.

---

## 8. 단계

| 단계 | 범위 | 끝나면 보이는 것 |
|---|---|---|
| 1 | 시트 반입 + 새 파츠 · `look.ts` `name.ts` · `Minime` 정지 상태 · `AgentBoard` 를 부서·바닥선·명패로 | 사무실에 직원이 서 있다. 도는 사람은 노트북(정지) |
| 2 | `useCrew` 전이(놀람→달리기→타이핑→스파크/에러) · plan 말풍선 · 스크롤 따라가기 | 지시하면 반응한다 |
| 3 | `useIdleBeats` 대기 비트 · 졸기 · reduced-motion · 밝은 테마 보정 · Roster 에 얼굴 | 사무실이 살아 있다 |
