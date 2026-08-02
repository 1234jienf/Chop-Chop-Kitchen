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

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === name));
  window.scrollTo(0, 0);
}

function renderPlayers() {
  $('#playerSetup').innerHTML = state.players.map((player, index) => `<article class="player-card"><div class="move-buttons"><button data-move="${index}" data-dir="-1" ${index === 0 ? 'disabled' : ''} aria-label="앞 순서로">←</button><button data-move="${index}" data-dir="1" ${index === 2 ? 'disabled' : ''} aria-label="뒤 순서로">→</button></div><span class="order-number">${index + 1}</span><div class="chef-avatar">${['👩‍🍳', '🧑‍🍳', '👨‍🍳'][index]}</div><label>PLAYER ${index + 1}<input data-player="${index}" value="${player}" maxlength="12" aria-label="${index + 1}번 플레이어 이름"></label></article>`).join('');
}

function renderGame() {
  $('#dayLabel').textContent = state.day; $('#moneyLabel').textContent = `${state.money.toLocaleString()}G`; $('#gradeLabel').textContent = state.grade;
  $('#guestCard').innerHTML = `<span>오늘의 손님</span><strong>${state.guest.name}</strong><p>${state.guest.demand}</p>`;
  $('#courseList').innerHTML = state.menu.courses.map((c, i) => `<div class="course-item"><span>0${i + 1} · ${c.category}</span><b>${c.name}</b></div>`).join('');
  const steps = getSteps(state);
  $('#timeline').innerHTML = steps.map((item, index) => { const status = index < state.currentStep ? 'done' : index === state.currentStep ? 'active' : ''; return `<div class="timeline-item ${status}"><i class="dot"></i><div><small>${item.course.name} · ${TYPE_LABEL[item.type]}</small><b>${item.title}</b></div><em>${state.players[index % 3]}</em></div>` }).join('');
  if (state.finished) { renderResult(); showScreen('result'); return; }
  const current = getCurrent(state);
  $('#stationIcon').textContent = TYPE_ICON[current.type]; $('#stationLabel').textContent = `${current.course.name} / ${TYPE_LABEL[current.type]}`;
  $('#playerLabel').textContent = `${getPlayer(state)}의 차례`; $('#stepTitle').textContent = current.title; $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” · ${current.hint}`; $('#stepCount').textContent = `${state.currentStep + 1} / ${steps.length}`;
}

function renderResult() {
  const result = calculateResult(state); const review = result.score >= 85 ? '셰프들의 호흡이 훌륭했습니다. 각 코스의 개성이 살아 있는 멋진 저녁이었어요.' : result.score >= 65 ? '조금 흔들린 순간도 있었지만, 팀워크가 돋보이는 기분 좋은 코스였습니다.' : '재료는 좋았지만 주방의 호흡을 조금 더 맞추면 훨씬 근사해질 것 같아요.';
  $('#reviewPanel').innerHTML = `<div class="stars">${'★'.repeat(result.stars)}${'☆'.repeat(5 - result.stars)}</div><h2>${result.score}점</h2><blockquote>“${review}”</blockquote><p class="muted">손님 요구 ${result.conditionMet ? '충족 · 보너스 +5점' : '미충족'} · 오늘의 매출 +${result.revenue}G</p>`;
}

document.addEventListener('click', (event) => {
  const go = event.target.closest('[data-go]'); if (go) { showScreen(go.dataset.go); return; }
  const move = event.target.closest('[data-move]'); if (move) { const from = Number(move.dataset.move), to = from + Number(move.dataset.dir); [state.players[from], state.players[to]] = [state.players[to], state.players[from]]; renderPlayers(); }
});
$('#playerSetup').addEventListener('input', event => { if (event.target.matches('[data-player]')) state.players[Number(event.target.dataset.player)] = event.target.value.trim() || `셰프 ${Number(event.target.dataset.player) + 1}`; });
$('#confirmTeamBtn').addEventListener('click', () => { renderGame(); showScreen('game'); });
$('#successBtn').addEventListener('click', () => { submitStep(state, 90); renderGame(); });
$('#missBtn',).addEventListener('click', () => { submitStep(state, 45); renderGame(); });
$('#nextDayBtn').addEventListener('click', () => { startNextDay(state); renderGame(); showScreen('game'); });

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