import { Link } from 'react-router-dom';

/**
 * Footer — wordmark left, sections and the legal line right.
 *
 * The old footer was a single centred uppercase copyright line, which gave the
 * page no closing structure and no second route to the catalogs.
 */
export function SiteFooter() {
  return (
    /* Deep plum in both themes, per the revised section 01 — it closes the page
       under the testimonials band rather than reverting to a light strip, which
       left a pale band between two dark ones. */
    <footer className="lp-footer lp-footer-dark dark-band">
      <div className="ui-wrap lp-footer-inner">
        <Link to="/" className="lp-footer-mark">King&nbsp;Jegi</Link>

        <nav className="lp-footer-links" aria-label="Footer">
          <Link to="/packages">Packages</Link>
          <Link to="/menus">Menus</Link>
          <Link to="/rentals">Rentals</Link>
          <Link to="/book">Book now</Link>
        </nav>

        <p className="lp-footer-legal">
          © {new Date().getFullYear()} King Jegi Party Need and Catering Services · Calamba, Laguna
        </p>
      </div>
    </footer>
  );
}

export default SiteFooter;
