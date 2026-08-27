import { Component, Suspense, lazy, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { AvatarFraming } from './framing';
import type { VisemeCue, VoiceState } from '../../hooks/useVoiceSession';

/**
 * Everything guarding the 3D avatar, so the chat widget can never be broken by it.
 *
 * Three separate ways out, because a WebGL canvas has three separate ways to fail: the
 * browser may not support it, the user may have asked for reduced motion, and a 3 MB
 * binary may simply not load. Each falls back to the monogram the widget used before
 * Phase 2 — a text conversation must never be blocked by a missing avatar.
 */

// Dynamic import keeps three/R3F/drei out of the main bundle entirely.
const AvatarCanvas = lazy(() => import('./AvatarCanvas'));

interface Props {
  /**
   * Live voice-session plumbing. All optional, so the avatar can render with no session
   * attached — which is what the persistent on-page figure does: it stands and idles
   * until someone actually starts talking to it.
   */
  visemesRef?: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs?: () => number | null;
  state?: VoiceState;
  /** Defaults to the chat-panel bust. */
  framing?: AvatarFraming;
  /**
   * Height of the in-panel bust, in px. Feeds `--cw-avatar-size`, which the CSS
   * clamps rather than applies raw — so a caller can ask for any figure without
   * being able to push the stage past the panel on a short window.
   *
   * Ignored for `full` framing: the standing figure is sized by `.cw-standing`,
   * where the stage is `height: 100%` of a fixed column.
   */
  size?: number;
  /** Zoom for full-body framing. Lower fills more of the frame. Ignored for `bust`. */
  fitMargin?: number;
  /** Forwarded to AvatarModel; changing it re-arms the greeting. See the note there. */
  greetKey?: string;
  /**
   * What to show when 3D can't run — no WebGL, reduced motion, or a render error.
   *
   * The monogram is right inside the chat panel, where it reads as an avatar badge. It
   * is wrong for the standing figure: a floating "KJ" tile where a person should be
   * looks broken, so that caller passes its own fallback instead.
   */
  fallback?: ReactNode;
  /**
   * What to show while the 3D chunk and model are still downloading. Defaults to
   * `fallback`, which is right for the in-panel banner.
   *
   * Kept SEPARATE from `fallback` because the two mean opposite things: this one says
   * "3D is on its way", the other says "3D is never happening". Conflating them bit
   * once already — a caller whose fallback was an <img> with an onError handler tore
   * the avatar down the moment that image 404'd, even though WebGL was available and
   * the model was mid-download. Pass null here to show nothing while loading.
   */
  loadingFallback?: ReactNode;
}

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Default bust height. Down from the 175px the CSS used to hardcode — the stage
 * was taking a third of a short chat panel before a single message showed.
 */
const DEFAULT_BUST_SIZE = 150;

/** The pre-Phase-2 monogram, reused verbatim as every fallback. */
function AvatarFallback({ hint, size }: { hint?: string; size?: number }) {
  /* The fallback is a sibling of the stage, not a child, so the variable has to
     be set on it directly — otherwise the monogram would keep the old fixed box
     while the 3D stage followed the prop. */
  const sized =
    size === undefined
      ? undefined
      : ({ '--cw-avatar-size': `${size}px` } as React.CSSProperties);
  return (
    <div className="cw-avatar-fallback" title={hint} style={sized}>
      <div className="cw-glyph">KJ</div>
    </div>
  );
}

class AvatarErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Worth a console line: a silent fallback would otherwise hide a broken asset path.
    console.warn('[avatar] failed to render, falling back', error);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * Stand-in for a session that doesn't exist.
 *
 * A shared frozen empty array would be a hazard — useVisemeDriver splices cues out of
 * this ref as it consumes them, so every session-less avatar needs its own.
 */
const NO_PLAYBACK = () => null;

export function AvatarStage({
  visemesRef,
  getPlaybackMs = NO_PLAYBACK,
  state = 'idle',
  framing = 'bust',
  size = DEFAULT_BUST_SIZE,
  fitMargin,
  greetKey,
  fallback,
  loadingFallback,
}: Props) {
  // Probed once: creating a throwaway canvas per render is needless work, and neither
  // WebGL support nor the motion preference changes within a session in practice.
  const capable = useMemo(() => supportsWebGL() && !prefersReducedMotion(), []);

  const ownVisemes = useRef<VisemeCue[]>([]);
  const visemes = visemesRef ?? ownVisemes;

  const onFailure = fallback ?? <AvatarFallback size={size} />;
  // `undefined` means "not specified" and inherits the failure node; an explicit null
  // means "show nothing while loading" and must be honoured.
  const whileLoading = loadingFallback === undefined ? onFailure : loadingFallback;

  if (!capable) return <>{onFailure}</>;

  return (
    <div
      className={framing === 'full' ? 'cw-avatar cw-avatar--full' : 'cw-avatar'}
      style={{ '--cw-avatar-size': `${size}px` } as React.CSSProperties}
    >
      <AvatarErrorBoundary fallback={onFailure}>
        <Suspense fallback={<>{whileLoading}</>}>
          <AvatarCanvas
            visemesRef={visemes}
            getPlaybackMs={getPlaybackMs}
            state={state}
            framing={framing}
            fitMargin={fitMargin}
            greetKey={greetKey}
          />
        </Suspense>
      </AvatarErrorBoundary>
    </div>
  );
}
