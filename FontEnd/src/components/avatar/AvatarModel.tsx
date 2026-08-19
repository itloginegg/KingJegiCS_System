import { useEffect, useMemo } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Box3, LoopRepeat, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { buildMorphRig } from './morphRig';
import { applyMaxAnisotropy, stabiliseEyeMaterials } from './stabiliseEyes';
import { useVisemeDriver } from './useVisemeDriver';
import { useIdleAnimation } from './useIdleAnimation';
import type { AvatarBones, EyeRest } from './useIdleAnimation';
import type { VisemeCue, VoiceState } from '../../hooks/useVoiceSession';
import type { AvatarFraming } from './framing';

export const AVATAR_URL = '/avatar/assistant.glb';

/**
 * Meshes to hide, per framing.
 *
 * At bust framing the shoes are below the camera and rendering them is pure waste. At
 * full-body framing they are very much in shot, so hiding them would leave the avatar
 * barefoot — this list must stay framing-dependent.
 */
const HIDDEN_MESHES: Record<AvatarFraming, string[]> = {
  bust: ['avaturn_shoes_0'],
  full: [],
};

/** Fallback breathing room at full framing when the caller doesn't specify. 1 = tight crop. */
const DEFAULT_FULL_BODY_MARGIN = 1.18;

/**
 * Cap on how wide the figure is assumed to be, as a fraction of its height.
 *
 * Box3.setFromObject measures a skinned mesh in its BIND pose, which for this rig is
 * arms-out — about as wide as the body is tall. Fitting that width into a narrow column
 * pushes the camera roughly twice as far back as the figure actually needs, and the
 * avatar renders small with dead space all round, even though the idle clip keeps its
 * arms down. A standing person is at most about half their height wide, so the width
 * used for fitting is clamped to that.
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
}

export function AvatarModel({ visemesRef, getPlaybackMs, state, framing, fitMargin }: Props) {
  // `animations` is empty for an export with no clips — every hook below tolerates that
  // and the avatar simply falls back to procedural motion only.
  const { scene, animations } = useGLTF(AVATAR_URL);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  /* ORDERING NOTE — load-bearing.
     useAnimations registers a useFrame that advances the mixer. useIdleAnimation
     registers another that layers head/eye motion on top of the mixer's output. R3F
     runs same-priority frame callbacks in subscription order, and hooks subscribe
     top-to-bottom, so this call MUST stay above useIdleAnimation. Reverse them and the
     procedural pass reads a pose the mixer hasn't written yet, which reintroduces
     exactly the one-frame-stale fight that clipDrivenBones exists to prevent.
     (Raising the priority instead is not an option: any priority > 0 makes R3F hand
     the render loop over to us.) */
  const { actions, names } = useAnimations(animations, scene);

  const rig = useMemo(() => buildMorphRig(scene), [scene]);

  const bones = useMemo<AvatarBones>(() => {
    const find = (name: string): Object3D | null => scene.getObjectByName(name) ?? null;

    /* Bind pose, captured here on purpose. This runs during render — before the mixer's
       first useFrame — so these are the rig's authored orientations rather than a frame
       of whichever clip happens to be playing. The world matrices have to be current for
       the world quaternion to mean anything. */
    scene.updateMatrixWorld(true);
    const eyes: EyeRest[] = [];
    for (const name of ['LeftEye', 'RightEye']) {
      const bone = find(name);
      if (!bone) continue;
      eyes.push({
        bone,
        restLocal: bone.quaternion.clone(),
        restWorld: bone.getWorldQuaternion(new Quaternion()),
      });
    }

    return {
      head: find('Head'),
      neck: find('Neck'),
      spine: find('Spine2'),
      leftEye: find('LeftEye'),
      rightEye: find('RightEye'),
      eyes,
    };
  }, [scene]);

  /**
   * Which bones the idle clip animates, read off the clip's own tracks.
   *
   * Track names are "<boneName>.<property>" (e.g. "Spine2.quaternion"), so the bone is
   * everything before the final dot — split from the right, because rigs from some
   * exporters use dotted bone names.
   *
   * null when there is no clip, which tells useIdleAnimation to keep its original
   * cached-rest-pose behaviour.
   */
  const clipDrivenBones = useMemo(() => {
    const clip = animations?.[0];
    if (!clip) return null;
    const driven = new Set<string>();
    for (const track of clip.tracks) {
      const cut = track.name.lastIndexOf('.');
      if (cut > 0) driven.add(track.name.slice(0, cut));
    }
    return driven;
  }, [animations]);

  /**
   * Which clip plays for which state.
   *
   * Matched loosely rather than by exact string: Mixamo exports arrive named things like
   * "Armature|mixamo.com|Layer0", and the retarget step renames them, so a strict lookup
   * would silently leave the body frozen if either changed. Falls back to the first clip
   * in the file so a single-animation export still animates.
   */
  const clips = useMemo(() => {
    const find = (needle: string) =>
      names.find((n) => n.toLowerCase().includes(needle)) ?? null;
    return {
      idle: find('idle') ?? names[0] ?? null,
      // null until a talking clip is added to the glb — the avatar then simply stays
      // on its idle loop while speaking rather than breaking.
      talking: find('talk'),
    };
  }, [names]);

  const speaking = state === 'speaking';

  /* The talking clip is for FULL framing only.
     The bust camera is positioned once, on the head bone, and does not track. The
     greeting clip barely moves the torso so that holds; the talking clip gestures from
     the waist and swings the head clear of a 175px portrait crop. The chat panel keeps
     its idle loop, where real viseme lip-sync carries the talking anyway and body
     language isn't in shot. */
  const activeClip = (speaking && framing === 'full' && clips.talking) || clips.idle;

  /* Cross-fade between clips.
     The cleanup fades the outgoing action out while the incoming one fades in, which is
     what makes the swap a blend rather than a cut. Both clips must share a rest pose for
     this to look right — they do, being retargeted onto the same rig. */
  useEffect(() => {
    if (!activeClip) return;
    const action = actions[activeClip];
    if (!action) return;

    action.reset().setLoop(LoopRepeat, Infinity).fadeIn(CROSSFADE_SECONDS).play();
    return () => { action.fadeOut(CROSSFADE_SECONDS); };
  }, [actions, activeClip]);

  useEffect(() => {
    // Dev-only handle for the avatar lab: lets morph influences be read live while cues
    // play, which is the only practical way to confirm lip-sync is driving the right
    // shapes. Guarded so it never reaches a production bundle.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__avatarRig = rig;
      // Scene handle too: material state (depthWrite, renderOrder, metalness) is only
      // checkable on the live objects, and the eye-flicker class of bug lives there.
      (window as unknown as Record<string, unknown>).__avatarScene = scene;
      // Camera too, so the eye region can be inspected close up without rebuilding.
      (window as unknown as Record<string, unknown>).__avatarCamera = camera;
    }

    // useGLTF caches the scene across mounts, so influences left over from a previous
    // session would otherwise persist into this one as a stuck expression.
    rig.reset();

    // Pins the eye materials. Without this the transparent AO and eyelash shells fight
    // the opaque eyeball for depth every frame the head turns, which reads as the iris
    // flickering and changing colour. Idempotent, and the cached scene only needs it once.
    stabiliseEyeMaterials(scene);

    // GLTFLoader leaves every texture at anisotropy 1. On a curved surface that means
    // heavy over-blur with distance — worst on the eyes, where the iris dissolves into
    // the sclera. The GPU reports its own ceiling, so this is never a guess.
    applyMaxAnisotropy(scene, gl.capabilities.getMaxAnisotropy());

    // Reset visibility first: the cached scene may carry the other framing's hidden
    // meshes from a previous mount, which is how a full-body avatar ends up barefoot.
    for (const name of Object.values(HIDDEN_MESHES).flat()) {
      const mesh = scene.getObjectByName(name);
      if (mesh) mesh.visible = true;
    }
    for (const name of HIDDEN_MESHES[framing]) {
      const mesh = scene.getObjectByName(name);
      if (mesh) mesh.visible = false;
    }
  }, [scene, rig, framing, gl]);

  /* Camera framing.
     Done here rather than through <Canvas camera={…}> because the right position
     depends on the loaded rig's actual proportions, which the Canvas can't know at
     mount. This effect is the authority — anything set on the Canvas prop is overridden
     the moment the model loads. */
  useEffect(() => {
    if (framing === 'bust') {
      // Frame on the head bone's world position rather than hardcoded coordinates —
      // the rig's proportions change with body type, and a fixed camera would crop the face.
      const head = bones.head;
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
    // Clamped so the bind pose's outstretched arms don't dictate the framing — see
    // SILHOUETTE_WIDTH_RATIO.
    const fitWidth = Math.min(extent.x, extent.y * SILHOUETTE_WIDTH_RATIO);
    const forHeight = (extent.y * margin) / 2 / Math.tan(fovRad / 2);
    const forWidth = (fitWidth * margin) / 2 / Math.tan(fovRad / 2) / aspect;
    const distance = Math.max(forHeight, forWidth);

    camera.position.set(centre.x, centre.y, centre.z + distance);
    camera.lookAt(centre.x, centre.y, centre.z);
    camera.updateProjectionMatrix();
  }, [scene, bones, camera, framing, fitMargin, size.width, size.height]);

  useVisemeDriver({ rig, visemesRef, getPlaybackMs, speaking: state === 'speaking' });
  useIdleAnimation({ rig, bones, state, clipDrivenBones });

  return <primitive object={scene} />;
}

useGLTF.preload(AVATAR_URL);
