/**
 * Testimonials API — talks to TestimonialsController.
 *
 * Endpoint inventory:
 *   GET  /api/Testimonials/approved?take=   → approved reviews (anonymous, landing page)
 *   GET  /api/Testimonials?status=          → moderation queue (Owner/Assistant)
 *   POST /api/Testimonials/{id}/moderate    → approve/reject (Owner/Assistant)
 *   POST /api/Testimonials                  → submit a review (Customer)
 *   GET  /api/Testimonials/mine             → the caller's own submissions (Customer)
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class TestimonialApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'TestimonialApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export type TestimonialStatus = 'Pending' | 'Approved' | 'Rejected';

/** Matches PublicTestimonialDto — carries no customer or booking ids. */
export interface PublicTestimonial {
  id: string;
  authorName: string;
  rating: number;
  body: string;
  submittedAt: string;
}

/** Matches TestimonialResponseDto — the moderation shape. */
export interface Testimonial {
  id: string;
  customerId: string;
  authorName: string;
  customerEmail: string;
  bookingId: string;
  bookingName: string;
  eventDate: string;
  rating: number;
  body: string;
  status: TestimonialStatus;
  submittedAt: string;
  moderatedAt: string | null;
  moderatedById: string | null;
  moderationNote: string | null;
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

async function request<T>(path: string, method: string, token?: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const options: RequestInit = { method, headers: {} };
    if (token) options.headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new TestimonialApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new TestimonialApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new TestimonialApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/** Approved reviews for the landing page. Anonymous — no token needed. */
export function getApprovedTestimonials(take = 12): Promise<PublicTestimonial[]> {
  return request<PublicTestimonial[]>(`/api/Testimonials/approved?take=${take}`, 'GET');
}

/** Owner/Assistant: the moderation queue. Omit `status` for everything. */
export function getTestimonials(token: string, status?: TestimonialStatus): Promise<Testimonial[]> {
  const query = status ? `?status=${status}` : '';
  return request<Testimonial[]>(`/api/Testimonials${query}`, 'GET', token);
}

/** Owner/Assistant: approve or reject one testimonial. */
export function moderateTestimonial(
  token: string,
  id: string,
  status: 'Approved' | 'Rejected',
  note?: string,
): Promise<{ id: string; status: TestimonialStatus; moderatedAt: string; moderationNote: string | null }> {
  return request(`/api/Testimonials/${id}/moderate`, 'POST', token, {
    status,
    note: note ?? null,
  });
}

/** Customer: submit a review for one of their own Completed bookings. */
export function submitTestimonial(
  token: string,
  payload: { bookingId: string; rating: number; body: string; authorName?: string },
): Promise<PublicTestimonial> {
  return request<PublicTestimonial>('/api/Testimonials', 'POST', token, {
    bookingId: payload.bookingId,
    rating: payload.rating,
    body: payload.body,
    authorName: payload.authorName ?? null,
  });
}

/** Customer: their own submissions, with current moderation state. */
export function getMyTestimonials(token: string): Promise<Testimonial[]> {
  return request<Testimonial[]>('/api/Testimonials/mine', 'GET', token);
}
