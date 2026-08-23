import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { NoToneMapping } from 'three';
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
  /** Forwarded to AvatarModel; changing it re-arms the greeting. See the note there. */
  greetKey?: string;
}

/**
 * The WebGL surface. Default-exported so it can be the target of a dynamic import —
 * three + R3F + drei is roughly 600 kB gzipped, which must not land in the main bundle
 * for the majority of visitors who never open voice mode.
 */
export default function AvatarCanvas({
  visemesRef, getPlaybackMs, state, framing, fitMargin, greetKey,
}: Props) {
  return (
    <Canvas
      // Capped: at a ~170px-tall canvas a full 2x retina render is invisible work, and
      // this widget shares the GPU with whatever page it's floating over.
      dpr={[1, 1.5]}
      // Only the FOV matters here. The position is a placeholder for the first frame —
      // AvatarModel repositions the camera from the loaded rig's real bounding box as
      // soon as the model resolves, because the right distance depends on its proportions.
      /* near/far deliberately tight. The old 0.01/50 was a 5000:1 ratio, which spends
         most of the depth buffer on empty space and leaves roughly 0.1 mm of depth
         resolution out at the full-body camera distance. 0.05/20 still clears the
         nearest geometry at bust framing and buys about 5x the precision. */
      camera={{ fov: FOV_BY_FRAMING[framing], near: 0.05, far: 20, position: [0, 1.6, 2] }}
      /* NoToneMapping is required, not a preference.
         R3F defaults gl.toneMapping to ACESFilmic, which is a filmic S-curve built for
         physically-lit PBR: it rolls off highlights and lifts shadows. MToon is a cel
         shader whose entire look is a hard step between a lit colour and a shade colour,
         both authored as final values. Running that through ACES desaturates the flats
         and softens the ramp into a gradient — the exact quality the toon shader exists
         to avoid. The model still renders, it just stops looking drawn. */
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false, toneMapping: NoToneMapping }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Lighting for MToon, which is NOT the three-point PBR setup this used to carry.

          The previous rig was lit with ambient 1.4 plus directionals at 2.6/0.9/1.6 —
          about 6.5 total, which is reasonable for PBR skin and catastrophic here. MToon
          clamps to its lit colour once the light exceeds it, so an over-lit MToon model
          doesn't read as "bright", it reads as a flat white silhouette: the shade colour
          never gets reached, and with it goes the entire toon ramp.

          MToon reads primarily off ONE dominant direction — the shading term is a step
          function of a single N·L, not an accumulation. So this is a key light with a
          token fill rather than a balanced three-point setup, and the ambient is low
          enough to leave the shade colour somewhere to live.

          No drei <Environment> on purpose: its presets pull an HDR from a CDN, which is
          a network dependency and a CSP problem for a widget that otherwise ships
          entirely from our own origin. MToon barely uses IBL anyway. */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[1.2, 2.2, 2.0]} intensity={1.2} />
      <directionalLight position={[-1.8, 1.2, 1.0]} intensity={0.3} />

      <Suspense fallback={null}>
        <AvatarModel
          visemesRef={visemesRef}
          getPlaybackMs={getPlaybackMs}
          state={state}
          framing={framing}
          fitMargin={fitMargin}
          greetKey={greetKey}
        />
      </Suspense>
    </Canvas>
  );
}
