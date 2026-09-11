/**
 * "The server just rejected our token."
 *
 * A standalone pub/sub, deliberately free of React and of any import from the
 * auth context. The publishers are the ~19 API modules, and if this carried a
 * context import every one of them would start pulling React state into what is
 * otherwise a plain fetch wrapper. AuthProvider is the only subscriber.
 *
 * WHY 401 AND NOT 403. They mean different things and the difference matters
 * here: 401 is "this token is no good any more", 403 is "this token is fine but
 * it isn't allowed to do that". The API modules lump them together for their
 * error copy, which is reasonable — both should say "you can't do this" — but
 * signing someone out on a 403 would eject a customer who merely typed an admin
 * URL, or an Assistant who touched an Owner-only endpoint. Only 401 fires this.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Called by an API module when a request comes back 401. */
export function notifyUnauthorized(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribe. Returns the unsubscribe. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
