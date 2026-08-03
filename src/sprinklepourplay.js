/** 뿌리기·붓기 공정의 음정 게이지와 2초 유지 판정을 관리한다. */
const DEFAULT_TARGET_HZ = 220;
const DEFAULT_HOLD_SECONDS = 2;
const DEFAULT_REACH_SECONDS = 10;
// 노트북 내장 마이크의 작은 목소리도 받되, 잡음은 아래 신뢰도·지속시간으로 거른다.
const MIN_VOICE_RMS = 0.008;
const VOICE_CONFIRM_SECONDS = 0.15;
const MIN_PITCH_CONFIDENCE = 0.55;

export function isFinishStep(step) {
  return step?.action === 'putting' || step?.action === 'sprinkling';
}

export function createFinishSession() {
  return {
    targetHz: DEFAULT_TARGET_HZ,
    targetPitches: [DEFAULT_TARGET_HZ],
    targetNotes: ['라(A3)'],
    targetIndex: 0,
    toleranceCents: 90,
    holdSeconds: DEFAULT_HOLD_SECONDS,
    hold: 0,
    pitchHz: 0,
    rawPitchHz: 0,
    smoothedPitchHz: 0,
    cents: 0,
    confidence: 0,
    rms: 0,
    voicedFor: 0,
    active: false,
    complete: false,
    kind: 'liquid',
    grace: 0,
    pourVisualGrace: 0,
    isPouring: false,
    elapsed: 0,
    phaseElapsed: 0,
    reachSeconds: DEFAULT_REACH_SECONDS,
    reachedAt: null,
    phaseScores: [],
    targetAdvanced: false,
  };
}

export function resetFinishSession(session, step) {
  const targetPitches = step.targetPitches?.length ? step.targetPitches : [step.targetPitch || DEFAULT_TARGET_HZ];
  const targetNotes = step.targetNotes?.length ? step.targetNotes : [step.targetPattern || '라(A3)'];
  Object.assign(session, {
    targetHz: targetPitches[0],
    targetPitches,
    targetNotes,
    targetIndex: 0,
    toleranceCents: step.toleranceCents || 90,
    holdSeconds: step.holdSeconds || DEFAULT_HOLD_SECONDS,
    hold: 0,
    pitchHz: 0,
    rawPitchHz: 0,
    smoothedPitchHz: 0,
    cents: 0,
    confidence: 0,
    rms: 0,
    voicedFor: 0,
    active: true,
    complete: false,
    kind: step.sprinklePourKind || (step.action === 'sprinkling' ? 'powder' : 'liquid'),
    grace: 0,
    pourVisualGrace: 0,
    isPouring: false,
    elapsed: 0,
    phaseElapsed: 0,
    reachSeconds: step.reachSeconds || DEFAULT_REACH_SECONDS,
    reachedAt: null,
    phaseScores: [],
    targetAdvanced: false,
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
  if (rms < MIN_VOICE_RMS) return { frequency: 0, confidence: 0, rms };

  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.min(Math.floor(sampleRate / 80), values.length - 2);
  let bestLag = 0;
  let best = 0;
  const correlations = new Float32Array(maxLag + 1);
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
    correlations[lag] = normalized;
    if (normalized > best) {
      best = normalized;
      bestLag = lag;
    }
  }
  // 여러 주기가 같은 점수를 낼 때 가장 이른 뚜렷한 봉우리를 골라 1/2·1/3 배음 오검출을 줄인다.
  const peakThreshold = Math.max(0.5, best * 0.82);
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (correlations[lag] >= peakThreshold
      && correlations[lag] >= correlations[lag - 1]
      && correlations[lag] > correlations[lag + 1]) {
      bestLag = lag;
      best = correlations[lag];
      break;
    }
  }
  return bestLag && best > MIN_PITCH_CONFIDENCE
    ? { frequency: sampleRate / bestLag, confidence: best, rms }
    : { frequency: 0, confidence: best, rms };
}

