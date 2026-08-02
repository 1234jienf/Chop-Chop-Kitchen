/**
 * 썰기 로직
 * - 칼 자동 L→R
 * - 「탁」 인식 시 칼 위치에서 무조건 절단 (점선=정답, 밖=어긋난 재미 컷)
 * - 실제 자른 위치 그대로 조각 표시
 */

const HIT_WINDOW = 0.1;
const ASR_GRACE = 0.12;
const KNIFE_SPEED = 0.085;
const PEAK_COOLDOWN_MS = 260;
const TOMATO_SIZE = 220;
const MIN_CUT_GAP = 0.055;

function buildCutMarks(count = 3) {
  const marks = [];
  for (let i = 1; i <= count; i++) marks.push(i / (count + 1));
  return marks;
}

export function createCutSession({ onStatus, onComplete }) {
  return {
    ingredientFile: null,
    crossSectionFile: null,
    assetVer: '1',
    marks: buildCutMarks(3),
    cutDone: [],
    actualCuts: [],
    hitErrors: [],
    knifeX: 0,
    moving: false,
    listening: false,
    finished: false,
    animating: false,
    lastPeakAt: 0,
    lastGuideIdx: -1,
    onStatus,
    onComplete,
  };
}

export function crossSectionFrom(ingredientFile) {
  if (!ingredientFile) return null;
  return ingredientFile.replace(/\.png$/i, '_단면.png');
}

export function resetCutSession(session, { ingredientFile, crossSectionFile, assetVer = '1', cutCount = 3 }) {
  session.ingredientFile = ingredientFile;
  session.crossSectionFile = crossSectionFile;
  session.assetVer = assetVer;
  session.marks = buildCutMarks(cutCount);
  session.cutDone = session.marks.map(() => false);
  session.actualCuts = [];
  session.hitErrors = [];
  session.knifeX = 0;
  session.moving = false;
  session.listening = false;
  session.finished = false;
  session.animating = false;
  session.lastPeakAt = 0;
  session.lastGuideIdx = -1;
}

export function setListening(session, on) {
  const active = Boolean(on) && !session.finished && !session.animating;
  session.listening = active;
  session.moving = active;
  if (active && session.knifeX >= 0.98) session.knifeX = 0;
}

export function setKnifeListening(_knifeEl, _on) {}

export function countTakInText(text) {
  if (!text) return 0;
  const ko = text.match(/탁|딱/g);
  if (ko?.length) return ko.length;
  const en = text.toLowerCase().match(/\btak\b/g);
  return en?.length || 0;
}

export function detectTak(freq, wave, wasAbove) {
  let peak = 0;
  for (let i = 0; i < wave.length; i++) peak = Math.max(peak, Math.abs(wave[i] - 128));
  const level = Math.min(100, (peak / 128) * 100);
  return { hit: false, above: level >= 20, kind: 'none', level };
}

export function detectPeak(level, wasAbove) {
  const above = level >= 22;
  return { hit: above && !wasAbove, above };
}

function needCuts(session) {
  return session.marks.length;
}

export function advanceKnife(session, dtSec) {
  if (!session.moving || session.finished || session.animating) return;
  session.knifeX = Math.min(1, session.knifeX + KNIFE_SPEED * dtSec);
  if (session.knifeX >= 1) {
    session.knifeX = 1;
    session.moving = false;
    if (session.actualCuts.length < needCuts(session)) {
      session.knifeX = 0;
      session.moving = session.listening;
      session.onStatus?.('다시 왼쪽부터 — 점선(정답) 또는 아무 데서나 탁!');
    }
  }
}

export function syncKnifeEl(knifeEl, session) {
  if (!knifeEl || !session) return;
  knifeEl.style.setProperty('--knife-t', `${session.knifeX * 100}%`);
}

export function attachKnifeToTomato(boardEl, knifeEl, t = 0) {
  if (!boardEl || !knifeEl) return;
  const arena = boardEl.querySelector('.cut-arena');
  if (!arena) return;
  arena.appendChild(knifeEl);
  knifeEl.hidden = false;
  knifeEl.classList.add('knife-hand--on-tomato');
  knifeEl.classList.remove('chopping', 'is-listening');
  knifeEl.style.setProperty('--knife-t', `${Math.max(0, Math.min(1, t)) * 100}%`);
}

