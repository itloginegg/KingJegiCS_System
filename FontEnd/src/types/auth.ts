// Core authentication domain types (strict-mode friendly).

/** The two supported user roles. Kept as a string-literal union so it is
 *  exhaustively checkable in switches and usable as an index/key. */
export type UserRole = 'customer' | 'admin';

/** A user as returned by the backend after a successful login.
 *  Never store secrets (password, raw token) on this shape. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
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

/** Per-field validation errors. Keys mirror the form fields so a component
 *  can do `errors.email` with full type safety. */
export type FieldErrors = Partial<Record<'email' | 'password', string>>;
