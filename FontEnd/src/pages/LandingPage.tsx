import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCalendarDays, getDayTimeSlots, type DayTimeSlots } from '../api/calendarApi';
import { Navbar } from '../components/landing/Navbar';
import { LandingHero, type HeroMedia } from '../components/landing/LandingHero';
import { AvailabilitySection } from '../components/landing/AvailabilitySection';
import { ServiceSection } from '../components/landing/ServiceSection';
import { PackagesPreview } from '../components/landing/PackagesPreview';
import { MenuPreviewSection } from '../components/landing/MenuPreviewSection';
import { TestimonialsSection } from '../components/landing/TestimonialsSection';
import { SiteFooter } from '../components/landing/SiteFooter';
import { ReserveDialog, type BookingPreset } from '../components/landing/ReserveDialog';
import { AmbientAudio } from '../components/landing/AmbientAudio';
import { getDaysInMonth, toISO } from '../components/landing/calendarUtils';
import '../components/landing/landing.css';

/**
 * Hero background layers, cycled in order by <LandingHero>.
 *
 * Drop a `{ type: 'video', src, poster }` entry in and it plays in place — the
 * hero stacks real elements rather than swapping a CSS background, so the two
 * kinds mix freely. Videos stay muted: AmbientAudio already owns sound here.
 *
 * Every photograph in public/hero, with the clips interleaved roughly every eight
 * so the reel never runs long on one kind. Order is the filenames' own; the two
 * IMG_* stills close it out.
 *
 * 38 stills is 16MB if they all load at once, which is why LandingHero only sets a
 * layer's background-image when that layer is near the active one. Adding entries
 * here is therefore cheap — the cost is per-visible-layer, not per-entry.
 */
const HERO_MEDIA: HeroMedia[] = [
  { type: 'video', src: '/hero/IMG_6103.mp4' },
  { type: 'image', src: '/hero/475791402_1053532609909764_4981430293773791916_n.jpg' },
  { type: 'image', src: '/hero/475882223_1053532676576424_7453945570792069785_n.jpg' },
  { type: 'image', src: '/hero/475885781_1053532873243071_739548449675657919_n.jpg' },
  { type: 'image', src: '/hero/475935832_1053532753243083_204533552706617820_n%20%281%29.jpg' },
  { type: 'image', src: '/hero/476003522_1053532876576404_2841522414474075162_n.jpg' },
  { type: 'image', src: '/hero/476021624_1053532693243089_6450707443146943903_n.jpg' },
  { type: 'image', src: '/hero/476030991_1053532466576445_805751608116762178_n.jpg' },
  { type: 'image', src: '/hero/476069041_1053532813243077_2751738037370215620_n.jpg' },
  { type: 'video', src: '/hero/IMG_6117.mp4' },
  { type: 'image', src: '/hero/476278532_1053532683243090_158351261579523031_n.jpg' },
  { type: 'image', src: '/hero/476312599_1053532633243095_2770354154287174301_n.jpg' },
  { type: 'image', src: '/hero/648019737_1355931806336508_6965164466184933880_n.jpg' },
  { type: 'image', src: '/hero/648832511_1355931453003210_4602903017174356830_n.jpg' },
  { type: 'image', src: '/hero/648991669_1355933883002967_7635247740489269885_n.jpg' },
  { type: 'image', src: '/hero/649334371_1355931486336540_6564044671628030550_n.jpg' },
  { type: 'image', src: '/hero/650757354_1358780446051644_7540690133881728036_n.jpg' },
  { type: 'image', src: '/hero/650981336_1358780622718293_375876479677361105_n.jpg' },
  { type: 'video', src: '/hero/IMG_6092.mp4' },
  { type: 'image', src: '/hero/651090097_1358780706051618_7507925435931852959_n.jpg' },
  { type: 'image', src: '/hero/651217534_1358780659384956_6191535843346171980_n.jpg' },
  { type: 'image', src: '/hero/655913859_1370284794901209_5634616107795083968_n.jpg' },
  { type: 'image', src: '/hero/657373626_1370284998234522_8672412175734879214_n.jpg' },
  { type: 'image', src: '/hero/657385281_1370284761567879_3493865220430027531_n.jpg' },
  { type: 'image', src: '/hero/657586134_1370284891567866_7176804982523438533_n.jpg' },
  { type: 'image', src: '/hero/721119020_1435797765016578_6591129480672024861_n.jpg' },
  { type: 'image', src: '/hero/724777748_1438286398101048_2028803709003395940_n.jpg' },
  { type: 'video', src: '/hero/IMG_6029.mp4' },
  { type: 'image', src: '/hero/726357880_1438290521433969_921599286252158990_n.jpg' },
  { type: 'image', src: '/hero/726596851_1438286338101054_7481206446141031975_n.jpg' },
  { type: 'image', src: '/hero/727519078_1438286461434375_4129001469063785725_n.jpg' },
  { type: 'image', src: '/hero/727519457_1438286241434397_4792549088553892762_n.jpg' },
  { type: 'image', src: '/hero/736019865_1452772623319092_4127398391280102040_n.jpg' },
  { type: 'image', src: '/hero/737799956_1452773646652323_6435897556678668090_n.jpg' },
  { type: 'image', src: '/hero/737911773_1452772986652389_9191038347997591932_n.jpg' },
  { type: 'image', src: '/hero/738068418_1452772489985772_5602471432875962684_n.jpg' },
  { type: 'video', src: '/hero/IMG_6041.mp4' },
  { type: 'image', src: '/hero/738552383_1452772706652417_1832230556915129421_n.jpg' },
  { type: 'image', src: '/hero/741454036_1452773609985660_8306301539792823671_n.jpg' },
  { type: 'image', src: '/hero/771998357_122136450405174569_2473241104732153796_n.jpg' },
  { type: 'image', src: '/hero/772138440_122136450363174569_4078387265260369892_n.jpg' },
  { type: 'image', src: '/hero/IMG_6013.jpg' },
  { type: 'image', src: '/hero/IMG_6025.jpg' },
];

