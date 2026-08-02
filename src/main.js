import { TYPE_ICON, TYPE_LABEL } from './data.js';
import { calculateResult, createGameState, getCurrent, getPlayer, getSteps, startNextDay, submitStep } from './state.js';
import { sendWebmAudioToPythonAPI } from './api.js';

const $ = (s) => document.querySelector(s);
const state = createGameState();
let micOn = false;

let mediaRecorder;
let audioChunks = [];
let audioContext = null;
let analyser = null;
let animationId = null;

const RESTAURANT_EXTERIORS = [
  { name: '푸드트럭', file: '식당외관_푸드트럭_투명.png', heading: '작은 주방에서<br>큰 이야기가 시작됩니다' },
  { name: '비스트로', file: '식당외관_비스트로_투명.png', heading: '우리만의 공간이<br>조금 더 근사해졌습니다' },
  { name: '레스토랑', file: '식당외관_레스토랑_투명.png', heading: '더 큰 무대에서<br>새로운 손님을 맞이합니다' },
  { name: '고급 레스토랑', file: '식당외관_고급레스토랑_투명.png', heading: '마침내 꿈꾸던<br>최고의 식당이 되었습니다' },
];

const CUT_INGREDIENTS = {
  '브루스케타': '바게트.png',
  '클램 차우더': '감자.png',
  '스테이크 플레이트': '양파.png',
  '애플 타르트': '사과.png',
};

function renderRestaurantExterior() {
  const exterior = RESTAURANT_EXTERIORS[Math.min(Math.max(state.day, 1), 4) - 1];
  $('#restaurantDayLabel').textContent = `DAY ${state.day} · ${exterior.name}`;
  $('#restaurantHeading').innerHTML = exterior.heading;
  $('#restaurantExterior').src = `./src/assets/배경/${exterior.file}`;
  $('#restaurantExterior').alt = `Chop-Chop Kitchen ${exterior.name} 외관`;
}

function showScreen(name) {
  if (name === 'restaurant') renderRestaurantExterior();
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === name));
  window.scrollTo(0, 0);
}

function renderPlayers() {
  $('#playerSetup').innerHTML = state.players.map((player, index) => `<article class="player-card" data-player-index="${index}" aria-grabbed="false"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="order-number">${index + 1}</span><div class="chef-avatar">${['👩‍🍳', '🧑‍🍳', '👨‍🍳'][index]}</div><label>PLAYER ${index + 1}<input data-player="${index}" value="${player}" maxlength="12" aria-label="${index + 1}번 플레이어 이름"></label></article>`).join('');
}

let draggedPlayerCard = null;
let playerDragGhost = null;
let playerDragPointerId = null;
let playerDragOffset = { x: 0, y: 0 };

function movePlayerDragGhost(event) {
  if (!playerDragGhost) return;
  playerDragGhost.style.left = `${event.clientX - playerDragOffset.x}px`;
  playerDragGhost.style.top = `${event.clientY - playerDragOffset.y}px`;
}

function finishPlayerDrag() {
  if (!draggedPlayerCard) return;
  const cards = [...$('#playerSetup').querySelectorAll('.player-card')];
  const reorderedPlayers = cards.map(card => state.players[Number(card.dataset.playerIndex)]);
  state.players.splice(0, state.players.length, ...reorderedPlayers);
  playerDragGhost?.remove();
  draggedPlayerCard = null;
  playerDragGhost = null;
  playerDragPointerId = null;
  document.body.classList.remove('is-dragging-player');
  renderPlayers();
}

$('#playerSetup').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('input, button')) return;
  const card = event.target.closest('.player-card');
  if (!card) return;
  event.preventDefault();
  const rect = card.getBoundingClientRect();
  draggedPlayerCard = card;
  playerDragPointerId = event.pointerId;
  playerDragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  playerDragGhost = card.cloneNode(true);
  playerDragGhost.classList.add('player-drag-ghost');
  playerDragGhost.style.width = `${rect.width}px`;
  playerDragGhost.style.height = `${rect.height}px`;
  card.classList.add('dragging');
  card.setAttribute('aria-grabbed', 'true');
  card.setPointerCapture(event.pointerId);
  document.body.append(playerDragGhost);
  document.body.classList.add('is-dragging-player');
  movePlayerDragGhost(event);
});

