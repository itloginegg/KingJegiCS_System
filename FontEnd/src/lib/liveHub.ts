import type { HubConnection } from '@microsoft/signalr';

/** Waits before each retry of a first connection that failed, in order. */
const START_RETRY_DELAYS_MS = [2000, 5000, 10000];

/**
 * Starts a SignalR connection for a component and returns its cleanup.
 *
 * Two things the bare `conn.start().catch(notify)` got wrong:
 *
 *  - A false alarm on every load in development. React StrictMode mounts effects twice:
 *    the first mount's cleanup stops its connection mid-negotiation, that start()
 *    rejects with "The connection was stopped during negotiation", and the catch showed
 *    "Live … are unavailable" even though the second mount connected fine. A failure
 *    after cleanup is expected, not an outage, so it is ignored here.
 *
 *  - No second try. withAutomaticReconnect() only covers a connection that was once
 *    established; a first start() that fails (the API restarting, a blip) was never
 *    retried, so live updates stayed off for the whole visit. The first start is now
 *    retried a few times, and `onUnavailable` is called once, only after the last try.
 *
 * Usage, inside a useEffect:
 *   const conn = new HubConnectionBuilder()...build();
 *   conn.on(...);
 *   return startLiveHub(conn, () => notify('info', '…unavailable…'));
 */
export function startLiveHub(conn: HubConnection, onUnavailable?: () => void): () => void {
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const attempt = (retryIndex: number) => {
    conn.start().catch(() => {
      if (disposed) return;
      const delay = START_RETRY_DELAYS_MS[retryIndex];
      if (delay === undefined) {
        onUnavailable?.();
        return;
      }
      retryTimer = setTimeout(() => attempt(retryIndex + 1), delay);
    });
  };

  attempt(0);

  return () => {
    disposed = true;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    void conn.stop();
  };
}
