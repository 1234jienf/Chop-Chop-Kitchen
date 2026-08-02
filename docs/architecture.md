# 데모 개발 가이드

## 이번 데모에서 고정할 범위

한 사이클은 `메뉴 확인 → 12공정 릴레이 → 고정 공식 채점 → 리뷰 → 정산`입니다. 레시피 해금, 상점, 온라인 멀티플레이는 데이터/화면 자리만 고려하고 5일 데모 범위에서는 제외합니다.

## 상태 흐름

```text
PREPARE → COOKING(0..11) → REVIEW → SETTLEMENT → PREPARE
```

현재 `state.js`는 작은 함수 기반 상태 머신입니다. 공정 제출은 정확도 `0..100`만 받으므로 음성 분류기와 버튼 대체 입력이 같은 게임 로직을 공유합니다.

## 팀 간 인터페이스

음성 담당자는 추후 아래 형태로 결과를 반환하면 됩니다.

```js
{ pattern: 'rapid-burst', confidence: 0.86, accuracy: 88 }
```

게임 담당은 `submitStep(state, accuracy)`만 호출합니다. UI 담당은 상태를 직접 계산하지 않고 `state.js`의 함수 결과를 표시합니다.

AI 리뷰 API의 권장 요청/응답 경계는 다음과 같습니다.

```json
{
  "request": { "score": 82, "stars": 5, "conditionMet": true },
  "response": { "review": "불맛과 코스의 흐름이 인상적이었다." }
}
```

별점과 매출은 서버/AI 응답으로 덮어쓰지 않습니다.
