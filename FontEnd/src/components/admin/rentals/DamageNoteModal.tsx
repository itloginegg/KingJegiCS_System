/**
 * The damage-note prompt for a rental line. The backend requires a note to mark a
 * line Damaged, so Confirm stays disabled until there is one.
 *
 * Rendered by the page rather than by RentalsTab: the booking-detail popup, which
 * opens over any tab, offers Mark Damaged too, and both entry points share this
 * one prompt and the page's delivery-status action behind it.
 */
import { createPortal } from 'react-dom';
import type { OutstandingRentalLine } from '../../../api/bookingApi';
import { fmtDate } from '../../../lib/format';
import { FieldLabel } from '../shared/StatusBadge';

export interface DamageNoteModalProps {
  target: OutstandingRentalLine;
  note: string;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DamageNoteModal({ target, note, onNoteChange, onCancel, onConfirm }: DamageNoteModalProps) {
  return createPortal(
    <div className="adm-modal-overlay" onClick={onCancel}>
      <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Mark rental line damaged">
        <h3>Mark as Damaged</h3>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.2rem' }}>
          {target.quantity} × {target.itemName} — {target.customerName}, {fmtDate(target.eventDate)}.
          This keeps the stock held out of inventory until the line is resolved.
        </p>
        <label style={{ display: 'block', marginTop: '1rem' }}>
          <FieldLabel text="What's wrong? (required)" />
          <textarea
            className="adm-input"
            rows={3}
            maxLength={500}
            value={note}
            autoFocus
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="e.g. 3 chairs with cracked legs"
            style={{ width: '100%', resize: 'vertical' }}
          />
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
          <button type="button" className="adm-btn outline" onClick={onCancel}>Cancel</button>
          <button type="button" className="adm-btn danger" disabled={!note.trim()} onClick={onConfirm}>
            Mark Damaged
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
