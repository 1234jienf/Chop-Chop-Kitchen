/**
 * 썰기 로직 (리듬형)
 * - 칼 L→R, 가이드마다 Tak/Ssuk/Ssak/Chap
 * - Ssuk = 스으윽~ 홀드 판정
 * - 발음별 칼 방향 · 단면 느낌
 */

const HIT_WINDOW = 0.2;
const ASR_GRACE = 0.16;
const HOT_BEFORE = 0.2;
const HOT_AFTER = 0.16;
const SOON_BEFORE = 0.34;
const KNIFE_SPEED = 0.11;
const PEAK_COOLDOWN_MS = 60;
const POST_CUT_LOCK_MS = 160;
const CUT_ADVANCE_MIN = 0.045;
const CUT_SIZE_DEFAULT = 240;
const MISS_COOLDOWN_MS = 120;
const HOLD_GAP_MS = 260;
const MAX_KNIFE_PASSES = 1;
const TM_HOT_GRACE_MS = 320;
const PENDING_CHOP_MS = 220;
const EARLY_QUEUE = 0.28;

/** 도마 위 표시 크기 — 크게 해서 점선 간격이 보이게 */
const CUT_LAYOUT_BY_FILE = {
  '바게트.png': { w: 460, h: 120 },
  '아스파라거스.png': { w: 440, h: 52 },
  '토마토.png': { w: 240, h: 240 },
  '당근.png': { w: 280, h: 200 },
  '양파.png': { w: 220, h: 220 },
  '감자.png': { w: 230, h: 200 },
};

/** 가이드 점선만 재료 실제 폭에 맞춤 (렌더는 전체 스프라이트) */
const CUT_SPRITE_CONTENT = {
  '바게트.png': { x0: 169 / 1536, x1: 1402 / 1536, y0: 434 / 1024, y1: 636 / 1024 },
  '아스파라거스.png': { x0: 71 / 1619, x1: 1552 / 1619, y0: 441 / 971, y1: 544 / 971 },
};

/** 재료별 컷 수 — 너무 많으면 간격이 좁아 보임 */
const CUT_COUNT_BY_FILE = {
  '바게트.png': 5,
  '토마토.png': 4,
  '아스파라거스.png': 5,
};

/** @type {Record<string, string>} */
export const CUT_LABEL_KO = {
  Tak: '탁',
  Ssuk: '슥',
  Ssak: '삭',
  Chap: '찹',
};

/** 발음별 칼·단면·판정 */
export const CUT_STYLE = {
  Tak: { ko: '탁', holdMs: 0, knife: 'chopping-tak', slice: 'slice-tak', guide: 'guide-tak', fx: 'chop-fx-tak' },
  Ssuk: { ko: '슥', holdMs: 280, knife: 'chopping-ssuk', slice: 'slice-ssuk', guide: 'guide-ssuk', fx: 'chop-fx-ssuk' },
  Ssak: { ko: '삭', holdMs: 0, knife: 'chopping-ssak', slice: 'slice-ssak', guide: 'guide-ssak', fx: 'chop-fx-ssak' },
  Chap: { ko: '찹', holdMs: 0, knife: 'chopping-chap', slice: 'slice-chap', guide: 'guide-chap', fx: 'chop-fx-chap' },
};

function cutLayoutFor(session) {
  const custom = CUT_LAYOUT_BY_FILE[session?.ingredientFile];
  if (custom) return { w: Math.round(custom.w * 1.2), h: Math.round(custom.h * 1.2) };
  return { w: CUT_SIZE_DEFAULT, h: CUT_SIZE_DEFAULT };
}

function spriteContentX(session) {
  const c = CUT_SPRITE_CONTENT[session?.ingredientFile];
  return c || { x0: 0, x1: 1 };
}

/** 긴 재료(바게트 등) — background-position 클립 */
const SPRITE_ASPECT = {
  '바게트.png': 1024 / 1536,
  '아스파라거스.png': 971 / 1619,
};

function isWideCut(session, boxW, boxH) {
  return boxW > boxH * 1.35 || Boolean(SPRITE_ASPECT[session?.ingredientFile]);
}

function segmentBgStyle(session, start, boxW, boxH, src) {
  const c = CUT_SPRITE_CONTENT[session.ingredientFile] || { x0: 0, x1: 1, y0: 0, y1: 1 };
  const cw = c.x1 - c.x0;
  const aspect = SPRITE_ASPECT[session.ingredientFile] || (boxH / boxW);
  const bgW = boxW / cw;
  const bgH = bgW * aspect;
  const posX = -(c.x0 * bgW + start * boxW);
  const contentMid = ((c.y0 + c.y1) / 2) * bgH;
  const posY = boxH / 2 - contentMid;
  return `background-image:url('${src}');background-repeat:no-repeat;background-size:${bgW}px ${bgH}px;background-position:${posX}px ${posY}px`;
}

function segmentImgStyle(session, start, boxW, boxH, st) {
  let transform = '';
  if (st?.slice === 'slice-ssuk') transform = 'transform:scaleY(0.92) skewX(-4deg)';
  else if (st?.slice === 'slice-ssak') transform = 'transform:rotate(-2deg)';
  return `width:${boxW}px;height:${boxH}px;margin-left:${-start * boxW}px;object-fit:contain;max-width:none;${transform}`;
}