export function tickFinish(session, pitch, dt) {
  if (!session.active || session.complete) return;
  session.targetAdvanced = false;
  session.elapsed += dt;
  session.phaseElapsed += dt;
  session.confidence = pitch.confidence || 0;
  session.rms = pitch.rms || 0;
  const hasVoice = session.rms >= MIN_VOICE_RMS;
  const hasReliablePitch = hasVoice && session.confidence >= MIN_PITCH_CONFIDENCE && pitch.frequency;
  session.rawPitchHz = hasReliablePitch ? pitch.frequency : 0;
  let normalizedPitchHz = session.rawPitchHz;
  // 같은 음의 다른 옥타브도 목표 근처로 정규화해 다양한 목소리 높이를 허용한다.
  while (normalizedPitchHz && normalizedPitchHz < session.targetHz * 0.7) normalizedPitchHz *= 2;
  while (normalizedPitchHz && normalizedPitchHz > session.targetHz * 1.4) normalizedPitchHz /= 2;
  if (normalizedPitchHz) {
    session.smoothedPitchHz = session.smoothedPitchHz
      ? session.smoothedPitchHz * 0.78 + normalizedPitchHz * 0.22
      : normalizedPitchHz;
  } else {
    session.smoothedPitchHz = 0;
  }
  session.pitchHz = session.smoothedPitchHz;
  session.cents = session.pitchHz ? 1200 * Math.log2(session.pitchHz / session.targetHz) : 0;
  const pitchMatches = hasReliablePitch && Math.abs(session.cents) <= session.toleranceCents;
  session.voicedFor = pitchMatches ? session.voicedFor + dt : 0;
  const inTune = pitchMatches && session.voicedFor >= VOICE_CONFIRM_SECONDS;

  if (inTune) {
    if (session.reachedAt == null) session.reachedAt = session.phaseElapsed;
    session.grace = 0.16;
    session.pourVisualGrace = 0.6;
    session.hold = Math.min(session.holdSeconds, session.hold + dt);
  } else if (session.grace > 0) {
    session.grace -= dt;
  } else {
    session.hold = Math.max(0, session.hold - dt * 0.65);
  }
  if (!hasVoice) {
    // 무음일 때는 잡음으로 소스가 계속 나가지 않도록 즉시 정지한다.
    session.pourVisualGrace = 0;
    session.grace = 0;
  } else if (!inTune) {
    session.pourVisualGrace = Math.max(0, session.pourVisualGrace - dt);
  }
  session.isPouring = hasVoice && (inTune || session.pourVisualGrace > 0);
  if (session.hold >= session.holdSeconds) {
    session.phaseScores.push(scoreForReachTime(session.reachedAt ?? session.phaseElapsed, session.reachSeconds));
    if (session.targetIndex < session.targetPitches.length - 1) {
      session.targetIndex += 1;
      session.targetHz = session.targetPitches[session.targetIndex];
      session.hold = 0;
      session.pitchHz = 0;
      session.rawPitchHz = 0;
      session.smoothedPitchHz = 0;
      session.rms = 0;
      session.voicedFor = 0;
      session.cents = 0;
      session.phaseElapsed = 0;
      session.reachedAt = null;
      session.grace = 0;
      session.pourVisualGrace = 0;
      session.isPouring = false;
      session.targetAdvanced = true;
    } else {
      session.complete = true;
    }
  }
}

/** 10초 안에는 100→60점, 제한시간 이후에는 59→30점으로 내려간다. */
function scoreForReachTime(reachedAt, reachSeconds) {
  if (reachedAt <= reachSeconds) return Math.round(100 - (reachedAt / reachSeconds) * 40);
  return Math.max(30, Math.round(60 - (reachedAt - reachSeconds) * 3));
}

export function finishAccuracy(session) {
  const scores = [...session.phaseScores];
  if (!session.complete) scores.push(scoreForReachTime(session.reachedAt ?? session.phaseElapsed, session.reachSeconds));
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length));
}

export function reachTimeLeft(session) {
  return Math.max(0, session.reachSeconds - session.phaseElapsed);
}

export function pitchPercent(session) {
  if (!session.pitchHz) return 50;
  return Math.max(4, Math.min(96, 50 + session.cents / 8));
}

export function holdPercent(session) {
  return Math.min(100, (session.hold / session.holdSeconds) * 100);
}
