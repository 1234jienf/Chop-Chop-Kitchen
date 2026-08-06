import {
  ACTION_LABEL,
  INGREDIENT_LABEL,
  TYPE_ICON,
  TYPE_LABEL,
  ingredientAsset,
  primaryIngredient,
} from './data.js?v=59';
import {
  calculateResult,
  createGameState,
  getCurrent,
  getIngredientCuts,
  getPlayer,
  getSteps,
  rememberIngredientCuts,
  startNextDay,
  submitStep,
} from './state.js?v=60';
import {
  advanceKnife,
  attachKnifeToTomato,
  completeAfterVoice,
  countTakInText,
  createCutSession,
  crossSectionFrom,
  CUT_LABEL_KO,
  cutCountForIngredient,
  cutAccuracy,
  JUDGE_KO,
  knifeStartX,
  nextRequiredLabel,
  nextRequiredStyle,
  tickCutVoiceHold,
  tickPendingChop,
  updateHotGuide,
  playCannedCut,
  renderCutBoard,
  renderLiveTomato,
  renderSplitBoard,
  resetCutSession,
  setListening,
  syncKnifeEl,
  tryChopOnTak,
} from './cutplay.js?v=94';
import {
  bandLabel,
  createRoastHeat,
  fireSrcFor,
  resetRoastHeat,
  roastAccuracy,
  roastTargetHint,
  roastToastStage,
  stopRoastHeat,
  tickRoastHeat,
} from './roastheat.js?v=54';
import {
  createMixingSession,
  DEFAULT_SCRIPT,
  getBowlPosition,
  getMixingOffset,
  getMixingRotation,
  getMixingScore,
  getMixingState,
  getBowlRotation,
  startMixing,
  stopMixing,
  tickMixing,
} from './mixing.js?v=53';
import {
  createFinishSession,
  detectPitch,
  finishAccuracy,
  holdPercent,
  isFinishStep,
  pitchPercent,
  resetFinishSession,
  reachTimeLeft,
  stopFinishSession,
  tickFinish,
} from './sprinklepourplay.js?v=53';
import { KitchenMultiplayer, defaultMultiplayerUrl } from './multiplayer.js?v=53';
import { completedCourseAt, createCourseCompleteView } from './coursecomplete.js?v=3';
import { preloadTmAudio, startTmListen, stopTmListen } from './tmAudio.js?v=21';
import { requestGuestReviews } from './dayreview.js?v=3';
import { renderReceipt, renderReceiptLoading } from './receipt.js?v=2';

const $ = (s) => document.querySelector(s);
const state = createGameState();
const courseCompleteView = createCourseCompleteView();
let setupPlayerIds = ['p1', 'p2', 'p3'];
const multiplayer = new KitchenMultiplayer({
  onRoom: (snapshot) => {
    if (snapshot.disconnected) {
      $('#multiStatus').textContent = '멀티 연결이 끊겼습니다.';
      return;
    }
    const names = new Map(snapshot.players.map((p) => [p.id, p.name]));
    if (!snapshot.game.started) {
      setupPlayerIds = snapshot.game.order?.length
        ? [...snapshot.game.order]
        : snapshot.players.map((p) => p.id);
      state.players = setupPlayerIds.map((id) => names.get(id));
      renderPlayers();
    }
    const ready = snapshot.players.filter((p) => p.ready).length;
    $('#multiStatus').textContent = `${snapshot.room} 방 · ${snapshot.players.length}/3명 · 준비 ${ready}/3`;
    const me = snapshot.players.find((p) => p.id === multiplayer.playerId);
    $('#confirmTeamBtn').textContent = me?.ready ? '준비 완료 ✓' : '준비하고 시작하기 →';
  },
  onGame: applySharedSnapshot,
  onActivity: (activity) => {
    if (multiplayer.isMyTurn) return;
    const current = getCurrent(state);
    if (activity.volume != null) $('#voiceBar').style.width = `${activity.volume}%`;
    if (activity.knifeX != null) {
      cutSession.knifeX = activity.knifeX;
      syncKnifeEl($('#knifeHand'), cutSession);
    }
    if (isCuttingStep(current) && Array.isArray(activity.actualCuts)) {
      const knife = $('#knifeHand');
      const counterScene = $('.counter-scene');
      const previousCutCount = cutSession.actualCuts.length;
      cutSession.actualCuts = [...activity.actualCuts];
      if (Array.isArray(activity.cutDone)) cutSession.cutDone = [...activity.cutDone];
      // renderLiveTomato replaces the board contents. Preserve the shared knife
      // outside that subtree so spectator re-renders cannot delete it.
      if (knife && counterScene && knife.parentElement !== counterScene) {
        counterScene.appendChild(knife);
      }
      renderLiveTomato($('#cutBoard'), cutSession, {
        justCut: cutSession.actualCuts.length > previousCutCount,
      });
      attachKnifeToTomato($('#cutBoard'), knife, cutSession.knifeX);
    }
    if (isCuttingStep(current)
      && activity.cutPhase === 'handoff'
      && activity.stepIndex === state.currentStep) {
      const knife = $('#knifeHand');
      const counterScene = $('.counter-scene');
      if (knife && counterScene && knife.parentElement !== counterScene) {
        counterScene.appendChild(knife);
      }
      if (knife) {
        knife.hidden = true;
        knife.classList.remove('knife-hand--on-tomato', 'chopping');
      }
      cutSession.finished = true;
      $('#cutBoard').classList.add('is-burst');
      renderSplitBoard($('#cutBoard'), cutSession);
      void playBoardHandoff();
    }
    if (activity.heat != null) {
      roastHeat.heat = activity.heat;
      roastHeat.band = activity.band;
      syncHeatUi();
      if (isRoastingStep(current)) syncRoastToastVisuals(primaryIngredient(current));
    }
    if (isBoilingStep(current) && activity.boilProgress != null) {
      boilProgress = activity.boilProgress;
      if (activity.boilLevel != null) boilLevel = activity.boilLevel;
      syncBoilFx();
    }
    if (isFinishStep(current) && activity.finish) {
      Object.assign(finishSession, activity.finish);
      syncFinishUi();
    }
    if (isMixingStep(current) && activity.mixing) {
      const sharedMixing = activity.mixing;
      if (Number.isFinite(sharedMixing.scriptMatchProgress)) {
        mixingSession.scriptMatchProgress = Math.max(0, Math.min(1, sharedMixing.scriptMatchProgress));
      }
      if (typeof sharedMixing.recognizedText === 'string') {
        mixingSession.recognizedText = sharedMixing.recognizedText;
      }
      if (Number.isFinite(sharedMixing.elapsed)) mixingSession.elapsed = sharedMixing.elapsed;
      if (Number.isFinite(sharedMixing.accuracy)) mixingSession.accuracy = sharedMixing.accuracy;
      const scoreDisplay = $('#mixingScore');
      if (scoreDisplay) scoreDisplay.textContent = `${getMixingScore(mixingSession)}%`;
      renderMixingGuideMatch(mixingSession.guideScript, mixingSession.recognizedText);
    }
  },
  onError: (message) => { $('#multiStatus').textContent = message; },
});

$('#multiplayerServerUrl').value = defaultMultiplayerUrl();
let micOn = false;
let liveStream = null;
let peakArmed = false;
let roastArmed = false;
let finishArmed = false;
let boilArmed = false;
let ovenArmed = false;
/** 스테이션 클로즈업에 들어가 있는지 (맵 ↔ 1인칭) */
let inStation = false;
/** 멀티 게임의 첫 스냅샷과 단계 전환을 구분하기 위한 플래그 */
let sharedGameInitialized = false;
let ovenStartTimer = null;
let ovenVisualDuration = 0; // n_a: 다이얼이 한 바퀴 도는 시각적 제한시간
let ovenTargetTime = null; // n_b: 플레이어가 말해야 하는 목표 시점 (초)
let ovenAcceptWindow = 1; // 허용 오차(초)
let ovenElapsed = 0;
let ovenStopped = false;
let ovenUserStopAt = null; // 사용자가 띵을 외친 시각(초)
let ovenLightOn = false;
let lastFrameTs = 0;
let speechRec = null;
let speechWanted = false;
let lastSpeechTakAt = 0;
let tmMicActive = false;
/** 썰기 입력 절대 게이트 — 콜백 경합으로 2연타 나는 것 차단 */
let cutHitGateUntil = 0;
/** 마이크 켠 직후 클릭음 무시 */
let cutVoiceArmedAt = 0;
let cutDebugMuteUntil = 0;
let lastMicVolume = 0;
let speechKickTimer = null;
const roastHeat = createRoastHeat();
const finishSession = createFinishSession();
let finishSubmitted = false;
let lastFireBand = 'mid';
let lastToastLevel = 0;
let boilProgress = 0;
/** Teachable Machine boost windows (ms timestamps) */
let tmBoostUntil = 0;
let tmHuuUntil = 0;
let tmChapUntil = 0;
let boilElapsed = 0;
let boilLevel = -1;
/** 끓이기 불 테스트 고정 (약/중/강) */
let boilFireLock = null;
const BOIL_NEED_SEC = 9;
const BOIL_LIMIT_SEC = 30;

let mixingArmed = false;
const mixingSession = createMixingSession();
let mixingSpeechRec = null;
let mixingSpeechWanted = false;

let audioContext = null;
let analyser = null;
let animationId = null;
let lastActivitySentAt = 0;
let lastTimelineScrollStep = -1;

const cutSession = createCutSession({
  onStatus: (msg) => { $('#micStatus').textContent = msg; },
  onComplete: (accuracy) => {
    void finishCutStep(accuracy);
  },
});

async function finishCutStep(accuracy) {
  stopLiveMic();
  const current = getCurrent(state);
  if (!isMixingStep(current)) hideMixingStage();
  const id = primaryIngredient(current);
  const cuts = cutSession.actualCuts?.length || cutSession.marks?.length || 3;
  rememberIngredientCuts(state, id, cuts);
  $('#micStatus').textContent = `절단 완료 · ${accuracy}점 · ${cuts}조각`;
  $('.counter-scene')?.classList.remove('is-zoomed');

  const steps = getSteps(state);
  const next = steps[state.currentStep + 1];
  const willCutNext = next?.action === 'cutting';

  if (multiplayer.connected && multiplayer.isMyTurn) {
    multiplayer.sendActivity({
      cutPhase: 'handoff',
      stepIndex: state.currentStep,
    });
  }
  await playBoardHandoff();
  commitStep(accuracy);
  // In multiplayer the authoritative snapshot advances the step and re-renders
  // every client. Only the offline path can safely inspect the next local step
  // immediately after committing it.
  if (!multiplayer.connected && willCutNext && isCuttingStep(getCurrent(state))) {
    await playBoardEnter();
  }
}

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
  if (stepData?.action === 'putting' || stepData?.action === 'sprinkling') return '주방_접시.png';
  if (stepData?.action === 'cutting') return '주방_배경.png';
  if (stepData?.action === 'roasting') return '주방_끓이기.png';
  if (stepData?.action === 'mixing') return '주방_배경.png';
  if (stepData?.action === 'oven') return '주방_오븐닫_2.png';
  return '주방_끓이기.png';
}

const ASSET_VER = 'v45';

function fitGameStage() {
  // 풀스크린 오버레이 레이아웃 — scale 고정 불필요
  const stage = $('#gameStage');
  if (stage) stage.style.removeProperty('--stage-scale');
}

let fitRaf = 0;
function scheduleFitGameStage() {
  cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(fitGameStage);
}

window.addEventListener('resize', scheduleFitGameStage);
window.addEventListener('orientationchange', scheduleFitGameStage);

function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let boardHandoffToken = 0;

