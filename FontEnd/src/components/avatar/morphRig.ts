import { Mesh } from 'three';
import type { VRM } from '@pixiv/three-vrm';

/**
 * A name-addressable view over everything that can deform the avatar's face.
 *
 * Two layers behind one interface, because a VRM has two and they are not equivalent:
 *
 *  - EXPRESSIONS are the VRM-native layer. `vrm.expressionManager` owns 14 named presets
 *    (happy angry sad relaxed surprised aa ih ou ee oh blink blinkLeft blinkRight
 *    neutral), each of which fans out to whatever morph targets the author bound to it.
 *    This is the layer to prefer: it is the one the model was authored against, and it
 *    is rig-agnostic, so it survives swapping the model again.
 *
 *  - RAW MORPHS are the 57 `Fcl_*` shapes on the face mesh. Reachable for anything the
 *    expression vocabulary can't say — the consonant mouth shapes lip-sync needs have no
 *    preset, for instance — at the cost of being specific to this VRoid export.
 *
 * READ THIS BEFORE USING THE RAW PATH. `vrm.update()` re-applies every expression's
 * weight to its bound morph influences on every frame. A raw write to a morph that some
 * expression also binds to is therefore overwritten before it is ever seen. Only morphs
 * that no expression claims can be driven directly; `set()` warns in DEV if that rule is
 * broken, because the symptom otherwise is simply "that shape doesn't work" with nothing
 * in the console.
 *
 * The fan-out logic here is NOT vestigial, despite this being a "merged" export. glTF
 * stores 3 meshes but three.js splits multi-primitive meshes into one Mesh per material,
 * so the scene graph holds 15 — and all 8 `Face_(merged)*` primitives carry all 57 morph
 * targets. Driving one leaves the other seven behind.
 */

interface Binding {
  influences: number[];
  index: number;
}

export interface MorphRig {
  /** Set one shape everywhere it exists. Unknown names are ignored. */
  set(name: string, value: number): void;
  /** Current value of a shape. */
  get(name: string): number;
  has(name: string): boolean;
  /** Every shape name present on the model — useful when verifying an unfamiliar export. */
  names(): string[];
  reset(): void;
}

export function buildMorphRig(vrm: VRM): MorphRig {
  const expressions = vrm.expressionManager;

  /* Raw morph bindings, fanned out across every primitive carrying each name. */
  const bindings = new Map<string, Binding[]>();
  vrm.scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const dictionary = node.morphTargetDictionary;
    const influences = node.morphTargetInfluences;
    if (!dictionary || !influences) return;

    for (const [name, index] of Object.entries(dictionary)) {
      const list = bindings.get(name) ?? [];
      list.push({ influences, index });
      bindings.set(name, list);
    }
  });

  /**
   * Raw morph NAMES that some expression binds to, resolved once at build time.
   *
   * A bind points at a primitive plus a morph index, so the name comes back out of that
   * primitive's own dictionary — which is also why this can't be a static list.
   *
   * Identified structurally rather than with `instanceof VRMExpressionMorphTargetBind`,
   * and that is deliberate. An expression's binds also include material-colour and
   * texture-transform kinds, so some discrimination is needed — but `instanceof` compares
   * against one specific copy of the class, and it silently returns false if the VRM was
   * parsed by a second copy of three-vrm (a duplicated bundler chunk is enough; verified
   * in the dev graph, where two resolutions of the module made every check fail). The
   * failure mode is the worst kind: this set comes back empty, no warning ever fires, and
   * the safety net is gone without a symptom. Shape is the stable signal.
   */
  const ownedByExpression = new Set<string>();
  const isMorphBind = (bind: unknown): bind is { primitives: Mesh[]; index: number } => {
    const candidate = bind as { primitives?: unknown; index?: unknown };
    return Array.isArray(candidate.primitives) && typeof candidate.index === 'number';
  };
  for (const expression of expressions?.expressions ?? []) {
    for (const bind of expression.binds) {
      if (!isMorphBind(bind)) continue;
      for (const primitive of bind.primitives) {
        for (const [name, index] of Object.entries(primitive.morphTargetDictionary ?? {})) {
          if (index === bind.index) ownedByExpression.add(name);
        }
      }
    }
  }

  const isExpression = (name: string) => Boolean(expressions?.getExpression(name));

  /* Reported once per name, so a per-frame write doesn't flood the console. */
  const warned = new Set<string>();
  const warnIfClobbered = (name: string) => {
    if (!import.meta.env.DEV) return;
    if (!ownedByExpression.has(name) || warned.has(name)) return;
    warned.add(name);
    console.warn(
      '[avatar] morph "' + name + '" is bound by a VRM expression, so writing it '
      + 'directly has no effect — vrm.update() overwrites it every frame. Drive the '
      + 'expression that owns it, or register a custom expression for this shape.',
    );
  };

  return {
    set(name, value) {
      if (isExpression(name)) {
        expressions?.setValue(name, value);
        return;
      }
      const list = bindings.get(name);
      if (!list) return;
      warnIfClobbered(name);
      for (const binding of list) binding.influences[binding.index] = value;
    },

    get(name) {
      if (isExpression(name)) return expressions?.getValue(name) ?? 0;
      const list = bindings.get(name);
      if (!list || list.length === 0) return 0;
      return list[0].influences[list[0].index];
    },

    has: (name) => isExpression(name) || bindings.has(name),

    names: () => [
      ...Object.keys(expressions?.expressionMap ?? {}),
      ...bindings.keys(),
    ],

    reset() {
      expressions?.resetValues();
      for (const list of bindings.values()) {
        for (const binding of list) binding.influences[binding.index] = 0;
      }
    },
  };
}
