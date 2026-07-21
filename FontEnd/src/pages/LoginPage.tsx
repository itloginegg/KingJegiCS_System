import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { AuthCredentials, UserRole } from '../types/auth';
import { useAuth } from '../hooks/useAuth';
import { RoleTabs } from '../components/auth/RoleTabs';
import { LoginForm } from '../components/auth/LoginForm';
import { dashboardPathFor } from '../routes/paths';

interface RedirectState {
  from?: { pathname: string };
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
      const target = state?.from?.pathname ?? dashboardPathFor(signedInUser.user.role);
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
          <header className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Sign in to your KingJegi account
            </p>
          </header>

          {/* Fresh from registration — confirm it worked and prompt sign-in. */}
          {(location.state as RedirectState | null)?.registeredEmail && (
            <div
              role="status"
              className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
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
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-slate-900">Verify your sign-in</h2>
                <p className="text-sm text-slate-600">
                  Enter the 6-digit code sent to{' '}
                  <span className="font-medium text-slate-800">{pendingCredentials.email}</span>.
                </p>
              </div>

              {otpError && (
                <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {otpError}
                </div>
              )}

              <form onSubmit={handleOtpSubmit} className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="otp-code" className="block text-sm font-medium text-slate-700">
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-center text-lg font-semibold tracking-[0.35em] text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    placeholder="123456"
                  />
                </div>

                <button
                  type="submit"
                  disabled={otpSubmitting || status === 'authenticating'}
                  className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="mt-4 text-sm font-medium text-slate-600 hover:text-slate-800"
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

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-700">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