async function playBoardHandoff() {
  const token = ++boardHandoffToken;
  const stack = $('#cutStack');
  const hand = $('#passHand');
  const knife = $('#knifeHand');
  if (!stack || stack.hidden) return;

  if (knife) {
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
  }

  // 손이 도마 위에 먼저 얹힌 뒤, 도마+손이 같이 오른쪽으로
  if (hand) {
    if (hand.parentElement !== stack) stack.appendChild(hand);
    hand.hidden = false;
    hand.classList.remove('is-on-board');
    void hand.offsetWidth;
    hand.classList.add('is-on-board');
  }

  await waitMs(280);
  if (token !== boardHandoffToken) return;
  stack.classList.remove('is-entering');
  stack.classList.add('is-passing-out');
  await waitMs(900);
  if (token !== boardHandoffToken) return;

  stack.classList.remove('is-passing-out');
  stack.hidden = true;
  if (hand) {
    hand.classList.remove('is-on-board');
    hand.hidden = true;
  }
}

async function playBoardEnter() {
  const stack = $('#cutStack');
  if (!stack || stack.hidden) {
    if (stack) stack.hidden = false;
  }
  if (!stack) return;
  stack.classList.remove('is-passing-out');
  stack.classList.add('is-entering');
  await waitMs(700);
  stack.classList.remove('is-entering');
}

function assetUrl(path) {
  return `${path}?${ASSET_VER}`;
}

function isCuttingStep(stepData) {
  return stepData?.action === 'cutting';
}

function isRoastingStep(stepData) {
  return stepData?.action === 'roasting';
}

function isOvenStep(stepData) {
  return stepData?.action === 'oven';
}

function isBoilingStep(stepData) {
  return stepData?.action === 'boiling';
}

function isMixingStep(stepData) {
  return stepData?.action === 'mixing';
}

/** 바게트 굽기: 단면(0) → 굽1 → 굽2 → 굽3(최종) */
function baguetteToastFile(level) {
  const lv = Math.max(0, Math.min(3, level | 0));
  if (lv === 0) return '바게트_단면.png';
  return `바게트굽${lv}.png`;
}

function roastToastLevel(session) {
  return roastToastStage(session);
}

function roastSliceSrc(ingredientId, session) {
  if (ingredientId === 'baguette') {
    return assetUrl(`./src/assets/재료/${baguetteToastFile(roastToastLevel(session))}`);
  }
  const wholeFile = ingredientAsset(ingredientId);
  const faceFile = wholeFile ? crossSectionFrom(wholeFile) : null;
  if (faceFile) return assetUrl(`./src/assets/재료/${faceFile}`);
  if (wholeFile) return assetUrl(`./src/assets/재료/${wholeFile}`);
  return null;
}

function toastStatusLabel(level) {
  if (level <= 0) return '단면';
  if (level >= 3) return '굽3';
  return `굽${level}`;
}

function syncRoastToastVisuals(ingredientId) {
  const slices = $('#roastSlices');
  if (!slices || ingredientId !== 'baguette') return;
  const level = roastToastLevel(roastHeat);
  const displayLevel = Math.max(lastToastLevel >= 0 ? lastToastLevel : 0, level);
  if (displayLevel === lastToastLevel) return;
  lastToastLevel = displayLevel;
  const src = assetUrl(`./src/assets/재료/${baguetteToastFile(displayLevel)}`);
  slices.querySelectorAll('.roast-slice, .roast-whole').forEach((img) => {
    img.src = src;
    img.dataset.toast = String(displayLevel);
  });
}

function applyFireSprite(band, force = false) {
  const fire = $('#fireImg');
  if (!fire) return;
  if (!force && band === lastFireBand && fire.dataset.band === band) return;
  lastFireBand = band;
  fire.dataset.band = band;
  fire.alt = bandLabel(band);
  // 캐시/동일 경로 이슈 방지: 강제 리로드
  const base = fireSrcFor(band, ASSET_VER);
  fire.src = force ? `${base}&r=${Date.now()}` : base;
}

function applyBoilFireSprite(band, force = false) {
  const fire = $('#boilFireImg');
  if (!fire) return;
  if (!force && fire.dataset.band === band) return;
  fire.dataset.band = band;
  fire.alt = bandLabel(band);
  const base = fireSrcFor(band, ASSET_VER);
  fire.src = force ? `${base}&r=${Date.now()}` : base;
}

function syncFireTestButtons(activeBand) {
  const wrap = $('#fireTestBtns');
  if (!wrap) return;
  const band = activeBand || roastHeat.band;
  wrap.querySelectorAll('[data-fire-test]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.fireTest === band);
  });
}

function forceFireBand(band) {
  if (boilArmed) {
    boilFireLock = band;
    const level = band === 'high' ? 2 : band === 'mid' ? 1 : 0;
    boilLevel = level;
    boilProgress = level === 2 ? BOIL_NEED_SEC * 0.8 : level === 1 ? BOIL_NEED_SEC * 0.45 : BOIL_NEED_SEC * 0.1;
    applyBoilFireSprite(band, true);
    syncBoilFx();
    syncFireTestButtons(band);
    $('#micStatus').textContent = `테스트 고정 · ${bandLabel(band)}`;
    return;
  }
  const heat = band === 'low' ? 18 : band === 'high' ? 85 : 50;
  roastHeat.heat = heat;
  roastHeat.band = band;
  roastHeat.debugLock = true;
  applyFireSprite(band, true);
  syncHeatUi();
  syncFireTestButtons(band);
  $('#micStatus').textContent = `테스트 고정 · ${bandLabel(band)} (다시 플레이하려면 성공/실수로 넘어가기)`;
}

function syncHeatUi() {
  const cursor = $('#heatCursor');
  const target = $('#heatTarget');
  const matchFill = $('#heatMatchFill');
  const targetLabel = $('#heatTargetLabel');
  const nowLabel = $('#heatNowLabel');
  const hint = $('#heatLabel');
  const blowFx = $('#blowFx');

  if (cursor) cursor.style.left = `${roastHeat.heat}%`;
  if (target) {
    const w = Math.max(8, roastHeat.targetMax - roastHeat.targetMin);
    target.style.left = `${roastHeat.targetMin}%`;
    target.style.width = `${w}%`;
  }
  if (matchFill) {
    const pct = Math.min(100, (roastHeat.matchTime / Math.max(1, roastHeat.needMatch)) * 100);
    matchFill.style.width = `${pct}%`;
  }
  if (targetLabel) {
    const warn = roastHeat.nextTargetBand
      ? `목표 ${bandLabel(roastHeat.targetBand)} · 곧 ${bandLabel(roastHeat.nextTargetBand)}`
      : `목표 ${bandLabel(roastHeat.targetBand)}`;
    targetLabel.textContent = warn;
  }
  if (nowLabel) nowLabel.textContent = `지금 ${bandLabel(roastHeat.band)}`;
  if (hint) {
    const inZone = roastHeat.heat >= roastHeat.targetMin && roastHeat.heat <= roastHeat.targetMax;
    hint.textContent = inZone
      ? '좋아요! 목표 구간 유지 중'
      : roastHeat.heat < roastHeat.targetMin
        ? '더 불어 불을 키우세요'
        : '조금 쉬며 불을 낮추세요';
  }

  applyFireSprite(roastHeat.band);
  syncFireTestButtons(roastHeat.band);

  if (blowFx) {
    const on = Boolean(roastHeat.blowing);
    if (on) blowFx.hidden = false;
    blowFx.classList.toggle('is-on', on);
    if (!on && !roastArmed) blowFx.hidden = true;
  }
}

const COURSE_DISH_ASSET = {
  '브루스케타': ['에피타이저', '브루스케타.png'],
  '카프레제 타르타르': ['에피타이저', '카프레제타르타르.png'],
  '카프레제 샐러드': ['에피타이저', '카프레제타르타르.png'],
  '크림 오브 머쉬룸': ['스타터', '크림오브머쉬룸.png'],
  '애플 타르트': ['디저트', '애플타르트.png'],
  '크림 브륄레': ['디저트', '크림브륄레.png'],
  '초콜릿 라바케이크': ['디저트', '초콜릿라바케이크.png'],
  '구운 바나나 파르페': ['디저트', '애플타르트.png'],
};

function hideFinishStage() {
  const stage = $('#finishStage');
  if (stage) {
    stage.hidden = true;
    stage.classList.remove('is-pouring', 'is-test-miss');
  }
  $('.counter-scene')?.classList.remove('is-finishing');
  stopFinishSession(finishSession);
  finishArmed = false;
  finishSubmitted = false;
}

function renderFinishStage(stepData) {
  const stage = $('#finishStage');
  const dish = $('#finishDish');
  const tool = $('#finishTool');
  const stream = $('#finishStream');
  if (!stage || !dish || !tool || !stream) return;

  const dishAsset = COURSE_DISH_ASSET[stepData.course?.name] || ['에피타이저', '브루스케타.png'];
  const finishAsset = stepData.sprinklePourAsset || (stepData.action === 'sprinkling' ? '파슬리' : '올리브');
  stage.hidden = false;
  $('.counter-scene')?.classList.add('is-finishing');
  dish.src = assetUrl(`./src/assets/${dishAsset[0]}/${dishAsset[1]}`);
  tool.src = assetUrl(`./src/assets/재료/${finishAsset}_idle.png`);
  tool.dataset.idle = assetUrl(`./src/assets/재료/${finishAsset}_idle.png`);
  tool.dataset.pour = assetUrl(`./src/assets/재료/${finishAsset}_pour.png`);
  stream.dataset.kind = stepData.sprinklePourKind || 'liquid';
  stream.innerHTML = Array.from({ length: 26 }, (_, i) => `<i style="--i:${i};--drift:${((i * 37) % 25) - 12}px"></i>`).join('');
  resetFinishSession(finishSession, stepData);
  finishArmed = true;
  finishSubmitted = false;
  syncFinishUi();
  $('#micStatus').textContent = '마이크를 켜고 목표 음정까지 소리를 올려보세요.';
  $('#stepHint').textContent = `${finishSession.targetNotes.join(' → ')} · 각 음을 10초 안에 찾아 2초간 유지하세요.`;
}

function syncFinishUi() {
  const percent = holdPercent(finishSession);
  const inTune = finishSession.pitchHz && Math.abs(finishSession.cents) <= finishSession.toleranceCents;
  const showPouring = finishSession.isPouring;
  $('#pitchNeedle').style.bottom = `${pitchPercent(finishSession)}%`;
  $('#holdFill').style.width = `${percent}%`;
  $('#holdLabel').textContent = `${finishSession.hold.toFixed(1)} / ${finishSession.holdSeconds.toFixed(1)}초`;
  const timeLeft = reachTimeLeft(finishSession);
  const timer = $('#reachTimer');
  const targetStep = finishSession.targetPitches.length > 1
    ? `${finishSession.targetIndex + 1}/${finishSession.targetPitches.length}`
    : '목표';
  const targetNote = finishSession.targetNotes[finishSession.targetIndex] || `${Math.round(finishSession.targetHz)}Hz`;
  if (finishSession.reachedAt != null) {
    timer.textContent = `${targetStep} ${targetNote} · 도달 ${finishSession.reachedAt.toFixed(1)}초 · 예상 ${finishAccuracy(finishSession)}점`;
    timer.classList.remove('is-late');
  } else if (timeLeft > 0) {
    timer.textContent = `${targetStep} ${targetNote} · 도달까지 ${timeLeft.toFixed(1)}초`;
    timer.classList.remove('is-late');
  } else {
    timer.textContent = `${targetStep} ${targetNote} · 제한시간 초과`;
    timer.classList.add('is-late');
  }
  $('#finishStage').classList.toggle('is-pouring', Boolean(showPouring));
  $('#finishTool').src = showPouring ? $('#finishTool').dataset.pour : $('#finishTool').dataset.idle;
  $('#pitchLabel').textContent = !finishSession.pitchHz
    ? `${targetStep} ${targetNote}`
    : inTune ? `${targetNote} 좋아요!`
      : finishSession.cents < 0 ? `${targetNote} · 더 높게!` : `${targetNote} · 더 낮게!`;
}

