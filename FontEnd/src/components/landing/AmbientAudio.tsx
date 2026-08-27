import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Where the loop lives. Keep the file small — it downloads on every landing-page
 * visit, so target well under 1 MB and make sure it loops seamlessly.
 */
const AUDIO_SRC = '/audio/ambient.mp3';

const STORAGE_KEY = 'kj.ambientAudio';

/** Reads the saved preference. Defaults to off. */
function savedPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    // Private mode / storage disabled — treat as no preference rather than crashing.
    return false;
  }
}

function savePreference(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Nothing to do; the toggle still works for this session.
  }
}

/**
 * Background music for the landing page, with a mute toggle.
 *
 * The element is always `muted` and `autoPlay` at first, because every current browser
 * blocks UNMUTED autoplay — starting muted is the only way the loop is already running
 * when the visitor decides they want sound. Unmuting then needs no fresh load.
 *
 * Sound is therefore opt-in, and the choice is remembered. A returning visitor who
 * turned it on still can't be unmuted on load (the autoplay policy doesn't care what
 * they chose last time), so the preference arms a one-shot listener that unmutes on
 * their first interaction with the page instead.
 */
export function AmbientAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  /** True when the file is missing or undecodable — the control hides entirely. */
  const [unavailable, setUnavailable] = useState(false);
  /**
   * Set when the tab is hidden while sound was on, so `visibilitychange` knows to
   * resume on return — as opposed to a tab that comes back to a deliberately muted
   * page, which must stay silent.
   */
  const resumeOnReturn = useRef(false);

  const enable = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return false;
    el.muted = false;
    try {
      await el.play();
      setPlaying(true);
      return true;
    } catch {
      // Still blocked — leave it muted and wait for a real gesture.
      el.muted = true;
      setPlaying(false);
      return false;
    }
  }, []);

  // Honour a saved "on" preference, retrying after the first gesture if the browser
  // refuses to start unmuted audio on load.
  useEffect(() => {
    if (!savedPreference()) return;

    let disposed = false;
    const onGesture = () => { if (!disposed) void enable(); cleanup(); };
    const cleanup = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };

    void enable().then((ok) => {
      if (disposed || ok) return;
      window.addEventListener('pointerdown', onGesture, { once: true });
      window.addEventListener('keydown', onGesture, { once: true });
    });

    return () => { disposed = true; cleanup(); };
  }, [enable]);

  /* Music from a tab you can't see is just noise from an unknown source, so pause on
     hide and pick back up on return — but only if it was actually playing. */
  useEffect(() => {
    const onVisibility = () => {
      const el = audioRef.current;
      if (!el) return;

      if (document.hidden) {
        resumeOnReturn.current = playing;
        if (playing) el.pause();
        return;
      }
      if (resumeOnReturn.current) {
        resumeOnReturn.current = false;
        // Returning to a tab isn't a user gesture, so this can still be refused;
        // reflect that in the UI rather than showing a play state that isn't real.
        void el.play().then(
          () => setPlaying(true),
          () => setPlaying(false),
        );
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [playing]);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;

    if (playing) {
      el.muted = true;
      el.pause();
      setPlaying(false);
      savePreference(false);
      return;
    }
    // This runs inside a click, so the autoplay policy is satisfied.
    const ok = await enable();
    savePreference(ok);
  }, [playing, enable]);

  return (
    <>
      <audio
        ref={audioRef}
        src={AUDIO_SRC}
        loop
        muted
        autoPlay
        preload="auto"
        onError={() => setUnavailable(true)}
      />
      {!unavailable && (
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? 'Mute background music' : 'Play background music'}
          aria-pressed={playing}
          style={{
            /* Bottom-LEFT: the chat launcher owns bottom-right (fixed, right 1.5rem,
               bottom 1.5rem), so this corner is free and the two never overlap.
               z-index sits below the chat's 60 band so an open chat panel always wins. */
            position: 'fixed',
            left: '1.5rem',
            bottom: '1.5rem',
            zIndex: 55,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            /* Muted is the state that needs explaining, so it carries a text label. A
               lone speaker glyph doesn't tell a first-time visitor that there IS audio
               and it's currently suppressed. Once it's playing the icon alone is
               unambiguous, so the button shrinks back to a circle. */
            padding: playing ? '0' : '0.5rem 0.9rem',
            width: playing ? 40 : 'auto',
            height: 40,
            borderRadius: 'var(--r-full)',
            justifyContent: 'center',
            border: '1px solid var(--border-accent)',
            background: 'var(--surface)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-lg)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.72rem',
            fontWeight: 300,
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>{playing ? '🔊' : '🔇'}</span>
          {!playing && <span>Click to enable sound</span>}
        </button>
      )}
    </>
  );
}
