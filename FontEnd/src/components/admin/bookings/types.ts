import type { BookingResponse } from '../../../api/bookingApi';

/* ActionItem lives in ../shared: the dropdown that consumes it is shared with the
   payments table. Re-exported so existing bookings imports keep working. */
export type { ActionItem } from '../shared/types';

/**
 * Shared contracts for the three Bookings-tab components.
 *
 * These live in their own module rather than in AdminDashboardPage so the components
 * can be imported without dragging the 373KB page in behind them.
 */

/**
 * The status groups the table renders, in display order.
 *
 * Cancelled is included even though it wasn't in the original grouping spec: the old
 * card list showed cancelled bookings (neither `filteredRes` nor the status pills
 * excluded them), so omitting the group here would silently drop rows out of the UI
 * with no way left to reach them. It renders last and starts collapsed.
 */
export type BookingGroupKey = 'Draft' | 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';

export const BOOKING_GROUPS: readonly BookingGroupKey[] = [
  'Draft', 'Pending', 'Confirmed', 'Completed', 'Cancelled',
] as const;

/** Groups that start collapsed. Terminal states are history, not the working queue. */
export const COLLAPSED_BY_DEFAULT: readonly BookingGroupKey[] = ['Completed', 'Cancelled'] as const;

/**
 * Sortable columns.
 *
 * `customerEmail` and `packageName` only became sortable once the list DTO started
 * joining Customer and Menupackage — before that the client had an id and nothing to
 * order by.
 */
export type SortKey =
  | 'bookingType'
  | 'eventType'
  | 'bookingName'
  | 'contactNumber'
  | 'customerEmail'
  | 'guestCount'
  | 'packageName'
  | 'eventDate'
  | 'endDate'
  | 'depositStatus';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Every row action, wired straight to the handlers that already exist on
 * AdminDashboardPage. Nothing here reimplements behaviour — each one is a pass-through
 * so the dropdown and the old button row drive identical code.
 */
export interface BookingRowActions {
  /** Draft → Pending. `submitDraftFor` */
  onSubmitDraft: (booking: BookingResponse) => void;
  /** Opens the detail modal, which is where DraftItemsEditor lives. `openBookingDetail` */
  onOpenDetail: (booking: BookingResponse) => void;
  /** `setCashTarget` → CashPaymentModal */
  onLogCash: (booking: BookingResponse) => void;
  /** `setResStatus(id, 'Confirmed')` */
  onConfirm: (booking: BookingResponse) => void;
  /** `setResStatus(id, 'Completed')` */
  onMarkCompleted: (booking: BookingResponse) => void;
  /** `openInvoiceFor` */
  onOpenInvoice: (booking: BookingResponse) => void;
  /** `openContract` */
  onGenerateContract: (booking: BookingResponse) => void;
  /** `setResourcesResId` → EventResourcesModal */
  onAllocateResources: (booking: BookingResponse) => void;
  /** `openNoteEditor` — the adminNote editor, kept from the old button row. */
  onEditNote: (booking: BookingResponse) => void;
  /** Switches to the histories tab and loads it. `openTab('histories')` + `openHistory` */
  onViewHistory: (booking: BookingResponse) => void;
  /** Opens the existing inline reason prompt; the actual call is `cancelReservation`. */
  onCancel: (booking: BookingResponse) => void;
}

/** Per-booking in-flight flags, so a menu item can show its own pending state. */
export interface BookingBusyState {
  submitBusyId: string | null;
  detailBusyId: string | null;
  invoiceBusyId: string | null;
  contractBusyId: string | null;
}

