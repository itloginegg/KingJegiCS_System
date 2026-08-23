import { useFrame } from '@react-three/fiber';
import type { VRM } from '@pixiv/three-vrm';

/**
 * Steps the VRM once per frame.
 *
 * `vrm.update(delta)` is what makes a VRM a VRM rather than an inert glTF. In one call it
 * copies the normalized humanoid pose onto the raw bones the skinned meshes actually
 * follow, resolves expression weights onto morph target influences, advances the spring
 * bone simulation (hair, skirt, accessories), and solves lookAt. Skip it and the model
 * renders perfectly and never moves.
 *
 * ORDERING NOTE — load-bearing, and the reason this is its own hook.
 *
 * This MUST be the last useFrame subscription registered in AvatarModel. R3F runs
 * same-priority frame callbacks in subscription order and hooks subscribe top to bottom,
 * so "last" means "called below every other hook in the component body".
 *
 * The rule follows from what update() does. Everything else writes INPUTS to it —
 * the mixer writes a clip pose, the procedural pass layers head and eye motion onto
 * normalized bones, the viseme driver sets expression weights — and update() consumes
 * all of them to produce the frame you actually see. Anything written after it is either
 * silently overwritten on the next frame or lands one frame late. The specific failure
 * is nasty: the model still animates, just with a frame of lag that reads as "the physics
 * feel slightly off" rather than as an ordering bug, and it survives casual review.
 *
 * This is the same rule that already governs useAnimations sitting above
 * useIdleAnimation — see the ordering note in AvatarModel. Do not "tidy" the call order.
 */
export function useVRMUpdate(vrm: VRM | null) {
  useFrame((_, delta) => {
    // Clamped for the same reason the other frame hooks clamp: a backgrounded tab
    // resumes with a large delta, and handing that to the spring bone solver makes the
    // hair explode on the first frame back.
    if (vrm) vrm.update(Math.min(delta, 0.1));
  });
}