async function playFinishTestEffect(accuracy) {
  const stage = $('#finishStage');
  const tool = $('#finishTool');
  if (!finishArmed || !stage || !tool) return false;

  $('#successBtn').disabled = true;
  $('#missBtn').disabled = true;
  stage.classList.add('is-pouring');
  stage.classList.toggle('is-test-miss', accuracy < 60);
  tool.src = tool.dataset.pour;
  $('#holdFill').style.width = accuracy < 60 ? '32%' : '100%';
  $('#holdLabel').textContent = accuracy < 60 ? '음정이 흔들렸어요' : '효과 미리보기';
  $('#reachTimer').textContent = accuracy < 60 ? '실수 입력 · 낮은 점수' : '성공 입력 · 높은 점수';
  $('#micStatus').textContent = accuracy < 60 ? '조금 빗나갔지만 마무리했어요.' : '완벽하게 뿌렸어요!';
  await new Promise(resolve => setTimeout(resolve, accuracy < 60 ? 850 : 1100));
  $('#successBtn').disabled = false;
  $('#missBtn').disabled = false;
  return true;
}

function hideRoastStage() {
  const stage = $('#roastStage');
  if (stage) stage.hidden = true;
  const rhythm = $('#heatRhythm');
  if (rhythm) rhythm.hidden = true;
  const gauge = $('#heatGauge');
  if (gauge) gauge.hidden = true;
  const blowFx = $('#blowFx');
  if (blowFx) {
    blowFx.classList.remove('is-on');
    blowFx.hidden = true;
  }
  $('.counter-scene')?.classList.remove('is-roasting');
  stopRoastHeat(roastHeat);
  roastArmed = false;
  const testBtns = $('#fireTestBtns');
  if (testBtns) testBtns.hidden = true;
}

function hideBoilStage() {
  const stage = $('#boilStage');
  if (stage) stage.hidden = true;
  stage?.classList.remove('is-bubbling', 'boil-hot', 'boil-med', 'boil-low');
  $('.counter-scene')?.classList.remove('is-boiling');
  boilArmed = false;
  boilProgress = 0;
  boilElapsed = 0;
  boilLevel = -1;
  boilFireLock = null;
  const testBtns = $('#fireTestBtns');
  if (testBtns && !roastArmed) testBtns.hidden = true;
}

function syncBoilFx() {
  const stage = $('#boilStage');
  if (!stage) return;

  let level = boilLevel;
  let band = 'low';
  if (boilFireLock) {
    band = boilFireLock;
    level = band === 'high' ? 2 : band === 'mid' ? 1 : 0;
    boilLevel = level;
  } else {
    const p = boilProgress / Math.max(0.001, BOIL_NEED_SEC);
    level = p >= 0.66 ? 2 : p >= 0.33 ? 1 : 0;
    boilLevel = level;
    band = level === 2 ? 'high' : level === 1 ? 'mid' : 'low';
  }

  stage.classList.toggle('boil-low', level === 0);
  stage.classList.toggle('boil-med', level === 1);
  stage.classList.toggle('boil-hot', level === 2);
  applyBoilFireSprite(band);
  syncFireTestButtons(band);

  // boilAsset이 있으면 레벨에 따라 이미지 업데이트
  const current = getCurrent(state);
  if (current?.boilAsset) {
    updateBoilPotImage(current.boilAsset, level);
  }
}

/** boilAsset을 기반으로 현재 레벨에 맞는 냄비 이미지 업데이트 */
function updateBoilPotImage(baseAsset, level) {
  const pot = $('#potImg');
  if (!pot) return;

  // 기본 파일명에서 숫자 추출 (예: '클램 차우더_1.png' → '클램 차우더', 1)
  const match = baseAsset.match(/^(.+?)_(\d+)\.png$/);
  if (!match) {
    // 숫자가 없으면 기본 파일 사용
    pot.src = assetUrl(`./src/assets/끓이기/${baseAsset}`);
    return;
  }

  const basename = match[1];
  const targetNum = level + 1; // level 0→1, 1→2, 2→3

  // 시도할 이미지 번호 (우선순위: targetNum → targetNum-1 → ... → 1)
  let finalNum = targetNum;
  for (let i = targetNum; i >= 1; i--) {
    const candidate = `${basename}_${i}.png`;
    // 현재는 존재 여부를 확인할 수 없으므로, 나중에 로드 실패 시 fallback 처리
    // 일단 계산된 번호로 시도
    finalNum = i;
    break;
  }

  const filename = `${basename}_${finalNum}.png`;
  pot.src = assetUrl(`./src/assets/끓이기/${filename}`);
  pot.alt = filename;
}

function hideMixingStage() {
  const stage = $('#mixingStage');
  if (stage) stage.hidden = true;
  $('.counter-scene')?.classList.remove('is-mixing');

  // mixing 세션에서 로드한 이미지 및 콘텐츠 정리

  const bowl = $('#mixingBowlImg');
  if (bowl) bowl.src = '';

  const mixingImg = $('#mixingContentImg');
  if (mixingImg) mixingImg.src = '';

  const guideText = $('#mixingGuideText');
  if (guideText) guideText.textContent = '';

  const scoreDisplay = $('#mixingScore');
  if (scoreDisplay) scoreDisplay.textContent = '';

  try { stopMixingSpeech(); } catch (_) {}
  stopMixing(mixingSession);
  mixingArmed = false;
}

/** 오븐 스테이지 UI/로직 추가 */
function syncOvenUi() {
  const dial = $('#ovenDial');
  const light = $('#ovenLightImg');
  const hint = $('#ovenHint');

  // 다이얼 이미지(배경)와 바늘(needle)을 설정하고 회전시키기
  if (dial) {
    // background: 다이얼 이미지 (사용자 추가: src/assets/오븐/다이얼.png)
    dial.style.backgroundImage = `url(${assetUrl('./src/assets/오븐/다이얼.png')})`;
    dial.style.backgroundSize = 'contain';
    dial.style.backgroundRepeat = 'no-repeat';
    dial.style.backgroundPosition = 'center';
    // 바늘 엘리먼트가 없으면 생성
    let needle = dial.querySelector('.oven-needle');
    if (!needle) {
      needle = document.createElement('div');
      needle.className = 'oven-needle';
      dial.appendChild(needle);
    }
    // 회전: ovenVisualDuration 동안 1바퀴 (시작은 12시)
    const frac = ovenVisualDuration > 0 ? Math.min(1, ovenElapsed / ovenVisualDuration) : 0;
    const deg = frac * 360; // 0deg = 12시 시작, 시계 방향 회전
    needle.style.transform = `translateX(-50%) rotate(${deg}deg)`;
  }

  if (light) {
    // 깜빡임은 클래스 토글로 처리
    light.classList.toggle('is-on', Boolean(ovenLightOn));
  }
  if (hint) {
    if (ovenTargetTime != null) {
      const untilTarget = ovenTargetTime - ovenElapsed;
      const totalLeft = Math.max(0, ovenVisualDuration - ovenElapsed);
      hint.classList.toggle('is-now', untilTarget <= 0 && untilTarget >= -ovenAcceptWindow);
      hint.classList.toggle('is-late', untilTarget < -ovenAcceptWindow);
      hint.textContent = untilTarget > 0
        ? `${untilTarget.toFixed(1)}초 후에 “띵” 소리를 내주세요 · 제한시간 ${totalLeft.toFixed(1)}초`
        : untilTarget >= -ovenAcceptWindow
          ? `지금 “띵”! · 허용시간 ${Math.max(0, ovenAcceptWindow + untilTarget).toFixed(1)}초`
          : `목표 시간을 지났어요 · 남은 제한시간 ${totalLeft.toFixed(1)}초`;
      hint.hidden = false;
    } else {
      hint.textContent = '';
      hint.hidden = true;
    }
  }
}

function renderOvenStage(stepData) {
  const stage = $('#ovenStage');
  if (!stage) return;
  hideRoastStage();
  hideBoilStage();
  hideOvenStage();
  stage.hidden = false;
  const hint = $('#ovenHint');
  if (hint) hint.hidden = false;
  $('.counter-scene')?.classList.add('is-oven');

  // 오븐 내부에 재료 이미지를 표시 (오븐 전용 파일명 우선)
  const contents = $('#ovenContents');
  const files = stepData?.ovenFiles || [];
  const ingIds = stepData?.ingredients || [];
  if (contents) {
    contents.innerHTML = '';
    files.forEach((fileName, idx) => {
      const img = document.createElement('img');
      img.className = 'oven-ingredient';
      img.alt = ingIds[idx] || fileName;
      // 시도 순서: ./src/assets/오븐/<fileName> -> ./src/assets/재료/<fileName> -> ./src/assets/오븐/<basename>
      const tryPaths = [
        `./src/assets/오븐/${fileName}`,
        `./src/assets/재료/${fileName}`,
        `./src/assets/오븐/${fileName.replace(/^.*[\\\\/]/, '')}`,
      ];
      let attempt = 0;
      const tryNext = () => {
        if (attempt >= tryPaths.length) return;
        const p = tryPaths[attempt++];
        img.onerror = () => tryNext();
        img.src = assetUrl(p);
      };
      tryNext();
      img.style.transformOrigin = '50% 50%';

      const item = document.createElement('div');
      item.className = 'oven-item';
      item.style.position = 'relative';
      item.style.display = 'inline-block';
      item.style.zIndex = '30';
      const horiz = (idx - (files.length - 1) / 2) * 8;
      item.style.setProperty('--oven-item-x', `${horiz}%`);
      item.style.transform = 'translateX(var(--oven-item-x)) scale(var(--oven-item-scale, 0.9))';
      item.style.transformOrigin = '50% 100%';
      item.appendChild(img);
      contents.appendChild(item);
    });
  }

  // 레시피별 제한시간을 사용하고, 없으면 기본 25초로 작동
  ovenVisualDuration = (typeof stepData?.ovenVisualDuration === 'number')
    ? stepData.ovenVisualDuration
    : 25;
  ovenAcceptWindow = (typeof stepData?.ovenAcceptWindow === 'number') ? stepData.ovenAcceptWindow : ovenAcceptWindow;

  ovenElapsed = 0;
  ovenStopped = false;
  ovenUserStopAt = null;
  ovenLightOn = false;
  // start delayed: set ovenArmed after 2 seconds regardless of mic state
  ovenArmed = false;
  if (ovenStartTimer) { clearTimeout(ovenStartTimer); ovenStartTimer = null; }
  ovenStartTimer = setTimeout(() => {
    ovenArmed = true;
    // ensure animation loop runs when oven actually starts
    if (!animationId) {
      lastFrameTs = 0;
      animationId = requestAnimationFrame(tickLiveMic);
    }
    $('#micStatus').textContent = `오븐 가동 중 · ${ovenVisualDuration}초 동안 유지하세요`;
  }, 2000);

  // 오븐 불빛 이미지는 로드하지 않음 (불빛 끔)
  const light = $('#ovenLightImg');
  if (light) {
    light.src = '';
    light.classList.remove('is-on');
  }

  // 목표 시점(n_b)을 설정: stepData에 명시되어 있지 않으면 5~15 사이 정수로 선택
  ovenTargetTime = (typeof stepData?.ovenTargetTime === 'number')
    ? stepData.ovenTargetTime
    : (Math.floor(Math.random() * 11) + 5); // 5..15 (정수)

  // 다이얼 상에 목표 가이드(타겟 마커) 표시
  const dial = $('#ovenDial');
  if (dial) {
    let target = dial.querySelector('.oven-target');
    if (!target) {
      target = document.createElement('div');
      target.className = 'oven-target';
      dial.appendChild(target);
    }
    const angle = -90 + (ovenTargetTime / Math.max(1, ovenVisualDuration)) * 360;
    // transform rotates the marker to angle then pushes it outward
    target.style.transform = `rotate(${angle}deg) translateY(-52%) translateX(-50%)`;
    target.style.display = 'block';
  }

  syncOvenUi();
  $('#micStatus').textContent = `오븐 가동 중 · ${ovenVisualDuration}초 동안 유지하세요`;
  $('#stationIcon').hidden = true;
  if (!animationId) {
    lastFrameTs = 0;
    animationId = requestAnimationFrame(tickLiveMic);
  }
}

