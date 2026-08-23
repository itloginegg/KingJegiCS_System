import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Box3, LoopOnce, LoopRepeat, Object3D, Vector3 } from 'three';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import type { GLTFLoader } from 'three-stdlib';
import type { GLTFLoader as VRMCompatibleGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyMaxAnisotropy } from './textures';
import { applyRestPose } from './restPose';
import { buildMorphRig } from './morphRig';
import { registerVisemeExpressions } from './visemeExpressions';
import { useIdleAnimation } from './useIdleAnimation';
import { useVisemeDriver } from './useVisemeDriver';
import { useVRMAnimations, preloadVRMAnimations } from './useVRMAnimations';
import type { AvatarBones } from './useIdleAnimation';
import { useVRMUpdate } from './useVRMUpdate';
import type { VisemeCue, VoiceState } from '../../hooks/useVoiceSession';
import type { AvatarFraming } from './framing';

export const AVATAR_URL = '/avatar/assistant.vrm';

/**
 * Body animations, as VRM Animation files.
 *
 * MUST be a module-level constant: useVRMAnimations runs one useGLTF per entry, so the
 * length is a hook count and a changing array would violate the rules of hooks.
 *
 * Clips are selected by substring against these filenames — `idle` matches idle.vrma —
 * so adding a body animation for the speaking state is a matter of dropping talking.vrma
 * beside it and adding one line here. See `clips` below.
 *
 * wave.vrma is a GESTURE rather than a state loop, and the distinction is the reason
 * `greeting` needs its own handling below: a state clip repeats until the state changes,
 * a gesture plays once and hands back. Authored in Blender against this rig; the source
 * scene is avatar-src/idle.blend, which is git-ignored.
 */
const ANIMATION_URLS = ['/avatar/idle.vrma', '/avatar/wave.vrma'] as const;

/**
 * Registers the VRM extensions on the GLTFLoader drei builds for us.
 *
 * Shared between the hook and the preload below, and that sharing is the point: drei
 * caches by URL, so whichever call runs FIRST decides how the file is parsed. Preload
 * without this plugin and the cache is populated with a plain glTF parse — the meshes
 * and textures all arrive, nothing throws, and `userData.vrm` is simply undefined. The
 * failure looks like a broken model rather than a loader misconfiguration.
 *
 * THE CAST — one wart, and worth understanding before "simplifying" it.
 *
 * drei types extendLoader against three-stdlib's GLTFLoader; three-vrm types its plugin
 * against the one in three/examples. Same class, vendored twice, with no nominal
 * relationship, so TypeScript rejects the plugin outright (their GLTF types disagree
 * several layers down, at parser.options.ktx2Loader). At runtime there is exactly one
 * GLTFLoader and this is a non-issue.
 *
 * So the cast asserts the one thing that is actually true — these two GLTFLoader types
 * are the same class — and does it once, at the boundary. Everything inside the callback
 * is then genuinely type-checked: `parser` has its real type and VRMLoaderPlugin is
 * verified against the plugin interface it was written for. Casting the plugin instead
 * (`as never` on the return) also compiles, but silences the check at the exact point
 * where a real three-vrm API change would show up.
 */
const extendLoader = (loader: GLTFLoader) => {
  const compatible = loader as unknown as VRMCompatibleGLTFLoader;
  compatible.register((parser) => new VRMLoaderPlugin(parser));
};

/** Fallback breathing room at full framing when the caller doesn't specify. 1 = tight crop. */
const DEFAULT_FULL_BODY_MARGIN = 1.18;

/**
 * Cap on how wide the figure is assumed to be, as a fraction of its height.
 *
 * Box3.setFromObject measures a skinned mesh in its BIND pose, and VRM 1.0 mandates a
 * T-pose — about as wide as the body is tall. Fitting that width into a narrow column
 * pushes the camera roughly twice as far back as the figure actually needs, and the
 * avatar renders small with dead space all round. A standing person is at most about
 * half their height wide, so the width used for fitting is clamped to that.
 *
 * NOTE: this number was measured against the previous, realistically-proportioned rig.
 * VRoid proportions are stylised (notably a larger head), so it is a candidate for
 * re-measuring if the full-body framing crops or floats.
 */
const SILHOUETTE_WIDTH_RATIO = 0.5;

