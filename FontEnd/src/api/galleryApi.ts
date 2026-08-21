/**
 * Gallery API — talks to GalleryController.
 *
 * The public "Events by King Jegi" photo gallery. Entirely separate from
 * announcementsApi: uploading a photo here creates no announcement, and posting an
 * announcement writes nothing here.
 *
 * Endpoint inventory:
 *   GET    /api/Gallery        → the public gallery, in display order (anonymous)
 *   GET    /api/Gallery/admin  → same list plus uploader/date (Owner/Assistant)
 *   POST   /api/Gallery        → upload one photo, multipart (Owner/Assistant)
 *   DELETE /api/Gallery/{id}   → remove one photo (Owner/Assistant)
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

/** Same helper menuAdminApi/rentalAdminApi/packageAdminApi expose. */
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

/** Server-side limits, mirrored so the UI can reject before uploading. */
export const GALLERY_MAX_IMAGES = 60;
export const GALLERY_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const GALLERY_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class GalleryApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GalleryApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Matches GalleryImagePublicDto. */
export interface GalleryImage {
  id: string;
  url: string;
  caption?: string | null;
  displayOrder: number;
}

/** Matches GalleryImageAdminDto. */
export interface GalleryImageAdmin extends GalleryImage {
  uploadedAt: string;
  uploadedByName: string;
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
    throw new GalleryApiError(
      'Your session has expired or lacks admin access. Sign in with an Owner or Assistant account and try again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new GalleryApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

const UNREACHABLE = 'Unable to reach the server. Make sure the backend is running, then try again.';

/** Public: the gallery as the landing page renders it. No token required. */
export async function fetchGallery(): Promise<GalleryImage[]> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Gallery`);
  } catch {
    throw new GalleryApiError(UNREACHABLE);
  }
  return handle<GalleryImage[]>(res);
}

/** Owner/Assistant: the gallery with uploader and date. */
export async function fetchGalleryForAdmin(token: string): Promise<GalleryImageAdmin[]> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Gallery/admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new GalleryApiError(UNREACHABLE);
  }
  return handle<GalleryImageAdmin[]>(res);
}

/**
 * Owner/Assistant: upload one photo.
 *
 * Content-Type is left unset on purpose so the browser writes the multipart boundary.
 */
export async function uploadGalleryImage(
  token: string,
  file: File,
  caption?: string,
): Promise<GalleryImageAdmin> {
  const form = new FormData();
  form.append('ImageFile', file);
  if (caption?.trim()) form.append('Caption', caption.trim());

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Gallery`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new GalleryApiError(UNREACHABLE);
  }
  return handle<GalleryImageAdmin>(res);
}

/** Owner/Assistant: remove one photo. */
export async function deleteGalleryImage(token: string, id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/Gallery/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new GalleryApiError(UNREACHABLE);
  }
  return handle<void>(res);
}