function marginForCount(count) {
  /* 양옆 여백 — 컷 수가 적을수록 안쪽에 넓게 배치 */
  if (count >= 6) return 0.12;
  if (count >= 4) return 0.13;
  return 0.15;
}

/**
 * @param {string|null} ingredientFile
 */
export function cutCountForIngredient(ingredientFile) {
  if (CUT_COUNT_BY_FILE[ingredientFile]) return CUT_COUNT_BY_FILE[ingredientFile];
  const w = cutLayoutFor({ ingredientFile }).w;
  if (w >= 400) return 5;
  if (w >= 260) return 4;
  return 4;
}

function buildCutMarks(count = 3, ingredientFile = null) {
  const margin = marginForCount(count);
  const c = CUT_SPRITE_CONTENT[ingredientFile] || { x0: 0.08, x1: 0.92 };
  const span = c.x1 - c.x0;
  const pad = margin * span;
  const usable = span - 2 * pad;
  const marks = [];
  /* 균등 배치 — 양끝 여백 확보해서 조각이 너무 얇지 않게 */
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 1) / (count + 1);
    marks.push(c.x0 + pad + usable * t);
  }
  return marks;
}

export function knifeStartX(session) {
  const first = session?.marks?.[0];
  if (first == null) return 0.03;
  return Math.max(0.02, first - 0.06);
}

function buildBeginnerChart(count) {
  /* 탁 / 슥~ / 삭 번갈아 — 같은 발음 연속 최소화 */
  const pool = ['Tak', 'Ssuk', 'Ssak'];
  const chart = [];
  for (let i = 0; i < count; i++) chart.push(pool[i % pool.length]);
  for (let i = 1; i < chart.length; i++) {
    if (chart[i] === chart[i - 1]) {
      chart[i] = pool[(pool.indexOf(chart[i]) + 1) % pool.length];
    }
  }
  /* 마지막이 첫과 같고 count>=3이면 살짝 바꿔 리듬감 */
  if (count >= 4 && chart[count - 1] === chart[0]) {
    chart[count - 1] = pool[(pool.indexOf(chart[count - 1]) + 1) % pool.length];
    if (chart[count - 1] === chart[count - 2]) {
      chart[count - 1] = pool[(pool.indexOf(chart[count - 1]) + 1) % pool.length];
    }
  }
  return chart;
}

function buildFullChart(count) {
  const base = ['Tak', 'Ssuk', 'Ssak', 'Tak', 'Chap', 'Ssuk', 'Ssak', 'Tak', 'Ssuk', 'Chap'];
  const chart = Array.from({ length: count }, (_, i) => base[i % base.length]);
  for (let i = 1; i < chart.length; i++) {
    if (chart[i] === chart[i - 1]) {
      const alt = ['Tak', 'Ssuk', 'Ssak', 'Chap'].find((l) => l !== chart[i] && l !== chart[i - 1]) || 'Tak';
      chart[i] = alt;
    }
  }
  return chart;
}

function parsePatternToLabels(pattern) {
  if (!pattern) return [];
  const s = String(pattern).trim();
  if (!s) return [];
  /* 단일 효과음/힌트는 리듬 차트가 아님 → 무시하고 믹스 차트 사용 */
  if (/^(콰직|짝|탁|딱|찹|삭|슥)!?$/i.test(s)) return [];
  const parts = s.split(/[·・,/|\s-]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const labels = parts.map((p) => tokenToLabel(p)).filter(Boolean);
    const uniq = new Set(labels);
    /* 탁만 여러 번이면 믹스 차트로 */
    if (uniq.size <= 1 && labels[0] === 'Tak') return [];
    return labels;
  }
  if (/탁|딱/.test(s) && /슥|삭|찹|스으|사각/.test(s)) {
    const out = [];
    const re = /탁|딱|슥|스으윽?|삭|사각|찹/g;
    let m;
    while ((m = re.exec(s))) {
      out.push(tokenToLabel(m[0]));
    }
    return out.length >= 2 ? out : [];
  }
  return [];
}

function tokenToLabel(token) {
  const t = String(token);
  if (/슥|스으|ssuk/i.test(t)) return 'Ssuk';
  if (/삭|사각|ssak/i.test(t)) return 'Ssak';
  if (/찹|chap/i.test(t)) return 'Chap';
  if (/탁|딱|콰|tak/i.test(t)) return 'Tak';
  return 'Tak';
}

/**
 * @param {number} count
 * @param {string|null|undefined} pattern
 * @param {{ beginnerMode?: boolean }} [opts]
 */
export function buildRequiredLabels(count, pattern, { beginnerMode = false } = {}) {
  const parsed = parsePatternToLabels(pattern);
  if (parsed.length >= 2) {
    return Array.from({ length: count }, (_, i) => parsed[i % parsed.length]);
  }
  return beginnerMode ? buildBeginnerChart(count) : buildFullChart(count);
}

export function normalizeCutLabel(label) {
  if (!label) return null;
  const raw = String(label).trim();
  if (CUT_LABEL_KO[raw]) return raw;
  const lower = raw.toLowerCase();
  if (lower === 'tak') return 'Tak';
  if (lower === 'ssuk') return 'Ssuk';
  if (lower === 'ssak') return 'Ssak';
  if (lower === 'chap') return 'Chap';
  if (/탁|딱/.test(raw)) return 'Tak';
  if (/슥|스으/.test(raw)) return 'Ssuk';
  if (/삭|사각/.test(raw)) return 'Ssak';
  if (/찹/.test(raw)) return 'Chap';
  return null;
}

