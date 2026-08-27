import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { RegistrationFieldErrors } from '../types/auth';
import {
  register,
  RegistrationError,
  resendVerificationCode,
  verifyEmail,
} from '../api/authApi';
import { hasErrors, validateRegistration } from '../lib/validation';
import { PhoneNumberInput } from '../components/forms/PhoneNumberInput';
import { AuthLayout } from '../components/auth/AuthLayout';
import { OtpCodeInput } from '../components/auth/OtpCodeInput';
import { formatPhPhone, toE164 } from '../lib/phone';
import { useAuth } from '../hooks/useAuth';
import { dashboardPathFor } from '../routes/paths';

/**
 * Customer self-registration. Talks to POST /api/Customers/register and, on
 * success, shows an inline email verification step so the account can be
 * confirmed before the user signs in.
 *
 * The card became the shared two-panel shell, and the verification step now
 * drives OtpCodeInput rather than its own letter-spaced text field — the same
 * change made on the sign-in side, so both codes behave identically.
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();

  const [values, setValues] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<RegistrationFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState<string | null>(null);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  // Field errors only appear after the first submit attempt.
  const [submitted, setSubmitted] = useState(false);

  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;
  const errId = (name: string) => `${uid}-${name}-error`;

  // Already signed in? Registration makes no sense — go to the dashboard.
  if (isAuthenticated && user) {
    return <Navigate to={dashboardPathFor(user.role)} replace />;
  }

  const setField =
    (name: keyof typeof values) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = { ...values, [name]: e.target.value };
      setValues(next);
      if (submitted) setErrors(validateRegistration(next));
    };

  /**
   * The phone field shows the "+63 000-000-0000" mask but `values.phoneNumber`
   * stays canonical E.164 — both validateRegistration() and the server's
   * `^\+[1-9]\d{6,14}$` annotation reject anything with spaces or dashes.
   */
  const setPhoneNumber = (masked: string) => {
    const next = { ...values, phoneNumber: toE164(masked) };
    setValues(next);
    if (submitted) setErrors(validateRegistration(next));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    setVerificationError(null);
    setVerificationSuccess(null);

    const clientErrors = validateRegistration(values);
    setErrors(clientErrors);
    if (hasErrors(clientErrors)) return;

    setSubmitting(true);
    try {
      await register({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        phoneNumber: values.phoneNumber.trim(),
        password: values.password,
      });

      setVerificationEmail(values.email.trim());
      setVerificationCode('');
      setVerificationSuccess('Account created. Enter the 6-digit code we sent to your email to verify it.');
    } catch (err) {
      if (err instanceof RegistrationError) {
        setFormError(err.message);
        if (hasErrors(err.fieldErrors)) {
          setErrors(err.fieldErrors);
        }
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerificationSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!verificationEmail) return;

    const code = verificationCode.trim();
    if (code.length !== 6) {
      setVerificationError('Please enter the 6-digit verification code.');
      return;
    }

    setVerifyingEmail(true);
    setVerificationError(null);
    setVerificationSuccess(null);

    try {
      const message = await verifyEmail(verificationEmail, code);
      setVerificationSuccess(message);
      setVerificationCode('');
      setTimeout(() => {
        navigate('/login', { state: { registeredEmail: verificationEmail } });
      }, 800);
    } catch (err) {
      setVerificationError(
        err instanceof Error ? err.message : 'We could not verify the code. Please try again.',
      );
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleResendCode = async () => {
    if (!verificationEmail) return;

    setResendingCode(true);
    setVerificationError(null);
    setVerificationSuccess(null);

    try {
      const message = await resendVerificationCode(verificationEmail);
      setVerificationSuccess(message);
    } catch (err) {
      setVerificationError(
        err instanceof Error ? err.message : 'Could not send the code. Please try again shortly.',
      );
    } finally {
      setResendingCode(false);
    }
  };

  const invalid = (name: keyof typeof values) => submitted && Boolean(errors[name]);

  const inputProps = (name: keyof typeof values) => ({
    id: fieldId(name),
    value: values[name],
    onChange: setField(name),
    'aria-invalid': invalid(name),
    'aria-describedby': invalid(name) ? errId(name) : undefined,
    className: `ui-input${invalid(name) ? ' ui-input--invalid' : ''}`,
  });

  const field = (name: keyof typeof values, label: string, input: React.ReactNode) => (
    <div className="ui-field">
      <label htmlFor={fieldId(name)} className="ui-label">{label}</label>
      {input}
      {invalid(name) && <p id={errId(name)} className="ui-error">{errors[name]}</p>}
    </div>
  );

  return (
    <AuthLayout
      brandTitle="One account for every celebration."
      brandBody="Book events, order menus, and track everything in one place."
      brandFoot={
        <div className="au-brand-note">
          <div className="au-brand-note-kicker">After you submit</div>
          <p>
            This card swaps to <em>Verify your email</em> — six code boxes, a resend
            link, then a redirect to sign in.
          </p>
        </div>
      }
      title={verificationEmail ? 'Verify your email' : 'Create your account'}
      subtitle={
        verificationEmail
          ? `Enter the 6-digit code we sent to ${verificationEmail}.`
          : 'Book events, order menus, and track everything in one place'
      }
      footer={
        verificationEmail ? undefined : (
          <>Already have an account? <Link to="/login">Sign in</Link></>
        )
      }
    >
      {verificationEmail ? (
        <form onSubmit={handleVerificationSubmit} className="au-form">
          {verificationError && (
            <div role="alert" className="ui-alert ui-alert--danger">
              <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{verificationError}</span>
            </div>
          )}

          {verificationSuccess && (
            <div role="status" className="ui-alert ui-alert--success">
              <CheckCircle2 size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{verificationSuccess}</span>
            </div>
          )}

          <div className="ui-field">
            <span className="ui-label" id="verify-label">Verification code</span>
            <OtpCodeInput
              value={verificationCode}
              onChange={(next) => {
                setVerificationCode(next);
                if (verificationError) setVerificationError(null);
              }}
              disabled={verifyingEmail}
              invalid={Boolean(verificationError)}
              ariaDescribedBy="verify-label"
            />
          </div>

          <button type="submit" disabled={verifyingEmail} className="ui-btn ui-btn-accent ui-btn-block">
            {verifyingEmail && <span className="ui-spinner" aria-hidden="true" />}
            {verifyingEmail ? 'Verifying…' : 'Verify email'}
          </button>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <button
              type="button"
              onClick={handleResendCode}
              disabled={resendingCode}
              className="ui-btn ui-btn-ghost ui-btn-xs"
            >
              {resendingCode ? 'Sending…' : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setVerificationEmail(null);
                setVerificationCode('');
                setVerificationError(null);
                setVerificationSuccess(null);
              }}
              className="ui-btn ui-btn-ghost ui-btn-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              Use a different email
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="au-form">
          {/* Server-side failure (e.g. "email already exists"). */}
          {formError && (
            <div role="alert" className="ui-alert ui-alert--danger">
              <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {field('fullName', 'Full name',
            <input {...inputProps('fullName')} type="text" name="fullName" autoComplete="name" placeholder="Juan Dela Cruz" />)}

          {field('email', 'Email',
            <input {...inputProps('email')} type="email" name="email" autoComplete="email" inputMode="email" placeholder="you@example.com" />)}

          {field('phoneNumber', 'Phone number',
            <PhoneNumberInput
              {...inputProps('phoneNumber')}
              name="phoneNumber"
              value={formatPhPhone(values.phoneNumber)}
              onChange={setPhoneNumber}
            />)}

          {/* Password and its confirmation share a row: they are one decision, and
              stacking them pushed the submit button under the fold on a laptop. */}
          <div className="au-row">
            <div className="ui-field">
              <label htmlFor={fieldId('password')} className="ui-label">Password</label>
              <div className="au-input-wrap">
                <input
                  {...inputProps('password')}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
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
              {invalid('password') && <p id={errId('password')} className="ui-error">{errors.password}</p>}
            </div>

            {field('confirmPassword', 'Confirm password',
              <input
                {...inputProps('confirmPassword')}
                type={showPassword ? 'text' : 'password'}
                name="confirmPassword"
                autoComplete="new-password"
                placeholder="••••••••"
              />)}
          </div>

          <p className="ui-hint" style={{ marginTop: -8 }}>
            At least 8 characters, with both uppercase and lowercase letters.
          </p>

          <button type="submit" disabled={submitting} className="ui-btn ui-btn-accent ui-btn-block">
            {submitting && <span className="ui-spinner" aria-hidden="true" />}
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
