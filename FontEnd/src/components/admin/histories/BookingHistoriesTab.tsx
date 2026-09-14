/**
 * The Booking Histories tab: pick a booking, see every change made to it as a
 * timeline of field-by-field diffs.
 *
 * OWNED HERE: the revision rows, their loading and error flags, the picker's
 * search, and the snapshot decoding - nothing else in the dashboard reads a
 * snapshot.
 *
 * PASSED IN: `reservations`, which the Bookings tab owns and the picker lists,
 * and the open booking's id. That id lives on the page so it outlasts this tab
 * being unmounted, and so "View history" on a Bookings row can set it before
 * this tab exists; the tab fetches whenever it changes.
 */
import { useEffect, useState } from 'react';
import {
  getBookingHistory,
  BookingApiError,
  type BookingHistoryEntry,
  type BookingResponse,
} from '../../../api/bookingApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmt, fmtDate, fmtDateTime } from '../../../lib/format';

/* ─────────────────────────────────────────────────────────────────────────
   Booking-history snapshots

   Bookingservice.WriteHistorySnapshotAsync serializes a plain anonymous object with
   JsonSerializer.Serialize(snapshot) — no options — so keys are PascalCase and enums
   arrive as their NUMERIC values. These maps decode them back to the labels the rest
   of the dashboard uses; the ordinals mirror the enums in Models/Booking.cs.
───────────────────────────────────────────────────────────────────────── */

const SNAPSHOT_ENUMS: Record<string, string[]> = {
  BookingType: ['Full Service', 'Food Delivery'],
  EventType: ['Wedding', 'Corporate', 'Birthday', 'Others'],
  Status: ['Draft', 'Pending', 'Confirmed', 'Cancelled', 'Completed'],
  DepositStatus: ['Unpaid', 'Reserved', 'Partial', 'Paid'],
};

/** Human labels for the snapshot's PascalCase keys. */
const SNAPSHOT_LABELS: Record<string, string> = {
  BookingName: 'Booking name',
  BookingType: 'Booking type',
  EventDate: 'Event date',
  StartTime: 'Start time',
  EndDate: 'End date',
  EndTime: 'End time',
  EventType: 'Event type',
  VenueAddress: 'Venue',
  GuestCount: 'Guests',
  Status: 'Status',
  DepositStatus: 'Deposit',
  TotalAmount: 'Total',
  MenuPackageId: 'Package',
};

type Snapshot = Record<string, unknown>;

function parseSnapshot(json: string): Snapshot | null {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Snapshot) : null;
  } catch {
    return null;
  }
}

/** Renders one snapshot value the way the dashboard shows that field elsewhere. */
function snapshotValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  const labels = SNAPSHOT_ENUMS[key];
  if (labels && typeof value === 'number') return labels[value] ?? String(value);

  if (key === 'TotalAmount' && typeof value === 'number') return fmt(value);
  if (key === 'MenuPackageId') return typeof value === 'string' ? `${value.slice(0, 8)}…` : '—';
  if ((key === 'EventDate' || key === 'EndDate') && typeof value === 'string') return fmtDate(value);
  if ((key === 'StartTime' || key === 'EndTime') && typeof value === 'string') return value.substring(0, 5);

  return String(value);
}

/**
 * Fields that differ between two snapshots. Revision N holds the state BEFORE the
 * change that produced revision N+1, so diffing consecutive rows is what actually
 * says "this is what changed" — a single snapshot on its own only says "this is how
 * it looked".
 */
function diffSnapshots(before: Snapshot | null, after: Snapshot | null) {
  if (!before || !after) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => ({
      key: k,
      label: SNAPSHOT_LABELS[k] ?? k,
      from: snapshotValue(k, before[k]),
      to: snapshotValue(k, after[k]),
    }));
}

/** The current booking, shaped like a snapshot, so the newest revision can diff against it. */
function bookingAsSnapshot(b: BookingResponse): Snapshot {
  const idx = (labels: string[], v: string | null) => (v === null ? null : labels.indexOf(v));
  return {
    BookingName: b.bookingName,
    BookingType: idx(['FullService', 'FoodDelivery'], b.bookingType),
    EventDate: b.eventDate,
    StartTime: b.startTime,
    EndDate: b.endDate,
    EndTime: b.endTime,
    EventType: idx(['Wedding', 'Corporate', 'Birthday', 'Others'], b.eventType),
    VenueAddress: b.venueAddress,
    GuestCount: b.guestCount,
    Status: idx(['Draft', 'Pending', 'Confirmed', 'Cancelled', 'Completed'], b.status),
    DepositStatus: idx(['Unpaid', 'Reserved', 'Partial', 'Paid'], b.depositStatus),
    TotalAmount: b.totalAmount,
    MenuPackageId: b.menuPackageId,
  };
}

export interface BookingHistoriesTabProps {
  reservations: BookingResponse[];
  /** The booking whose timeline is shown, or null for the empty prompt. */
  bookingId: string | null;
  onSelectBooking: (bookingId: string) => void;
}

