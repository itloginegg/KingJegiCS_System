/**
 * Announcements API — talks to AnnouncementsController.
 *
 * Endpoint inventory:
 *   GET  /api/Announcements?take=  → posting history, newest first (Owner/Assistant)
 *   POST /api/Announcements        → post one and notify every active customer
 *
 * There is deliberately no customer-facing endpoint: customers receive announcements
 * through the notification feed they already poll (/api/Notifications).
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class AnnouncementApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AnnouncementApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Matches AnnouncementResponseDto. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdByName: string;
  createdAt: string;
  /** Customers notified at post time — not a live count. 0 means the fan-out failed. */
  notifiedCount: number;
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as any;
    if (typeof body.message === 'string') return body.message;
    if (body.errors && typeof body.errors === 'object') {
      const firstKey = Object.keys(body.errors)[0];
      if (firstKey && Array.isArray(body.errors[firstKey]) && body.errors[firstKey].length > 0) {
        return body.errors[firstKey][0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, method: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const options: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body !== undefined) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new AnnouncementApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new AnnouncementApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new AnnouncementApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/** Owner/Assistant: the posting history, newest first. */
export function getAnnouncements(token: string, take = 50): Promise<Announcement[]> {
  return request<Announcement[]>(`/api/Announcements?take=${take}`, 'GET', token);
}

/** Owner/Assistant: post an announcement. Every active customer is notified. */
export function postAnnouncement(
  token: string,
  payload: { title: string; body: string },
): Promise<Announcement> {
  return request<Announcement>('/api/Announcements', 'POST', token, payload);
}
