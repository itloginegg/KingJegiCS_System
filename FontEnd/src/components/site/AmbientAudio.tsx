import { useCallback, useEffect, useRef, useState } from 'react';
import { useAssistantHasAudio } from '../../lib/assistantVoice';

/**
 * Where the loop lives. Keep the file small — it downloads on the first browsing
 * page a visitor lands on, so target well under 1 MB and make sure it loops
 * seamlessly.
 *
 * Lowercase `.mp3` on purpose: the dev server and Windows are case-insensitive,
 * so an `audio.MP3` here would work locally and 404 on a case-sensitive host.
 */
const AUDIO_SRC = '/audio/ambient.mp3';

const STORAGE_KEY = 'kj.ambientAudio';

/**
 * Playback level once faded in.
 *
 * Not 1. This plays behind a page people are reading prices on, and a loop at
 * full scale stops being ambience and becomes the thing they are listening to —
 * the reflex it earns is the browser's tab-mute, not the toggle. A third leaves
 * it present but under the content.
 */
const TARGET_VOLUME = 0.32;

/**
 * Fades, one per reason the music starts or stops.
 *
 * IN is long because arriving music should be something a visitor notices after it
 * is already there. OUT is shorter because someone who just pressed mute wants it
 * now, and anything past about half a second reads as the button not having worked.
 * DUCK is shorter still: it fires when the assistant takes the audio channel, and
 * it has to be gone before her first syllable rather than fading underneath it.
 */
const FADE_IN_MS = 1200;
const FADE_OUT_MS = 550;
const DUCK_MS = 220;

/**
 * How long to wait after the assistant finishes before bringing the music back.
 *
 * Read-aloud arrives as separate utterances, and a reply can be spoken as more than
 * one. Coming back the instant a single utterance ends would swell the music into
 * the gap and duck it again a beat later, which is worse than staying down.
 */
const UNDUCK_HOLD_MS = 450;

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
 * Background music for the public browsing pages, with a mute toggle.
 *
 * Mounted once by AppRoutes rather than by each page — see AUDIO_ROUTES there for
 * why, and for which routes deliberately have no music. It stays mounted on those
 * silent routes too and takes `active={false}` instead of being torn down, so the
 * music fades out at the boundary rather than being cut mid-bar, and so returning
 * resumes where it left off: the element is the same one, and the un-mute the
 * autoplay policy granted it is still granted.
 *
 * TWO SEPARATE IDEAS, and keeping them apart is what makes the rest work:
 *
 *   `wantSound`  — what the visitor asked for. Only the toggle changes it, and it
 *                  is the only thing written to storage.
 *   `suppressed` — reasons for silence that are nobody's preference: this route
 *                  has no music, the tab is hidden, or the assistant is using the
 *                  speakers or the microphone.
 *
 * Audible is the conjunction. Collapsing the two — treating a duck as "the visitor
 * turned it off" — is the bug this shape exists to prevent: a trip to the cart or a
 * question to the assistant would silently clear a preference the visitor set, and
 * the toggle would flip to "Click to enable sound" while they were mid-sentence.
 *
 * The element is always `muted` and `autoPlay` at first, because every current browser
 * blocks UNMUTED autoplay — starting muted is the only way the loop is already running
 * when the visitor decides they want sound. Unmuting then needs no fresh load.
 *
 * Sound is therefore opt-in, and the choice is remembered. A returning visitor who
 * turned it on still can't be unmuted on load (the autoplay policy doesn't care what
 * they chose last time), so the preference arms a one-shot listener that unmutes on
 * their first interaction with the page instead.
 *
 * One platform caveat: iOS treats `volume` as read-only and hands level control to
 * the hardware switch, so the fades below are no-ops there and playback starts and
 * stops flat. Everything else still behaves.
 */
