import type { Object3D, Mesh } from 'three';

/**
 * A name-addressable view over every morph target in the avatar.
 *
 * Necessary because the shapes are split across meshes rather than living in one place:
 * in the Avaturn export `viseme_*` exists on Head_Mesh, Teeth_Mesh AND Tongue_Mesh, while
 * `eyeBlink*` is on Head_Mesh, EyeAO_Mesh and Eyelash_Mesh. Driving only the head leaves
 * the teeth and tongue frozen inside an open mouth, which reads as a hollow hole — so
 * every write has to fan out to all meshes carrying that shape.
 */

interface Binding {
  influences: number[];
  index: number;
}

export interface MorphRig {
  /** Set one shape everywhere it exists. Unknown names are ignored. */
  set(name: string, value: number): void;
  /** Current value of a shape, read from the first mesh that has it. */
  get(name: string): number;
  has(name: string): boolean;
  /** Every shape name present on the model — useful when verifying an unfamiliar export. */
  names(): string[];
  reset(): void;
}

export function buildMorphRig(root: Object3D): MorphRig {
  const bindings = new Map<string, Binding[]>();

  root.traverse((node) => {
    const mesh = node as Mesh;
    const dictionary = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dictionary || !influences) return;

    for (const [name, index] of Object.entries(dictionary)) {
      const list = bindings.get(name) ?? [];
      list.push({ influences, index });
      bindings.set(name, list);
    }
  });

  return {
    set(name, value) {
      const list = bindings.get(name);
      if (!list) return;
      for (const binding of list) binding.influences[binding.index] = value;
    },
    get(name) {
      const list = bindings.get(name);
      if (!list || list.length === 0) return 0;
      return list[0].influences[list[0].index];
    },
    has: (name) => bindings.has(name),
    names: () => [...bindings.keys()],
    reset() {
      for (const list of bindings.values()) {
        for (const binding of list) binding.influences[binding.index] = 0;
      }
    },
  };
}
