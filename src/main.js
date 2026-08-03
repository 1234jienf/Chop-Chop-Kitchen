import {
  ACTION_LABEL,
  INGREDIENT_LABEL,
  TYPE_ICON,
  TYPE_LABEL,
  ingredientAsset,
  primaryIngredient,
} from './data.js';
import { calculateResult, createGameState, getCurrent, getIngredientCuts, getPlayer, getSteps, rememberIngredientCuts, startNextDay, submitStep } from './state.js';
import {
  advanceKnife,
  attachKnifeToTomato,
  completeAfterVoice,
  countTakInText,
  createCutSession,
  crossSectionFrom,
  detectTakBurst,
  playCannedCut,
  renderCutBoard,
  resetCutSession,
  setListening,
  syncKnifeEl,
  tryChopOnTak,
} from './cutplay.js';
import {
  bandLabel,
  createRoastHeat,
  fireSrcFor,
  resetRoastHeat,
  stopRoastHeat,
  tickRoastHeat,
} from './roastheat.js';

const $ = (s) => document.querySelector(s);
const state = createGameState();
let micOn = false;
let liveStream = null;
let peakArmed = false;
let roastArmed = false;
let lastFrameTs = 0;
let speechRec = null;
let speechWanted = false;
let lastSpeechTakAt = 0;
let wasAboveBurst = false;
let speechKickTimer = null;
const roastHeat = createRoastHeat();
let lastFireBand = 'mid';

let audioContext = null;
let analyser = null;
let animationId = null;

const cutSession = createCutSession({
  onStatus: (msg) => { $('#micStatus').textContent = msg; },
  onComplete: (accuracy) => {
    stopLiveMic();
    const current = getCurrent(state);
    const id = primaryIngredient(current);
    const cuts = cutSession.actualCuts?.length || cutSession.marks?.length || 3;
    rememberIngredientCuts(state, id, cuts);
    $('#micStatus').textContent = `절단 완료 · ${accuracy}점 · ${cuts}조각`;
    $('.counter-scene')?.classList.remove('is-zoomed');
    setTimeout(() => {
      submitStep(state, accuracy);
      renderGame();
    }, 700);
  },
});

const RESTAURANT_EXTERIORS = [
  { name: '푸드트럭', file: '식당외관_푸드트럭_투명.png', heading: '작은 주방에서<br>큰 이야기가 시작됩니다' },
  { name: '비스트로', file: '식당외관_비스트로_투명.png', heading: '우리만의 공간이<br>조금 더 근사해졌습니다' },
  { name: '레스토랑', file: '식당외관_레스토랑_투명.png', heading: '더 큰 무대에서<br>새로운 손님을 맞이합니다' },
  { name: '고급 레스토랑', file: '식당외관_고급레스토랑_투명.png', heading: '마침내 꿈꾸던<br>최고의 식당이 되었습니다' },
];

function stationLabel(stepData) {
  return ACTION_LABEL[stepData.action] || TYPE_LABEL[stepData.type] || stepData.action;
}

function kitchenBackgroundFor(stepData) {
  return stepData.action === 'cutting' ? '주방_썰기.png' : '주방_끓이기.png';
}

const ASSET_VER = 'v22';

function assetUrl(path) {
  return `${path}?${ASSET_VER}`;
}

function isCuttingStep(stepData) {
  return stepData?.action === 'cutting';
}

function isRoastingStep(stepData) {
  return stepData?.action === 'roasting';
}

function syncHeatUi() {
  const fill = $('#heatFill');
  const label = $('#heatLabel');
  const fire = $('#fireImg');
  if (fill) {
    fill.style.height = `${Math.max(4, roastHeat.heat)}%`;
    fill.dataset.band = roastHeat.band;
  }
  if (label) label.textContent = bandLabel(roastHeat.band);
  if (fire && roastHeat.band !== lastFireBand) {
    lastFireBand = roastHeat.band;
    fire.src = fireSrcFor(roastHeat.band, ASSET_VER);
    fire.dataset.band = roastHeat.band;
  } else if (fire) {
    fire.dataset.band = roastHeat.band;
  }
}

function hideRoastStage() {
  const stage = $('#roastStage');
  if (stage) stage.hidden = true;
  const gauge = $('#heatGauge');
  if (gauge) gauge.hidden = true;
  $('.counter-scene')?.classList.remove('is-roasting');
  stopRoastHeat(roastHeat);
  roastArmed = false;
}

