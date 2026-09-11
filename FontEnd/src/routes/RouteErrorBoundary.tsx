import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render error anywhere below it and shows something other than a white
 * page.
 *
 * WHY IT WRAPS <Routes> AND NOTHING ELSE. The only error boundary this app had
 * was AvatarStage's, which covers the VRM canvas — so a throw in any page
 * unmounted the entire tree and left a blank document, site chrome and all.
 *
 * The wrapping is deliberately tight. It does NOT include the providers, because
 * an error thrown by AuthProvider or CartProvider is not fixed by re-rendering
 * the same providers and catching it here would hide it behind a panel that can't
 * help. It also does NOT include the ambient-audio element or the chat widget,
 * which are siblings of <Routes>: those two exist precisely because they survive
 * navigation, and pulling them inside a boundary that can remount would undo that.
 *
 * No `key` on it either, and no reset-on-navigate. React will not re-render a
 * crashed subtree until its state is reset, so both recovery paths below are a
 * full document load — the reload button, and a plain <a href> rather than a
 * router Link. That sidesteps the reset problem instead of half-solving it, and
 * avoids keying on pathname, which would remount the admin dashboard whenever it
 * moved between /admin and /admin/booking-histories.
 */
interface Props {
  children: ReactNode;
  /** Where "Back to safety" should go. */
  homeHref?: string;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as console.error rather than swallowed: there is no error-reporting
    // service wired up yet, and a crash that leaves no trace anywhere is worse
    // than one in the console. Point this at a reporter when one exists.
    console.error('[route] render failed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const home = this.props.homeHref ?? '/';

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: 'var(--bg)',
        }}
      >
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '0.68rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              margin: '0 0 0.75rem',
            }}
          >
            Something went wrong
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(1.5rem, 4vw, 2rem)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
              margin: '0 0 0.75rem',
            }}
          >
            This page didn't load properly.
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '0.9rem',
              lineHeight: 1.55,
              color: 'var(--text-secondary)',
              margin: '0 0 1.75rem',
            }}
          >
            Nothing you were working on has been sent. Try again, or head back and
            start over — if it keeps happening, let us know what you were doing.
          </p>
          <div style={{ display: 'flex', gap: '0.7rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              /* A full reload, not a state reset: whatever made the render throw is
                 still in memory, and re-rendering the same tree usually just throws
                 again. */
              onClick={() => window.location.reload()}
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-text)',
                border: 'none',
                borderRadius: 'var(--r-full)',
                padding: '0.8rem 1.6rem',
                fontFamily: 'var(--font-body)',
                fontSize: '0.7rem',
                fontWeight: 500,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <a
              href={home}
              style={{
                background: 'transparent',
                color: 'var(--primary)',
                border: '1px solid var(--border-accent)',
                borderRadius: 'var(--r-full)',
                padding: '0.8rem 1.6rem',
                fontFamily: 'var(--font-body)',
                fontSize: '0.7rem',
                fontWeight: 500,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                textDecoration: 'none',
              }}
            >
              Back to safety
            </a>
          </div>
        </div>
      </div>
    );
  }
}
