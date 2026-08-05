/**
 * Teachable Machine Audio (speech-commands) wrapper.
 * Labels: Chap, Huu, Ssak, Ssuk, Tak, Ting, 배경 소음
 */

const MODEL_URL = new URL('./tm-audio/', import.meta.url).href;

const BG = '배경 소음';
const CUT_LABELS = new Set(['Tak', 'Chap', 'Ssuk', 'Ssak']);
const COOLDOWN_MS = {
  Tak: 480,
  Chap: 480,
  Ssuk: 480,
  Ssak: 480,
  Huu: 350,
  Ting: 450,
};

let recognizer = null;
let listening = false;
let loadPromise = null;
let onLabel = null;
const lastFire = Object.create(null);

function topPrediction(scores, labels) {
  let best = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[best]) best = i;
  }
  return { label: labels[best], score: scores[best], index: best };
}

/** 배경이 1등이어도, 썰기 라벨 중 제일 높은 걸 고름 */
function bestCutPrediction(scores, labels, minScore) {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < labels.length; i++) {
    if (!CUT_LABELS.has(labels[i])) continue;
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      best = i;
    }
  }
  if (best < 0 || bestScore < minScore) return null;
  return { label: labels[best], score: bestScore, index: best };
}

export function tmReady() {
  return Boolean(recognizer);
}

export async function preloadTmAudio() {
  if (recognizer) return recognizer;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!window.speechCommands) {
      throw new Error('speechCommands CDN not loaded');
    }
    const rec = window.speechCommands.create(
      'BROWSER_FFT',
      undefined,
      `${MODEL_URL}model.json`,
      `${MODEL_URL}metadata.json`,
    );
    await rec.ensureModelLoaded();
    recognizer = rec;
    return rec;
  })();
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

/**
 * @param {(evt: { label: string, score: number }) => void} handler
 */
export async function startTmListen(handler, {
  probabilityThreshold = 0.22,
  overlapFactor = 0.85,
} = {}) {
  onLabel = handler;
  await preloadTmAudio();
  if (listening) return true;
  const labels = recognizer.wordLabels();
  const bgIndex = labels.findIndex((l) => l === BG || l === '_background_noise_');
  await recognizer.listen(
    (result) => {
      if (!onLabel) return;
      const scores = result.scores;
      const top = topPrediction(scores, labels);
      const bgScore = bgIndex >= 0 ? scores[bgIndex] : 0;

      // 썰기 라벨 우선 (배경 1등이어도 Tak 등이 충분하면 통과)
      let pick = bestCutPrediction(scores, labels, probabilityThreshold);
      if (!pick) {
        // Huu / Ting 등
        if (!top.label || top.label === BG || top.label === '_background_noise_') return;
        if (top.score < probabilityThreshold) return;
        if (bgScore > top.score) return;
        pick = top;
      } else if (bgScore > pick.score + 0.18 && pick.score < 0.4) {
        // 배경이 압도적이면만 무시
        return;
      }

      const now = performance.now();
      const isCut = CUT_LABELS.has(pick.label);
      const cd = COOLDOWN_MS[pick.label] ?? 280;
      if (now - (lastFire[pick.label] || 0) < cd) return;
      /* 탁/삭/찹이 한 발음에 여러 라벨로 연속 발사되는 것 차단 */
      if (isCut && now - (lastFire._cut || 0) < 650) return;
      if (now - (lastFire._any || 0) < 200) return;
      lastFire[pick.label] = now;
      lastFire._any = now;
      if (isCut) lastFire._cut = now;
      onLabel({ label: pick.label, score: pick.score, index: pick.index });
    },
    {
      includeSpectrogram: false,
      probabilityThreshold: 0.22,
      invokeCallbackOnNoiseAndUnknown: true,
      overlapFactor: Math.min(overlapFactor, 0.75),
    },
  );
  listening = true;
  return true;
}

export async function stopTmListen() {
  onLabel = null;
  if (!recognizer || !listening) {
    listening = false;
    return;
  }
  try {
    await recognizer.stopListening();
  } catch (_) {
    /* already stopped */
  }
  listening = false;
}
