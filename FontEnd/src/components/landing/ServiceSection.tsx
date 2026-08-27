import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { SectionHeading } from './SectionHeading';

/**
 * The three offerings, as headed copy columns rather than icon cards.
 *
 * Each one now links to the catalog it describes — the column headings read as
 * destinations, and before this the section was the only place on the page that
 * named all three services and let you reach none of them.
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
 * Team photographs, served from public/gallery.
 *
 * Alt text describes the crew and the setting rather than saying "team photo": these
 * are real staff at real events, and that is the part a screen-reader user is missing.
 */
const GALLERY_FRAMES = [
  {
    src: '/gallery/team-wedding-setup.jpg',
    alt: 'The King Jegi crew in black-and-burgundy uniforms at a wedding reception, '
      + 'arranging place settings in front of a white floral backdrop.',
  },
  {
    src: '/gallery/team-function-hall.jpg',
    alt: 'King Jegi service staff standing beside a full buffet line in a function hall, '
      + 'chafing dishes and garnished platters laid out along the table.',
  },
];

/**
 * What we offer.
 *
 * Rebuilt onto the page ground. The previous version stacked four radial gradients,
 * an animated blob canvas, a noise plate, a full-width backdrop-filter and three
 * more gradient scrims under a frosted panel — six compositing layers behind three
 * paragraphs of copy, on the first section below the fold. The rules between the
 * columns do the same separating work for a hairline's cost, and the section now
 * inherits the theme instead of mixing its own ground out of --primary.
 */
export function ServiceSection() {
  return (
    <section id="services" className="ui-section" style={{ background: 'var(--bg)' }}>
      <div className="ui-wrap">
        <SectionHeading kicker="What we offer" title="Three services, one team" />

        <div className="lp-svc-grid">
          {OFFERINGS.map((o) => (
            <div key={o.title} className="lp-svc-col">
              <Link to={o.href} className="lp-svc-head">
                <h3 className="lp-svc-title">{o.title}</h3>
                <ArrowUpRight
                  size={18}
                  strokeWidth={1.75}
                  color="var(--accent)"
                  aria-hidden="true"
                  style={{ flex: 'none', marginTop: 3 }}
                />
              </Link>
              <p className="ui-body">{o.body}</p>
            </div>
          ))}
        </div>

        <div className="lp-gallery">
          {GALLERY_FRAMES.map((frame) => (
            <img
              key={frame.src}
              src={frame.src}
              alt={frame.alt}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default ServiceSection;