function hideOvenStage() {
  const stage = $('#ovenStage');
  if (stage) stage.hidden = true;
  $('.counter-scene')?.classList.remove('is-oven');
  // clear oven contents (both in-stage and screen-fixed)
  const contents = $('#ovenContents');
  if (contents) contents.innerHTML = '';
  const screenContents = $('#ovenContentsScreen');
  if (screenContents) { screenContents.innerHTML = ''; screenContents.remove(); }
  // remove dial needle & target & background
  const dial = $('#ovenDial');
  if (dial) {
    dial.style.backgroundImage = '';
    const needle = dial.querySelector('.oven-needle');
    if (needle) dial.removeChild(needle);
    const target = dial.querySelector('.oven-target');
    if (target) dial.removeChild(target);
  }
  // clear light
  const light = $('#ovenLightImg');
  if (light) { light.src = ''; light.classList.remove('is-on'); }
  const hint = $('#ovenHint');
  if (hint) {
    hint.hidden = true;
    hint.textContent = '';
    hint.classList.remove('is-now', 'is-late');
  }

  try { stopOvenSpeech(); } catch (_) {}

  if (ovenStartTimer) { clearTimeout(ovenStartTimer); ovenStartTimer = null; }

  ovenArmed = false;
  ovenElapsed = 0;
  ovenVisualDuration = 0;
  ovenTargetTime = null;
  ovenUserStopAt = null;
  ovenStopped = false;
  ovenLightOn = false;
}

function startOvenSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('#micStatus').textContent = '음성인식 미지원 · 키 입력으로 진행 (Chrome 권장)';
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
    if (!ovenArmed) return;
    let chunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      for (let a = 0; a < result.length; a++) {
        chunk += ` ${result[a]?.transcript || ''}`;
      }
    }
    const compact = chunk.replace(/\s+/g, '').toLowerCase();
    if (compact.includes('띵') || compact.includes('딩') || compact.includes('ding')) {
      ovenStopped = true;
      ovenUserStopAt = ovenElapsed; // 기록된 시각
      $('#micStatus').textContent = `띵 소리 감지됨 · ${ovenUserStopAt.toFixed(2)}s 기록`;
    }
  };

  speechRec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
  };

  speechRec.onend = () => {
    if (!speechWanted || !micOn) return;
    try { speechRec.start(); } catch (_) {}
  };

  // 주기적 재시작
  speechKickTimer = setInterval(() => {
    if (!speechWanted || !speechRec || !micOn) return;
    try { speechRec.stop(); } catch (_) {}
  }, 3500);

  try { speechRec.start(); return true; } catch (error) { $('#micStatus').textContent = `음성인식 시작 실패: ${error.message}`; return false; }
}

function stopOvenSpeech() {
  speechWanted = false;
  if (speechKickTimer) { clearInterval(speechKickTimer); speechKickTimer = null; }
  if (!speechRec) return;
  try {
    speechRec.onend = null;
    speechRec.onresult = null;
    speechRec.onerror = null;
    speechRec.stop();
  } catch (_) {}
  speechRec = null;
}

function stopMixingSpeech() {
  mixingSpeechWanted = false;
  if (!mixingSpeechRec) return;
  try {
    mixingSpeechRec.onend = null;
    mixingSpeechRec.onresult = null;
    mixingSpeechRec.onerror = null;
    mixingSpeechRec.stop();
  } catch (_) {}
  mixingSpeechRec = null;
}

function renderMixingGuideMatch(targetScript = '', recognizedText = '') {
  const guideText = $('#mixingGuideText');
  if (!guideText) return;
  guideText.replaceChildren(...Array.from(targetScript, (character, index) => {
    const span = document.createElement('span');
    span.textContent = character;
    span.classList.toggle('matched', index < recognizedText.length && recognizedText[index] === character);
    return span;
  }));
}

function startMixingSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('#micStatus').textContent = '음성인식 미지원 (Chrome 권장)';
    return false;
  }

  stopMixingSpeech();
  mixingSpeechWanted = true;
  mixingSpeechRec = new SR();
  mixingSpeechRec.lang = 'ko-KR';
  mixingSpeechRec.continuous = true;
  mixingSpeechRec.interimResults = true;
  mixingSpeechRec.maxAlternatives = 5;

  mixingSpeechRec.onresult = (event) => {
    if (!mixingArmed) return;
    let chunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      chunk += ` ${result[0]?.transcript || ''}`;
    }
    chunk = chunk.trim();

    // 인식된 텍스트를 기반으로 대본 일치도 계산
    if (chunk && mixingSession.guideScript) {
      const targetScript = mixingSession.guideScript;
      const normalizedTarget = targetScript.replace(/[^\p{L}\p{N}]/gu, '');
      const normalizedChunk = chunk.replace(/[^\p{L}\p{N}]/gu, '');
      let matchCount = 0;
      for (let i = 0; i < Math.min(normalizedChunk.length, normalizedTarget.length); i++) {
        if (normalizedChunk[i] === normalizedTarget[i]) matchCount++;
      }
      mixingSession.recognizedText = chunk;
      mixingSession.scriptMatchProgress = Math.min(1.0, matchCount / Math.max(1, normalizedTarget.length));

      // 가이드 텍스트 색상 업데이트
      renderMixingGuideMatch(targetScript, chunk);
    }
  };

  mixingSpeechRec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
  };

  mixingSpeechRec.onend = () => {
    if (!mixingSpeechWanted || !micOn) return;
    try { mixingSpeechRec.start(); } catch (_) {}
  };

  try { mixingSpeechRec.start(); return true; } catch (error) { return false; }
}

/** 끓이기: 물 냄비 고정 + 보글 이펙트 */
function renderBoilStage(stepData) {
  const stage = $('#boilStage');
  const pot = $('#potImg');
  const fire = $('#boilFireImg');
  const contents = $('#boilContents');
  if (!stage || !pot) return;

  hideRoastStage();
  stage.hidden = false;
  stage.classList.remove('is-bubbling', 'boil-hot', 'boil-med');
  stage.classList.add('boil-low');
  $('.counter-scene')?.classList.add('is-boiling');

  boilProgress = 0;
  boilElapsed = 0;
  boilLevel = 0;

  // boilAsset이 있으면 해당 이미지 사용, 없으면 기본 냄비_물 사용
  if (stepData?.boilAsset) {
    pot.src = assetUrl(`./src/assets/끓이기/${stepData.boilAsset}`);
    pot.alt = stepData.boilAsset;
  } else {
    pot.src = assetUrl('./src/assets/도구/냄비_물.png');
    pot.alt = '물 든 냄비';
  }

  if (fire) {
    fire.src = fireSrcFor('low', ASSET_VER);
    fire.dataset.band = 'low';
    fire.alt = '약불';
  }

  const ids = (stepData?.ingredients || []).filter(Boolean);
  const layout = [
    { x: -14, y: -6, rot: -12 },
    { x: 12, y: 4, rot: 10 },
    { x: -2, y: 12, rot: 3 },
    { x: 16, y: -8, rot: -6 },
    { x: -18, y: 8, rot: 14 },
    { x: 6, y: -2, rot: -4 },
  ];
  if (contents) {
    const bits = [];
    let bitI = 0;
    for (const ingredientId of ids) {
      const wholeFile = ingredientAsset(ingredientId);
      const faceFile = wholeFile ? crossSectionFrom(wholeFile) : null;
      const file = faceFile || wholeFile;
      if (!file) continue;
      const n = Math.min(2, Math.max(1, getIngredientCuts(state, ingredientId, 2)));
      for (let i = 0; i < n; i++) {
        const L = layout[bitI % layout.length];
        bits.push(`<img class="boil-bit" src="${assetUrl(`./src/assets/재료/${file}`)}" alt="" draggable="false"
          style="--x:${L.x}%;--y:${L.y}%;--rot:${L.rot}deg;--i:${bitI};height:26%;max-width:26%;opacity:.9" />`);
        bitI += 1;
      }
    }
    contents.innerHTML = bits.join('');
  }

  boilArmed = true;
  boilFireLock = null;
  const testBtns = $('#fireTestBtns');
  if (testBtns) testBtns.hidden = false;
  syncFireTestButtons('low');
  syncBoilFx();
  if (!animationId) {
    lastFrameTs = 0;
    animationId = requestAnimationFrame(tickLiveMic);
  }

  $('#stationIcon').hidden = true;
  $('#micStatus').textContent = '마이크 켜고 「보글보글」 · 물이 끓어요';
  $('#stepHint').textContent = `목표 소리 “${stepData.targetPattern}” · ${stepData.hint || '보글보글 하면 기포가 세져요'}`;
}

/** 섞기: 보울 + 섞기 이미지 + 가이드 대본 */
function renderMixingStage(stepData) {
  const stage = $('#mixingStage');
  const counterScene = $('.counter-scene');
  if (!stage || !counterScene) return;

  hideRoastStage();
  hideBoilStage();
  hideOvenStage();
  stage.hidden = false;
  counterScene.classList.add('is-mixing');

  // 배경 설정
  const kitchenBg = $('#kitchenBg');
  if (kitchenBg) {
    kitchenBg.src = assetUrl('./src/assets/배경/주방_배경.png');
    kitchenBg.alt = '주방 배경';
  }

  // 가이드 스크립트 설정 (기본값: 동구리오 타돗테모 츠키마센)
  const guideScript = stepData?.scriptText || stepData?.guideScript || DEFAULT_SCRIPT;
  const guideLine = `"${guideScript}"을 정확히 따라하세요.`;

  // 섞기 세션 초기화
  startMixing(mixingSession, guideScript);

  // 보울 이미지 (여러 경로 시도)
  const bowl = $('#mixingBowlImg');
  if (bowl) {
    const tryPaths = [
      './src/assets/조리도구/보울.png',
      './src/assets/도구/보울.png',
    ];
    let attempt = 0;
    const tryNext = () => {
      if (attempt >= tryPaths.length) {
        console.warn('보울 이미지 로딩 실패:', tryPaths);
        return;
      }
      const path = tryPaths[attempt++];
      bowl.onerror = tryNext;
      bowl.src = assetUrl(path);
    };
    tryNext();
    bowl.alt = '보울';
  }

  // 섞기 이미지 (data.js의 mixing 재료 파일)
  const mixingId = stepData.mixingAsset || primaryIngredient(stepData);
  const mixingImg = $('#mixingContentImg');
  if (mixingImg && mixingId) {
    mixingImg.hidden = false;
    const fileName = mixingId.includes('.') ? mixingId : `${mixingId}.png`;
    const tryPaths = [
      `./src/assets/섞기/${fileName}`,
      `./src/assets/도구/${fileName}`,
    ];
    let attempt = 0;
    const tryNext = () => {
      if (attempt >= tryPaths.length) {
        console.warn('섞기 이미지 로딩 실패:', mixingId, tryPaths);
        mixingImg.hidden = true;
        return;
      }
      const path = tryPaths[attempt++];
      mixingImg.onerror = tryNext;
      mixingImg.src = assetUrl(path);
    };
    tryNext();
    mixingImg.alt = mixingId;
  }

  // 가이드 텍스트 표시
  renderMixingGuideMatch(guideScript);

  // 점수 표시
  const scoreDisplay = $('#mixingScore');
  if (scoreDisplay) {
    scoreDisplay.textContent = '50%';
  }

  mixingArmed = true;
  if (!animationId) {
    lastFrameTs = 0;
    animationId = requestAnimationFrame(tickLiveMic);
  }

  $('#micStatus').textContent = guideLine;
  $('#stepHint').textContent = guideLine;
  $('#stepHint').textContent = `목표 소리 "${stepData.targetPattern}" · ${stepData.hint || '대본을 잘 따라 읽으세요'}`;
}

