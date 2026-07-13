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

interface PersistPayload {
  token: string;
  user: User;
  rememberMe: boolean;
}

function pickStore(rememberMe: boolean): Storage {
  return rememberMe ? window.localStorage : window.sessionStorage;
}

export function persistSession({ token, user, rememberMe }: PersistPayload): void {
  // Clear the other store first so a session can't linger in two places.
  clearSession();
  const store = pickStore(rememberMe);
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(USER_KEY);
}

/** Reads whichever store currently holds a session. Returns null if none. */
export function readSession(): { token: string; user: User } | null {
  for (const store of [window.localStorage, window.sessionStorage]) {
    const token = store.getItem(TOKEN_KEY);
    const rawUser = store.getItem(USER_KEY);
    if (token && rawUser) {
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