/** TM이 탁/삭/찹을 자주 혼동 → 짧은 컷끼리는 서로 인정 */
function labelsCompatible(got, required) {
  if (got === required) return true;
  const short = new Set(['Tak', 'Ssak', 'Chap']);
  if (short.has(got) && short.has(required)) return true;
  return false;
}

export function createCutSession({ onStatus, onComplete }) {
  return {
    ingredientFile: null,
    crossSectionFile: null,
    assetVer: '1',
    marks: buildCutMarks(3),
    requiredLabels: buildRequiredLabels(3, null, { beginnerMode: true }),
    cutDone: [],
    markGrades: [],
    actualCuts: [],
    cutMeta: [],
    hitErrors: [],
    voiceHold: null,
    hotGuideIndex: -1,
    passCount: 0,
    maxPasses: MAX_KNIFE_PASSES,
    autoFinishPending: false,
    knifeX: 0,
    moving: false,
    listening: false,
    finished: false,
    animating: false,
    lastPeakAt: 0,
    lastMissAt: 0,
    onStatus,
    onComplete,
  };
}

export function crossSectionFrom(ingredientFile) {
  if (!ingredientFile) return null;
  if (ingredientFile === '조개.png') return '조개_다짐.png';
  return ingredientFile.replace(/\.png$/i, '_단면.png');
}

export function resetCutSession(session, {
  ingredientFile,
  crossSectionFile,
  assetVer = '1',
  cutCount,
  targetPattern = null,
  requiredLabels = null,
  beginnerMode = false,
} = {}) {
  session.ingredientFile = ingredientFile;
  session.crossSectionFile = crossSectionFile;
  session.assetVer = assetVer;
  const count = cutCount ?? cutCountForIngredient(ingredientFile);
  session.marks = buildCutMarks(count, ingredientFile);
  session.requiredLabels = requiredLabels?.length === count
    ? requiredLabels.map((l) => normalizeCutLabel(l) || 'Tak')
    : buildRequiredLabels(count, targetPattern, { beginnerMode });
  session.cutDone = session.marks.map(() => false);
  session.markGrades = session.marks.map(() => null);
  session.actualCuts = [];
  session.cutMeta = [];
  session.hitErrors = [];
  session.voiceHold = null;
  session.hotGuideIndex = -1;
  session.lastHotAt = 0;
  session.passCount = 0;
  session.autoFinishPending = false;
  session.maxPasses = MAX_KNIFE_PASSES;
  session.knifeX = knifeStartX(session);
  session.moving = false;
  session.listening = false;
  session.finished = false;
  session.animating = false;
  session.lastPeakAt = 0;
  session.lastMissAt = 0;
  session.cutLockedUntil = 0;
  session.cutGateX = 0;
  session.pendingChop = null;
}

export function setListening(session, on) {
  const active = Boolean(on) && !session.finished && !session.animating;
  session.listening = active;
  session.moving = active;
}

export function setKnifeListening(_knifeEl, _on) {}

export function countTakInText(text) {
  if (!text) return 0;
  const compact = String(text).replace(/\s+/g, '');
  const lower = compact.toLowerCase();
  const ko = compact.match(/탁|딱|닥|턱|톡|탘/g);
  if (ko?.length) return ko.length;
  const en = lower.match(/tak+|tack+|tuk+|tok+|tag+/g);
  if (en?.length) return en.length;
  if (compact.length <= 3 && /^(타|따|다|턱)+!?$/.test(compact)) return 1;
  return 0;
}

export function detectTakBurst(freq, wave, wasAbove, sampleRate = 48000) {
  let peak = 0;
  for (let i = 0; i < wave.length; i++) peak = Math.max(peak, Math.abs(wave[i] - 128));
  const level = Math.min(100, (peak / 128) * 100);
  /* 짧게 터지는 「탁」류 — 임계값을 낮춰 더 잘 잡음 */
  const above = level >= 16;
  const onset = above && !wasAbove;
  if (!onset) return { hit: false, above, kind: 'none', level };
  const binHz = sampleRate / 2 / freq.length;
  let low = 0; let mid = 0; let high = 0; let total = 0;
  for (let i = 0; i < freq.length; i++) {
    const hz = i * binHz;
    const v = freq[i];
    total += v;
    if (hz < 400) low += v;
    else if (hz < 5500) mid += v;
    else high += v;
  }
  if (total < 3) return { hit: false, above, kind: 'quiet', level };
  const lowRatio = low / total;
  const midRatio = mid / total;
  const highRatio = high / total;
  /* 책상 쿵(저음)만 강하게 걸러냄 */
  if (lowRatio > 0.68) return { hit: false, above, kind: 'thump', level, midRatio };
  if (midRatio + highRatio >= 0.28 && midRatio >= 0.12 && level >= 12) {
    return { hit: true, above, kind: 'burst', level, midRatio };
  }
  return { hit: false, above, kind: 'noise', level, midRatio };
}

export function detectTak(freq, wave, wasAbove, sampleRate = 48000) {
  return detectTakBurst(freq, wave, wasAbove, sampleRate);
}

