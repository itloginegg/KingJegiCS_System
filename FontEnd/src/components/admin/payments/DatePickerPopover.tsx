import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface DatePickerPopoverProps {
  /** Selected day as "YYYY-MM-DD". */
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/** Monday-first, matching the rest of the admin calendars. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * Month grid in a floating card.
 *
 * The grid is a roving-focus widget: arrows move a day at a time, Up/Down a week,
 * PageUp/PageDown a month, Enter selects. Moving off either edge of the month rolls
 * into the next one rather than dead-ending, so a keyboard user can reach any date
 * without touching the month chevrons.
 */
export function DatePickerPopover({ value, onChange, onClose }: DatePickerPopoverProps) {
  const selected = parseIso(value);
  const [viewMonth, setViewMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const [focusDate, setFocusDate] = useState(() => parseIso(value));
  const cardRef = useRef<HTMLDivElement | null>(null);
  const focusedCellRef = useRef<HTMLButtonElement | null>(null);
  /* Focus follows the arrow keys only — never on the first render, which would rip
     focus off the trigger the moment the popover opens. */
  const shouldFocusCell = useRef(false);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!shouldFocusCell.current) return;
    focusedCellRef.current?.focus();
    shouldFocusCell.current = false;
  });

  const moveFocus = (days: number) => {
    const next = new Date(focusDate);
    next.setDate(next.getDate() + days);
    setFocusDate(next);
    // Follow the cursor into the neighbouring month when it crosses the boundary.
    if (next.getMonth() !== viewMonth.getMonth() || next.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    shouldFocusCell.current = true;
  };

  const moveMonth = (delta: number) => {
    const next = new Date(focusDate);
    next.setMonth(next.getMonth() + delta);
    setFocusDate(next);
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    shouldFocusCell.current = true;
  };

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday is column 0.
  const leading = (firstOfMonth.getDay() + 6) % 7;

  /* 42 cells so the grid never changes height between months, which would make the
     card jump under the trigger. Out-of-month days are shown, just faint. */
  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - leading + i);
    return d;
  });

  const todayIso = iso(new Date());

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Choose a date"
      className="absolute right-0 top-full z-40 mt-2 w-[19rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-lg)]"
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span aria-live="polite" className="text-[0.95rem] font-semibold text-[var(--text-primary)]">
          {viewMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            aria-hidden="true"
            className={`py-1 text-center text-[0.7rem] font-bold ${
              i === 6 ? 'text-orange-500' : 'text-[var(--text-primary)]'
            }`}
          >
            {d}
          </div>
        ))}

        {cells.map((d) => {
          const cellIso = iso(d);
          const inMonth = d.getMonth() === month;
          const isSunday = d.getDay() === 0;
          const isSelected = cellIso === value;
          const isFocused = cellIso === iso(focusDate);
          const isToday = cellIso === todayIso;

          return (
            <button
              key={cellIso}
              ref={isFocused ? focusedCellRef : undefined}
              type="button"
              tabIndex={isFocused ? 0 : -1}
              aria-current={isSelected ? 'date' : undefined}
              aria-label={d.toLocaleDateString('en-PH', { dateStyle: 'full' })}
              onClick={() => { onChange(cellIso); onClose(); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(-1); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-7); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(7); }
                else if (e.key === 'PageUp') { e.preventDefault(); moveMonth(-1); }
                else if (e.key === 'PageDown') { e.preventDefault(); moveMonth(1); }
                else if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(iso(focusDate));
                  onClose();
                }
              }}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[0.8rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                isSelected
                  ? 'bg-orange-500 font-semibold text-white'
                  : !inMonth
                    ? 'text-[var(--text-dim)] opacity-55 hover:bg-[var(--bg-subtle)]'
                    : isSunday
                      ? 'text-orange-500 hover:bg-[var(--bg-subtle)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
              } ${isToday && !isSelected ? 'ring-1 ring-orange-300' : ''}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default DatePickerPopover;
