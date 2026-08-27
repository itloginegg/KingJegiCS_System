import { Link } from 'react-router-dom';

/**
 * The closing band.
 *
 * Carries `.dark-band` rather than reading --primary. --primary flips to a light
 * rose in dark mode, so a band built on it would turn from an inverted section
 * into a glowing pink one; the band tokens stay dark in both themes by design.
 */
export function ClosingCta() {
  return (
    <section className="lp-cta dark-band">
      <div className="ui-wrap">
        <div className="ui-kicker" style={{ textAlign: 'center' }}>Ready to book?</div>
        <h2 className="ui-h2">Let&rsquo;s make your event unforgettable</h2>
        <p className="lp-cta-lead">
          Join over 500 families and businesses who trusted King Jegi to feed their
          most important moments. Reserve your date now.
        </p>
        <div className="lp-cta-actions">
          <Link to="/book" className="ui-btn ui-btn-band">Reserve your event</Link>
          <Link to="/packages" className="ui-btn ui-btn-band-outline">View packages</Link>
        </div>
        <p className="lp-cta-fine">5% reservation fee · Confirmation within 24 hours</p>
      </div>
    </section>
  );
}

export default ClosingCta;