function nearestOpenMark(session) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < session.marks.length; i++) {
    if (session.cutDone[i]) continue;
    const d = session.knifeX - session.marks[i];
    if (d < -HIT_WINDOW || d > HIT_WINDOW + ASR_GRACE) continue;
    const score = Math.abs(d);
    if (score < bestDist) {
      bestDist = score;
      best = i;
    }
  }
  return { index: best, dist: bestDist };
}

function clampNewCut(x, existing) {
  let v = Math.max(0.07, Math.min(0.93, x));
  for (let pass = 0; pass < 4; pass++) {
    for (const c of existing) {
      if (Math.abs(v - c) < MIN_CUT_GAP) {
        v = c + (v >= c ? MIN_CUT_GAP : -MIN_CUT_GAP);
        v = Math.max(0.07, Math.min(0.93, v));
      }
    }
  }
  return v;
}

function playChopAnim(knifeEl) {
  if (!knifeEl) return;
  knifeEl.classList.remove('chopping');
  void knifeEl.offsetWidth;
  knifeEl.classList.add('chopping');
  knifeEl.addEventListener('animationend', () => knifeEl.classList.remove('chopping'), { once: true });
}

function guidesHtml(session) {
  return session.marks
    .map((x, i) => {
      const cls = session.cutDone[i] ? 'done' : '';
      return `<i class="cut-guide ${cls}" style="left:${x * 100}%"></i>`;
    })
    .join('');
}

/** 실제 자른 위치 기준으로 조각 렌더 (진행 중 / 최종 공통) */
function buildSliceParts(session, { spreadScale = 6, gapPx = 5 } = {}) {
  const ver = session.assetVer || '1';
  const src = `./src/assets/재료/${session.ingredientFile}?${ver}`;
  const size = TOMATO_SIZE;
  const cuts = [...session.actualCuts].sort((a, b) => a - b);
  const points = [0, ...cuts, 1];
  let cursor = 0;
  const parts = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const w = Math.max(2, size * (end - start));
    const spread = (i - (points.length - 2) / 2) * spreadScale;
    parts.push(`
      <div class="burst-clip" style="left:${cursor}px;width:${w}px;height:${size}px;--spread:${spread}px;--delay:${i * 35}ms">
        <img src="${src}" alt="" style="width:${size}px;height:${size}px;margin-left:${-start * size}px" draggable="false" />
      </div>
    `);
    cursor += w + (i < points.length - 2 ? gapPx : 0);
  }
  return { parts: parts.join(''), width: cursor, size };
}

/**
 * 「탁」 → 칼 위치에서 절단. 점선이면 정확, 아니면 어긋난 컷(그래도 보임)
 * @returns {'hit'|'off'|'complete'|false}
 */
