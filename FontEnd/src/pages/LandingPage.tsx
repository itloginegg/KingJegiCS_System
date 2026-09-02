import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCalendarDays, getDayTimeSlots, type DayTimeSlots } from '../api/calendarApi';
import { Navbar } from '../components/landing/Navbar';
import { LandingHero, type HeroMedia } from '../components/landing/LandingHero';
import { AvailabilityCalendar } from '../components/landing/AvailabilityCalendar';
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
 */
const HERO_MEDIA: HeroMedia[] = [
  { type: 'video', src: '/hero/IMG_6103.MOV' },
  { type: 'video', src: '/hero/IMG_6117.MOV' },
  { type: 'video', src: '/hero/IMG_6084.MOV' },
  { type: 'video', src: '/hero/IMG_6092.MOV' },
  { type: 'video', src: '/hero/IMG_6029.MOV' },
  { type: 'image', src: '/hero/IMG_6025.HEIC' },
  { type: 'image', src: '/hero/IMG_6013.HEIC' },
  { type: 'video', src: '/hero/IMG_6041.MOV' },
];

/**
 * Landing page — route `/`.
 *
 * This file owns the availability data and the reserve flow, and nothing else. Every
 * section below is its own component under components/landing, which is what the old
 * 2,000-line version could not say: it carried the markup for six sections, a 700-line
 * inline stylesheet, a particle canvas and the calendar all in one scope.
 *
 * The one structural change from the previous build: the date picker used to sit in a
 * mid-page section and open a modal. It is now in the hero. Everything downstream —
 * the ISO date, the preset flow, the router state handed to /book — is unchanged.
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
        <LandingHero media={HERO_MEDIA}>
          <AvailabilityCalendar
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
        </LandingHero>

        <ServiceSection />
        <PackagesPreview />
        <MenuPreviewSection />
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
