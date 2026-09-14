/**
 * The Bookings tab: the grouped bookings table with its toolbar, plus the two
 * inline prompts its row menu opens (the staff-note editor and the cancellation
 * reason) and the New Booking modal.
 *
 * THE LINE THIS FILE DRAWS. What decides WHICH rows show stays on the page: the
 * status filter is written by the sidebar tree and the URL, the search by the
 * notification feed and Overview, and all three filters have always outlived a
 * trip to another tab. What exists only while you are working in the tab lives
 * here: the filter panel being open, the note being drafted, the booking being
 * cancelled, the New Booking modal.
 *
 * The rest of the row menu (detail, invoice, contract, cash, resources, history)
 * opens modals that render over any tab, so those handlers come in as
 * `rowActions` and this file adds only Edit Note and Cancel.
 */
import { useMemo, useState, type ComponentProps } from 'react';
import {
  cancelBooking,
  setBookingAdminNote,
  BookingApiError,
  type BookingResponse,
  type BookingTypeName,
} from '../../../api/bookingApi';
import { readSession } from '../../../lib/tokenStorage';
import { FieldLabel } from '../shared/StatusBadge';
import type { ResStatus } from '../shared/statusMeta';
import { BookingsToolbar } from './BookingsToolbar';
import { BookingsTable } from './BookingsTable';
import { NewBookingModal } from './NewBookingModal';
import type { BookingGroupKey, BookingRowActions } from './types';

export interface BookingsTabProps {
  reservations: BookingResponse[];
  statusFilter: 'all' | ResStatus;
  typeFilter: 'all' | BookingTypeName;
  onTypeFilterChange: (next: 'all' | BookingTypeName) => void;
  search: string;
  onSearchChange: (next: string) => void;
  /** Every row action except Edit Note and Cancel, which this tab supplies. */
  rowActions: Omit<BookingRowActions, 'onEditNote' | 'onCancel'>;
  busy: ComponentProps<typeof BookingsTable>['busy'];
  onViewAll: (group: BookingGroupKey) => void;
  /** A booking the tab changed (note saved, booking cancelled), to merge into the page's list. */
  onBookingUpdated: (updated: BookingResponse) => void;
  onBookingCreated: () => void;
  notify: (kind: 'success' | 'error' | 'info', message: string) => void;
}

