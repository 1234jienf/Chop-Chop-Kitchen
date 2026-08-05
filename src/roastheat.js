/**
 * 굽기 화력: 후우~로 올리고, 안 불면 천천히 식음.
 * 목표 화력(약/중/강)이 시간에 따라 바뀌는 리듬 미니게임.
 */

export const HEAT_START = 50;
export const HEAT_DECAY_PER_SEC = 5.5;
export const HEAT_GAIN_PER_SEC = 22;
export const BLOW_THRESHOLD = 16;

/** 목표 밴드 시퀀스: 인접 단계만, 여유 시간 길게 */
const TARGET_SCRIPT = [
  ['mid', 9],
  ['high', 11],
  ['mid', 10],
  ['low', 11],
  ['mid', 9],
  ['high', 12],
];

const BAND_CENTER = { low: 17, mid: 50, high: 83 };
const BAND_HALF = 16;
const TARGET_WARN_SEC = 3.5;
const TARGET_BLEND_SEC = 2.2;

const FIRE_SRC = {
  low: './src/assets/불/약불.png',
  mid: './src/assets/불/중불.png',
  high: './src/assets/불/강불.png',
};

/** 끓이기: 약불→잔잔 / 중불→보글 / 강불→격렬 (파일: 물·물1·물2) */
const POT_WATER_SRC = {
  low: './src/assets/도구/냄비_물.png',
  mid: './src/assets/도구/냄비_물1.png',
  high: './src/assets/도구/냄비_물2.png',
};

export function createRoastHeat() {
  return {
    heat: HEAT_START,
    band: 'mid',
    targetBand: 'mid',
    nextTargetBand: null,
    targetMin: BAND_CENTER.mid - BAND_HALF,
    targetMax: BAND_CENTER.mid + BAND_HALF,
    blendFromMin: BAND_CENTER.mid - BAND_HALF,
    blendFromMax: BAND_CENTER.mid + BAND_HALF,
    blendToMin: BAND_CENTER.mid - BAND_HALF,
    blendToMax: BAND_CENTER.mid + BAND_HALF,
    blendT: 1,
    elapsed: 0,
    scriptIndex: 0,
    segmentLeft: TARGET_SCRIPT[0][1],
    matchTime: 0,
    needMatch: 14,
    peakToastProgress: 0,
    blowing: false,
    active: false,
    done: false,
    debugLock: false,
  };
}

export function heatBand(heat) {
  if (heat < 34) return 'low';
  if (heat < 67) return 'mid';
  return 'high';
}

export function fireSrcFor(band, assetVer = '1') {
  return `${FIRE_SRC[band] || FIRE_SRC.mid}?${assetVer}`;
}

export function potWaterSrcFor(band, assetVer = '1') {
  return `${POT_WATER_SRC[band] || POT_WATER_SRC.mid}?${assetVer}`;
}

export function bandLabel(band) {
  return band === 'high' ? '강불' : band === 'low' ? '약불' : '중불';
}

function applyTarget(session, band, { blend = true } = {}) {
  const c = BAND_CENTER[band] ?? 50;
  const newMin = Math.max(0, c - BAND_HALF);
  const newMax = Math.min(100, c + BAND_HALF);
  if (blend && session.targetBand && session.targetBand !== band) {
    session.blendFromMin = session.targetMin;
    session.blendFromMax = session.targetMax;
    session.blendToMin = newMin;
    session.blendToMax = newMax;
    session.blendT = 0;
  } else {
    session.blendT = 1;
    session.targetMin = newMin;
    session.targetMax = newMax;
  }
  session.targetBand = band;
}

function tickTargetBlend(session, dtSec) {
  if (session.blendT >= 1) return;
  session.blendT = Math.min(1, session.blendT + dtSec / TARGET_BLEND_SEC);
  const t = session.blendT * session.blendT * (3 - 2 * session.blendT);
  session.targetMin = session.blendFromMin + (session.blendToMin - session.blendFromMin) * t;
  session.targetMax = session.blendFromMax + (session.blendToMax - session.blendFromMax) * t;
}

