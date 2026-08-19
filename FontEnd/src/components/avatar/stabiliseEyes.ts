import { FrontSide, Mesh } from 'three';
import type { Material, Object3D } from 'three';

/**
 * Pins the eye materials so they can't drift at runtime.
 *
 * SCOPE — read this before adding to it. The eyes were reported as flickering, turning
 * red, and washing out. Only the first of those is addressed here; the other two were
 * chased through this file and the fixes did not work, so they were removed rather than
 * left in as dead weight:
 *
 *   - RED IRIS came from the eyeball texture's bright red outer ring (the rear of the
 *     ball) becoming visible. Fixed in the asset pipeline — optimize-avatar.mjs floods
 *     that hidden ring with a neutral tone. Nothing to do here.
 *
 *   - FLICKER is what this file actually fixes. EyeAO_Mesh and Eyelash_Mesh ship as
 *     glTF alphaMode BLEND, doubleSided, and sit under 2 mm off the opaque eyeball.
 *     three.js leaves depthWrite TRUE on transparent materials and sorts them per
 *     OBJECT rather than per fragment, so with the head turning every frame there is no
 *     stable answer to which surface is in front. Below: overlays stop writing depth,
 *     explicit renderOrder replaces distance sorting, and front faces only.
 *
 *   - WASHING OUT AT SMALL SIZE is still open. Inspected with the camera 18 cm from the
 *     face, the eye renders correctly — iris, pupil, sclera all clean. It only degrades
 *     when the eye is a handful of pixels wide, which points at minification rather than
 *     at any material property. Roughness, specular intensity and gaze range were each
 *     tried here and none of them helped. Don't re-litigate them from this file.
 *
 * Safe to call repeatedly — useGLTF caches the scene across mounts, so this both must be
 * idempotent and only needs to do its work once.
 */

/** The opaque eyeball. Draws first and owns the depth buffer in this region. */
const EYEBALL = 'Eye_Mesh';

/** Transparent shells over the eyeball, in the order they should draw. */
const OVERLAYS = ['EyeAO_Mesh', 'Eyelash_Mesh'];

/** Base renderOrder for the eye group. Above 0 so it sequences after ordinary meshes. */
const ORDER_BASE = 10;

/**
 * Roughness the ASSET authors, read out of its own metallicRoughness map (uniform
 * 0.098). Pinned to that number rather than invented — an earlier guess of 0.35 was
 * wrong and made the specular lobe broader than the model intended.
 */
const EYE_ROUGHNESS = 0.098;

type Tunable = Material & {
  metalness?: number;
  roughness?: number;
  envMapIntensity?: number;
  metalnessMap?: unknown;
  roughnessMap?: unknown;
};

export function stabiliseEyeMaterials(root: Object3D): void {
  if (root.userData.__eyesStabilised) return;
  root.userData.__eyesStabilised = true;

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    const isEyeball = child.name === EYEBALL;
    const overlayIndex = OVERLAYS.indexOf(child.name);
    if (!isEyeball && overlayIndex === -1) return;

    child.renderOrder = isEyeball ? ORDER_BASE : ORDER_BASE + 1 + overlayIndex;

    const slots = Array.isArray(child.material) ? child.material : [child.material];
    for (const slot of slots) {
      if (!slot) continue;
      const material = slot as Tunable;

      if (isEyeball) {
        material.roughness = EYE_ROUGHNESS;
        material.roughnessMap = null;
        material.transparent = false;
        material.depthWrite = true;
        material.side = FrontSide;
      } else {
        // The flicker fix: an overlay that never writes depth cannot win or lose a depth
        // comparison against the eyeball, whatever the sort decides.
        material.transparent = true;
        material.depthWrite = false;
        material.roughness = 1;
        material.side = FrontSide;
      }

      /* Eyes are dielectric. Worth pinning even though the asset authors ~0.004,
         because glTF defaults an ABSENT metallicFactor to 1.0 and this export omits it
         on every material — a re-export that also dropped the metallicRoughness texture
         would silently make the eyes fully metallic. Null the map too, since three
         multiplies this scalar by the map's channel. */
      material.metalness = 0;
      material.metalnessMap = null;
      material.envMapIntensity = 0;
      material.needsUpdate = true;
    }
  });
}

/** Texture slots worth sharpening. Skips slots this model doesn't use. */
const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
] as const;

/**
 * Raises anisotropic filtering on every texture in the model.
 *
 * GLTFLoader creates textures with `anisotropy = 1`, which is three.js's default and
 * almost never what you want on a character. At 1, a texture on a surface that curves or
 * tilts away from the camera is minified using a square filter footprint, even though
 * the actual footprint is a long thin sliver. The result is over-blurring that grows
 * with distance and with the angle of the surface.
 *
 * An eyeball is the worst case in the whole model: it is small, strongly curved, and the
 * feature that matters — the iris — is a small dark disc surrounded by bright sclera.
 * Over-blur there doesn't read as "slightly soft", it reads as the iris dissolving into
 * the white around it.
 *
 * Costs essentially nothing on hardware from the last decade, and the GPU tells us how
 * far it is willing to go, so nothing here is a guess.
 */
export function applyMaxAnisotropy(root: Object3D, maxAnisotropy: number): void {
  if (maxAnisotropy <= 1) return;
  if (root.userData.__anisotropyApplied === maxAnisotropy) return;
  root.userData.__anisotropyApplied = maxAnisotropy;

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const slots = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of slots) {
      if (!material) continue;
      const bag = material as unknown as Record<string, { anisotropy?: number; needsUpdate?: boolean } | undefined>;
      for (const slot of TEXTURE_SLOTS) {
        const texture = bag[slot];
        if (!texture || texture.anisotropy === undefined) continue;
        if (texture.anisotropy === maxAnisotropy) continue;
        texture.anisotropy = maxAnisotropy;
        texture.needsUpdate = true;
      }
    }
  });
}
