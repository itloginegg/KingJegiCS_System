import type {
  AdminRole,
  AuthCredentials,
  AuthResponse,
  LoginResult,
  RegistrationData,
  RegistrationFieldErrors,
  User,
  UserRole,
} from '../types/auth';

/**
 * Real auth API. Talks to the ASP.NET Core backend in
 * BackEnd/System_ApiTest (AdminsController / CustomersController).
 *
 * The selected role tab decides which login endpoint we hit, but the role we
 * actually trust comes from the server's response — never from the client.
 */

// Override with a `.env` value (VITE_API_BASE_URL) when the API is hosted
// elsewhere. Defaults to the backend's http dev URL (see launchSettings.json).
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

/** Shape returned by the backend's AuthResponseDto (Authdtos.cs). */
interface BackendAuthResponse {
  token: string;
  expiresAt: string; // ISO-8601 timestamp
  id: string;
  email: string;
  role: string; // "Customer" | "Owner" | "Assistant"
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Customer tab -> customers controller; admin tab -> admins controller. */
function loginEndpoint(role: UserRole): string {
  return role === 'admin' ? '/api/Admins/login' : '/api/Customers/login';
}

/**
 * Map the backend's role string onto the front end's role model.
 * The server issues "Customer", "Owner", or "Assistant" (see AuthResponseDto);
 * anything else is a contract violation we surface instead of guessing, so a
 * misconfigured account can never be routed to the wrong dashboard.
 *
 * `role` is what routing keys off, and "Owner" and "Assistant" still collapse
 * into 'admin' there because they share a dashboard. `adminRole` preserves which
 * of the two it was, for the Owner-only parts of that dashboard. Both fall out of
 * this one switch, so the raw string is validated exactly once.
 */
function toRoles(backendRole: string): { role: UserRole; adminRole?: AdminRole } {
  switch (backendRole.toLowerCase()) {
    case 'customer':
      return { role: 'customer' };
    case 'owner':
      return { role: 'admin', adminRole: 'Owner' };
    case 'assistant':
      return { role: 'admin', adminRole: 'Assistant' };
    default:
      throw new AuthError(
        `Your account has an unrecognized role ("${backendRole}"), so we can't open a dashboard for it. Please contact support.`,
      );
  }
}

/** The API only returns an email, so derive a friendly display name from it. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : email;
}

/** Maps the backend's AuthResponseDto onto the front end's session shape. */
function toAuthResponse(data: BackendAuthResponse): AuthResponse {
  const { role, adminRole } = toRoles(data.role);

  const user: User = {
    id: data.id,
    email: data.email,
    name: nameFromEmail(data.email),
    role,
    // JSON.stringify drops undefined, so a customer's stored session stays clean.
    adminRole,
  };

  const expiresIn = Math.max(
    0,
    Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
  );

  return { user, token: data.token, expiresIn };
}

/** POST JSON to the API, converting network failures into a friendly AuthError. */
async function postJson(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Network failure / server down / CORS rejection.
    throw new AuthError(
      'Unable to reach the server. Please check your connection and try again.',
    );
  }
}

export async function login(
  credentials: AuthCredentials,
): Promise<LoginResult> {
  const res = await postJson(loginEndpoint(credentials.role), {
    email: credentials.email,
    password: credentials.password,
  });

  // 401 from the controller = wrong email/password or deactivated account.
  // The body carries a friendly message we can surface.
  if (res.status === 401) {
    const message = await readMessage(res);
    throw new AuthError(message ?? 'Invalid email or password.');
  }

  if (!res.ok) {
    const message = await readMessage(res);
    throw new AuthError(message ?? 'Something went wrong. Please try again.');
  }

  // With OTP enabled, a correct password answers 200 { otpRequired: true }
  // instead of a token — the session is only issued at /login/verify-otp.
  const data = (await res.json()) as Partial<BackendAuthResponse> & {
    otpRequired?: boolean;
    message?: string;
  };

  if (data.otpRequired) {
    return {
      otpRequired: true,
      message:
        data.message ?? 'A 6-digit login code was sent to your email.',
    };
  }

  return { otpRequired: false, ...toAuthResponse(data as BackendAuthResponse) };
}

/**
 * Login step 2: POST the emailed code to the role's /login/verify-otp
 * endpoint and receive the JWT the password step withheld.
 */
