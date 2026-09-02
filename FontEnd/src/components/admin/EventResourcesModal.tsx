import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { readSession } from '../../lib/tokenStorage';
import {
  BookingApiError,
  eventTypeLabel,
  getBookingResources,
  saveBookingResources,
  type AllocationCatalogItem,
  type BookingResources,
  type SaveAllocationLine,
} from '../../api/bookingApi';

/**
 * Quantities are held as STRINGS in the inputs, not numbers.
 *
 * A number-typed state can't represent an empty box, so clearing a field to retype it
 * would snap back to 0 mid-keystroke. Blanks are coerced on read.
 */
/** Blank or unparseable becomes 0; negatives are clamped away. */
function toCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A catalog assignment being edited. Mirrors AllocationLine, minus the server id —
 * lines are replaced wholesale on save, so a client-side id would be meaningless.
 */
interface DraftLine {
  kind: 'Rental' | 'Service';
  itemId: string;
  name: string;
  quantity: number;
  /** Stock left for this booking's dates, excluding its own hold. null for services. */
  available: number | null;
}

export interface EventResourcesModalProps {
  bookingId: string;
  /** null for FoodDelivery / RentalService bookings that carry no event type. */
  eventType: string | null;
  /** null for FoodDelivery. Drives the server-side suggestion. */
  guestCount: number | null;
  /** Shown in the subtitle when there is no event type to name. */
  bookingName?: string | null;
  onClose: () => void;
  onSaved?: () => void;
  /** Matches DraftItemsEditor's signature so the page can pass the same notifier. */
  notify?: (type: 'success' | 'error' | 'info', message: string) => void;
  /**
   * View-only mode — used for Completed bookings, where the plan is a record of what
   * was sent rather than something still being decided. Disables every input, drops
   * the SUGGEST pills, and leaves Close as the only footer action.
   */
  readOnly?: boolean;
}

/**
 * Assign the rental inventory and services one booking will use.
 *
 * This writes to a dedicated allocation record, NOT to the booking's priced rentals or
 * services. That is the whole point: priced lines are editable only while a booking is
 * a Draft, so routing an operational assignment through them would have been rejected
 * server-side on every Confirmed booking and re-priced signed contracts. The priced
 * Draft-only path still exists separately as DraftItemsEditor.
 *
 * These assignments DO hold real rental stock, which is what stops the same chairs
 * being promised to two events.
 */
