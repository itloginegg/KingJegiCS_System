import { useEffect } from 'react';
import { X } from 'lucide-react';
import { fmtSelected } from './calendarUtils';

/** The paths BookingPage can be opened straight into from the reserve dialog. */
export type BookingPreset = 'event' | 'rentals' | 'plan';

const OPTIONS: { flow: BookingPreset; icon: string; title: string; blurb: string }[] = [
  {
    flow: 'event',
    icon: '🍽️',
    title: 'Full event catering',
    blurb: 'Food, staff, and setup for your celebration.',
  },
  {
    flow: 'rentals',
    icon: '🎪',
    title: 'Rental items only',
    blurb: 'Tables, chairs, lights, and equipment.',
  },
  {
    flow: 'plan',
    icon: '✨',
    title: 'Plan by budget',
    blurb: 'Tell us your budget — we’ll suggest kitchen-priced options.',
  },
];

export interface ReserveDialogProps {
  /** ISO date being reserved. */
  date: string;
  onClose: () => void;
  onChoose: (flow: BookingPreset) => void;
}

/**
 * "You picked a date — now how do you want to book it?"
 *
 * All three paths go to /book, including Plan by Budget, which works for
 * signed-out visitors: PlanByBudget asks for a login itself, but only at the
 * point it actually needs one to materialize a draft. Sending guests to /login
 * up front would gate a flow that doesn't require it.
 */
export function ReserveDialog({ date, onClose, onChoose }: ReserveDialogProps) {
  /* Escape closes. The dialog is dismissible by click-outside and by the X, and a
     keyboard user had neither. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="ui-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Choose how to book"
      onClick={onClose}
    >
      <div className="ui-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ui-dialog-close" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>

        <div className="ui-kicker">Reserving</div>
        <h3 className="ui-dialog-title">{fmtSelected(date)}</h3>
        <p className="ui-dialog-sub">How would you like to plan this event?</p>

        <div className="ui-options">
          {OPTIONS.map((o) => (
            <button key={o.flow} type="button" className="ui-option" onClick={() => onChoose(o.flow)}>
              <span className="ui-option-icon" aria-hidden="true">{o.icon}</span>
              <span>
                <strong>{o.title}</strong>
                <small>{o.blurb}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ReserveDialog;