export function detectPeak(level, wasAbove) {
  const above = level >= 22;
  return { hit: above && !wasAbove, above };
}

function needCuts(session) {
  return session.marks.length;
}

export function nextRequiredLabel(session) {
  for (let i = 0; i < session.marks.length; i++) {
    if (!session.cutDone[i]) return session.requiredLabels?.[i] || 'Tak';
  }
  return null;
}

export function nextRequiredStyle(session) {
  const lab = nextRequiredLabel(session);
  return lab ? CUT_STYLE[lab] : CUT_STYLE.Tak;
}

export function advanceKnife(session, dtSec) {
  if (!session.moving || session.finished || session.animating) return;
  let speed = KNIFE_SPEED;
  /* 슥 홀드 중만 살짝 느리게 — 평소는 빠르게 */
  if (session.voiceHold) speed *= 0.55;
  session.knifeX = Math.min(1, session.knifeX + speed * dtSec);
  if (session.knifeX >= 1) {
    session.knifeX = 1;
    session.moving = false;
    session.voiceHold = null;
    if (session.actualCuts.length < needCuts(session)) {
      session.autoFinishPending = true;
      session.listening = false;
      session.onStatus?.(`${session.actualCuts.length}/${needCuts(session)} · 끝 — 점수 반영`);
    }
  }
}

/** 다음에 썰어야 할 가이드 (순서 고정) */
export function nextOpenMarkIndex(session) {
  for (let i = 0; i < session.marks.length; i++) {
    if (!session.cutDone[i]) return i;
  }
  return -1;
}

/** 칼이 지나가는 주황 가이드 = 다음 순서 가이드만 */
export function updateHotGuide(session) {
  const nextIdx = nextOpenMarkIndex(session);
  if (nextIdx < 0) {
    session.hotGuideIndex = -1;
    return -1;
  }
  const d = session.knifeX - session.marks[nextIdx];
  const hot = d >= -HOT_BEFORE && d <= HOT_AFTER ? nextIdx : -1;
  if (hot >= 0) session.lastHotAt = performance.now();
  session.hotGuideIndex = hot;
  return hot;
}

/**
 * 언제 자를지 보이게: next(다음) → soon(다가옴) → hot(지금!)
 * + 보드 아래 힌트 문구
 */
export function syncCutTimingUi(session, boardEl) {
  if (!session || !boardEl) return -1;
  const nextIdx = nextOpenMarkIndex(session);
  const hot = updateHotGuide(session);
  const guides = boardEl.querySelectorAll('.cut-guide');
  let soon = false;
  if (nextIdx >= 0 && hot < 0) {
    const d = session.knifeX - session.marks[nextIdx];
    soon = d >= -SOON_BEFORE && d < -HOT_BEFORE;
  }
  if (guides?.length) {
    guides.forEach((el, i) => {
      el.classList.toggle('done', Boolean(session.cutDone[i]));
      el.classList.toggle('hot', i === hot);
      el.classList.toggle('next', i === nextIdx && hot < 0 && !soon);
      el.classList.toggle('soon', i === nextIdx && soon);
    });
  }

  const hint = boardEl.querySelector('.cut-hint');
  if (hint) {
    const need = nextRequiredLabel(session);
    const ko = need ? (CUT_LABEL_KO[need] || need) : '';
    const n = session.actualCuts.length;
    const total = needCuts(session);
    const hold = need === 'Ssuk' ? '~' : '';
    if (!ko) {
      hint.innerHTML = `완료 · ${n}/${total}`;
    } else if (hot >= 0) {
      hint.innerHTML = `<span class="cut-hint-now">지금 「<b>${ko}${hold}</b>」!</span> · ${n}/${total}`;
    } else if (soon) {
      hint.innerHTML = `<span class="cut-hint-soon">곧 「<b>${ko}${hold}</b>」</span> · 칼이 선에 오면 · ${n}/${total}`;
    } else {
      hint.innerHTML = `다음 「<b>${ko}${hold}</b>」 · 주황 선에서 말해요 · ${n}/${total}`;
    }
  }
  return hot;
}

/** 순서대로 + 칼이 그 점선 근처 (TM 지연 크게 허용) */
function resolveVoiceMark(session) {
  const now = performance.now();
  if (now < (session.cutLockedUntil || 0)) return { index: -1 };
  const nextIdx = nextOpenMarkIndex(session);
  if (nextIdx < 0) return { index: -1 };
  if (session.knifeX < (session.cutGateX || 0)) return { index: -1 };
  const d = session.knifeX - session.marks[nextIdx];
  const recentlyHot = now - (session.lastHotAt || 0) < TM_HOT_GRACE_MS;
  const lateGrace = recentlyHot ? 0.08 : 0.03;
  if (d < -HIT_WINDOW || d > HIT_WINDOW + ASR_GRACE + lateGrace) return { index: -1 };
  return { index: nextIdx };
}

/** 아직 점선 전이어도 / 방금 지났어도 예약 가능 */
function queueableMark(session) {
  const now = performance.now();
  if (now < (session.cutLockedUntil || 0)) return -1;
  const nextIdx = nextOpenMarkIndex(session);
  if (nextIdx < 0) return -1;
  if (session.knifeX < (session.cutGateX || 0)) return -1;
  const d = session.knifeX - session.marks[nextIdx];
  if (d >= -EARLY_QUEUE && d <= HIT_WINDOW + ASR_GRACE + 0.1) return nextIdx;
  if (now - (session.lastHotAt || 0) < TM_HOT_GRACE_MS) return nextIdx;
  return -1;
}

