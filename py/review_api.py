import asyncio
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()


def _load_local_env() -> None:
    """Load the repository .env without overriding real environment variables."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_local_env()


def _call_openai(payload: dict) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    courses = payload.get("courses", [])
    schema = {
        "name": "guest_day_review",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "courses": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "review": {"type": "string"},
                        },
                        "required": ["name", "review"],
                        "additionalProperties": False,
                    },
                },
                "final": {"type": "string"},
            },
            "required": ["courses", "final"],
            "additionalProperties": False,
        },
    }
    guest = payload.get("guest", {})
    prompt = {
        "role": "user",
        "content": (
            "당신은 미식과 문학적 감각을 갖춘 요리 경연의 손님 심사위원입니다. 한국어로, "
            "단호하지만 품격 있고 감각적인 말투를 사용하세요. 각 음식마다 장점과 아쉬운 점을 "
            "향, 식감, 온도, 불의 깊이, 재료의 조화, 소스의 농도, 접시의 흐름과 여운 같은 "
            "실제 미식 언어로 바꾸어 한 문장으로 평가하고, 마지막에 하루 전체를 한 문장으로 평하세요. "
            "내부 데이터는 판단 근거일 뿐이므로 리뷰에 점수, 정확성, 공정, 단계, 보너스, 니즈, "
            "성공, 실패, 총점이라는 게임 용어를 절대 쓰지 마세요. '소스 졸이기'처럼 작업명을 그대로 "
            "지적하지 말고 '소스의 깊이가 충분히 응축되지 않았다'처럼 완성된 음식의 감각으로 표현하세요. "
            "좋은 접시는 구체적으로 칭찬하고 부족한 접시는 잔향이나 균형을 비유적으로 짚되, "
            "확인할 수 없는 재료나 조리 사실은 새로 만들지 마세요. 음식 이름도 문장 첫머리에 반복하지 마세요. "
            f"손님 이름: {guest.get('name', '손님')}, 말투와 취향: {guest.get('demand', '')}. "
            f"최종 점수: {payload.get('score')}, 손님 요구 충족: {payload.get('conditionMet')}. "
            f"요리 데이터: {json.dumps(courses, ensure_ascii=False)}"
        ),
    }
    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "게임 수치를 감각적인 미식 언어로 번역하는 품격 있고 문학적인 한국어 요리 심사위원으로 응답하세요."},
            prompt,
        ],
        "temperature": 0.8,
        "max_tokens": 500,
        "response_format": {"type": "json_schema", "json_schema": schema},
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI API error {error.code}: {detail[:500]}") from error
    content = result["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    expected_names = [course.get("name") for course in courses]
    returned = {item.get("name"): item for item in parsed.get("courses", [])}
    parsed["courses"] = [returned.get(name, {"name": name, "review": "심사평이 비어 있습니다."}) for name in expected_names]
    return parsed


@router.post("/review")
async def create_review(payload: dict):
    try:
        return await asyncio.to_thread(_call_openai, payload)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
