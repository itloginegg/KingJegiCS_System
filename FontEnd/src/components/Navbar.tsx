import { Link } from 'react-router-dom';

/**
 * ⚠️ PLACEHOLDER — replace this file with your real Navbar component.
 * It exists only so LandingPage.tsx compiles in this repo; it mirrors the
 * prop contract your landing page uses (`activePage`).
 */
interface NavbarProps {
  activePage?: 'home' | 'menus' | 'packages' | 'rentals' | 'booknow';
}

export default function Navbar({ activePage = 'home' }: NavbarProps) {
  const links: { to: string; label: string; key: NavbarProps['activePage'] }[] = [
    { to: '/', label: 'Home', key: 'home' },
    { to: '/menus', label: 'Menus', key: 'menus' },
    { to: '/packages', label: 'Packages', key: 'packages' },
    { to: '/rentals', label: 'Rentals', key: 'rentals' },
    { to: '/booknow', label: 'Book Now', key: 'booknow' },
  ];

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '1rem 2.5rem',
      background: 'var(--surface, rgba(255,255,255,0.85))',
      borderBottom: '1px solid var(--border, #e5e7eb)',
      backdropFilter: 'blur(12px)',
    }}>
      <Link to="/" style={{ fontWeight: 700, textDecoration: 'none', color: 'var(--text-primary, #111)' }}>
        King Jegi
      </Link>
      <div style={{ display: 'flex', gap: '1.5rem' }}>
        {links.map((l) => (
          <Link
            key={l.key}
            to={l.to}
            style={{
              fontSize: '0.8rem', textDecoration: 'none',
              color: l.key === activePage ? 'var(--primary, #16a34a)' : 'var(--text-muted, #6b7280)',
              fontWeight: l.key === activePage ? 600 : 400,
            }}
          >
            {l.label}
          </Link>
        ))}
        <Link to="/login" style={{ fontSize: '0.8rem', textDecoration: 'none', color: 'var(--text-muted, #6b7280)' }}>
          Sign in
        </Link>
      </div>
    </nav>
  );
}
