import { Mesh } from 'three';
import { VRMExpression, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { CONSONANT_RECIPES } from './visemeMap';

/**
 * Registers the custom consonant expressions onto the VRM's expression manager.
 *
 * WHY CUSTOM EXPRESSIONS RATHER THAN RAW MORPH WRITES. Both would work — the `Fcl_MTH_*`
 * shapes these use are unclaimed, so writing their influences directly does survive
 * `vrm.update()`. Going through the expression system instead buys three things:
 *
 *  1. Nothing can silently clobber them. A raw write is only safe for as long as nobody
 *     binds a preset to that morph; an expression composes with the presets by design,
 *     because `update()` clears all applied weights and then ACCUMULATES each expression's
 *     contribution. Consonants and vowels can overlap mid-blend without fighting.
 *  2. `VRMUtils.combineMorphs` stays available. It rewrites binds, so it is safe for
 *     anything expression-driven and destructive to anything driven raw — choosing
 *     expressions here is what keeps that door open (see the note in AvatarModel).
 *  3. One code path. `morphRig.set()` routes by name, so the driver never has to know
 *     which of its fifteen targets are the model's and which are ours.
 *
 * Idempotent: drei caches the VRM across mounts, so this both must be safe to call
 * repeatedly and only needs to do its work once.
 */
export function registerVisemeExpressions(vrm: VRM): void {
  const manager = vrm.expressionManager;
  if (!manager) return;
  if (vrm.scene.userData.__visemeExpressionsRegistered) return;
  vrm.scene.userData.__visemeExpressionsRegistered = true;

  /* Every mesh carrying each morph name, grouped by the INDEX that morph has on it.
     A bind addresses one index across a list of primitives, so primitives that happen to
     order their targets differently need separate binds. In this export all eight face
     primitives agree, but grouping costs nothing and removes an assumption that would
     fail silently — as a wrong index is still a valid index. */
  const primitivesByMorph = new Map<string, Map<number, Mesh[]>>();
  vrm.scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const dictionary = node.morphTargetDictionary;
    if (!dictionary || !node.morphTargetInfluences) return;
    for (const [name, index] of Object.entries(dictionary)) {
      let byIndex = primitivesByMorph.get(name);
      if (!byIndex) { byIndex = new Map(); primitivesByMorph.set(name, byIndex); }
      const list = byIndex.get(index) ?? [];
      list.push(node);
      byIndex.set(index, list);
    }
  });

  const missing: string[] = [];

  for (const [expressionName, recipe] of Object.entries(CONSONANT_RECIPES)) {
    /* Registering a second expression under an existing name would leave two live
       objects answering to it, and only one reachable through getExpression — so the
       other would keep applying its weight with no way to zero it. */
    if (manager.getExpression(expressionName)) continue;

    const expression = new VRMExpression(expressionName);
    let bound = 0;

    for (const [morphName, weight] of Object.entries(recipe)) {
      const byIndex = primitivesByMorph.get(morphName);
      if (!byIndex) { missing.push(expressionName + ' → ' + morphName); continue; }
      for (const [index, primitives] of byIndex) {
        expression.addBind(new VRMExpressionMorphTargetBind({ primitives, index, weight }));
        bound += 1;
      }
    }

    // A bindless expression is worse than no expression: setValue() would accept it and
    // the mouth would simply never move for that phoneme group.
    if (bound === 0) continue;
    manager.registerExpression(expression);

    /* Declared as mouth expressions alongside the model's own vowels. Inert today —
       nothing on this model sets overrideMouth — but if anything ever does, the whole
       mouth should damp together. Leaving ours out would damp the vowels and not the
       consonants, which reads as the mouth half-working rather than as an override. */
    if (!manager.mouthExpressionNames.includes(expressionName)) {
      manager.mouthExpressionNames.push(expressionName);
    }
  }

  if (import.meta.env.DEV && missing.length > 0) {
    console.warn(
      '[avatar] viseme recipes reference morph targets this model does not have: '
      + missing.join(', ')
      + '. Those consonants will be weaker or flat. Check CONSONANT_RECIPES in visemeMap.ts '
      + 'against the export.',
    );
  }
}