export function cutAccuracy(session) {
  const total = needCuts(session);
  const grades = session.markGrades || [];
  let score = 40;
  let filled = 0;
  for (let i = 0; i < total; i++) {
    const g = grades[i];
    if (!g) continue;
    filled += 1;
    if (g === 'perfect') score += 12;
    else if (g === 'good') score += 9;
    else if (g === 'wrong') score += 5;
    else if (g === 'early' || g === 'late') score += 3;
    else score += 2;
  }
  const misses = session.hitErrors?.length || 0;
  score -= misses * 3;
  if (filled >= total && grades.every((g) => g === 'perfect')) return 96;
  return Math.max(28, Math.min(94, Math.round(score)));
}

/** @returns {'perfect'|'good'|'wrong'|'early'|'late'} */
function judgeCut(session, markIndex, saidLabel) {
  const required = session.requiredLabels?.[markIndex] || 'Tak';
  const d = session.knifeX - session.marks[markIndex];
  const ad = Math.abs(d);
  const labelOk = saidLabel === required;
  let timing = 'late';
  if (ad <= 0.07) timing = 'perfect';
  else if (ad <= 0.14) timing = 'good';
  else if (d < 0) timing = 'early';
  else timing = 'late';

  if (!labelOk) return 'wrong';
  if (timing === 'perfect') return 'perfect';
  if (timing === 'good') return 'good';
  return timing;
}

export const JUDGE_KO = {
  perfect: 'PERFECT',
  good: 'GOOD',
  wrong: 'WRONG',
  early: 'EARLY',
  late: 'LATE',
};

function styleFor(label) {
  return CUT_STYLE[label] || CUT_STYLE.Tak;
}

function playChopAnim(knifeEl, label = 'Tak') {
  if (!knifeEl) return;
  const st = styleFor(label);
  knifeEl.classList.remove('chopping', 'chopping-tak', 'chopping-ssuk', 'chopping-ssak', 'chopping-chap');
  void knifeEl.offsetWidth;
  knifeEl.classList.add('chopping', st.knife);

  const arena = knifeEl.closest('.cut-arena') || knifeEl.parentElement;
  if (arena) {
    arena.querySelectorAll('.chop-fx').forEach((el) => el.remove());
    const fx = document.createElement('div');
    fx.className = `chop-fx ${st.fx}`;
    fx.style.left = knifeEl.style.getPropertyValue('--knife-t') || '50%';
    arena.appendChild(fx);
    const clear = () => fx.remove();
    fx.addEventListener('animationend', clear, { once: true });
    setTimeout(clear, 520);
  }
  knifeEl.addEventListener('animationend', () => {
    knifeEl.classList.remove('chopping', st.knife);
  }, { once: true });
}

function flashGuideMiss(boardEl, index) {
  const el = boardEl?.querySelectorAll('.cut-guide')?.[index];
  if (!el) return;
  el.classList.remove('miss');
  void el.offsetWidth;
  el.classList.add('miss');
  setTimeout(() => el.classList.remove('miss'), 420);
}

function syncHoldUi(boardEl, session) {
  if (!boardEl) return;
  const guides = boardEl.querySelectorAll('.cut-guide');
  guides.forEach((el, i) => {
    const hold = session.voiceHold?.markIndex === i ? session.voiceHold : null;
    el.classList.toggle('is-holding', Boolean(hold));
    const ring = el.querySelector('.cut-hold-ring');
    if (ring) {
      if (hold) {
        const st = styleFor(hold.label);
        const pct = Math.min(1, (performance.now() - hold.startedAt) / st.holdMs);
        ring.style.setProperty('--hold-p', String(pct));
      } else {
        ring.style.setProperty('--hold-p', '0');
      }
    }
  });
}

function clearVoiceHold(session, boardEl) {
  session.voiceHold = null;
  syncHoldUi(boardEl, session);
}

function showJudgeFx(boardEl, knifeX, grade, saidKo) {
  const arena = boardEl?.querySelector('.cut-arena--fixed') || boardEl?.querySelector('.cut-arena');
  if (!arena) return;
  arena.querySelectorAll('.cut-judge').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = `cut-judge cut-judge--${grade}`;
  el.style.left = `${(knifeX ?? 0.5) * 100}%`;
  const title = JUDGE_KO[grade] || grade;
  el.innerHTML = saidKo ? `<b>${title}</b><span>${saidKo}</span>` : `<b>${title}</b>`;
  arena.appendChild(el);
  const clear = () => el.remove();
  el.addEventListener('animationend', clear, { once: true });
  setTimeout(clear, 900);
}

