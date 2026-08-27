import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './auth.css';

export interface AuthLayoutProps {
  /** Marketing heading on the plum panel. Desktop only. */
  brandTitle: string;
  /** Supporting line under it. Desktop only. */
  brandBody: string;
  /** Bottom slot of the plum panel — stats on sign-in, the what-happens-next note on register. */
  brandFoot?: ReactNode;
  /** The form panel's heading. This is the page's <h1>. */
  title: string;
  subtitle: string;
  children: ReactNode;
  /** The "Don't have an account?" line under the form. */
  footer?: ReactNode;
}

/**
 * The two-panel auth shell, shared by sign-in and register.
 *
 * Below 900px the plum column becomes a header strip carrying the brand mark
 * only, and the page heading below it continues that strip's tint — so the
 * first field is still in the fold on a phone. See auth.css for why the
 * heading is one element rather than two.
 */
export function AuthLayout({
  brandTitle, brandBody, brandFoot, title, subtitle, children, footer,
}: AuthLayoutProps) {
  return (
    <main className="au-page">
      <div className="au-split">
        <aside className="au-brand">
          <Link to="/" className="au-brand-mark">King&nbsp;Jegi</Link>

          <div className="au-brand-pitch">
            <p className="au-brand-title">{brandTitle}</p>
            <p className="au-brand-body">{brandBody}</p>
          </div>

          {brandFoot}
        </aside>

        <div className="au-panel">
          <div className="au-head">
            <h1 className="au-title">{title}</h1>
            <p className="au-sub">{subtitle}</p>
          </div>

          {children}

          {footer && <p className="au-foot">{footer}</p>}
        </div>
      </div>
    </main>
  );
}

/** The sign-in panel's proof row. */
export function AuthStats({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <div className="au-brand-stats">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="au-brand-stat-value">{s.value}</div>
          <div className="au-brand-stat-label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export default AuthLayout;