export function AmbientAudio({ active = true }: { active?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** What the visitor asked for — NOT whether sound is coming out right now. */
  const [wantSound, setWantSound] = useState(false);
  /** True when the file is missing or undecodable — the control hides entirely. */
  const [unavailable, setUnavailable] = useState(false);
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.hidden,
  );

  /* The assistant is talking or listening. Her voice and this loop share one pair of
     speakers, and during a call they also share a microphone. */
  const assistantHasAudio = useAssistantHasAudio();

  const suppressed = !active || hidden || assistantHasAudio;
  const audible = wantSound && !suppressed;

  /** In-flight fade, so a new one supersedes it instead of the two fighting tick by tick. */
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Bumped by every resume. A fade-out ends by pausing the element, and that tail
   * runs a beat after the ramp starts — long enough for the music to be wanted
   * again. Without this, the pause from the superseded fade would land on the
   * playback that replaced it and stop what just came back.
   */
  const generation = useRef(0);

  const cancelFade = useCallback(() => {
    if (fadeTimer.current !== null) {
      clearInterval(fadeTimer.current);
      fadeTimer.current = null;
    }
  }, []);

  /**
   * Ramps volume to `to`, resolving when it lands. Any previous ramp is dropped.
   *
   * A timer and not requestAnimationFrame, even though a rAF ramp is smoother.
   * rAF does not fire at all while the page isn't rendering, so a fade started
   * just before the tab was hidden would hang forever — and because callers await
   * this before pausing, the element would be left running unmuted with no fade
   * left to finish it. setInterval is throttled in a hidden tab but still fires,
   * and progress is measured against the wall clock rather than counted in ticks,
   * so the first late tick lands on the final value instead of crawling there.
   */
  const fadeTo = useCallback(
    (to: number, ms: number) =>
      new Promise<void>((resolve) => {
        const el = audioRef.current;
        if (!el) {
          resolve();
          return;
        }
        cancelFade();
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        const from = el.volume;
        if (ms <= 0 || Math.abs(to - from) < 0.001) {
          el.volume = clamp(to);
          resolve();
          return;
        }
        const started = performance.now();
        fadeTimer.current = setInterval(() => {
          const p = Math.min(1, (performance.now() - started) / ms);
          el.volume = clamp(from + (to - from) * p);
          if (p < 1) return;
          cancelFade();
          resolve();
        }, 16);
      }),
    [cancelFade],
  );

  /**
   * Bring the loop up to level, starting it if it is stopped. Idempotent, because
   * it is called both from the toggle and from the reconcile effect below.
   *
   * Returns whether sound is actually running — the autoplay policy can refuse,
   * and the UI must not claim a play state that isn't real.
   */
  const resume = useCallback(async (): Promise<boolean> => {
    const el = audioRef.current;
    if (!el) return false;
    generation.current += 1;
    el.muted = false;
    if (el.paused) {
      // From silence, so the ramp has somewhere to come from rather than punching
      // in at full level for the tick before the first fade step runs.
      el.volume = 0;
      try {
        await el.play();
      } catch {
        // Still blocked — leave it muted and wait for a real gesture.
        el.muted = true;
        el.volume = TARGET_VOLUME;
        return false;
      }
    }
    void fadeTo(TARGET_VOLUME, FADE_IN_MS);
    return true;
  }, [fadeTo]);

  /** Fade down and stop. Never touches the stored preference — callers decide that. */
  const quiet = useCallback(
    async (ms: number) => {
      const el = audioRef.current;
      if (!el) return;
      const mine = ++generation.current;
      await fadeTo(0, ms);
      if (generation.current !== mine) return; // a resume owns the element now
      el.muted = true;
      el.pause();
    },
    [fadeTo],
  );

  /* Track tab visibility as one more suppression reason rather than as its own
     pause/resume pathway — one reconcile below handles every reason the same way. */
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /**
   * Reconcile the element with `audible`.
   *
   * The fade length is chosen by WHY we are going quiet: a hidden tab gets no ramp
   * at all (nobody is listening, and a ramp would only delay a silence the visitor
   * asked for by switching away), the assistant gets the fast duck, and a route
   * change gets the ordinary fade.
   *
   * Coming back waits out UNDUCK_HOLD_MS first, and the cleanup cancels that timer —
   * so an assistant who starts a second utterance during the gap never lets the
   * music through.
   */
  useEffect(() => {
    if (!wantSound) return;

    if (suppressed) {
      void quiet(hidden ? 0 : assistantHasAudio ? DUCK_MS : FADE_OUT_MS);
      return;
    }

    const timer = setTimeout(() => { void resume(); }, UNDUCK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [wantSound, suppressed, hidden, assistantHasAudio, quiet, resume]);

  /**
   * Honour a saved "on" preference, retrying after the first gesture if the browser
   * refuses to start unmuted audio on load.
   *
   * Gated on `suppressed` so it cannot start the music underneath the assistant, and
   * so a visitor who reloads while on a silent route doesn't get a burst of audio the
   * moment they navigate onto one.
   */
  useEffect(() => {
    if (wantSound || suppressed || !savedPreference()) return;

    let disposed = false;
    const attempt = async () => {
      if (disposed) return true;
      const ok = await resume();
      if (ok && !disposed) setWantSound(true);
      return ok;
    };
    const onGesture = () => { void attempt(); cleanup(); };
    const cleanup = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };

    void attempt().then((ok) => {
      if (disposed || ok) return;
      window.addEventListener('pointerdown', onGesture, { once: true });
      window.addEventListener('keydown', onGesture, { once: true });
    });

    return () => { disposed = true; cleanup(); };
  }, [wantSound, suppressed, resume]);

  /* A ramp outliving the component would keep calling into a detached element. */
  useEffect(() => cancelFade, [cancelFade]);

  const toggle = useCallback(async () => {
    if (wantSound) {
      setWantSound(false);
      savePreference(false);
      void quiet(FADE_OUT_MS);
      return;
    }
    // This runs inside a click, so the autoplay policy is satisfied.
    const ok = await resume();
    setWantSound(ok);
    savePreference(ok);
  }, [wantSound, resume, quiet]);

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
      {active && !unavailable && (
        <>
          <style>{`
            /* Bottom-LEFT: the chat launcher owns bottom-right (fixed, right 1.5rem,
               bottom 1.5rem), so this corner is free and the two never overlap.
               z-index sits below the chat's 60 band so an open chat panel always wins. */
            .amb-toggle {
              position: fixed; left: 1.5rem; bottom: 1.5rem; z-index: 55;
              transition: background 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s, opacity 0.25s;
            }
            .amb-toggle:hover { color: var(--text-primary); border-color: var(--primary); }
            .amb-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

            /* Lifted clear of the bottom bars on small screens. Below 640px the
               rentals cart bar is full-width at bottom:0 and the menus plan bar is
               centred in the same band, and at 375px this control measurably
               overlapped BOTH. From 640px up the cart bar becomes a pill on the
               right and the plan bar's centred box clears the left corner (22px of
               gap at 768px), so the corner is free and it drops back down. */
            /* Below 768px the rentals cart bar is a full-width strip and publishes its
               height as --kj-bottom-bar-h, so the toggle sits just above it however
               many lines it wraps to. Below 640px the old fixed lift stays as a floor,
               for MenuPage's plan bar, which doesn't publish a height. */
            @media (max-width: 767px) { .amb-toggle { bottom: calc(1.5rem + var(--kj-bottom-bar-h, 0px)); } }
            @media (max-width: 640px) { .amb-toggle { bottom: max(5.5rem, calc(1.5rem + var(--kj-bottom-bar-h, 0px))); } }

            /* Slow breathing ring while sound is actually coming out — the one cue
               that separates "playing" from "muted" once the text label is gone. */
            .amb-toggle.is-audible { animation: ambPulse 3.2s ease-in-out infinite; }
            @keyframes ambPulse {
              0%, 100% { box-shadow: var(--shadow-lg), 0 0 0 0 var(--accent-muted); }
              50%      { box-shadow: var(--shadow-lg), 0 0 0 6px transparent; }
            }

            /* Ducked: the visitor's setting is still ON, so the control keeps saying
               so — it just steps back while the assistant has the floor rather than
               pulsing away as though it were still playing. */
            .amb-toggle.is-ducked { opacity: 0.55; }

            @media (prefers-reduced-motion: reduce) {
              .amb-toggle, .amb-toggle.is-audible { animation: none; transition: none; }
            }
          `}</style>
          <button
            type="button"
            className={`amb-toggle${audible ? ' is-audible' : ''}${wantSound && !audible ? ' is-ducked' : ''}`}
            onClick={() => void toggle()}
            /* aria-pressed follows the SETTING, not the momentary level. A duck is
               not the visitor un-pressing the button, and announcing it as one would
               tell a screen-reader user their choice had been undone. */
            aria-pressed={wantSound}
            aria-label={
              wantSound
                ? assistantHasAudio
                  ? 'Mute background music (paused while the assistant is speaking)'
                  : 'Mute background music'
                : 'Play background music'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              /* Muted is the state that needs explaining, so it carries a text label. A
                 lone speaker glyph doesn't tell a first-time visitor that there IS audio
                 and it's currently suppressed. Once it's playing the icon alone is
                 unambiguous, so the button shrinks back to a circle. */
              padding: wantSound ? '0' : '0.5rem 0.9rem',
              width: wantSound ? 40 : 'auto',
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
            <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>{wantSound ? '🔊' : '🔇'}</span>
            {!wantSound && <span>Click to enable sound</span>}
          </button>
        </>
      )}
    </>
  );
}
