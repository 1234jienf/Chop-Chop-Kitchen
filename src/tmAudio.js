/**
 * Teachable Machine Audio — 썰기 = Tak/Ssuk/Ssak/Chap 음성만.
 *
 * 로그에서 본 문제:
 * - threshold 6%면 침묵에도 Tak13/Chap18 같은 잡음 스파이크가 HIT
 * - 그 가짜 HIT 후 쿨다운 → 진짜 말은 쿨다운/게이트에 막힘
 *
 * 지금 원칙 (침묵 오발동 차단 + 실제 말은 잡기):
 * - 컷 라벨 점수가 충분히 높을 것 (>= 32~35%)
 * - 2등 컷 라벨보다 확실히 이길 것 (마진)
 * - 강한 스파이크는 1프레임 HIT, 아니면 짧은 후보 확정
 * - 샘플레이트 44100 유지
 */

const MODEL_URL = new URL('./tm-audio/', import.meta.url).href;
const BG = '배경 소음';
const CUT_LABELS = ['Tak', 'Ssuk', 'Ssak', 'Chap'];
const CUT_SET = new Set(CUT_LABELS);
const CUT_COOLDOWN_MS = 420;
const OTHER_COOLDOWN_MS = { Huu: 320, Ting: 400 };
const TARGET_SAMPLE_RATE = 44100;

let recognizer = null;
let listening = false;
let loadPromise = null;
let onLabel = null;
let onDebug = null;
let preferCutLabel = null;
let cutThreshold = 0.35;
const lastFire = Object.create(null);
let lastDebugAt = 0;
let pendingLabel = null;
let pendingCount = 0;
let audioContextPatched = false;
let OriginalAudioContext = null;

function asArray(scores) {
  if (!scores) return [];
  if (Array.isArray(scores)) {
    if (scores.length === 1 && scores[0] && typeof scores[0].length === 'number') {
      return Array.from(scores[0]);
    }
    return Array.from(scores);
  }
  if (typeof scores.length === 'number') return Array.from(scores);
  return [];
}

function scoreMap(scores, labels) {
  const arr = asArray(scores);
  const map = Object.create(null);
  for (let i = 0; i < labels.length; i++) map[labels[i]] = Number(arr[i]) || 0;
  return map;
}

function isBackgroundLabel(label) {
  return !label
    || label === BG
    || label === '_background_noise_'
    || /배경|background|noise/i.test(label);
}

function patchAudioContextSampleRate(hz) {
  if (audioContextPatched) return;
  OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (!OriginalAudioContext) return;
  function PatchedAudioContext(options) {
    const opts = Object.assign({}, options || {}, { sampleRate: hz });
    return new OriginalAudioContext(opts);
  }
  PatchedAudioContext.prototype = OriginalAudioContext.prototype;
  window.AudioContext = PatchedAudioContext;
  if ('webkitAudioContext' in window) window.webkitAudioContext = PatchedAudioContext;
  audioContextPatched = true;
}

function restoreAudioContext() {
  if (!audioContextPatched || !OriginalAudioContext) return;
  window.AudioContext = OriginalAudioContext;
  if ('webkitAudioContext' in window) window.webkitAudioContext = OriginalAudioContext;
  audioContextPatched = false;
}

/** 컷 라벨 중 1·2등 — prefer는 거의 동점일 때만 살짝 보정 */
function topTwoCuts(map, prefer) {
  const ranked = CUT_LABELS
    .map((label) => ({ label, score: map[label] || 0 }))
    .sort((a, b) => b.score - a.score);

  let first = ranked[0];
  let second = ranked[1] || { label: null, score: 0 };

  if (prefer && CUT_SET.has(prefer)) {
    const prefScore = map[prefer] || 0;
    // 약한 prefer로 억지 승격 금지
    if (prefScore >= Math.max(cutThreshold, 0.36) && prefScore >= first.score - 0.04) {
      second = first.label === prefer ? second : first;
      first = { label: prefer, score: prefScore };
    }
  }
  return { first, second };
}

function emitDebug(map, bgScore, note) {
  const now = performance.now();
  if (now - lastDebugAt < 90 && !note) return;
  lastDebugAt = now;
  const line = 'Tak' + Math.round((map.Tak || 0) * 100)
    + ' Ssuk' + Math.round((map.Ssuk || 0) * 100)
    + ' Ssak' + Math.round((map.Ssak || 0) * 100)
    + ' Chap' + Math.round((map.Chap || 0) * 100)
    + ' | 배경' + Math.round(bgScore * 100)
    + (note ? ' · ' + note : '');
  console.log('[TM]', line);
  if (onDebug) onDebug({ text: line, map: map, bgScore: bgScore, note: note || null });
}

export function tmReady() {
  return Boolean(recognizer);
}

export async function preloadTmAudio() {
  if (recognizer) return recognizer;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!window.speechCommands) throw new Error('speechCommands CDN not loaded');
    const rec = window.speechCommands.create(
      'BROWSER_FFT',
      undefined,
      MODEL_URL + 'model.json',
      MODEL_URL + 'metadata.json'
    );
    await rec.ensureModelLoaded();
    recognizer = rec;
    console.log('[TM] model ready', rec.wordLabels());
    return rec;
  })();
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    console.error('[TM] model load failed', err);
    throw err;
  }
}