/** 굽기: 프라이팬 + 이전 썰기 횟수만큼 단면 + 불/게이지 */
function renderRoastStage(stepData) {
  const stage = $('#roastStage');
  const pan = $('#panImg');
  const slices = $('#roastSlices');
  const fire = $('#fireImg');
  const gauge = $('#heatGauge');
  if (!stage || !pan || !slices) return;

  const ingredientId = primaryIngredient(stepData);
  const wholeFile = ingredientAsset(ingredientId);
  const faceFile = wholeFile ? crossSectionFrom(wholeFile) : null;
  const n = getIngredientCuts(state, ingredientId, 3);

  stage.hidden = false;
  if (gauge) gauge.hidden = false;
  $('.counter-scene')?.classList.add('is-roasting');
  pan.src = assetUrl('./src/assets/도구/프라이팬.png');
  pan.alt = '프라이팬';

  resetRoastHeat(roastHeat);
  lastFireBand = '';
  if (fire) {
    fire.src = fireSrcFor('mid', ASSET_VER);
    fire.dataset.band = 'mid';
    fire.alt = '중불';
  }
  syncHeatUi();
  roastArmed = true;
  if (!animationId) {
    lastFrameTs = 0;
    animationId = requestAnimationFrame(tickLiveMic);
  }

  if (faceFile) {
    slices.innerHTML = Array.from({ length: n }, (_, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const angle = -28 + t * 56;
      const x = (t - 0.5) * 42;
      const y = Math.abs(t - 0.5) * 10;
      return `<img class="roast-slice" src="${assetUrl(`./src/assets/재료/${faceFile}`)}" alt="" draggable="false"
        style="--x:${x}%;--y:${y}%;--rot:${angle}deg;--i:${i}" />`;
    }).join('');
  } else if (wholeFile) {
    slices.innerHTML = `<img class="roast-whole" src="${assetUrl(`./src/assets/재료/${wholeFile}`)}" alt="" draggable="false" />`;
  } else {
    slices.innerHTML = '';
  }

  $('#stationIcon').hidden = true;
  $('#micStatus').textContent = `마이크 켜고 「후우~」 · ${n}조각 · 지금 ${bandLabel(roastHeat.band)}`;
  $('#stepHint').textContent = `목표 소리 “${stepData.targetPattern}” · 불어 강불, 가만히 있으면 약불`;
}

async function runCannedCut() {
  const knife = $('#knifeHand');
  const board = $('#cutBoard');
  await playCannedCut(cutSession, { knifeEl: knife, boardEl: board });
}

