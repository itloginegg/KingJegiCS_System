import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { UserRole } from '../types/auth';
import { requestPasswordReset, resetPassword } from '../api/authApi';
import { hasErrors, validateEmail, validateNewPassword } from '../lib/validation';
import { AuthLayout } from '../components/auth/AuthLayout';
import { RoleTabs } from '../components/auth/RoleTabs';
import { OtpCodeInput } from '../components/auth/OtpCodeInput';
import { useAuth } from '../hooks/useAuth';
import { dashboardPathFor } from '../routes/paths';

/** Matches the backend's OtpOptions.ResendCooldownSeconds. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Forgot password, in two steps on one card — the same shape as registration's
 * verify step:
 *
 * 1. Email -> POST /forgot-password emails a 6-digit code.
 * 2. Code + new password -> POST /reset-password, then back to sign in.
 *
 * The backend never says whether the email has an account, and it hides its resend
 * cooldown for the same reason, so this page runs its own resend countdown instead
 * of relying on an error to slow people down.
 */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, user } = useAuth();

  // The sign-in form links here with its current tab, so an admin lands on Admin.
  const [role, setRole] = useState<UserRole>(
    searchParams.get('role') === 'admin' ? 'admin' : 'customer',
  );
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  // Set once a code has been requested; switches the card to step 2.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [passwords, setPasswords] = useState({ password: '', confirmPassword: '' });
  const [passwordErrors, setPasswordErrors] = useState<ReturnType<typeof validateNewPassword>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const uid = useId();
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;
  const confirmId = `${uid}-confirm`;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (isAuthenticated && user) {
    return <Navigate to={dashboardPathFor(user.role)} replace />;
  }

  const handleRequest = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const error = validateEmail(email);
    setEmailError(error);
    if (error) return;

    setSubmitting(true);
    try {
      const message = await requestPasswordReset(role, email.trim());
      setSentTo(email.trim());
      setNotice(message);
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not send the email. Try again shortly.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!sentTo || cooldown > 0) return;
    setResending(true);
    setFormError(null);
    setNotice(null);
    try {
      setNotice(await requestPasswordReset(role, sentTo));
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not send the email. Try again shortly.');
    } finally {
      setResending(false);
    }
  };

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!sentTo) return;
    setSubmitted(true);
    setFormError(null);
    setNotice(null);

    const errors = validateNewPassword(passwords);
    setPasswordErrors(errors);
    if (code.trim().length !== 6) {
      setFormError('Please enter the 6-digit code from your email.');
      return;
    }
    if (hasErrors(errors)) return;

    setSubmitting(true);
    try {
      await resetPassword(role, sentTo, code.trim(), passwords.password);
      navigate(`/login${role === 'admin' ? '?role=admin' : ''}`, {
        replace: true,
        state: { passwordResetEmail: sentTo },
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'We could not reset your password. Please try again.');
      setSubmitting(false);
    }
  };

  const setPassword = (name: keyof typeof passwords) => (value: string) => {
    const next = { ...passwords, [name]: value };
    setPasswords(next);
    if (submitted) setPasswordErrors(validateNewPassword(next));
  };

  const alerts = (
    <>
      {formError && (
        <div role="alert" className="ui-alert ui-alert--danger">
          <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="ui-alert ui-alert--success">
          <CheckCircle2 size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}
    </>
  );

  return (
    <AuthLayout
      brandTitle="Locked out? It happens."
      brandBody="We'll email you a code so you can choose a new password and get back to your events."
      title={sentTo ? 'Choose a new password' : 'Reset your password'}
      subtitle={
        sentTo
          ? `Enter the 6-digit code sent to ${sentTo}, then your new password.`
          : "Enter your account's email and we'll send you a reset code."
      }
      footer={<>Remembered it? <Link to={`/login${role === 'admin' ? '?role=admin' : ''}`}>Back to sign in</Link></>}
    >
      {sentTo ? (
        <form onSubmit={handleReset} noValidate className="au-form">
          {alerts}

          <div className="ui-field">
            <span className="ui-label" id={`${uid}-code-label`}>Reset code</span>
            <OtpCodeInput
              value={code}
              onChange={(next) => {
                setCode(next);
                if (formError) setFormError(null);
              }}
              disabled={submitting}
              ariaDescribedBy={`${uid}-code-label`}
            />
          </div>

          <div className="au-row">
            <div className="ui-field">
              <label htmlFor={passwordId} className="ui-label">New password</label>
              <div className="au-input-wrap">
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  name="newPassword"
                  autoComplete="new-password"
                  value={passwords.password}
                  onChange={(e) => setPassword('password')(e.target.value)}
                  aria-invalid={Boolean(passwordErrors.password)}
                  aria-describedby={passwordErrors.password ? `${passwordId}-error` : undefined}
                  placeholder="••••••••"
                  className={`ui-input${passwordErrors.password ? ' ui-input--invalid' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="au-reveal"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {passwordErrors.password && (
                <p id={`${passwordId}-error`} className="ui-error">{passwordErrors.password}</p>
              )}
            </div>

            <div className="ui-field">
              <label htmlFor={confirmId} className="ui-label">Confirm password</label>
              <input
                id={confirmId}
                type={showPassword ? 'text' : 'password'}
                name="confirmPassword"
                autoComplete="new-password"
                value={passwords.confirmPassword}
                onChange={(e) => setPassword('confirmPassword')(e.target.value)}
                aria-invalid={Boolean(passwordErrors.confirmPassword)}
                aria-describedby={passwordErrors.confirmPassword ? `${confirmId}-error` : undefined}
                placeholder="••••••••"
                className={`ui-input${passwordErrors.confirmPassword ? ' ui-input--invalid' : ''}`}
              />
              {passwordErrors.confirmPassword && (
                <p id={`${confirmId}-error`} className="ui-error">{passwordErrors.confirmPassword}</p>
              )}
            </div>
          </div>

          <p className="ui-hint" style={{ marginTop: -8 }}>
            At least 8 characters, with both uppercase and lowercase letters.
          </p>

          <button type="submit" disabled={submitting} className="ui-btn ui-btn-accent ui-btn-block">
            {submitting && <span className="ui-spinner" aria-hidden="true" />}
            {submitting ? 'Saving…' : 'Reset password'}
          </button>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || cooldown > 0}
              className="ui-btn ui-btn-ghost ui-btn-xs"
            >
              {resending ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSentTo(null);
                setCode('');
                setFormError(null);
                setNotice(null);
                setSubmitted(false);
                setPasswordErrors({});
              }}
              className="ui-btn ui-btn-ghost ui-btn-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              Use a different email
            </button>
          </div>
        </form>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <RoleTabs value={role} onChange={setRole} />
          </div>
          <form
            id="login-panel"
            role="tabpanel"
            aria-labelledby={`tab-${role}`}
            onSubmit={handleRequest}
            noValidate
            className="au-form"
          >
            {alerts}

            <div className="ui-field">
              <label htmlFor={emailId} className="ui-label">Email</label>
              <input
                id={emailId}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(validateEmail(e.target.value));
                }}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? `${emailId}-error` : undefined}
                placeholder="you@example.com"
                className={`ui-input${emailError ? ' ui-input--invalid' : ''}`}
              />
              {emailError && <p id={`${emailId}-error`} className="ui-error">{emailError}</p>}
            </div>

            <button type="submit" disabled={submitting} className="ui-btn ui-btn-accent ui-btn-block">
              {submitting && <span className="ui-spinner" aria-hidden="true" />}
              {submitting ? 'Sending…' : 'Send reset code'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
