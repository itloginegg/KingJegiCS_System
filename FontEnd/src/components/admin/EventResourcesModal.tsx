import { useCallback, useEffect, useMemo, useState } from 'react';
import { readSession } from '../../lib/tokenStorage';
import {
  BookingApiError,
  eventTypeLabel,
  getBookingResources,
  saveBookingResources,
  type BookingResources,
  type ResourceCounts,
} from '../../api/bookingApi';

/** The nine allocation fields, in render order. */
type FieldKey = keyof ResourceCounts;

interface FieldSpec {
  key: FieldKey;
  label: string;
}

interface SectionSpec {
  icon: string;
  title: string;
  fields: FieldSpec[];
}

/**
 * The three sections, declared as data so the markup below is one loop rather than
 * three near-identical copies.
 *
 * These nine labels deliberately do NOT map onto the rental/service catalog, and
 * nothing here should try to resolve them to catalog rows: RentalCategory has Chairs
 * and Tables but no long/round distinction (that is a per-item name) and no utensils
 * category at all, and the ServiceName enum has Waiter but neither Server nor Others.
 * The allocation is a flat set of integer columns precisely so none of that matters.
 */
const SECTIONS: SectionSpec[] = [
  {
    icon: '🚚',
    title: 'Furniture Allocation',
    fields: [
      { key: 'longTables', label: 'Long Tables' },
      { key: 'roundTables', label: 'Round Tables' },
      { key: 'chairs', label: 'Chairs' },
    ],
  },
  {
    icon: '🍴',
    title: 'Utensils & Service-ware',
    fields: [
      { key: 'plates', label: 'Plates' },
      { key: 'spoons', label: 'Spoons' },
      { key: 'forks', label: 'Forks' },
    ],
  },
  {
    icon: '👥',
    title: 'Personnel Allocation',
    fields: [
      { key: 'waiters', label: 'Waiters' },
      { key: 'servers', label: 'Servers' },
      { key: 'others', label: 'Others' },
    ],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

/**
 * Form state keeps every count as a STRING, not a number.
 *
 * A number-typed state can't represent an empty box, so clearing a field to retype it
 * would snap back to 0 mid-keystroke. It also lets `Others` render blank rather than a
 * meaningless 0, which is how the design shows it. Blanks are coerced to 0 on save.
 */
type FormState = Record<FieldKey, string>;

const EMPTY_FORM: FormState = ALL_KEYS.reduce(
  (acc, k) => ({ ...acc, [k]: '' }),
  {} as FormState,
);

function toForm(counts: ResourceCounts): FormState {
  return ALL_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: String(counts[k]) }),
    {} as FormState,
  );
}

/** Blank or unparseable becomes 0; negatives are clamped away. */
function toCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
 * Plan the furniture, service-ware and staff for one booking.
 *
 * This writes to a dedicated allocation record, NOT to the booking's rentals or
 * services. That is the whole point: rental and service lines are priced, they consume
 * real stock, and they are editable only while a booking is a Draft — so routing an
 * operational headcount through them would have been rejected server-side on every
 * Confirmed booking, re-priced signed contracts, and eaten sellable inventory. The
 * priced Draft-only path still exists separately as DraftItemsEditor.
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
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [resources, setResources] = useState<BookingResources | null>(null);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        // A booking with no plan yet opens empty rather than pre-filled with the
        // suggestion: SUGGEST is an action the admin takes, and silently seeding the
        // fields would make a machine guess look like a saved decision.
        if (res.allocation) setForm(toForm(res.allocation));
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

  const applySuggestion = useCallback(
    (section: SectionSpec) => {
      const suggested = resources?.suggested;
      if (!suggested) return;
      setForm((prev) => {
        const next = { ...prev };
        // Only this section's fields — each SUGGEST fills its own group and leaves the
        // admin's work in the other two alone.
        for (const f of section.fields) next[f.key] = String(suggested[f.key]);
        return next;
      });
    },
    [resources],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const counts = ALL_KEYS.reduce(
        (acc, k) => ({ ...acc, [k]: toCount(form[k]) }),
        {} as ResourceCounts,
      );
      await saveBookingResources(token, bookingId, { ...counts, isApproved: approved });
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
  }, [form, approved, token, bookingId, notify, onSaved, onClose]);

  const canSuggest = resources?.suggested != null;
  /** Anything that edits the form is off while saving, and off entirely when read-only. */
  const locked = saving || readOnly;

  return (
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
              {SECTIONS.map((section) => (
                <div key={section.title} style={{ marginBottom: '1.4rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      marginBottom: '0.7rem',
                    }}
                  >
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
                      <span aria-hidden="true" style={{ marginRight: '0.45rem' }}>
                        {section.icon}
                      </span>
                      {section.title}
                    </span>
                    {/* Dropped entirely when read-only — a suggestion is an editing
                        aid, and nothing here can be changed. */}
                    {!readOnly && (
                      <button
                        type="button"
                        className="adm-btn success"
                        onClick={() => applySuggestion(section)}
                        // Disabled rather than hidden when there's no guest count to scale
                        // from, so the control's absence isn't mistaken for a missing feature.
                        disabled={!canSuggest || saving}
                        title={
                          canSuggest
                            ? 'Fill this section from the guest count'
                            : 'No guest count on this booking to base a suggestion on'
                        }
                        style={{ fontSize: '0.6rem', padding: '0.3rem 0.75rem', letterSpacing: '0.12em' }}
                      >
                        SUGGEST
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem' }}>
                    {section.fields.map((f) => (
                      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <label
                          htmlFor={`res-${f.key}`}
                          style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: '0.65rem',
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            fontWeight: 500,
                            color: 'var(--text-dim)',
                          }}
                        >
                          {f.label}
                        </label>
                        <input
                          id={`res-${f.key}`}
                          className="adm-input square"
                          type="number"
                          min={0}
                          value={form[f.key]}
                          disabled={locked}
                          readOnly={readOnly}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

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
    </div>
  );
}
