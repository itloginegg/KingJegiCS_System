/**
 * Audit Log API — talks to AuditlogsController (Owner-only).
 *
 * Endpoint inventory:
 *   GET /api/Auditlogs?table=&page=&pageSize=  → newest-first audit entries, paged
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export class AuditApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AuditApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Matches AuditLogResponseDto on the backend. */
export interface AuditLogEntry {
  id: string;
  adminId: string;
  action: string;
  targetTable: string;
  targetId: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

export async function fetchAuditLogs(
  token: string,
  options: { table?: string; page?: number; pageSize?: number } = {},
): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (options.table) params.set('table', options.table);
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const qs = params.toString();

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Auditlogs${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AuditApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new AuditApiError(
      'Only the Owner account may view the audit trail. Sign in as the Owner to continue.',
      res.status,
    );
  }

  if (!res.ok) {
    throw new AuditApiError(`The server responded with an error (HTTP ${res.status}).`, res.status);
  }

  return (await res.json()) as AuditLogEntry[];
}
