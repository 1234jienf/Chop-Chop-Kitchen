import {
  ACTION_LABEL,
  INGREDIENT_LABEL,
  TYPE_ICON,
  TYPE_LABEL,
  ingredientAsset,
  primaryIngredient,
} from './data.js?v=44';
import { calculateResult, createGameState, getCurrent, getIngredientCuts, getPlayer, getSteps, rememberIngredientCuts, startNextDay, submitStep } from './state.js?v=44';
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
  renderLiveTomato,
  renderSplitBoard,
  resetCutSession,
  setListening,
  syncKnifeEl,
  tryChopOnTak,
} from './cutplay.js?v=45';
import {
  bandLabel,
  createRoastHeat,
  fireSrcFor,
  resetRoastHeat,
  roastAccuracy,
  stopRoastHeat,
  tickRoastHeat,
} from './roastheat.js?v=44';
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
} from './sprinklepourplay.js?v=44';
import { KitchenMultiplayer, defaultMultiplayerUrl } from './multiplayer.js?v=44';

const $ = (s) => document.querySelector(s);
const state = createGameState();
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
  },
  onError: (message) => { $('#multiStatus').textContent = message; },
});
let micOn = false;
let liveStream = null;
let peakArmed = false;
let roastArmed = false;
let finishArmed = false;
let boilArmed = false;
let lastFrameTs = 0;
let speechRec = null;
let speechWanted = false;
let lastSpeechTakAt = 0;
let wasAboveBurst = false;
let speechKickTimer = null;
const roastHeat = createRoastHeat();
const finishSession = createFinishSession();
let finishSubmitted = false;
let lastFireBand = 'mid';
let lastToastLevel = 0;
let boilProgress = 0;
let boilLevel = -1;
const BOIL_NEED_SEC = 9;

let audioContext = null;
let analyser = null;
let animationId = null;
let lastActivitySentAt = 0;

const cutSession = createCutSession({
  onStatus: (msg) => { $('#micStatus').textContent = msg; },
  onComplete: (accuracy) => {
    void finishCutStep(accuracy);
  },
});

async function finishCutStep(accuracy) {
  stopLiveMic();
  const current = getCurrent(state);
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
  return '주방_끓이기.png';
}

const ASSET_VER = 'v43';

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
  if (stage) stage.hidden = true;
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

function isBoilingStep(stepData) {
  return stepData?.action === 'boiling';
}

/** 바게트 굽기: 단면(0) → 굽1 → 굽2 → 굽3(최종) */
function baguetteToastFile(level) {
  const lv = Math.max(0, Math.min(3, level | 0));
  if (lv === 0) return '바게트_단면.png';
  return `바게트굽${lv}.png`;
}

