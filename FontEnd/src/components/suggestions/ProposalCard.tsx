import type { Proposal, ProposalLine } from '../../api/suggestionsApi';

/*
 * Reusable tier/proposal card (Slice A budget planner AND Slice C assistant chat).
 * Self-contained `prop-` prefix so it renders identically wherever it's dropped.
 *
 * GOLDEN RULE: every money figure here is rendered exactly as the backend sent it
 * (subtotal / tax / total / remainingBudget / unitPrice / lineTotal). Nothing is
 * summed or re-derived client-side.
 */

const fmt = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

const TIER_ACCENT: Record<string, string> = {
  Essential: 'var(--text-muted)',
  Balanced: 'var(--primary)',
  Premium: 'var(--accent)',
};

const LINE_LABEL: Record<string, string> = {
  Package: 'Package',
  MenuItem: 'Dish',
  MenuTray: 'Tray',
  Service: 'Service',
  Rental: 'Rental',
};

/** Render this ONCE per surface, then map ProposalCard items — keeps the CSS out of every card. */
export function ProposalCardStyles() {
  return (
    <style>{`
      .prop-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r-xl);
        display: flex; flex-direction: column;
        overflow: hidden;
        transition: border-color 0.25s, box-shadow 0.25s;
      }
      .prop-card:hover { border-color: var(--border-accent); box-shadow: var(--shadow-md); }
      .prop-head { padding: 1.2rem 1.4rem 1rem; border-bottom: 1px solid var(--border); }
      .prop-tier {
        font-family: var(--font-body); font-size: 0.56rem;
        letter-spacing: 0.26em; text-transform: uppercase; font-weight: 500;
      }
      .prop-total {
        font-family: var(--font-display); font-size: 2rem; font-weight: 600;
        line-height: 1; color: var(--text-primary); margin-top: 0.5rem;
      }
      .prop-rationale {
        font-family: var(--font-body); font-size: 0.76rem; font-weight: 300;
        color: var(--text-muted); line-height: 1.55; margin-top: 0.6rem;
      }
      .prop-coverage {
        font-family: var(--font-body); font-size: 0.6rem;
        letter-spacing: 0.14em; text-transform: uppercase; font-weight: 500;
        color: var(--primary); margin-top: 0.7rem;
        display: inline-flex; align-items: center; gap: 0.35rem;
      }
      .prop-lines { padding: 0.5rem 1.4rem; flex: 1; }
      .prop-line {
        display: flex; align-items: center; gap: 0.7rem;
        padding: 0.55rem 0; border-bottom: 1px solid var(--border);
      }
      .prop-line:last-child { border-bottom: none; }
      .prop-line-name {
        font-family: var(--font-body); font-size: 0.8rem; font-weight: 400;
        color: var(--text-primary); flex: 1; min-width: 0;
      }
      .prop-line-sub {
        font-family: var(--font-body); font-size: 0.62rem; font-weight: 300;
        color: var(--text-dim); margin-top: 0.1rem;
      }
      .prop-tag {
        font-family: var(--font-body); font-size: 0.5rem;
        letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500;
        color: var(--text-muted); background: var(--bg-subtle);
        border: 1px solid var(--border);
        padding: 0.15rem 0.45rem; border-radius: var(--r-full);
        flex-shrink: 0;
      }
      .prop-line-total {
        font-family: var(--font-body); font-size: 0.8rem; font-weight: 500;
        color: var(--text-primary); white-space: nowrap;
      }
      .prop-slots {
        padding: 0.8rem 1.4rem; border-top: 1px solid var(--border);
        background: var(--bg-subtle);
      }
      .prop-slot-row {
        display: flex; justify-content: space-between; gap: 0.8rem;
        font-family: var(--font-body); font-size: 0.72rem; padding: 0.2rem 0;
      }
      .prop-totals {
        padding: 1rem 1.4rem; border-top: 1px solid var(--border);
        background: var(--bg-subtle);
        display: flex; flex-direction: column; gap: 0.35rem;
      }
      .prop-total-row {
        display: flex; justify-content: space-between; align-items: baseline;
        font-family: var(--font-body); font-size: 0.78rem;
      }
      .prop-total-row .k { color: var(--text-dim); }
      .prop-total-row .v { color: var(--text-primary); font-weight: 500; }
      .prop-total-row.grand .k { color: var(--text-secondary); font-weight: 500; }
      .prop-total-row.grand .v {
        font-family: var(--font-display); font-size: 1.25rem; font-weight: 600;
        color: var(--primary);
      }
      .prop-foot { padding: 1rem 1.4rem 1.3rem; }
      .prop-btn {
        width: 100%;
        font-family: var(--font-body); font-size: 0.62rem;
        letter-spacing: 0.2em; text-transform: uppercase; font-weight: 500;
        padding: 0.72rem 1.15rem; border-radius: var(--r-full);
        cursor: pointer; border: 1px solid var(--primary);
        background: var(--primary); color: var(--primary-text);
        transition: background 0.2s, transform 0.2s;
      }
      .prop-btn:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
      .prop-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    `}</style>
  );
}

