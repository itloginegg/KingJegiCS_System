import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { MorphRig } from './morphRig';
import type { VoiceState } from '../../hooks/useVoiceSession';

/**
 * What the VRM migration removed from this file, so it doesn't get reinstated by reflex:
 *
 *  - `basisFor()` / `baseRotations` / `clipDrivenBones`. This existed to branch between
 *    a cached bind pose and the mixer's live output, because the old rig's bones had
 *    non-identity rest rotations that our offsets had to be measured against. VRM
 *    normalized bones have IDENTITY rest poses by construction, so the base is simply
 *    zero and there is nothing to cache or branch on. Rotations are written absolutely.
 *
 *  - `EyeRest` / `restLocal` / `restWorld` / `EYE_STABILISE` / `EYE_MAX_DEVIATION`, and
 *    the world-space quaternion eye solve. Every one of those was compensation for the
 *    old rig, and `vrm.lookAt` now does the same jobs natively and better:
 *
 *      * EYE_STABILISE approximated "eyes don't inherit the whole head turn". The bone
 *        applier gets this for free — it measures yaw/pitch against the head's REST
 *        world orientation, so head rotation is already discounted. Measured: with the
 *        head turned 11 degrees and the target only 4.6 degrees off centre, the eyes
 *        rotate -1.06 degrees, i.e. backwards against the head, holding the target.
 *        That counter-rotation is the behaviour the old code hand-rolled.
 *      * EYE_MAX_DEVIATION guessed a socket limit. The model authors real ones.
 *      * The Euler-singularity problem is gone with normalized bones.
 *
 *    So DO NOT write eye bones here. The applier owns `leftEye`/`rightEye` on both the
 *    raw and normalized skeletons and overwrites them inside every `vrm.update()`;
 *    that is also why AvatarBones no longer carries eye fields to tempt anyone.
 */

/**
 * NORMALIZED humanoid nodes, never raw ones.
 *
 * Normalized bones rest at identity, so the rotations below are absolute angles rather
 * than offsets from whatever the rig authored, and `vrm.update()` copies the result onto
 * the raw bones the meshes are skinned to. Writing raw bones here would both fight that
 * copy and discard the rig's rest pose.
 *
 * No eye fields, deliberately — see the note above.
 */
export interface AvatarBones {
  head: Object3D | null;
  neck: Object3D | null;
  /** upperChest where present, else chest. Carries the breath. */
  chest: Object3D | null;
}

interface Args {
  rig: MorphRig | null;
  bones: AvatarBones;
  /**
   * The proxy object `vrm.lookAt` aims at, positioned in WORLD space by this hook.
   *
   * Deliberately unparented: `getWorldPosition` refreshes its own matrix, so an orphan
   * object needs no scene-graph membership and picks up a same-frame position with no
   * traversal. Null disables gaze entirely.
   */
  gazeTarget: Object3D | null;
  state: VoiceState;
}

const BLINK_MIN_MS = 2200;
const BLINK_MAX_MS = 6000;
const BLINK_CLOSE_MS = 70;
const BLINK_OPEN_MS = 130;

/**
 * How far in front of the eyes the gaze target sits, in metres.
 *
 * Only the ANGLE it subtends matters, so this and the spreads below are one setting in
 * two numbers. 2 m reads as "looking at someone across the room" rather than focusing on
 * the tip of its own nose, which matters because the two eyes converge on this point.
 */
const GAZE_DISTANCE = 2.0;

/**
 * Lateral and vertical travel of the target at full cursor deflection, in metres.
 *
 * 4.0 puts the target about 33 degrees off centre at the extreme. That is further than
 * the head turns (11 degrees) on purpose: the difference is what the eyes take up, and
 * a target pinned to exactly where the head points would leave them dead centre forever.
 *
 * Do not expect large numbers here to buy large eye movement. This model maps a 90 degree
 * request onto at most 8 degrees of inner / 12 degrees of outer eye rotation, so the
 * response is roughly a ninth of the residual angle — measured 2.15 degrees of eye yaw at
 * these values. That ceiling is authored into the VRM, and deferring to it rather than
 * overriding it is the point of using lookAt at all.
 */
const GAZE_SPREAD_X = 4.0;
const GAZE_SPREAD_Y = 2.5;

const nextBlinkDelay = () => BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);

/**
 * Everything that keeps the avatar from reading as a frozen model between replies.
 *
 * Procedural rather than baked, because these are the parts that must react to things a
 * clip can't know about: the cursor position, and which conversational state we're in.
 * Blink, breath and gaze clear the "is this thing broken?" bar on their own at
 * head-and-shoulders framing.
 */
