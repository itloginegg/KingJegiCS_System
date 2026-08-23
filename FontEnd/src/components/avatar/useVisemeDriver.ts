import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MorphRig } from './morphRig';
import type { VisemeCue } from '../../hooks/useVoiceSession';
import {
  VISEME_TARGETS, VISEME_INTENSITY, VISEME_ATTACK_MS, VISEME_RELEASE_MS, VISEME_SILENCE,
  targetForVisemeId,
} from './visemeMap';
import type { VisemeTarget } from './visemeMap';

interface Args {
  rig: MorphRig | null;
  /** Cues for the reply currently playing, timestamped against the reply-wide audio clock. */
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  /** Milliseconds into that audio, or null when nothing is playing. */
  getPlaybackMs: () => number | null;
  /** True while the assistant is talking — drives the no-viseme fallback below. */
  speaking: boolean;
}

/**
 * Drives the mouth from the viseme stream the voice session collects.
 *
 * Runs every frame against the AudioContext clock rather than a wall clock or a chain of
 * setTimeouts: the audio is scheduled on that clock, so anything else drifts out of sync
 * the moment a chunk arrives late or the tab is throttled.
 */
export function useVisemeDriver({ rig, visemesRef, getPlaybackMs, speaking }: Args) {
  // Monotonic index into the cue array. Cues arrive in order and are consumed in order,
  // so this advances rather than searching — at 60fps a scan per frame is wasted work.
  const cursor = useRef(0);
  const lastCueCount = useRef(0);
  const activeTarget = useRef<VisemeTarget>(VISEME_SILENCE);
  const weights = useRef<Map<string, number>>(new Map());
  const fallbackPhase = useRef(0);

  useFrame((_, delta) => {
    if (!rig) return;

    const deltaMs = Math.min(delta * 1000, 100);   // clamp: a stalled tab shouldn't jump the mouth
    const cues = visemesRef.current;

    // A new turn clears the array (see useVoiceSession); rewind rather than run off the end.
    if (cues.length < lastCueCount.current) {
      cursor.current = 0;
      activeTarget.current = VISEME_SILENCE;
    }
    lastCueCount.current = cues.length;

    const playbackMs = getPlaybackMs();

    if (playbackMs !== null) {
      while (cursor.current < cues.length && cues[cursor.current].offsetMs <= playbackMs) {
        activeTarget.current = targetForVisemeId(cues[cursor.current].visemeId);
        cursor.current += 1;
      }
    } else {
      activeTarget.current = VISEME_SILENCE;
    }

    // No server TTS means no viseme data and no audio clock — the browser's speechSynthesis
    // exposes neither. Rather than leave the mouth frozen mid-reply, oscillate a generic
    // open/closed shape. It is visibly not real lip-sync; it just avoids a dead stare.
    const usingFallback = speaking && playbackMs === null && cues.length === 0;
    if (usingFallback) {
      fallbackPhase.current += deltaMs / 1000;
      const openness = 0.5 + 0.5 * Math.sin(fallbackPhase.current * 9);
      for (const name of VISEME_TARGETS) rig.set(name, 0);
      rig.set('aa', openness * 0.45);
      return;
    }

    fallbackPhase.current = 0;

    for (const name of VISEME_TARGETS) {
      const goal = name === activeTarget.current ? VISEME_INTENSITY[name] : 0;
      const previous = weights.current.get(name) ?? 0;

      // Exponential ease toward the goal. Framed as a time constant rather than a fixed
      // step so the motion is identical at 30fps and 144fps. Closing is slower than
      // opening, which is how real articulation behaves.
      const tau = goal > previous ? VISEME_ATTACK_MS : VISEME_RELEASE_MS;
      const k = 1 - Math.exp(-deltaMs / tau);
      const next = previous + (goal - previous) * k;

      weights.current.set(name, next);
      rig.set(name, next);
    }

    /* The old jaw underlay is gone with the rig it belonged to. Avaturn shipped a
       separate `jawOpen` shape that opened the jaw independently of the lips, so the
       viseme shapes needed help selling an open mouth. VRM has no equivalent, and does
       not need one: `Fcl_MTH_A` behind the `aa` preset already opens the jaw as part of
       the shape. Layering `Fcl_MTH_Large` on top here would double the opening and
       over-articulate every vowel. */
  });
}
