/**
 * Admin menu-catalog API. Talks to the ASP.NET Core backend in
 * BackEnd/System_ApiTest (MenuitemsController / MenutraysController).
 *
 * Both endpoints are [Authorize]-protected — every call needs the Bearer
 * token of a signed-in user. Admins (Owner/Assistant) also receive
 * inactive rows; customers only see active ones.
 */

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export function getFullImageUrl(urlPath?: string | null): string | null {
  if (!urlPath) return null;
  if (
    urlPath.startsWith('http://') ||
    urlPath.startsWith('https://') ||
    urlPath.startsWith('blob:') ||
    urlPath.startsWith('data:')
  ) {
    return urlPath;
  }
  const relative = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  return `${API_BASE_URL}${relative}`;
}

/** Mirrors MenuItemResponseDto (Menuitemdtos.cs). Enums arrive as strings. */
export interface AdminMenuItem {
  id: string;
  itemName: string;
  itemCategory: string;
  courseCategory: string;
  description: string;
  dietaryTags: string[];
  pricePerTray: number | null;
  servesPerTray: number;
  menuPackageId: string | null;
  isActive: boolean;
  imageUrl?: string | null;
}

/** Mirrors TrayDishDto (Menutraydtos.cs). */
export interface AdminTrayDish {
  id: string;
  itemName: string;
  itemCategory: string;
  courseCategory: string;
}

/** Mirrors MenuTrayResponseDto (Menutraydtos.cs). */
export interface AdminMenuTray {
  id: string;
  trayName: string;
  pricePerTray: number;
  servesMin: number;
  servesMax: number;
  isActive: boolean;
  dishes: AdminTrayDish[];
}

export class MenuApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'MenuApiError';
    this.status = status;
  }

  /** True when the failure is a missing/expired/underprivileged session. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function getJson<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new MenuApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new MenuApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new MenuApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

/** GET /api/Menuitems — every dish in the catalog. */
export type AdminMenuItemPayload = Omit<AdminMenuItem, 'id' | 'isActive'> & {
  imageFile?: File | null;
};
export type AdminMenuTrayPayload = Omit<AdminMenuTray, 'id' | 'isActive' | 'dishes'> & { dishItemIds: string[] };

export function fetchMenuItems(token: string): Promise<AdminMenuItem[]> {
  return getJson<AdminMenuItem[]>('/api/Menuitems', token);
}

/** GET /api/Menutrays — every tray with its four dishes. */
export function fetchMenuTrays(token: string): Promise<AdminMenuTray[]> {
  return getJson<AdminMenuTray[]>('/api/Menutrays', token);
}

/** Matches BestSellerDto (Menuitemdtos.cs). */
export interface BestSeller {
  item: AdminMenuItem;
  /**
   * Trays ordered in the window. 0 exactly when `isFallback` is true, so don't print
   * it as a sales figure without checking the flag.
   */
  unitsSold: number;
  /** Inclusive dates of the fortnight the ranking covers (when orders were placed). */
  windowStart: string;
  windowEnd: string;
  /**
   * True when nothing sold in the window and the dish is a deterministic rotation
   * pick instead of a genuine ranking — a quiet fortnight, or a fresh install.
   */
  isFallback: boolean;
}

/**
 * GET /api/Menuitems/best-seller — the fortnight's top dish.
 *
 * Anonymous, so no token. Returns null on 204, which is what the server sends when
 * the catalog has no priced, active dish to feature at all.
 */
export async function fetchBestSeller(): Promise<BestSeller | null> {
  const res = await fetch(`${API_BASE_URL}/api/Menuitems/best-seller`);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to load the best seller (HTTP ${res.status}).`);
  return (await res.json()) as BestSeller;
}

export function buildMenuItemFormData(payload: AdminMenuItemPayload): FormData {
  const formData = new FormData();
  formData.append('ItemName', payload.itemName);
  formData.append('ItemCategory', payload.itemCategory);
  formData.append('CourseCategory', payload.courseCategory);
  formData.append('Description', payload.description);

  if (payload.dietaryTags && payload.dietaryTags.length > 0) {
    payload.dietaryTags.forEach((tag) => {
      formData.append('DietaryTags', tag);
    });
  }

  if (payload.pricePerTray !== null && payload.pricePerTray !== undefined) {
    formData.append('PricePerTray', payload.pricePerTray.toString());
  }

  formData.append('ServesPerTray', payload.servesPerTray.toString());

  if (payload.menuPackageId) {
    formData.append('MenuPackageId', payload.menuPackageId);
  }

  if (payload.imageFile) {
    formData.append('ImageFile', payload.imageFile);
  }

  return formData;
}

async function sendFormData<T>(path: string, method: string, token: string, formData: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
  } catch {
    throw new MenuApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new MenuApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new MenuApiError(
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
    throw new MenuApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new MenuApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new MenuApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

export function createMenuItem(token: string, payload: AdminMenuItemPayload | FormData): Promise<AdminMenuItem> {
  const body = payload instanceof FormData ? payload : buildMenuItemFormData(payload);
  return sendFormData<AdminMenuItem>('/api/Menuitems', 'POST', token, body);
}

export function updateMenuItem(token: string, id: string, payload: AdminMenuItemPayload | FormData): Promise<AdminMenuItem> {
  const body = payload instanceof FormData ? payload : buildMenuItemFormData(payload);
  return sendFormData<AdminMenuItem>(`/api/Menuitems/${id}`, 'PUT', token, body);
}

export function deactivateMenuItem(token: string, id: string): Promise<void> {
  return sendJson<void>(`/api/Menuitems/${id}/deactivate`, 'POST', token, {});
}

export function reactivateMenuItem(token: string, id: string): Promise<void> {
  return sendJson<void>(`/api/Menuitems/${id}/reactivate`, 'POST', token, {});
}

export function createMenuTray(token: string, payload: AdminMenuTrayPayload): Promise<AdminMenuTray> {
  return sendJson<AdminMenuTray>('/api/Menutrays', 'POST', token, payload);
}

export function updateMenuTray(token: string, id: string, payload: AdminMenuTrayPayload): Promise<AdminMenuTray> {
  return sendJson<AdminMenuTray>(`/api/Menutrays/${id}`, 'PUT', token, payload);
}

export function deactivateMenuTray(token: string, id: string): Promise<void> {
  return sendJson<void>(`/api/Menutrays/${id}/deactivate`, 'POST', token, {});
}

export function reactivateMenuTray(token: string, id: string): Promise<void> {
  return sendJson<void>(`/api/Menutrays/${id}/reactivate`, 'POST', token, {});
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}

