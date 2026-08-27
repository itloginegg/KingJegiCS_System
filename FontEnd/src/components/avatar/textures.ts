import { Mesh } from 'three';
import type { Object3D } from 'three';

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
 *
 * Deliberately material-agnostic: it reads named slots off whatever material object it
 * finds and skips anything absent. That is what lets it survive the move from the PBR
 * (MeshStandardMaterial) avatar it was written for to MToon, which shares `map` and
 * `normalMap` and simply has no `roughnessMap`/`metalnessMap` to sharpen.
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
