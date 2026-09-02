---
name: architecture-agent-design
description: >
  Project-specific UI/UX design rules for the architecture-agent operations
  console. Use whenever designing, reviewing, implementing, or refactoring
  frontend screens, layouts, dashboards, monitoring views, infrastructure
  topology, agent execution views, status presentation, visual styling, or
  screenshot-based UI improvements in architecture-agent.
---

# Architecture Agent Design System

이 문서는 판단 기준과 작업 순서를 담는다. 세부 시각 규칙(타이포·간격·색·컴포넌트·테마)은
[references/design-system.md](references/design-system.md) 에 있다 — 실제로 화면을 고칠 때 함께 읽는다.

## Product identity

Architecture Agent is a professional infrastructure and middleware operations console.

It is NOT:

- a marketing website
- a generic SaaS dashboard
- a cyberpunk terminal
- a developer toy
- a collection of decorative cards

The interface should feel like a calm, precise operational control surface used by
engineers who need to understand system state quickly.

The design should optimize for:

1. situational awareness
2. anomaly detection
3. operator decision making
4. infrastructure comprehension
5. agent execution transparency

Beauty is secondary to clarity, but clarity should still result in a high-quality
visual system.

> 공식 `frontend-design` 스킬도 이 저장소에 함께 설치돼 있다. 그쪽은 "템플릿처럼 보이지
> 않게"를 말하고 미학적 모험을 권한다. **충돌하면 이 문서가 이긴다** — 여기는 운영 콘솔이고,
> 신호를 읽는 속도가 인상보다 앞선다. 공식 스킬은 그 제약 안에서 **평범함을 피하는 데** 쓴다.

---

# Decision rule

Whenever choosing between two designs, prefer the one that lets an operator answer
these questions faster:

1. Is something wrong?
2. Where is it wrong?
3. How severe is it?
4. What changed?
5. What is the agent doing?
6. What should I do next?

That is the core design criterion for Architecture Agent.

---

# Information hierarchy

Always prioritize information in this order:

1. Current system health
2. Critical incidents requiring operator attention
3. Warnings and degraded conditions
4. Infrastructure topology and affected resources
5. Current agent execution state
6. Recommended or performed actions
7. Evidence and diagnostic detail
8. Raw logs

Never give raw logs the same visual prominence as active incidents.
Never allow implementation detail to visually dominate operational state.

An operator should understand within approximately 3 seconds:

- Is the environment healthy?
- If not, what is wrong?
- Which system is affected?
- How severe is it?
- Is the agent currently doing something about it?

Do not make every section visually equal. Build hierarchy from spacing, typography,
surface elevation, alignment, grouping, and restrained semantic color —
**not primarily from borders.**

---

# 이 저장소에 이미 있는 것 (먼저 읽는다)

새 토큰이나 컴포넌트를 만들기 전에 여기부터 본다. 병행 디자인 시스템을 만들지 않는다.

| 자리 | 내용 |
|---|---|
| `frontend/src/styles/tokens.css` | 색·글자·간격·라운드·그림자 토큰. 라이트/다크 3상태(`:root`, `prefers-color-scheme`, `data-theme`) |
| `frontend/src/styles/global.css` | 리셋과 전역 기본값 |
| `frontend/src/components/*.css` | 컴포넌트마다 짝이 되는 CSS 파일 하나 |

Tailwind·CSS-in-JS·컴포넌트 라이브러리는 **쓰지 않는다.** 순수 CSS + CSS 변수다.
새 유틸리티 프레임워크를 들이지 않는다.

## 이미 맞춰져 있는 스케일

그대로 쓴다. 새 값을 만들지 않는다.

```
간격   --space-1..7    4 · 8 · 12 · 16 · 24 · 32 · 48
글자   --text-2xs..2xl 11.5 · 12 · 13 · 14 · 16 · 18 · 22
라운드 --radius-sm/md  3px · 5px          (rounded-xl 류를 만들지 않는다)
행간   --leading-tight/body  1.4 · 1.6
```

