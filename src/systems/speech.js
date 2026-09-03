/**
 * meSpeak.js TTS wrapper — https://www.masswerk.at/mespeak/
 * Voice files live under /mespeak/ (public/). Speaks only when asked by game code.
 */

const VOICE_ID = 'en/en-us';

const SPEAK_OPTS = {
  amplitude: 100,
  pitch: 45,
  speed: 160,
  wordgap: 1,
  variant: 'm3',
};

/** @type {boolean} */
let voiceReady = false;
/** @type {boolean} */
let speaking = false;
/** @type {string[]} */
const queue = [];

function getMeSpeak() {
  return typeof window !== 'undefined' ? window.meSpeak : undefined;
}

/**
 * Load the US English voice. Safe to call once at startup.
 */
export function initSpeech() {
  const meSpeak = getMeSpeak();
  if (!meSpeak) {
    console.warn('[speech] meSpeak.js not loaded');
    return;
  }

  if (meSpeak.isVoiceLoaded?.(VOICE_ID)) {
    voiceReady = true;
    pumpQueue();
    return;
  }

  meSpeak.loadVoice(VOICE_ID, (success) => {
    if (!success) {
      console.warn('[speech] failed to load voice', VOICE_ID);
      return;
    }
    voiceReady = true;
    meSpeak.setDefaultVoice?.(VOICE_ID);
    pumpQueue();
  });
}

function pumpQueue() {
  const meSpeak = getMeSpeak();
  if (!meSpeak || !voiceReady || speaking) return;
  const text = queue.shift();
  if (!text) return;

  speaking = true;
  try {
    meSpeak.speak(text, SPEAK_OPTS, () => {
      speaking = false;
      pumpQueue();
    });
  } catch (err) {
    speaking = false;
    console.warn('[speech] speak failed', err);
    pumpQueue();
  }
}

/**
 * Speak arbitrary text once the voice is ready (queues so lines play in order).
 * @param {string} text
 */
export function speak(text) {
  if (!text) return;
  queue.push(text);
  pumpQueue();
}

/** Radio callout when a target is visually spotted. */
export function speakVisualContact(cell) {
  speak(`visual contact with target at ${cell.x}, ${cell.y}`);
}

/** Radio callout when a target kill is confirmed / paid. */
export function speakTargetNeutralized() {
  speak('target neutralized');
}

/** Radio callout on mission victory. */
export function speakMissionComplete() {
  speak('mission complete. request retrieval');
}

/** Radio callout when the player runs out of money. */
export function speakBudgetExhausted() {
  speak('budget exhausted');
}