/**
 * Blend time when swapping between the idle and talking loops.
 *
 * Long enough to read as the figure changing what it's doing, short enough that a reply
 * starting doesn't look delayed. A hard cut at this scale reads as a glitch.
 */
const CROSSFADE_SECONDS = 0.25;

interface Props {
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs: () => number | null;
  state: VoiceState;
  framing: AvatarFraming;
  /** Zoom for full-body framing. Lower fills more of the frame. */
  fitMargin?: number;
  /**
   * Changes to re-arm the greeting.
   *
   * The widget is mounted once above the router, so this component no longer remounts on
   * navigation — which is the point, since remounting tore down the WebGL context on every
   * route change. But "greet once per mount" then means greeting once per SESSION, so the
   * route has to arrive as data instead. Callers pass the pathname.
   *
   * Prop-drilled from ChatWidget rather than read with useLocation here, because this
   * component lives inside R3F's separate reconciler and router context does not cross
   * that boundary without a bridge.
   */
  greetKey?: string;
}

/**
 * How many AvatarModels are mounted against the shared, URL-cached VRM.
 *
 * useGLTF caches per URL, so every mount shares ONE VRM instance — and therefore one
 * spring bone simulation. Two live mounts means vrm.update() runs twice per frame on the
 * same solver, stepping the physics at double rate. The hair and skirt don't break
 * visibly; they just damp too fast and read as stiff, which is close to undebuggable
 * after the fact.
 *
 * No caller does this today (the standing figure is the only production mount, and the
 * dev lab toggles framing as a prop rather than mounting a second copy), so this is a
 * tripwire for a future change, not a live bug. DEV-only: the cost of being wrong in
 * production is a console line nobody reads.
 */
let liveMounts = 0;

