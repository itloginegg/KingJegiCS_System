import { useEffect, useState } from 'react';
import { getApprovedTestimonials, type PublicTestimonial } from '../../api/testimonialsApi';
import { AmbientCanvas } from './AmbientCanvas';

/**
 * Fallback copy only.
 *
 * The section renders approved reviews from /api/Testimonials/approved; these stand
 * in while they load and if the business has not approved any of its own yet, so
 * the section is never visibly empty.
 */
const FALLBACK = [
  {
    id: 'fallback-1',
    name: 'Maria Santos',
    caption: 'Wedding · 150 guests',
    quote: 'King Jegi made our wedding feast unforgettable. Guests are still talking about the lechon months later!',
    initials: 'MS',
  },
  {
    id: 'fallback-2',
    name: 'Jerome dela Cruz',
    caption: 'Corporate Event · 80 guests',
    quote: 'Professional from quotation to cleanup. The buffet setup looked stunning and everything was served on time.',
    initials: 'JD',
  },
  {
    id: 'fallback-3',
    name: 'Ana Reyes',
    caption: 'Birthday · 60 guests',
    quote: "Farm-fresh talaga ang lasa! The team handled everything so I could actually enjoy my daughter's party.",
    initials: 'AR',
  },
];

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();

/**
 * Client stories, on the plum band.
 *
 * One quote leads at 1.6fr with the opening mark and display-face type; two more
 * stack beside it, dropped 30px. The previous build put three equal cards on the
 * light ground, which gave the section no focal point and no tonal break between
 * the menu above and the closing band below — the page ran four light sections in
 * a row. The band carries `.dark-band` so it stays dark in both themes.
 *
 * The star row is gone: the design leads on the words, and a rating repeated on
 * every card was the thing competing with them.
 */
export function TestimonialsSection() {
  /* Approved reviews, newest first. Owns its own fetch: nothing else on the page
     reads them, and keeping the call here is what lets the whole section — data
     and markup — move as one unit. */
  const [reviews, setReviews] = useState<PublicTestimonial[]>([]);

  useEffect(() => {
    let cancelled = false;
    getApprovedTestimonials(6)
      .then((rows) => { if (!cancelled) setReviews(rows); })
      .catch(() => { /* keep the fallback copy */ });
    return () => { cancelled = true; };
  }, []);

  const cards = reviews.length > 0
    ? reviews.map((r) => ({
        id: r.id,
        quote: r.body,
        name: r.authorName,
        caption: new Date(r.submittedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' }),
        initials: initialsOf(r.authorName),
      }))
    : FALLBACK;

  const [lead, ...others] = cards;
  if (!lead) return null;

  return (
    <section className="ui-section lp-testi-band dark-band">
      <AmbientCanvas variant="rain" />
      <div className="ui-wrap lp-testi-fore">
        <div className="lp-testi-bento">
          <figure className="lp-testi-lead" style={{ margin: 0 }}>
            <span className="lp-testi-mark" aria-hidden="true">&ldquo;</span>
            <blockquote className="lp-testi-lead-quote" style={{ margin: '0 0 26px' }}>
              {lead.quote}
            </blockquote>
            <figcaption className="lp-testi-who2">
              <span className="lp-avatar-band lp-avatar-band--lg" aria-hidden="true">{lead.initials}</span>
              <span>
                <span className="lp-testi-name2" style={{ fontSize: '0.875rem' }}>{lead.name}</span>
                <span className="lp-testi-meta2">{lead.caption}</span>
              </span>
            </figcaption>
          </figure>

          <div className="lp-testi-stack">
            {others.slice(0, 2).map((t) => (
              <figure key={t.id} className="lp-testi-small" style={{ margin: 0 }}>
                <blockquote className="lp-testi-small-quote" style={{ margin: '0 0 18px' }}>
                  {t.quote}
                </blockquote>
                <figcaption className="lp-testi-who2" style={{ gap: 11 }}>
                  <span className="lp-avatar-band lp-avatar-band--sm" aria-hidden="true">{t.initials}</span>
                  <span>
                    <span className="lp-testi-name2" style={{ fontSize: '0.8125rem' }}>{t.name}</span>
                    <span className="lp-testi-meta2" style={{ marginTop: 3 }}>{t.caption}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default TestimonialsSection;