$('#playerSetup').addEventListener('pointermove', event => {
  if (!draggedPlayerCard || event.pointerId !== playerDragPointerId) return;
  event.preventDefault();
  movePlayerDragGhost(event);
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.player-card');
  if (!target || target === draggedPlayerCard || target.parentElement !== $('#playerSetup')) return;
  const targetRect = target.getBoundingClientRect();
  const draggedRect = draggedPlayerCard.getBoundingClientRect();
  const sameRow = Math.abs(targetRect.top - draggedRect.top) < targetRect.height / 2;
  const insertBefore = sameRow ? event.clientX < targetRect.left + targetRect.width / 2 : event.clientY < targetRect.top + targetRect.height / 2;
  $('#playerSetup').insertBefore(draggedPlayerCard, insertBefore ? target : target.nextSibling);
});

$('#playerSetup').addEventListener('pointerup', event => {
  if (event.pointerId === playerDragPointerId) finishPlayerDrag();
});
$('#playerSetup').addEventListener('pointercancel', event => {
  if (event.pointerId === playerDragPointerId) finishPlayerDrag();
});

function renderGame() {
  $('#dayLabel').textContent = state.day; $('#moneyLabel').textContent = `${state.money.toLocaleString()}G`; $('#gradeLabel').textContent = state.grade;
  $('#guestCard').innerHTML = `<span>오늘의 손님</span><strong>${state.guest.name}</strong><p>${state.guest.demand}</p>`;
  $('#courseList').innerHTML = state.menu.courses.map((c, i) => `<div class="course-item"><span>0${i + 1} · ${c.category}</span><b>${c.name}</b></div>`).join('');
  const steps = getSteps(state);
  $('#timeline').innerHTML = steps.map((item, index) => { const status = index < state.currentStep ? 'done' : index === state.currentStep ? 'active' : ''; return `<div class="timeline-item ${status}"><i class="dot"></i><div><small>${item.course.name} · ${TYPE_LABEL[item.type]}</small><b>${item.title}</b></div><em>${state.players[index % 3]}</em></div>` }).join('');
  if (state.finished) { renderResult(); showScreen('result'); return; }
  const current = getCurrent(state);
  const kitchenBackground = current.type === 'cut' ? '주방_썰기.png' : '주방_끓이기.png';
  const counterScene = $('.counter-scene');
  counterScene.classList.add('has-kitchen-background');
  counterScene.style.backgroundImage = `url("./src/assets/배경/${kitchenBackground}")`;
  const cutIngredient = $('#cutIngredient');
  const ingredientFile = current.type === 'cut' ? CUT_INGREDIENTS[current.course.name] : null;
  cutIngredient.hidden = !ingredientFile;
  $('#stationIcon').hidden = Boolean(ingredientFile);
  if (ingredientFile) {
    cutIngredient.src = `./src/assets/재료/${ingredientFile}`;
    cutIngredient.alt = `${current.course.name} 자르기 재료`;
  } else {
    cutIngredient.removeAttribute('src');
    cutIngredient.alt = '';
  }
  $('#stationIcon').textContent = TYPE_ICON[current.type]; $('#stationLabel').textContent = `${current.course.name} / ${TYPE_LABEL[current.type]}`;
  $('#playerLabel').textContent = `${getPlayer(state)}의 차례`; $('#stepTitle').textContent = current.title; $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” · ${current.hint}`; $('#stepCount').textContent = `${state.currentStep + 1} / ${steps.length}`;
}

function renderResult() {
  const result = calculateResult(state); const review = result.score >= 85 ? '셰프들의 호흡이 훌륭했습니다. 각 코스의 개성이 살아 있는 멋진 저녁이었어요.' : result.score >= 65 ? '조금 흔들린 순간도 있었지만, 팀워크가 돋보이는 기분 좋은 코스였습니다.' : '재료는 좋았지만 주방의 호흡을 조금 더 맞추면 훨씬 근사해질 것 같아요.';
  $('#reviewPanel').innerHTML = `<div class="stars">${'★'.repeat(result.stars)}${'☆'.repeat(5 - result.stars)}</div><h2>${result.score}점</h2><blockquote>“${review}”</blockquote><p class="muted">손님 요구 ${result.conditionMet ? '충족 · 보너스 +5점' : '미충족'} · 오늘의 매출 +${result.revenue}G</p>`;
}

document.addEventListener('click', (event) => {
  const go = event.target.closest('[data-go]'); if (go) { showScreen(go.dataset.go); return; }
});
$('#playerSetup').addEventListener('input', event => { if (event.target.matches('[data-player]')) state.players[Number(event.target.dataset.player)] = event.target.value.trim() || `셰프 ${Number(event.target.dataset.player) + 1}`; });
$('#confirmTeamBtn').addEventListener('click', () => { renderGame(); showScreen('game'); });
$('#successBtn').addEventListener('click', () => { submitStep(state, 90); renderGame(); });
$('#missBtn',).addEventListener('click', () => { submitStep(state, 45); renderGame(); });
$('#nextDayBtn').addEventListener('click', () => { startNextDay(state); showScreen('restaurant'); });

// 실시간 볼륨 시각화 시작 함수
function startVolumeVisualizer(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateVolumeBar = () => {
      if (!micOn) return;
      analyser.getByteFrequencyData(dataArray);
      
      // 평균 볼륨 계산 (0 ~ 255)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      let average = sum / dataArray.length;
      
      // 퍼센트(0~100%)로 변환하여 #voiceBar 너비 조절
      let volumePercent = Math.min(100, Math.floor((average / 128) * 100));
      $('#voiceBar').style.width = `${volumePercent}%`;

      animationId = requestAnimationFrame(updateVolumeBar);
    };

    updateVolumeBar();
  } catch (e) {
    console.error("볼륨 시각화 에러:", e);
  }
}

// 볼륨 시각화 중지 함수
function stopVolumeVisualizer() {
  if (animationId) cancelAnimationFrame(animationId);
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
  $('#voiceBar').style.width = '0%';
}

// 🎙️ 마이크 켜기 버튼 클릭 시 5초 녹음, 볼륨 바 시각화 및 Whisper API 전송
$('#micBtn').addEventListener('click', async () => {
  try {
    if (micOn) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      micOn = false;
      stopVolumeVisualizer();
      $('#micBtn').textContent = '마이크 켜기';
      $('#micStatus').textContent = '음성 분석 중...';

      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

      try {
        // 서버에 전송 및 결과 받기
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");

        const response = await fetch("http://127.0.0.1:8000/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) throw new Error(`서버 오류 발생: ${response.statusText}`);

        const data = await response.json();
        
        if (data.success) {
          console.log("=== [Whisper 음성 인식 결과] ===");
          console.log("인식 텍스트:", data.text);
          console.log("음량 통계:", data.volume_stats);

          // 서버에서 계산된 음량 통계(RMS 등)를 기반으로 바를 최종적으로 채워줄 수도 있음
          const finalRmsPercent = Math.min(100, Math.round(data.volume_stats.rms * 300)); 
          $('#voiceBar').style.width = `${finalRmsPercent}%`;

          $('#micStatus').textContent = `인식 성공: "${data.text}"`;
        } else {
          $('#micStatus').textContent = "음성 변환 실패";
        }
      } catch (error) {
        console.error("API 통신 오류:", error);
        $('#micStatus').textContent = `오류 발생: ${error.message}`;
      } finally {
        stream.getTracks().forEach(track => track.stop());
        $('#micBtn').disabled = false;
      }
    };

    // 녹음 및 실시간 볼륨 시각화 시작
    mediaRecorder.start();
    micOn = true;
    startVolumeVisualizer(stream);

    $('#micBtn').textContent = '녹음 중...';
    $('#micBtn').disabled = true;
    $('#micStatus').textContent = '🎙️ 5초 동안 음성을 입력해주세요... (볼륨 측정 중)';

    // 5초 뒤 자동 종료
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, 5000);

  } catch (error) {
    console.error("마이크 접근 실패:", error);
    micStatus.textContent = `${error.message} HTTPS 또는 localhost에서 실행해 주세요.`;
    micOn = false;
    $('#micBtn').textContent = '마이크 켜기';
    $('#micBtn').disabled = false;
    stopVolumeVisualizer();
  }
});

renderPlayers();
