/**
 * The two label primitives the admin surfaces share.
 *
 * Both lived in AdminDashboardPage and were imported from there by
 * AdminPackagesTab, which is how a tab file ended up depending on the dashboard
 * page rather than on a component.
 */

/**
 * A status pill. Takes ONE colour and derives both the wash and the hairline from
 * it with color-mix, so a status map only ever has to name a single value — see
 * statusMeta.ts, where every entry is `{ label, color }` for exactly this reason.
 *
 * The 12% tint is also why those maps carry ink variants (--warning-ink,
 * --danger-ink) rather than the plain tokens: laying a colour on a 12% tint of
 * itself costs about 0.8:1 of contrast.
 */
export function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-body)',
        fontSize: '0.62rem',
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        padding: '0.28rem 0.68rem', borderRadius: 'var(--r-full)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

/**
 * A small caps caption above a field.
 *
 * A <span>, not a <label> — it names nothing programmatically, so any input it
 * sits above still needs its own aria-label or an htmlFor/id pair. Several did
 * not, which is why the cancel and deny reason fields carry aria-labels.
 */
export function FieldLabel({ text }: { text: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-body)', fontSize: '0.52rem',
        letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 500,
        color: 'var(--text-dim)', display: 'block', marginBottom: '0.4rem',
      }}
    >
      {text}
    </span>
  );
}