/**
 * Landing page — route `/`.
 *
 * This file owns the availability data and the reserve flow, and nothing else. Every
 * section below is its own component under components/landing, which is what the old
 * 2,000-line version could not say: it carried the markup for six sections, a 700-line
 * inline stylesheet, a particle canvas and the calendar all in one scope.
 *
 * Where the date picker sits has now moved three times. It began in a mid-page section
 * behind a modal, was pulled into the hero so "is my date free" was answerable in the
 * fold, moved back below the fold into its own <AvailabilitySection> when the hero
 * became a single centred column, and now sits last before the testimonials — after the
 * services, packages and menu have made the case, rather than before them.
 *
 * That is the furthest it has been from the fold, so the cost named in that component's
 * header applies most strongly here: nobody sees a date until they have scrolled past
 * four sections. Everything downstream is unchanged — the state, both fetches, the ISO
 * date, the preset flow and the router state handed to /book all still live here, and
 * AvailabilitySection only forwards them.
 */
export function LandingPage() {
  const navigate = useNavigate();

  /* ── Calendar position ─────────────────────────────────────────────── */
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const prevMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 0) { setCalYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 11) { setCalYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  /* ── Real availability for the month on screen ─────────────────────────
     Dates the backend has no row for have never been booked, so a miss simply
     means "open". A failed fetch leaves the map empty and the calendar shows
     everything as available — this panel is a teaser, not a booking gate, and
     the booking form re-checks properly. */
  const [bookedDates, setBookedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const from = toISO(calYear, calMonth, 1);
    const to = toISO(calYear, calMonth, getDaysInMonth(calYear, calMonth));
    getCalendarDays(from, to)
      .then((days) => {
        if (!cancelled) setBookedDates(new Set(days.filter((d) => d.isLocked).map((d) => d.date)));
      })
      .catch(() => {
        if (!cancelled) setBookedDates(new Set());
      });
    return () => { cancelled = true; };
  }, [calYear, calMonth]);

  /* ── Open time windows for whichever date is hovered ───────────────────
     Cached per date and fetched on a short delay: sweeping the mouse across a
     month would otherwise fire ~30 requests, and a date's slots don't change
     mid-hover. */
  const [slotsByDate, setSlotsByDate] = useState<Record<string, DayTimeSlots | 'error'>>({});
  const [hoveredISO, setHoveredISO] = useState<string | null>(null);

  useEffect(() => {
    if (!hoveredISO || slotsByDate[hoveredISO]) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      getDayTimeSlots(hoveredISO)
        .then((slots) => {
          if (!cancelled) setSlotsByDate((prev) => ({ ...prev, [hoveredISO]: slots }));
        })
        .catch(() => {
          // Cached as 'error' so a dead endpoint isn't retried on every re-hover;
          // the note falls back to the generic availability wording.
          if (!cancelled) setSlotsByDate((prev) => ({ ...prev, [hoveredISO]: 'error' }));
        });
    }, 250);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [hoveredISO, slotsByDate]);

  /* ── Reserve flow ──────────────────────────────────────────────────────
     Pick an open day, then choose which booking path to start. The chosen date
     rides to /book in router state so the wizard can pre-fill it and skip its
     own Step-0 picker. */
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reserveOpen, setReserveOpen] = useState(false);

  const startBooking = (flow: BookingPreset) => {
    setReserveOpen(false);
    navigate('/book', { state: { presetDate: selectedDate, presetFlow: flow } });
  };

  return (
    <>
      <Navbar activePage="home" placement="sticky" />

      <main style={{ background: 'var(--bg)' }}>
        <LandingHero media={HERO_MEDIA} />

        <ServiceSection />
        <PackagesPreview />
        <MenuPreviewSection />

        <AvailabilitySection
          year={calYear}
          month={calMonth}
          bookedDates={bookedDates}
          selectedDate={selectedDate}
          slotsByDate={slotsByDate}
          hoveredISO={hoveredISO}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onHover={setHoveredISO}
          onSelect={setSelectedDate}
          onReserve={() => setReserveOpen(true)}
        />
        <TestimonialsSection />
      </main>

      <SiteFooter />

      {reserveOpen && selectedDate && (
        <ReserveDialog
          date={selectedDate}
          onClose={() => setReserveOpen(false)}
          onChoose={startBooking}
        />
      )}

      <AmbientAudio />
    </>
  );
}

export default LandingPage;