function peekNextBand(session) {
  const nextIdx = (session.scriptIndex + 1) % TARGET_SCRIPT.length;
  return TARGET_SCRIPT[nextIdx][0];
}

function advanceTarget(session, dtSec) {
  session.elapsed += dtSec;
  session.segmentLeft -= dtSec;
  session.nextTargetBand = session.segmentLeft <= TARGET_WARN_SEC ? peekNextBand(session) : null;

  while (session.segmentLeft <= 0) {
    session.scriptIndex = (session.scriptIndex + 1) % TARGET_SCRIPT.length;
    const [band, dur] = TARGET_SCRIPT[session.scriptIndex];
    session.segmentLeft += dur;
    applyTarget(session, band, { blend: true });
    session.nextTargetBand = null;
  }
  tickTargetBlend(session, dtSec);
}

export function roastTargetHint(session) {
  if (!session?.active) return '';
  if (session.nextTargetBand) {
    return `곧 ${bandLabel(session.nextTargetBand)} · ${Math.max(1, Math.ceil(session.segmentLeft))}초`;
  }
  return `${Math.max(1, Math.ceil(session.segmentLeft))}초`;
}

/**
 * @param {number} volumePercent 0~100
 * @param {number} dtSec
 */
export function tickRoastHeat(session, volumePercent, dtSec) {
  if (!session?.active || session.done) return session?.band || 'mid';

  if (session.debugLock) {
    session.blowing = volumePercent >= BLOW_THRESHOLD;
    return session.band;
  }

  advanceTarget(session, dtSec);

  const blowing = volumePercent >= BLOW_THRESHOLD;
  session.blowing = blowing;
  const targetCenter = BAND_CENTER[session.targetBand] ?? 50;
  const overheated = session.heat > targetCenter + BAND_HALF + 6;

  if (blowing) {
    const strength = Math.min(1, (volumePercent - BLOW_THRESHOLD) / 45);
    session.heat += HEAT_GAIN_PER_SEC * (0.35 + strength * 0.55) * dtSec;
  } else {
    let decay = HEAT_DECAY_PER_SEC;
    if (overheated) decay *= 2.2;
    else if (session.heat > targetCenter) decay *= 1.45;
    session.heat -= decay * dtSec;
  }

  session.heat = Math.max(0, Math.min(100, session.heat));
  session.band = heatBand(session.heat);

  const inZone = session.heat >= session.targetMin && session.heat <= session.targetMax;
  if (inZone) session.matchTime += dtSec;
  else session.matchTime = Math.max(0, session.matchTime - dtSec * 0.12);

  const progress = session.matchTime / Math.max(1, session.needMatch);
  session.peakToastProgress = Math.max(session.peakToastProgress || 0, progress);

  if (session.matchTime >= session.needMatch) {
    session.done = true;
  }

  return session.band;
}

export function resetRoastHeat(session) {
  session.heat = HEAT_START;
  session.band = 'mid';
  session.scriptIndex = 0;
  session.segmentLeft = TARGET_SCRIPT[0][1];
  session.elapsed = 0;
  session.matchTime = 0;
  session.needMatch = 14;
  session.peakToastProgress = 0;
  session.nextTargetBand = null;
  session.blendT = 1;
  session.blowing = false;
  session.done = false;
  session.debugLock = false;
  session.active = true;
  applyTarget(session, TARGET_SCRIPT[0][0], { blend: false });
}

export function roastToastStage(session) {
  const p = session?.peakToastProgress ?? 0;
  if (p >= 0.78) return 3;
  if (p >= 0.52) return 2;
  if (p >= 0.26) return 1;
  return 0;
}

export function stopRoastHeat(session) {
  if (!session) return;
  session.active = false;
  session.blowing = false;
}

export function roastAccuracy(session) {
  if (!session) return 70;
  const ratio = Math.min(1, session.matchTime / Math.max(1, session.needMatch));
  return Math.round(55 + ratio * 40);
}
