// Core authentication domain types (strict-mode friendly).

/** The two supported user roles. Kept as a string-literal union so it is
 *  exhaustively checkable in switches and usable as an index/key. */
export type UserRole = 'customer' | 'admin';

/** The backend's two admin roles, kept separate from UserRole. Both collapse to
 *  'admin' for routing — they share a dashboard — but the Owner-only parts of that
 *  dashboard still need to tell them apart. */
export type AdminRole = 'Owner' | 'Assistant';

/** A user as returned by the backend after a successful login.
 *  Never store secrets (password, raw token) on this shape. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Which admin role, when `role` is 'admin'; absent for customers.
   *  Also absent on sessions persisted before this field existed — readSession
   *  casts stored JSON straight to User, so the compiler cannot catch that.
   *  Treat undefined as "not the Owner" and fail closed. */
  adminRole?: AdminRole;
  avatarUrl?: string;
}

/** Credentials submitted by the login form.
 *  `role` here is only a UX hint from the selected tab — the server is the
 *  source of truth for the user's actual role. */
export interface AuthCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
  role: UserRole;
}

/** Discriminated-union status keeps impossible states unrepresentable
 *  (e.g. you can't be `authenticated` with a null user). */
export type AuthStatus =
  | 'idle'
  | 'authenticating'
  | 'authenticated'
  | 'error';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  /** Top-level error message for the last failed auth attempt. */
  error: string | null;
}

/** Shape of a successful auth API response. */
export interface AuthResponse {
  user: User;
  token: string;
  /** Seconds until the token expires; useful for refresh scheduling. */
  expiresIn: number;
}

/** Outcome of the password step. When the server has email OTP enabled, a
 *  correct password returns a challenge instead of a session — the JWT is only
 *  issued after the emailed code is confirmed at /login/verify-otp. */
export type LoginResult =
  | ({ otpRequired: false } & AuthResponse)
  | { otpRequired: true; message: string };

/** Login step 2: the emailed 6-digit code plus the context from step 1. */
export interface OtpVerification {
  role: UserRole;
  email: string;
  code: string;
  rememberMe: boolean;
}

/** Per-field validation errors. Keys mirror the form fields so a component
 *  can do `errors.email` with full type safety. */
export type FieldErrors = Partial<Record<'email' | 'password', string>>;

/** Data submitted by the registration form (mirrors CustomerRegistrationDto). */
export interface RegistrationData {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
}

/** Field errors for the registration form (client- or server-reported). */
export type RegistrationFieldErrors = Partial<
  Record<'fullName' | 'email' | 'phoneNumber' | 'password' | 'confirmPassword', string>
>;
