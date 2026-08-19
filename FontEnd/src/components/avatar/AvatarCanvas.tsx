import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { AvatarModel } from './AvatarModel';
import { FOV_BY_FRAMING, type AvatarFraming } from './framing';
import type { VisemeCue, VoiceState } from '../../hooks/useVoiceSession';

interface Props {
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs: () => number | null;
  state: VoiceState;
  framing: AvatarFraming;
  /** Zoom for full-body framing; forwarded to AvatarModel. */
  fitMargin?: number;
}

/**
 * The WebGL surface. Default-exported so it can be the target of a dynamic import —
 * three + R3F + drei is roughly 600 kB gzipped, which must not land in the main bundle
 * for the majority of visitors who never open voice mode.
 */
export default function AvatarCanvas({ visemesRef, getPlaybackMs, state, framing, fitMargin }: Props) {
  return (
    <Canvas
      // Capped: at a ~170px-tall canvas a full 2x retina render is invisible work, and
      // this widget shares the GPU with whatever page it's floating over.
      dpr={[1, 1.5]}
      // Only the FOV matters here. The position is a placeholder for the first frame —
      // AvatarModel repositions the camera from the loaded rig's real bounding box as
      // soon as the GLB resolves, because the right distance depends on its proportions.
      /* near/far deliberately tight. The old 0.01/50 was a 5000:1 ratio, which spends
         most of the depth buffer on empty space and leaves roughly 0.1 mm of depth
         resolution out at the full-body camera distance — uncomfortably close to the
         0.76 mm gap between the eyeball and its AO shell. 0.05/20 still clears the
         nearest geometry at bust framing and buys about 5x the precision. */
      camera={{ fov: FOV_BY_FRAMING[framing], near: 0.05, far: 20, position: [0, 1.6, 2] }}
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
        <AvatarModel
          visemesRef={visemesRef}
          getPlaybackMs={getPlaybackMs}
          state={state}
          framing={framing}
          fitMargin={fitMargin}
        />
      </Suspense>
    </Canvas>
  );
}