function roastToastLevel(session) {
  const p = (session?.matchTime || 0) / Math.max(1, session?.needMatch || 10);
  if (p >= 0.75) return 3;
  if (p >= 0.5) return 2;
  if (p >= 0.25) return 1;
  return 0;
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
  if (level === lastToastLevel) return;
  lastToastLevel = level;
  const src = assetUrl(`./src/assets/재료/${baguetteToastFile(level)}`);
  slices.querySelectorAll('.roast-slice, .roast-whole').forEach((img) => {
    img.src = src;
    img.dataset.toast = String(level);
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

function syncFireTestButtons() {
  const wrap = $('#fireTestBtns');
  if (!wrap) return;
  wrap.querySelectorAll('[data-fire-test]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.fireTest === roastHeat.band);
  });
}

function forceFireBand(band) {
  const heat = band === 'low' ? 18 : band === 'high' ? 85 : 50;
  roastHeat.heat = heat;
  roastHeat.band = band;
  roastHeat.debugLock = true;
  applyFireSprite(band, true);
  syncHeatUi();
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
  if (targetLabel) targetLabel.textContent = `목표 ${bandLabel(roastHeat.targetBand)}`;
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
  syncFireTestButtons();

  if (blowFx) {
    const on = Boolean(roastHeat.blowing);
    if (on) blowFx.hidden = false;
    blowFx.classList.toggle('is-on', on);
    if (!on && !roastArmed) blowFx.hidden = true;
  }
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
  boilLevel = -1;
}

function syncBoilFx() {
  const stage = $('#boilStage');
  if (!stage) return;
  const p = boilProgress / Math.max(0.001, BOIL_NEED_SEC);
  const level = p >= 0.66 ? 2 : p >= 0.33 ? 1 : 0;
  boilLevel = level;
  stage.classList.toggle('boil-low', level === 0);
  stage.classList.toggle('boil-med', level === 1);
  stage.classList.toggle('boil-hot', level === 2);
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
  boilLevel = 0;
  pot.src = assetUrl('./src/assets/도구/냄비_물.png');
  pot.alt = '물 든 냄비';

  if (fire) {
    fire.src = fireSrcFor('mid', ASSET_VER);
    fire.dataset.band = 'mid';
    fire.alt = '중불';
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
  if (!animationId) {
    lastFrameTs = 0;
    animationId = requestAnimationFrame(tickLiveMic);
  }

  $('#stationIcon').hidden = true;
  $('#micStatus').textContent = '마이크 켜고 「보글보글」 · 물이 끓어요';
  $('#stepHint').textContent = `목표 소리 “${stepData.targetPattern}” · ${stepData.hint || '보글보글 하면 기포가 세져요'}`;
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
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === name));
  window.scrollTo(0, 0);
  if (name === 'game') scheduleFitGameStage();
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
  const counterScene = $('.counter-scene');
  const gameStage = $('#gameStage');
  counterScene.classList.add('has-kitchen-background');
  counterScene.classList.toggle('is-cutting', isCuttingStep(current));
  counterScene.classList.toggle('is-roasting', isRoastingStep(current));
  counterScene.classList.toggle('is-finishing', isFinishStep(current));
  counterScene.classList.toggle('is-boiling', isBoilingStep(current));
  gameStage?.classList.toggle('is-cutting', isCuttingStep(current));
  gameStage?.classList.toggle('is-roasting', isRoastingStep(current));
  gameStage?.classList.toggle('is-boiling', isBoilingStep(current));

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
    resetCutSession(cutSession, {
      ingredientFile,
      crossSectionFile: crossSectionFrom(ingredientFile),
      assetVer: ASSET_VER,
      cutCount: 3,
    });
    if (knife.parentElement !== counterScene) counterScene.appendChild(knife);
    cutBoard.classList.remove('is-passing-out', 'is-entering');
    renderCutBoard(cutBoard, cutSession);
    attachKnifeToTomato(cutBoard, knife, 0);
    cutSession.knifeX = 0;
    syncKnifeEl(knife, cutSession);
    counterScene.classList.add('is-zoomed');
    peakArmed = true;
    $('#micStatus').textContent = '마이크 켜기 → 「탁」하면 칼 자리에서 썰림 (점선=정답)';
    $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” · 점선이 정답, 어긋나도 그 자리 절단`;
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
    $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” · ${current.hint}`;
  } else if (isFinishStep(current)) {
    peakArmed = false;
    hideRoastStage();
    cutBoard.hidden = true;
    cutBoard.innerHTML = '';
    knife.hidden = true;
    cutIngredient.hidden = true;
    $('#stationIcon').hidden = true;
    counterScene.classList.remove('is-zoomed');
    setListening(cutSession, false);
    renderFinishStage(current);
  } else {
    hideFinishStage();
  }

  if (isBoilingStep(current)) {
    hideFinishStage();
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
  } else if (!isCuttingStep(current) && !isRoastingStep(current) && !isFinishStep(current)) {
    peakArmed = false;
    hideRoastStage();
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
  const previousStep = getSteps(state)[previousStepIndex];
  const shared = game.sharedState || {};
  if (shared.day != null) state.day = shared.day;
  if (shared.money != null) state.money = shared.money;
  if (shared.grade) state.grade = shared.grade;
  if (shared.guest) state.guest = shared.guest;
  const playersById = new Map(snapshot.players.map((p) => [p.id, p.name]));
  setupPlayerIds = [...game.order];
  state.players = game.order.map((id) => playersById.get(id));
  state.currentStep = game.currentStep;
  state.results = game.results.map((accuracy, index) => ({ ...getSteps(state)[index], accuracy }));
  state.ingredientCuts = { ...game.ingredientCuts };
  state.finished = state.currentStep >= getSteps(state).length;
  if (state.currentStep !== previousStepIndex) boardHandoffToken += 1;
  renderGame();
  showScreen(state.finished ? 'result' : 'game');
  const currentStep = getCurrent(state);
  if (state.currentStep === previousStepIndex + 1
    && isCuttingStep(previousStep)
    && isCuttingStep(currentStep)) {
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
  submitStep(state, accuracy);
  renderGame();
  scheduleFitGameStage();
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
on($('#connectMultiBtn'), 'click', async () => {
  const button = $('#connectMultiBtn');
  button.disabled = true;
  $('#multiStatus').textContent = '멀티 방에 연결하는 중…';
  try {
    await multiplayer.connect({
      url: defaultMultiplayerUrl(),
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
      });
      $('#multiStatus').textContent = '준비 완료! 다른 셰프를 기다리는 중…';
      return;
    }
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
  if (isFinishStep(getCurrent(state))) await playFinishTestEffect(90);
  commitStep(90);
});
on($('#missBtn'), 'click', async () => {
  stopLiveMic();
  if (isFinishStep(getCurrent(state))) await playFinishTestEffect(45);
  commitStep(45);
});
on($('#fireTestBtns'), 'click', (event) => {
  const btn = event.target.closest('[data-fire-test]');
  if (!btn || !roastArmed) return;
  forceFireBand(btn.dataset.fireTest);
});
on($('#nextDayBtn'), 'click', () => {
  startNextDay(state);
  if (multiplayer.connected) multiplayer.nextDay({
    day: state.day, money: state.money, grade: state.grade, guest: state.guest,
  });
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
  // 굽기/끓이기/마무리 중이면 게이지·진행 루프는 유지
  if (!roastArmed && !boilArmed && !finishArmed && animationId) {
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
  if (!micOn && !roastArmed && !finishArmed && !boilArmed) return;

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
    });
  }

  if (boilArmed && isBoilingStep(current)) {
    const bubbling = micOn && volumePercent >= 14;
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
      const score = 88;
      hideBoilStage();
      stopLiveMic();
      $('#micStatus').textContent = `수프 완성 · ${score}점`;
      commitStep(score);
      return;
    }
  }

  if (roastArmed && isRoastingStep(current)) {
    const blowVol = micOn ? volumePercent : 0;
    tickRoastHeat(roastHeat, blowVol, dt);
    syncHeatUi();
    const ingId = primaryIngredient(current);
    syncRoastToastVisuals(ingId);
    if (micOn) {
      const inZone = roastHeat.heat >= roastHeat.targetMin && roastHeat.heat <= roastHeat.targetMax;
      const toastBit = ingId === 'baguette' ? ` · ${toastStatusLabel(roastToastLevel(roastHeat))}` : '';
      $('#micStatus').textContent = roastHeat.blowing
        ? `후우~ · ${bandLabel(roastHeat.band)} → 목표 ${bandLabel(roastHeat.targetBand)}${inZone ? ' ✓' : ''}${toastBit}`
        : `쉬면 천천히 약불로… · 목표 ${bandLabel(roastHeat.targetBand)}${toastBit}`;
    }
    if (roastHeat.done) {
      if (ingId === 'baguette') {
        lastToastLevel = 0;
        roastHeat.matchTime = roastHeat.needMatch;
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

  if (micOn || roastArmed || boilArmed || finishArmed) animationId = requestAnimationFrame(tickLiveMic);
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
    } else if (finishArmed) {
      stopTakSpeech();
      $('#micStatus').textContent = '음정을 듣는 중 · 주황색 목표 구간에 맞춰보세요.';
    } else if (boilArmed) {
      stopTakSpeech();
      $('#micStatus').textContent = '「보글보글」 · 기포가 올라와요';
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
