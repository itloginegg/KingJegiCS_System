import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import type { AnimationClip } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { GLTFLoader } from 'three-stdlib';
import type { GLTFLoader as VRMCompatibleGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads .vrma animation files and retargets them onto a VRM.
 *
 * WHY .vrma AND NOT THE OLD MIXAMO CLIPS. The previous rig's clips are keyed to Avaturn
 * bone names (`Head`, `Spine2`, `LeftArm`) which do not exist here, so every track would
 * bind to nothing and the body would stay still while nothing errored. VRM Animation is
 * the format built for this problem: it stores pose against the standard humanoid bone
 * NAMES rather than against one skeleton's node names, so a single file drives any VRM
 * regardless of proportions or naming. That is what makes the clips survive the next
 * model swap, which the Mixamo ones did not survive this one.
 *
 * The retarget is `createVRMAnimationClip`, which resolves each humanoid bone to this
 * VRM's normalized node and emits an ordinary THREE.AnimationClip with tracks named
 * `Normalized_J_Bip_L_UpperArm.quaternion` and so on. Ordinary is the point: the result
 * feeds drei's useAnimations and the existing crossfade untouched.
 */

/** Shared with AvatarModel's loader for the same reason — see the note there. */
const extendLoader = (loader: GLTFLoader) => {
  const compatible = loader as unknown as VRMCompatibleGLTFLoader;
  compatible.register((parser) => new VRMAnimationLoaderPlugin(parser));
};

/**
 * A .vrma is a glTF, so drei's cache handles it exactly like the avatar — including the
 * rule that whichever call runs first decides how it is parsed. Hence the same
 * extendLoader on the preload.
 */
export function preloadVRMAnimations(urls: readonly string[]): void {
  for (const url of urls) useGLTF.preload(url, false, false, extendLoader);
}

/**
 * Retargets every given .vrma onto `vrm` and returns clips named after their source URL.
 *
 * Named from the URL basename rather than the file's internal animation name, because
 * AvatarModel picks clips by substring (`find('idle')`) and a filename is the thing an
 * author actually controls. Dropping in `talking.vrma` is then all it takes to give the
 * speaking state a body.
 */
export function useVRMAnimations(vrm: VRM | null, urls: readonly string[]): AnimationClip[] {
  /* One useGLTF call per URL, and the array MUST be a stable constant at the call site —
     this is a hook loop, so a changing length would break the rules of hooks. Callers
     pass a module-level constant; see ANIMATION_URLS in AvatarModel. */
  const loaded = urls.map((url) => useGLTF(url, false, false, extendLoader));

  return useMemo(() => {
    if (!vrm) return [];
    const clips: AnimationClip[] = [];

    loaded.forEach((gltf, index) => {
      const animations = (gltf.userData as { vrmAnimations?: VRMAnimation[] }).vrmAnimations;
      if (!animations?.length) {
        /* Not an error worth throwing over — a missing or malformed clip should cost the
           body its motion, not take the whole avatar down with it. But it is worth
           saying out loud, because the symptom otherwise is a statue with a clean
           console. The usual cause is a .vrma exported without the VRMC_vrm_animation
           extension, or a plain .glb renamed. */
        if (import.meta.env.DEV) {
          console.warn(
            '[avatar] ' + urls[index] + ' loaded but contains no VRM animation. '
            + 'Check it is a real .vrma (extensionsUsed must list VRMC_vrm_animation) '
            + 'rather than a renamed .glb.',
          );
        }
        return;
      }

      const name = urls[index].split('/').pop()?.replace(/\.vrma$/i, '') ?? 'clip' + index;
      animations.forEach((animation, i) => {
        const clip = createVRMAnimationClip(animation, vrm);
        clip.name = animations.length > 1 ? name + '.' + i : name;
        clips.push(clip);
      });
    });

    return clips;
  }, [vrm, loaded, urls]);
}
