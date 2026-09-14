/**
 * Catalog search — same shape as the Bookings tab's `resSearch`: the catalog tabs
 * already load their full catalogs, so this filters in memory and never adds a
 * request. An empty query matches everything.
 *
 * `q` is expected already trimmed and lower-cased; callers do that once per
 * render rather than once per field.
 */
export const matchesQuery = (q: string, ...fields: (string | null | undefined)[]) =>
  q === '' || fields.some((f) => (f ?? '').toLowerCase().includes(q));
