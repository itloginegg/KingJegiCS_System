import { SectionHeading } from './SectionHeading';
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
  return (
    /* --bg-subtle, the same tinted ground the packages section uses, rather than the
       page's --bg. It also puts the page back into an alternating rhythm: hero,
       tinted, plain, tinted, plain, band. */
    <section id="availability" className="ui-section" style={{ background: 'var(--bg-subtle)' }}>
      <div className="ui-wrap">
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
