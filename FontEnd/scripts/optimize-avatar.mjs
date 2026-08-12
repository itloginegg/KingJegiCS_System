/**
 * Turns an Avaturn export into something a chat widget can actually download.
 *
 *   node scripts/optimize-avatar.mjs public/avatar/assistant-dev.glb public/avatar/assistant.glb
 *
 * The raw export is ~12.6 MB, and the surprise is where it lives: morph targets are ~8 MB
 * of that, textures only ~3.4 MB. Avaturn ships 72 blendshapes on the head alone, and we
 * drive 23 of them. Dropping the rest is worth more than every texture optimization
 * combined, so it runs first.
 *
 * Re-run this whenever the avatar is re-exported. KEEP_TARGETS is the contract between
 * this script and the runtime driver — a shape removed here silently stops animating.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const [, , INPUT, OUTPUT] = process.argv;
if (!INPUT || !OUTPUT) {
  console.error('usage: node scripts/optimize-avatar.mjs <input.glb> <output.glb>');
  process.exit(1);
}

/**
 * Every morph target the runtime actually writes to.
 * Sources: visemeMap.ts (VISEME_TARGETS), useIdleAnimation.ts, useVisemeDriver.ts.
 */
const KEEP_TARGETS = new Set([
  // Lip-sync — the Oculus set Azure's viseme ids map onto.
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
  'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
  // Jaw underneath the visemes.
  'jawOpen',
  // Idle life.
  'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeWideLeft', 'eyeWideRight',
  'browInnerUp',
  'mouthSmileLeft', 'mouthSmileRight',
]);

/** Never visible at a head-and-shoulders framing. */
const DROP_MESHES = new Set(['avaturn_shoes_0']);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

// The meshopt() transform tags accessors for compression, but it's the IO layer that
// actually encodes them on write — so the codec has to be registered here too, not just
// handed to the transform.
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

const document = await io.read(INPUT);
const root = document.getRoot();
const before = fs.statSync(INPUT).size;

/* ── 1. Drop invisible meshes ─────────────────────────────────────────── */
let droppedMeshes = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (mesh && DROP_MESHES.has(mesh.getName())) {
    node.setMesh(null);
    droppedMeshes += 1;
  }
}

/* ── 2. Prune morph targets we never drive ────────────────────────────── */
let removedTargets = 0;
let keptTargets = 0;

for (const mesh of root.listMeshes()) {
  // Target names live on the mesh's extras (glTF stores them there, not on the target).
  const extras = mesh.getExtras() ?? {};
  const names = Array.isArray(extras.targetNames) ? extras.targetNames : null;
  if (!names) continue;

  const keepIndices = [];
  names.forEach((name, index) => {
    if (KEEP_TARGETS.has(name)) keepIndices.push(index);
  });

  for (const primitive of mesh.listPrimitives()) {
    const targets = primitive.listTargets();
    targets.forEach((target, index) => {
      if (keepIndices.includes(index)) return;
      primitive.removeTarget(target);
      target.dispose();
      removedTargets += 1;
    });
  }

  const keptNames = keepIndices.map((i) => names[i]);
  keptTargets += keptNames.length;
  mesh.setExtras({ ...extras, targetNames: keptNames });

  // Default weights are positional against the target list — stale entries would
  // silently apply the wrong shape at rest.
  const weights = mesh.getWeights?.();
  if (Array.isArray(weights) && weights.length) {
    mesh.setWeights(keepIndices.map((i) => weights[i] ?? 0));
  }
}

/* ── 3. Standard cleanup, then textures, then geometry ────────────────── */
await document.transform(
  resample(),
  // prune() must run after the mesh drop so its now-orphaned textures and materials go too.
  prune({ keepAttributes: false, keepLeaves: false }),
  dedup(),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    // 1024 is already more than a ~175px canvas can show; the face texture is the only
    // one where the difference would ever be visible.
    resize: [1024, 1024],
  }),
  // Quantizes and compresses geometry AND the remaining morph deltas. Meshopt rather than
  // Draco deliberately: Draco's quantization visibly degrades subtle blendshape deltas,
  // which is precisely the data lip-sync depends on.
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);

await io.write(OUTPUT, document);

const after = fs.statSync(OUTPUT).size;
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log(`meshes dropped     : ${droppedMeshes}`);
console.log(`morph targets kept : ${keptTargets} (removed ${removedTargets})`);
console.log(`size               : ${mb(before)} -> ${mb(after)}  (${(100 - (after / before) * 100).toFixed(1)}% smaller)`);
