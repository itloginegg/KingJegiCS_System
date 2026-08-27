import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, CalendarDays } from 'lucide-react';
import type { ResStatus } from '../../../pages/AdminDashboardPage';
import { BOOKING_GROUPS, type BookingGroupKey } from './types';

/** 'all' plus the five statuses — every value `resFilter` can hold. */
type TreeValue = 'all' | ResStatus;

const CHILDREN: { value: TreeValue; label: string }[] = [
  { value: 'all', label: 'All' },
  ...BOOKING_GROUPS.map((g) => ({ value: g as TreeValue, label: g })),
];

export interface BookingsTreeMenuProps {
  /** Accordion state. Owned by the page so it survives tab switches. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** True when the Bookings tab is the active view. */
  active: boolean;
  /** The page's `resFilter`. */
  value: TreeValue;
  /** Selects tab + status in one go — the page's `selectBookingStatus`. */
  onSelect: (next: TreeValue) => void;
  counts: Record<BookingGroupKey, number>;
  totalCount: number;
  /** Attention badge (pending bookings). Lives on the parent so collapsing can't hide it. */
  badge?: number;
}

/**
 * The Bookings entry in the admin sidebar: an accordion parent over one child per
 * status filter.
 *
 * Styled by the page's own `.adm-nav-*` rules rather than utilities, so the active
 * child is literally the same treatment as every other nav item instead of a
 * lookalike that drifts the next time the sidebar is themed.
 *
 * Clicking the parent expands AND selects, restoring whatever status was last used —
 * a parent that needs two clicks before the content area shows anything is worse than
 * no accordion at all. Clicking it again while Bookings is already active collapses
 * the group without deselecting, so the content never goes blank underneath.
 */
export function BookingsTreeMenu({
  expanded, onToggleExpanded,
  active, value, onSelect,
  counts, totalCount, badge = 0,
}: BookingsTreeMenuProps) {
  const listId = useId();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Roving tabindex: only one child is in the tab order at a time. */
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef<number | null>(null);

  /* Keep the roving index on the selected child, so tabbing back into the group
     lands on the one that's actually showing. */
  useEffect(() => {
    const i = CHILDREN.findIndex((c) => c.value === value);
    if (i >= 0) setFocusIndex(i);
  }, [value]);

  /* Focus moves only in response to keyboard navigation — never on render, which
     would steal focus every time the counts refetch. */
  useEffect(() => {
    if (pendingFocus.current === null) return;
    itemRefs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

  const moveFocus = (to: number) => {
    const next = (to + CHILDREN.length) % CHILDREN.length;
    setFocusIndex(next);
    pendingFocus.current = next;
  };

  const Caret = expanded ? ChevronUp : ChevronDown;

  const countFor = (v: TreeValue) => (v === 'all' ? totalCount : counts[v as BookingGroupKey] ?? 0);

  return (
    <div className="adm-nav-tree">
      <button
        type="button"
        className={`adm-nav-item${active ? ' active' : ''}`}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={onToggleExpanded}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && expanded) {
            e.preventDefault();
            moveFocus(focusIndex);
          }
        }}
      >
        <span className="adm-nav-icon" aria-hidden="true"><CalendarDays size={18} strokeWidth={1.75} /></span>
        <span className="adm-nav-label">Bookings</span>
        {badge > 0 && <span className="adm-badge">{badge}</span>}
        <Caret size={14} strokeWidth={2} className="adm-nav-caret" aria-hidden="true" />
      </button>

      {expanded && (
        <ul id={listId} className="adm-nav-children">
          {CHILDREN.map((child, i) => {
            const selected = active && value === child.value;
            return (
              <li key={child.value}>
                <button
                  ref={(el) => { itemRefs.current[i] = el; }}
                  type="button"
                  className={`adm-nav-item adm-nav-child${selected ? ' active' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  tabIndex={i === focusIndex ? 0 : -1}
                  onClick={() => onSelect(child.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(i + 1); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(i - 1); }
                    else if (e.key === 'Home') { e.preventDefault(); moveFocus(0); }
                    else if (e.key === 'End') { e.preventDefault(); moveFocus(CHILDREN.length - 1); }
                  }}
                >
                  <span className="adm-nav-child-label">{child.label}</span>
                  <span className="adm-nav-count">{countFor(child.value)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default BookingsTreeMenu;
