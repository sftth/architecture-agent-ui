"""실행에 쓸 모델과 effort 선택지.

claude CLI는 `--model`(별칭 또는 전체 이름)과 `--effort`(low~max)를 받는다.
두 값 모두 argv로 그대로 나가므로, 임의 문자열을 받지 않고 이 목록으로만 제한한다.

effort는 모델마다 지원 여부가 다르다. Haiku 4.5는 effort를 받지 않으므로 빈 목록을 준다
(화면에서도 "이 모델은 effort 설정을 지원하지 않음"으로 보인다).
"""

from fastapi import HTTPException

EFFORTS = ["low", "medium", "high", "xhigh", "max"]

# value가 빈 문자열이면 --model을 붙이지 않는다(= CLI 기본 모델).
MODELS = [
    {
        "value": "",
        "label": "Default (권장)",
        "note": "세션 기본 모델을 그대로 쓴다",
        "efforts": EFFORTS,
    },
    {
        "value": "claude-opus-5",
        "label": "Opus 5",
        "note": "복잡한 에이전트·코딩 작업 (1M 컨텍스트)",
        "efforts": EFFORTS,
    },
    {
        "value": "claude-fable-5",
        "label": "Fable 5",
        "note": "가장 어려운 추론·장기 실행 작업",
        "efforts": EFFORTS,
    },
    {
        "value": "claude-sonnet-5",
        "label": "Sonnet 5",
        "note": "속도와 지능의 균형",
        "efforts": EFFORTS,
    },
    {
        "value": "claude-haiku-4-5",
        "label": "Haiku 4.5",
        "note": "가장 빠르고 저렴 — effort 미지원",
        "efforts": [],
    },
]


def find_model(value: str) -> dict:
    for model in MODELS:
        if model["value"] == (value or ""):
            return model
    raise HTTPException(400, f"지원하지 않는 모델입니다: {value}")


def check_choice(model_value: str, effort: str) -> tuple[str, str]:
    """UI에서 온 모델·effort를 검증해 argv에 넣어도 되는 값만 돌려준다."""
    model = find_model(model_value or "")
    if not effort:
        return model["value"], ""
    if effort not in model["efforts"]:
        raise HTTPException(400, f"{model['label']}에서 쓸 수 없는 effort입니다: {effort}")
    return model["value"], effort
