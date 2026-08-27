import type {
  AuthCredentials,
  FieldErrors,
  RegistrationData,
  RegistrationFieldErrors,
} from '../types/auth';

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

export function hasErrors(
  errors: FieldErrors | RegistrationFieldErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

/* ── Registration ───────────────────────────────────────────────────────────
   These mirror the backend's CustomerRegistrationDto annotations exactly, so
   anything that passes here should also pass server validation. */

/** E.164: leading '+', country code, 7–15 digits total. */
const E164_RE = /^\+[1-9]\d{6,14}$/;

/** 8+ characters with at least one lowercase and one uppercase letter. */
const PASSWORD_STRENGTH_RE = /^(?=.*[a-z])(?=.*[A-Z]).{8,}$/;

export function validateRegistration(
  values: RegistrationData & { confirmPassword: string },
): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};

  const fullName = values.fullName.trim();
  if (!fullName) {
    errors.fullName = 'Full name is required.';
  } else if (fullName.length > 200) {
    errors.fullName = 'Full name must be 200 characters or fewer.';
  }

  const email = values.email.trim();
  if (!email) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(email) || email.length > 254) {
    errors.email = 'Enter a valid email address.';
  }

  const phone = values.phoneNumber.trim();
  if (!phone) {
    errors.phoneNumber = 'Phone number is required.';
  } else if (!E164_RE.test(phone)) {
    errors.phoneNumber =
      'Use international format with a country code, e.g. +639171234567.';
  }

  if (!values.password) {
    errors.password = 'Password is required.';
  } else if (!PASSWORD_STRENGTH_RE.test(values.password)) {
    errors.password =
      'At least 8 characters, with both uppercase and lowercase letters.';
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password.';
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}
