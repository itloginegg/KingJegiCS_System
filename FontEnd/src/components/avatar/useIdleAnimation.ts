import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, MathUtils, Quaternion } from 'three';
import type { Object3D } from 'three';
import type { MorphRig } from './morphRig';
import type { VoiceState } from '../../hooks/useVoiceSession';

/**
 * An eye bone plus the two orientations it is measured against, both snapshotted from
 * the BIND pose before any clip plays.
 *
 * Two are needed, not one. `restLocal` is the anatomical zero — how far the eye has
 * turned in its socket is measured from this. `restWorld` is where the eye pointed in
 * the world when the rig was bound, and that is the aim held on to while the head moves
 * underneath it.
 */
export interface EyeRest {
  bone: Object3D;
  restLocal: Quaternion;
  restWorld: Quaternion;
}

export interface AvatarBones {
  head: Object3D | null;
  neck: Object3D | null;
  spine: Object3D | null;
  leftEye: Object3D | null;
  rightEye: Object3D | null;
  /** Eye bones with their bind-pose orientations. Absent means gaze is skipped. */
  eyes?: EyeRest[];
}

interface Args {
  rig: MorphRig | null;
  bones: AvatarBones;
  state: VoiceState;
  /**
   * Names of bones an AnimationMixer is driving this frame, or null when no clip is
   * playing. Bones in this set are treated as clip-owned: the procedural motion below
   * layers ON TOP of whatever the clip left, instead of overwriting it.
   *
   * Without this, a skeletal idle clip and this hook silently fight over head, neck and
   * spine — see basisFor.
   */
  clipDrivenBones?: Set<string> | null;
}

const BLINK_MIN_MS = 2200;
const BLINK_MAX_MS = 6000;
const BLINK_CLOSE_MS = 70;
const BLINK_OPEN_MS = 130;

/**
 * How much of the head's movement the eyes refuse to inherit.
 *
 * 1 pins the gaze perfectly level however the head moves, which reads as robotic; 0 is
 * pure inheritance, where the eyeballs roll with the skull and the camera ends up looking
 * at sclera. People do let their eyes travel a little with a big head turn.
 */
const EYE_STABILISE = 0.75;

/** Gaze travel in radians at full cursor deflection, applied about WORLD axes. */
const EYE_GAZE_YAW = 0.52;
const EYE_GAZE_PITCH = 0.26;

/**
 * How far the eye may turn in its socket before it gives up and rides along with the
 * head. Roughly 24 degrees — past that a real eye has run out of travel too.
 */
const EYE_MAX_DEVIATION = 0.42;

/** Per-frame easing toward the solved orientation. */
const EYE_SMOOTHING = 0.35;

const nextBlinkDelay = () => BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);

/**
 * Everything that keeps the avatar from reading as a frozen model between replies.
 *
 * Procedural rather than baked, because these are the parts that must react to things a
 * clip can't know about: the cursor position, and which conversational state we're in.
 * Blink, breath and gaze clear the "is this thing broken?" bar on their own at
 * head-and-shoulders framing.
 *
 * A skeletal body clip now layers UNDERNEATH this — see clipDrivenBones. At full-body
 * framing the clip is what stops the avatar being a statue from the shoulders down;
 * this hook keeps owning the head, eyes and expression on top of it.
 */
export function useIdleAnimation({ rig, bones, state, clipDrivenBones = null }: Args) {
  const pointer = useThree((s) => s.pointer);

  const clock = useRef(0);
  const blinkAt = useRef(nextBlinkDelay());
  const blinkElapsed = useRef<number | null>(null);
  const baseRotations = useRef<Map<Object3D, Euler>>(new Map());
  /* Per-bone scratch for clip-driven bases. A Map rather than one shared Euler so two
     bones read in the same frame can't alias, and reused rather than cloned so this
     allocates nothing in the frame loop. */
  const liveRotations = useRef<Map<Object3D, Euler>>(new Map());
  const gaze = useRef({ x: 0, y: 0 });
  /* Reused every frame so the gaze solve allocates nothing in the render loop. */
  const scratch = useRef({
    parentWorld: new Quaternion(),
    invParent: new Quaternion(),
    inherited: new Quaternion(),
    desired: new Quaternion(),
    local: new Quaternion(),
    gazeQ: new Quaternion(),
    gazeE: new Euler(0, 0, 0, 'YXZ'),
  });
  const aversion = useRef({ x: 0, y: 0, until: 0 });

  /**
   * The pose this frame's offsets are added to.
   *
   * Two cases, and getting them the wrong way round is the bug this exists to prevent:
   *
   *  - NO clip on this bone: the base is the rig's authored rest pose, cached on first
   *    sight. Re-reading it every frame would compound our own offsets into a drift.
   *
   *  - CLIP driving this bone: the base is the bone's CURRENT rotation, as the mixer
   *    just wrote it. Caching here would freeze the base at whatever single frame of
   *    the clip happened to be showing on mount, and then overwrite the clip's motion
   *    with that stale pose for the rest of the session.
   *
   * This only works because the mixer runs before us — see the ordering note in
   * AvatarModel. Reading bone.rotation is safe even though the mixer writes quaternions:
   * three keeps rotation and quaternion in sync through their onChange callbacks.
   */
  const basisFor = (bone: Object3D) => {
    if (clipDrivenBones?.has(bone.name)) {
      let live = liveRotations.current.get(bone);
      if (!live) {
        live = new Euler();
        liveRotations.current.set(bone, live);
      }
      return live.copy(bone.rotation);
    }

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

    /* ── Eye aim ────────────────────────────────────────────────────────
       Solved as quaternions, deliberately.

       The obvious version — add a gaze offset to the eye's Euler rotation — is what
       used to be here, and it fails twice over. It inherits the head's rotation whole,
       so when a clip throws the head back the eyeballs roll up with it and the camera
       is left looking at sclera; and this rig's eye bones rest near a Euler singularity
       (about 144 degrees on X), so Euler arithmetic against the head's angles compares
       numbers that don't share an axis convention.

       Working in world space sidesteps both. Nothing here needs to know which axis the
       eye calls 'forward', because the aim being held is the bind-pose world
       orientation itself rather than a direction anyone had to name. */
    const s = scratch.current;
    s.gazeE.set(gaze.current.y * EYE_GAZE_PITCH, gaze.current.x * EYE_GAZE_YAW, 0);
    s.gazeQ.setFromEuler(s.gazeE);

    for (const eye of bones.eyes ?? []) {
      const parent = eye.bone.parent;
      if (!parent) continue;

      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(s.parentWorld);

      // Where the eye would point if it simply rode along with the head.
      s.inherited.copy(s.parentWorld).multiply(eye.restLocal);

      // Pull it back toward the aim it had when the rig was bound.
      s.desired.copy(s.inherited).slerp(eye.restWorld, EYE_STABILISE);

      // Gaze on top. Pre-multiplied, so it applies about world axes and the eye tracks
      // the cursor rather than a direction that depends on where the head is facing.
      s.desired.premultiply(s.gazeQ);

      // Back into the parent bone's space, which is what the bone actually stores.
      s.invParent.copy(s.parentWorld).invert();
      s.local.copy(s.invParent).multiply(s.desired);

      // Clamp to the socket. Past the limit the eye travels with the head rather than
      // reaching an angle no eye could.
      const deviation = s.local.angleTo(eye.restLocal);
      if (deviation > EYE_MAX_DEVIATION) {
        s.local.copy(eye.restLocal).slerp(s.local, EYE_MAX_DEVIATION / deviation);
      }

      eye.bone.quaternion.slerp(s.local, EYE_SMOOTHING);
    }
  });
}