function executeCut(session, index, label, { knifeEl, boardEl, grade = 'good', saidLabel = null } = {}) {
  if (session._execCut) return session.actualCuts.length >= needCuts(session) ? 'complete' : 'locked';
  session._execCut = true;
  try {
  session.lastPeakAt = performance.now();
  session.voiceHold = null;
  session.pendingChop = null;
  session.lastHotAt = 0;
  const cutX = session.knifeX;
  const judged = grade || 'good';
  session.actualCuts.push(cutX);
  session.actualCuts.sort((a, b) => a - b);
  session.cutMeta.push({ x: cutX, label, markIndex: index, grade: judged, said: saidLabel });
  session.cutMeta.sort((a, b) => a.x - b.x);
  session.cutDone[index] = true;
  if (!session.markGrades) session.markGrades = session.marks.map(() => null);
  session.markGrades[index] = judged;
  if (judged === 'wrong' || judged === 'early' || judged === 'late') {
    session.hitErrors.push(judged === 'wrong' ? 0.25 : 0.4);
  }
  session.hotGuideIndex = -1;
  const nextMark = session.marks[index + 1];
  const gap = nextMark != null ? (nextMark - session.marks[index]) * 0.28 : CUT_ADVANCE_MIN;
  session.cutGateX = Math.max(cutX + 0.025, session.marks[index] + Math.max(0.04, gap));
  session.cutLockedUntil = performance.now() + POST_CUT_LOCK_MS;

  if (knifeEl) {
    knifeEl.style.setProperty('--knife-t', `${cutX * 100}%`);
  }
  playChopAnim(knifeEl, label);
  const hitTarget = boardEl?.querySelector('.whole-tomato, .live-slices, .cut-slices-layer');
  if (hitTarget) {
    hitTarget.classList.remove('is-hit');
    void hitTarget.offsetWidth;
    hitTarget.classList.add('is-hit');
  }

  const saidKo = saidLabel ? styleFor(saidLabel).ko : null;
  showJudgeFx(boardEl, cutX, judged, saidKo);

  const n = session.actualCuts.length;
  const total = needCuts(session);
  const next = nextRequiredLabel(session);
  const nextSt = next ? styleFor(next) : null;
  const judgeTxt = JUDGE_KO[judged] || judged;
  session.onStatus?.(
    nextSt
      ? `${judgeTxt} · ${n}/${total} · 다음 「${nextSt.ko}」${nextSt.holdMs ? '~' : ''}`
      : `${judgeTxt} · ${n}/${total}`,
  );

  if (boardEl) {
    patchCutBoard(boardEl, session, { justCut: true, cutLabel: label });
    if (knifeEl) syncKnifeEl(knifeEl, session);
  }
  syncHoldUi(boardEl, session);
  if (n >= total) return 'complete';
  return judged;
  } finally {
    session._execCut = false;
  }
}

/**
 * 리듬게임형 — 발음하면 자르고, 판정(PERFECT/GOOD/WRONG/EARLY/LATE)만 UI로.
 * (칼이 아주 멀리 있을 때만 컷 보류)
 */
export function feedCutVoice(session, label, ctx = {}) {
  if (!session.listening || session.finished || session.animating || session.autoFinishPending) return 'idle';
  const now = performance.now();
  if (session._voiceBusy) return 'locked';
  if (now < (session.cutLockedUntil || 0)) return 'locked';

  const got = normalizeCutLabel(label);
  if (!got) return 'unknown';

  if (session.actualCuts.length >= needCuts(session)) return 'complete';

  const index = nextOpenMarkIndex(session);
  if (index < 0) return 'complete';

  const d = session.knifeX - session.marks[index];
  // 칼이 아직 한참 앞일 때만 보류
  if (d < -EARLY_QUEUE - 0.2) {
    flashGuideMiss(ctx.boardEl, index);
    session.onStatus?.('칼이 조금 더 온 뒤!');
    return 'miss-advance';
  }

  session._voiceBusy = true;
  try {
    clearVoiceHold(session, ctx.boardEl);
    const grade = judgeCut(session, index, got);
    return executeCut(session, index, got, {
      ...ctx,
      grade,
      saidLabel: got,
    });
  } finally {
    session._voiceBusy = false;
  }
}

/** 예약 컷 비활성 — 연타 방지 */
export function tickPendingChop() {
  return null;
}

/** 홀드 UI만 — 컷은 applyTakHit 경유만 (직접 executeCut 금지) */
export function tickCutVoiceHold(session, micLevel, ctx = {}) {
  const hold = session.voiceHold;
  if (!hold) return;
  const now = performance.now();
  const st = styleFor(hold.label);
  if (now - hold.lastAt > HOLD_GAP_MS && micLevel < 10) {
    clearVoiceHold(session, ctx.boardEl);
    session.onStatus?.(`「${st.ko}~」 끊김 — 다시`);
    return;
  }
  if (micLevel >= 12) hold.lastAt = now;
  syncHoldUi(ctx.boardEl, session);
  /* 리듬형: 홀드 완료로 자동 컷하지 않음 — 음성 1회=컷 1회만 */
}

export function tryChopOnTak(session, ctx = {}) {
  const label = ctx.label || 'Tak';
  return feedCutVoice(session, label, ctx);
}

export function syncKnifeEl(knifeEl, session) {
  if (!knifeEl || !session) return;
  knifeEl.style.setProperty('--knife-t', `${session.knifeX * 100}%`);
  const need = nextRequiredLabel(session);
  if (need) knifeEl.dataset.cutMode = need;
}

