/**
 * Admin rental inventory API. Talks to the ASP.NET Core backend via
 * BackEnd/System_ApiTest/RentalitemsController.
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

export interface AdminRentalItem {
  id: string;
  itemName: string;
  category: string;
  totalQuantity: number;
  quantityOut: number;
  stock: number;
  unitPrice: number;
  isActive: boolean;
  imageUrl?: string | null;
}

export interface AdminRentalItemCreate {
  itemName: string;
  category: string;
  totalQuantity: number;
  unitPrice: number;
  imageFile?: File | null;
}

export interface AdminRentalItemUpdate extends AdminRentalItemCreate {
  isActive: boolean;
}

export class RentalApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'RentalApiError';
    this.status = status;
  }

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
    throw new RentalApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new RentalApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new RentalApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

export function buildRentalItemFormData(payload: AdminRentalItemCreate | AdminRentalItemUpdate): FormData {
  const formData = new FormData();
  formData.append('ItemName', payload.itemName);
  formData.append('Category', payload.category);
  formData.append('TotalQuantity', payload.totalQuantity.toString());
  formData.append('UnitPrice', payload.unitPrice.toString());

  if ('isActive' in payload && payload.isActive !== undefined) {
    formData.append('IsActive', payload.isActive.toString());
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
    throw new RentalApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new RentalApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new RentalApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}
export function fetchRentalItems(token: string): Promise<AdminRentalItem[]> {
  return getJson<AdminRentalItem[]>('/api/Rentalitems', token);
}

export function createRentalItem(token: string, payload: AdminRentalItemCreate | FormData): Promise<AdminRentalItem> {
  const body = payload instanceof FormData ? payload : buildRentalItemFormData(payload);
  return sendFormData<AdminRentalItem>('/api/Rentalitems', 'POST', token, body);
}

export function updateRentalItem(token: string, id: string, payload: AdminRentalItemUpdate | FormData): Promise<AdminRentalItem> {
  const body = payload instanceof FormData ? payload : buildRentalItemFormData(payload);
  return sendFormData<AdminRentalItem>(`/api/Rentalitems/${id}`, 'PUT', token, body);
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}
