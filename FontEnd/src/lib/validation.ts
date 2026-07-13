import type { AuthCredentials, FieldErrors } from '../types/auth';

// Pragmatic email check — good enough for client UX; the server still validates.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 8;

/**
 * Validates the credentials and returns a typed map of field errors.
 * An empty object means "valid".
 */
export function validateCredentials(
  values: Pick<AuthCredentials, 'email' | 'password'>,
): FieldErrors {
  const errors: FieldErrors = {};

  const email = values.email.trim();
  if (!email) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!values.password) {
    errors.password = 'Password is required.';
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
