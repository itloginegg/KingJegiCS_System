/**
 * Admin package items API. Talks to ASP.NET Core MenuPackagesController.
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

export interface SlotCategoryDto {
  itemCategory?: string | null;
  courseCategory?: string | null;
}

export interface PackageSlotDto {
  id?: string;
  label: string;
  chooseCount: number;
  displayOrder: number;
  allowedCategories: SlotCategoryDto[];
}

export interface MenuItemBriefDto {
  id: string;
  itemName: string;
  itemCategory: string;
  courseCategory: string;
}

/** Matches MenuPackageImageDto. `url` is wwwroot-relative. */
export interface MenuPackageImage {
  id: string;
  url: string;
  caption?: string | null;
  displayOrder: number;
}

/** Server-side limits, mirrored so the UI can reject before uploading. */
export const PACKAGE_MAX_IMAGES = 12;
export const PACKAGE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PACKAGE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Same helper menuAdminApi/rentalAdminApi expose. */
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

export interface AdminPackage {
  id: string;
  packageName: string;
  description: string;
  basePrice: number;
  minPax: number;
  maxPax: number;
  pricePerExtraPax: number;
  inclusions: string[];
  slots: PackageSlotDto[];
  fixedItems: MenuItemBriefDto[];
  /** The package's own uploaded gallery art, in display order. */
  images: MenuPackageImage[];
}

export interface AdminPackageCreate {
  packageName: string;
  description: string;
  basePrice: number;
  minPax: number;
  maxPax: number;
  pricePerExtraPax: number;
  inclusions: string[];
  fixedItemIds: string[];
  slots: PackageSlotDto[];
}

export class PackageApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'PackageApiError';
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
    throw new PackageApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new PackageApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new PackageApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

async function sendJson<T>(path: string, method: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
    if (body !== undefined) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new PackageApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new PackageApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new PackageApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) {
    return {} as T;
  }

  return (await res.json()) as T;
}

export function fetchPackages(token: string): Promise<AdminPackage[]> {
  return getJson<AdminPackage[]>('/api/MenuPackages', token);
}

export function createPackage(token: string, payload: AdminPackageCreate): Promise<AdminPackage> {
  return sendJson<AdminPackage>('/api/MenuPackages', 'POST', token, payload);
}

export function updatePackage(token: string, id: string, payload: AdminPackageCreate): Promise<AdminPackage> {
  return sendJson<AdminPackage>(`/api/MenuPackages/${id}`, 'PUT', token, payload);
}

/**
 * Permanently deletes a package. The server refuses with 409 while bookings still
 * reference it, so callers should surface PackageApiError.message as-is.
 */
export function deletePackage(token: string, id: string): Promise<void> {
  return sendJson<void>(`/api/MenuPackages/${id}`, 'DELETE', token);
}

export function addPackageSlot(token: string, packageId: string, payload: PackageSlotDto): Promise<PackageSlotDto> {
  return sendJson<PackageSlotDto>(`/api/MenuPackages/${packageId}/slots`, 'POST', token, payload);
}

export function updatePackageSlot(token: string, packageId: string, slotId: string, payload: PackageSlotDto): Promise<PackageSlotDto> {
  return sendJson<PackageSlotDto>(`/api/MenuPackages/${packageId}/slots/${slotId}`, 'PUT', token, payload);
}

export function removePackageSlot(token: string, packageId: string, slotId: string): Promise<void> {
  return sendJson<void>(`/api/MenuPackages/${packageId}/slots/${slotId}`, 'DELETE', token);
}

/**
 * Uploads one gallery photo. Multipart, so Content-Type is left unset and the browser
 * writes the boundary itself — same shape as the rental/menu-item uploads.
 */
export async function addPackageImage(
  token: string,
  packageId: string,
  file: File,
  caption?: string,
): Promise<MenuPackageImage> {
  const form = new FormData();
  form.append('ImageFile', file);
  if (caption?.trim()) form.append('Caption', caption.trim());

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/MenuPackages/${packageId}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new PackageApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new PackageApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new PackageApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  return (await res.json()) as MenuPackageImage;
}

export function removePackageImage(token: string, packageId: string, imageId: string): Promise<void> {
  return sendJson<void>(`/api/MenuPackages/${packageId}/images/${imageId}`, 'DELETE', token);
}
