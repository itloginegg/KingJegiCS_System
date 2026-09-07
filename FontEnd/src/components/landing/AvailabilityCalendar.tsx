import { useId, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { DayTimeSlots } from '../../api/calendarApi';
import {
  DAY_ABBR, MONTH_NAMES, fmtSelected, fmtWindow,
  getDaysInMonth, getFirstDayOfMonth, toISO,
} from './calendarUtils';

export interface AvailabilityCalendarProps {
  year: number;
  month: number;
  /** ISO dates the backend has locked. A miss means "never booked" — i.e. open. */
  bookedDates: Set<string>;
  selectedDate: string | null;
  /** Slot windows keyed by ISO date; `'error'` means the endpoint failed for that date. */
  slotsByDate: Record<string, DayTimeSlots | 'error'>;
  hoveredISO: string | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onHover: (iso: string | null) => void;
  onSelect: (iso: string | null) => void;
  onReserve: () => void;
}

/**
 * The four states the detail block can report, and the badge that names each.
 *
 * A word, not a colour: the badge says OPEN / BOOKED / CLOSED / PAST, so the state
 * survives a monochrome screen and a screen reader. The five text branches below
 * fold onto these four — "No open time slots" is a day nobody locked but nothing is
 * left of, which is BOOKED from a visitor's side.
 */
type DayState = 'open' | 'booked' | 'closed' | 'past';

const BADGE_LABEL: Record<DayState, string> = {
  open: 'OPEN',
  booked: 'BOOKED',
  closed: 'CLOSED',
  past: 'PAST',
};

/**
 * The date picker, as a panel rather than a page section.
 *
 * Presentational: every piece of state lives in the page, which is what lets the
 * same panel sit in the hero here and be reused elsewhere without carrying its
 * own copy of the month, the fetches or the selection.
 */
export function AvailabilityCalendar({
  year, month, bookedDates, selectedDate, slotsByDate, hoveredISO,
  onPrevMonth, onNextMonth, onHover, onSelect, onReserve,
}: AvailabilityCalendarProps) {
  /* Collapsed/expanded is presentation, so it stays local. Nothing about the
     controlled contract changes: month, selection and fetching still live in
     LandingPage and no existing prop moves. */
  const [gridOpen, setGridOpen] = useState(true);
  const gridId = useId();

  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());
  const daysInMonth = getDaysInMonth(year, month);
  const firstWeekday = getFirstDayOfMonth(year, month);

  /* "22 / 25 open" in the header. Counts only days a visitor could actually take —
     past days are neither open nor booked, they are gone. Both numbers are derived
     here; nothing about the month or the count is fixed in the markup. */
  let openCount = 0;
  let bookableCount = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toISO(year, month, day);
    if (iso < todayISO) continue;
    bookableCount += 1;
    if (!bookedDates.has(iso)) openCount += 1;
  }

  /**
   * What the detail block describes: the hovered date, falling back to the selected one.
   *
   * Neither hover alone nor selection alone covers the design. Hover has to keep
   * driving it, because that is the promise the section's step 01 makes ("open dates
   * show their time windows as you hover") and because LandingPage's slot fetch is
   * keyed to `hoveredISO` — nothing else would ever populate `slotsByDate`. But a
   * block that empties the moment the pointer leaves the grid cannot show what the
   * screenshot shows: a filled panel for the date you picked, with nothing hovered.
   * So hover wins while it lasts, and the selection is what the block rests on after.
   *
   * A selected date always has its slots cached, because selecting one means having
   * hovered or focused it first. If it somehow does not — a tap that fires no
   * mouseenter — this lands on the same "Available to book" fallback a failed fetch
   * gets, which is the wording the calendar has always degraded to.
   */
  const detailISO = hoveredISO ?? selectedDate;

  const detail = (() => {
    if (!detailISO) return null;
    const slots = slotsByDate[detailISO];
    const loaded = slots && slots !== 'error' ? slots : null;

    /* What the line says, in priority order:
         past / reserved   → no point listing times
         real slot data    → the actual open windows
         still loading or
         endpoint failed   → the original wording, so a dead endpoint degrades
                             to what the calendar always said */
    let state: DayState;
    let text: string;
    if (detailISO < todayISO) { state = 'past'; text = 'Past date'; }
    else if (bookedDates.has(detailISO)) { state = 'booked'; text = 'Already reserved'; }
    else if (loaded?.dayLocked) { state = 'closed'; text = 'Closed for bookings'; }
    else if (loaded && loaded.free.length === 0) { state = 'booked'; text = 'No open time slots'; }
    else if (loaded && loaded.busy.length === 0) {
      // Nothing booked at all: quote the whole operating day rather than making
      // it sound like a leftover gap.
      state = 'open';
      text = `Open all day · ${fmtWindow(loaded.opensAt, loaded.closesAt)}`;
    } else if (loaded) {
      state = 'open';
      text = `Open ${loaded.free.map((w) => fmtWindow(w.start, w.end)).join(', ')}`;
    } else { state = 'open'; text = 'Available to book'; }

    /* The only place the setup-time rule surfaces anywhere in the UI. */
    const gap = loaded && loaded.busy.length > 0 && loaded.free.length > 0
      ? `Allows for a ${loaded.bufferHours}-hour setup gap around the ${loaded.busy.length === 1 ? 'booked event' : 'booked events'}.`
      : null;

    return { state, text, gap, date: fmtSelected(detailISO) };
  })();

  return (
    <div className="lp-cal">
      <div className="lp-cal-head">
        {/* Both arrows flank the month, with the count on the far side — the month
            label is the toggle, so keeping the two nav buttons beside it means a
            press aimed at "next month" can never land on "collapse the grid". */}
        <div className="lp-cal-head-nav">
          <button type="button" className="lp-cal-nav" onClick={onPrevMonth} aria-label="Previous month">
            <ChevronLeft size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lp-cal-month lp-cal-toggle"
            aria-expanded={gridOpen}
            aria-controls={gridId}
            onClick={() => setGridOpen((o) => !o)}
          >
            {MONTH_NAMES[month]} {year}
            <ChevronDown className="lp-cal-caret" size={13} strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" className="lp-cal-nav" onClick={onNextMonth} aria-label="Next month">
            <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <span className="lp-cal-count">{openCount} / {bookableCount} open</span>
      </div>

      <div id={gridId} className={`lp-cal-collapse${gridOpen ? ' is-open' : ''}`}>
      <div className="lp-cal-grid">
        {DAY_ABBR.map((d, i) => (
          <span key={`${d}-${i}`} className="lp-cal-dow" aria-hidden="true">{d}</span>
        ))}

        {Array.from({ length: firstWeekday }).map((_, i) => <span key={`pad-${i}`} />)}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const iso = toISO(year, month, day);
          const isToday = iso === todayISO;
          const isBooked = bookedDates.has(iso);
          /* Past and booked are two different facts and keep two classes: a booked
             date was taken by someone, a past one is simply gone. Only the first is
             struck through. */
          const isPast = iso < todayISO && !isToday;
          // Only a real, still-bookable date can be picked.
          const selectable = !isBooked && !isPast;
          const isSelected = selectedDate === iso;

          return (
            <span
              key={day}
              role={selectable ? 'button' : undefined}
              tabIndex={selectable ? 0 : undefined}
              aria-pressed={selectable ? isSelected : undefined}
              className={[
                'lp-cal-day',
                isToday ? 'lp-cal-day--today' : '',
                isBooked ? 'lp-cal-day--booked' : '',
                isPast ? 'lp-cal-day--past' : '',
                isSelected ? 'lp-cal-day--selected' : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => onHover(iso)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(iso)}
              onBlur={() => onHover(null)}
              onClick={() => selectable && onSelect(isSelected ? null : iso)}
              onKeyDown={(e) => {
                if (!selectable) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isSelected ? null : iso);
                }
              }}
              title={isBooked ? 'Already booked' : isPast ? 'Past date' : `Select ${iso}`}
            >
              {day}
            </span>
          );
        })}
      </div>
      </div>

      {/* Same live region the single note line was, so hovering a date still
          announces what it found — only the shape around it changed. */}
      <div className="lp-cal-detail" aria-live="polite">
        {detail ? (
          <>
            <div className="lp-cal-detail-head">
              <p className="lp-cal-detail-date">{detail.date}</p>
              <span className={`lp-cal-badge lp-cal-badge--${detail.state}`}>
                {BADGE_LABEL[detail.state]}
              </span>
            </div>
            <p className="lp-cal-detail-line">{detail.text}</p>
            {detail.gap && <p className="lp-cal-detail-gap">{detail.gap}</p>}
          </>
        ) : (
          <p className="lp-cal-detail-empty">
            Hover a date to see its open time windows, or pick one to reserve.
          </p>
        )}
      </div>

      <button
        type="button"
        className="ui-btn ui-btn-accent ui-btn-block"
        disabled={!selectedDate}
        onClick={onReserve}
      >
        {selectedDate ? `Reserve ${fmtSelected(selectedDate)}` : 'Pick a date to reserve'}
      </button>

      {/* Kept, though the target design drops it: the subheadline beside the card
          explains struck-through vs open, but nothing else names the selected state,
          and the swatches are the only key for the today outline's neighbours. */}
      <div className="lp-cal-legend">
        <span><i className="lp-cal-swatch" style={{ background: 'var(--accent)' }} />Selected</span>
        <span><i className="lp-cal-swatch" style={{ background: 'var(--border-strong)' }} />Open</span>
        <span><i className="lp-cal-swatch" style={{ background: 'var(--text-muted)', opacity: 0.55 }} />Booked</span>
      </div>
    </div>
  );
}

export default AvailabilityCalendar;
