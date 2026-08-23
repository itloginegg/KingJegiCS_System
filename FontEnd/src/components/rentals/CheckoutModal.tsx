import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import {
  BookingApiError,
  addRental,
  createBooking,
  submitBooking,
  EVENT_TYPE_LABELS,
} from '../../api/bookingApi';
import { readSession } from '../../lib/tokenStorage';
import {
  composeVenueAddress,
  emptyVenueAddress,
  isVenueAddressComplete,
  type VenueAddress,
} from '../../lib/venue';
import { PhoneNumberInput } from '../forms/PhoneNumberInput';
import { VenueAddressFields } from '../forms/VenueAddressFields';
import { cartSubtotal, type CartLine } from './CartBar';
import { formatPeso } from './rentalData';
import { useDialog } from './useDialog';

/** Matches BookingMath.RentalReservationRate on the backend. */
const RESERVATION_RATE = 0.05;

const FIELD =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[0.82rem] text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
const FIELD_LABEL =
  'mb-1.5 block text-[0.62rem] font-semibold tracking-[0.18em] text-text-muted uppercase';

/**
 * Rental checkout.
 *
 * Books a RentalService booking — the type built for this: it reserves on 5% of
 * its own total rather than the flat SystemSettings fee (a flat ₱5,000 could
 * exceed a small chair order outright), and consumes no event slot. The backend
 * still treats it as event-shaped, which is why this asks for an event type and
 * guest count that a pure equipment hire would not need.
 *
 * The write is three sequential calls, matching the API's draft model:
 * create the Draft → POST each rental line → submit. There is no batch endpoint,
 * and submit is what freezes the total and moves it out of Draft.
 */
export function CheckoutModal({
  open,
  onClose,
  lines,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  /** Clears the cart once the booking is submitted. */
  onBooked: () => void;
}) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const [eventType, setEventType] = useState('Wedding');
  const [guests, setGuests] = useState('50');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [address, setAddress] = useState<VenueAddress>(emptyVenueAddress);
  const [contact, setContact] = useState('');

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  useDialog(open, onClose, panelRef, closeRef);

  const subtotal = useMemo(() => cartSubtotal(lines), [lines]);
  const reservation = Math.round(subtotal * RESERVATION_RATE * 100) / 100;

  if (!open) return null;

  const placeOrder = async () => {
    const session = readSession();
    /* Creating a booking needs an account — the catalog itself is anonymous. */
    if (!session) {
      navigate('/login');
      return;
    }
    if (lines.length === 0) {
      setError('Your rental list is empty.');
      return;
    }
    if (!eventDate || !startTime || !endDate || !endTime) {
      setError('Please give the delivery date/time and the pickup date/time.');
      return;
    }
    if (new Date(`${endDate}T${endTime}`) <= new Date(`${eventDate}T${startTime}`)) {
      setError('Pickup must be after delivery.');
      return;
    }
    if (!isVenueAddressComplete(address)) {
      setError('Please provide a delivery street and city.');
      return;
    }

    setPlacing(true);
    setError('');
    try {
      const booking = await createBooking(session.token, {
        customerId: session.user.id,
        bookingType: 'RentalService',
        eventDate,
        startTime: `${startTime}:00`,
        endDate,
        endTime: `${endTime}:00`,
        eventType,
        venueAddress: composeVenueAddress(address),
        guestCount: Number(guests) || 1,
        menuPackageId: null,
        contactNumber: contact.trim() || null,
        /* No groom/celebrant/event-name fields: EventDetailRules rejects any that
           don't belong to the chosen eventType, and a rental hire has none of
           them to offer. */
      });

      /* Sequential, not Promise.all: each POST recomputes the draft's total
         server-side, and firing them together races that recalculation. */
      for (const line of lines) {
        await addRental(session.token, booking.id, line.item.id, line.quantity);
      }

      await submitBooking(session.token, booking.id);
      onBooked();
      onClose();
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof BookingApiError
          ? err.message
          : 'Could not place your rental booking. Please try again.',
      );
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Presentational — Escape and the labelled close button are the real
          dismissals, so this is not a tab stop. */}
      <div
        className="absolute inset-0 bg-[rgb(0_0_0/0.5)]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rental-checkout-title"
        className="relative flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-t-2xl border border-border bg-bg-card shadow-card sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <p
              className="mb-1 text-[0.58rem] font-semibold tracking-[0.24em] text-text-muted uppercase"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Rental booking
            </p>
            <h2
              id="rental-checkout-title"
              className="text-[1.3rem] text-text-primary"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Delivery &amp; pickup
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div
          className="flex flex-col gap-5 overflow-y-auto p-5"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {/* ── order lines ── */}
          <div className="rounded-xl border border-border bg-bg-subtle p-4">
            {lines.map((line) => (
              <div
                key={line.item.id}
                className="flex items-baseline justify-between gap-3 py-1 text-[0.8rem] text-text-secondary"
              >
                <span className="min-w-0 truncate">
                  {line.item.name} × {line.quantity}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatPeso(line.item.pricePerDay * line.quantity)}
                </span>
              </div>
            ))}

            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-2 text-[0.88rem] font-semibold text-text-primary">
              <span>Estimated total</span>
              <span className="tabular-nums">{formatPeso(subtotal)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-1 text-[0.75rem] text-text-muted">
              <span>Reservation fee (5%)</span>
              <span className="tabular-nums">≈ {formatPeso(reservation)}</span>
            </div>

            <p className="mt-3 text-[0.72rem] leading-relaxed text-text-muted">
              Final pricing is confirmed by our team. A reservation fee of 5% of the
              total secures your booking.
            </p>
          </div>

          {/* ── delivery window and event details ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={FIELD_LABEL} htmlFor="rnt-delivery-date">
                Delivery date
              </label>
              <input
                id="rnt-delivery-date"
                type="date"
                className={FIELD}
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="rnt-delivery-time">
                Delivery time
              </label>
              <input
                id="rnt-delivery-time"
                type="time"
                className={FIELD}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="rnt-pickup-date">
                Pickup date
              </label>
              <input
                id="rnt-pickup-date"
                type="date"
                className={FIELD}
                min={eventDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="rnt-pickup-time">
                Pickup time
              </label>
              <input
                id="rnt-pickup-time"
                type="time"
                className={FIELD}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="rnt-event-type">
                Event type
              </label>
              <select
                id="rnt-event-type"
                className={FIELD}
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="rnt-guests">
                Expected guests
              </label>
              <input
                id="rnt-guests"
                type="number"
                min={1}
                className={FIELD}
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <VenueAddressFields
                value={address}
                onChange={setAddress}
                labelClassName={FIELD_LABEL}
                inputClassName={FIELD}
                labels={{ street: 'Delivery street' }}
                style={{ gap: '1rem' }}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={FIELD_LABEL} htmlFor="rnt-contact">
                Contact number
              </label>
              <PhoneNumberInput
                id="rnt-contact"
                className={FIELD}
                value={contact}
                onChange={setContact}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-[0.8rem] text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border p-5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full border border-border bg-transparent px-5 py-2.5 text-[0.78rem] text-text-secondary transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Back
          </button>
          <button
            type="button"
            disabled={placing}
            onClick={() => void placeOrder()}
            className="cursor-pointer rounded-full bg-accent px-5 py-2.5 text-[0.78rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:outline-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {placing ? 'Booking…' : 'Confirm Rental Booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
