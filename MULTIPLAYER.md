# 3인 멀티 실행

멀티 WebSocket과 GPT 리뷰 API는 `py/multiplayer_api.py`의 한 서버에서 함께 실행됩니다.

```powershell
pip install fastapi "uvicorn[standard]"
uvicorn py.multiplayer_api:app --host 0.0.0.0 --port 8001
```

GPT 리뷰를 사용하려면 프로젝트 루트의 `.env`에 `OPENAI_API_KEY`를 설정합니다. 키가 없거나 OpenAI 요청이 실패하면 게임은 내장된 로컬 리뷰를 표시합니다.

게임 웹 서버도 같은 PC에서 실행한 뒤 세 브라우저가 그 PC의 주소로 접속합니다. 세 사람은 같은 방 코드를 입력하고 각자 `방 참가`를 누릅니다. 모두 입장한 다음 누구든 카드를 드래그하면 정해진 공용 순서가 세 화면에 즉시 반영됩니다.

순서가 정해지면 각자 `준비하고 시작하기`를 누릅니다. 세 명 모두 준비하면 현재 화면에 보이는 순서로 게임이 자동 시작됩니다. 준비 후 누군가 순서를 다시 바꾸면 전원의 준비 상태가 해제됩니다. 게임 중에는 서버가 현재 공정과 점수를 관리합니다. 현재 담당자에게만 마이크·성공·실수 버튼이 열리고 나머지 두 명은 같은 조리 화면을 관전합니다.

현재 서버 상태는 메모리에만 저장됩니다. 서버를 재시작하면 방과 진행 상태가 초기화됩니다.

## GitHub Pages에서 시연하기

GitHub Pages는 정적 파일만 호스팅하므로 `py/multiplayer_api.py`를 직접 실행할 수 없습니다. 또한 Pages가 HTTPS이기 때문에 로컬의 `ws://` 주소는 브라우저가 혼합 콘텐츠로 차단합니다. 멀티 서버를 HTTPS를 지원하는 별도 호스트나 터널에 공개한 뒤, 게임 화면의 **멀티 서버 주소**에 발급받은 `https://...` 주소를 입력하세요. 클라이언트가 이를 `wss://.../ws`로 자동 변환합니다.

로컬 서버를 일시적으로 시연하는 예시는 다음과 같습니다.

```powershell
python -m uvicorn py.multiplayer_api:app --host 0.0.0.0 --port 8001
cloudflared tunnel --url http://localhost:8001
```

두 번째 명령이 출력한 `https://...trycloudflare.com` 주소를 세 참가자의 멀티 서버 주소 칸에 동일하게 입력합니다. 이 주소 하나로 멀티플레이와 GPT 리뷰를 모두 사용합니다. Quick Tunnel 주소는 실행할 때마다 바뀌므로 상시 배포에는 Render, Railway 등의 Python WebSocket 지원 서비스를 사용해야 합니다.

주소는 브라우저에 저장되며, `?server=https://서버주소` 쿼리 매개변수로 시연 링크에 미리 포함할 수도 있습니다.
