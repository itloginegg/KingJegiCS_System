import type {
  AuthCredentials,
  AuthResponse,
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

/** Map the backend's role string onto the front end's two-role model. */
function toUserRole(backendRole: string): UserRole {
  return backendRole.toLowerCase() === 'customer' ? 'customer' : 'admin';
}

/** The API only returns an email, so derive a friendly display name from it. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : email;
}

export async function login(
  credentials: AuthCredentials,
): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${loginEndpoint(credentials.role)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    });
  } catch {
    // Network failure / server down / CORS rejection.
    throw new AuthError(
      'Unable to reach the server. Please check your connection and try again.',
    );
  }

  // 401 from the controller = wrong email/password or deactivated account.
  // The body carries a friendly message we can surface.
  if (res.status === 401) {
    const message = await readErrorMessage(res);
    throw new AuthError(message ?? 'Invalid email or password.');
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new AuthError(message ?? 'Something went wrong. Please try again.');
  }

  const data = (await res.json()) as BackendAuthResponse;

  const user: User = {
    id: data.id,
    email: data.email,
    name: nameFromEmail(data.email),
    role: toUserRole(data.role),
  };

  const expiresIn = Math.max(
    0,
    Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
  );

  return { user, token: data.token, expiresIn };
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

/** Pulls the `message` field out of the backend's error JSON, if present. */
async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}
