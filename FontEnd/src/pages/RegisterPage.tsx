import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { RegistrationFieldErrors } from '../types/auth';
import {
  register,
  RegistrationError,
  resendVerificationCode,
  verifyEmail,
} from '../api/authApi';
import { hasErrors, validateRegistration } from '../lib/validation';
import { PhoneNumberInput } from '../components/forms/PhoneNumberInput';
import { formatPhPhone, toE164 } from '../lib/phone';
import { useAuth } from '../hooks/useAuth';
import { dashboardPathFor } from '../routes/paths';

/**
 * Customer self-registration. Talks to POST /api/Customers/register and, on
 * success, shows an inline email verification step so the account can be
 * confirmed before the user signs in.
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

  const field = (
    name: keyof typeof values,
    label: string,
    input: React.ReactNode,
  ) => (
    <div className="space-y-1.5">
      <label
        htmlFor={fieldId(name)}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
      </label>
      {input}
      {submitted && errors[name] && (
        <p id={errId(name)} className="text-sm text-red-600">
          {errors[name]}
        </p>
      )}
    </div>
  );

  const inputProps = (name: keyof typeof values) => ({
    id: fieldId(name),
    value: values[name],
    onChange: setField(name),
    'aria-invalid': submitted && Boolean(errors[name]),
    'aria-describedby': submitted && errors[name] ? errId(name) : undefined,
    className: fieldClasses(submitted && Boolean(errors[name])),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
          <header className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {verificationEmail ? 'Verify your email' : 'Create your account'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              {verificationEmail
                ? 'Enter the code we sent to your inbox to confirm your account.'
                : 'Book events, order menus, and track everything in one place'}
            </p>
          </header>

          {verificationEmail ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Verification sent to</p>
                <p className="text-sm text-slate-900">{verificationEmail}</p>
              </div>

              {verificationError && (
                <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {verificationError}
                </div>
              )}

              {verificationSuccess && (
                <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {verificationSuccess}
                </div>
              )}

              <form onSubmit={handleVerificationSubmit} className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="verification-code" className="block text-sm font-medium text-slate-700">
                    Verification code
                  </label>
                  <input
                    id="verification-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/\D/g, '').slice(0, 6);
                      setVerificationCode(nextValue);
                      if (verificationError) setVerificationError(null);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-center text-lg font-semibold tracking-[0.35em] text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    placeholder="123456"
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifyingEmail}
                  className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {verifyingEmail ? 'Verifying…' : 'Verify email'}
                </button>
              </form>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendingCode}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="text-sm font-medium text-slate-600 hover:text-slate-800"
                >
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
              {/* Server-side failure (e.g. "email already exists"). */}
              {formError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {formError}
                </div>
              )}

              {field(
                'fullName',
                'Full name',
                <input
                  {...inputProps('fullName')}
                  type="text"
                  name="fullName"
                  autoComplete="name"
                  placeholder="Juan Dela Cruz"
                />,
              )}

              {field(
                'email',
                'Email',
                <input
                  {...inputProps('email')}
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                />,
              )}

              {field(
                'phoneNumber',
                'Phone number',
                <PhoneNumberInput
                  {...inputProps('phoneNumber')}
                  name="phoneNumber"
                  value={formatPhPhone(values.phoneNumber)}
                  onChange={setPhoneNumber}
                />,
              )}

              {field(
                'password',
                'Password',
                <div className="relative">
                  <input
                    {...inputProps('password')}
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={`${fieldClasses(submitted && Boolean(errors.password))} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-sm font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>,
              )}
              <p className="-mt-3 text-xs text-slate-400">
                At least 8 characters, mixing uppercase and lowercase letters.
              </p>

              {field(
                'confirmPassword',
                'Confirm password',
                <input
                  {...inputProps('confirmPassword')}
                  type={showPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder="••••••••"
                />,
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Back to Login
          </Link>
        </p>
      </div>
    </main>
  );
}

function fieldClasses(invalid: boolean): string {
  return [
    'w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm',
    'placeholder:text-slate-400 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
    invalid
      ? 'border-red-400 focus-visible:ring-red-500'
      : 'border-slate-300 focus-visible:ring-indigo-500',
  ].join(' ');
}
