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

/**
 * Meshes to delete outright.
 *
 * Empty now, and it must stay that way while the avatar is rendered full-body.
 *
 * This used to drop 'avaturn_shoes_0', which was correct when the only framing was the
 * chat panel's head-and-shoulders banner — the shoes were never in shot. The persistent
 * standing avatar puts the whole figure on screen, and a mesh deleted here cannot be
 * brought back at runtime: AvatarModel's HIDDEN_MESHES can only toggle `visible` on a
 * mesh that still exists in the file. Dropping the shoes again would produce a barefoot
 * avatar that no amount of frontend code could fix.
 *
 * If a bust-only build is ever wanted again, make this a CLI flag rather than a constant,
 * so the two framings can't silently share one asset.
 */
const DROP_MESHES = new Set();

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

/* ── 2b. Neutralise the unseen red ring on the eye texture ─────────────
 *
 * The eyeball base-colour map is a 256px disc: blue iris in the middle, white sclera
 * around it, and a bright red outer ring that is the BACK of the eyeball — geometry
 * that never faces the camera. Because area grows with the square of the radius, that
 * ring is about 64% of the image, and the whole texture averages to a reddish
 * 143,90,80.
 *
 * That average is what the GPU actually samples. On the standing avatar the head is
 * roughly 70px tall, so each eye is ~8px and the 256px texture is minified about 32x —
 * deep into the mip chain, where the iris is a couple of pixels drowning in red. The
 * iris renders red, and flips as the head turns and the mip level changes.
 *
 * Flooding the ring with the sclera colour leaves everything visible from the front
 * untouched at full resolution, but makes every mip level average to something sane.
 * Done here rather than by hand-editing the asset so a fresh Avaturn export cannot
 * silently bring the red back.
 */
/** Radius, as a fraction of the disc, that the front of the eyeball actually shows. */
const EYE_KEEP_RADIUS = 0.56;
const EYE_FEATHER = 0.06;

/**
 * Radius covering what is visible BETWEEN THE EYELIDS — iris plus the sliver of sclera
 * around it. This is the region whose average colour an eye should converge to when it
 * is only a few pixels wide.
 */
const EYE_VISIBLE_RADIUS = 0.40;

async function neutraliseEyeTexture(doc) {
  const material = doc.getRoot().listMaterials().find((m) => m.getName() === "Eyes");
  if (!material) return "no Eyes material";
  const texture = material.getBaseColorTexture();
  if (!texture) return "Eyes has no base colour texture";

  const src = sharp(Buffer.from(texture.getImage()));
  const { width, height } = await src.metadata();
  const { data } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const cx = width / 2;
  const cy = height / 2;
  const half = Math.min(width, height) / 2;
  const radius = (x, y) => Math.hypot(x - cx, y - cy) / half;

  // 1. What SHOULD an eye average to at a few pixels wide? The mean of what the lids
  //    leave visible — the dark iris pulling the bright sclera down to a soft grey.
  //    Averaging to pure sclera is what made the eyes read as blank white.
  const target = [0, 0, 0];
  let visible = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (radius(x, y) > EYE_VISIBLE_RADIUS) continue;
      const i = (y * width + x) * 4;
      target[0] += data[i]; target[1] += data[i + 1]; target[2] += data[i + 2];
      visible++;
    }
  }
  if (!visible) return "could not sample the visible eye";
  for (let c = 0; c < 3; c++) target[c] /= visible;

  // 2. Solve for the fill colour that makes the WHOLE texture average to that target,
  //    rather than just picking a colour and hoping. Every mip level is a progressively
  //    coarser average of this image, so pinning the overall mean pins the whole chain.
  const keptSum = [0, 0, 0];
  let keptCount = 0;
  let fillCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (radius(x, y) <= EYE_KEEP_RADIUS) {
        keptSum[0] += data[i]; keptSum[1] += data[i + 1]; keptSum[2] += data[i + 2];
        keptCount++;
      } else {
        fillCount++;
      }
    }
  }
  const total = keptCount + fillCount;
  const fill = target.map((t, c) =>
    Math.max(0, Math.min(255, (t * total - keptSum[c]) / fillCount)));

  // 3. Flood the hidden outer ring, feathered so there is no seam.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = radius(x, y);
      if (r <= EYE_KEEP_RADIUS) continue;
      const t = Math.min(1, (r - EYE_KEEP_RADIUS) / EYE_FEATHER);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.round(data[i + c] * (1 - t) + fill[c] * t);
      }
    }
  }

  const out = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  texture.setImage(new Uint8Array(out)).setMimeType("image/png");
  const fmt = (a) => a.map((v) => Math.round(v)).join(",");
  return `target rgb(${fmt(target)}) from visible eye; filled ${fillCount} px with rgb(${fmt(fill)})`;
}

console.log("eye texture        : " + (await neutraliseEyeTexture(document)));

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
