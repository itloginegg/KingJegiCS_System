/**
 * Admins API — talks to AdminsController.
 *
 * Staff Management: the Owner's view of every admin account, and the lifecycle
 * actions on Assistants. There is deliberately no delete: Auditlog.AdminId is a
 * required FK to Admins and Admin.CreatedById self-references it, so removing a
 * row would orphan the audit trail. Deactivation is the only supported removal.
 *
 * Every endpoint here is Owner-only — an Assistant gets 403, not a filtered list.
 * Login/logout live in authApi, not here.
 *
 * Endpoint inventory:
 *   GET  /api/Admins                                → every admin, Owner included (Owner)
 *   POST /api/Admins/assistants                     → create one Assistant (Owner)
 *   POST /api/Admins/assistants/{id}/deactivate     → soft-deactivate, 204 (Owner)
 *   POST /api/Admins/assistants/{id}/reactivate     → restore sign-in, 204 (Owner)
 */

import type { AdminRole } from '../types/auth';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class AdminsApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AdminsApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Matches the Shape() projection every AdminsController endpoint returns. */
export interface AdminSummary {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  role: AdminRole;
  /** The Owner who created this Assistant; null for the Owner itself. */
  createdById: string | null;
  createdAt: string;
  isActive: boolean;
}

/**
 * Matches CreateAssistantDto. Every field is server-validated, so a 400 here
 * carries a ModelState body that readErrorMessage surfaces verbatim:
 *   fullName    required, <= 200
 *   email       required, valid address, <= 254
 *   phoneNumber required, E.164 — /^\+[1-9]\d{6,14}$/, so pass toE164 output
 *   password    required, /^(?=.*[a-z])(?=.*[A-Z]).{8,}$/
 */
export interface CreateAssistantPayload {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
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

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 || res.status === 403) {
    throw new AdminsApiError(
      'Your session has expired or lacks Owner access. Staff management is restricted to the Owner account.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new AdminsApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

const UNREACHABLE = 'Unable to reach the server. Make sure the backend is running, then try again.';

/** Owner: every admin account, active and inactive, the Owner's own row included. */
export async function fetchAdmins(token: string): Promise<AdminSummary[]> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Admins`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AdminsApiError(UNREACHABLE);
  }
  return handle<AdminSummary[]>(res);
}

/**
 * Owner: create one Assistant.
 *
 * Role and CreatedById are set server-side — sending them would be ignored.
 * A duplicate email comes back as 409 with a readable message, not a 400.
 */
export async function createAssistant(
  token: string,
  payload: CreateAssistantPayload,
): Promise<AdminSummary> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Admins/assistants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AdminsApiError(UNREACHABLE);
  }
  return handle<AdminSummary>(res);
}

/**
 * Owner: soft-deactivate an Assistant, so they can no longer sign in.
 *
 * Idempotent — deactivating an already-inactive Assistant is a 204, not an error.
 * Note this does not end a session they already have: their existing token keeps
 * working until it expires (2 hours), it just cannot be renewed.
 */
export async function deactivateAssistant(token: string, id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Admins/assistants/${id}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AdminsApiError(UNREACHABLE);
  }
  return handle<void>(res);
}

/** Owner: restore a deactivated Assistant's ability to sign in. Idempotent. */
export async function reactivateAssistant(token: string, id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Admins/assistants/${id}/reactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AdminsApiError(UNREACHABLE);
  }
  return handle<void>(res);
}
