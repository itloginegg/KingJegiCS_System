import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Object3D } from 'three';
import { buildMorphRig } from './morphRig';
import { useVisemeDriver } from './useVisemeDriver';
import { useIdleAnimation } from './useIdleAnimation';
import type { AvatarBones } from './useIdleAnimation';
import type { VisemeCue, VoiceState } from '../../hooks/useVoiceSession';

export const AVATAR_URL = '/avatar/assistant.glb';

/** Meshes worth hiding at a head-and-shoulders framing — never visible, always rendered. */
const HIDDEN_MESHES = ['avaturn_shoes_0'];

interface Props {
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs: () => number | null;
  state: VoiceState;
}

export function AvatarModel({ visemesRef, getPlaybackMs, state }: Props) {
  const { scene } = useGLTF(AVATAR_URL);
  const camera = useThree((s) => s.camera);

  const rig = useMemo(() => buildMorphRig(scene), [scene]);

  const bones = useMemo<AvatarBones>(() => {
    const find = (name: string): Object3D | null => scene.getObjectByName(name) ?? null;
    return {
      head: find('Head'),
      neck: find('Neck'),
      spine: find('Spine2'),
      leftEye: find('LeftEye'),
      rightEye: find('RightEye'),
    };
  }, [scene]);

  useEffect(() => {
    // Dev-only handle for the avatar lab: lets morph influences be read live while cues
    // play, which is the only practical way to confirm lip-sync is driving the right
    // shapes. Guarded so it never reaches a production bundle.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__avatarRig = rig;
    }

    // useGLTF caches the scene across mounts, so influences left over from a previous
    // session would otherwise persist into this one as a stuck expression.
    rig.reset();

    for (const name of HIDDEN_MESHES) {
      const mesh = scene.getObjectByName(name);
      if (mesh) mesh.visible = false;
    }

    // Frame on the head bone's actual world position rather than hardcoded coordinates —
    // the rig's proportions change with body type, and a fixed camera would crop the face.
    const head = bones.head;
    if (!head) return;
    head.updateWorldMatrix(true, false);
    const p = new Vector3().setFromMatrixPosition(head.matrixWorld);
    camera.position.set(p.x, p.y + 0.05, p.z + 0.62);
    camera.lookAt(p.x, p.y + 0.01, p.z);
    camera.updateProjectionMatrix();
  }, [scene, rig, bones, camera]);

  useVisemeDriver({ rig, visemesRef, getPlaybackMs, speaking: state === 'speaking' });
  useIdleAnimation({ rig, bones, state });

  return <primitive object={scene} />;
}

useGLTF.preload(AVATAR_URL);