export async function verifyLoginOtp(
  role: UserRole,
  email: string,
  code: string,
): Promise<AuthResponse> {
  const endpoint =
    role === 'admin'
      ? '/api/Admins/login/verify-otp'
      : '/api/Customers/login/verify-otp';

  const res = await postJson(endpoint, { email, code });

  if (!res.ok) {
    const message = await readMessage(res);
    throw new AuthError(message ?? 'Invalid or expired code.');
  }

  return toAuthResponse((await res.json()) as BackendAuthResponse);
}

/**
 * Registration step 2: POST /api/Customers/verify-email confirms the emailed
 * code and unlocks login. Resolves to the server's confirmation message.
 */
export async function verifyEmail(email: string, code: string): Promise<string> {
  const res = await postJson('/api/Customers/verify-email', { email, code });

  if (!res.ok) {
    const message = await readMessage(res);
    throw new AuthError(message ?? 'Invalid or expired code.');
  }

  return (await readMessage(res)) ?? 'Email verified. You can now log in.';
}

/**
 * POST /api/Customers/resend-verification. The backend enforces a 60-second
 * cooldown and deliberately answers the same way whether or not the account
 * exists, so the resolved message is always safe to display.
 */
export async function resendVerificationCode(email: string): Promise<string> {
  const res = await postJson('/api/Customers/resend-verification', { email });

  if (!res.ok) {
    const message = await readMessage(res);
    throw new AuthError(message ?? 'Could not send the email. Try again shortly.');
  }

  return (
    (await readMessage(res)) ??
    'If that account needs verification, a code has been sent.'
  );
}

export async function logout(
  token: string | null,
  role: UserRole = 'customer',
): Promise<void> {
  // Logout revokes the current token server-side; it needs the Bearer token.
  // Both controllers expose the same denylist-backed endpoint.
  if (!token) return;

  const endpoint =
    role === 'admin' ? '/api/Admins/logout' : '/api/Customers/logout';

  try {
    await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Best-effort: even if the server call fails, the client still clears its
    // own session, so swallow network errors here.
  }
}

/**
 * Registration failure. Carries per-field messages when the backend's
 * model validation (400 ValidationProblemDetails) named specific fields,
 * so the form can highlight them instead of showing one generic banner.
 */
export class RegistrationError extends AuthError {
  readonly fieldErrors: RegistrationFieldErrors;

  constructor(message: string, fieldErrors: RegistrationFieldErrors = {}) {
    super(message);
    this.name = 'RegistrationError';
    this.fieldErrors = fieldErrors;
  }
}

/** ASP.NET reports PascalCase DTO property names; map them to our fields. */
const SERVER_FIELD_MAP: Record<string, keyof RegistrationFieldErrors> = {
  fullname: 'fullName',
  email: 'email',
  phonenumber: 'phoneNumber',
  password: 'password',
};

/**
 * POST /api/Customers/register. Resolves on any 2xx (the backend answers
 * 201 Created); throws RegistrationError otherwise.
 */
export async function register(data: RegistrationData): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Customers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    throw new RegistrationError(
      'Unable to reach the server. Please check your connection and try again.',
    );
  }

  if (res.ok) return;

  // 409 = duplicate email; the body carries a friendly message.
  if (res.status === 409) {
    const message = await readMessage(res);
    throw new RegistrationError(message ?? 'An account with this email already exists.');
  }

  // 400 = data-annotation validation: { errors: { "Email": ["msg"], ... } }
  if (res.status === 400) {
    const fieldErrors: RegistrationFieldErrors = {};
    try {
      const body = (await res.json()) as { errors?: Record<string, string[]> };
      for (const [key, messages] of Object.entries(body.errors ?? {})) {
        const field = SERVER_FIELD_MAP[key.toLowerCase()];
        if (field && messages.length > 0) fieldErrors[field] = messages[0];
      }
    } catch {
      // Non-JSON body — fall through to the generic message.
    }
    throw new RegistrationError(
      Object.keys(fieldErrors).length > 0
        ? 'Please fix the highlighted fields.'
        : 'The server rejected the registration. Please review your details and try again.',
      fieldErrors,
    );
  }

  const message = await readMessage(res);
  throw new RegistrationError(message ?? 'Something went wrong. Please try again.');
}

/** Pulls the `message` field out of the backend's JSON body, if present. */
async function readMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}
