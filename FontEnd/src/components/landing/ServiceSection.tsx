import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { SectionHeading } from './SectionHeading';
import { EventGallery } from './EventGallery';

/**
 * The three offerings, as numbered rows rather than headed copy columns.
 *
 * Each one links to the catalog it describes, and the whole row is the target now —
 * the heading alone was a small hit area for something that reads as a list item.
 * The 01/02/03 are not in this data: they are the map index, so adding a fourth
 * service cannot leave a stale number behind.
 */
const OFFERINGS = [
  {
    title: 'Catering Service',
    href: '/menus',
    body:
      'Full-service Filipino catering for any occasion — buffet, plated, or family-style. '
      + 'Fresh ingredients, professional staff, and a setup that fits the room you have.',
  },
  {
    title: 'Catering Packages',
    href: '/packages',
    body:
      'Curated all-in-one packages covering food, setup, and service staff. Choose Starter, '
      + 'Classic, or Premium and we handle the rest from arrival to pack-down.',
  },
  {
    title: 'Party Rentals',
    href: '/rentals',
    body:
      'Tables, chairs, tents, sound systems, and décor — everything you need to turn any '
      + 'space into a room your guests remember.',
  },
];

/**
 * What we offer.
 *
 * Rebuilt onto the page ground. The previous version stacked four radial gradients,
 * an animated blob canvas, a noise plate, a full-width backdrop-filter and three
 * more gradient scrims under a frosted panel — six compositing layers behind three
 * paragraphs of copy, on the first section below the fold. The rules between the
 * rows do the same separating work for a hairline's cost, and the section still
 * inherits the theme instead of mixing its own ground out of --primary.
 *
 * The one exception is EventGallery, which commits to a dark plum ground in both
 * themes because photographs read better against one. That override is scoped to the
 * gallery's own rounded block — the copy column beside it stays theme-inherited — and
 * its background is two animated pseudo-elements, not a return to the six-layer stack.
 * It now sits BESIDE the list rather than under it, which is the whole of this change:
 * no data, state or gallery logic moved.
 */
export function ServiceSection() {
  return (
    <section id="services" className="ui-section" style={{ background: 'var(--bg)' }}>
      <div className="ui-wrap">
        {/* 40/60 at desktop, stacked below it. The heading moved inside the left pane
            with the list it heads — its rule now closes the copy column rather than
            spanning a width the content no longer fills. */}
        <div className="lp-svc-split">
          <div className="lp-svc-copy">
            {/* The trailing link is SectionHeading's own slot — .ui-sec-head is already
                align-items: flex-end, which is the baseline the design wants. The arrow
                is appended by the component, so the label carries no glyph. */}
            <SectionHeading
              kicker="What we offer"
              title="Three services, one team"
              linkLabel="See everything we do"
              linkTo="/packages"
            />

            <div className="lp-svc-rows">
              {OFFERINGS.map((o, i) => (
                <Link key={o.title} to={o.href} className="lp-svc-row">
                  {/* Ordinal, not content: the list order is already in the markup, so
                      this is decoration for sighted readers only. */}
                  <span className="lp-svc-num" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="lp-svc-title">{o.title}</h3>
                  <p className="ui-body lp-svc-body">{o.body}</p>
                  <ArrowUpRight
                    className="lp-svc-arrow"
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          </div>

          {/* Wrapped, because EventGallery's fallback paths return a fragment of two
              elements — dropped straight into the split they would become two grid
              items and push the layout to three columns. The wrapper also gives the
              gallery a box to fill when the copy column is the taller of the two. */}
          <div className="lp-svc-gallery">
            <EventGallery />
          </div>
        </div>
      </div>
    </section>
  );
}

export default ServiceSection;
