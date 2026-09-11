import type { User } from '../types/auth';

/**
 * Token persistence helper.
 *
 * - `rememberMe: true`  -> localStorage  (survives browser restart)
 * - `rememberMe: false` -> sessionStorage (cleared when tab closes)
 *
 * SECURITY CAVEAT: storing tokens in Web Storage exposes them to XSS. For a
 * production app prefer an httpOnly, Secure, SameSite cookie set by the server.
 * This module is structured so you can swap the implementation in one place.
 */

const TOKEN_KEY = 'kj_auth_token';
const USER_KEY = 'kj_auth_user';
/**
 * When the server said this token stops being valid, as epoch milliseconds.
 *
 * The login response has always carried this (`expiresAt`, turned into
 * `expiresIn` by authApi) and it used to be dropped on the floor, which is why a
 * stale session still looked signed in: `readSession` only ever asked whether a
 * token STRING was present, never whether it was still any good.
 */
const EXPIRY_KEY = 'kj_auth_expires_at';

interface PersistPayload {
  token: string;
  user: User;
  rememberMe: boolean;
  /** Seconds from now, straight off the login response. */
  expiresIn?: number;
}

function pickStore(rememberMe: boolean): Storage {
  return rememberMe ? window.localStorage : window.sessionStorage;
}

export function persistSession({ token, user, rememberMe, expiresIn }: PersistPayload): void {
  // Clear the other store first so a session can't linger in two places.
  clearSession();
  const store = pickStore(rememberMe);
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(user));
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn)) {
    store.setItem(EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
  }
}

export function clearSession(): void {
  for (const store of [window.localStorage, window.sessionStorage]) {
    store.removeItem(TOKEN_KEY);
    store.removeItem(USER_KEY);
    store.removeItem(EXPIRY_KEY);
  }
}

/**
 * Reads whichever store currently holds a session. Returns null if none — and
 * null, not the session, once the token's own expiry has passed.
 *
 * Expiring here rather than only in AuthProvider is deliberate: this is what
 * every caller outside React reads (the API modules, the voice session), so a
 * check that lived only in the provider would still hand a dead token to every
 * fetch on the page.
 *
 * A session saved before this key existed has no expiry recorded. Those are
 * treated as live rather than as expired, so shipping this doesn't sign out
 * everyone who is currently logged in; the server still rejects the token if it
 * really has lapsed, and the 401 path below picks that up.
 */
export function readSession(): { token: string; user: User } | null {
  for (const store of [window.localStorage, window.sessionStorage]) {
    const token = store.getItem(TOKEN_KEY);
    const rawUser = store.getItem(USER_KEY);
    if (token && rawUser) {
      if (sessionExpiredIn(store)) {
        clearSession();
        return null;
      }
      try {
        return { token, user: JSON.parse(rawUser) as User };
      } catch {
        // Corrupted payload — treat as no session.
        return null;
      }
    }
  }
  return null;
}

function sessionExpiredIn(store: Storage): boolean {
  const raw = store.getItem(EXPIRY_KEY);
  if (!raw) return false; // legacy session, no expiry recorded — see readSession
  const at = Number(raw);
  return Number.isFinite(at) && Date.now() >= at;
}

/**
 * Milliseconds until the stored session lapses, or null when there is nothing to
 * count down to. AuthProvider uses this to arm its auto-logout timer.
 */
export function msUntilExpiry(): number | null {
  for (const store of [window.localStorage, window.sessionStorage]) {
    if (!store.getItem(TOKEN_KEY)) continue;
    const raw = store.getItem(EXPIRY_KEY);
    if (!raw) return null;
    const at = Number(raw);
    if (!Number.isFinite(at)) return null;
    return Math.max(0, at - Date.now());
  }
  return null;
}
