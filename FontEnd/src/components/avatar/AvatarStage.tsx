import { Component, Suspense, lazy, useMemo } from 'react';
import type { ReactNode } from 'react';
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
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs: () => number | null;
  state: VoiceState;
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

/** The pre-Phase-2 monogram, reused verbatim as every fallback. */
function AvatarFallback({ hint }: { hint?: string }) {
  return (
    <div className="cw-avatar-fallback" title={hint}>
      <div className="cw-glyph">KJ</div>
    </div>
  );
}

class AvatarErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Worth a console line: a silent fallback would otherwise hide a broken asset path.
    console.warn('[avatar] failed to render, falling back to the monogram', error);
  }

  render() {
    if (this.state.failed) return <AvatarFallback hint="Avatar unavailable" />;
    return this.props.children;
  }
}

export function AvatarStage({ visemesRef, getPlaybackMs, state }: Props) {
  // Probed once: creating a throwaway canvas per render is needless work, and neither
  // WebGL support nor the motion preference changes within a session in practice.
  const capable = useMemo(() => supportsWebGL() && !prefersReducedMotion(), []);

  if (!capable) return <AvatarFallback />;

  return (
    <div className="cw-avatar">
      <AvatarErrorBoundary>
        <Suspense fallback={<AvatarFallback />}>
          <AvatarCanvas visemesRef={visemesRef} getPlaybackMs={getPlaybackMs} state={state} />
        </Suspense>
      </AvatarErrorBoundary>
    </div>
  );
}
