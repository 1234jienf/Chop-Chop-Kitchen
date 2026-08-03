/**
 * 굽기 불 조절: 후우~ 지속음으로 게이지 상승, 방치 시 하락
 * 0~33 약불 / 34~66 중불 / 67~100 강불
 */

export const HEAT_START = 50;
export const HEAT_DECAY_PER_SEC = 16;
export const HEAT_GAIN_PER_SEC = 42;
export const BLOW_THRESHOLD = 18; // volume %

const FIRE_SRC = {
  low: './src/assets/불/약불.png',
  mid: './src/assets/불/중불.png',
  high: './src/assets/불/강불.png',
};

export function createRoastHeat() {
  return {
    heat: HEAT_START,
    band: 'mid',
    blowing: false,
    active: false,
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

export function bandLabel(band) {
  return band === 'high' ? '강불' : band === 'low' ? '약불' : '중불';
}

/**
 * @param {number} volumePercent 0~100
 * @param {number} dtSec
 */
export function tickRoastHeat(session, volumePercent, dtSec) {
  if (!session?.active) return session?.band || 'mid';
  const blowing = volumePercent >= BLOW_THRESHOLD;
  session.blowing = blowing;

  if (blowing) {
    const strength = Math.min(1, (volumePercent - BLOW_THRESHOLD) / 50);
    session.heat += HEAT_GAIN_PER_SEC * (0.35 + strength * 0.65) * dtSec;
  } else {
    session.heat -= HEAT_DECAY_PER_SEC * dtSec;
  }

  session.heat = Math.max(0, Math.min(100, session.heat));
  session.band = heatBand(session.heat);
  return session.band;
}

export function resetRoastHeat(session) {
  session.heat = HEAT_START;
  session.band = 'mid';
  session.blowing = false;
  session.active = true;
}

export function stopRoastHeat(session) {
  if (!session) return;
  session.active = false;
  session.blowing = false;
}
