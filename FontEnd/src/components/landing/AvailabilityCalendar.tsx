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

  /* "N of M dates open" in the header. Counts only days a visitor could actually
     take — past days are neither open nor booked, they are gone. */
  let openCount = 0;
  let bookableCount = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toISO(year, month, day);
    if (iso < todayISO) continue;
    bookableCount += 1;
    if (!bookedDates.has(iso)) openCount += 1;
  }

  const hoverNote = (() => {
    if (!hoveredISO) return null;
    const slots = slotsByDate[hoveredISO];
    const loaded = slots && slots !== 'error' ? slots : null;

    /* What the line says, in priority order:
         past / reserved   → no point listing times
         real slot data    → the actual open windows
         still loading or
         endpoint failed   → the original wording, so a dead endpoint degrades
                             to what the calendar always said */
    let detail: string;
    if (hoveredISO < todayISO) detail = 'Past date';
    else if (bookedDates.has(hoveredISO)) detail = 'Already reserved';
    else if (loaded?.dayLocked) detail = 'Closed for bookings';
    else if (loaded && loaded.free.length === 0) detail = 'No open time slots';
    else if (loaded && loaded.busy.length === 0) {
      // Nothing booked at all: quote the whole operating day rather than making
      // it sound like a leftover gap.
      detail = `Open all day (${fmtWindow(loaded.opensAt, loaded.closesAt)})`;
    } else if (loaded) {
      detail = `Open ${loaded.free.map((w) => fmtWindow(w.start, w.end)).join(', ')}`;
    } else detail = 'Available to book';

    const gap = loaded && loaded.busy.length > 0 && loaded.free.length > 0
      ? `Allows for a ${loaded.bufferHours}-hour setup gap around the ${loaded.busy.length === 1 ? 'booked event' : 'booked events'}.`
      : null;

    return { label: `${fmtSelected(hoveredISO)} — ${detail}`, gap };
  })();

  return (
    <div className="lp-cal">
      <div className="lp-cal-head">
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="lp-cal-count">{openCount} of {bookableCount} dates open</span>
          <button type="button" className="lp-cal-nav" onClick={onNextMonth} aria-label="Next month">
            <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
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

      <p className="lp-cal-note" aria-live="polite">
        {hoverNote ? (
          <>
            {hoverNote.label}
            {hoverNote.gap && <small>{hoverNote.gap}</small>}
          </>
        ) : (
          'Hover a date to see its open time windows.'
        )}
      </p>

      <button
        type="button"
        className="ui-btn ui-btn-primary ui-btn-block ui-btn-sm"
        disabled={!selectedDate}
        onClick={onReserve}
      >
        {selectedDate ? `Reserve ${fmtSelected(selectedDate)}` : 'Pick a date to reserve'}
      </button>

      <div className="lp-cal-legend">
        <span><i className="lp-cal-swatch" style={{ background: 'var(--accent)' }} />Selected</span>
        <span><i className="lp-cal-swatch" style={{ background: 'var(--border-strong)' }} />Open</span>
        <span><i className="lp-cal-swatch" style={{ background: 'var(--text-muted)', opacity: 0.55 }} />Booked</span>
      </div>
    </div>
  );
}

export default AvailabilityCalendar;