export function attachKnifeToTomato(boardEl, knifeEl, t = 0) {
  if (!boardEl || !knifeEl) return;
  const arena = boardEl.querySelector('.cut-arena--fixed') || boardEl.querySelector('.cut-arena');
  if (!arena) return;
  arena.appendChild(knifeEl);
  knifeEl.hidden = false;
  knifeEl.classList.add('knife-hand--on-tomato');
  knifeEl.classList.remove('chopping', 'chopping-tak', 'chopping-ssuk', 'chopping-ssak', 'chopping-chap');
  knifeEl.style.setProperty('--knife-t', `${Math.max(0, Math.min(1, t)) * 100}%`);
}

function labelAtCut(session, cutX) {
  const m = session.cutMeta?.find((c) => Math.abs(c.x - cutX) < 0.001);
  return m?.label || 'Tak';
}

function guidesHtml(session) {
  return session.marks.map((x, i) => {
    const done = session.cutDone[i];
    const grade = session.markGrades?.[i];
    const gradeCls = done && grade ? `done done-${grade}` : (done ? 'done' : '');
    const lab = session.requiredLabels?.[i] || 'Tak';
    const st = styleFor(lab);
    const holdHint = st.holdMs ? '~' : '';
    const gradeBadge = done && grade && grade !== 'perfect' && grade !== 'good'
      ? `<span class="cut-guide-grade">${JUDGE_KO[grade] || ''}</span>`
      : '';
    return `<i class="cut-guide ${st.guide} ${gradeCls}" style="left:${x * 100}%" data-label="${lab}" data-grade="${grade || ''}">
      <span class="cut-guide-syl">${st.ko}${holdHint}</span>
      ${gradeBadge}
      ${st.holdMs && !done ? '<span class="cut-hold-ring"></span>' : ''}
    </i>`;
  }).join('');
}

function buildSlicePartsInPlace(session, { fresh = false } = {}) {
  const ver = session.assetVer || '1';
  const src = `./src/assets/재료/${session.ingredientFile}?${ver}`;
  const cross = session.crossSectionFile
    ? `./src/assets/재료/${session.crossSectionFile}?${ver}`
    : null;
  const { w: boxW, h: boxH } = cutLayoutFor(session);
  const wide = isWideCut(session, boxW, boxH);
  const cuts = [...session.actualCuts].sort((a, b) => a - b);
  const points = cuts.length ? [0, ...cuts, 1] : [0, 1];
  const parts = [];
  const lastCut = cuts.length ? cuts[cuts.length - 1] : null;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const leftPct = start * 100;
    const widthPct = Math.max(1.2, (end - start) * 100);
    const cutLabel = i > 0 ? labelAtCut(session, points[i]) : null;
    const st = cutLabel ? styleFor(cutLabel) : null;
    const sliceCls = st ? st.slice : '';
    const isFresh = fresh && lastCut != null && Math.abs(end - lastCut) < 0.001;
    const edgeHtml = cross && cutLabel && i > 0
      ? `<span class="slice-edge ${st.slice}-edge" style="background-image:url('${cross}')"></span>`
      : '';
    if (wide) {
      const bg = segmentBgStyle(session, start, boxW, boxH, src);
      parts.push(`
      <div class="burst-clip burst-clip--bg ${sliceCls}${isFresh ? ' is-fresh' : ''}${i < points.length - 2 ? ' has-seam' : ''}" style="left:${leftPct}%;width:${widthPct}%;height:100%;${bg}">
        ${edgeHtml}
      </div>
    `);
    } else {
      const imgStyle = segmentImgStyle(session, start, boxW, boxH, st);
      parts.push(`
      <div class="burst-clip ${sliceCls}${isFresh ? ' is-fresh' : ''}${i < points.length - 2 ? ' has-seam' : ''}" style="left:${leftPct}%;width:${widthPct}%;height:100%">
        <img src="${src}" alt="" style="${imgStyle}" draggable="false" />
        ${edgeHtml}
      </div>
    `);
    }
  }
  return { parts: parts.join(''), boxW, boxH };
}

function buildSliceParts(session, { spreadScale = 6, gapPx = 10, fresh = false } = {}) {
  const ver = session.assetVer || '1';
  const src = `./src/assets/재료/${session.ingredientFile}?${ver}`;
  const cross = session.crossSectionFile
    ? `./src/assets/재료/${session.crossSectionFile}?${ver}`
    : null;
  const { w: boxW, h: boxH } = cutLayoutFor(session);
  const cuts = [...session.actualCuts].sort((a, b) => a - b);
  const points = [0, ...cuts, 1];
  let cursor = 0;
  const parts = [];
  const lastCut = cuts.length ? cuts[cuts.length - 1] : null;
  const isWide = boxW > boxH * 1.15;
  const gap = isWide ? Math.min(gapPx, 5) : gapPx;
  const spreadMul = isWide ? 0.3 : 1;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const w = Math.max(2, boxW * (end - start));
    const spread = (i - (points.length - 2) / 2) * spreadScale * spreadMul;
    const cutLabel = i > 0 ? labelAtCut(session, points[i]) : null;
    const st = cutLabel ? styleFor(cutLabel) : null;
    const isFresh = fresh && lastCut != null && Math.abs(end - lastCut) < 0.001;
    const sliceCls = st ? st.slice : '';
    const imgStyle = segmentImgStyle(session, start, boxW, boxH, st);
    const edgeHtml = cross && cutLabel && i > 0
      ? `<span class="slice-edge ${st.slice}-edge" style="background-image:url('${cross}')"></span>`
      : '';
    parts.push(`
      <div class="burst-clip ${sliceCls}${isFresh ? ' is-fresh' : ''}" style="left:${cursor}px;width:${w}px;height:${boxH}px;--spread:${spread}px">
        <img src="${src}" alt="" style="${imgStyle}" draggable="false" />
        ${edgeHtml}
      </div>
    `);
    cursor += w + (i < points.length - 2 ? gap : 0);
  }
  return { parts: parts.join(''), width: cursor, size: boxH, boxW, boxH };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function finishSplit(session, { knifeEl, boardEl } = {}) {
  if (session.finished) return;
  session.animating = true;
  session.moving = false;
  session.listening = false;
  session.voiceHold = null;
  if (knifeEl) {
    const scene = boardEl?.closest('.counter-scene');
    if (scene) scene.appendChild(knifeEl);
    knifeEl.classList.remove('knife-hand--on-tomato', 'chopping', 'chopping-tak', 'chopping-ssuk', 'chopping-ssak', 'chopping-chap');
    knifeEl.hidden = true;
  }
  session.finished = true;
  if (boardEl) {
    patchCutBoard(boardEl, session);
    const guidesEl = boardEl.querySelector('.cut-guides--arena');
    if (guidesEl) guidesEl.innerHTML = '';
    boardEl.classList.add('is-burst');
  }
  await wait(550);
  session.animating = false;
  session.onComplete?.(cutAccuracy(session));
}