export function useIdleAnimation({ rig, bones, gazeTarget, state }: Args) {
  const pointer = useThree((s) => s.pointer);

  const clock = useRef(0);
  const blinkAt = useRef(nextBlinkDelay());
  const blinkElapsed = useRef<number | null>(null);
  const gaze = useRef({ x: 0, y: 0 });
  const aversion = useRef({ x: 0, y: 0, until: 0 });
  /* Reused so positioning the gaze target allocates nothing in the frame loop. */
  const headWorld = useRef(new Vector3());

  useFrame((_, delta) => {
    const deltaMs = Math.min(delta * 1000, 100);
    clock.current += deltaMs;
    const t = clock.current / 1000;

    /* ── Blink ──────────────────────────────────────────────────────────
       The cheapest signal of life by a wide margin: a face that never blinks
       reads as dead within about four seconds.

       The timing curve is asset-independent and carries over to VRM unchanged — only
       the target names need to become `blinkLeft` / `blinkRight` expressions. */
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

      /* `blinkLeft`/`blinkRight` rather than the single `blink` preset: they're driven
         from one `lid` value today, but keeping them separate is what makes a wink or an
         asymmetric blink possible later without restructuring. All three exist here. */
      rig.set('blinkLeft', lid);
      rig.set('blinkRight', lid);

      /* ── Expression per conversational state ────────────────────────
         A gentle resting warmth while idle or listening, dropped while speaking so it
         doesn't fight the visemes. `relaxed` (the model's `Fcl_ALL_Fun`) is the closest
         preset to the mouthSmile pair this replaces, and at 0.12 it reads as a soft
         resting expression rather than a grin.

         The old brow-raise and eye-widen on `listening` are NOT ported. They mapped to
         ARKit `browInnerUp` / `eyeWide*`, and VRM's preset vocabulary has no equivalent —
         the nearest raw shapes are `Fcl_BRW_Surprised` and `Fcl_EYE_Surprised`, both of
         which the `surprised` preset already binds, so driving them directly would be
         silently overwritten (see the clobbering note in morphRig). Restoring that
         behaviour means registering custom expressions, which is a real decision and
         belongs with the lip-sync work that needs the same machinery. */
      const attentive = state === 'idle' || state === 'listening';
      rig.set('relaxed', MathUtils.lerp(rig.get('relaxed'), attentive ? 0.12 : 0, 0.05));

      /* A little warmth over the top of `relaxed`, so the greeting lands on a face that
         is already pleased to see you rather than a neutral one.

         0.10, and BELOW relaxed's 0.12 on purpose. `happy` binds a single VRoid morph,
         Fcl_ALL_Joy, which is an "ALL" shape driving eyes, brows and mouth together — at
         full weight it becomes the closed `^^` squint, which would swallow the blink and
         make the gaze tracking pointless. relaxed (Fcl_ALL_Fun) barely touches the eyes;
         this one does, so it gets the smaller share.

         Dropped to zero while speaking for a second reason as well as the obvious one:
         its overrideMouth is `none`, so it ACCUMULATES with the viseme weights instead of
         yielding to them, and a held mouth shape under lip-sync reads as mush. */
      rig.set('happy', MathUtils.lerp(rig.get('happy'), attentive ? 0.10 : 0, 0.05));
    }

    /* ── Gaze ───────────────────────────────────────────────────────────
       Tracks the cursor, except while thinking. People look away to think, and
       unbroken eye contact during a pause is the specific thing that makes a
       virtual character feel like it has stopped responding.

       This is the behaviour worth preserving. Where the resulting gaze vector gets
       APPLIED changes under VRM — it should drive a lookAt target rather than eye
       bone quaternions — but what to look at, and when to look away, does not. */
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
       joint. Written as absolute rotations because normalized VRM bones rest at
       identity — there is no authored posture underneath to preserve. */
    const sway = Math.sin(t * 0.55) * 0.022 + Math.sin(t * 0.23) * 0.014;
    const bob = Math.sin(t * 0.8) * 0.01;
    const speakingNod = state === 'speaking' ? Math.sin(t * 2.6) * 0.02 : 0;

    if (bones.head) {
      bones.head.rotation.set(
        gaze.current.y * 0.6 + bob + speakingNod,
        gaze.current.x * 0.6 + sway,
        (state === 'listening' ? 0.05 : 0) + Math.sin(t * 0.37) * 0.012,
      );
    }

    if (bones.neck) {
      bones.neck.rotation.set(gaze.current.y * 0.25, gaze.current.x * 0.3, 0);
    }

    if (bones.chest) {
      // ~14 breaths/minute.
      bones.chest.rotation.set(Math.sin(t * 1.45) * 0.008, 0, 0);
    }

    /* ── Gaze target ────────────────────────────────────────────────────
       Positioned after the bone writes above so getWorldPosition — which refreshes the
       head's matrix up the parent chain — picks up this frame's neck and chest
       rotations rather than last frame's.

       Correct rather than critical, and worth being honest about the size of it: the
       head bone is a pivot, so rotating the neck barely translates it. Measured at 3.6mm
       for a 28-degree neck turn, which at GAZE_DISTANCE is about a tenth of a degree of
       target displacement. Nobody would ever see it. The ordering costs nothing either
       way, so it is done properly and the question never has to be asked again — but
       don't go rearranging other things on the theory that this one mattered.

       Offsets are applied about WORLD axes, not the head's, so the avatar tracks the
       cursor rather than a direction that depends on where its head already points —
       the same reason the old implementation solved gaze in world space.

       vrm.update() consumes this a moment later, inside useVRMUpdate. */
    if (gazeTarget && bones.head) {
      const origin = bones.head.getWorldPosition(headWorld.current);
      gazeTarget.position.set(
        origin.x + gaze.current.x * GAZE_SPREAD_X,
        origin.y + gaze.current.y * GAZE_SPREAD_Y,
        origin.z + GAZE_DISTANCE,
      );
    }
  });
}