export function tryChopOnTak(session, { knifeEl, boardEl } = {}) {
  if (!session.listening || session.finished || session.animating) return false;
  const now = performance.now();
  if (now - session.lastPeakAt < PEAK_COOLDOWN_MS) return false;
  session.lastPeakAt = now;

  if (session.actualCuts.length >= needCuts(session)) return 'complete';

  const x = clampNewCut(session.knifeX, session.actualCuts);
  const { index } = nearestOpenMark(session);
  const onGuide = index >= 0;

  session.actualCuts.push(x);
  session.actualCuts.sort((a, b) => a - b);

  if (onGuide) {
    session.cutDone[index] = true;
  } else {
    let nearest = Infinity;
    session.marks.forEach((m, i) => {
      if (!session.cutDone[i]) nearest = Math.min(nearest, Math.abs(x - m));
    });
    session.hitErrors.push(Number.isFinite(nearest) ? nearest : 1);
  }

  playChopAnim(knifeEl);

  const n = session.actualCuts.length;
  const total = needCuts(session);
  if (onGuide) session.onStatus?.(`정확! ${n}/${total}`);
  else session.onStatus?.(`어긋난 컷! 그래도 썰림 · ${n}/${total}`);

  if (boardEl) {
    renderLiveTomato(boardEl, session);
    if (knifeEl) attachKnifeToTomato(boardEl, knifeEl, session.knifeX);
  }

  if (n >= total) return 'complete';
  return onGuide ? 'hit' : 'off';
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function finishSplit(session, { knifeEl, boardEl } = {}) {
  if (session.finished) return;
  session.animating = true;
  session.moving = false;
  session.listening = false;

  if (knifeEl) {
    const scene = boardEl?.closest('.counter-scene');
    if (scene) scene.appendChild(knifeEl);
    knifeEl.classList.remove('knife-hand--on-tomato', 'chopping');
    knifeEl.hidden = true;
  }

  session.finished = true;
  if (boardEl) {
    boardEl.classList.add('is-burst');
    renderSplitBoard(boardEl, session);
  }
  await wait(550);

  const misses = session.hitErrors.length;
  const accuracy = Math.max(50, 94 - misses * 10);
  session.animating = false;
  session.onComplete?.(accuracy);
}

export async function completeAfterVoice(session, ctx) {
  await finishSplit(session, ctx);
}

export async function playCannedCut(session, { knifeEl, boardEl } = {}) {
  if (session.finished || session.animating) return null;
  session.animating = true;
  session.moving = false;
  session.listening = false;
  session.onStatus?.('칼질!');

  if (knifeEl && boardEl) attachKnifeToTomato(boardEl, knifeEl, session.knifeX);

  for (let i = 0; i < session.marks.length; i++) {
    if (session.actualCuts.length >= needCuts(session)) break;
    if (session.cutDone[i]) continue;
    session.knifeX = session.marks[i];
    syncKnifeEl(knifeEl, session);
    session.actualCuts.push(session.marks[i]);
    session.actualCuts.sort((a, b) => a - b);
    session.cutDone[i] = true;
    playChopAnim(knifeEl);
    if (boardEl) {
      renderLiveTomato(boardEl, session);
      if (knifeEl) attachKnifeToTomato(boardEl, knifeEl, session.knifeX);
    }
    await wait(150);
  }

  await finishSplit(session, { knifeEl, boardEl });
  return true;
}

/** 진행 중: 실제 컷 위치로 갈라진 토마토 + 점선(정답 가이드) */
export function renderLiveTomato(root, session) {
  if (!root || !session.ingredientFile) return;
  root.hidden = false;
  root.classList.remove('is-burst');

  const ver = session.assetVer || '1';
  const guides = guidesHtml(session);

  if (!session.actualCuts.length) {
    const whole = `./src/assets/재료/${session.ingredientFile}?${ver}`;
    root.innerHTML = `
      <div class="cut-stage cut-stage--ready">
        <div class="cut-arena">
          <div class="whole-tomato">
            <img class="whole-tomato-img" src="${whole}" alt="토마토" draggable="false" />
            <div class="cut-guides">${guides}</div>
          </div>
        </div>
        <p class="cut-hint">점선=정답 · 밖에서 「탁」해도 <b>그 자리</b>에서 썰림</p>
      </div>
    `;
    return;
  }

  const { parts, width, size } = buildSliceParts(session, { spreadScale: 4, gapPx: 4 });
  root.innerHTML = `
    <div class="cut-stage cut-stage--ready">
      <div class="cut-arena cut-arena--sliced" style="width:${Math.max(TOMATO_SIZE, width)}px;height:${size}px">
        <div class="live-slices" style="width:${width}px;height:${size}px;position:relative;margin:0 auto">
          ${parts}
          <div class="cut-guides cut-guides--over">${guides}</div>
        </div>
      </div>
      <p class="cut-hint">점선=정답 · 어긋나도 <b>자른 자리</b> 그대로</p>
    </div>
  `;
}

export function renderCutBoard(root, session) {
  if (!root) return;
  if (!session.ingredientFile) {
    root.innerHTML = '';
    root.hidden = true;
    return;
  }
  if (session.finished) {
    renderSplitBoard(root, session);
    return;
  }
  renderLiveTomato(root, session);
}

export function renderSplitBoard(root, session) {
  if (!session.actualCuts.length) {
    session.actualCuts = [...session.marks];
  }
  const { parts, width, size } = buildSliceParts(session, { spreadScale: 8, gapPx: 6 });
  root.innerHTML = `
    <div class="cut-stage cut-stage--burst" style="width:${width}px;height:${size}px">
      ${parts}
    </div>
  `;
}

export function forceFinishCuts(session, ctx) {
  return playCannedCut(session, ctx);
}

export function applyVoiceChop() {
  return false;
}
export function registerPeak() {
  return false;
}
