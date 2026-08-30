/**
 * Support chat API (item 3) — customer ↔ staff. Talks to SupportController.
 *
 *   Customer: GET /api/support/thread, POST /api/support/messages
 *   Admin:    GET /api/support/threads, GET /api/support/threads/{id},
 *             POST /api/support/threads/{id}/messages, POST /api/support/threads/{id}/status,
 *             POST /api/support/threads/{id}/drafts/{draftId}/discard
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

/**
 * Mirrors SupportMessageDto (sender: "Customer" | "Admin").
 * A message may be text-only, attachment-only (empty `text`), or both.
 */
export interface SupportMessage {
  id: string;
  sender: string;
  text: string;
  createdAt: string;
  /** Server-relative, e.g. "/uploads/support/support_a1b2….pdf". Run through attachmentUrl(). */
  attachmentUrl: string | null;
  attachmentFileName: string | null;
  attachmentContentType: string | null;
  /** True when it should render inline as an image rather than as a download link. */
  attachmentIsImage: boolean;
}

/** Absolute URL for an attachment served from the API's wwwroot. */
export function attachmentUrl(urlPath?: string | null): string | null {
  if (!urlPath) return null;
  if (/^(https?:|blob:|data:)/.test(urlPath)) return urlPath;
  return `${API_BASE_URL}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
}

/**
 * Mirrors SupportDraftDto — an assistant-written reply nobody has sent yet.
 * Only ever present on the ADMIN thread endpoint; the customer's response does not
 * carry the key at all.
 */
export interface SupportDraft {
  id: string;
  text: string;
  /** SupportTopic name: Booking | Payment | Menu | Rental | Complaint | Other. */
  topic: string;
  /** SupportUrgency name: Routine | Attention | Urgent. */
  urgency: string;
  /** Read-only tools the draft is grounded in, for the citation line above the composer. */
  toolsUsed: string[];
}

/** Mirrors SupportThreadDto. */
export interface SupportThread {
  id: string;
  customerId: string;
  customerName: string;
  status: string;
  lastMessageAt: string;
  messages: SupportMessage[];
  /** Absent on the customer endpoint, and on any thread with no pending draft. */
  draft?: SupportDraft | null;
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
  /** Null until a draft exists — which is every thread while support drafting is off. */
  topic?: string | null;
  urgency?: string | null;
  hasDraft?: boolean;
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
    if (body instanceof FormData) {
      // Never set Content-Type by hand for FormData — the browser has to append the
      // multipart boundary itself, and an explicit header would clobber it.
      options.body = body;
    } else if (body !== undefined) {
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
/**
 * Posts a customer message. Always multipart — the endpoint binds [FromForm] so an
 * attachment can ride along, and sending one shape for both cases keeps the two send
 * paths from diverging. `text` may be empty when a file is attached.
 */
export function sendSupportMessage(
  token: string,
  text: string,
  attachment?: File | null,
): Promise<SupportMessage> {
  return request<SupportMessage>('/api/support/messages', 'POST', token, buildMessageForm(text, attachment));
}

function buildMessageForm(text: string, attachment?: File | null, draftId?: string | null): FormData {
  const form = new FormData();
  form.append('text', text);
  if (attachment) form.append('attachment', attachment);
  if (draftId) form.append('draftId', draftId);
  return form;
}

// ── Admin ──
export function listSupportThreads(token: string, status?: 'Open' | 'Closed'): Promise<SupportThreadSummary[]> {
  const q = status ? `?status=${status}` : '';
  return request<SupportThreadSummary[]>(`/api/support/threads${q}`, 'GET', token);
}
export function getSupportThread(token: string, id: string): Promise<SupportThread> {
  return request<SupportThread>(`/api/support/threads/${id}`, 'GET', token);
}
/**
 * Posts a staff reply. Pass draftId when the text started as an assistant draft, so the
 * server can record whether it went out as written (Sent) or was changed first (Edited).
 * The text sent is whatever is in the composer — the draft id is only provenance.
 */
export function replySupport(
  token: string,
  id: string,
  text: string,
  attachment?: File | null,
  draftId?: string | null,
): Promise<SupportMessage> {
  return request<SupportMessage>(
    `/api/support/threads/${id}/messages`, 'POST', token, buildMessageForm(text, attachment, draftId),
  );
}

/** Throws a draft away. The row survives as a record; it just stops being offered. */
export function discardDraft(token: string, id: string, draftId: string): Promise<void> {
  return request<void>(`/api/support/threads/${id}/drafts/${draftId}/discard`, 'POST', token);
}
export function setSupportStatus(token: string, id: string, status: 'Open' | 'Closed'): Promise<void> {
  return request<void>(`/api/support/threads/${id}/status?status=${status}`, 'POST', token);
}
