import {
  ACTION_LABEL,
  INGREDIENT_LABEL,
  TYPE_ICON,
  TYPE_LABEL,
  ingredientAsset,
  primaryIngredient,
} from './data.js?v=50';
import { calculateResult, createGameState, getCurrent, getIngredientCuts, getPlayer, getSteps, rememberIngredientCuts, startNextDay, submitStep } from './state.js?v=50';
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
} from './cutplay.js?v=50';
import {
  bandLabel,
  createRoastHeat,
  fireSrcFor,
  resetRoastHeat,
  roastAccuracy,
  stopRoastHeat,
  tickRoastHeat,
} from './roastheat.js?v=50';
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
} from './mixing.js?v=50';

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
let ovenArmed = false;
let ovenStartTimer = null;
let ovenVisualDuration = 0; // n_a: 다이얼이 한 바퀴 도는 시각적 제한시간
let ovenTargetTime = null; // n_b: 플레이어가 말해야 하는 목표 시점 (초)
let ovenAcceptWindow = 1.2; // 허용 오차(초)
let ovenElapsed = 0;
let ovenStopped = false;
let ovenUserStopAt = null; // 사용자가 띵을 외친 시각(초)
let ovenLightOn = false;
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
/** 끓이기 불 테스트 고정 (약/중/강) */
let boilFireLock = null;
const BOIL_NEED_SEC = 9;

