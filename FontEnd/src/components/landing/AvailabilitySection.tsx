import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SectionHeading } from './SectionHeading';
import { HERO_STILLS } from './heroStills';
import {
  AvailabilityCalendar,
  type AvailabilityCalendarProps,
} from './AvailabilityCalendar';

/**
 * How a booking actually starts, in three steps.
 *
 * Copy only — the numbers are decorative and marked aria-hidden, because the list is
 * an <ol> and the order is already in the markup.
 */
/** How long a photograph holds before the next one fades in. */
const CYCLE_MS = 7000;

const STEPS = [
  {
    title: 'Pick a date',
    body: 'Open dates show their time windows as you hover.',
  },
  {
    title: 'Send the details',
    body: 'Guest count, venue, and which of the three services you need.',
  },
  {
    title: 'We confirm and quote',
    body: 'A deposit locks the date; the balance settles after the event.',
  },
];

/**
 * The date picker, as its own section: the pitch on the left, the panel on the right.
 *
 * A shell and nothing else: heading, copy, section padding, the `#availability`
 * anchor, and the eleven calendar props forwarded straight through. No state lands
 * here — not even the month or the selection, which the two columns might look like
 * they share.
 *
 * That boundary is deliberate rather than incidental. The month, the two fetches
 * (booked days, and the debounced per-date slot lookup), the selected date, the
 * ReserveDialog and the `navigate('/book', { state })` handoff all stay in
 * LandingPage, because the dialog and the navigation are page concerns: the dialog
 * renders outside <main> as a sibling of the footer, and the router state it builds
 * is the page's contract with /book. Moving the state down here would mean either
 * dragging the dialog into a content section — where the portal and the page's
 * scroll lock stop being the page's business — or leaving the state split across
 * two owners, which is the arrangement the 2,000-line version of this page had.
 *
 * The props type is imported rather than restated so the forwarding contract has
 * one definition; adding a calendar prop does not mean editing this file.
 */
export function AvailabilitySection(props: AvailabilityCalendarProps) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const src = HERO_STILLS[index];

  /* Advance the ground. Reduced motion holds the first photograph: this is
     decoration, and a reader who asked for stillness has no reason to want it. */
  useEffect(() => {
    if (reducedMotion || HERO_STILLS.length < 2) return;
    const t = setTimeout(
      () => setIndex((i) => (i + 1) % HERO_STILLS.length),
      CYCLE_MS,
    );
    return () => clearTimeout(t);
  }, [index, reducedMotion]);

  /* Warm the next photograph while this one is showing. Without it the cross-fade
     starts against an image the browser has not fetched yet and the new layer fades
     in from nothing — a flash of the bare ground on every tick. Only one image is
     ever in flight, so this costs one fetch per CYCLE_MS rather than the ~16MB the
     whole folder would cost if every layer were mounted at once. */
  useEffect(() => {
    if (reducedMotion || HERO_STILLS.length < 2) return;
    const next = new Image();
    next.src = HERO_STILLS[(index + 1) % HERO_STILLS.length];
  }, [index, reducedMotion]);

  return (
    /* --bg-subtle, the same tinted ground the packages section uses, rather than the
       page's --bg. It also puts the page back into an alternating rhythm: hero,
       tinted, plain, tinted, plain, band. */
    <section
      id="availability"
      className="ui-section amb-host lp-photo-ground"
      style={{ background: 'var(--bg-subtle)' }}
    >
      {/* Every hero photograph in turn as the section's ground, lightly blurred.
          --bg-subtle stays on the section itself underneath, so a failed load
          degrades to the tinted ground this section already had rather than to
          nothing. Decorative, so it is hidden from assistive tech. */}
      <div className="lp-avail-ambient" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.div
            /* Keyed on the photograph, so a tick mounts a new layer over the old
               one and the two cross-fade. Default sync mode, not wait: waiting
               would blank the ground between frames instead of blending through.
               At most two layers are ever mounted, which is the reason for keying
               rather than stacking all thirty-nine — each carries a 10px blur, and
               thirty-nine filtered layers is a real cost for thirty-eight of them
               that are invisible. */
            key={src}
            className="lp-avail-ambient-img"
            style={{ backgroundImage: `url(${src})` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 1.1, ease: 'easeInOut' }}
          />
        </AnimatePresence>
        <div className="lp-avail-ambient-scrim" />
      </div>

      <div className="ui-wrap amb-over">
        {/* The heading sits above the split, ruled, like every other section on the
            page — it stopped being a grid child when the layout moved to auto-fit.
            Two children only: the pitch, and the panel. */}
        <SectionHeading
          kicker="Availability"
          title="Pick your date"
          linkLabel="Start a booking"
          linkTo="/book"
        />

        <div className="lp-availability">
          <div className="lp-avail-copy">
            <p className="lp-avail-sub">
              Dates with a line through them are taken. Everything else is open —
              pick one and we hold it.
            </p>

            <ol className="lp-steps">
              {STEPS.map((step, i) => (
                <li key={step.title} className="lp-step">
                  <span className="lp-step-num" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <p className="lp-step-title">{step.title}</p>
                    <p className="lp-step-body">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <AvailabilityCalendar {...props} />
        </div>
      </div>
    </section>
  );
}

export default AvailabilitySection;
