# Architecture Agent — 세부 시각 규칙

`SKILL.md` 의 판단 기준을 실제 화면으로 옮길 때 읽는다. 스케일·의미색·글꼴의 **실제 토큰
이름**은 `SKILL.md` 의 "이 저장소에 이미 있는 것" 절에 있다.

---

# Application shell

Prefer a stable operations-console layout.

```
LEFT     Navigation and workflow stages.
CENTER   Primary operational workspace.
RIGHT    Contextual inspector, execution result, evidence, or selected-resource details.
```

The center workspace should receive the largest share of visual attention.
The right inspector should not overpower the operational workspace.
The inspector may be collapsible when appropriate.

Do not blindly force this structure when another layout is clearly better, but treat
it as the default architecture.

---

# Navigation

Navigation should be quiet and predictable.

현재 워크플로 단계(**분석 · 설계 · 구현 · 운영**)는 큰 시각 블록이 아니라 **안정적인
내비게이션**처럼 굴어야 한다. 활성 단계는 분명하되 과하게 강조하지 않는다.

Avoid:

- unnecessary badges
- decorative icons
- multiple competing active-state treatments
- heavy borders around navigation groups

---

# Operational dashboard

The main operational view should emphasize:

- system health
- critical resources
- incidents
- topology
- important metrics
- current agent activity

Prefer concise health summaries such as `Critical` / `Warning` / `Healthy` / `Unknown`.

**모든 지표마다 카드를 만들지 않는다.** 한 리소스에 여러 지표가 붙으면 중첩 카드 대신:

- compact metric rows
- structured resource panels
- tables
- topology nodes
- status summaries

---

# Infrastructure topology

WEB / WAS / DB / middleware 관계는 토폴로지가 의미 있는 곳에서 **공간적으로** 이해되어야 한다.

노드가 강조할 것:

- name
- role
- health
- primary abnormal metric

노드에 장황한 진단 문구를 얹지 않는다. 상세 증적은 컨텍스트 인스펙터로 간다.

토폴로지가 답해야 할 질문: **"무엇이 영향을 받았고, 거기에 무엇이 연결돼 있는가?"**

---

# Incidents

Critical incidents must be visually dominant.
Warnings should be noticeable but quieter than critical conditions.
Healthy states should remain visually quiet.

Incident presentation should answer:

- severity
- affected resource
- concise problem statement
- important metric
- time
- operator or agent action if applicable

인시던트 요약 안에 진단 보고서 전체를 펼치지 않는다.

---

# Agent execution

에이전트 워크플로는 이 제품의 차별점이다. 원시 시스템 출력이 아니라 **이해 가능한 과정**으로
보여 준다.

`Plan` / `Implementation` / `Evaluation` / `Communication` 같은 개념을 쓰되, 실제
architecture-agent 워크플로가 다르면 그쪽을 따른다.

분명히 갈라야 할 것:

- current stage
- completed stages
- waiting stages
- failed stages
- human intervention required

애니메이션을 과하게 쓰지 않는다. 실행 시각화가 **살아 있는 인프라 인시던트와 주의를 다투면
안 된다** — 운영 상태가 우선순위가 높다.

---

# Execution result / inspector

오른쪽 실행 결과가 **영구적인 Markdown 덤프처럼 굴면 안 된다.**

기본 표현이 요약할 것:

- result
- status
- important findings
- changes made
- exceptions
- next actions

상세 증적은 점진적 공개로 간다.

```
Summary → Findings → Changes → Evidence → Raw output
```

원시 로그와 긴 Markdown 보고서는 보통 명시적 동작 뒤에 접혀 있어야 한다
("View evidence" / "View raw output" / "View logs").

**성공 여부를 알려고 로그를 파싱하게 만들지 않는다.**

---

# Typography

Use a proportional sans-serif UI font for:

navigation · headings · descriptions · explanatory text · controls · statuses ·
incident summaries

Use monospace **only where the content is inherently technical**:

hostnames · commands · paths · IP addresses · ports · timestamps · code · logs ·
identifiers · numeric diagnostic values when appropriate

Do NOT use monospace as the default application font.

실용 위계 (저장소 토큰과 대응):

| 용도 | 크기 | 토큰 |
|---|---|---|
| Application / major page title | 18–22px | `--text-xl` · `--text-2xl` |
| Section heading | 15–18px | `--text-lg` · `--text-xl` |
| Primary UI text | 13–14px | `--text-sm` · `--text-md` |
| Supporting text | 12–13px | `--text-xs` · `--text-sm` |
| Technical metadata | 11–13px | `--text-2xs` · `--text-xs` |

서로 무관한 글자 크기를 여럿 만들어 위계를 세우지 않는다.

---

# Spacing

Use a consistent spacing scale: `4 · 8 · 12 · 16 · 24 · 32` (`--space-1..6`).

테두리를 더하기 전에 **여백으로 먼저 묶는다.**

Dense does not mean cramped. 전문가용 운영 도구라 정보 밀도는 비교적 높아도 되지만,
시각적 관계는 분명해야 한다.

---

# Borders

Minimize borders. 모든 구획을 둥근 사각형으로 두르지 않는다.