let mixingArmed = false;
const mixingSession = createMixingSession();
let mixingSpeechRec = null;
let mixingSpeechWanted = false;

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
  syncFireTestButtons(roastHeat.band);

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
      hint.textContent = `목표 시점 ${ovenTargetTime.toFixed(1)}초에 '띵'을 말하세요`;
    } else {
      hint.textContent = '';
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
  $('.counter-scene')?.classList.add('is-oven');

  // 오븐 내부에 재료 이미지를 표시 (오븐 전용 파일명 우선)
  try {
    // Use a screen-fixed container so ingredients are positioned relative to the viewport,
    // not the transformed .oven-stage. Create it if missing.
    let screenContents = $('#ovenContentsScreen');
    if (!screenContents) {
      screenContents = document.createElement('div');
      screenContents.id = 'ovenContentsScreen';
      screenContents.className = 'oven-contents-screen';
      document.body.appendChild(screenContents);
    }
    // keep the original in-stage container empty to avoid duplicates
    const inStage = $('#ovenContents');
    if (inStage) inStage.innerHTML = '';

    const files = stepData?.ovenFiles || [];
    const ingIds = stepData?.ingredients || [];
    screenContents.innerHTML = '';
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
      item.style.zIndex = '30'; // above many scene elements when screen-fixed
      const horiz = (idx - (files.length-1)/2) * 8;
      // size the ingredient to 0.9 scale as requested
      const scaleVal = 0.9;
      item.style.transform = `translateX(${horiz}%) scale(${scaleVal})`;
      item.style.transformOrigin = '50% 100%';
      item.appendChild(img);
      screenContents.appendChild(item);
    });
  } catch (e) { console.error('oven render error', e); }

  // 다이얼은 25초 고정으로 작동
  ovenVisualDuration = 25;
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
      for (let a = 0; a < result.length; a++) {
        chunk += ` ${result[a]?.transcript || ''}`;
      }
    }
    chunk = chunk.trim();
    
    // 인식된 텍스트를 기반으로 대본 일치도 계산
    if (chunk && mixingSession.guideScript) {
      const targetScript = mixingSession.guideScript;
      let matchCount = 0;
      for (let i = 0; i < Math.min(chunk.length, targetScript.length); i++) {
        if (chunk[i] === targetScript[i]) matchCount++;
      }
      mixingSession.recognizedText = chunk;
      mixingSession.scriptMatchProgress = Math.min(1.0, matchCount / targetScript.length);
      
      // 가이드 텍스트 색상 업데이트
      const guideText = document.getElementById('mixingGuideText');
      if (guideText) {
        let html = '';
        for (let i = 0; i < targetScript.length; i++) {
          const matched = i < chunk.length && chunk[i] === targetScript[i];
          const cls = matched ? 'matched' : '';
          html += `<span class="${cls}">${targetScript[i]}</span>`;
        }
        guideText.innerHTML = html;
      }
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
  boilLevel = 0;
  pot.src = assetUrl('./src/assets/도구/냄비_물.png');
  pot.alt = '물 든 냄비';

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
  const mixingId = primaryIngredient(stepData);
  const mixingImg = $('#mixingContentImg');
  if (mixingImg && mixingId) {
    const fileName = mixingId.includes('.') ? mixingId : `${mixingId}.png`;
    const tryPaths = [
      `./src/assets/섞기/${fileName}`,
      `./src/assets/도구/${fileName}`,
    ];
    let attempt = 0;
    const tryNext = () => {
      if (attempt >= tryPaths.length) {
        console.warn('섞기 이미지 로딩 실패:', mixingId, tryPaths);
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
  const guideText = $('#mixingGuideText');
  if (guideText) {
    let html = '';
    for (let i = 0; i < guideScript.length; i++) {
      html += `<span>${guideScript[i]}</span>`;
    }
    guideText.innerHTML = html;
  }

  // 점수 표시
  const scoreDisplay = $('#mixingScore');
  if (scoreDisplay) {
    scoreDisplay.textContent = '100%';
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
  // Ensure any live listeners and oven-specific state are cleaned up
  try { stopOvenSpeech(); } catch (_) {}
  hideOvenStage();
  hideMixingStage();
  stopLiveMic();
  if (isCuttingStep(getCurrent(state)) && !cutSession.finished && !cutSession.animating) {
    await runCannedCut();
    return;
  }
  if (isFinishStep(getCurrent(state))) await playFinishTestEffect(90);
  commitStep(90);
});
on($('#missBtn'), 'click', () => {
  try { stopOvenSpeech(); } catch (_) {}
  hideOvenStage();
  hideMixingStage();
  stopLiveMic();
  if (isFinishStep(getCurrent(state))) await playFinishTestEffect(45);
  commitStep(45);
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
  stopMixingSpeech();
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
  if (!roastArmed && !boilArmed && !ovenArmed && !mixingArmed && !ovenVisible && animationId) {
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
  const ovenStageEl = $('#ovenStage');
  const ovenStageVisible = ovenStageEl && !ovenStageEl.hidden;
  if (!micOn && !roastArmed && !boilArmed && !ovenArmed && !mixingArmed && !ovenStageVisible) return;

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
      const score = Math.round(Math.max(40, 95 - diffToTarget * 30));
      // cleanup speech listener specifically
      try { stopOvenSpeech(); } catch (_) {}
      hideOvenStage();
      stopLiveMic();
      $('#micStatus').textContent = success ? `오븐 정지 · 성공! · ${score}점` : `오븐 정지 · 실패 · ${score}점`;
      submitStep(state, score);
      renderGame();
      return;
    }

    if (ovenElapsed >= ovenVisualDuration) {
      // 시간이 다 흘렀고 사용자가 못맞춘 경우: 실패
      const diff = Math.abs(ovenElapsed - (ovenTargetTime || 0));
      const score = Math.round(Math.max(20, 60 - diff * 20));
      try { stopOvenSpeech(); } catch (_) {}
      hideOvenStage();
      stopLiveMic();
      $('#micStatus').textContent = `시간 초과 · 실패 · ${score}점`;
      submitStep(state, score);
      renderGame();
      return;
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

  if (mixingArmed && isMixingStep(current)) {
    const blowVol = micOn ? volumePercent : 45;
    tickMixing(mixingSession, blowVol, dt);
    
    const mixState = getMixingState(mixingSession);
    const scoreDisplay = $('#mixingScore');
    if (scoreDisplay) {
      scoreDisplay.textContent = `${Math.round(mixState.accuracy)}%`;
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
      const contentYOffset = 8;
      const bowlPos = getBowlPosition(mixingSession, 0, 0, 90);
      const baseX = bowlPos.x + offset.x;
      const baseY = bowlPos.y + contentYOffset + offset.y;
      mixingImg.style.transform = `translate(calc(-50% + ${baseX}px), calc(-50% + ${baseY}px)) rotate(${rotation}deg)`;
      mixingImg.style.opacity = offset.opacity;
    }

    if (micOn) {
      $('#micStatus').textContent = `섞기 중 · 정확도 ${Math.round(mixState.accuracy)}% · 시간 ${Math.round(mixState.elapsed)}/${Math.round(mixState.totalDuration)}초`;
    }

    if (mixState.done) {
      const score = getMixingScore(mixingSession);
      hideMixingStage();
      stopLiveMic();
      $('#micStatus').textContent = `섞기 완료 · ${score}점`;
      submitStep(state, score);
      renderGame();
      return;
    }
  }

  if (micOn || roastArmed || boilArmed || ovenArmed || mixingArmed || ovenStageVisible) animationId = requestAnimationFrame(tickLiveMic);
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

