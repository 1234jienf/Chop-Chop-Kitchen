/**
 * 굽기 화력: 후우~로 올리고, 안 불면 천천히 식음.
 * 목표 화력(약/중/강)이 시간에 따라 바뀌는 리듬 미니게임.
 */

export const HEAT_START = 50;
export const HEAT_DECAY_PER_SEC = 5.5;
export const HEAT_GAIN_PER_SEC = 22;
export const BLOW_THRESHOLD = 16;

/** 목표 밴드 시퀀스: [band, durationSec] */
const TARGET_SCRIPT = [
  ['mid', 4.5],
  ['low', 4.0],
  ['high', 5.0],
  ['mid', 3.5],
  ['high', 4.0],
  ['low', 3.5],
  ['mid', 4.0],
];

const BAND_CENTER = { low: 17, mid: 50, high: 83 };
const BAND_HALF = 14; // 타깃 창 반폭 (0~100)

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
    targetMin: BAND_CENTER.mid - BAND_HALF,
    targetMax: BAND_CENTER.mid + BAND_HALF,
    elapsed: 0,
    scriptIndex: 0,
    segmentLeft: TARGET_SCRIPT[0][1],
    matchTime: 0,
    totalInZoneTime: 0,
    needMatch: 10,
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

function applyTarget(session, band) {
  const c = BAND_CENTER[band] ?? 50;
  session.targetBand = band;
  session.targetMin = Math.max(0, c - BAND_HALF);
  session.targetMax = Math.min(100, c + BAND_HALF);
}

function advanceTarget(session, dtSec) {
  session.elapsed += dtSec;
  session.segmentLeft -= dtSec;
  while (session.segmentLeft <= 0) {
    session.scriptIndex = (session.scriptIndex + 1) % TARGET_SCRIPT.length;
    const [band, dur] = TARGET_SCRIPT[session.scriptIndex];
    session.segmentLeft += dur;
    applyTarget(session, band);
  }
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

  if (blowing) {
    const strength = Math.min(1, (volumePercent - BLOW_THRESHOLD) / 45);
    session.heat += HEAT_GAIN_PER_SEC * (0.4 + strength * 0.6) * dtSec;
  } else {
    session.heat -= HEAT_DECAY_PER_SEC * dtSec;
  }

  session.heat = Math.max(0, Math.min(100, session.heat));
  session.band = heatBand(session.heat);

  const inZone = session.heat >= session.targetMin && session.heat <= session.targetMax;
  if (inZone) {
    session.matchTime += dtSec;
    session.totalInZoneTime += dtSec;
  }
  else session.matchTime = Math.max(0, session.matchTime - dtSec * 0.35);

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
  session.totalInZoneTime = 0;
  session.needMatch = 10;
  session.blowing = false;
  session.done = false;
  session.debugLock = false;
  session.active = true;
  applyTarget(session, TARGET_SCRIPT[0][0]);
}

export function stopRoastHeat(session) {
  if (!session) return;
  session.active = false;
  session.blowing = false;
}

export function roastAccuracy(session) {
  if (!session) return 20;
  const stayRatio = Math.min(1, session.totalInZoneTime / Math.max(0.001, session.elapsed));
  return Math.round(20 + Math.min(1, stayRatio / 0.9) * 80);
}