Prefer, in order:

```
background contrast → spacing → alignment → subtle separators → border
```

Avoid:

- card inside card
- panel inside bordered panel
- bordered row inside bordered card
- unnecessary divider grids

**테두리를 없애도 이해가 나빠지지 않으면 없앤다.**

---

# Radius

Use restrained corner radii (`--radius-sm` 3px · `--radius-md` 5px).

모든 컨테이너에 `rounded-xl`/`rounded-2xl` 을 두르는 데서 오는 흔한 AI/SaaS 인상을 피한다.

컨트롤은 작거나 중간 라운드를 쓸 수 있다. 큰 구조면은 보통 미묘한 라운드나 무라운드다.

---

# Color

The base UI should remain predominantly neutral. 의미색은 **뜻을 위해서만** 쓴다.

```
healthy      green    --gate-mint
warning      amber    --signal-amber
critical     red      --gate-rose
neutral      gray     --ink-* / --paper-*
interactive  cyan     --line-cyan
```

분명한 이유 없이 의미색을 더 들이지 않는다.

Healthy states should remain quiet. Critical states should attract attention.
**대시보드 전체를 알록달록하게 만들지 않는다.**

---

# Dark theme

이 앱은 지금 어두운 운영 콘솔 방향이다.

Dark theme should feel: **calm · precise · professional**, high contrast where necessary.

It should NOT feel: cyberpunk · neon · gaming-oriented · hacker-themed.

Avoid:

- glowing borders
- neon text
- large gradients
- excessive cyan
- pure black everywhere
- colored borders on every component

대신 **겹쳐진 중립 면**(`--ink-950` → `--ink-900` → `--ink-850` → `--ink-800`)으로 깊이를 만든다.

---

# Components

Prefer:

status summary · metric row · incident row · infrastructure node · topology graph ·
resource table · execution timeline · segmented control · inspector ·
collapsible detail · command / evidence block

과용을 경계할 것: **Card · Badge · Alert · Pill**

의미가 맞으면 써도 되지만, 모든 레이아웃 문제의 기본 해법이 되면 안 된다.

## Pills and badges

Use pills sparingly. 알약이 보통 전달할 것:

- status
- compact filter
- selected mode
- short categorical metadata

평범한 이름표를 알약으로 만들지 않는다. **전부가 배지면 위계가 없다.**

## Icons

Icons should improve scanability. 자리가 남는다고 아이콘을 넣지 않는다.
여러 아이콘 스타일을 섞지 않는다. 아이콘은 중요한 이름표를 **대체**하지 않고 **보조**한다.

## Controls

운영 컨트롤은 아래를 분명히 갈라야 한다:

navigation · filtering · execution · destructive action · mode selection

주요 동작은 분명해야 한다. **결과가 크게 다른 동작들을 똑같이 생긴 버튼으로 만들지 않는다.**

---

# Data density

전문가 수준의 정보 밀도를 유지한다. 복잡함을 **유용한 데이터를 감춰서** 풀지 않는다.

대신: hierarchy · alignment · grouping · progressive disclosure ·
context-sensitive inspectors · compact tables · clear status summaries

숙련된 엔지니어가 많은 정보를 효율적으로 훑을 수 있어야 한다.

---

# Progressive disclosure

상세 진단은 의도적인 펼침 뒤에 둔다.

```
summary → detail → evidence → raw logs
```

기본 상태는 **운영 질문에 답한다.** 펼친 상태는 **조사를 돕는다.**

---

# Responsive behavior

주 대상은 데스크톱 운영 콘솔이다. 데스크톱 운영 사용성을 먼저 최적화한다.

그래도 좁은 폭에서 파국적으로 무너지는 하드코딩 레이아웃은 피한다.
오른쪽 인스펙터·내비게이션·보조 패널 중 무엇이 폭에 따라 접힐지 정한다.

---

# Accessibility

충분한 대비를 유지한다. **색만으로 심각도를 전달하지 않는다.**

필요하면 의미색에 text · icon · shape · label 을 함께 붙인다.

키보드 상호작용을 위한 포커스 상태를 보이게 유지한다.
시각적 미니멀리즘을 위해 접근성을 희생하지 않는다.

---

# Language

이 앱에는 한국어와 영어 기술 용어가 섞인다. 명확성을 해치면서까지 기술 용어를 번역하지 않는다.

섞인 한/영 타이포그래피가 시각적으로 일관되게 유지되도록 한다.

`WEB` · `WAS` · `CRIT` · `OOM` · `Metaspace` 같은 기술 이름은 적절한 자리에서 그대로 둔다.

---

# Component libraries

이 저장소는 shadcn/ui·Radix·MUI·Ant Design을 **쓰지 않는다**(순수 CSS + CSS 변수).

만약 들이게 되더라도, 라이브러리는 **구현 도구**이지 제품의 시각적 정체성이 아니다.
기본값을 그대로 받지 않는다.

특히 흔한 생성형 대시보드 패턴을 피한다:

```
Card + rounded border + Badge + muted text + another Card + more pills
```

컴포넌트는 정보 구조에 따라 쓴다.