export function AvatarModel({
  visemesRef, getPlaybackMs, state, framing, fitMargin, greetKey,
}: Props) {
  /* The .vrm itself ships zero animation clips — `gltf.animations` is empty and stays
     that way. Body motion comes from the separate .vrma files below, retargeted onto
     this VRM's normalized humanoid bones. */
  const gltf = useGLTF(AVATAR_URL, false, false, extendLoader);
  const { scene } = gltf;
  const vrm = (gltf.userData as { vrm?: VRM }).vrm ?? null;

  const animations = useVRMAnimations(vrm, ANIMATION_URLS);

  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  /* ORDERING NOTE — load-bearing.
     useAnimations registers a useFrame that advances the mixer. Any procedural pass
     layers on top of the mixer's output, and useVRMUpdate consumes all of it. R3F runs
     same-priority frame callbacks in subscription order, and hooks subscribe
     top-to-bottom, so this call MUST stay above them both.
     (Raising the priority instead is not an option: any priority > 0 makes R3F hand
     the render loop over to us.) */
  const { actions, names, mixer } = useAnimations(animations, scene);

  /**
   * One-time preparation of the shared VRM.
   *
   * Runs against the cached instance, so everything here must be idempotent — and the
   * VRMUtils passes are, being structural rather than incremental.
   */
  useEffect(() => {
    if (!vrm) return;

    /* Merges the skinned meshes' skeletons. Bone matrices are recomputed per skeleton
       per frame, so fewer skeletons is strictly less work. Touches skinning, not morphs. */
    VRMUtils.combineSkeletons(vrm.scene);

    /* VRMUtils.combineMorphs is still deliberately NOT called. It would be safe now
       (everything the mouth drives is expression-bound, and combineMorphs rewrites binds
       correctly), but its purpose is dodging the morph-texture limit on mobile, and the
       standing avatar never mounts below a 768px viewport. Adding a geometry-rewriting
       pass that changes nothing on the only platform that runs this is a bad trade. */

    /* Arms down out of the mandated T-pose.
       Now a FALLBACK rather than the main event: idle.vrma drives the same bones every
       frame and the mixer's write wins, so this only shows when no clip is playing —
       a failed .vrma fetch, or the gap before the first frame. Cheap insurance against
       the avatar appearing crucified. See restPose.ts. */
    applyRestPose(vrm);

    /* Frustum culling is computed from bind-pose bounding volumes, which stop being
       true the moment spring bones or the humanoid pose move geometry outside them.
       The symptom is limbs or hair vanishing at certain camera angles. With three
       meshes there is nothing to gain by culling them individually anyway. */
    vrm.scene.traverse((o) => { o.frustumCulled = false; });

    // GLTFLoader leaves every texture at anisotropy 1. On a curved surface that means
    // heavy over-blur with distance — worst on the eyes, where the iris dissolves into
    // the sclera. The GPU reports its own ceiling, so this is never a guess.
    applyMaxAnisotropy(vrm.scene, gl.capabilities.getMaxAnisotropy());
  }, [vrm, gl]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    /* Dev-only handles for the avatar lab. The VRM is the useful one now: expressions,
       humanoid bones and the spring bone manager all hang off it, and they are only
       inspectable on the live instance. */
    const bag = window as unknown as Record<string, unknown>;
    bag.__avatarVrm = vrm;
    bag.__avatarScene = scene;
    bag.__avatarCamera = camera;

    liveMounts += 1;
    if (liveMounts > 1) {
      console.error(
        '[avatar] ' + liveMounts + ' AvatarModel instances are mounted against the same '
        + 'cached VRM. They share one spring bone solver, so vrm.update() is stepping the '
        + 'physics ' + liveMounts + 'x per frame and the hair/cloth will read as '
        + 'over-damped. Give each mount its own VRM (separate URL, or a VRM-aware deep clone).',
      );
    }
    return () => { liveMounts -= 1; };
  }, [vrm, scene, camera]);

  /**
   * Which clip plays for which state.
   *
   * Matched loosely by substring against the .vrma filenames, so adding talking.vrma to
   * ANIMATION_URLS is enough to give the speaking state a body — no code change here.
   * `talking` resolves to null until such a file exists, which useAnimations tolerates.
   */
  const clips = useMemo(() => {
    const find = (needle: string) =>
      names.find((n) => n.toLowerCase().includes(needle)) ?? null;
    return {
      idle: find('idle') ?? names[0] ?? null,
      talking: find('talk'),
      greeting: find('wave'),
    };
  }, [names]);

  const speaking = state === 'speaking';

  /**
   * Whether the one-time greeting is done with.
   *
   * Component state rather than a module flag, deliberately: the VRM is URL-cached and
   * shared, but "has this avatar said hello to the person looking at it" belongs to the
   * mount, not to the model. A remount is a fresh appearance and gets a fresh wave.
   */
  const [greeted, setGreeted] = useState(false);

  /* Re-arm on navigation. Compared against a ref rather than just listing greetKey as a
     dependency, because the effect also fires on mount — where `greeted` is already false
     and resetting it would be a no-op that reads as if it were doing something. */
  const lastGreetKey = useRef(greetKey);
  useEffect(() => {
    if (lastGreetKey.current === greetKey) return;
    lastGreetKey.current = greetKey;
    setGreeted(false);
  }, [greetKey]);

  /* The greeting is pending until it has played out or been superseded. */
  const greeting = greeted ? null : clips.greeting;

  /* The talking clip is for FULL framing only.
     The bust camera is positioned once, on the head bone, and does not track. A talking
     clip gestures from the waist and would swing the head clear of a portrait crop.

     Speech outranks the greeting: if a reply starts inside the wave's 2.5s the body
     should follow the voice, not finish being polite. */
  const activeClip = (speaking && framing === 'full' && clips.talking)
    || greeting
    || clips.idle;

  const isGesture = activeClip !== null && activeClip === greeting;

  /* Cross-fade between clips.
     The cleanup fades the outgoing action out while the incoming one fades in, which is
     what makes the swap a blend rather than a cut.

     A gesture differs from a state loop in exactly two ways — it runs once, and it holds
     its final frame rather than snapping back to frame 0 while it fades out. Both matter
     here: wave.vrma's last frame is bit-identical to its first (the resting pose), so
     clamping leaves the body exactly where idle.vrma begins and the handoff has nothing
     to jump. Without clampWhenFinished the action would reset to frame 0 mid-fade, which
     is the same pose — but only because of that authored seam, and relying on it by
     accident is the kind of thing that breaks silently when a clip is replaced. */
  useEffect(() => {
    if (!activeClip) return;
    const action = actions[activeClip];
    if (!action) return;

    action.clampWhenFinished = isGesture;
    action.reset()
      .setLoop(isGesture ? LoopOnce : LoopRepeat, isGesture ? 1 : Infinity)
      .fadeIn(CROSSFADE_SECONDS)
      .play();
    return () => { action.fadeOut(CROSSFADE_SECONDS); };
  }, [actions, activeClip, isGesture]);

  /**
   * Retires the greeting.
   *
   * Two ways out, and both are needed. The mixer's `finished` event is the normal one —
   * it fires only for non-looping actions, which is why the gesture had to be LoopOnce
   * for this to work at all. The other is speech starting mid-wave: `activeClip` has
   * already moved on by then, so no `finished` will ever arrive and without this the
   * wave would replay the moment the reply ended.
   */
  useEffect(() => {
    if (greeted || !clips.greeting) return;

    if (speaking) {
      setGreeted(true);
      return;
    }

    const action = actions[clips.greeting];
    if (!action) return;

    const onFinished = (event: { action: unknown }) => {
      if (event.action === action) setGreeted(true);
    };
    mixer.addEventListener('finished', onFinished);
    return () => { mixer.removeEventListener('finished', onFinished); };
  }, [mixer, actions, clips.greeting, greeted, speaking]);

  /* Camera framing.
     Done here rather than through <Canvas camera={…}> because the right position
     depends on the loaded rig's actual proportions, which the Canvas can't know at
     mount. This effect is the authority — anything set on the Canvas prop is overridden
     the moment the model loads. */
  useEffect(() => {
    if (framing === 'bust') {
      /* RAW bone, not normalized — the distinction matters here.
         VRM keeps two skeletons: the raw one the skinned meshes are bound to, and a
         normalized one with identity rest poses that exists to be written to. Pose goes
         to the normalized bones; a camera needs to know where the head physically IS,
         which is the raw bone. Reading the normalized node would frame empty space. */
      const head = vrm?.humanoid.getRawBoneNode('head');
      if (!head) return;
      head.updateWorldMatrix(true, false);
      const p = new Vector3().setFromMatrixPosition(head.matrixWorld);
      camera.position.set(p.x, p.y + 0.05, p.z + 0.62);
      camera.lookAt(p.x, p.y + 0.01, p.z);
      camera.updateProjectionMatrix();
      return;
    }

    /* Full body: fit the whole bounding box, so the framing survives a rig of a
       different height instead of cropping the head or floating the feet. */
    const box = new Box3().setFromObject(scene);
    const centre = box.getCenter(new Vector3());
    const extent = box.getSize(new Vector3());

    const persp = camera as typeof camera & { fov?: number; aspect?: number };
    const fovRad = ((persp.fov ?? 30) * Math.PI) / 180;

    // Distance that fits the height; then the same for width via the horizontal FOV, and
    // take whichever is further back so neither axis is cropped in a narrow column.
    const margin = fitMargin ?? DEFAULT_FULL_BODY_MARGIN;
    const aspect = persp.aspect ?? Math.max(size.width / Math.max(size.height, 1), 0.0001);
    // Clamped so the T-pose's outstretched arms don't dictate the framing — see
    // SILHOUETTE_WIDTH_RATIO.
    const fitWidth = Math.min(extent.x, extent.y * SILHOUETTE_WIDTH_RATIO);
    const forHeight = (extent.y * margin) / 2 / Math.tan(fovRad / 2);
    const forWidth = (fitWidth * margin) / 2 / Math.tan(fovRad / 2) / aspect;
    const distance = Math.max(forHeight, forWidth);

    camera.position.set(centre.x, centre.y, centre.z + distance);
    camera.lookAt(centre.x, centre.y, centre.z);
    camera.updateProjectionMatrix();
  }, [scene, vrm, camera, framing, fitMargin, size.width, size.height]);

  /**
   * Holds the figure back until it has actually been framed.
   *
   * THE PROBLEM THIS SOLVES, because it is not obvious and the symptom is easy to
   * misattribute. React commits the model into the scene, the browser PAINTS, and only
   * then do passive effects run — so the framing effect above is one paint too late. The
   * first painted frame uses whatever renderer and camera state existed before it, and
   * measured on a real load that frame draws the figure hard against the top edge at
   * roughly half scale, head cut off. Every subsequent frame is correct, which is what
   * makes it read as a flash on load, refresh and route change alike.
   *
   * Chasing the camera is a dead end here: by the time any rAF callback can observe it,
   * the effect has already corrected it, and the numbers all look fine while the pixels
   * do not. Rather than race the renderer's internal resize, just don't show the figure
   * until a frame has been drawn with the framing applied.
   *
   * useLayoutEffect, NOT useEffect — this has to run before the paint it is preventing.
   * Two frames rather than one: the first is when the corrected camera takes effect, the
   * second is the one we can be sure was drawn with it.
   */
  const revealed = useRef(false);

  useLayoutEffect(() => {
    if (!revealed.current) scene.visible = false;
  }, [scene, vrm]);

  useEffect(() => {
    if (revealed.current) return undefined;

    let first = 0;
    let second = 0;
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        scene.visible = true;
        revealed.current = true;
      });
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      /* The VRM outlives this component in drei's cache, so leaving it hidden would make
         the NEXT mount render nothing at all. */
      scene.visible = true;
    };
  }, [scene, vrm]);

  /**
   * The expression/morph interface the drivers write through.
   *
   * Registration happens HERE rather than in the prep effect above, and the order inside
   * this memo is the reason. buildMorphRig snapshots which morph targets are already
   * expression-owned, and useMemo runs during render while effects run after it — so
   * registering the consonants in an effect would hand the rig a snapshot taken before
   * they existed. It would then classify all nine as free raw morphs and route them down
   * the direct-influence path, where the expression system would overwrite them on the
   * very next update: a mouth that moves for vowels and is dead for consonants.
   *
   * Mutating during render is not free of sin, but this mutates an externally cached
   * object that outlives the component, it is guarded to run once, and StrictMode's
   * double invoke is therefore a no-op. Keeping the two calls adjacent and ordered is
   * worth more here than the purity.
   */
  const rig = useMemo(() => {
    if (!vrm) return null;
    registerVisemeExpressions(vrm);
    return buildMorphRig(vrm);
  }, [vrm]);

  useEffect(() => {
    // useGLTF caches the VRM across mounts, so expression weights left over from a
    // previous session would otherwise persist into this one as a stuck face.
    rig?.reset();
  }, [rig]);

  /* NORMALIZED humanoid nodes — the layer meant to be written. Looked up through the
     humanoid API rather than by string, so this survives the next model swap too.

     upperChest preferred over chest for the breath: it sits where the old rig's Spine2
     did, and shoulder movement reads better than belly movement at this framing. Both
     are present on this model; the fallback is for rigs that only define chest. */
  const bones = useMemo<AvatarBones>(() => ({
    head: vrm?.humanoid.getNormalizedBoneNode('head') ?? null,
    neck: vrm?.humanoid.getNormalizedBoneNode('neck') ?? null,
    chest: vrm?.humanoid.getNormalizedBoneNode('upperChest')
      ?? vrm?.humanoid.getNormalizedBoneNode('chest')
      ?? null,
  }), [vrm]);

  /* The point the avatar looks at. Never rendered and never parented — useIdleAnimation
     writes its world position directly and vrm.lookAt reads it back the same frame. */
  const gazeTarget = useMemo(() => new Object3D(), []);

  useEffect(() => {
    const lookAt = vrm?.lookAt;
    if (!lookAt) return;
    lookAt.target = gazeTarget;
    /* Cleared on unmount because the VRM outlives this component in drei's cache: a
       stale target would leave the next mount's gaze aimed at a dead object, and
       autoUpdate would keep resolving against it every frame. */
    return () => { lookAt.target = null; };
  }, [vrm, gazeTarget]);

  /* ORDERING — both of these write INPUTS that vrm.update() consumes below.
     useVisemeDriver owns the mouth; useIdleAnimation owns blink, resting expression and
     the head/neck/chest pose. They touch disjoint expressions, so their relative order
     doesn't matter — but both must stay above useVRMUpdate. */
  useVisemeDriver({ rig, visemesRef, getPlaybackMs, speaking });
  useIdleAnimation({ rig, bones, gazeTarget, state });

  /* MUST BE LAST. See the ordering note in useVRMUpdate — every other frame hook writes
     inputs that this call consumes. Nothing that touches the VRM may be added below it. */
  useVRMUpdate(vrm);

  return <primitive object={scene} />;
}

// Same extendLoader as the hook, and that is not optional — see the note on the constant.
useGLTF.preload(AVATAR_URL, false, false, extendLoader);
// Animations get the VRMAnimationLoaderPlugin instead, for the same cache-poisoning reason.
preloadVRMAnimations(ANIMATION_URLS);