function LineRow({ line }: { line: ProposalLine }) {
  return (
    <div className="prop-line">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="prop-line-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {line.name}
        </div>
        <div className="prop-line-sub">
          {line.quantity} × {fmt(line.unitPrice)}
        </div>
      </div>
      <span className="prop-tag">{LINE_LABEL[line.type] ?? line.type}</span>
      <span className="prop-line-total">{fmt(line.lineTotal)}</span>
    </div>
  );
}

export interface ProposalCardProps {
  proposal: Proposal;
  /** When provided, renders a "Use this plan" button that calls back with this proposal. */
  onUse?: (proposal: Proposal) => void;
  /** Disables the action button (e.g. while materializing). */
  busy?: boolean;
  /** Button label override (defaults to "Use this plan"). */
  actionLabel?: string;
}

export function ProposalCard({ proposal, onUse, busy, actionLabel }: ProposalCardProps) {
  const accent = TIER_ACCENT[proposal.tier] ?? 'var(--primary)';

  return (
    <div className="prop-card">
      <div className="prop-head">
        <div className="prop-tier" style={{ color: accent }}>{proposal.tier}</div>
        <div className="prop-total">{fmt(proposal.total)}</div>
        <p className="prop-rationale">{proposal.rationale}</p>
        <div className="prop-coverage">
          ✦ Feeds {proposal.foodCoverageForGuests} guests
        </div>
      </div>

      <div className="prop-lines">
        {proposal.lines.map((line) => (
          <LineRow key={`${line.type}-${line.refId}`} line={line} />
        ))}
      </div>

      {proposal.packageSlotSelections.length > 0 && (
        <div className="prop-slots">
          {proposal.packageSlotSelections.map((slot) => (
            <div key={slot.slotId} className="prop-slot-row">
              <span style={{ color: 'var(--text-dim)' }}>{slot.slotLabel}</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right' }}>
                {slot.itemNames.join(', ')}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="prop-totals">
        <div className="prop-total-row"><span className="k">Subtotal</span><span className="v">{fmt(proposal.subtotal)}</span></div>
        <div className="prop-total-row"><span className="k">Tax</span><span className="v">{fmt(proposal.tax)}</span></div>
        <div className="prop-total-row grand"><span className="k">Total</span><span className="v">{fmt(proposal.total)}</span></div>
        <div className="prop-total-row">
          <span className="k">Budget remaining</span>
          <span className="v" style={{ color: 'var(--primary)' }}>{fmt(proposal.remainingBudget)}</span>
        </div>
      </div>

      {onUse && (
        <div className="prop-foot">
          <button type="button" className="prop-btn" disabled={busy} onClick={() => onUse(proposal)}>
            {busy ? 'Creating…' : (actionLabel ?? 'Use this plan')}
          </button>
        </div>
      )}
    </div>
  );
}
