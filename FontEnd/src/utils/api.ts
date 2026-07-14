import type { ManagedMenu, ManagedPackage, Testimonial } from '../types';

/**
 * Landing-page API client for the ASP.NET Core backend.
 *
 * Design:
 *  - Raw backend payload shapes (`Api*Dto`) are declared here and kept private;
 *    every function returns the frontend view models from `src/types.ts`.
 *  - All endpoints used here are anonymous ([AllowAnonymous] on the backend),
 *    so no Authorization header is needed.
 *  - Base URL comes from VITE_API_BASE_URL (see .env.example), defaulting to
 *    the backend's http dev profile.
 */

const BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258';

/** Thrown for non-2xx responses so callers can distinguish HTTP failures. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/* ── Raw backend payload shapes (mirror the C# DTO records) ─────────────── */

interface ApiPackageDto {
  id: string;
  packageName: string;
  description: string;
  basePrice: number;
  minPax: number;
  maxPax: number;
  pricePerExtraPax: number;
  inclusions: string[];
}

interface ApiMenuTrayDto {
  id: string;
  trayName: string;
  pricePerTray: number;
  servesMin: number;
  servesMax: number;
}

interface ApiTestimonialDto {
  id: string;
  name: string;
  event: string | null;
  quote: string;
  rating: number;
}

/* ── Formatting helpers ─────────────────────────────────────────────────── */

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/** Catering packages for the "Featured Packages" section. */
export async function fetchPackages(signal?: AbortSignal): Promise<ManagedPackage[]> {
  const raw = await apiGet<ApiPackageDto[]>('/api/menupackages/public', signal);
  return raw.map((p) => ({
    id: p.id,
    name: p.packageName,
    price: peso.format(p.basePrice),
    description: p.description,
    paxRange: `${p.minPax}–${p.maxPax} pax`,
    inclusions: p.inclusions,
  }));
}

/** Menu tiers (trays) for the "Menu Preview" section. */
export async function fetchMenus(signal?: AbortSignal): Promise<ManagedMenu[]> {
  const raw = await apiGet<ApiMenuTrayDto[]>('/api/menutrays/public', signal);
  return raw.map((t) => ({
    id: t.id,
    tier: t.trayName,
    price: peso.format(t.pricePerTray),
    serves: `Serves ${t.servesMin}–${t.servesMax}`,
  }));
}

/** Approved testimonials, newest first. */
export async function fetchTestimonials(signal?: AbortSignal): Promise<Testimonial[]> {
  const raw = await apiGet<ApiTestimonialDto[]>('/api/testimonials/public?take=6', signal);
  return raw.map((t) => ({
    id: t.id,
    name: t.name,
    event: t.event ?? '',
    quote: t.quote,
    initials: initialsOf(t.name),
    rating: t.rating,
  }));
}

/** Fully-booked dates as ISO "YYYY-MM-DD" strings for the availability calendar. */
export async function fetchBookedDates(signal?: AbortSignal): Promise<string[]> {
  return apiGet<string[]>('/api/bookings/booked-dates', signal);
}

/** Submit a new testimonial. It lands as Pending and appears publicly only after approval. */
export async function submitTestimonial(input: {
  customerName: string;
  eventLabel?: string;
  body: string;
  rating: number;
}): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/testimonials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new ApiError(`Testimonial submission failed with ${res.status}`, res.status);
  }
}
