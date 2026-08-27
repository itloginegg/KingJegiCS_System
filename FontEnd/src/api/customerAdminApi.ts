/**
 * Admin customer API (item 4) — talks to CustomersController's admin-only endpoints.
 *
 *   GET  /api/Customers/search?q=…   → find existing customers (Owner/Assistant)
 *   POST /api/Customers/admin-create → walk-in create, skips Gmail-only + OTP rules
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class CustomerAdminApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'CustomerAdminApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Mirrors CustomerResponseDto. */
export interface AdminCustomer {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  isActive: boolean;
  createdAt: string;
}

/** Mirrors AdminCreateCustomerDto. */
export interface WalkInCustomerPayload {
  fullName: string;
  email: string;
  phoneNumber: string;
  password?: string | null;
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
    throw new CustomerAdminApiError('Unable to reach the server. Make sure the backend is running, then try again.');
  }

  if (res.status === 401 || res.status === 403) {
    throw new CustomerAdminApiError('Your session has expired or lacks admin access. Please sign in again.', res.status);
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new CustomerAdminApiError(message ?? `The server responded with an error (HTTP ${res.status}).`, res.status);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/** Search existing customers by name/email (empty query returns the first page). */
export function searchCustomers(token: string, q: string): Promise<AdminCustomer[]> {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request<AdminCustomer[]>(`/api/Customers/search${query}`, 'GET', token);
}

/** Create a walk-in customer (no Gmail/OTP requirement). */
export function createWalkInCustomer(token: string, payload: WalkInCustomerPayload): Promise<AdminCustomer> {
  return request<AdminCustomer>('/api/Customers/admin-create', 'POST', token, payload);
}
