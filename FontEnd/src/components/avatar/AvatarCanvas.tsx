import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { AvatarModel } from './AvatarModel';
import type { VisemeCue, VoiceState } from '../../hooks/useVoiceSession';

interface Props {
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs: () => number | null;
  state: VoiceState;
}

/**
 * The WebGL surface. Default-exported so it can be the target of a dynamic import —
 * three + R3F + drei is roughly 600 kB gzipped, which must not land in the main bundle
 * for the majority of visitors who never open voice mode.
 */
export default function AvatarCanvas({ visemesRef, getPlaybackMs, state }: Props) {
  return (
    <Canvas
      // Capped: at a ~170px-tall canvas a full 2x retina render is invisible work, and
      // this widget shares the GPU with whatever page it's floating over.
      dpr={[1, 1.5]}
      camera={{ fov: 20, near: 0.01, far: 20, position: [0, 1.6, 0.6] }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Three-point setup. No drei <Environment> on purpose: its presets pull an HDR
          from a CDN, which is a network dependency and a CSP problem for a widget that
          otherwise ships entirely from our own origin. */}
      <ambientLight intensity={1.4} />
      <directionalLight position={[1.2, 2.2, 2.0]} intensity={2.6} />
      <directionalLight position={[-1.8, 1.2, 1.0]} intensity={0.9} />
      <directionalLight position={[0, 1.4, -2.2]} intensity={1.6} />

      <Suspense fallback={null}>
        <AvatarModel visemesRef={visemesRef} getPlaybackMs={getPlaybackMs} state={state} />
      </Suspense>
    </Canvas>
  );
}
