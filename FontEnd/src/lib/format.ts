/**
 * Display formatters shared by the admin and customer surfaces.
 *
 * Lifted out of AdminDashboardPage, which four files under components/ were
 * importing from — a component reaching up into a page for a helper, which meant
 * BookingsTable could not be read, moved or tested without dragging a
 * 7,000-line page along behind it.
 */

/** Peso, no decimals. The catalog prices in whole pesos and so do the totals. */
export const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`;

export const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

/**
 * "14:30:00" → "2:30 PM". TimeOnly arrives as HH:mm:ss, which isn't a date, so it's
 * parsed positionally. Null/absent renders as an em dash.
 */
export const fmtTime = (hms: string | null | undefined) => {
  if (!hms) return '—';
  const [h, m] = hms.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hms;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};