export async function completeAfterVoice(session, ctx) {
  await finishSplit(session, ctx);
}

export async function playCannedCut(session, { knifeEl, boardEl, onProgress } = {}) {
  if (session.finished || session.animating) return null;
  session.animating = true;
  session.moving = false;
  session.listening = false;
  for (let i = 0; i < session.marks.length; i++) {
    if (session.cutDone[i]) continue;
    const lab = session.requiredLabels[i] || 'Tak';
    session.knifeX = session.marks[i];
    syncKnifeEl(knifeEl, session);
    executeCut(session, i, lab, { knifeEl, boardEl });
    onProgress?.(session);
    await wait(styleFor(lab).holdMs ? 180 : 120);
  }
  await finishSplit(session, { knifeEl, boardEl });
  return true;
}

function cutHintText(session) {
  const need = nextRequiredLabel(session);
  const ko = need ? (CUT_LABEL_KO[need] || need) : '';
  const hold = need === 'Ssuk' ? '~' : '';
  const n = session.actualCuts.length;
  const total = needCuts(session);
  if (!ko) return `완료 · ${n}/${total}`;
  return `다음 「${ko}${hold}」 · 주황 선에서 말해요 · ${n}/${total}`;
}

function ensureCutStage(root, session) {
  const { w: boxW, h: boxH } = cutLayoutFor(session);
  let stage = root.querySelector('.cut-stage--ready');
  if (!stage) {
    root.innerHTML = `
      <div class="cut-stage cut-stage--ready" style="--cut-w:${boxW}px;--cut-h:${boxH}px;width:${boxW}px;margin:0 auto">
        <div class="cut-arena cut-arena--fixed" style="width:${boxW}px;height:${boxH}px">
          <div class="cut-slices-layer"></div>
          <div class="cut-guides cut-guides--flush cut-guides--arena"></div>
        </div>
        <p class="cut-hint"></p>
      </div>`;
    stage = root.querySelector('.cut-stage--ready');
  } else {
    stage.style.setProperty('--cut-w', `${boxW}px`);
    stage.style.setProperty('--cut-h', `${boxH}px`);
    stage.style.width = `${boxW}px`;
    const arena = stage.querySelector('.cut-arena');
    if (arena) {
      arena.style.width = `${boxW}px`;
      arena.style.height = `${boxH}px`;
    }
  }
  return stage;
}

function patchCutBoard(root, session, opts = {}) {
  if (!root || !session.ingredientFile) return;
  root.hidden = false;
  root.classList.remove('is-burst');
  ensureCutStage(root, session);
  const { parts } = buildSlicePartsInPlace(session, opts);
  const layer = root.querySelector('.cut-slices-layer');
  const guidesEl = root.querySelector('.cut-guides--arena');
  const hint = root.querySelector('.cut-hint');
  if (layer) layer.innerHTML = parts;
  if (guidesEl) guidesEl.innerHTML = guidesHtml(session);
  if (hint) hint.innerHTML = cutHintText(session).replace(/「([^」]+)」/, '「<b>$1</b>」');
}

export function renderLiveTomato(root, session, opts = {}) {
  patchCutBoard(root, session, opts);
}

export function renderCutBoard(root, session) {
  if (!root) return;
  if (!session.ingredientFile) { root.innerHTML = ''; root.hidden = true; return; }
  if (session.finished) { renderSplitBoard(root, session); return; }
  renderLiveTomato(root, session);
}

export function renderSplitBoard(root, session) {
  if (!root) return;
  patchCutBoard(root, session);
  const guidesEl = root.querySelector('.cut-guides--arena');
  if (guidesEl) guidesEl.innerHTML = '';
  root.classList.add('is-burst');
}

export function forceFinishCuts(session, ctx) {
  return playCannedCut(session, ctx);
}

export function applyVoiceChop() { return false; }
export function registerPeak() { return false; }
