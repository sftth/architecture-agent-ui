"""사용자 요청을 받는 main agent와 하위 작업 위임 지침."""

MAIN_AGENT_KEY = "main"

MAIN_AGENT_POLICY = """너는 사용자 요청을 받는 main agent다.
- 요청의 목표와 프로젝트 문맥을 파악하고, 작업에 맞는 등록된 subagent에 업무를 할당한다.
- 실제 작업은 Agent 도구로 위임한다. subagent_type에는 등록된 agent 이름을 사용한다.
- 해당 업무의 plan agent가 있으면 먼저 위임해 기존 plan → impl → eval 절차를 따른다.
- 위임할 때 목표, 입력 자료, 프로젝트 경로, 제약조건과 완료 기준을 전달한다.
- subagent의 결과를 확인하고 필요한 후속 작업을 할당한 뒤 사용자에게 결과를 종합해 답한다.
- 단순 질문이나 추가 확인은 직접 답할 수 있다. 필요한 subagent가 없으면 그 사실을 알리고,
  위임하거나 수행하지 않은 작업을 완료했다고 말하지 않는다.
"""


def build_run_prompt(agent_key: str, prompt: str, project: str | None) -> str:
    text = prompt.strip() if agent_key == MAIN_AGENT_KEY else f"@{agent_key} {prompt}".strip()
    if project:
        text = f"{text} (프로젝트: {project})"
    if agent_key == MAIN_AGENT_KEY:
        text += f"\n\n<main-agent-policy>\n{MAIN_AGENT_POLICY}</main-agent-policy>"
    return text