export default function EventResourcesModal({
  bookingId,
  eventType,
  guestCount,
  bookingName,
  onClose,
  onSaved,
  notify,
  readOnly = false,
}: EventResourcesModalProps) {
  const [resources, setResources] = useState<BookingResources | null>(null);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [rentalPick, setRentalPick] = useState('');
  const [rentalQty, setRentalQty] = useState('1');
  const [servicePick, setServicePick] = useState('');
  const [serviceQty, setServiceQty] = useState('1');

  const token = readSession()?.token ?? '';

  // ── Load ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getBookingResources(token, bookingId)
      .then((res) => {
        if (cancelled) return;
        setResources(res);
        setApproved(res.isApproved);
        // Seeded from what's saved: these already hold stock, so showing them empty
        // would invite an admin to save over the plan and silently release inventory.
        // Nothing is ever pre-filled from SUGGEST — a machine guess must not look like
        // a saved decision.
        setLines(
          (res.lines ?? []).map((l) => ({
            kind: l.kind,
            itemId: l.itemId,
            name: l.name,
            quantity: l.quantity,
            available: l.available,
          })),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof BookingApiError ? e.message : 'Could not load resources.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, bookingId]);

  // ── Escape to close ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const subtitle = useMemo(() => {
    // Never render the raw enum: the value is `Birthday`, the label is "Birthday Party",
    // and `Others` reads as "Other". Falls back to the booking name when a booking has
    // no event type at all, and drops the pax segment when there is no guest count.
    const typeLabel = eventTypeLabel(eventType) ?? bookingName ?? 'Booking';
    return guestCount != null ? `${typeLabel} • ${guestCount} Pax` : typeLabel;
  }, [eventType, guestCount, bookingName]);

  /**
   * Adds a pick to the draft list, or folds it into the existing line for that item.
   * Two lines for one item would be rejected by the unique index, and "40 then 10"
   * plainly means 50.
   */
  const addLine = useCallback(
    (kind: 'Rental' | 'Service', item: AllocationCatalogItem | undefined, rawQty: string) => {
      if (!item) return;
      const qty = toCount(rawQty);
      if (qty <= 0) return;

      setLines((prev) => {
        const at = prev.findIndex((l) => l.kind === kind && l.itemId === item.id);
        if (at === -1) {
          return [...prev, { kind, itemId: item.id, name: item.name, quantity: qty, available: item.available }];
        }
        const next = [...prev];
        next[at] = { ...next[at], quantity: next[at].quantity + qty };
        return next;
      });
    },
    [],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Sent as the complete desired set: the server replaces the plan's lines with
      // exactly these, so an omitted line is a released reservation.
      const payloadLines: SaveAllocationLine[] = lines.map((l) =>
        l.kind === 'Rental'
          ? { rentalItemId: l.itemId, quantity: l.quantity }
          : { serviceItemId: l.itemId, quantity: l.quantity },
      );
      await saveBookingResources(token, bookingId, { isApproved: approved, lines: payloadLines });
      notify?.('success', approved ? 'Resource allocation approved.' : 'Resource allocation saved.');
      onSaved?.();
      onClose();
    } catch (e) {
      const msg = e instanceof BookingApiError ? e.message : 'Could not save the allocation.';
      setError(msg);
      notify?.('error', msg);
    } finally {
      setSaving(false);
    }
  }, [approved, lines, token, bookingId, notify, onSaved, onClose]);
  /** Anything that edits the form is off while saving, and off entirely when read-only. */
  const locked = saving || readOnly;

  /**
   * The rows currently chosen in the two pickers, so SUGGEST can read the quantity the
   * server worked out for that specific item.
   *
   * SUGGEST is per item rather than per section now. The old buttons filled a fixed box
   * ("Chairs"), which only worked because there was exactly one of each; a catalog may
   * hold three chair products or none, so the ratio comes from the item's category and
   * the admin still says which product it applies to.
   */
  const pickedRental = resources?.rentalCatalog.find((i) => i.id === rentalPick);
  const pickedService = resources?.serviceCatalog.find((s) => s.id === servicePick);

  return createPortal(
    <div className="adm-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="adm-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Event resources"
        // The shared panel class scrolls itself (max-height + overflow-y). Overridden
        // here so the header and footer stay put and only the body scrolls.
        style={{
          maxWidth: 620,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: 0,
        }}
      >
        {/* ── Header (fixed) ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '1.4rem 1.5rem 1rem',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: '1.75rem',
                fontWeight: 600,
                lineHeight: 1.1,
                color: 'var(--text-primary)',
              }}
            >
              Allocate Resources
            </h3>
            <p
              style={{
                margin: '0.3rem 0 0',
                fontFamily: 'var(--font-body)',
                fontSize: '0.78rem',
                fontWeight: 300,
                color: 'var(--text-muted)',
              }}
            >
              Allocation for {subtitle}
              {readOnly && ' • view only'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'none',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '1.15rem',
              lineHeight: 1,
              padding: '0.2rem',
              color: 'var(--text-dim)',
              marginTop: '0.35rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body (scrolls) ── */}
        <div style={{ overflowY: 'auto', padding: '1.2rem 1.5rem', flex: 1, minHeight: 0 }}>
          {loading ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Loading…
            </p>
          ) : (
            <>

              {/* ── Catalog assignments ──
                  The whole plan. Rendered even when there is nothing to pick, so an
                  empty catalog reads as "no items set up" rather than a missing
                  feature. */}
              <div style={{ marginBottom: '1.4rem' }}>
                <div style={{ margin: '0 0 0.3rem' }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: '0.66rem',
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      fontWeight: 500,
                      color: 'var(--text-dim)',
                    }}
                  >
                    <span aria-hidden="true" style={{ marginRight: '0.45rem' }}>📦</span>
                    Assigned Inventory &amp; Services
                  </span>
                </div>
                <p
                  style={{
                    margin: '0 0 0.8rem',
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.7rem',
                    fontWeight: 300,
                    color: 'var(--text-muted)',
                  }}
                >
                  Holds real stock for this event so the same items can&apos;t be booked twice.
                  Adds no charge — a package price already covers what it includes.
                </p>

                {lines.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.8rem' }}>
                    {lines.map((l) => {
                      // available excludes this booking's own hold, so the comparison is
                      // "can it grow to this?" rather than "is it already reserved?".
                      const over = l.available != null && l.quantity > l.available;
                      return (
                        <div
                          key={`${l.kind}-${l.itemId}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            padding: '0.55rem 0.7rem',
                            borderRadius: 'var(--r-sm, 6px)',
                            border: `1px solid ${over ? 'var(--danger)' : 'var(--border)'}`,
                            background: 'var(--bg-subtle)',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-body)',
                              fontSize: '0.78rem',
                              color: 'var(--text-primary)',
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {l.name}
                            <span style={{ color: 'var(--text-dim)', fontWeight: 300 }}>
                              {' '}
                              · {l.kind === 'Rental' ? 'Rental' : 'Service'}
                            </span>
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                            {over && (
                              <span style={{ fontSize: '0.68rem', color: 'var(--danger)' }}>
                                only {l.available} left
                              </span>
                            )}
                            <input
                              className="adm-input square"
                              type="number"
                              min={1}
                              aria-label={`Quantity for ${l.name}`}
                              value={String(l.quantity)}
                              disabled={locked}
                              readOnly={readOnly}
                              style={{ width: 78 }}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((x) =>
                                    x.kind === l.kind && x.itemId === l.itemId
                                      ? { ...x, quantity: toCount(e.target.value) }
                                      : x,
                                  ),
                                )
                              }
                            />
                            {!readOnly && (
                              <button
                                type="button"
                                className="adm-btn outline"
                                disabled={saving}
                                aria-label={`Remove ${l.name}`}
                                style={{ fontSize: '0.65rem', padding: '0.3rem 0.6rem' }}
                                onClick={() =>
                                  setLines((prev) =>
                                    prev.filter((x) => !(x.kind === l.kind && x.itemId === l.itemId)),
                                  )
                                }
                              >
                                REMOVE
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {lines.length === 0 && (
                  <p
                    style={{
                      margin: '0 0 0.8rem',
                      fontFamily: 'var(--font-body)',
                      fontSize: '0.72rem',
                      fontWeight: 300,
                      color: 'var(--text-dim)',
                    }}
                  >
                    Nothing assigned yet — this event is holding no inventory.
                  </p>
                )}

                {!readOnly && (
                  <>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <select
                        className="adm-input"
                        aria-label="Rental item to assign"
                        style={{ flex: 1, minWidth: 0 }}
                        value={rentalPick}
                        disabled={locked || resources?.rentalCatalog.length === 0}
                        onChange={(e) => setRentalPick(e.target.value)}
                      >
                        <option value="">
                          {resources?.rentalCatalog.length ? 'Select a rental item…' : 'No rental items in the catalog'}
                        </option>
                        {(resources?.rentalCatalog ?? []).map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.available} available)
                          </option>
                        ))}
                      </select>
                      <input
                        className="adm-input square"
                        type="number"
                        min={1}
                        aria-label="Rental quantity"
                        style={{ width: 78 }}
                        value={rentalQty}
                        disabled={locked}
                        onChange={(e) => setRentalQty(e.target.value)}
                      />
                      {/* Only shown once an item is picked AND a ratio applies to it —
                          linens, lights and ambiguously named tables have none, and a
                          button that filled in 0 would read as "bring none". */}
                      {pickedRental?.suggestedQuantity != null && (
                        <button
                          type="button"
                          className="adm-btn success"
                          disabled={locked}
                          title={`Suggest ${pickedRental.suggestedQuantity} for ${guestCount} pax`}
                          style={{ fontSize: '0.6rem', padding: '0.3rem 0.7rem', letterSpacing: '0.1em' }}
                          onClick={() => setRentalQty(String(pickedRental.suggestedQuantity))}
                        >
                          SUGGEST {pickedRental.suggestedQuantity}
                        </button>
                      )}
                      <button
                        type="button"
                        className="adm-btn success"
                        disabled={locked || !rentalPick}
                        style={{ fontSize: '0.62rem', padding: '0.3rem 0.8rem', letterSpacing: '0.1em' }}
                        onClick={() => {
                          addLine('Rental', pickedRental, rentalQty);
                          setRentalPick('');
                          setRentalQty('1');
                        }}
                      >
                        ADD
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select
                        className="adm-input"
                        aria-label="Service to assign"
                        style={{ flex: 1, minWidth: 0 }}
                        value={servicePick}
                        disabled={locked || resources?.serviceCatalog.length === 0}
                        onChange={(e) => setServicePick(e.target.value)}
                      >
                        <option value="">
                          {resources?.serviceCatalog.length ? 'Select a service…' : 'No services in the catalog'}
                        </option>
                        {(resources?.serviceCatalog ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className="adm-input square"
                        type="number"
                        min={1}
                        aria-label="Service quantity"
                        style={{ width: 78 }}
                        value={serviceQty}
                        disabled={locked}
                        onChange={(e) => setServiceQty(e.target.value)}
                      />
                      {/* Staffing ratios only recognise waiters and servers; anything
                          else has no suggestion, exactly as the old "Others" box was
                          always 0. */}
                      {pickedService?.suggestedQuantity != null && (
                        <button
                          type="button"
                          className="adm-btn success"
                          disabled={locked}
                          title={`Suggest ${pickedService.suggestedQuantity} for ${guestCount} pax`}
                          style={{ fontSize: '0.6rem', padding: '0.3rem 0.7rem', letterSpacing: '0.1em' }}
                          onClick={() => setServiceQty(String(pickedService.suggestedQuantity))}
                        >
                          SUGGEST {pickedService.suggestedQuantity}
                        </button>
                      )}
                      <button
                        type="button"
                        className="adm-btn success"
                        disabled={locked || !servicePick}
                        style={{ fontSize: '0.62rem', padding: '0.3rem 0.8rem', letterSpacing: '0.1em' }}
                        onClick={() => {
                          addLine('Service', pickedService, serviceQty);
                          setServicePick('');
                          setServiceQty('1');
                        }}
                      >
                        ADD
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Makes IsApproved settable in BOTH directions. Without it the flag could
                  only ever be turned on, and a plan approved by mistake would be stuck.
                  Read-only shows the same state as a disabled checkbox rather than
                  hiding it, so "was this signed off?" is still answerable after the
                  event — which is most of why the modal stays reachable at all. */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontFamily: 'var(--font-body)',
                  fontSize: '0.75rem',
                  fontWeight: 300,
                  color: 'var(--text-muted)',
                  cursor: locked ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={locked}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                {readOnly
                  ? approved ? 'This resource plan was approved' : 'This resource plan was never approved'
                  : 'Mark this resource plan as approved'}
              </label>

              {error && (
                <p
                  style={{
                    marginTop: '0.9rem',
                    marginBottom: 0,
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.75rem',
                    color: 'var(--danger)',
                  }}
                >
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Footer (fixed) ── */}
        <div
          className="form-actions"
          style={{
            display: 'flex',
            gap: '0.75rem',
            padding: '1rem 1.5rem 1.3rem',
            borderTop: '1px solid var(--border)',
            margin: 0,
            flexShrink: 0,
          }}
        >
          {/* Read-only collapses the footer to a single Close: there is no pending
              change to commit, so a disabled Save would just be a dead control. */}
          {!readOnly && (
            <button
              type="button"
              className="adm-btn primary"
              style={{ flex: 2 }}
              onClick={() => void save()}
              disabled={saving || loading}
            >
              {saving ? 'Saving…' : approved ? '📋 APPROVE ALLOCATION' : '📋 SAVE ALLOCATION'}
            </button>
          )}
          <button
            type="button"
            className="adm-btn outline"
            style={{ flex: 1 }}
            onClick={onClose}
            disabled={saving}
          >
            {readOnly ? 'CLOSE' : 'CANCEL'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