/** 굽기: 프라이팬 + 이전 썰기 횟수만큼 단면 + 불/리듬 게이지 */
function renderRoastStage(stepData) {
  const stage = $('#roastStage');
  const pan = $('#panImg');
  const slices = $('#roastSlices');
  const fire = $('#fireImg');
  const rhythm = $('#heatRhythm');
  const gauge = $('#heatGauge');
  if (!stage || !pan || !slices) return;

  hideBoilStage();
  const ingredientId = primaryIngredient(stepData);
  const n = getIngredientCuts(state, ingredientId, 3);

  stage.hidden = false;
  if (rhythm) rhythm.hidden = false;
  if (gauge) gauge.hidden = true;
  $('.counter-scene')?.classList.add('is-roasting');
  pan.src = assetUrl('./src/assets/도구/프라이팬.png');
  pan.alt = '프라이팬';

  resetRoastHeat(roastHeat);
  lastFireBand = '';
  lastToastLevel = 0;
  applyFireSprite('mid', true);
  syncHeatUi();
  roastArmed = true;
  const testBtns = $('#fireTestBtns');
  if (testBtns) testBtns.hidden = false;
  if (!animationId) {
    lastFrameTs = 0;
    animationId = requestAnimationFrame(tickLiveMic);
  }

  const sliceSrc = roastSliceSrc(ingredientId, roastHeat);
  if (sliceSrc && (ingredientId === 'baguette' || ingredientAsset(ingredientId))) {
    if (ingredientId === 'baguette' || crossSectionFrom(ingredientAsset(ingredientId))) {
      slices.innerHTML = Array.from({ length: n }, (_, i) => {
        const t = n <= 1 ? 0.5 : i / (n - 1);
        const angle = -28 + t * 56;
        const x = (t - 0.5) * 42;
        const y = Math.abs(t - 0.5) * 10;
        return `<img class="roast-slice" src="${sliceSrc}" alt="" draggable="false"
          data-toast="${ingredientId === 'baguette' ? 0 : ''}"
          style="--x:${x}%;--y:${y}%;--rot:${angle}deg;--i:${i}" />`;
      }).join('');
      lastToastLevel = ingredientId === 'baguette' ? 0 : -1;
    } else {
      slices.innerHTML = `<img class="roast-whole" src="${sliceSrc}" alt="" draggable="false" />`;
    }
  } else {
    slices.innerHTML = '';
  }

  $('#stationIcon').hidden = true;
  $('#micStatus').textContent = ingredientId === 'baguette'
    ? `마이크 켜고 「후우~」 · 단면→굽1→2→3 · ${n}조각`
    : `마이크 켜고 「후우~」 · 점선=목표 화력 · ${n}조각`;
  $('#stepHint').textContent = ingredientId === 'baguette'
    ? '목표 화력에 맞추면 단면이 점점 구워집니다 · 굽3이 완성'
    : '위 점선 구간에 불길을 맞추세요 · 중→약→강으로 목표가 바뀝니다';
}

async function runCannedCut() {
  const knife = $('#knifeHand');
  const board = $('#cutBoard');
  await playCannedCut(cutSession, {
    knifeEl: knife,
    boardEl: board,
    onProgress: (session) => {
      if (!multiplayer.connected || !multiplayer.isMyTurn) return;
      multiplayer.sendActivity({
        knifeX: session.knifeX,
        actualCuts: session.actualCuts,
        cutDone: session.cutDone,
      });
    },
  });
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
  if (name === 'kitchen-map') renderKitchenMap();
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === name));
  window.scrollTo(0, 0);
  if (name === 'game') scheduleFitGameStage();
}

const MAP_STATION_POS = {
  boil: { x: '35%', y: '55%' },
  grill: { x: '52%', y: '55%' },
  cut: { x: '48%', y: '70%' },
  mix: { x: '70%', y: '60%' },
  finish: { x: '48%', y: '87%' },
};

function mapStationIdForStep(step) {
  if (!step) return null;
  switch (step.action) {
    case 'cutting': return 'cut';
    case 'boiling': return 'boil';
    case 'roasting':
    case 'oven': return 'grill';
    case 'mixing': return 'mix';
    case 'putting':
    case 'sprinkling': return 'finish';
    default: return 'cut';
  }
}

function openKitchenMap() {
  inStation = false;
  peakArmed = false;
  roastArmed = false;
  finishArmed = false;
  boilArmed = false;
  ovenArmed = false;
  mixingArmed = false;
  try { stopLiveMic(); } catch (_) {}
  try { stopOvenSpeech(); } catch (_) {}
  try { hideOvenStage(); } catch (_) {}
  try { hideMixingStage(); } catch (_) {}
  try { hideRoastStage(); } catch (_) {}
  try { hideBoilStage(); } catch (_) {}
  try { hideFinishStage(); } catch (_) {}
  showScreen('kitchen-map');
}

function enterCurrentStation() {
  const current = getCurrent(state);
  if (!current || state.finished) return;
  inStation = true;
  renderGame();
  showScreen('game');
}

function renderKitchenMap() {
  const steps = getSteps(state);
  const current = getCurrent(state);
  const nextId = mapStationIdForStep(current);
  const doneIds = new Set(
    steps.slice(0, state.currentStep).map(mapStationIdForStep).filter(Boolean),
  );

  const dayEl = $('#mapDayLabel');
  const stepEl = $('#mapStepLabel');
  const mission = $('#mapMission');
  if (dayEl) dayEl.textContent = `DAY ${state.day}`;
  if (stepEl) stepEl.textContent = `${state.currentStep + 1} / ${steps.length}`;
  if (mission) {
    if (!current) {
      mission.textContent = '오늘 영업이 끝났어요';
    } else {
      const stationName = ACTION_LABEL[current.action] || stationLabel(current);
      mission.textContent = `${getPlayer(state)}의 차례 · ${current.course.name} — ${current.title} (${stationName}) 스테이션을 누르세요`;
    }
  }

  document.querySelectorAll('.map-station').forEach((btn) => {
    const id = btn.dataset.station;
    const isNext = id === nextId;
    const isDone = doneIds.has(id) && !isNext;
    btn.classList.toggle('is-next', isNext);
    btn.classList.toggle('is-done', isDone);
    btn.classList.toggle('is-locked', !isNext);
    btn.disabled = !isNext || (multiplayer.connected && !multiplayer.isMyTurn);
    btn.setAttribute('aria-current', isNext ? 'step' : 'false');
  });

  const chef = $('#mapChef');
  const pos = MAP_STATION_POS[nextId] || { x: '48%', y: '48%' };
  if (chef) {
    chef.style.setProperty('--x', pos.x);
    chef.style.setProperty('--y', pos.y);
  }
}

