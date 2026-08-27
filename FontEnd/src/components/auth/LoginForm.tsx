import { useId, useState, type FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
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

  const emailInvalid = submitted && Boolean(errors.email);
  const passwordInvalid = submitted && Boolean(errors.password);

  return (
    <form
      id="login-panel"
      role="tabpanel"
      aria-labelledby={`tab-${role}`}
      onSubmit={handleSubmit}
      noValidate
      className="au-form"
    >
      {/* Top-level auth error (server-side). role="alert" announces it to SRs. */}
      {formError && (
        <div role="alert" className="ui-alert ui-alert--danger">
          <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}

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
            if (submitted) runValidation({ email: e.target.value });
          }}
          aria-invalid={emailInvalid}
          aria-describedby={errors.email ? emailErrId : undefined}
          placeholder="you@example.com"
          className={`ui-input${emailInvalid ? ' ui-input--invalid' : ''}`}
        />
        {emailInvalid && <p id={emailErrId} className="ui-error">{errors.email}</p>}
      </div>

      <div className="ui-field">
        <div className="ui-label-row">
          <label htmlFor={passwordId} className="ui-label">Password</label>
          <a href="/forgot-password" className="au-inline-link">Forgot password?</a>
        </div>
        <div className="au-input-wrap">
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
            aria-invalid={passwordInvalid}
            aria-describedby={errors.password ? passwordErrId : undefined}
            placeholder="••••••••"
            className={`ui-input${passwordInvalid ? ' ui-input--invalid' : ''}`}
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
        {passwordInvalid && <p id={passwordErrId} className="ui-error">{errors.password}</p>}
      </div>

      <label className="ui-check">
        <input
          type="checkbox"
          name="rememberMe"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />
        Remember me on this device
      </label>

      <button type="submit" disabled={submitting} className="ui-btn ui-btn-accent ui-btn-block">
        {submitting && <span className="ui-spinner" aria-hidden="true" />}
        {submitting ? 'Signing in…' : `Sign in as ${role === 'admin' ? 'Admin' : 'Customer'}`}
      </button>
    </form>
  );
}
