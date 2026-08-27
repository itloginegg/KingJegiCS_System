import type { VRM } from '@pixiv/three-vrm';

/**
 * Brings the arms down out of the T-pose, once, at load.
 *
 * WHY THIS EXISTS — it is a stand-in, not a feature.
 *
 * VRM 1.0 mandates that the model is authored in a T-pose, and this file ships zero
 * animation clips. Nothing else in the pipeline lowers the arms, so without this the
 * avatar stands with its arms straight out for the entire session.
 *
 * That isn't only ugly, it breaks the framing. AvatarModel clamps the width it fits to
 * SILHOUETTE_WIDTH_RATIO (half the figure's height) precisely so the T-pose's
 * outstretched arms don't push the camera miles back — a clamp that assumes an idle clip
 * will bring the arms down. Measured at the production 300x600 column with fitMargin
 * 1.04, the un-posed T-pose puts both hands fully outside the frame (screen x of -46 and
 * 346 in a 0..299 viewport) with roughly 23 rows of fingertip clipped against each edge.
 * At the angles below the same measurement gives 54px of clear margin on both sides.
 *
 * DELETE THIS once a real idle animation lands. A .vrma clip drives the same normalized
 * bones through the mixer and will simply overwrite this pose, so leaving it in place is
 * harmless but pointless — and a static pose fighting a clip is exactly the kind of
 * thing that gets misdiagnosed later.
 */

/**
 * Upper arm rotation about Z, in radians. ~71.6 degrees down from horizontal.
 *
 * Swept empirically against the production framing rather than guessed. Clipping against
 * the frame edge stops at about 1.1 rad (63 degrees); below that the fingertips still
 * touch. Past ~1.4 rad (80 degrees) the arms pin flat against the hips and read stiff.
 * 1.25 sits in the middle of that window with real margin on both sides.
 */
const UPPER_ARM_Z = 1.25;

/**
 * Elbow bend, in radians. ~10 degrees.
 *
 * Small on purpose: a dead-straight arm reads as a mannequin. Also measured — the side
 * margin is widest right around here. Bending much further swings the forearm back
 * outwards and starts eating the margin again (16 degrees costs 9px a side).
 */
const LOWER_ARM_Z = 0.18;

/**
 * Applies the resting pose to the VRM's normalized humanoid bones.
 *
 * Normalized, not raw, and that matters twice over: normalized bones have identity rest
 * rotations, so these numbers are absolute angles rather than offsets from whatever the
 * rig happened to author; and `vrm.update()` is what copies the normalized pose onto the
 * raw bones the meshes are skinned to, so writing raw here would be undone immediately.
 *
 * The signs mirror because the arms extend along opposite axes: VRM 1.0 faces +Z, which
 * puts the model's left arm along +X and its right along -X, so the same downward
 * rotation is negative on one side and positive on the other.
 *
 * Set once and it stays set — `vrm.update()` reads the normalized pose but never clears
 * it (verified over 600+ frames). Safe to call repeatedly: useGLTF caches the VRM across
 * mounts, so this both must be idempotent and only needs to do its work once. Writing
 * the same absolute rotations again would be harmless anyway; the guard is there to keep
 * it honest if these ever become relative.
 */
export function applyRestPose(vrm: VRM): void {
  if (vrm.scene.userData.__restPoseApplied) return;
  vrm.scene.userData.__restPoseApplied = true;

  const set = (name: 'leftUpperArm' | 'rightUpperArm' | 'leftLowerArm' | 'rightLowerArm', z: number) => {
    const bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) bone.rotation.set(0, 0, z);
  };

  set('leftUpperArm', -UPPER_ARM_Z);
  set('rightUpperArm', UPPER_ARM_Z);
  set('leftLowerArm', -LOWER_ARM_Z);
  set('rightLowerArm', LOWER_ARM_Z);
}
