import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { AuthCredentials, UserRole } from '../types/auth';
import { useAuth } from '../hooks/useAuth';
import { AuthLayout, AuthStats } from '../components/auth/AuthLayout';
import { RoleTabs } from '../components/auth/RoleTabs';
import { LoginForm } from '../components/auth/LoginForm';
import { OtpCodeInput } from '../components/auth/OtpCodeInput';
import { dashboardPathFor } from '../routes/paths';

interface RedirectState {
  /** ProtectedRoute stores the whole location, so this can carry a query string too. */
  from?: { pathname: string; search?: string };
  /** Set by RegisterPage after a successful sign-up. */
  registeredEmail?: string;
}

const PROOF = [
  { value: '500+', label: 'Events Served' },
  { value: '4.9 ★', label: 'Client Rating' },
];

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

  const verifying = otpSubmitting || status === 'authenticating';
  const registeredEmail = (location.state as RedirectState | null)?.registeredEmail;

  return (
    <AuthLayout
      brandTitle="Every event you've booked, in one place."
      brandBody="Track quotes, deposits and delivery status without waiting on a reply."
      brandFoot={<AuthStats stats={PROOF} />}
      title={otpStep ? 'Verify your sign-in' : 'Welcome back'}
      subtitle={
        otpStep && pendingCredentials
          ? `Enter the 6-digit code sent to ${pendingCredentials.email}.`
          : 'Sign in to your KingJegi account'
      }
      footer={
        otpStep ? undefined : (
          <>Don&apos;t have an account? <Link to="/register">Create one</Link></>
        )
      }
    >
      {/* Fresh from registration — confirm it worked and prompt sign-in. */}
      {!otpStep && registeredEmail && (
        <div role="status" className="ui-alert ui-alert--success" style={{ marginBottom: 18 }}>
          <CheckCircle2 size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>
            Account created for <strong>{registeredEmail}</strong>. Sign in below to get started.
          </span>
        </div>
      )}

      {otpStep && pendingCredentials ? (
        <form onSubmit={handleOtpSubmit} className="au-form">
          {otpError && (
            <div role="alert" className="ui-alert ui-alert--danger">
              <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{otpError}</span>
            </div>
          )}

          <div className="ui-field">
            <span className="ui-label" id="otp-label">Verification code</span>
            {/* The page used to render its own single letter-spaced field here, so the
                sign-in OTP and the registration OTP behaved differently — no
                auto-advance, no paste-the-whole-code. Both flows now drive the same
                component. */}
            <OtpCodeInput
              value={otpCode}
              onChange={(next) => {
                setOtpCode(next);
                if (otpError) setOtpError(null);
              }}
              disabled={verifying}
              invalid={Boolean(otpError)}
              ariaDescribedBy="otp-label"
            />
          </div>

          <button type="submit" disabled={verifying} className="ui-btn ui-btn-accent ui-btn-block">
            {verifying && <span className="ui-spinner" aria-hidden="true" />}
            {verifying ? 'Verifying…' : 'Verify code'}
          </button>

          <button
            type="button"
            onClick={() => {
              setOtpStep(false);
              setPendingCredentials(null);
              setOtpCode('');
              setOtpError(null);
            }}
            className="ui-btn ui-btn-outline ui-btn-block ui-btn-sm"
          >
            Back to sign in
          </button>
        </form>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <RoleTabs value={role} onChange={setRole} />
          </div>
          <LoginForm
            role={role}
            submitting={status === 'authenticating'}
            formError={error}
            onSubmit={handleSubmit}
          />
        </>
      )}
    </AuthLayout>
  );
}