export function BookingsTab({
  reservations,
  statusFilter: resFilter,
  typeFilter: resTypeFilter,
  onTypeFilterChange: setResTypeFilter,
  search: resSearch,
  onSearchChange: setResSearch,
  rowActions,
  busy,
  onViewAll,
  onBookingUpdated,
  onBookingCreated,
  notify,
}: BookingsTabProps) {
  /** Whether the toolbar's Filter panel (the booking-type axis) is expanded. */
  const [resFilterOpen, setResFilterOpen] = useState(false);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [cancelResId, setCancelResId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  /* Internal staff notes — one open editor at a time, keyed by booking id. */
  const [noteResId, setNoteResId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);

  const openNoteEditor = (b: BookingResponse) => {
    setNoteResId(b.id);
    setNoteDraft(b.adminNote ?? '');
  };

  const saveAdminNote = async (bookingId: string) => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setNoteBusyId(bookingId);
    try {
      // Blank clears the note server-side, so "save an empty box" reads as "delete".
      const updated = await setBookingAdminNote(session.token, bookingId, noteDraft.trim() || null);
      onBookingUpdated(updated);
      setNoteResId(null);
      notify('success', updated.adminNote ? 'Note saved.' : 'Note cleared.');
    } catch (err) {
      notify('error', err instanceof BookingApiError ? err.message : 'Could not save the note.');
    } finally {
      setNoteBusyId(null);
    }
  };

  const cancelReservation = async (id: string) => {
    const session = readSession();
    if (!session?.token) return;
    try {
      const updated = await cancelBooking(session.token, id);
      onBookingUpdated(updated);
      setCancelResId(null);
      setCancelReason('');
      notify('success', 'Booking cancelled.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to cancel booking.');
    }
  };

  const filteredRes = useMemo(() => {
    const q = resSearch.trim().toLowerCase();
    return reservations
      .filter((r) => resFilter === 'all' || r.status === resFilter)
      // Status and type are independent axes — both must match.
      .filter((r) => resTypeFilter === 'all' || r.bookingType === resTypeFilter)
      // Name / email / phone / event type. Email joined in from Customer on the list
      // read — before that the placeholder claimed to search it and never could.
      .filter(
        (r) =>
          q === '' ||
          (r.bookingName && r.bookingName.toLowerCase().includes(q)) ||
          (r.customerEmail && r.customerEmail.toLowerCase().includes(q)) ||
          (r.contactNumber && r.contactNumber.toLowerCase().includes(q)) ||
          (r.eventType && r.eventType.toLowerCase().includes(q)),
      )
      // Ordering belongs to BookingsTable now — it sorts per column, per group.
  }, [reservations, resFilter, resTypeFilter, resSearch]);

  const bookingActions: BookingRowActions = {
    ...rowActions,
    onEditNote: (b) => (noteResId === b.id ? setNoteResId(null) : openNoteEditor(b)),
    onCancel: (b) => { setCancelResId(b.id); setCancelReason(''); },
  };

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <h2 className="adm-title">Bookings</h2>

      <BookingsToolbar
        search={resSearch}
        onSearchChange={setResSearch}
        typeFilter={resTypeFilter}
        onTypeFilterChange={setResTypeFilter}
        filterOpen={resFilterOpen}
        onToggleFilter={() => setResFilterOpen((o) => !o)}
        onAddBooking={() => setNewBookingOpen(true)}
      />

      {newBookingOpen && (
        <NewBookingModal
          onClose={() => setNewBookingOpen(false)}
          onCreated={() => { setNewBookingOpen(false); onBookingCreated(); }}
          notify={notify}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', minWidth: 0 }}>
        {/* Cancellation requests are the one thing that has to be visible
            without opening a row — the customer is waiting on a decision. */}
        {filteredRes.some((r) => r.cancellationRequested) && (
          <div className="adm-card" style={{ padding: '0.9rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <FieldLabel text="Cancellation requested" />
            {filteredRes.filter((r) => r.cancellationRequested).map((r) => (
              <p key={r.id} style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-muted)', margin: 0 }}>
                <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.bookingName}</strong>
                {' — '}{r.cancellationRequestReason || 'no reason given'}
              </p>
            ))}
          </div>
        )}

        {/* Staff-note editor. Opened from the row menu; kept out of the table
            so a 2000-character textarea can't stretch a cell. */}
        {noteResId && (() => {
          const target = reservations.find((r) => r.id === noteResId);
          if (!target) return null;
          return (
            <div className="adm-card" style={{ padding: '1rem 1.15rem' }}>
              <FieldLabel text={`Internal staff note · ${target.bookingName} — not shown to the customer`} />
              <textarea
                className="adm-input"
                style={{ width: '100%', minHeight: 80, marginTop: '0.35rem', resize: 'vertical' }}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                maxLength={2000}
                placeholder="Allergies, venue access, who to call on site…"
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="adm-btn primary" disabled={noteBusyId === noteResId} onClick={() => void saveAdminNote(noteResId)}>
                  {noteBusyId === noteResId ? 'Saving…' : 'Save Note'}
                </button>
                <button type="button" className="adm-btn outline" onClick={() => setNoteResId(null)}>Cancel</button>
              </div>
            </div>
          );
        })()}

        {/* Cancel still routes through the existing reason prompt — the
            server requires one, so the menu item opens this rather than
            firing cancelReservation straight off a click. */}
        {cancelResId && (() => {
          const target = reservations.find((r) => r.id === cancelResId);
          if (!target) return null;
          return (
            <div className="adm-card" style={{ padding: '1rem 1.15rem', display: 'flex', gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <FieldLabel text={`Reason for cancelling ${target.bookingName}`} />
                {/* FieldLabel renders a <span>, not a <label>, so it cannot name this field
                    for a screen reader however clearly it reads on screen. */}
                <input aria-label="Reason for cancelling" className="adm-input square" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Required" />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="adm-btn danger" disabled={!cancelReason.trim()} onClick={() => cancelReservation(cancelResId)}>
                  Confirm Cancel
                </button>
                <button type="button" className="adm-btn outline" onClick={() => setCancelResId(null)}>Back</button>
              </div>
            </div>
          );
        })()}

        <BookingsTable
          rows={filteredRes}
          activeGroup={resFilter}
          actions={bookingActions}
          busy={busy}
          onViewAll={onViewAll}
        />
      </div>
    </div>
  );
}
