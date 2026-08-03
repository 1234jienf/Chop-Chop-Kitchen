/** 뿌리기·붓기 공정의 음정 게이지와 3초 유지 판정을 관리한다. */
const DEFAULT_TARGET_HZ = 220;
const DEFAULT_HOLD_SECONDS = 3;
const DEFAULT_REACH_SECONDS = 10;

export function isFinishStep(step) {
  return step?.action === 'putting' || step?.action === 'sprinkling';
}

export function createFinishSession() {
  return {
    targetHz: DEFAULT_TARGET_HZ,
    toleranceCents: 90,
    holdSeconds: DEFAULT_HOLD_SECONDS,
    hold: 0,
    pitchHz: 0,
    cents: 0,
    confidence: 0,
    active: false,
    complete: false,
    kind: 'liquid',
    grace: 0,
    elapsed: 0,
    reachSeconds: DEFAULT_REACH_SECONDS,
    reachedAt: null,
  };
}

export function resetFinishSession(session, step) {
  Object.assign(session, {
    targetHz: step.targetPitch || DEFAULT_TARGET_HZ,
    toleranceCents: step.toleranceCents || 90,
    holdSeconds: step.holdSeconds || DEFAULT_HOLD_SECONDS,
    hold: 0,
    pitchHz: 0,
    cents: 0,
    confidence: 0,
    active: true,
    complete: false,
    kind: step.sprinklePourKind || (step.action === 'sprinkling' ? 'powder' : 'liquid'),
    grace: 0,
    elapsed: 0,
    reachSeconds: step.reachSeconds || DEFAULT_REACH_SECONDS,
    reachedAt: null,
  });
}

export function stopFinishSession(session) {
  session.active = false;
}

// 가벼운 autocorrelation 기반 기본 주파수 검출. 무성음/잡음은 confidence로 거른다.
export function detectPitch(samples, sampleRate) {
  if (!samples?.length) return { frequency: 0, confidence: 0 };
  const values = new Float32Array(samples.length);
  let mean = 0;
  for (let i = 0; i < samples.length; i++) mean += samples[i];
  mean /= samples.length;
  let rms = 0;
  for (let i = 0; i < samples.length; i++) {
    values[i] = (samples[i] - mean) / 128;
    rms += values[i] * values[i];
  }
  rms = Math.sqrt(rms / values.length);
  if (rms < 0.018) return { frequency: 0, confidence: 0 };

  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.min(Math.floor(sampleRate / 80), values.length - 2);
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let energyA = 0;
    let energyB = 0;
    const end = values.length - lag;
    for (let i = 0; i < end; i++) {
      corr += values[i] * values[i + lag];
      energyA += values[i] * values[i];
      energyB += values[i + lag] * values[i + lag];
    }
    const normalized = corr / Math.sqrt(energyA * energyB || 1);
    if (normalized > best) {
      best = normalized;
      bestLag = lag;
    }
  }
  return bestLag && best > 0.55
    ? { frequency: sampleRate / bestLag, confidence: best }
    : { frequency: 0, confidence: best };
}

export function tickFinish(session, pitch, dt) {
  if (!session.active || session.complete) return;
  session.elapsed += dt;
  session.pitchHz = pitch.frequency || 0;
  session.confidence = pitch.confidence || 0;
  session.cents = session.pitchHz ? 1200 * Math.log2(session.pitchHz / session.targetHz) : 0;
  const inTune = session.confidence >= 0.55 && Math.abs(session.cents) <= session.toleranceCents;

  if (inTune) {
    if (session.reachedAt == null) session.reachedAt = session.elapsed;
    session.grace = 0.16;
    session.hold = Math.min(session.holdSeconds, session.hold + dt);
  } else if (session.grace > 0) {
    session.grace -= dt;
  } else {
    session.hold = Math.max(0, session.hold - dt * 0.65);
  }
  session.complete = session.hold >= session.holdSeconds;
}

/** 10초 안에는 100→60점, 제한시간 이후에는 59→30점으로 내려간다. */
export function finishAccuracy(session) {
  const reachedAt = session.reachedAt ?? session.elapsed;
  if (reachedAt <= session.reachSeconds) {
    return Math.round(100 - (reachedAt / session.reachSeconds) * 40);
  }
  return Math.max(30, Math.round(60 - (reachedAt - session.reachSeconds) * 3));
}

export function reachTimeLeft(session) {
  return Math.max(0, session.reachSeconds - session.elapsed);
}

export function pitchPercent(session) {
  if (!session.pitchHz) return 50;
  return Math.max(4, Math.min(96, 50 + session.cents / 8));
}

export function holdPercent(session) {
  return Math.min(100, (session.hold / session.holdSeconds) * 100);
}