function renderPlayers() {
  $('#playerSetup').innerHTML = state.players.map((player, index) => `<article class="player-card" data-player-index="${index}" data-player-id="${setupPlayerIds[index] || `p${index + 1}`}" aria-grabbed="false"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="order-number">${index + 1}</span><div class="chef-avatar">${['👩‍🍳', '🧑‍🍳', '👨‍🍳'][index]}</div><label>PLAYER ${index + 1}<input data-player="${index}" value="${player}" maxlength="12" aria-label="${index + 1}번 플레이어 이름" ${multiplayer.connected ? 'readonly' : ''}></label></article>`).join('');
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

function clearPlayerDragVisuals() {
  document.querySelectorAll('.player-drag-ghost').forEach((ghost) => ghost.remove());
  $('#playerSetup').querySelectorAll('.player-card.dragging').forEach((card) => {
    card.classList.remove('dragging');
    card.setAttribute('aria-grabbed', 'false');
  });
  document.body.classList.remove('is-dragging-player');
}

function finishPlayerDrag() {
  if (!draggedPlayerCard) {
    clearPlayerDragVisuals();
    return;
  }
  const pointerId = playerDragPointerId;
  const cards = [...$('#playerSetup').querySelectorAll('.player-card')];
  const reorderedPlayers = cards.map(card => state.players[Number(card.dataset.playerIndex)]);
  const reorderedIds = cards.map(card => card.dataset.playerId);
  state.players.splice(0, state.players.length, ...reorderedPlayers);
  setupPlayerIds.splice(0, setupPlayerIds.length, ...reorderedIds);
  if (multiplayer.connected && setupPlayerIds.length === 3) {
    multiplayer.setOrder([...setupPlayerIds], {
      day: state.day, money: state.money, grade: state.grade, guest: state.guest,
      menu: state.menu,
    });
    $('#multiStatus').textContent = '변경한 릴레이 순서를 모두에게 반영했습니다. 다시 준비해 주세요.';
  }
  draggedPlayerCard = null;
  playerDragGhost = null;
  playerDragPointerId = null;
  const setup = $('#playerSetup');
  if (pointerId != null && setup.hasPointerCapture?.(pointerId)) {
    setup.releasePointerCapture(pointerId);
  }
  clearPlayerDragVisuals();
  renderPlayers();
}

$('#playerSetup').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('input, button')) return;
  const card = event.target.closest('.player-card');
  if (!card) return;
  if (draggedPlayerCard || document.querySelector('.player-drag-ghost')) finishPlayerDrag();
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
  $('#playerSetup').setPointerCapture(event.pointerId);
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
$('#playerSetup').addEventListener('lostpointercapture', event => {
  if (event.pointerId === playerDragPointerId) finishPlayerDrag();
});
window.addEventListener('pointerup', event => {
  if (event.pointerId === playerDragPointerId) finishPlayerDrag();
});
window.addEventListener('pointercancel', event => {
  if (event.pointerId === playerDragPointerId) finishPlayerDrag();
});
window.addEventListener('blur', () => {
  if (draggedPlayerCard || document.querySelector('.player-drag-ghost')) finishPlayerDrag();
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

  if (lastTimelineScrollStep !== state.currentStep) {
    lastTimelineScrollStep = state.currentStep;
    requestAnimationFrame(() => {
      const drawer = $('#progressDrawer');
      const activeItem = drawer?.querySelector('.timeline-item.active');
      if (!drawer || !activeItem) return;
      const targetTop = activeItem.offsetTop - (drawer.clientHeight - activeItem.offsetHeight) / 2;
      drawer.scrollTo({
        top: Math.max(0, targetTop),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }

  if (state.finished) {
    renderResult();
    showScreen('result');
    return;
  }

  const current = getCurrent(state);
  $('#stationLabel').textContent = `${current.course.name} / ${stationLabel(current)}`;
  $('#playerLabel').textContent = `${getPlayer(state)}의 차례`;
  $('#stepTitle').textContent = current.title;
  $('#stepCount').textContent = `${state.currentStep + 1} / ${steps.length}`;
  applyTurnPermissions();
  if (!isMixingStep(current)) hideMixingStage();
  const counterScene = $('.counter-scene');
  const gameStage = $('#gameStage');
  counterScene.classList.add('has-kitchen-background');
  counterScene.classList.toggle('is-cutting', isCuttingStep(current));
  counterScene.classList.toggle('is-roasting', isRoastingStep(current));
  counterScene.classList.toggle('is-finishing', isFinishStep(current));
  counterScene.classList.toggle('is-boiling', isBoilingStep(current));
  counterScene.classList.toggle('is-oven', isOvenStep(current));
  counterScene.classList.toggle('is-mixing', isMixingStep(current));
  gameStage?.classList.toggle('is-cutting', isCuttingStep(current));
  gameStage?.classList.toggle('is-roasting', isRoastingStep(current));
  gameStage?.classList.toggle('is-boiling', isBoilingStep(current));
  gameStage?.classList.toggle('is-oven', isOvenStep(current));
  gameStage?.classList.toggle('is-mixing', isMixingStep(current));

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
    hideFinishStage();
    hideRoastStage();
    hideBoilStage();
    hideMixingStage();
    cutIngredient.hidden = true;
    $('#stationIcon').hidden = true;
    const passHand = $('#passHand');
    if (passHand) {
      passHand.hidden = true;
      passHand.classList.remove('is-on-board', 'is-pushing');
    }
    const cutStack = $('#cutStack');
    const boardImg = $('#cuttingBoardImg');
    if (cutStack) {
      cutStack.hidden = false;
      cutStack.classList.remove('is-passing-out', 'is-entering');
    }
    if (boardImg) {
      boardImg.src = assetUrl('./src/assets/도구/도마.png');
      boardImg.hidden = false;
    }
    knife.src = assetUrl('./src/assets/도구/오른손_칼.png');
    const cutN = cutCountForIngredient(ingredientFile);
    const beginnerMode = state.day <= 2;
    resetCutSession(cutSession, {
      ingredientFile,
      crossSectionFile: crossSectionFrom(ingredientFile),
      assetVer: ASSET_VER,
      cutCount: cutN,
      targetPattern: current.targetPattern,
      beginnerMode,
    });
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    cutBoard.classList.remove('is-passing-out', 'is-entering');
    renderCutBoard(cutBoard, cutSession);
    const startX = knifeStartX(cutSession);
    attachKnifeToTomato(cutBoard, knife, startX);
    cutSession.knifeX = startX;
    syncKnifeEl(knife, cutSession);
    counterScene.classList.add('is-zoomed');
    peakArmed = true;
    const chartKo = (cutSession.requiredLabels || []).map((l) => CUT_LABEL_KO[l] || l).join(' · ');
    $('#micStatus').textContent = `마이크 켜기 → 점선 리듬 ${chartKo}`;
    $('#stepHint').textContent = beginnerMode
      ? `초보 리듬 ${chartKo} · 2~3종 발음 (${cutN}컷)`
      : `리듬 ${chartKo} · 가이드+발음 (슥=길게) (${cutN}컷)`;
  } else if (isRoastingStep(current)) {
    hideFinishStage();
    peakArmed = false;
    hideBoilStage();
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    const cutStack = $('#cutStack');
    if (cutStack) {
      cutStack.hidden = true;
      cutStack.classList.remove('is-passing-out', 'is-entering');
    }
    cutBoard.innerHTML = '';
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
    cutIngredient.hidden = true;
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    renderRoastStage(current);
  } else if (isOvenStep(current)) {
    peakArmed = false;
    hideBoilStage();
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    const cutStack = $('#cutStack');
    if (cutStack) {
      cutStack.hidden = true;
      cutStack.classList.remove('is-passing-out', 'is-entering');
    }
    cutBoard.innerHTML = '';
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
    cutIngredient.hidden = true;
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    renderOvenStage(current);
    $('#stepHint').textContent = `${current.hint || '오븐을 끄는 타이밍을 맞추세요.'}`;
  } else if (isBoilingStep(current)) {
    peakArmed = false;
    hideRoastStage();
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    const cutStack = $('#cutStack');
    if (cutStack) {
      cutStack.hidden = true;
      cutStack.classList.remove('is-passing-out', 'is-entering');
    }
    cutBoard.innerHTML = '';
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
    cutIngredient.hidden = true;
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    renderBoilStage(current);
  } else if (isFinishStep(current)) {
    peakArmed = false;
    hideRoastStage();
    hideBoilStage();
    hideMixingStage();
    hideOvenStage();
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    const cutStack = $('#cutStack');
    if (cutStack) {
      cutStack.hidden = true;
      cutStack.classList.remove('is-passing-out', 'is-entering');
    }
    cutBoard.innerHTML = '';
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
    cutIngredient.hidden = true;
    $('#stationIcon').hidden = true;
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    renderFinishStage(current);
  } else if (isMixingStep(current)) {
    peakArmed = false;
    hideRoastStage();
    hideBoilStage();
    hideMixingStage();
    hideOvenStage();
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    const cutStack = $('#cutStack');
    if (cutStack) {
      cutStack.hidden = true;
      cutStack.classList.remove('is-passing-out', 'is-entering');
    }
    cutBoard.innerHTML = '';
    knife.hidden = true;
    knife.classList.remove('knife-hand--on-tomato', 'chopping');
    cutIngredient.hidden = true;
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    renderMixingStage(current);
  } else {
    peakArmed = false;
    hideRoastStage();
    hideBoilStage();
    hideMixingStage();
    hideOvenStage();
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    const cutStack = $('#cutStack');
    if (cutStack) {
      cutStack.hidden = true;
      cutStack.classList.remove('is-passing-out', 'is-entering');
    }
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

  if (!isRoastingStep(current) && !isBoilingStep(current)) {
    $('#stationIcon').textContent = TYPE_ICON[current.type];
  }
  scheduleFitGameStage();
}

function applySharedSnapshot(snapshot) {
  const game = snapshot.game;
  const previousStepIndex = state.currentStep;
  const isFirstSharedSnapshot = !sharedGameInitialized;
  const previousStep = getSteps(state)[previousStepIndex];
  const shared = game.sharedState || {};
  if (shared.day != null) state.day = shared.day;
  if (shared.money != null) state.money = shared.money;
  if (shared.grade) state.grade = shared.grade;
  if (shared.guest) state.guest = shared.guest;
  if (shared.menu?.courses) state.menu = shared.menu;
  const playersById = new Map(snapshot.players.map((p) => [p.id, p.name]));
  setupPlayerIds = [...game.order];
  state.players = game.order.map((id) => playersById.get(id));
  state.currentStep = game.currentStep;
  state.results = game.results.map((accuracy, index) => ({ ...getSteps(state)[index], accuracy }));
  state.ingredientCuts = { ...game.ingredientCuts };
  state.finished = state.currentStep >= getSteps(state).length;
  sharedGameInitialized = true;
  const stepChanged = state.currentStep !== previousStepIndex;
  const completedCourse = state.currentStep === previousStepIndex + 1
    ? completedCourseAt(getSteps(state), previousStepIndex)
    : null;
  if (stepChanged) boardHandoffToken += 1;
  if (state.finished) {
    inStation = false;
    renderResult();
    showScreen('result');
  } else if (game.stationOpen) {
    inStation = true;
    renderGame();
    showScreen('game');
  } else if (isFirstSharedSnapshot || stepChanged) {
    // 멀티에서도 게임 시작과 다음 단계 전환은 탑다운 맵에서 시작한다.
    openKitchenMap();
  } else if (inStation) {
    // 같은 단계의 재동기화는 현재 보고 있는 조리/관전 화면을 유지한다.
    renderGame();
    showScreen('game');
  } else {
    renderKitchenMap();
    showScreen('kitchen-map');
  }
  if (completedCourse) {
    courseCompleteView.show(completedCourse, {
      isLast: state.finished,
      nextCourse: getCurrent(state)?.course,
      onContinue: state.finished
        ? null
        : () => openKitchenMap(),
    });
  }
  const currentStep = getCurrent(state);
  if (state.currentStep === previousStepIndex + 1
    && isCuttingStep(previousStep)
    && isCuttingStep(currentStep)
    && inStation) {
    void playBoardEnter();
  }
}

function applyTurnPermissions() {
  const myTurn = multiplayer.isMyTurn;
  const actions = $('.actions');
  actions?.classList.toggle('is-spectating', !myTurn);
  ['#micBtn', '#successBtn', '#missBtn'].forEach((selector) => { $(selector).disabled = !myTurn; });
  if (!myTurn) {
    stopLiveMic();
    $('#micStatus').textContent = `${getPlayer(state)}의 조리를 관전 중입니다. 화면은 실시간으로 동기화됩니다.`;
  }
}

function commitStep(accuracy) {
  stopLiveMic();
  if (multiplayer.connected) {
    if (!multiplayer.isMyTurn) return;
    multiplayer.submitStep(accuracy, state.ingredientCuts);
    return;
  }
  const completedStepIndex = state.currentStep;
  const completedCourse = completedCourseAt(getSteps(state), completedStepIndex);
  submitStep(state, accuracy);
  if (state.finished) {
    inStation = false;
    renderResult();
    showScreen('result');
    return;
  }
  openKitchenMap();
  if (completedCourse) {
    courseCompleteView.show(completedCourse, {
      isLast: false,
      nextCourse: getCurrent(state)?.course,
      onContinue: () => openKitchenMap(),
    });
  }
}

let resultRenderToken = 0;
async function renderResult() {
  const token = ++resultRenderToken;
  const result = calculateResult(state);
  const panel = $('#reviewPanel');
  const nextButton = $('#nextDayBtn');
  nextButton.disabled = true;
  nextButton.textContent = '손님 심사 중…';
  renderReceiptLoading(panel, result);
  const reviews = await requestGuestReviews(result);
  if (token !== resultRenderToken || !state.finished) return;
  renderReceipt(panel, result, reviews);
  nextButton.disabled = false;
  nextButton.textContent = '정산하고 다음 날 →';
}

document.addEventListener('click', (event) => {
  const go = event.target.closest('[data-go]');
  if (go) {
    event.preventDefault();
    showScreen(go.dataset.go);
  }
  const stationBtn = event.target.closest('.map-station.is-next');
  if (stationBtn) {
    event.preventDefault();
    if (multiplayer.connected) {
      if (multiplayer.isMyTurn) multiplayer.enterStation();
    } else {
      enterCurrentStation();
    }
  }
});

on($('#backToMapBtn'), 'click', () => {
  openKitchenMap();
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
on($('#connectMultiBtn'), 'click', async () => {
  const button = $('#connectMultiBtn');
  button.disabled = true;
  $('#multiStatus').textContent = '멀티 방에 연결하는 중…';
  try {
    await multiplayer.connect({
      url: $('#multiplayerServerUrl').value,
      room: $('#roomCode').value,
      name: $('#myPlayerName').value.trim() || '셰프',
    });
    button.textContent = '연결됨';
  } catch (error) {
    button.disabled = false;
    $('#multiStatus').textContent = `${error.message} · 오프라인 플레이는 계속할 수 있습니다.`;
  }
});
on($('#confirmTeamBtn'), 'click', () => {
  try {
    if (multiplayer.connected) {
      if (setupPlayerIds.length !== 3) {
        $('#multiStatus').textContent = '3명이 모두 들어와야 순서를 제출할 수 있습니다.';
        return;
      }
      multiplayer.setReady(true, {
        day: state.day, money: state.money, grade: state.grade, guest: state.guest,
        menu: state.menu,
      });
      $('#multiStatus').textContent = '준비 완료! 다른 셰프를 기다리는 중…';
      return;
    }
    openKitchenMap();
  } catch (err) {
    console.error('게임 시작 실패:', err);
    alert(`게임 시작 오류: ${err.message}`);
  }
});
on($('#successBtn'), 'click', async () => {
  // Ensure any live listeners and oven-specific state are cleaned up
  try { stopOvenSpeech(); } catch (_) {}
  hideOvenStage();
  hideMixingStage();
  stopLiveMic();
  if (isCuttingStep(getCurrent(state)) && !cutSession.finished && !cutSession.animating) {
    await runCannedCut();
    return;
  }
  if (isFinishStep(getCurrent(state))) await playFinishTestEffect(80);
  commitStep(80);
});
on($('#missBtn'), 'click', async () => {
  try { stopOvenSpeech(); } catch (_) {}
  hideOvenStage();
  hideMixingStage();
  stopLiveMic();
  if (isFinishStep(getCurrent(state))) await playFinishTestEffect(20);
  commitStep(20);
});
on($('#fireTestBtns'), 'click', (event) => {
  const btn = event.target.closest('[data-fire-test]');
  if (!btn || (!roastArmed && !boilArmed)) return;
  forceFireBand(btn.dataset.fireTest);
});
on($('#nextDayBtn'), 'click', () => {
  startNextDay(state);
  if (multiplayer.connected) multiplayer.nextDay({
    day: state.day, money: state.money, grade: state.grade, guest: state.guest,
    menu: state.menu,
  });
  showScreen('restaurant');
});


function handleTmLabel({ label, score }) {
  const pct = Math.round(score * 100);
  const now = performance.now();
  const current = getCurrent(state);

  if (label === 'Tak' || label === 'Chap' || label === 'Ssuk' || label === 'Ssak') {
    if (peakArmed && isCuttingStep(current) && cutSession && cutSession.listening && !cutSession.finished) {
      if (performance.now() < cutVoiceArmedAt) return false;
      // 침묵 오발동만 아주 약하게 차단 (볼륨 게이트가 진짜 말도 막던 문제 완화)
      if (lastMicVolume < 5) {
        console.log('[TM] skip quiet/fake hit', label, pct + '%', 'vol', lastMicVolume);
        return false;
      }
      applyTakHit('VOICE ' + label + ' ' + pct + '%', { label: label });
      return true;
    }
    if (boilArmed && isBoilingStep(current)) {
      tmChapUntil = now + 700;
      tmBoostUntil = now + 700;
      var el1 = document.querySelector('#micStatus');
      if (el1) el1.textContent = 'VOICE ' + label + ' ' + pct + '% boil';
      return true;
    }
    if (mixingArmed && isMixingStep(current)) {
      tmBoostUntil = now + 600;
      var el2 = document.querySelector('#micStatus');
      if (el2) el2.textContent = 'VOICE ' + label + ' ' + pct + '% mix';
      return true;
    }
    return false;
  }

  if (label === 'Huu') {
    tmHuuUntil = now + 900;
    tmBoostUntil = now + 900;
    var el3 = document.querySelector('#micStatus');
    if (el3) {
      if (roastArmed && isRoastingStep(current)) el3.textContent = 'VOICE Huu ' + pct + '% blow';
      else if (boilArmed && isBoilingStep(current)) el3.textContent = 'VOICE Huu ' + pct + '% fire';
      else el3.textContent = 'VOICE Huu ' + pct + '%';
    }
    return true;
  }

  if (label === 'Ting') {
    var el4 = document.querySelector('#micStatus');
    if (el4) el4.textContent = 'VOICE Ting ' + pct + '%';
    return true;
  }
  return false;
}

function handleTmDebug({ text, note }) {
  if (!micOn || !peakArmed) return;
  // HIT 직후 판정 문구는 유지, 그 외엔 실시간 점수 표시
  if (performance.now() < cutDebugMuteUntil && !note) return;
  if (performance.now() < cutVoiceArmedAt) {
    $('#micStatus').textContent = `준비… ${text}`;
    return;
  }
  const need = nextRequiredLabel(cutSession);
  const ko = need ? (CUT_LABEL_KO[need] || need) : '탁';
  $('#micStatus').textContent = note
    ? `${note} · ${text}`
    : `말해요 「${ko}」 · ${text}`;
}

async function startTmMicAssist() {
  try {
    await startTmListen(handleTmLabel, {
      probabilityThreshold: 0.32,
      overlapFactor: 0.92,
      preferCutLabel: () => (peakArmed && cutSession ? nextRequiredLabel(cutSession) : null),
      onDebug: handleTmDebug,
    });
    tmMicActive = true;
    return true;
  } catch (err) {
    tmMicActive = false;
    console.warn('TM audio listen failed:', err);
    return false;
  }
}

function applyTakHit(sourceLabel, { label = 'Tak' } = {}) {
  if (cutSession.autoFinishPending || cutSession.finished || cutSession.animating) return;
  const now = performance.now();
  if (now < cutVoiceArmedAt) return;
  if (now < cutHitGateUntil) return;
  if (now < (cutSession.cutLockedUntil || 0)) return;
  cutHitGateUntil = now + 220;

  const result = tryChopOnTak(cutSession, {
    knifeEl: $('#knifeHand'),
    boardEl: $('#cutBoard'),
    label,
  });

  if (result === 'complete' || JUDGE_KO[result]) {
    lastSpeechTakAt = now;
    cutHitGateUntil = now + 220;
    cutDebugMuteUntil = now + 700;
  } else {
    cutHitGateUntil = now + 40;
  }

  const n = cutSession.actualCuts.length;
  const total = cutSession.marks.length;
  const need = nextRequiredLabel(cutSession);
  const needKo = need ? (CUT_LABEL_KO[need] || need) : '';
  const judge = JUDGE_KO[result];
  if (result === 'complete') {
    $('#micStatus').textContent = `${sourceLabel} · 완료!`;
    setTimeout(() => finishVoiceCut(), 450);
  } else if (judge) {
    $('#micStatus').textContent = needKo
      ? `${judge} · ${n}/${total} · 다음 「${needKo}」 · ${sourceLabel}`
      : `${judge} · ${n}/${total} · ${sourceLabel}`;
  } else if (result === 'miss-advance') {
    $('#micStatus').textContent = `${sourceLabel} · 칼이 조금 더 온 뒤!`;
  } else if (result === 'locked') {
    $('#micStatus').textContent = `${sourceLabel} · 잠시 후`;
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
    if (tmMicActive) return;
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

    if (nextRequiredLabel(cutSession) === 'Tak') applyTakHit('STT Tak', { label: 'Tak' });
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
  tmMicActive = false;
  cutHitGateUntil = 0;
  cutVoiceArmedAt = 0;
  lastFrameTs = 0;
  tmBoostUntil = 0;
  tmHuuUntil = 0;
  tmChapUntil = 0;
  stopTakSpeech();
  stopMixingSpeech();
  void stopTmListen();
  setListening(cutSession, false);
  liveStream?.getTracks().forEach((t) => t.stop());
  liveStream = null;
  if (audioContext && audioContext.state !== 'closed') audioContext.close();
  audioContext = null;
  analyser = null;
  $('#voiceBar').style.width = '0%';
  $('#micBtn').textContent = '마이크 켜기';
  $('#micBtn').disabled = false;
  // 굽기/끓이기/오븐 중이면 게이지·진행 루프는 유지
  // Only cancel the main animation loop when no staged processes are active
  // and the ovenStage is not visible. This ensures the oven countdown can run
  // during the startup delay even if the mic is off.
  const ovenStageEl = $('#ovenStage');
  const ovenVisible = ovenStageEl && !ovenStageEl.hidden;
  if (!roastArmed && !boilArmed && !finishArmed && !ovenArmed && !mixingArmed && !ovenVisible && animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

function volumePercentFromAnalyser(freq) {
  if (!freq?.length) return 0;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < freq.length; i++) {
    sum += freq[i];
    if (freq[i] > peak) peak = freq[i];
  }
  const avg = (sum / freq.length / 128) * 100;
  const pk = (peak / 255) * 100;
  return Math.min(100, Math.floor(Math.max(avg, pk * 0.9)));
}

function tickLiveMic(ts) {
  const ovenStageEl = $('#ovenStage');
  const ovenStageVisible = ovenStageEl && !ovenStageEl.hidden;
  if (!micOn && !roastArmed && !boilArmed && !finishArmed && !ovenArmed && !mixingArmed && !ovenStageVisible) return;

  const dt = lastFrameTs ? Math.min(0.05, (ts - lastFrameTs) / 1000) : 0.016;
  lastFrameTs = ts;

  const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  const wave = analyser ? new Uint8Array(analyser.fftSize) : null;
  let volumePercent = 0;
  if (analyser && freq && wave) {
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    volumePercent = volumePercentFromAnalyser(freq);
    lastMicVolume = volumePercent;
    $('#voiceBar').style.width = `${volumePercent}%`;
  } else {
    lastMicVolume = 0;
  }

  const knife = $('#knifeHand');
  const board = $('#cutBoard');
  const current = getCurrent(state);
  if (!isMixingStep(current)) hideMixingStage();

  if (multiplayer.connected && multiplayer.isMyTurn && ts - lastActivitySentAt >= 100) {
    lastActivitySentAt = ts;
    multiplayer.sendActivity({
      volume: volumePercent,
      knifeX: isCuttingStep(current) ? cutSession.knifeX : null,
      actualCuts: isCuttingStep(current) ? cutSession.actualCuts : null,
      cutDone: isCuttingStep(current) ? cutSession.cutDone : null,
      heat: isRoastingStep(current) ? roastHeat.heat : null,
      band: isRoastingStep(current) ? roastHeat.band : null,
      boilProgress: isBoilingStep(current) ? boilProgress : null,
      boilLevel: isBoilingStep(current) ? boilLevel : null,
      finish: isFinishStep(current) ? {
        targetIndex: finishSession.targetIndex,
        targetHz: finishSession.targetHz,
        hold: finishSession.hold,
        pitchHz: finishSession.pitchHz,
        cents: finishSession.cents,
        isPouring: finishSession.isPouring,
        phaseElapsed: finishSession.phaseElapsed,
        reachedAt: finishSession.reachedAt,
        phaseScores: finishSession.phaseScores,
        complete: finishSession.complete,
      } : null,
      mixing: isMixingStep(current) ? {
        scriptMatchProgress: mixingSession.scriptMatchProgress,
        recognizedText: mixingSession.recognizedText,
        elapsed: mixingSession.elapsed,
        accuracy: mixingSession.accuracy,
      } : null,
    });
  }

  if (boilArmed && isBoilingStep(current)) {
    boilElapsed += dt;
    const tmBubble = performance.now() < tmChapUntil || performance.now() < tmBoostUntil;
    const bubbling = micOn && (volumePercent >= 14 || tmBubble);
    const stage = $('#boilStage');
    stage?.classList.toggle('is-bubbling', bubbling);
    if (bubbling) boilProgress = Math.min(BOIL_NEED_SEC, boilProgress + dt);
    else boilProgress = Math.max(0, boilProgress - dt * 0.15);
    syncBoilFx();
    const labels = ['약하게', '보글보글', '팔팔'];
    if (micOn) {
      $('#micStatus').textContent = bubbling
        ? `${labels[boilLevel] || '보글'} · ${Math.round((boilProgress / BOIL_NEED_SEC) * 100)}%`
        : `더 「보글보글」 해요 · ${labels[Math.max(0, boilLevel)] || '약하게'}`;
    }
    if (boilProgress >= BOIL_NEED_SEC) {
      const score = boilElapsed <= 13
        ? 100
        : Math.max(20, Math.round(100 - (boilElapsed - 13) * 3));
      hideBoilStage();
      stopLiveMic();
      $('#micStatus').textContent = `수프 완성 · ${score}점`;
      commitStep(score);
      return;
    }
    if (boilElapsed >= BOIL_LIMIT_SEC) {
      const score = 20;
      hideBoilStage();
      stopLiveMic();
      $('#micStatus').textContent = `끓이기 시간 초과 · ${score}점`;
      commitStep(score);
      return;
    }
  }

  if (roastArmed && isRoastingStep(current)) {
    const tmBlow = performance.now() < tmHuuUntil;
    const blowVol = micOn ? Math.max(volumePercent, tmBlow ? 72 : 0) : 0;
    tickRoastHeat(roastHeat, blowVol, dt);
    syncHeatUi();
    const ingId = primaryIngredient(current);
    syncRoastToastVisuals(ingId);
    if (micOn) {
      const inZone = roastHeat.heat >= roastHeat.targetMin && roastHeat.heat <= roastHeat.targetMax;
      const toastBit = ingId === 'baguette' ? ` · ${toastStatusLabel(Math.max(lastToastLevel, roastToastLevel(roastHeat)))}` : '';
      const hint = roastTargetHint(roastHeat);
      const nextBit = roastHeat.nextTargetBand ? ` · ${hint}` : '';
      $('#micStatus').textContent = roastHeat.blowing
        ? `후우~ · ${bandLabel(roastHeat.band)} → 목표 ${bandLabel(roastHeat.targetBand)}${inZone ? ' ✓' : ''}${toastBit}${nextBit}`
        : `입 닫으면 식어요 · 목표 ${bandLabel(roastHeat.targetBand)}${toastBit}${nextBit}`;
    }
    if (roastHeat.done) {
      if (ingId === 'baguette') {
        lastToastLevel = 3;
        roastHeat.peakToastProgress = 1;
        syncRoastToastVisuals(ingId);
      }
      const score = roastAccuracy(roastHeat);
      hideRoastStage();
      stopLiveMic();
      $('#micStatus').textContent = ingId === 'baguette'
        ? `바게트 굽3 완성 · ${score}점`
        : `굽기 완료 · ${score}점`;
      commitStep(score);
      return;
    }
  }

  if (ovenArmed && isOvenStep(current)) {
    ovenElapsed += dt;
    // 깜빡임: 4Hz 토글
    ovenLightOn = Math.floor(ovenElapsed * 4) % 2 === 0;
    syncOvenUi();

    if (micOn && !speechRec) {
      // 시작 시 음성 리스너 켜기
      const ok = startOvenSpeech();
      $('#micStatus').textContent = ok ? '오븐 듣는 중 · 「띵」으로 끄세요' : '음성인식 불가 · 버튼으로 진행';
    } else if (!micOn) {
      $('#micStatus').textContent = `오븐 가동 중 · ${Math.max(0, Math.round(ovenVisualDuration - ovenElapsed))}초 남음`;
    }

    if (ovenStopped) {
      const userAt = ovenUserStopAt != null ? ovenUserStopAt : ovenElapsed;
      const diffToTarget = Math.abs(userAt - (ovenTargetTime || 0));
      const success = diffToTarget <= (ovenAcceptWindow || 0);
      const score = diffToTarget <= 0.25
        ? 100
        : Math.max(20, Math.round(100 - (diffToTarget - 0.25) * 25));
      // cleanup speech listener specifically
      try { stopOvenSpeech(); } catch (_) {}
      hideOvenStage();
      stopLiveMic();
      $('#micStatus').textContent = success ? `오븐 정지 · 성공! · ${score}점` : `오븐 정지 · 실패 · ${score}점`;
      commitStep(score);
      return;
    }

    if (ovenElapsed >= ovenVisualDuration) {
      // 시간이 다 흘렀고 사용자가 못맞춘 경우: 실패
      const diff = Math.abs(ovenElapsed - (ovenTargetTime || 0));
      const score = 20;
      try { stopOvenSpeech(); } catch (_) {}
      hideOvenStage();
      stopLiveMic();
      $('#micStatus').textContent = `시간 초과 · 실패 · ${score}점`;
      commitStep(score);
      return;
    }
  }

  if (finishArmed && isFinishStep(current)) {
    const pitch = micOn && wave
      ? detectPitch(wave, audioContext?.sampleRate || 48000)
      : { frequency: 0, confidence: 0 };
    if (micOn) tickFinish(finishSession, pitch, dt);
    syncFinishUi();
    if (micOn) {
      $('#micStatus').textContent = finishSession.rawPitchHz
        ? `감지 ${Math.round(finishSession.rawPitchHz)}Hz · ${$('#pitchLabel').textContent}`
        : volumePercent >= 2
          ? `마이크 입력 ${volumePercent}% 감지 · 음정을 찾는 중, 「아—」 하고 길게 내보세요.`
          : '마이크 입력 없음 · 권한과 입력 장치를 확인해 주세요.';
    }
    if (finishSession.complete && !finishSubmitted) {
      finishSubmitted = true;
      $('#micStatus').textContent = '완벽한 마무리!';
      setTimeout(() => {
        stopLiveMic();
        hideFinishStage();
        commitStep(finishAccuracy(finishSession));
      }, 650);
    }
  }

  if (micOn && peakArmed && isCuttingStep(current) && !cutSession.finished && !cutSession.animating) {
    advanceKnife(cutSession, dt);
    syncKnifeEl(knife, cutSession);

    if (cutSession.autoFinishPending && !cutSession.finished && !cutSession.animating) {
      cutSession.autoFinishPending = false;
      setListening(cutSession, false);
      stopTakSpeech();
      $('#micStatus').textContent = `${cutSession.actualCuts.length}/${cutSession.marks.length}컷 · 점수 반영 후 다음`;
      setTimeout(() => finishVoiceCut(), 350);
      return;
    }

    tickCutVoiceHold(cutSession, volumePercent, {
      knifeEl: knife,
      boardEl: board,
    });
    const pendingResult = tickPendingChop(cutSession, {
      knifeEl: knife,
      boardEl: board,
    });
    if (pendingResult === 'complete') {
      $('#micStatus').textContent = '컷 완료!';
      setTimeout(() => finishVoiceCut(), 450);
    } else if (JUDGE_KO[pendingResult]) {
      const n = cutSession.actualCuts.length;
      const total = cutSession.marks.length;
      const need = nextRequiredLabel(cutSession);
      const needKo = need ? (CUT_LABEL_KO[need] || need) : '';
      $('#micStatus').textContent = needKo
        ? `${JUDGE_KO[pendingResult]} · ${n}/${total} · 다음 「${needKo}」`
        : `${JUDGE_KO[pendingResult]} · ${n}/${total}`;
    }

    const hot = updateHotGuide(cutSession);
    const guides = board?.querySelectorAll('.cut-guide');
    if (guides?.length) {
      guides.forEach((el, i) => {
        el.classList.toggle('done', cutSession.cutDone[i]);
        el.classList.toggle('hot', i === hot);
      });
    }

    /* 썰기: 음성인식(TM) 주력 — 파열음 OFF (2연타·오인 방지) */
  }

  if (mixingArmed && isMixingStep(current)) {
    const tmMix = performance.now() < tmBoostUntil;
    const blowVol = micOn ? Math.max(volumePercent, tmMix ? 70 : 0) : 45;
    tickMixing(mixingSession, blowVol, dt);

    const mixState = getMixingState(mixingSession);
    const scoreDisplay = $('#mixingScore');
    if (scoreDisplay) {
      scoreDisplay.textContent = `${mixState.score}%`;
    }

    // 보울 모션 업데이트
    const bowl = $('#mixingBowlImg');
    if (bowl) {
      const bowlPos = getBowlPosition(mixingSession, 0, 0, 90);
      const rotation = getBowlRotation(mixingSession);
      bowl.style.opacity = mixState.hasFailedOut ? '0.88' : '1';
      bowl.style.transform = `translate(calc(-50% + ${bowlPos.x}px), calc(-50% + ${bowlPos.y}px)) rotate(${rotation}deg)`;
    }

    // 섞기 이미지 모션 업데이트
    const mixingImg = $('#mixingContentImg');
    if (mixingImg) {
      const offset = getMixingOffset(mixingSession);
      const rotation = getMixingRotation(mixingSession);
      const contentYOffset = -20;
      const bowlPos = getBowlPosition(mixingSession, 0, 0, 90);
      const baseX = bowlPos.x + offset.x;
      const baseY = bowlPos.y + contentYOffset + offset.y;
      mixingImg.style.transform = `translate(calc(-50% + ${baseX}px), calc(-50% + ${baseY}px)) rotate(${rotation}deg)`;
      mixingImg.style.opacity = offset.opacity;
    }

    if (micOn) {
      const verdict = mixingSession.scriptMatchProgress >= 0.85
        ? '성공'
        : mixingSession.scriptMatchProgress <= 0.2 ? '실패' : '부분 성공';
      $('#micStatus').textContent = `섞기 중 · ${verdict} · 문구 점수 ${mixState.score}% · 시간 ${Math.round(mixState.elapsed)}/${Math.round(mixState.totalDuration)}초`;
    }

    if (mixState.done) {
      const score = getMixingScore(mixingSession);
      hideMixingStage();
      stopLiveMic();
      $('#micStatus').textContent = `섞기 완료 · ${score}점`;
      commitStep(score);
      return;
    }
  }

  if (micOn || roastArmed || boilArmed || finishArmed || ovenArmed || mixingArmed || ovenStageVisible) animationId = requestAnimationFrame(tickLiveMic);
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
          : boilArmed
            ? '마이크 끔 · 보글보글이 약해져요'
            : mixingArmed
              ? '마이크 끔 · 섞기가 멈춤'
              : '마이크를 켜거나 테스트 입력을 사용하세요.';
      return;
    }

    liveStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const source = audioContext.createMediaStreamSource(liveStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = finishArmed ? 2048 : 512;
    analyser.smoothingTimeConstant = (roastArmed || boilArmed) ? 0.45 : 0.25;
    source.connect(analyser);

    micOn = true;
    lastFrameTs = 0;
    lastSpeechTakAt = 0;
    cutHitGateUntil = 0;
    /* 클릭음만 짧게 무시 — 음성은 바로 */
    cutVoiceArmedAt = peakArmed ? performance.now() + 280 : 0;
    if (peakArmed) cutHitGateUntil = cutVoiceArmedAt;
    $('#micBtn').textContent = '마이크 끄기';

    if (peakArmed) {
      setListening(cutSession, true);
      $('#micStatus').textContent = '준비 중… 클릭음 지나간 뒤 말하세요';
    } else if (roastArmed) {
      stopTakSpeech();
      $('#micStatus').textContent = '「후우~」 불어 강불 · 멈추면 약불';
    } else if (finishArmed) {
      stopTakSpeech();
      $('#micStatus').textContent = '음정을 듣는 중 · 주황색 목표 구간에 맞춰 「아—」 하고 길게 내보세요.';
    } else if (ovenArmed) {
      stopTakSpeech();
      const ok = startOvenSpeech();
      $('#micStatus').textContent = ok ? '오븐 듣는 중 · 「띵」으로 끄세요' : '음성인식 불가 · 버튼으로 진행';
    } else if (boilArmed) {
      stopTakSpeech();
      $('#micStatus').textContent = '「보글보글」 · 기포가 올라와요';
    } else if (mixingArmed) {
      stopTakSpeech();
      const ok = startMixingSpeech();
      $('#micStatus').textContent = ok ? '섞기 중 · 대본을 읽으세요' : '섞기 중 (음성인식 없음)';
    } else {
      $('#micStatus').textContent = '볼륨 측정 중 (이 공정은 버튼으로 진행)';
    }
    const tmOk = await startTmMicAssist();
    if (tmOk && peakArmed) {
      stopTakSpeech();
      const need = nextRequiredLabel(cutSession);
      const ko = need ? (CUT_LABEL_KO[need] || need) : '탁';
      const armLeft = Math.max(0, cutVoiceArmedAt - performance.now());
      if (armLeft > 50) {
        $('#micStatus').textContent = `준비 중… ${Math.ceil(armLeft / 100) / 10}초 후 「${ko}」`;
        setTimeout(() => {
          if (!micOn || !peakArmed) return;
          const n2 = nextRequiredLabel(cutSession);
          const ko2 = n2 ? (CUT_LABEL_KO[n2] || n2) : '탁';
          $('#micStatus').textContent = `음성만 · 「${ko2}」 · 숫자가 올라가는지 보세요`;
        }, armLeft + 30);
      } else {
        $('#micStatus').textContent = `음성만 · 「${ko}」 · 숫자가 올라가는지 보세요`;
      }
    } else if (peakArmed) {
      const ok = startTakSpeech();
      $('#micStatus').textContent = ok
        ? '음성인식 · 「탁」 크게 (TM 없음 · STT)'
        : '음성인식 불가 · Chrome에서 다시 시도';
    } else if (tmOk && roastArmed) {
      $('#micStatus').textContent = 'TM ON · 「후우~」불어 강불';
    } else if (tmOk && boilArmed) {
      $('#micStatus').textContent = 'TM ON · 「보글」 Chap/Tak';
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

preloadTmAudio().catch((err) => console.warn('TM audio preload:', err));
renderPlayers();
showScreen('start');
