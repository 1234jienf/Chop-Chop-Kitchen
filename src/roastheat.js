/**
 * 굽기 화력: 후우~로 올리고, 안 불면 식음.
 * 약 12초 세션 동안 목표 화력(약/중/강)을 맞춘 비율로 점수.
 */

export const HEAT_START = 50;
/** 안 불면 식음 (잡음에 안 올라가게 유지) */
export const HEAT_DECAY_PER_SEC = 12;
/** 후우~로 올리는 속도 */
export const HEAT_GAIN_PER_SEC = 28;
/** 후우~ 판정 */
export const BLOW_THRESHOLD = 24;

/** 세션 총 시간 (이 시간이 되면 무조건 종료·점수) */
export const ROAST_DURATION_SEC = 12;

/** 12초 안에 목표 화력이 바뀌는 리듬 */
const TARGET_SCRIPT = [
  ['mid', 4.5],
  ['high', 4],
  ['low', 3.5],
];

const BAND_CENTER = { low: 18, mid: 50, high: 82 };
/** 목표 구간 넓혀서 맞추기 쉽게 */
const BAND_HALF = 22;
const TARGET_WARN_SEC = 1.6;
const TARGET_BLEND_SEC = 1.4;

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
    duration: ROAST_DURATION_SEC,
    scriptIndex: 0,
    segmentLeft: TARGET_SCRIPT[0][1],
    /** UI 진행 바: 세션 진행률과 동기 */
    matchTime: 0,
    needMatch: ROAST_DURATION_SEC,
    peakToastProgress: 0,
    totalInZoneTime: 0,
    blowing: false,
    active: false,
    done: false,
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
  const nextIdx = session.scriptIndex + 1;
  if (nextIdx >= TARGET_SCRIPT.length) return null;
  return TARGET_SCRIPT[nextIdx][0];
}

function advanceTarget(session, dtSec) {
  session.segmentLeft -= dtSec;
  session.nextTargetBand = session.segmentLeft <= TARGET_WARN_SEC ? peekNextBand(session) : null;

  while (session.segmentLeft <= 0 && session.scriptIndex < TARGET_SCRIPT.length - 1) {
    session.scriptIndex += 1;
    const [band, dur] = TARGET_SCRIPT[session.scriptIndex];
    session.segmentLeft += dur;
    applyTarget(session, band, { blend: true });
    session.nextTargetBand = null;
  }
  if (session.scriptIndex >= TARGET_SCRIPT.length - 1 && session.segmentLeft < 0) {
    session.segmentLeft = 0;
    session.nextTargetBand = null;
  }
  tickTargetBlend(session, dtSec);
}

export function roastTimeLeft(session) {
  if (!session) return 0;
  return Math.max(0, (session.duration || ROAST_DURATION_SEC) - (session.elapsed || 0));
}

export function roastTargetHint(session) {
  if (!session?.active) return '';
  const left = Math.max(1, Math.ceil(roastTimeLeft(session)));
  if (session.nextTargetBand) {
    return `곧 ${bandLabel(session.nextTargetBand)} · 남은 ${left}초`;
  }
  return `남은 ${left}초`;
}

/**
 * @param {number} volumePercent 0~100
 * @param {number} dtSec
 */
export function tickRoastHeat(session, volumePercent, dtSec) {
  if (!session?.active || session.done) return session?.band || 'mid';

  session.elapsed += dtSec;
  advanceTarget(session, dtSec);

  const blowing = volumePercent >= BLOW_THRESHOLD;
  session.blowing = blowing;
  const targetCenter = BAND_CENTER[session.targetBand] ?? 50;
  const overheated = session.heat > targetCenter + BAND_HALF + 6;

  if (blowing) {
    const strength = Math.min(1, (volumePercent - BLOW_THRESHOLD) / 45);
    session.heat += HEAT_GAIN_PER_SEC * (0.4 + strength * 0.5) * dtSec;
  } else {
    // 안 불면 빠르게 식혀 약불로
    let decay = HEAT_DECAY_PER_SEC;
    if (overheated) decay *= 1.8;
    else if (session.heat > targetCenter) decay *= 1.35;
    session.heat -= decay * dtSec;
  }

  session.heat = Math.max(0, Math.min(100, session.heat));
  session.band = heatBand(session.heat);

  // 목표 밴드와 현재 불이 같으면(또는 게이지 구간 안이면) 맞춤 시간 가산
  const inZone = session.heat >= session.targetMin && session.heat <= session.targetMax;
  const bandMatch = session.band === session.targetBand;
  if (inZone || bandMatch) {
    session.totalInZoneTime += dtSec;
  }

  const duration = session.duration || ROAST_DURATION_SEC;
  session.matchTime = Math.min(duration, session.elapsed);
  session.needMatch = duration;
  const progress = session.elapsed / Math.max(0.001, duration);
  session.peakToastProgress = Math.max(session.peakToastProgress || 0, Math.min(1, progress));

  if (session.elapsed >= duration) {
    session.done = true;
    session.elapsed = duration;
    session.matchTime = duration;
  }

  return session.band;
}

export function resetRoastHeat(session) {
  session.heat = HEAT_START;
  session.band = 'mid';
  session.scriptIndex = 0;
  session.segmentLeft = TARGET_SCRIPT[0][1];
  session.elapsed = 0;
  session.duration = ROAST_DURATION_SEC;
  session.matchTime = 0;
  session.needMatch = ROAST_DURATION_SEC;
  session.peakToastProgress = 0;
  session.totalInZoneTime = 0;
  session.nextTargetBand = null;
  session.blendT = 1;
  session.blowing = false;
  session.done = false;
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

/** 목표 화력에 맞춘 비율 → 20~100점 */
export function roastAccuracy(session) {
  if (!session) return 20;
  const duration = Math.max(0.001, session.duration || ROAST_DURATION_SEC);
  const elapsed = Math.max(0.001, Math.min(duration, session.elapsed || duration));
  const stayRatio = Math.min(1, (session.totalInZoneTime || 0) / elapsed);
  // 75%만 맞춰도 만점권
  return Math.round(20 + Math.min(1, stayRatio / 0.75) * 80);
}
