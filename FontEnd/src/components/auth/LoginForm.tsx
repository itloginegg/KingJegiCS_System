import { useId, useState, type FormEvent } from 'react';
import type { AuthCredentials, FieldErrors, UserRole } from '../../types/auth';
import { hasErrors, validateCredentials } from '../../lib/validation';

interface LoginFormProps {
  role: UserRole;
  submitting: boolean;
  /** Top-level error from the auth attempt (e.g. "Invalid email or password"). */
  formError: string | null;
  onSubmit: (credentials: AuthCredentials) => void;
}

export function LoginForm({ role, submitting, formError, onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Only show field errors once the user has tried to submit, to avoid
  // yelling at them before they've finished typing.
  const [submitted, setSubmitted] = useState(false);

  // Stable, unique ids tie inputs to their labels and error messages (a11y).
  const emailId = useId();
  const passwordId = useId();
  const emailErrId = `${emailId}-error`;
  const passwordErrId = `${passwordId}-error`;

  const runValidation = (next?: Partial<{ email: string; password: string }>) => {
    const result = validateCredentials({
      email: next?.email ?? email,
      password: next?.password ?? password,
    });
    setErrors(result);
    return result;
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    const result = runValidation();
    if (hasErrors(result)) return;
    onSubmit({ email: email.trim(), password, rememberMe, role });
  };

  return (
    <form
      id="login-panel"
      role="tabpanel"
      aria-labelledby={`tab-${role}`}
      onSubmit={handleSubmit}
      noValidate
      className="mt-6 space-y-5"
    >
      {/* Top-level auth error (server-side). role="alert" announces it to SRs. */}
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor={emailId} className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (submitted) runValidation({ email: e.target.value });
          }}
          aria-invalid={submitted && Boolean(errors.email)}
          aria-describedby={errors.email ? emailErrId : undefined}
          placeholder="you@example.com"
          className={fieldClasses(submitted && Boolean(errors.email))}
        />
        {submitted && errors.email && (
          <p id={emailErrId} className="text-sm text-red-600">
            {errors.email}
          </p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={passwordId} className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <a href="/forgot-password" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            Forgot password?
          </a>
        </div>
        <div className="relative">
          <input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (submitted) runValidation({ password: e.target.value });
            }}
            aria-invalid={submitted && Boolean(errors.password)}
            aria-describedby={errors.password ? passwordErrId : undefined}
            placeholder="••••••••"
            className={`${fieldClasses(submitted && Boolean(errors.password))} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-sm font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-r-lg"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {submitted && errors.password && (
          <p id={passwordErrId} className="text-sm text-red-600">
            {errors.password}
          </p>
        )}
      </div>

      {/* Remember me */}
      <label className="flex items-center gap-2.5 text-sm text-slate-600 select-none">
        <input
          type="checkbox"
          name="rememberMe"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
        Remember me on this device
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : `Sign in as ${role === 'admin' ? 'Admin' : 'Customer'}`}
      </button>
    </form>
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
