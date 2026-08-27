/**
 * The browser's `speechSynthesis`, used by the two places that fall back to it:
 * ChatWidget's read-aloud toggle for TYPED replies, and useVoiceSession's 'done'
 * handler when the server delivered no audio.
 *
 * This is the LESSER path, always. When Azure is configured and answering, the server
 * streams PCM plus phoneme-accurate viseme offsets and none of this runs. What lives
 * here only exists so a missing key degrades to something rather than nothing.
 *
 * It is one module rather than two copies because the two call sites had already
 * drifted: both spoke raw markdown with no voice assigned, and fixing one would have
 * left the other reading asterisks in whatever voice the OS picked.
 *
 * WHAT THIS CANNOT DO — read before adding to it. speechSynthesis exposes no audio
 * buffer and no routable node in any browser, so there is nothing here to attach an
 * AnalyserNode to and no clock to schedule against. Amplitude-driven mouth movement is
 * not merely unimplemented on this path, it is unavailable; the generic oscillation in
 * useVisemeDriver is the honest ceiling. Real lip-sync requires the Azure path.
 */

/**
 * Strips the light markdown Gemini emits, so the voice doesn't read punctuation aloud.
 *
 * A deliberate mirror of `VoiceHub.Speakable()` on the server — same four characters,
 * same omissions. Keep the two in step: if one gains a rule the other must, or the
 * spoken reply changes depending on which path happened to be live.
 *
 * NOTE WHAT IT KEEPS. `.` and `,` are not noise, they are the pause cues — every TTS
 * engine including this one reads them as prosody rather than speaking them. Stripping
 * terminal punctuation produces one long breathless run-on sentence, which sounds worse
 * than the asterisks did.
 *
 * Applies to the SPOKEN string only. The reply rendered in the chat transcript keeps its
 * markdown; these are two derivations of one source, not a replacement.
 */
export function speakableForLocalTts(text: string): string {
  let out = '';
  for (const c of text) {
    if (c === '*' || c === '_' || c === '`' || c === '#') continue;
    out += c;
  }
  return out.trim();
}

/**
 * Name fragments that tend to belong to a female voice, per platform.
 *
 * HEURISTIC, AND NOT A ROBUST ONE. The Web Speech API spec has no gender field —
 * `SpeechSynthesisVoice` exposes only `name`, `lang`, `localService` and `default`, so
 * matching the name is genuinely all there is. The set differs per OS (Windows ships
 * Zira/Hazel, macOS Samantha/Karen, Android its own), versions change it, and a user
 * with custom voices installed can defeat it entirely.
 *
 * This is why it is a *preference* and not a filter: `pickLocalVoice` falls through to
 * any en-* voice and then to the platform default rather than returning nothing. A voice
 * of the wrong gender is a worse outcome than the Azure path, which is the point — the
 * fix for that is a Speech key, not a longer list here.
 */
const FEMALE_NAME_HINTS = [
  // Windows (SAPI / OneCore)
  'zira', 'hazel', 'susan', 'linda', 'heera', 'catherine',
  // macOS / iOS
  'samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'allison', 'ava', 'susan',
  // Chrome OS / Android / Google voices
  'female', 'google uk english female', 'google us english',
];

/** Cached across calls: enumerating and scoring on every utterance is wasted work. */
let cachedVoices: SpeechSynthesisVoice[] | null = null;

/**
 * The voice list, once it exists.
 *
 * `getVoices()` returns an empty array on the first call in Chrome — the list populates
 * asynchronously and announces itself with `voiceschanged`. Calling it once at module
 * load (the obvious implementation) therefore yields nothing and silently leaves every
 * utterance on the OS default, which is the exact bug this module exists to fix.
 *
 * Resolves with an empty array if the event never fires, so a browser that populates
 * synchronously and one that never populates both terminate.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (cachedVoices && cachedVoices.length > 0) return Promise.resolve(cachedVoices);

  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) {
    cachedVoices = immediate;
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      cachedVoices = window.speechSynthesis.getVoices();
      resolve(cachedVoices);
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    // Safety net: some environments never fire the event at all, and a promise that
    // never settles would mean a reply that is never spoken.
    window.setTimeout(finish, 1000);
  });
}

/**
 * Picks the closest available match to the assistant's persona, in descending order of
 * preference:
 *
 *   1. en-PH — the locale the assistant actually speaks, matching Azure's RosaNeural.
 *      Rarely installed outside the Philippines.
 *   2. any en-* whose name matches FEMALE_NAME_HINTS — see the caveat on that constant.
 *   3. any en-* at all, so at least the accent is English.
 *   4. null, meaning "leave utterance.voice unset and let the platform decide".
 *
 * Returns null rather than throwing when speech synthesis is unavailable; callers set
 * `utterance.voice` only when this returns something.
 */
export async function pickLocalVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

  const voices = await loadVoices();
  if (voices.length === 0) return null;

  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  if (english.length === 0) return null;

  const philippine = english.find((v) => v.lang?.toLowerCase().replace('_', '-') === 'en-ph');
  if (philippine) return philippine;

  const female = english.find((v) => {
    const name = v.name.toLowerCase();
    return FEMALE_NAME_HINTS.some((hint) => name.includes(hint));
  });
  if (female) return female;

  return english[0];
}

/**
 * Builds an utterance with the sanitized text and the best available voice already
 * applied. Callers still attach their own `onstart`/`onend`/`onerror` and call
 * `speak()` — the two call sites do different things with those events (one drives the
 * avatar's talking loop, the other guards against the mic transcribing our own voice),
 * so this stops short of owning playback.
 *
 * Async because voice selection is: see loadVoices. The delay is one event tick on the
 * first call and nothing afterwards.
 */
export async function buildLocalUtterance(text: string): Promise<SpeechSynthesisUtterance> {
  const utterance = new SpeechSynthesisUtterance(speakableForLocalTts(text));
  utterance.lang = 'en-PH';

  const voice = await pickLocalVoice();
  if (voice) {
    utterance.voice = voice;
    // Keep lang consistent with the voice actually chosen. Leaving it at en-PH while the
    // voice is en-GB makes some engines re-resolve and discard the selection.
    utterance.lang = voice.lang;
  }

  return utterance;
}
