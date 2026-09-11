import { useEffect, useState } from 'react';
import type { VisemeCue, VoiceState } from '../hooks/useVoiceSession';

/**
 * Whether the assistant is currently using the speakers or the microphone.
 *
 * WHY THIS LIVES OUTSIDE ChatWidget. Both flags below started as module-level
 * state inside ChatWidget, because the two halves that needed them sat in
 * different subtrees: the utterance is created inside ChatPanel, and the standing
 * avatar that lip-syncs to it is a sibling of the panel, not a descendant.
 *
 * They moved here when a third consumer appeared that has nothing to do with the
 * chat at all — AmbientAudio, which has to duck the background music while the
 * assistant is talking or listening. Importing a hook from ChatWidget would have
 * pulled SignalR, three.js and the whole VRM avatar into the module graph of a
 * component that plays one <audio> element. The publishers are still ChatWidget;
 * only the wiring is shared.
 */

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/* ── Is the browser reading a reply aloud right now? ────────────────────
 *
 * Event-driven off the utterance rather than polling `speechSynthesis.speaking`, so
 * consumers start and stop on the same tick the audio does.
 */
const ttsListeners = new Set<(speaking: boolean) => void>();
let ttsSpeaking = false;

export function setTtsSpeaking(next: boolean) {
  if (next === ttsSpeaking) return;
  ttsSpeaking = next;
  for (const listener of ttsListeners) listener(next);
}

/** Cancels any in-progress speech AND clears the flag. */
export function stopSpeaking() {
  if (!ttsSupported) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  // Set explicitly: cancel() firing `end` on the current utterance is inconsistent
  // across browsers, and a stuck `true` would leave the avatar talking to itself
  // and the background music ducked with nothing to un-duck it.
  setTtsSpeaking(false);
}

export function useTtsSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(ttsSpeaking);
  useEffect(() => {
    ttsListeners.add(setSpeaking);
    setSpeaking(ttsSpeaking);
    return () => { ttsListeners.delete(setSpeaking); };
  }, []);
  return speaking;
}

/* ── Live voice session, shared with the standing avatar ────────────────
 *
 * This carries the real thing, not a boolean — the viseme cue stream and the audio
 * clock — so during a voice call the mouth is driven by actual phoneme timings instead
 * of the generic open/closed oscillation used for browser read-aloud.
 *
 * `visemesRef` is a useRef and `getPlaybackMs` a useCallback, so publishing them costs
 * one notification; only `state` changes with any frequency.
 */
export interface VoicePresence {
  state: VoiceState;
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs: () => number | null;
}

const voiceListeners = new Set<(p: VoicePresence | null) => void>();
let voicePresence: VoicePresence | null = null;

export function setVoicePresence(next: VoicePresence | null) {
  voicePresence = next;
  for (const listener of voiceListeners) listener(next);
}

/** Null whenever no voice call is live — consumers then fall back to the TTS flag. */
export function useVoicePresence(): VoicePresence | null {
  const [presence, setPresence] = useState(voicePresence);
  useEffect(() => {
    voiceListeners.add(setPresence);
    setPresence(voicePresence);
    return () => { voiceListeners.delete(setPresence); };
  }, []);
  return presence;
}

/**
 * True whenever the assistant owns the audio channel — either half of it.
 *
 * Two conditions, not three, and deliberately coarser than "is she speaking right
 * now":
 *
 *  - A live call (`presence !== null`) counts for its WHOLE duration, not just its
 *    `speaking` and `listening` moments. A turn runs listening → thinking →
 *    speaking, and ducking per-state would pop the music back up for the second or
 *    two of `thinking` in the middle of every exchange. It also keeps the music off
 *    the microphone: the loop plays through the same speakers the mic is hearing,
 *    and feeding it back into speech recognition costs transcription accuracy.
 *  - Browser read-aloud (`ttsSpeaking`) covers the other path, where someone types
 *    to the assistant and has the reply spoken without ever opening a call.
 */
export function useAssistantHasAudio(): boolean {
  const presence = useVoicePresence();
  const speaking = useTtsSpeaking();
  return presence !== null || speaking;
}