async function finishVoiceCut() {
  const knife = $('#knifeHand');
  const board = $('#cutBoard');
  await completeAfterVoice(cutSession, { knifeEl: knife, boardEl: board });
}

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
  $('#dayLabel').textContent = state.day;
  $('#moneyLabel').textContent = `${state.money.toLocaleString()}G`;
  $('#gradeLabel').textContent = state.grade;
  $('#guestCard').innerHTML = `<span>오늘의 손님</span><strong>${state.guest.name}</strong><p>${state.guest.demand}</p>`;
  $('#courseList').innerHTML = state.menu.courses.map((c, i) =>
    `<div class="course-item"><span>0${i + 1} · ${c.category}${c.level ? ` · ${c.level}` : ''}</span><b>${c.name}</b></div>`
  ).join('');

  const steps = getSteps(state);
  $('#timeline').innerHTML = steps.map((item, index) => {
    const status = index < state.currentStep ? 'done' : index === state.currentStep ? 'active' : '';
    const ing = (item.ingredients || []).map((id) => INGREDIENT_LABEL[id] || id).join('·');
    return `<div class="timeline-item ${status}"><i class="dot"></i><div><small>${item.course.name} · ${stationLabel(item)}${ing ? ` · ${ing}` : ''}</small><b>${item.title}</b></div><em>${state.players[index % 3]}</em></div>`;
  }).join('');

  if (state.finished) {
    renderResult();
    showScreen('result');
    return;
  }

  const current = getCurrent(state);
  const counterScene = $('.counter-scene');
  counterScene.classList.add('has-kitchen-background');
  counterScene.classList.toggle('is-cutting', isCuttingStep(current));
  counterScene.classList.toggle('is-roasting', isRoastingStep(current));

  const kitchenBg = $('#kitchenBg');
  kitchenBg.src = assetUrl(`./src/assets/배경/${kitchenBackgroundFor(current)}`);
  kitchenBg.alt = '';
  counterScene.style.backgroundImage = '';

  const ingredientId = primaryIngredient(current);
  const ingredientFile = ingredientAsset(ingredientId);
  const knife = $('#knifeHand');
  const cutBoard = $('#cutBoard');
  const cutIngredient = $('#cutIngredient');

  if (isCuttingStep(current) && ingredientFile) {
    hideRoastStage();
    cutIngredient.hidden = true;
    $('#stationIcon').hidden = true;
    knife.src = assetUrl('./src/assets/도구/오른손_칼.png');
    resetCutSession(cutSession, {
      ingredientFile,
      crossSectionFile: crossSectionFrom(ingredientFile),
      assetVer: ASSET_VER,
      cutCount: 3,
    });
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    renderCutBoard(cutBoard, cutSession);
    attachKnifeToTomato(cutBoard, knife, 0);
    cutSession.knifeX = 0;
    syncKnifeEl(knife, cutSession);
    counterScene.classList.add('is-zoomed');
    peakArmed = true;
    $('#micStatus').textContent = '마이크 켜기 → 「탁」하면 칼 자리에서 썰림 (점선=정답)';
    $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” · 점선이 정답, 어긋나도 그 자리 절단`;
  } else if (isRoastingStep(current)) {
    peakArmed = false;
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    cutBoard.hidden = true;
    cutBoard.innerHTML = '';
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
    cutIngredient.hidden = true;
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    renderRoastStage(current);
    $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” · ${current.hint}`;
  } else {
    peakArmed = false;
    hideRoastStage();
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    cutBoard.hidden = true;
    cutBoard.innerHTML = '';
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    cutIngredient.hidden = !ingredientFile;
    $('#stationIcon').hidden = Boolean(ingredientFile);
    if (ingredientFile) {
      cutIngredient.src = assetUrl(`./src/assets/재료/${ingredientFile}`);
      cutIngredient.alt = INGREDIENT_LABEL[ingredientId] || ingredientId;
    } else {
      cutIngredient.removeAttribute('src');
      cutIngredient.alt = '';
      $('#stationIcon').textContent = TYPE_ICON[current.type];
    }
    $('#micStatus').textContent = '마이크를 켜거나 테스트 입력을 사용하세요.';
    $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” · ${current.hint}`;
  }

  if (!isRoastingStep(current)) {
    $('#stationIcon').textContent = TYPE_ICON[current.type];
  }
  $('#stationLabel').textContent = `${current.course.name} / ${stationLabel(current)}`;
  $('#playerLabel').textContent = `${getPlayer(state)}의 차례`;
  $('#stepTitle').textContent = current.title;
  $('#stepCount').textContent = `${state.currentStep + 1} / ${steps.length}`;
}

function renderResult() {
  const result = calculateResult(state); const review = result.score >= 85 ? '셰프들의 호흡이 훌륭했습니다. 각 코스의 개성이 살아 있는 멋진 저녁이었어요.' : result.score >= 65 ? '조금 흔들린 순간도 있었지만, 팀워크가 돋보이는 기분 좋은 코스였습니다.' : '재료는 좋았지만 주방의 호흡을 조금 더 맞추면 훨씬 근사해질 것 같아요.';
  $('#reviewPanel').innerHTML = `<div class="stars">${'★'.repeat(result.stars)}${'☆'.repeat(5 - result.stars)}</div><h2>${result.score}점</h2><blockquote>“${review}”</blockquote><p class="muted">손님 요구 ${result.conditionMet ? '충족 · 보너스 +5점' : '미충족'} · 오늘의 매출 +${result.revenue}G</p>`;
}

document.addEventListener('click', (event) => {
  const go = event.target.closest('[data-go]');
  if (go) {
    event.preventDefault();
    showScreen(go.dataset.go);
  }
});

function on(el, type, handler) {
  if (!el) {
    console.warn('[bind]', type, 'missing element');
    return;
  }
  el.addEventListener(type, handler);
}

on($('#playerSetup'), 'input', (event) => {
  if (event.target.matches('[data-player]')) {
    state.players[Number(event.target.dataset.player)] = event.target.value.trim() || `셰프 ${Number(event.target.dataset.player) + 1}`;
  }
});
on($('#confirmTeamBtn'), 'click', () => {
  try {
    renderGame();
    showScreen('game');
  } catch (err) {
    console.error('게임 시작 실패:', err);
    alert(`게임 시작 오류: ${err.message}`);
  }
});
on($('#successBtn'), 'click', async () => {
  stopLiveMic();
  if (isCuttingStep(getCurrent(state)) && !cutSession.finished && !cutSession.animating) {
    await runCannedCut();
    return;
  }
  submitStep(state, 90);
  renderGame();
});
on($('#missBtn'), 'click', () => {
  stopLiveMic();
  submitStep(state, 45);
  renderGame();
});
on($('#nextDayBtn'), 'click', () => {
  startNextDay(state);
  showScreen('restaurant');
});

function applyTakHit(sourceLabel) {
  const now = performance.now();
  if (now - lastSpeechTakAt < 280) return;
  lastSpeechTakAt = now;

  const result = tryChopOnTak(cutSession, {
    knifeEl: $('#knifeHand'),
    boardEl: $('#cutBoard'),
  });
  if (result === 'complete') {
    setTimeout(() => finishVoiceCut(), 450);
  } else if (result === 'hit') {
    $('#micStatus').textContent = `${sourceLabel} · 정확! (${cutSession.actualCuts.length}/${cutSession.marks.length})`;
  } else if (result === 'off') {
    $('#micStatus').textContent = `${sourceLabel} · 어긋난 컷 (${cutSession.actualCuts.length}/${cutSession.marks.length})`;
  }
}

function stopTakSpeech() {
  speechWanted = false;
  if (speechKickTimer) {
    clearInterval(speechKickTimer);
    speechKickTimer = null;
  }
  if (!speechRec) return;
  try {
    speechRec.onend = null;
    speechRec.onresult = null;
    speechRec.onerror = null;
    speechRec.stop();
  } catch (_) { /* already stopped */ }
  speechRec = null;
}

function startTakSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('#micStatus').textContent = '음성인식 미지원 · 파열음 보조만 사용 (Chrome 권장)';
    return false;
  }

  stopTakSpeech();
  speechWanted = true;
  speechRec = new SR();
  speechRec.lang = 'ko-KR';
  speechRec.continuous = true;
  speechRec.interimResults = true;
  speechRec.maxAlternatives = 5;

  speechRec.onresult = (event) => {
    if (!peakArmed || !cutSession.listening || cutSession.finished || cutSession.animating) return;

    let chunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      for (let a = 0; a < result.length; a++) {
        chunk += ` ${result[a]?.transcript || ''}`;
      }
    }

    const n = countTakInText(chunk);
    if (!n) {
      const preview = chunk.trim().slice(0, 18);
      if (preview) {
        const now = performance.now();
        if (now - (cutSession._heardAt || 0) > 700) {
          cutSession._heardAt = now;
          $('#micStatus').textContent = `들음: “${preview}” · 「탁」에 더 가깝게`;
        }
      }
      return;
    }

    applyTakHit('STT 「탁」');
  };

  speechRec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed') {
      $('#micStatus').textContent = '마이크/음성인식 권한을 허용해 주세요.';
    }
  };

  speechRec.onend = () => {
    if (!speechWanted || !micOn) return;
    try {
      speechRec.start();
    } catch (_) { /* restart race */ }
  };

  // continuous가 가끔 멈추면 주기적으로 재시작
  speechKickTimer = setInterval(() => {
    if (!speechWanted || !speechRec || !micOn) return;
    try {
      speechRec.stop();
    } catch (_) { /* onend가 다시 start */ }
  }, 3500);

  try {
    speechRec.start();
    return true;
  } catch (error) {
    $('#micStatus').textContent = `음성인식 시작 실패: ${error.message}`;
    return false;
  }
}

function stopLiveMic() {
  micOn = false;
  lastFrameTs = 0;
  wasAboveBurst = false;
  stopTakSpeech();
  setListening(cutSession, false);
  liveStream?.getTracks().forEach((t) => t.stop());
  liveStream = null;
  if (audioContext && audioContext.state !== 'closed') audioContext.close();
  audioContext = null;
  analyser = null;
  $('#voiceBar').style.width = '0%';
  $('#micBtn').textContent = '마이크 켜기';
  $('#micBtn').disabled = false;
  // 굽기 중이면 게이지 하락 루프는 유지
  if (!roastArmed && animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

function volumePercentFromAnalyser(freq) {
  if (!freq?.length) return 0;
  let sum = 0;
  for (let i = 0; i < freq.length; i++) sum += freq[i];
  return Math.min(100, Math.floor((sum / freq.length / 128) * 100));
}

function tickLiveMic(ts) {
  if (!micOn && !roastArmed) return;

  const dt = lastFrameTs ? Math.min(0.05, (ts - lastFrameTs) / 1000) : 0.016;
  lastFrameTs = ts;

  const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  const wave = analyser ? new Uint8Array(analyser.fftSize) : null;
  let volumePercent = 0;
  if (analyser && freq && wave) {
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    volumePercent = volumePercentFromAnalyser(freq);
    $('#voiceBar').style.width = `${volumePercent}%`;
  }

  const knife = $('#knifeHand');
  const board = $('#cutBoard');
  const current = getCurrent(state);

  if (roastArmed && isRoastingStep(current)) {
    const blowVol = micOn ? volumePercent : 0;
    tickRoastHeat(roastHeat, blowVol, dt);
    syncHeatUi();
    if (micOn) {
      $('#micStatus').textContent = roastHeat.blowing
        ? `후우~ 불 키우는 중 · ${bandLabel(roastHeat.band)} (${Math.round(roastHeat.heat)}%)`
        : `가만히면 약불로… · ${bandLabel(roastHeat.band)} (${Math.round(roastHeat.heat)}%)`;
    }
  }

  if (micOn && peakArmed && isCuttingStep(current) && !cutSession.finished && !cutSession.animating) {
    advanceKnife(cutSession, dt);
    syncKnifeEl(knife, cutSession);

    const guides = board?.querySelectorAll('.cut-guide');
    if (guides?.length) {
      let hot = -1;
      let best = Infinity;
      for (let i = 0; i < cutSession.marks.length; i++) {
        if (cutSession.cutDone[i]) continue;
        const d = cutSession.knifeX - cutSession.marks[i];
        const inWin = d >= -0.1 && d <= 0.22;
        const score = Math.abs(d);
        if (inWin && score < best) {
          best = score;
          hot = i;
        }
      }
      guides.forEach((el, i) => {
        el.classList.toggle('done', cutSession.cutDone[i]);
        el.classList.toggle('hot', i === hot);
      });
    }

    if (freq && wave && cutSession.listening) {
      const sampleRate = audioContext?.sampleRate || 48000;
      const { hit, above, kind } = detectTakBurst(freq, wave, wasAboveBurst, sampleRate);
      wasAboveBurst = above;
      if (hit) applyTakHit('파열음 「탁」');
      else if (kind === 'thump' && above) {
        const now = performance.now();
        if (now - (cutSession._rejectAt || 0) > 800) {
          cutSession._rejectAt = now;
          $('#micStatus').textContent = '충격음 무시 · 입으로 「탁」';
        }
      }
    }
  }

  if (micOn || roastArmed) animationId = requestAnimationFrame(tickLiveMic);
  else animationId = null;
}

$('#micBtn').addEventListener('click', async () => {
  try {
    if (micOn) {
      stopLiveMic();
      $('#micStatus').textContent = peakArmed
        ? '일시정지 · 다시 켜면 칼이 이어서 이동'
        : roastArmed
          ? '마이크 끔 · 게이지는 약불로 내려감'
          : '마이크를 켜거나 테스트 입력을 사용하세요.';
      return;
    }

    liveStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const source = audioContext.createMediaStreamSource(liveStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = roastArmed ? 0.45 : 0.25;
    source.connect(analyser);

    micOn = true;
    lastFrameTs = 0;
    lastSpeechTakAt = 0;
    wasAboveBurst = false;
    $('#micBtn').textContent = '마이크 끄기';

    if (peakArmed) {
      setListening(cutSession, true);
      const ok = startTakSpeech();
      $('#micStatus').textContent = ok
        ? '듣는 중 · 「탁」 크게 · STT+파열음 보조'
        : '파열음 보조만 ON · 「탁」처럼 짧게';
    } else if (roastArmed) {
      stopTakSpeech();
      $('#micStatus').textContent = '「후우~」 불어 강불 · 멈추면 약불';
    } else {
      $('#micStatus').textContent = '볼륨 측정 중 (이 공정은 버튼으로 진행)';
    }
    if (!animationId) animationId = requestAnimationFrame(tickLiveMic);
  } catch (error) {
    console.error('마이크 접근 실패:', error);
    const msg = error?.message || String(error);
    $('#micStatus').textContent = /NotAllowed|Permission|getUserMedia|secure/i.test(msg)
      ? `${msg} · HTTPS 또는 localhost에서 실행해 주세요.`
      : msg;
    stopLiveMic();
  }
});

renderPlayers();
showScreen('start');
