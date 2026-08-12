import { useRef, useState } from 'react';
import { useVoiceSession } from '../hooks/useVoiceSession';
import type { Proposal } from '../api/suggestionsApi';

/**
 * Development-only harness for the voice pipeline (route: /__voice-lab, DEV builds only).
 *
 * Drives the REAL useVoiceSession hook against the hub's anonymous Diagnose method, which
 * streams synthetic chunks in exactly the shape a real turn produces. That isolates the
 * client half — wire casing, chunk parsing, state machine, PCM scheduling, viseme
 * collection, speech playback — from Gemini, Azure and the customer login, none of which
 * are available while debugging.
 *
 * `?api=` overrides the backend origin, so this can target a throwaway instance on another
 * port without disturbing a running dev server.
 */
export function VoiceLabPage() {
  const [log, setLog] = useState<string[]>([]);
  const [reply, setReply] = useState('');
  const visemeCount = useRef(0);

  const params = new URLSearchParams(window.location.search);
  const apiBaseUrl = params.get('api') ?? undefined;
  // ?mic=1 runs the microphone path. Intended for use with a synthetic recogniser
  // installed on window, which is the only way to exercise transcript handling in a check.
  const useMic = params.get('mic') === '1';

  const append = (line: string) =>
    setLog((prev) => [...prev, `${new Date().toISOString().slice(14, 23)}  ${line}`]);

  const voice = useVoiceSession({
    sampleRate: 24000,
    serverTtsAvailable: true,      // Diagnose sends real PCM, so exercise the audio path
    conversationId: null,
    hubMethod: 'Diagnose',
    hubPath: '/hubs/voice-diagnostics',
    apiBaseUrl,
    enableMic: useMic,
    onUserUtterance: (t) => append(`userUtterance: ${t}`),
    onReplyProgress: (r) => setReply(r),
    onReplyDone: (cid, r, proposals: Proposal[] | null) =>
      append(`replyDone: conv=${cid} len=${r.length} proposals=${proposals?.length ?? 0}`),
    onFailure: (m) => append(`FAILURE: ${m}`),
  });

  const run = () => {
    setLog([]);
    setReply('');
    visemeCount.current = 0;
    voice.sendText('diagnostic');
    // Sample the viseme buffer after the stream should have finished.
    window.setTimeout(() => {
      visemeCount.current = voice.visemesRef.current.length;
      append(`visemes collected: ${visemeCount.current}`);
      append(`playbackMs now: ${voice.getPlaybackMs()}`);
    }, 4000);
  };

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui', maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.05rem' }}>Voice pipeline lab (dev only)</h1>
      <p style={{ fontSize: '0.8rem', color: '#666' }}>
        API: <code>{apiBaseUrl ?? '(default)'}</code> · state: <b>{voice.state}</b> ·
        active: <b>{String(voice.active)}</b> · status: <i>{voice.status || '—'}</i>
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
        <button onClick={() => void voice.start()} disabled={voice.active}>1. Connect</button>
        <button onClick={run} disabled={!voice.active}>2. Run diagnostic turn</button>
        <button onClick={voice.stop} disabled={!voice.active}>Stop</button>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <strong style={{ fontSize: '0.8rem' }}>Streamed reply text:</strong>
        <div style={{ border: '1px solid #ccc', padding: '0.6rem', minHeight: 44, fontSize: '0.85rem' }}>
          {reply || <span style={{ color: '#999' }}>(nothing yet)</span>}
        </div>
      </div>

      <strong style={{ fontSize: '0.8rem' }}>Event log:</strong>
      <pre style={{
        border: '1px solid #ccc', padding: '0.6rem', fontSize: '0.72rem',
        maxHeight: 320, overflow: 'auto', background: '#fafafa',
      }}>
        {log.join('\n') || '(empty)'}
      </pre>
    </div>
  );
}