export function BookingHistoriesTab({ reservations, bookingId, onSelectBooking }: BookingHistoriesTabProps) {
  const [historyRows, setHistoryRows] = useState<BookingHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  /* Re-picking the booking already open reloads it, as it did before the split.
     The id alone can't express that - setting it to itself changes nothing. */
  const [reloadToken, setReloadToken] = useState(0);

  const pickBooking = (id: string) => {
    if (id === bookingId) setReloadToken((n) => n + 1);
    else onSelectBooking(id);
  };

  /**
   * Loads the append-only snapshot trail for one booking. Each row holds the BEFORE
   * state of the change that produced the next revision, so the timeline is rendered
   * by diffing consecutive snapshots (and the newest snapshot against the booking as
   * it stands now).
   *
   * `cancelled` drops a response that lands after the admin has already picked a
   * different booking, which would otherwise paint the wrong timeline.
   */
  useEffect(() => {
    if (!bookingId) return;
    const session = readSession();
    if (!session?.token) {
      setHistoryError('You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryRows([]);
    getBookingHistory(session.token, bookingId)
      .then((rows) => { if (!cancelled) setHistoryRows(rows); })
      .catch((err) => {
        if (!cancelled) {
          setHistoryError(
            err instanceof BookingApiError ? err.message : 'Could not load this booking’s history.',
          );
        }
      })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId, reloadToken]);

  return (
    <div className="fade-up" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>Booking Histories</h2>
        <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.5, color: 'var(--text-muted)', maxWidth: '56ch' }}>
          Live from the backend — <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--text-muted)' }}>/api/Bookings/[id]/history</span>. Every mutating call writes a snapshot of the booking as it was <em>before</em> the change.
        </p>
      </div>

      <div className="adm-split adm-split--history">

        {/* booking picker */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '16px' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>Select a booking</div>
          <input
            aria-label="Search bookings by name"
            placeholder="Search by name…"
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px', padding: '11px', marginBottom: '12px' }}
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            {reservations
              .filter((r) => {
                const q = historySearch.trim().toLowerCase();
                return q === '' || (r.bookingName ?? '').toLowerCase().includes(q);
              })
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => pickBooking(r.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
                    padding: '10px 4px', borderBottom: '1px solid var(--border)',
                    background: bookingId === r.id ? 'rgba(34, 67, 38,.07)' : 'transparent',
                    borderRadius: bookingId === r.id ? '8px' : '0'
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                    {r.bookingName}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.3, color: 'var(--text-muted)', marginTop: '3px' }}>
                    {fmtDate(r.eventDate)} · {r.status}
                  </div>
                </button>
              ))}
            {reservations.length === 0 && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', margin: '10px 4px' }}>
                No bookings loaded.
              </p>
            )}
          </div>
        </div>

        {/* revision timeline */}
        {!bookingId ? (
          <div style={{ background: 'var(--bg)', border: '1px dashed var(--border-strong)', borderRadius: '14px', padding: '22px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, lineHeight: 1.5, color: 'var(--text-muted)' }}>
            Pick a booking to see how it changed over time.
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px 20px' }}>
            {historyLoading ? (
              <>
                <div className="adm-skel" style={{ height: '0.9rem', width: '45%', marginBottom: '1rem' }} aria-hidden="true" />
                <div className="adm-skel" style={{ height: '3.6rem', marginBottom: '0.7rem' }} aria-hidden="true" />
                <div className="adm-skel" style={{ height: '3.6rem' }} aria-hidden="true" />
              </>
            ) : historyError ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, color: 'var(--danger)', margin: 0 }}>
                {historyError}
              </p>
            ) : historyRows.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)', textAlign: 'center', margin: '2rem 0' }}>
                No revisions recorded — this booking hasn't been changed since it was created.
              </p>
            ) : (() => {
              const current = reservations.find((r) => r.id === bookingId);
              const ordered = [...historyRows].sort((a, b) => b.revisionNumber - a.revisionNumber);
              return (
                <>
                  {ordered.map((row, idx) => {
                    const before = parseSnapshot(row.snapshotJson);
                    const nextRow = historyRows.find((h) => h.revisionNumber === row.revisionNumber + 1);
                    const after = nextRow ? parseSnapshot(nextRow.snapshotJson) : current ? bookingAsSnapshot(current) : null;
                    const changes = diffSnapshots(before, after);
  
                    const isLast = idx === ordered.length - 1;
                    const isFirst = idx === 0;

                    return (
                      <div key={row.id} style={{ display: 'flex', gap: '14px', paddingBottom: isLast ? '0' : '16px', paddingTop: isFirst ? '0' : '16px', borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                        <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '999px', background: isFirst ? 'var(--accent)' : 'var(--border-strong)' }}></span>
                          {!isLast && <span style={{ width: '1px', flex: 1, background: 'var(--border)' }}></span>}
                        </span>
                        <span style={{ flex: 1 }}>
                          {changes.length === 0 ? (
                            <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                              {row.changeReason || `Revision ${row.revisionNumber}`}
                            </span>
                          ) : (
                            changes.map((c) => (
                              <span key={c.key} style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                {c.label} <span style={{ opacity: 0.6, textDecoration: 'line-through' }}>{c.from}</span> → {c.to}
                              </span>
                            ))
                          )}
                          <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)', marginTop: '4px' }}>
                            {fmtDateTime(row.snapshotAt)} · {row.changedById ? `staff ${row.changedById.slice(0, 8)}` : 'customer'}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
