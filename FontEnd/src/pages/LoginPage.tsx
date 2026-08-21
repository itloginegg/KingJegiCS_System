import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { AuthCredentials, UserRole } from '../types/auth';
import { useAuth } from '../hooks/useAuth';
import { RoleTabs } from '../components/auth/RoleTabs';
import { LoginForm } from '../components/auth/LoginForm';
import { dashboardPathFor } from '../routes/paths';

interface RedirectState {
  /** ProtectedRoute stores the whole location, so this can carry a query string too. */
  from?: { pathname: string; search?: string };
  /** Set by RegisterPage after a successful sign-up. */
  registeredEmail?: string;
}

export function LoginPage() {
  const { login, status, error, isAuthenticated, user, verifyLoginOtp } = useAuth();
  const [role, setRole] = useState<UserRole>('customer');
  const [otpStep, setOtpStep] = useState(false);
  const [pendingCredentials, setPendingCredentials] = useState<AuthCredentials | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Already signed in? Skip the form entirely.
  if (isAuthenticated && user) {
    return <Navigate to={dashboardPathFor(user.role)} replace />;
  }

  const handleSubmit = async (credentials: AuthCredentials) => {
    setOtpError(null);
    try {
      const signedInUser = await login(credentials);
      if (signedInUser.otpRequired) {
        setPendingCredentials(credentials);
        setOtpCode('');
        setOtpStep(true);
        return;
      }

      // Prefer the page the user was originally headed to (set by ProtectedRoute),
      // otherwise fall back to the role's default dashboard.
      const state = location.state as RedirectState | null;
      // Keep the query string as well — dropping it lost things like ?tab=payments,
      // landing the user on the right page but the wrong view.
      const target = state?.from
        ? `${state.from.pathname}${state.from.search ?? ''}`
        : dashboardPathFor(signedInUser.user.role);
      navigate(target, { replace: true });
    } catch {
      setOtpStep(false);
      setPendingCredentials(null);
      // Error is already surfaced via auth state; nothing else to do here.
    }
  };

  const handleOtpSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!pendingCredentials) return;

    const code = otpCode.trim();
    if (code.length !== 6) {
      setOtpError('Please enter the 6-digit code from your email.');
      return;
    }

    setOtpSubmitting(true);
    setOtpError(null);

    try {
      const verifiedUser = await verifyLoginOtp({
        role: pendingCredentials.role,
        email: pendingCredentials.email,
        code,
        rememberMe: pendingCredentials.rememberMe,
      });

      const state = location.state as RedirectState | null;
      const target = state?.from?.pathname ?? dashboardPathFor(verifiedUser.role);
      navigate(target, { replace: true });
    } catch {
      setOtpError('We could not verify the code. Please try again.');
    } finally {
      setOtpSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-subtle)] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-lg)] sm:p-8">
          <header className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-[var(--text-muted)]">
              Sign in to your KingJegi account
            </p>
          </header>

          {/* Fresh from registration — confirm it worked and prompt sign-in. */}
          {(location.state as RedirectState | null)?.registeredEmail && (
            <div
              role="status"
              className="mt-5 rounded-lg border border-[var(--border-accent)] bg-[var(--primary-muted)] px-4 py-3 text-sm text-[var(--primary)]"
            >
              Account created for{' '}
              <strong>{(location.state as RedirectState).registeredEmail}</strong>.
              Sign in below to get started.
            </div>
          )}

          <div className="mt-6">
            <RoleTabs value={role} onChange={setRole} />
          </div>

          {otpStep && pendingCredentials ? (
            <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-5">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Verify your sign-in</h2>
                <p className="text-sm text-[var(--text-secondary)]">
                  Enter the 6-digit code sent to{' '}
                  <span className="font-medium text-[var(--text-primary)]">{pendingCredentials.email}</span>.
                </p>
              </div>

              {otpError && (
                <div role="alert" className="mt-4 rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-muted)] px-4 py-3 text-sm text-[var(--danger)]">
                  {otpError}
                </div>
              )}

              <form onSubmit={handleOtpSubmit} className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="otp-code" className="block text-sm font-medium text-[var(--text-secondary)]">
                    Verification code
                  </label>
                  <input
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otpCode}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/\D/g, '').slice(0, 6);
                      setOtpCode(nextValue);
                      if (otpError) setOtpError(null);
                    }}
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 text-center text-lg font-semibold tracking-[0.35em] text-[var(--text-primary)] shadow-sm placeholder:text-[var(--text-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    placeholder="123456"
                  />
                </div>

                <button
                  type="submit"
                  disabled={otpSubmitting || status === 'authenticating'}
                  className="flex w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-text)] shadow-sm transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {otpSubmitting || status === 'authenticating' ? 'Verifying…' : 'Verify code'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => {
                  setOtpStep(false);
                  setPendingCredentials(null);
                  setOtpCode('');
                  setOtpError(null);
                }}
                className="mt-4 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <LoginForm
              role={role}
              submitting={status === 'authenticating'}
              formError={error}
              onSubmit={handleSubmit}
            />
          )}
        </div>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-medium text-[var(--primary)] hover:text-[var(--accent)]">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
