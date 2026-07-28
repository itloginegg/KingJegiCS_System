/**
 * Support chat API (item 3) — customer ↔ staff. Talks to SupportController.
 *
 *   Customer: GET /api/support/thread, POST /api/support/messages
 *   Admin:    GET /api/support/threads, GET /api/support/threads/{id},
 *             POST /api/support/threads/{id}/messages, POST /api/support/threads/{id}/status
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class SupportApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'SupportApiError';
    this.status = status;
  }
  get isAuthError(): boolean { return this.status === 401 || this.status === 403; }
}

/** Mirrors SupportMessageDto (sender: "Customer" | "Admin"). */
export interface SupportMessage { id: string; sender: string; text: string; createdAt: string; }

/** Mirrors SupportThreadDto. */
export interface SupportThread {
  id: string;
  customerId: string;
  customerName: string;
  status: string;
  lastMessageAt: string;
  messages: SupportMessage[];
}

/** Mirrors SupportThreadSummaryDto. */
export interface SupportThreadSummary {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  status: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadFromCustomer: number;
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as any;
    if (typeof body.message === 'string') return body.message;
    if (body.errors && typeof body.errors === 'object') {
      const firstKey = Object.keys(body.errors)[0];
      if (firstKey && Array.isArray(body.errors[firstKey]) && body.errors[firstKey].length > 0) return body.errors[firstKey][0];
    }
    return null;
  } catch { return null; }
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
    throw new SupportApiError('Unable to reach the server. Make sure the backend is running, then try again.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new SupportApiError('Your session has expired or you lack permission. Please sign in again.', res.status);
  }
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new SupportApiError(message ?? `The server responded with an error (HTTP ${res.status}).`, res.status);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ── Customer ──
export function getMyThread(token: string): Promise<SupportThread> {
  return request<SupportThread>('/api/support/thread', 'GET', token);
}
export function sendSupportMessage(token: string, text: string): Promise<SupportMessage> {
  return request<SupportMessage>('/api/support/messages', 'POST', token, { text });
}

// ── Admin ──
export function listSupportThreads(token: string, status?: 'Open' | 'Closed'): Promise<SupportThreadSummary[]> {
  const q = status ? `?status=${status}` : '';
  return request<SupportThreadSummary[]>(`/api/support/threads${q}`, 'GET', token);
}
export function getSupportThread(token: string, id: string): Promise<SupportThread> {
  return request<SupportThread>(`/api/support/threads/${id}`, 'GET', token);
}
export function replySupport(token: string, id: string, text: string): Promise<SupportMessage> {
  return request<SupportMessage>(`/api/support/threads/${id}/messages`, 'POST', token, { text });
}
export function setSupportStatus(token: string, id: string, status: 'Open' | 'Closed'): Promise<void> {
  return request<void>(`/api/support/threads/${id}/status?status=${status}`, 'POST', token);
}
