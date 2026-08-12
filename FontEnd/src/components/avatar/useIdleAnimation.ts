import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, MathUtils } from 'three';
import type { Object3D } from 'three';
import type { MorphRig } from './morphRig';
import type { VoiceState } from '../../hooks/useVoiceSession';

export interface AvatarBones {
  head: Object3D | null;
  neck: Object3D | null;
  spine: Object3D | null;
  leftEye: Object3D | null;
  rightEye: Object3D | null;
}

interface Args {
  rig: MorphRig | null;
  bones: AvatarBones;
  state: VoiceState;
}

const BLINK_MIN_MS = 2200;
const BLINK_MAX_MS = 6000;
const BLINK_CLOSE_MS = 70;
const BLINK_OPEN_MS = 130;

const nextBlinkDelay = () => BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);

/**
 * Everything that keeps the avatar from reading as a frozen model between replies.
 *
 * All procedural rather than baked clips: the export ships no animations, and blink plus
 * breath plus gaze already clears the "is this thing broken?" bar without the retargeting
 * risk of importing an external skeleton's motion. Body clips can layer on top later.
 */
export function useIdleAnimation({ rig, bones, state }: Args) {
  const pointer = useThree((s) => s.pointer);

  const clock = useRef(0);
  const blinkAt = useRef(nextBlinkDelay());
  const blinkElapsed = useRef<number | null>(null);
  const baseRotations = useRef<Map<Object3D, Euler>>(new Map());
  const gaze = useRef({ x: 0, y: 0 });
  const aversion = useRef({ x: 0, y: 0, until: 0 });

  const basisFor = (bone: Object3D) => {
    let base = baseRotations.current.get(bone);
    if (!base) {
      base = bone.rotation.clone();
      baseRotations.current.set(bone, base);
    }
    return base;
  };

  useFrame((_, delta) => {
    const deltaMs = Math.min(delta * 1000, 100);
    clock.current += deltaMs;
    const t = clock.current / 1000;

    /* ── Blink ──────────────────────────────────────────────────────────
       The cheapest signal of life by a wide margin: a face that never blinks
       reads as dead within about four seconds. */
    if (rig) {
      if (blinkElapsed.current === null && clock.current >= blinkAt.current) {
        blinkElapsed.current = 0;
      }

      let lid = 0;
      if (blinkElapsed.current !== null) {
        blinkElapsed.current += deltaMs;
        const e = blinkElapsed.current;
        if (e <= BLINK_CLOSE_MS) {
          lid = e / BLINK_CLOSE_MS;
        } else if (e <= BLINK_CLOSE_MS + BLINK_OPEN_MS) {
          lid = 1 - (e - BLINK_CLOSE_MS) / BLINK_OPEN_MS;
        } else {
          lid = 0;
          blinkElapsed.current = null;
          blinkAt.current = clock.current + nextBlinkDelay();
        }
      }

      rig.set('eyeBlinkLeft', lid);
      rig.set('eyeBlinkRight', lid);

      /* ── Expression per conversational state ──────────────────────── */
      const listening = state === 'listening' ? 1 : 0;
      const thinking = state === 'thinking' ? 1 : 0;

      rig.set('browInnerUp', MathUtils.lerp(rig.get('browInnerUp'), listening * 0.22 + thinking * 0.1, 0.08));
      rig.set('eyeWideLeft', MathUtils.lerp(rig.get('eyeWideLeft'), listening * 0.12, 0.08));
      rig.set('eyeWideRight', MathUtils.lerp(rig.get('eyeWideRight'), listening * 0.12, 0.08));
      // A gentle resting smile while idle, dropped while speaking so it doesn't fight the visemes.
      const smile = state === 'idle' || state === 'listening' ? 0.12 : 0;
      rig.set('mouthSmileLeft', MathUtils.lerp(rig.get('mouthSmileLeft'), smile, 0.05));
      rig.set('mouthSmileRight', MathUtils.lerp(rig.get('mouthSmileRight'), smile, 0.05));
    }

    /* ── Gaze ───────────────────────────────────────────────────────────
       Tracks the cursor, except while thinking. People look away to think, and
       unbroken eye contact during a pause is the specific thing that makes a
       virtual character feel like it has stopped responding. */
    if (state === 'thinking') {
      if (clock.current > aversion.current.until) {
        aversion.current = {
          x: (Math.random() - 0.5) * 0.5,
          y: 0.18 + Math.random() * 0.16,
          until: clock.current + 700 + Math.random() * 900,
        };
      }
    } else {
      aversion.current.until = 0;
    }

    const targetX = state === 'thinking' ? aversion.current.x : MathUtils.clamp(pointer.x, -1, 1) * 0.32;
    const targetY = state === 'thinking' ? aversion.current.y : MathUtils.clamp(-pointer.y, -1, 1) * 0.20;

    gaze.current.x = MathUtils.lerp(gaze.current.x, targetX, 0.06);
    gaze.current.y = MathUtils.lerp(gaze.current.y, targetY, 0.06);

    /* ── Head, neck, breath ─────────────────────────────────────────────
       Split across head and neck so the motion arcs instead of pivoting on one
       joint, and offset from each bone's authored rest pose rather than assigned
       absolutely — overwriting would erase the rig's own posture. */
    const sway = Math.sin(t * 0.55) * 0.022 + Math.sin(t * 0.23) * 0.014;
    const bob = Math.sin(t * 0.8) * 0.01;
    const speakingNod = state === 'speaking' ? Math.sin(t * 2.6) * 0.02 : 0;

    if (bones.head) {
      const base = basisFor(bones.head);
      bones.head.rotation.set(
        base.x + gaze.current.y * 0.6 + bob + speakingNod,
        base.y + gaze.current.x * 0.6 + sway,
        base.z + (state === 'listening' ? 0.05 : 0) + Math.sin(t * 0.37) * 0.012,
      );
    }

    if (bones.neck) {
      const base = basisFor(bones.neck);
      bones.neck.rotation.set(
        base.x + gaze.current.y * 0.25,
        base.y + gaze.current.x * 0.3,
        base.z,
      );
    }

    if (bones.spine) {
      const base = basisFor(bones.spine);
      // ~14 breaths/minute.
      bones.spine.rotation.set(base.x + Math.sin(t * 1.45) * 0.008, base.y, base.z);
    }

    // Eyes lead the head — they reach the target first, which is what makes gaze
    // look intentional rather than like the whole skull is being aimed.
    for (const eye of [bones.leftEye, bones.rightEye]) {
      if (!eye) continue;
      const base = basisFor(eye);
      eye.rotation.set(base.x + gaze.current.y * 0.5, base.y + gaze.current.x * 0.9, base.z);
    }
  });
}
