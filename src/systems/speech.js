/**
 * meSpeak.js TTS wrapper — https://www.masswerk.at/mespeak/
 * Voice files live under /mespeak/ (public/). Speaks only when asked by game code.
 */

const VOICE_ID = 'en/en-us';

/** @type {boolean} */
let voiceReady = false;
/** @type {string[]} */
const pending = [];

function getMeSpeak() {
  return typeof window !== 'undefined' ? window.meSpeak : undefined;
}

/**
 * Load the US English voice. Safe to call once at startup.
 * Queued utterances flush when the voice is ready.
 */
export function initSpeech() {
  const meSpeak = getMeSpeak();
  if (!meSpeak) {
    console.warn('[speech] meSpeak.js not loaded');
    return;
  }

  if (meSpeak.isVoiceLoaded?.(VOICE_ID)) {
    voiceReady = true;
    flushPending();
    return;
  }

  meSpeak.loadVoice(VOICE_ID, (success) => {
    if (!success) {
      console.warn('[speech] failed to load voice', VOICE_ID);
      return;
    }
    voiceReady = true;
    meSpeak.setDefaultVoice?.(VOICE_ID);
    flushPending();
  });
}

function flushPending() {
  const meSpeak = getMeSpeak();
  if (!meSpeak || !voiceReady) return;
  while (pending.length > 0) {
    const text = pending.shift();
    speakNow(text);
  }
}

function speakNow(text) {
  const meSpeak = getMeSpeak();
  if (!meSpeak) return;
  try {
    meSpeak.speak(text, {
      amplitude: 100,
      pitch: 45,
      speed: 160,
      wordgap: 1,
      variant: 'm3',
    });
  } catch (err) {
    console.warn('[speech] speak failed', err);
  }
}

/**
 * Speak arbitrary text once the voice is ready (queues if still loading).
 * @param {string} text
 */
export function speak(text) {
  if (!text) return;
  if (!voiceReady) {
    pending.push(text);
    return;
  }
  speakNow(text);
}

/**
 * Radio callout when a target is visually spotted.
 * @param {{ x: number, y: number }} cell
 */
export function speakVisualContact(cell) {
  speak(`target visual at ${cell.x}, ${cell.y}`);
}