## 의미색 (semantic)

```
healthy      --gate-mint   / --gate-mint-dim
warning      --signal-amber / --signal-amber-dim
critical     --gate-rose   / --gate-rose-dim
neutral      --ink-800..950 (면) · --paper-100/300/500 (글자)
interactive  --line-cyan   / --line-cyan-dim
```

이 다섯 말고 새 의미색을 들이지 않는다. `--role-plan/impl/eval` 은 하네스 역할 표시 전용이다.

## 글꼴

```
--font-body   Segoe UI · Malgun Gothic · system-ui   ← 기본
--font-label  = font-body
--font-mono   ui-monospace · Cascadia Mono · Consolas ← 기술적 내용에만
```

`--font-mono` 를 기본 글꼴로 쓰지 않는다. 호스트명·명령·경로·IP·포트·시각·코드·로그·식별자에만 쓴다.

---

# Screenshot review workflow

스크린샷이 있으면 시각 검토를 구현 과정의 일부로 다룬다.

화면을 고치기 전에:

1. inspect the screenshot
2. identify hierarchy problems
3. identify alignment problems
4. identify excessive density or unnecessary chrome
5. identify inconsistent status semantics
6. identify typography problems
7. identify wasted space
8. identify components competing for attention

**CSS 부터 건드리지 않는다.** 지금 위계가 왜 실패하는지를 먼저 판정한다.

## Design critique format

구현 전 리뷰를 요청받으면 이 축으로 정리한다.

```
Hierarchy
Layout
Typography
Density
Status semantics
Interaction
Operational usability
```

사소한 것을 나열하지 말고 **영향이 큰 문제부터** 짚는다.

---

# Implementation workflow

의미 있는 재디자인은 이 순서로 간다.

```
1. Inspect     관련 페이지·레이아웃·컴포넌트·스타일·토큰·공용 프리미티브를 먼저 읽는다
2. Diagnose    무엇이 왜 안 읽히는지 판정한다
3. Propose     고칠 것과 그 근거를 말한다
4. Implement   기존 프리미티브를 재사용한다. 중복 컴포넌트를 만들지 않는다
5. Validate    tsc --noEmit / vite build
6. Review      실제로 그려 보고 눈으로 확인한다
```

---

# Refactoring safety

UI 재디자인이 동작을 바꾸면 안 된다. 명시적으로 요청받지 않는 한 아래를 보존한다.

- APIs
- state transitions
- agent logic
- backend behavior
- event handling semantics
- business rules
- monitoring semantics
- data contracts

시각 리팩터링과 기능 리팩터링을 **분리한다.** 기능 변경이 필요해 보이면 하기 전에 설명한다.

이 저장소에서 특히 조심할 것 — 화면이 값을 만들어 내지 않는다는 규칙이다.
`status-middleware.json` 의 판정·임계·시각은 agent 가 적은 것이고, 화면은 그것을 **비추기만**
한다. 보기 좋게 하려고 값을 반올림하거나 색을 다시 계산하지 않는다.

---

# Anti-patterns

Actively avoid:

- generic AI-generated dashboard appearance
- card-everything design
- excessive rounded rectangles
- excessive pills
- excessive borders
- neon cyberpunk styling
- gratuitous gradients
- glowing status indicators
- monospace everywhere
- tiny unreadable text
- raw Markdown dominating the interface
- raw logs presented as primary information
- multiple competing accent colors
- decorative charts without operational value
- large empty space caused by poor layout
- cramming every available datum on screen
- changing business logic during visual redesign

---

# 세부 규칙

아래는 [references/design-system.md](references/design-system.md) 에 있다. 화면을 실제로
고칠 때 읽는다.

- Application shell · Navigation
- Operational dashboard · Infrastructure topology · Incidents
- Agent execution · Execution result / inspector
- Typography · Spacing · Borders · Radius · Color · Dark theme
- Components · Pills and badges · Icons · Controls
- Data density · Progressive disclosure
- Responsive behavior · Accessibility · Language