export async function startTmListen(handler, opts) {
  opts = opts || {};
  const probabilityThreshold = opts.probabilityThreshold == null ? 0.35 : opts.probabilityThreshold;
  const overlapFactor = opts.overlapFactor == null ? 0.85 : opts.overlapFactor;
  onLabel = handler;
  onDebug = opts.onDebug || null;
  preferCutLabel = opts.preferCutLabel || null;
  cutThreshold = probabilityThreshold;
  await preloadTmAudio();

  if (listening) {
    console.log('[TM] listen already on — handler updated');
    return true;
  }

  for (const key of Object.keys(lastFire)) delete lastFire[key];
  pendingLabel = null;
  pendingCount = 0;
  lastDebugAt = 0;

  const labels = recognizer.wordLabels();
  const bgIndex = labels.findIndex((l) => isBackgroundLabel(l));
  console.log('[TM] labels', labels, 'bgIndex', bgIndex, 'threshold', cutThreshold);

  patchAudioContextSampleRate(TARGET_SAMPLE_RATE);
  try {
    await recognizer.listen(
      (result) => {
        if (!onLabel) return;
        const map = scoreMap(result.scores, labels);
        const bgScore = bgIndex >= 0 ? (map[labels[bgIndex]] || 0) : 0;
        const prefer = typeof preferCutLabel === 'function' ? preferCutLabel() : null;
        const now = performance.now();

        // 전체 라벨 1등이 배경/기타면 컷 금지 (이상한 소리 오탐의
        let overallLabel = labels[0];
        let overallScore = map[overallLabel] || 0;
        for (let i = 1; i < labels.length; i++) {
          const s = map[labels[i]] || 0;
          if (s > overallScore) {
            overallScore = s;
            overallLabel = labels[i];
          }
        }
        if (!CUT_SET.has(overallLabel)) {
          pendingLabel = null;
          pendingCount = 0;
          emitDebug(map, bgScore, null);
          return;
        }

        const { first, second } = topTwoCuts(map, prefer);
        const margin = first.score - second.score;
        // 배경을 확실히 이겨야 함
        const vsBg = first.score >= bgScore + 0.12 && bgScore < 0.55;
        const strong = vsBg && first.score >= 0.48 && margin >= 0.12;
        const ok = vsBg && first.score >= cutThreshold && margin >= 0.10;

        const fireCut = (label, score) => {
          if (now - (lastFire._cut || 0) < CUT_COOLDOWN_MS) {
            emitDebug(map, bgScore, '쿨다운');
            return;
          }
          const accepted = onLabel({
            label,
            score,
            index: labels.indexOf(label),
          });
          if (accepted === false) {
            emitDebug(map, bgScore, '무시 ' + label + Math.round(score * 100) + '(게이트)');
            pendingLabel = null;
            pendingCount = 0;
            return;
          }
          lastFire._cut = now;
          lastFire[label] = now;
          lastFire._any = now;
          pendingLabel = null;
          pendingCount = 0;
          emitDebug(map, bgScore, 'HIT ' + label + ' ' + Math.round(score * 100) + '%');
        };

        if (strong) {
          fireCut(first.label, first.score);
          return;
        }

        if (!ok) {
          // 약한 후보 확정 경로 제거 — 오탐의
          pendingLabel = null;
          pendingCount = 0;
          emitDebug(map, bgScore, null);
        } else {
          if (pendingLabel === first.label) pendingCount += 1;
          else {
            pendingLabel = first.label;
            pendingCount = 1;
            lastFire._pendAt = now;
          }
          emitDebug(
            map,
            bgScore,
            pendingCount < 3 ? ('후보 ' + first.label + Math.round(first.score * 100)) : null,
          );
          // 3프레임 연속이어야 HIT
          if (pendingCount >= 3) {
            fireCut(first.label, first.score);
            return;
          }
        }

        // Huu / Ting
        let topLabel = labels[0];
        let topScore = map[topLabel] || 0;
        for (let i = 1; i < labels.length; i++) {
          const s = map[labels[i]] || 0;
          if (s > topScore) {
            topScore = s;
            topLabel = labels[i];
          }
        }
        if (!isBackgroundLabel(topLabel) && !CUT_SET.has(topLabel) && topScore >= 0.48 && topScore >= bgScore + 0.08) {
          const cd = OTHER_COOLDOWN_MS[topLabel] || 350;
          if (now - (lastFire[topLabel] || 0) >= cd && now - (lastFire._any || 0) >= 120) {
            const accepted = onLabel({ label: topLabel, score: topScore, index: labels.indexOf(topLabel) });
            if (accepted !== false) {
              lastFire[topLabel] = now;
              lastFire._any = now;
            }
          }
        }
      },
      {
        includeSpectrogram: false,
        probabilityThreshold: 0,
        invokeCallbackOnNoiseAndUnknown: true,
        overlapFactor: Math.min(Math.max(overlapFactor, 0), 0.9),
        suppressionTimeMillis: 300,
        audioTrackConstraints: {
          sampleRate: TARGET_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      }
    );
  } finally {
    restoreAudioContext();
  }

  listening = true;
  console.log('[TM] listening started @', TARGET_SAMPLE_RATE);
  return true;
}

export async function stopTmListen() {
  onLabel = null;
  onDebug = null;
  preferCutLabel = null;
  pendingLabel = null;
  pendingCount = 0;
  if (!recognizer || !listening) {
    listening = false;
    return;
  }
  try {
    await recognizer.stopListening();
  } catch (e) {}
  listening = false;
  console.log('[TM] listening stopped');
}
