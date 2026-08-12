import { useRef, useState } from 'react';
import { AvatarStage } from '../components/avatar/AvatarStage';
import type { VisemeCue, VoiceState } from '../hooks/useVoiceSession';
import { AZURE_VISEME_TO_TARGET } from '../components/avatar/visemeMap';

/**
 * Development-only harness for the avatar (route: /__avatar-lab, DEV builds only).
 *
 * Exists because the real avatar lives behind a customer login inside a floating widget,
 * driven by audio from a paid TTS key — which makes "did that morph target actually
 * move?" almost impossible to answer during development. This drives the exact same
 * AvatarStage from synthetic cues instead, so lip-sync and idle behaviour can be tuned
 * without an account, a microphone, or an Azure subscription.
 *
 * Not reachable in production: AppRoutes only registers it under import.meta.env.DEV.
 */
export function AvatarLabPage() {
  const visemesRef = useRef<VisemeCue[]>([]);
  const [state, setState] = useState<VoiceState>('idle');
  const [playing, setPlaying] = useState(false);
  const startedAt = useRef(0);

  // Stands in for the AudioContext clock the real session provides.
  const getPlaybackMs = () => (playing ? performance.now() - startedAt.current : null);

  /** Fires every viseme id in turn so each of the 15 mouth shapes can be eyeballed. */
  const runSweep = () => {
    const cues: VisemeCue[] = [];
    const step = 220;
    for (let id = 0; id < AZURE_VISEME_TO_TARGET.length; id += 1) {
      cues.push({ visemeId: id, offsetMs: id * step });
    }
    const total = AZURE_VISEME_TO_TARGET.length * step;
    visemesRef.current = cues;
    startedAt.current = performance.now();
    setPlaying(true);
    setState('speaking');
    window.setTimeout(() => {
      setPlaying(false);
      setState('idle');
      visemesRef.current = [];
    }, total + 400);
  };

  /** Rough approximation of natural speech cadence, for judging the smoothing constants. */
  const runChatter = () => {
    const cues: VisemeCue[] = [];
    let t = 0;
    for (let i = 0; i < 90; i += 1) {
      cues.push({ visemeId: 1 + Math.floor(Math.random() * 21), offsetMs: t });
      t += 60 + Math.random() * 90;
    }
    visemesRef.current = cues;
    startedAt.current = performance.now();
    setPlaying(true);
    setState('speaking');
    window.setTimeout(() => {
      setPlaying(false);
      setState('idle');
      visemesRef.current = [];
    }, t + 400);
  };

  const states: VoiceState[] = ['idle', 'connecting', 'listening', 'thinking', 'speaking'];

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Avatar lab (dev only)</h1>

        {/* Same width as the real widget panel, so framing is judged at the true size. */}
        <div style={{ width: 370, border: '1px solid #ccc', borderRadius: 12, overflow: 'hidden' }}>
          <AvatarStage visemesRef={visemesRef} getPlaybackMs={getPlaybackMs} state={state} />
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={runSweep}>Sweep all visemes</button>
          <button onClick={runChatter}>Simulate speech</button>
        </div>

        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {states.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              style={{ fontWeight: state === s ? 700 : 400 }}
            >
              {s}
            </button>
          ))}
        </div>

        <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#666', maxWidth: 370 }}>
          Move the cursor around the page to exercise gaze tracking. “thinking” should break
          eye contact and glance away.
        </p>
      </div>
    </div>
  );
}
