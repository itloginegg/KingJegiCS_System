/**
 * Admin service items API. Talks to ASP.NET Core ServiceitemsController.
 */

import { notifyUnauthorized } from '../lib/authEvents';
import type { ServiceCategory } from '../lib/serviceScope';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export interface AdminServiceItem {
  id: string;
  serviceName: string;
  unitCost: number;
  isActive: boolean;
  /** Null when nobody has sorted it yet; it is then offered on every kind of event. */
  category: ServiceCategory | null;
}

export interface AdminServiceItemCreate {
  serviceName: string;
  unitCost: number;
  /**
   * Always send it, null included: the update endpoint writes whatever arrives, so a
   * payload that leaves it out clears the category.
   */
  category: ServiceCategory | null;
}

export interface AdminServiceItemUpdate extends AdminServiceItemCreate {
  isActive: boolean;
}

export class ServiceApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ServiceApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}

async function getJson<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ServiceApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    /* 401 only: the token is dead, so AuthProvider ends the session. A 403 is a
       live token without the rights for this call and must not sign anyone out. */
    if (res.status === 401) notifyUnauthorized();
    throw new ServiceApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ServiceApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

async function sendJson<T>(path: string, method: string, token: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ServiceApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    /* 401 only: the token is dead, so AuthProvider ends the session. A 403 is a
       live token without the rights for this call and must not sign anyone out. */
    if (res.status === 401) notifyUnauthorized();
    throw new ServiceApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ServiceApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

export function fetchServiceItems(token: string): Promise<AdminServiceItem[]> {
  return getJson<AdminServiceItem[]>('/api/Serviceitems', token);
}

export function createServiceItem(token: string, payload: AdminServiceItemCreate): Promise<AdminServiceItem> {
  return sendJson<AdminServiceItem>('/api/Serviceitems', 'POST', token, payload);
}

export function updateServiceItem(token: string, id: string, payload: AdminServiceItemUpdate): Promise<AdminServiceItem> {
  return sendJson<AdminServiceItem>(`/api/Serviceitems/${id}`, 'PUT', token, payload);
}
