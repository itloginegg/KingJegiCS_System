import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getCalendarDays, getDayTimeSlots, type DayTimeSlots } from '../api/calendarApi';
import { getApprovedTestimonials, type PublicTestimonial } from '../api/testimonialsApi';
import { fetchBestSeller, type AdminMenuItem } from '../api/menuAdminApi';
import { Navbar } from '../components/landing/Navbar';
import { ChatWidget } from '../components/landing/ChatWidget';
import { AmbientAudio } from '../components/landing/AmbientAudio';

/** The paths BookingPage can be opened straight into from the reserve modal. */
type BookingPreset = 'event' | 'rentals' | 'plan';

/** "2026-08-14" → "August 14, 2026" for the reserve button and modal heading. */
const fmtSelected = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
};
 
/* ─────────────────────────────────────────────────────────────────────────
   Static content — design reference only, no backend calls.
───────────────────────────────────────────────────────────────────────── */
 
const HERO_SLIDES = [
  'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=2000&q=80',
  'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=2000&q=80',
  'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=2000&q=80',
];
 
const PKG_BG =
  'https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=2000&q=80';
const RESERVE_BG =
  'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&w=2000&q=80';
 
 
const SERVICES = [
  {
    icon: '🍽️',
    title: 'Catering Services',
    description:
      'Full-service Filipino catering for any occasion — buffet, plated, or family-style. Fresh ingredients, professional staff, memorable flavors.',
    to: '/menus',
    cta: 'Explore Menu',
  },
  {
    icon: '📦',
    title: 'Catering Packages',
    description:
      'Curated all-in-one packages covering food, setup, and service staff. Choose Starter, Classic, or Premium to fit your guest count and budget.',
    to: '/packages',
    cta: 'View Packages',
  },
  {
    icon: '🎪',
    title: 'Party Rentals',
    description:
      'Tables, chairs, tents, sound systems, and décor — everything you need to transform any space into a beautiful event venue.',
    to: '/rentals',
    cta: 'Browse Rentals',
  },
];
 
const PACKAGES = [
  {
    id: 1,
    name: 'Birthday Package',
    price: '₱65,000',
    description:
      'A complete birthday celebration — themed décor, buffet for 100 guests, sound system, and dedicated service staff.',
  },
  {
    id: 2,
    name: 'Wedding Package',
    price: '₱80,000',
    description:
      'Our signature wedding setup with elegant floral styling, plated or buffet dining, and full coordination on the day.',
  },
  {
    id: 3,
    name: 'Custom Package',
    price: 'Custom',
    description:
      'Have something unique in mind? Build your dream event from the ground up — tailored to your vision, budget, and guest count.',
  },
];
 
const MENUS = [
  {
    id: 1,
    tier: 'Chicken Dish',
    price: '₱250/head',
    image:
      'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 2,
    tier: 'Beef Dish',
    price: '₱320/head',
    image:
      'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 3,
    tier: 'Pork Dish',
    price: '₱280/head',
    image:
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=800&q=80',
  },
];
 
const TESTIMONIALS = [
  {
    id: 1,
    name: 'Maria Santos',
    event: 'Wedding · 150 guests',
    quote:
      'King Jegi made our wedding feast unforgettable. Guests are still talking about the lechon months later!',
    initials: 'MS',
  },
  {
    id: 2,
    name: 'Jerome dela Cruz',
    event: 'Corporate Event · 80 guests',
    quote:
      'Professional from quotation to cleanup. The buffet setup looked stunning and everything was served on time.',
    initials: 'JD',
  },
  {
    id: 3,
    name: 'Ana Reyes',
    event: 'Birthday · 60 guests',
    quote:
      "Farm-fresh talaga ang lasa! The team handled everything so I could actually enjoy my daughter's party.",
    initials: 'AR',
  },
];
 
/**
 * TESTIMONIALS above is now only a FALLBACK: the section renders approved reviews
 * from /api/Testimonials/approved, and falls back to these while they load or if the
 * business hasn't approved any yet, so the page is never visibly empty.
 *
 * The reserved dates that used to live here were demo-only. The calendar now reads
 * real lock state from /api/CalendarDays (anonymous endpoint — dates and counts only).
 */
 
/* ─────────────────────────────────────────────────────────────────────────
   Tiny helpers
───────────────────────────────────────────────────────────────────────── */
 
function SectionHeader({
  eyebrow,
  title,
  accent,
  italic = false,
  align = 'center',
  flush = false,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  italic?: boolean;
  /** structural alignment only — 'left' | 'right' offsets the header off-axis */
  align?: 'center' | 'left' | 'right';
  /** drop the bottom margin when the header is positioned by a parent grid */
  flush?: boolean;
}) {
  return (
    <div
      style={{
        textAlign: align,
        marginBottom: flush ? 0 : '3.5rem',
        maxWidth: align === 'center' ? undefined : 560,
        marginLeft: align === 'right' ? 'auto' : undefined,
        marginRight: align === 'left' ? 'auto' : undefined,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'var(--accent-muted)',
          border: '1px solid var(--border-accent)',
          padding: '0.35rem 1rem',
          marginBottom: '1.25rem',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--primary)',
            display: 'inline-block',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '0.6rem',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'var(--primary)',
            fontWeight: 500,
          }}
        >
          {eyebrow}
        </span>
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(2rem, 4vw, 3rem)',
          fontWeight: 400,
          color: 'var(--text-primary)',
          lineHeight: 1.15,
        }}
      >
        {title}{' '}
        {italic ? (
          <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{accent}</em>
        ) : (
          <span style={{ color: 'var(--primary)' }}>{accent}</span>
        )}
      </h2>
    </div>
  );
}
 
/* ─────────────────────────────────────────────────────────────────────────
   Calendar helpers
───────────────────────────────────────────────────────────────────────── */
 
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
 
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
/**
 * A TimeOnly from the API → a compact clock label: "8 AM", "2:30 PM".
 *
 * Accepts both shapes because the API sends the first one: the project's
 * TimeOnlyJsonConverter writes 12-hour "h:mm tt", while raw TimeOnly elsewhere (and
 * anything hand-built) is "HH:mm:ss". Whole hours drop their ":00" so a list of
 * windows stays short.
 */
function fmtClock(hms: string) {
  const twelveHour = hms.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
  if (twelveHour) {
    const [, hour, minute, period] = twelveHour;
    const suffix = period.toUpperCase();
    return minute === '00' ? `${Number(hour)} ${suffix}` : `${Number(hour)}:${minute} ${suffix}`;
  }

  const [h, m] = hms.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hms;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${period}` : `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "8 AM–2 PM" — an en dash, no spaces, so a list of windows stays readable. */
function fmtWindow(start: string, end: string) {
  return `${fmtClock(start)}–${fmtClock(end)}`;
}

function toISO(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
 
/* ─────────────────────────────────────────────────────────────────────────
   Colliding blobs canvas — Services & Menu section background
───────────────────────────────────────────────────────────────────────── */
 
function CollidingBlobsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
 
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
 
    const setSize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width || window.innerWidth;
      canvas.height = rect.height || 500;
    };
 
    const sizeTimer = setTimeout(setSize, 50);
    window.addEventListener('resize', setSize);
 
    const isDark = () => document.documentElement.classList.contains('dark');
 
    const getCSSVar = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
 
    const toRgba = (color: string, alpha: number): string => {
      if (color.startsWith('rgb')) {
        const parts = color.replace(/rgba?\(/, '').replace(')', '').split(',').slice(0, 3).join(',');
        return `rgba(${parts}, ${alpha})`;
      }
      if (color.startsWith('#')) {
        const h = color.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
      }
      return `rgba(128,128,128,${alpha})`;
    };
 
    const buildPalette = () => {
      const primary = getCSSVar('--primary') || '#073a40';
      const accent = getCSSVar('--accent') || '#79654e';
      const hover = getCSSVar('--primary-hover') || primary;
      return [primary, accent, primary, hover, accent, primary];
    };
 
    let COLORS = buildPalette();
 
    const themeObserver = new MutationObserver(() => {
      COLORS = buildPalette();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
 
    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      alpha: number; radius: number; color: string;
      decay: number;
    };
 
    type Blob = {
      x: number; y: number;
      vx: number; vy: number;
      radius: number;
      color: string;
      alive: boolean;
      respawnTimer: number;
    };
 
    const particles: Particle[] = [];
    let blobs: Blob[] = [];
 
    const spawnBlob = (): Blob => {
      const w = canvas.width || 800;
      const h = canvas.height || 500;
      const side = Math.floor(Math.random() * 4);
      const r = 55 + Math.random() * 35;
      const speed = 0.9 + Math.random() * 0.8;
 
      const tx = w * 0.3 + Math.random() * w * 0.4;
      const ty = h * 0.3 + Math.random() * h * 0.4;
 
      let x = 0, y = 0;
      if (side === 0) { x = Math.random() * w; y = -r; }
      else if (side === 1) { x = Math.random() * w; y = h + r; }
      else if (side === 2) { x = -r; y = Math.random() * h; }
      else { x = w + r; y = Math.random() * h; }
 
      const angle = Math.atan2(ty - y, tx - x);
      return {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: r,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alive: true,
        respawnTimer: 0,
      };
    };
 
    const explode = (x: number, y: number, color: string) => {
      const count = 50 + Math.floor(Math.random() * 30);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const speed = 2 + Math.random() * 5;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          radius: 2.5 + Math.random() * 4,
          color,
          decay: 0.01 + Math.random() * 0.015,
        });
      }
    };
 
    const blobTimer = setTimeout(() => {
      blobs = Array.from({ length: 8 }, spawnBlob);
    }, 60);
 
    let animId: number;
 
    const draw = () => {
      animId = requestAnimationFrame(draw);
 
      if (!canvas.width || !canvas.height) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
 
      const dark = isDark();
 
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
 
        if (!b.alive) {
          b.respawnTimer--;
          if (b.respawnTimer <= 0) Object.assign(b, spawnBlob());
          continue;
        }
 
        b.x += b.vx;
        b.y += b.vy;
 
        if (b.x - b.radius < 0) { b.x = b.radius; b.vx *= -1; }
        if (b.x + b.radius > canvas.width) { b.x = canvas.width - b.radius; b.vx *= -1; }
        if (b.y - b.radius < 0) { b.y = b.radius; b.vy *= -1; }
        if (b.y + b.radius > canvas.height) { b.y = canvas.height - b.radius; b.vy *= -1; }
 
        for (let j = i + 1; j < blobs.length; j++) {
          const b2 = blobs[j];
          if (!b2.alive) continue;
          const dx = b2.x - b.x;
          const dy = b2.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < b.radius + b2.radius) {
            explode((b.x + b2.x) / 2, (b.y + b2.y) / 2, b.color);
            explode((b.x + b2.x) / 2, (b.y + b2.y) / 2, b2.color);
            b.alive = false;
            b2.alive = false;
            b.respawnTimer = 80 + Math.floor(Math.random() * 60);
            b2.respawnTimer = 80 + Math.floor(Math.random() * 60);
          }
        }
 
        if (!b.alive) continue;
 
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
        g.addColorStop(0, toRgba(b.color, dark ? 0.86 : 1.0));
        g.addColorStop(0.4, toRgba(b.color, dark ? 0.6 : 0.73));
        g.addColorStop(1, toRgba(b.color, 0));
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.shadowBlur = 25;
        ctx.shadowColor = b.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
 
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.vy += 0.05;
        p.alpha -= p.decay;
        if (p.alpha <= 0) { particles.splice(i, 1); continue; }
 
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * p.alpha, 0, Math.PI * 2);
        ctx.fillStyle = toRgba(p.color, p.alpha);
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };
 
    draw();
 
    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(sizeTimer);
      clearTimeout(blobTimer);
      window.removeEventListener('resize', setSize);
      themeObserver.disconnect();
    };
  }, []);
 
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 3,
        opacity: 0.45,
        display: 'block',
      }}
    />
  );
}
 
/* ─────────────────────────────────────────────────────────────────────────
   Raining canvas — Testimonials section background
───────────────────────────────────────────────────────────────────────── */
 
function RainingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const isDarkRef = useRef(false);
 
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
 
    const setSize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width || window.innerWidth;
      canvas.height = rect.height || 500;
    };
    const sizeTimer = setTimeout(setSize, 50);
    window.addEventListener('resize', setSize);
 
    const checkDark = () => document.documentElement.classList.contains('dark');
 
    isDarkRef.current = checkDark();
    const themeObserver = new MutationObserver(() => {
      isDarkRef.current = checkDark();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
 
    type Drop = { x: number; y: number; len: number; speed: number; opacity: number; width: number };
    type Splash = { x: number; y: number; r: number; opacity: number };
 
    const DROPS = 140;
    const drops: Drop[] = [];
    const splashes: Splash[] = [];
    const angle = 0.18;
 
    const initDrops = () => {
      drops.length = 0;
      const w = canvas.width || window.innerWidth;
      const h = canvas.height || 500;
      for (let i = 0; i < DROPS; i++) {
        drops.push({
          x: Math.random() * w,
          y: Math.random() * h - h,
          len: 14 + Math.random() * 24,
          speed: 9 + Math.random() * 12,
          opacity: 0.35 + Math.random() * 0.45,
          width: 0.8 + Math.random() * 0.9,
        });
      }
    };
 
    const dropsTimer = setTimeout(initDrops, 80);
 
    const tick = () => {
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }
 
      const dark = isDarkRef.current;
      const dropColor = dark ? 'rgba(180, 215, 255,' : 'rgba(60, 100, 160,';
 
      ctx.clearRect(0, 0, w, h);
 
      drops.forEach((d) => {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + angle * d.len, d.y + d.len);
        ctx.strokeStyle = `${dropColor}${d.opacity})`;
        ctx.lineWidth = d.width;
        ctx.lineCap = 'round';
        ctx.stroke();
 
        d.x += angle * d.speed * 0.5;
        d.y += d.speed;
 
        if (d.y > h) {
          splashes.push({ x: d.x, y: h - 2, r: 0, opacity: Math.min(d.opacity * 1.6, 0.85) });
          d.x = Math.random() * w;
          d.y = -d.len - Math.random() * 100;
        }
      });
 
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.r * 2, s.r * 0.6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `${dropColor}${s.opacity})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        s.r += 1.2;
        s.opacity -= 0.05;
        if (s.opacity <= 0) splashes.splice(i, 1);
      }
 
      animRef.current = requestAnimationFrame(tick);
    };
 
    animRef.current = requestAnimationFrame(tick);
 
    return () => {
      cancelAnimationFrame(animRef.current);
      clearTimeout(sizeTimer);
      clearTimeout(dropsTimer);
      window.removeEventListener('resize', setSize);
      themeObserver.disconnect();
    };
  }, []);
 
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        display: 'block',
      }}
    />
  );
}
 
/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */
 
export function LandingPage() {
  /* hero slideshow */
  const [slideIndex, setSlideIndex] = useState(0);
 
  useEffect(() => {
    const timer = setInterval(() => {
      setSlideIndex((i) => (i + 1) % HERO_SLIDES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);
 
  /* calendar UI */
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [hovered, setHovered] = useState<number | null>(null);
 
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
 
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstWeekday = getFirstDayOfMonth(calYear, calMonth);
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  /* Best Seller — the top-selling dish of the fortnight, ranked server-side.
     Replaces the old client-side date hash, which rotated through the catalog and had
     nothing to do with sales. The window is anchored to a fixed epoch on the server so
     every visitor sees the same dish and it turns over on a defined boundary rather
     than drifting per-browser. */
  const [feature, setFeature] = useState<AdminMenuItem | null>(null);
  const [featureLoading, setFeatureLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchBestSeller()
      .then((best) => {
        if (!cancelled) setFeature(best?.item ?? null);
      })
      .catch(() => {
        // The section is a teaser; a failure just falls back to the generic copy below.
        if (!cancelled) setFeature(null);
      })
      .finally(() => {
        if (!cancelled) setFeatureLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  /* Real availability for the month on screen. Dates the backend has no row for have
     never been booked, so a miss simply means "open". A failed fetch leaves the map
     empty and the calendar shows everything as available — this section is a teaser,
     not a booking gate, and the booking form re-checks properly. */
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

  /* Reserve-this-Date flow: pick an open day on the calendar, then choose which
     booking path to start. The chosen date rides to /book in router state so the
     wizard can pre-fill it and skip its own Step-0 picker. */
  /* Open time windows for whichever date is hovered.
     Cached per date and fetched on a short delay: sweeping the mouse across a month
     would otherwise fire ~30 requests, and a date's slots don't change mid-hover. */
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
          // Cached as 'error' so a dead endpoint isn't retried on every re-hover; the
          // line falls back to the old availability wording.
          if (!cancelled) setSlotsByDate((prev) => ({ ...prev, [hoveredISO]: 'error' }));
        });
    }, 250);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [hoveredISO, slotsByDate]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reserveOpen, setReserveOpen] = useState(false);
  const navigate = useNavigate();

  /**
   * All three paths go to /book — including Plan by Budget, which BookingPage's
   * Step 0 already offers and which works for signed-out visitors (PlanByBudget
   * asks for a login itself, but only at the point it actually needs one, to
   * materialize a draft). Sending guests to /login up front would gate a flow
   * that doesn't require it.
   */
  const startBooking = (flow: BookingPreset) => {
    setReserveOpen(false);
    navigate('/book', { state: { presetDate: selectedDate, presetFlow: flow } });
  };

  /* Approved testimonials, newest first. Falls back to the built-in samples until
     the business has approved some of its own. */
  const [reviews, setReviews] = useState<PublicTestimonial[]>([]);

  /**
   * One-shot scroll reveal for the testimonial cards.
   *
   * Re-runs when `reviews` changes, because the cards are replaced once the real
   * approved reviews land — the observer has to be pointed at the new nodes.
   * Unobserves each card after it fires so scrolling back up doesn't replay it.
   */
  const testiGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const grid = testiGridRef.current;
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.testi-card'));
    if (cards.length === 0) return;

    const reveal = (card: HTMLElement) => {
      card.classList.remove('testi-pending');
      card.classList.add('testi-in');
    };

    // Respect the OS setting, and don't hide anything if the browser can't observe.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );

    cards.forEach((card, i) => {
      // Stagger reads as one wave across the row rather than all at once.
      card.style.transitionDelay = `${Math.min(i, 5) * 90}ms`;
      card.classList.add('testi-pending');
      observer.observe(card);
    });

    // Safety net: if the observer never fires — a background tab, a headless or
    // non-compositing renderer — show everything anyway rather than leaving the
    // section blank.
    const failSafe = window.setTimeout(() => cards.forEach(reveal), 2500);

    return () => {
      window.clearTimeout(failSafe);
      observer.disconnect();
    };
  }, [reviews]);

  useEffect(() => {
    let cancelled = false;
    getApprovedTestimonials(6)
      .then((rows) => { if (!cancelled) setReviews(rows); })
      .catch(() => { /* keep the fallback copy */ });
    return () => { cancelled = true; };
  }, []);
 
  const sectionPad: React.CSSProperties = { padding: '6rem 0', position: 'relative' };
 
  return (
    <>
      <style>{`
        /* ── hero slideshow ── */
        .hero-slide {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          transition: opacity 1.2s ease-in-out;
          opacity: 0;
          will-change: opacity;
        }
        .hero-slide.active { opacity: 1; }
 
        .hero-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            105deg,
            rgba(255, 252, 245, 0.85) 0%,
            rgba(255, 252, 245, 0.55) 55%,
            rgba(255, 252, 245, 0.12) 100%
          );
        }
        .dark .hero-overlay {
          background: linear-gradient(
            105deg,
            rgba(0, 0, 0, 0.72) 0%,
            rgba(0, 0, 0, 0.45) 55%,
            rgba(0, 0, 0, 0.18) 100%
          );
        }
 
        /* over the photo, dark mode brightens the copy to pure white
           (!important: these must beat the inline token styles) */
        .dark .hero-has-bg h1 { color: #fff !important; }
        .dark .hero-has-bg h1 em { color: var(--accent) !important; }
        .dark .hero-has-bg .hero-body-text { color: rgba(255,255,255,0.78) !important; }
        .dark .hero-has-bg .hero-stat-value { color: #fff !important; }
        .dark .hero-has-bg .hero-stat-label { color: rgba(255,255,255,0.5) !important; }
        .dark .hero-has-bg .hero-stat-divider { border-color: rgba(255,255,255,0.15) !important; }
        .dark .hero-has-bg .hero-eyebrow-tag { background: rgba(255,255,255,0.12) !important; border-color: rgba(255,255,255,0.25) !important; }
        .dark .hero-has-bg .hero-eyebrow-text { color: #fff !important; }
        .dark .hero-has-bg .hero-eyebrow-dot { background: #fff !important; }
 
        .slide-dots {
          position: absolute;
          bottom: 2rem;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 0.5rem;
          z-index: 10;
        }
        .slide-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: rgba(120, 110, 95, 0.45);
          border: none;
          cursor: pointer;
          padding: 0;
          transition: background 0.3s, transform 0.3s;
        }
        .slide-dot.active {
          background: var(--text-primary);
          transform: scale(1.4);
        }
        .dark .slide-dot { background: rgba(255,255,255,0.35); }
        .dark .slide-dot.active { background: #fff; }
 
        /* blobs */
        .blob {
          position: absolute; border-radius: 50%;
          filter: blur(80px); opacity: 0.18; pointer-events: none;
          animation: blobDrift 18s ease-in-out infinite alternate;
        }
        .blob-primary      { background: var(--primary); }
        .blob-accent       { background: var(--accent); }
        .blob-primary-soft { background: var(--primary); opacity: 0.10; }
        .blob-accent-soft  { background: var(--accent);  opacity: 0.10; }
        @keyframes blobDrift {
          0%   { transform: translate(0px, 0px) scale(1); }
          50%  { transform: translate(30px, -20px) scale(1.08); }
          100% { transform: translate(-20px, 15px) scale(0.95); }
        }
 
        /* navbar sits over the hero photo — brighten links in dark mode
           (base .nav-link styles live in the shared Navbar component) */
        .dark .hero-has-bg .nav-link { color: rgba(255,255,255,0.75); }
        .dark .hero-has-bg .nav-link:hover { color: #fff; }
 
        /* hero grid */
        .hero-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4rem;
          align-items: center;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2.5rem;
        }
        @media (max-width: 900px) {
          .hero-grid { grid-template-columns: 1fr; }
          .hero-composition { display: none; }
        }
 
        .hero-composition {
          position: relative;
          height: 480px;
        }
        .hero-card-center {
          position: absolute;
          inset: 20px 0 0 20px;
          background: var(--primary);
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 2rem;
        }
        .hero-float-card {
          position: absolute;
          background: var(--surface);
          border: 1px solid var(--border-accent);
          border-radius: 12px;
          padding: 1rem 1.25rem;
          box-shadow: var(--shadow-lg);
          backdrop-filter: blur(10px);
        }
        .hero-float-left  { top: 2rem;    left: -1rem; }
        .hero-float-right { bottom: 2rem; right: -1rem; }
 
        /* buttons */
        .btn-hero-primary {
          background: var(--primary);
          color: var(--primary-text);
          border: none;
          padding: 1rem 2.5rem;
          font-family: var(--font-body);
          font-size: 0.72rem;
          font-weight: 500;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          cursor: pointer;
          border-radius: var(--r-full);
          transition: background 0.25s, transform 0.2s, box-shadow 0.2s;
          text-decoration: none;
          display: inline-block;
        }
        .btn-hero-primary:hover {
          background: var(--primary-hover);
          transform: translateY(-2px);
          box-shadow: var(--shadow-green);
        }
        .btn-hero-outline {
          background: transparent;
          color: var(--text-primary);
          border: 1px solid var(--border-strong);
          padding: 1rem 2.5rem;
          font-family: var(--font-body);
          font-size: 0.72rem;
          font-weight: 400;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          cursor: pointer;
          border-radius: var(--r-full);
          transition: background 0.25s, border-color 0.25s, transform 0.2s;
          text-decoration: none;
          display: inline-block;
        }
        .btn-hero-outline:hover {
          background: var(--secondary-muted);
          border-color: var(--secondary);
          transform: translateY(-2px);
        }
        .dark .hero-has-bg .btn-hero-outline {
          color: #fff;
          border-color: rgba(255,255,255,0.4);
        }
        .dark .hero-has-bg .btn-hero-outline:hover {
          border-color: #fff;
          background: rgba(255,255,255,0.08);
        }
 
        /* service cards
           flex column + bottom-anchored CTA: every card's link sits on
           the same baseline no matter how long the description runs */
        .service-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          padding: 2rem;
          display: flex;
          flex-direction: column;
          transition: box-shadow 0.3s, transform 0.3s, border-color 0.3s;
          cursor: default;
        }
        .service-card > a {
          margin-top: auto;
          align-self: flex-start;
        }
        .service-card:hover {
          box-shadow: var(--shadow-lg);
          transform: translateY(-4px);
          border-color: var(--border-accent);
        }
 
        /* Services-only padding override — scoped to cards inside the
           .services-cards cluster, so tightening here never touches the
           base .service-card padding. This is the single dial for how
           compact the Services cards read: lower it for tighter cards,
           raise it toward 2rem to match the default. */
        .services-cards .service-card {
          padding: 1.5rem;
        }
 
        /* package section overlay + glass cards */
        .pkg-bg-overlay {
          background: linear-gradient(
            160deg,
            rgba(255, 252, 245, 0.82) 0%,
            rgba(245, 238, 225, 0.75) 50%,
            rgba(255, 252, 245, 0.82) 100%
          );
        }
        .dark .pkg-bg-overlay {
          background: linear-gradient(
            160deg,
            rgba(12, 10, 8, 0.88) 0%,
            rgba(20, 16, 12, 0.82) 50%,
            rgba(12, 10, 8, 0.88) 100%
          );
        }
 
        .pkg-card {
          border-radius: var(--r-xl);
          padding: 2rem;
        }
        .pkg-card--glass {
          backdrop-filter: blur(14px) saturate(160%);
          -webkit-backdrop-filter: blur(14px) saturate(160%);
          background: rgba(255, 255, 255, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.6);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .pkg-card--glass:hover {
          transform: translateY(-4px);
          box-shadow:
            0 16px 48px rgba(0, 0, 0, 0.14),
            inset 0 1px 0 rgba(255, 255, 255, 0.6);
        }
        .dark .pkg-card--glass {
          background: rgba(20, 16, 12, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .pkg-card--glass.featured {
          background: rgba(255, 255, 255, 0.72);
          border-color: rgba(255, 255, 255, 0.6);
        }
        .dark .pkg-card--glass.featured {
          background: rgba(30, 24, 18, 0.72);
          border-color: rgba(255, 255, 255, 0.12);
        }
 
        /* photo-section overlays (calendar) */
        .bg-overlay {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.82) 0%,
            rgba(255, 255, 255, 0.60) 100%
          );
        }
        .dark .bg-overlay {
          background: linear-gradient(
            135deg,
            rgba(0, 0, 0, 0.72) 0%,
            rgba(10, 10, 20, 0.55) 100%
          );
        }
 
        /* calendar */
        .cal-day {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--r-sm);
          font-family: var(--font-body);
          font-size: 0.78rem;
          font-weight: 400;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          color: var(--text-secondary);
          position: relative;
        }
        .cal-day:hover:not(.cal-booked):not(.cal-past):not(.cal-today) {
          background: var(--primary-muted);
          color: var(--primary);
        }
        /* A picked date stays visibly picked even after the pointer leaves. */
        .cal-selected {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
          font-weight: 600;
        }
        .cal-day[role="button"] { cursor: pointer; }
        .cal-day[role="button"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        /* ── reserve-this-date modal ── */
        .lp-overlay {
          position: fixed; inset: 0; z-index: 150;
          background: rgba(20, 14, 8, 0.55);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center; padding: 1.5rem;
          animation: lpFade 0.2s ease both;
        }
        @keyframes lpFade { from { opacity: 0; } to { opacity: 1; } }
        .lp-modal {
          position: relative; width: min(460px, 100%);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--r-lg); box-shadow: var(--shadow-lg);
          padding: 2rem 1.8rem 1.8rem;
        }
        .lp-modal-close {
          position: absolute; top: 0.9rem; right: 1rem;
          background: transparent; border: none; cursor: pointer;
          color: var(--text-dim); font-size: 0.85rem; line-height: 1;
        }
        .lp-modal-eyebrow {
          font-family: var(--font-body); font-size: 0.58rem; font-weight: 500;
          letter-spacing: 0.24em; text-transform: uppercase; color: var(--text-dim);
        }
        .lp-modal-title {
          font-family: var(--font-display); font-size: 1.5rem; font-weight: 500;
          color: var(--text-primary); margin: 0.3rem 0 0.4rem;
        }
        .lp-modal-sub {
          font-family: var(--font-body); font-size: 0.82rem; font-weight: 300;
          color: var(--text-muted); margin-bottom: 1.3rem;
        }
        .lp-modal-options { display: flex; flex-direction: column; gap: 0.6rem; }
        .lp-option {
          display: flex; align-items: flex-start; gap: 0.85rem; text-align: left;
          width: 100%; padding: 0.9rem 1rem; cursor: pointer;
          background: var(--bg-subtle); border: 1px solid var(--border);
          border-radius: var(--r-lg);
          transition: border-color 0.2s, background 0.2s, transform 0.2s;
        }
        .lp-option:hover {
          border-color: var(--border-accent);
          background: var(--primary-muted);
          transform: translateY(-2px);
        }
        .lp-option-icon { font-size: 1.15rem; line-height: 1.3; flex-shrink: 0; }
        .lp-option strong {
          display: block; font-family: var(--font-body); font-size: 0.85rem;
          font-weight: 600; color: var(--text-primary); margin-bottom: 0.15rem;
        }
        .lp-option small {
          display: block; font-family: var(--font-body); font-size: 0.72rem;
          font-weight: 300; color: var(--text-muted); line-height: 1.5;
        }
        .cal-today    { background: var(--primary); color: var(--primary-text) !important; font-weight: 600; }
        .cal-booked   { background: var(--danger-muted); color: var(--danger); cursor: not-allowed; }
        .cal-booked::after {
          content: '';
          position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%);
          width: 4px; height: 4px; border-radius: 50%; background: var(--danger);
        }
        .cal-past { opacity: 0.35; cursor: not-allowed; }
        .cal-nav-btn {
          width: 32px; height: 32px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: var(--r-sm);
          color: var(--text-muted);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.9rem;
          transition: background 0.2s, border-color 0.2s, color 0.2s;
        }
        .cal-nav-btn:hover {
          background: var(--primary-muted);
          border-color: var(--primary);
          color: var(--primary);
        }
 
        /* testimonial cards
           flex column + bottom-anchored author row: star rows align at
           the top, author rows align at the bottom across the grid */
        .testi-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-xl);
          padding: 2rem 2rem 1.75rem;
          display: flex;
          flex-direction: column;
          transition: box-shadow 0.3s, transform 0.3s, border-color 0.3s;
        }
        .testi-card > div:last-child {
          margin-top: auto;
        }

        /* Scroll-triggered entrance.
           Cards are VISIBLE by default and only hidden once JS has confirmed it can
           reveal them again (it adds .testi-pending, then .testi-in on intersect).
           That ordering matters: a decorative animation must never be able to leave
           real testimonials invisible if JS is blocked or the observer never fires. */
        .testi-card {
          transition:
            opacity 0.6s ease,
            transform 0.6s cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 0.3s,
            border-color 0.3s;
        }
        .testi-card.testi-pending {
          opacity: 0;
          transform: translateY(22px);
        }
        .testi-card.testi-in {
          opacity: 1;
          transform: translateY(0);
        }
        /* Reduced motion: show the cards outright rather than animating them in,
           and drop the hover lift too so nothing moves unexpectedly. */
        @media (prefers-reduced-motion: reduce) {
          .testi-card, .testi-card.testi-pending {
            opacity: 1; transform: none;
            transition: box-shadow 0.3s, border-color 0.3s;
          }
          .testi-card:hover { transform: none; }
        }
        .testi-card:hover {
          box-shadow: var(--shadow-md);
          transform: translateY(-3px);
          border-color: var(--border-accent);
        }
 
        /* menu cards */
        .menu-card {
          border-radius: 1rem;
          overflow: hidden;
          background: var(--bg-card);
          border: 1px solid color-mix(in srgb, var(--primary) 14%, transparent);
          box-shadow: 0 2px 14px rgba(0, 0, 0, 0.07);
          transition:
            transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94),
            box-shadow 0.4s ease,
            border-color 0.4s ease;
          cursor: pointer;
        }
        .menu-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.12);
          border-color: color-mix(in srgb, var(--primary) 45%, transparent);
        }
        .dark .menu-card { box-shadow: 0 2px 18px rgba(0, 0, 0, 0.35); }
        .dark .menu-card:hover { box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5); }
 
        .menu-card:hover .menu-card-img { transform: scale(1.05); }
 
        .menu-card-grain {
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.06;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");
          background-size: 220px 220px;
          mix-blend-mode: overlay;
        }
        .dark .menu-card-grain { opacity: 0.09; }
 
        .menu-card-cta {
          opacity: 0;
          transform: translateY(5px);
          transition: opacity 0.35s ease, transform 0.35s ease;
        }
        .menu-card:hover .menu-card-cta {
          opacity: 1;
          transform: translateY(0);
        }
 
        /* responsive grids */
        .grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
        }
        .split-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4rem;
          align-items: center;
        }
        @media (max-width: 1024px) {
          .grid-3 { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 900px) {
          .split-grid { grid-template-columns: 1fr; gap: 2.5rem; }
        }
        @media (max-width: 640px) {
          .grid-3 { grid-template-columns: 1fr; }
        }
 
        /* ── asymmetrical section grids ──
           Structural only: uneven column widths + staggered offsets via
           nth-child margins (no transforms, so card hover animations are
           untouched).
 
           The system:
           · column ratios carry the size hierarchy per section
           · ONE shared stagger scale everywhere — step 1 = 2.25rem,
             step 2 = 4.5rem (an exact 1:2 rhythm) — so every section's
             cascade reads as the same deliberate beat
           · items stretch, so all cards in a row share a single flush
             baseline; the stagger reads on the top edge instead of
             leaving ragged bottoms
           · card innards are bottom-anchored (service CTAs, package
             buttons, testimonial author rows), so the extra height from
             stretching distributes into the card body cleanly */
 
        .pkg-grid,
        .menu-grid,
        .testi-grid {
          display: grid;
          column-gap: 2rem;
          row-gap: 1.5rem;
          align-items: stretch;
        }
 
        /* Packages: featured center card rides high, side cards drop
           at uneven depths */
        .pkg-grid {
          grid-template-columns: 1fr 1.25fr 1fr;
        }
        .pkg-grid > :nth-child(1) { margin-top: 2.25rem; }
        .pkg-grid > :nth-child(3) { margin-top: 4.5rem; }
 
        /* Menus: wide lead card, diagonal descent */
        .menu-grid {
          grid-template-columns: minmax(240px, 1.3fr) minmax(220px, 1fr) minmax(220px, 1fr);
        }
        .menu-grid > :nth-child(2) { margin-top: 2.25rem; }
        .menu-grid > :nth-child(3) { margin-top: 4.5rem; }
 
        /* Testimonials: broken-column masonry feel */
        .testi-grid {
          grid-template-columns: 1.2fr 0.95fr 1.05fr;
        }
        .testi-grid > :nth-child(1) { margin-top: 2.25rem; }
        .testi-grid > :nth-child(3) { margin-top: 4.5rem; }
 
        /* ── Services: split-screen ──
           Cards occupy the right column as a self-contained triangle
           cluster; the header sits vertically centered in the left
           column. The right column is a nested 2-column grid: two cards
           sit side by side on the top row, and the third spans the full
           width beneath them (grid-column: 1 / -1) — a solid pyramid
           whose base equals the two top cards plus their gap. The header
           leads in source order (so it stacks on top once collapsed) but
           is pinned to column 1 on desktop via explicit grid placement,
           keeping the sides fixed regardless of DOM order. */
        .services-split {
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 4rem;
          align-items: center;
        }
        .services-header-col {
          grid-column: 1;
          grid-row: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .services-cards {
          grid-column: 2;
          grid-row: 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 1.5rem;
          row-gap: 1.5rem;
        }
        .services-cards > * { position: relative; }
        .services-cards > *:hover { z-index: 3; }
        /* triangle: two cards side by side on top, one full-width card
           spanning the base. grid-column: 1 / -1 makes the base card's
           width equal the two top cards plus the gap between them, so the
           cluster reads as a solid pyramid. The two top cards size to
           their content (and stretch to match each other on the row), so
           they stay compact instead of growing with the column width. */
        .services-cards > :nth-child(1) { grid-column: 1; grid-row: 1; }
        .services-cards > :nth-child(2) { grid-column: 2; grid-row: 1; }
        .services-cards > :nth-child(3) { grid-column: 1 / -1; grid-row: 2; }
 
        /* ── depth: structural overlap ──
           The lead card of each multi-column section physically rides
           over its neighbor(s): a negative horizontal margin swallows the
           2rem column gap plus a small overhang (0.5–0.75rem), and
           z-index layers the lead on top. The overhang never exceeds the
           neighbor's 2rem inner padding, so no content is ever covered.
           z-index + margins only — no transforms — so the existing hover
           animations are untouched. Hovering any card lifts it to the
           top layer. */
 
        .pkg-grid > *,
        .menu-grid > *,
        .testi-grid > * {
          position: relative;
        }
        .pkg-grid > *:hover,
        .menu-grid > *:hover,
        .testi-grid > *:hover {
          z-index: 3;
        }
 
        /* Packages: the featured glass card rides over both sides —
           its backdrop blur samples the cards beneath it */
        .pkg-grid > :nth-child(2) {
          margin-left: -2.75rem;
          margin-right: -2.75rem;
          z-index: 2;
        }
        /* Menus: the wide lead plate laps onto the second (kept to
           0.5rem so the neighbor's corner chips stay clear) */
        .menu-grid > :nth-child(1) {
          margin-right: -2.5rem;
          z-index: 2;
        }
        /* Testimonials: the center quote pins over both neighbors */
        .testi-grid > :nth-child(2) {
          margin-left: -2.5rem;
          margin-right: -2.5rem;
          z-index: 2;
        }
 
        @media (max-width: 1024px) {
          .pkg-grid, .menu-grid, .testi-grid {
            grid-template-columns: 1fr 1fr;
            column-gap: 1.5rem;
          }
          .pkg-grid > :nth-child(n),
          .menu-grid > :nth-child(n),
          .testi-grid > :nth-child(n) { margin: 0; z-index: auto; }
          /* keep a lighter alternating stagger on tablets */
          .pkg-grid > :nth-child(even),
          .menu-grid > :nth-child(even),
          .testi-grid > :nth-child(even) { margin-top: 2rem; }
          /* a lone third card spans the row instead of leaving a hole */
          .pkg-grid > :nth-child(3):last-child,
          .menu-grid > :nth-child(3):last-child,
          .testi-grid > :nth-child(3):last-child { grid-column: 1 / -1; }
 
          /* Services split: even columns, slightly tighter gap */
          .services-split {
            grid-template-columns: 1fr 1fr;
            column-gap: 2.5rem;
          }
        }
 
        /* Services collapses to one column earlier than the 3-up grids,
           since a side-by-side header + cluster gets cramped sooner.
           Header leads in source order, so it lands on top; the triangle
           cluster keeps its own nested grid at full width below. */
        @media (max-width: 860px) {
          .services-split {
            grid-template-columns: 1fr;
            row-gap: 2.5rem;
          }
          .services-header-col,
          .services-cards { grid-column: 1; }
          .services-header-col { grid-row: 1; }
          .services-cards { grid-row: 2; }
        }
 
        @media (max-width: 640px) {
          .pkg-grid, .menu-grid, .testi-grid {
            grid-template-columns: 1fr;
            row-gap: 1.25rem;
          }
          .pkg-grid > *,
          .menu-grid > *,
          .testi-grid > * {
            margin: 0 !important;
            grid-column: auto !important;
          }
          /* collapse the pyramid into a single clean column */
          .services-cards {
            grid-template-columns: 1fr;
            row-gap: 1.25rem;
          }
          .services-cards > :nth-child(1),
          .services-cards > :nth-child(2),
          .services-cards > :nth-child(3) {
            grid-column: 1;
            grid-row: auto;
          }
        }
 
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.7s ease both; }
      `}</style>
 
      <main style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.4s' }}>
 
        {/* ═══════════════════════ HERO ═══════════════════════ */}
        <section
          id="home"
          className="hero-has-bg"
          style={{
            ...sectionPad,
            paddingTop: 'calc(6rem + 80px)',
            paddingBottom: '6rem',
            overflow: 'hidden',
            backgroundColor: 'var(--bg)',
          }}
        >
          {HERO_SLIDES.map((src, i) => (
            <div
              key={src}
              className={`hero-slide${i === slideIndex ? ' active' : ''}`}
              style={{ backgroundImage: `url(${src})` }}
            />
          ))}
          <div className="hero-overlay" />
 
          <Navbar />
 
          <div className="slide-dots">
            {HERO_SLIDES.map((_, i) => (
              <button
                key={i}
                className={`slide-dot${i === slideIndex ? ' active' : ''}`}
                onClick={() => setSlideIndex(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
 
          <div className="blob blob-primary" style={{ width: 520, height: 520, top: '-120px', left: '-140px' }} />
          <div className="blob blob-accent" style={{ width: 400, height: 400, bottom: '-60px', right: '5%', animationDelay: '6s' }} />
 
          <div className="hero-grid fade-up" style={{ position: 'relative', zIndex: 1 }}>
            <div>
              <div
                className="hero-eyebrow-tag"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                  background: 'var(--accent-muted)', border: '1px solid var(--border-accent)',
                  padding: '0.35rem 1rem', marginBottom: '1.5rem',
                }}
              >
                <span className="hero-eyebrow-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
                <span
                  className="hero-eyebrow-text"
                  style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.58rem',
                    letterSpacing: '0.3em', textTransform: 'uppercase',
                    color: 'var(--primary)', fontWeight: 500,
                  }}
                >
                  Events &amp; Catering · Calamba
                </span>
              </div>
 
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(2.8rem, 5.5vw, 4.5rem)',
                  fontWeight: 400, lineHeight: 1.08,
                  color: 'var(--text-primary)',
                  marginBottom: '1.5rem',
                }}
              >
                Fresh Flavors for{' '}
                <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Every</em>
                <br />Celebration
              </h1>
 
              <p
                className="hero-body-text"
                style={{
                  fontFamily: 'var(--font-body)', fontSize: '1rem',
                  color: 'var(--text-muted)', lineHeight: 1.75,
                  maxWidth: 480, marginBottom: '2.5rem', fontWeight: 300,
                }}
              >
                King Jegi delivers farm-fresh Filipino catering — from intimate
                family dinners to grand events. Let us handle the food while you
                create the memories.
              </p>
 
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <Link to="/book" className="btn-hero-primary">
                  Book Your Event
                </Link>
                <Link to="/menus" className="btn-hero-outline">
                  Explore Our Menu
                </Link>
              </div>
 
              <div
                className="hero-stat-divider"
                style={{
                  display: 'flex', gap: '2.5rem', marginTop: '3rem',
                  paddingTop: '2rem', borderTop: '1px solid var(--border)',
                }}
              >
                {[
                  { value: '500+', label: 'Events Served' },
                  { value: '12 yrs', label: 'Experience' },
                  { value: '4.9 ★', label: 'Client Rating' },
                ].map((s) => (
                  <div key={s.label}>
                    <p
                      className="hero-stat-value"
                      style={{
                        fontFamily: 'var(--font-display)', fontSize: '1.8rem',
                        fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1,
                      }}
                    >
                      {s.value}
                    </p>
                    <p
                      className="hero-stat-label"
                      style={{
                        fontFamily: 'var(--font-body)', fontSize: '0.6rem',
                        letterSpacing: '0.22em', textTransform: 'uppercase',
                        color: 'var(--text-dim)', marginTop: '0.35rem',
                      }}
                    >
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
 
            <div className="hero-composition">
              <div className="hero-card-center">
                <div
                  style={{
                    position: 'absolute', top: 0, right: 0, width: 220, height: 220,
                    background: 'rgba(255,255,255,0.06)', borderRadius: '50%',
                    transform: 'translate(30%, -30%)',
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.55rem',
                    letterSpacing: '0.3em', textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.55)', display: 'block', marginBottom: '0.5rem',
                  }}
                >
                  Best Seller
                </span>
                <h3
                  style={{
                    fontFamily: 'var(--font-display)', fontSize: '2rem',
                    fontWeight: 500, color: '#fff', marginBottom: '0.4rem',
                    minHeight: '2.4rem',
                  }}
                >
                  {featureLoading ? '…' : feature ? feature.itemName : 'Our Menu'}
                </h3>
                <p
                  style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.8rem',
                    color: 'rgba(255,255,255,0.65)', fontWeight: 300, lineHeight: 1.6,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', minHeight: '2.6rem',
                  }}
                >
                  {featureLoading
                    ? 'Finding this fortnight’s favourite…'
                    : feature
                      ? feature.description
                      : 'Freshly prepared Filipino classics, made to order.'}
                </p>
                <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {/* No price unless we have a real one — the card used to advertise a
                      hardcoded ₱350 that matched nothing in the catalog. */}
                  {feature?.pricePerTray != null && (
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: '#fff' }}>
                      ₱{feature.pricePerTray.toLocaleString('en-PH')}
                      <span style={{ fontSize: '0.9rem', fontWeight: 300, color: 'rgba(255,255,255,0.6)' }}>/tray</span>
                    </span>
                  )}
                  <Link
                    to="/menus"
                    // Hands the dish to MenuPage's existing location.state effect, which
                    // selects it and scrolls it into view.
                    state={feature ? { highlightItemId: feature.id, scrollTo: 'items' } : undefined}
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      color: '#fff', padding: '0.5rem 1.25rem',
                      fontFamily: 'var(--font-body)', fontSize: '0.65rem',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      textDecoration: 'none', borderRadius: 'var(--r-full)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      transition: 'background 0.2s',
                    }}
                  >
                    View Menu
                  </Link>
                </div>
              </div>
 
              <div className="hero-float-card hero-float-left">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--accent)', lineHeight: 1 }}>
                  4.9/5
                </p>
                <p style={{ color: 'var(--accent)', fontSize: '0.8rem', margin: '0.2rem 0 0.1rem' }}>★★★★★</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                  200+ reviews
                </p>
              </div>
 
              <div className="hero-float-card hero-float-right">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'var(--primary-muted)', border: '1px solid var(--border-accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.1rem',
                    }}
                  >
                    🎉
                  </div>
                  <div>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                      New booking!
                    </p>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                      Maria S. — 150 guests · Classic
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
 
        {/* ═══════════════════════ SERVICES ═══════════════════════ */}
        <section
          id="services"
          style={{
            ...sectionPad,
            overflow: 'hidden',
            background: `
              radial-gradient(ellipse 80% 60% at 15% 20%,  color-mix(in srgb, var(--primary) 22%, transparent) 0%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 85% 75%,  color-mix(in srgb, var(--accent)  18%, transparent) 0%, transparent 65%),
              radial-gradient(ellipse 50% 40% at 50% 110%, color-mix(in srgb, var(--primary) 12%, transparent) 0%, transparent 60%),
              linear-gradient(160deg, var(--bg) 0%, var(--bg-subtle) 50%, color-mix(in srgb, var(--bg) 85%, var(--primary)) 100%)
            `,
          }}
        >
          <CollidingBlobsCanvas />
 
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 1,
              opacity: 0.032,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='340'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '220px 220px',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 2,
              backdropFilter: 'blur(24px) saturate(1.4) brightness(1.04)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.4) brightness(1.04)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: '38%', zIndex: 4,
              background: 'linear-gradient(to bottom, color-mix(in srgb, var(--primary) 7%, transparent) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: '30%', zIndex: 4,
              background: 'linear-gradient(to top, color-mix(in srgb, var(--accent) 6%, var(--bg)) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 4,
              background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 45%, color-mix(in srgb, var(--bg) 55%, transparent) 100%)',
              pointerEvents: 'none',
            }}
          />
 
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem', position: 'relative', zIndex: 5 }}>
            <div className="services-split">
              <div className="services-header-col">
                <SectionHeader eyebrow="What We Offer" title="Everything You Need for" accent="a Perfect Event" align="left" flush />
              </div>
              <div className="services-cards">
                {SERVICES.map((svc) => (
                  <div key={svc.title} className="service-card">
                    <div
                      style={{
                        width: 52, height: 52, borderRadius: 'var(--r-lg)',
                        background: 'var(--primary-muted)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.4rem', marginBottom: '1.25rem',
                        border: '1px solid var(--border)',
                        flexShrink: 0,
                      }}
                    >
                      {svc.icon}
                    </div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                      {svc.title}
                    </h3>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7, fontWeight: 300, marginBottom: '1.5rem' }}>
                      {svc.description}
                    </p>
                    <Link
                      to={svc.to}
                      style={{
                        fontFamily: 'var(--font-body)', fontSize: '0.62rem',
                        letterSpacing: '0.2em', textTransform: 'uppercase',
                        color: 'var(--primary)', textDecoration: 'none',
                        fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      }}
                    >
                      {svc.cta} →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
 
        {/* ═══════════════════════ FEATURED PACKAGES ═══════════════════════ */}
        <section
          id="packages"
          style={{
            ...sectionPad,
            /* tightened seam: Packages hands off to Menu Preview with a
               4.5rem + 4.5rem gap instead of a full 6rem + 6rem stop */
            paddingBottom: '4.5rem',
            overflow: 'hidden',
            backgroundImage: `url(${PKG_BG})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed',
          }}
        >
          <div className="pkg-bg-overlay" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 1, opacity: 0.04,
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'repeat', backgroundSize: '128px', pointerEvents: 'none',
            }}
          />
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem', position: 'relative', zIndex: 2 }}>
            <SectionHeader eyebrow="Catering Packages" title="Find Your" accent="Perfect Package" align="right" />
            <div className="pkg-grid">
              {PACKAGES.map((pkg, i) => (
                <div
                  key={pkg.id}
                  className={`pkg-card pkg-card--glass${i === 1 ? ' featured' : ''}`}
                  style={{ display: 'flex', flexDirection: 'column' }}
                >
                  {i === 1 && (
                    <div
                      style={{
                        alignSelf: 'flex-start',
                        background: 'var(--accent-muted)',
                        border: '1px solid var(--border-accent)',
                        padding: '0.25rem 0.75rem',
                        fontFamily: 'var(--font-body)', fontSize: '0.55rem',
                        letterSpacing: '0.22em', textTransform: 'uppercase',
                        color: 'var(--accent)', fontWeight: 500,
                        marginBottom: '1rem',
                      }}
                    >
                      Most Popular
                    </div>
                  )}
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                    {pkg.name}
                  </h3>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '1rem' }}>
                    {pkg.price}
                  </p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, fontWeight: 300, marginBottom: '1.5rem' }}>
                    {pkg.description}
                  </p>
                  <Link
                    to="/packages"
                    style={{
                      marginTop: 'auto',
                      display: 'block', textAlign: 'center',
                      padding: '0.85rem',
                      background: i === 1 ? 'var(--primary)' : 'transparent',
                      color: i === 1 ? 'var(--primary-text)' : 'var(--primary)',
                      border: `1px solid ${i === 1 ? 'var(--primary)' : 'var(--border-accent)'}`,
                      fontFamily: 'var(--font-body)', fontSize: '0.65rem',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      fontWeight: 500, textDecoration: 'none',
                      borderRadius: 'var(--r-full)',
                      transition: 'background 0.2s, box-shadow 0.2s',
                    }}
                  >
                    Learn More
                  </Link>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: '3rem' }}>
              <Link
                to="/packages"
                style={{
                  fontFamily: 'var(--font-body)', fontSize: '0.65rem',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  color: 'var(--text-dim)', textDecoration: 'none',
                  borderBottom: '1px solid var(--border)', paddingBottom: 2,
                }}
              >
                View All Packages →
              </Link>
            </div>
          </div>
        </section>
 
        {/* ═══════════════════════ MENU PREVIEW ═══════════════════════ */}
        <section
          id="menus"
          style={{
            ...sectionPad,
            paddingTop: '4.5rem',
            overflow: 'hidden',
            background: `
              radial-gradient(ellipse 80% 60% at 15% 20%,  color-mix(in srgb, var(--primary) 22%, transparent) 0%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 85% 75%,  color-mix(in srgb, var(--accent)  18%, transparent) 0%, transparent 65%),
              radial-gradient(ellipse 50% 40% at 50% 110%, color-mix(in srgb, var(--primary) 12%, transparent) 0%, transparent 60%),
              linear-gradient(160deg, var(--bg) 0%, var(--bg-subtle) 50%, color-mix(in srgb, var(--bg) 85%, var(--primary)) 100%)
            `,
          }}
        >
          <CollidingBlobsCanvas />
 
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 1,
              opacity: 0.032,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='340'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '220px 220px',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 2,
              backdropFilter: 'blur(24px) saturate(1.4) brightness(1.04)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.4) brightness(1.04)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: '38%', zIndex: 4,
              background: 'linear-gradient(to bottom, color-mix(in srgb, var(--primary) 7%, transparent) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: '30%', zIndex: 4,
              background: 'linear-gradient(to top, color-mix(in srgb, var(--accent) 6%, var(--bg)) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 4,
              background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 45%, color-mix(in srgb, var(--bg) 55%, transparent) 100%)',
              pointerEvents: 'none',
            }}
          />
 
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem', position: 'relative', zIndex: 5 }}>
            <SectionHeader eyebrow="From Our Kitchen" title="A Taste of What" accent="Awaits You" italic align="left" />
            <div className="menu-grid">
              {MENUS.map((menu) => (
                <div key={menu.id} className="menu-card" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                  <div style={{ height: 210, position: 'relative', overflow: 'hidden', background: 'var(--primary-muted)', flexShrink: 0 }}>
                    <img
                      src={menu.image}
                      alt={menu.tier}
                      className="menu-card-img"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: 'center',
                        transition: 'transform 0.9s cubic-bezier(0.33, 1, 0.68, 1)',
                        filter: 'var(--menu-img-filter)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'radial-gradient(ellipse at center, transparent 42%, var(--menu-vignette) 100%)',
                        zIndex: 1, pointerEvents: 'none',
                      }}
                    />
                    <div className="menu-card-grain" style={{ zIndex: 3 }} />
                    <div
                      style={{
                        position: 'absolute', top: '0.75rem', left: '0.75rem', zIndex: 4,
                        background: 'var(--menu-chip-bg)',
                        backdropFilter: 'blur(10px) saturate(1.4)',
                        WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
                        border: '1px solid var(--menu-chip-border)',
                        borderRadius: '999px', padding: '0.22rem 0.7rem',
                      }}
                    >
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.5rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 600, margin: 0 }}>
                        Menu Package
                      </p>
                    </div>
                    <div
                      style={{
                        position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 4,
                        background: 'var(--menu-chip-bg)',
                        backdropFilter: 'blur(10px) saturate(1.4)',
                        WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
                        border: '1px solid var(--menu-chip-border)',
                        borderRadius: '999px', padding: '0.22rem 0.7rem',
                      }}
                    >
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 600, margin: 0 }}>
                        {menu.price}
                      </p>
                    </div>
                  </div>
 
                  {/* body panel rises over the photo's bottom edge — the
                      rounded shoulders let the image peek through at the
                      corners, reading as a plate set on the picture */}
                  <div
                    style={{
                      padding: '1.25rem 1.25rem 1.35rem',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      textAlign: 'center', gap: '0.5rem', flex: 1,
                      position: 'relative', zIndex: 2,
                      marginTop: '-1.25rem',
                      background: 'var(--bg-card)',
                      borderRadius: '1rem 1rem 0 0',
                    }}
                  >
                    <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.01em' }}>
                      {menu.tier}
                    </h4>
                    <div style={{ width: '2rem', height: 1, background: 'color-mix(in srgb, var(--primary) 40%, transparent)', borderRadius: 999 }} />
                    <div className="menu-card-cta">
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 600 }}>
                        View Details →
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: '3rem' }}>
              <Link to="/menus" className="btn-hero-primary">
                Full Menu →
              </Link>
            </div>
          </div>
        </section>
 
        {/* ═══════════════════════ AVAILABILITY CALENDAR ═══════════════════════ */}
        <section
          id="availability"
          style={{
            ...sectionPad,
            overflow: 'hidden',
            backgroundImage: `url(${RESERVE_BG})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed',
          }}
        >
          <div className="bg-overlay" style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
 
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem', position: 'relative', zIndex: 2 }}>
            <div className="split-grid">
              <div>
                <div
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                    background: 'var(--accent-muted)', border: '1px solid var(--border-accent)',
                    padding: '0.35rem 1rem', marginBottom: '1.25rem',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
                  <span
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: '0.58rem',
                      letterSpacing: '0.3em', textTransform: 'uppercase',
                      color: 'var(--primary)', fontWeight: 500,
                    }}
                  >
                    Check Availability
                  </span>
                </div>
                <h2
                  style={{
                    fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4vw, 3rem)',
                    fontWeight: 400, color: 'var(--text-on-bg)',
                    lineHeight: 1.15, marginBottom: '1.25rem',
                    textShadow: 'var(--text-shadow-on-bg)',
                  }}
                >
                  Is Your Date{' '}
                  <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Available?</em>
                </h2>
                <p
                  style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.9rem',
                    color: 'var(--text-on-bg-muted)', lineHeight: 1.75,
                    fontWeight: 300, marginBottom: '2rem', maxWidth: 400,
                    textShadow: 'var(--text-shadow-on-bg)',
                  }}
                >
                  Check real-time availability before you book. Highlighted
                  dates are already reserved — grab yours while it's open.
                </p>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                  {[
                    { color: 'var(--primary)', label: 'Today' },
                    { color: 'var(--danger)', label: 'Booked' },
                    { color: 'var(--border-strong)', label: 'Available' },
                  ].map((l) => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, display: 'inline-block' }} />
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-on-bg-muted)' }}>
                        {l.label}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn-hero-primary"
                  style={{ display: 'inline-block', border: 'none', cursor: selectedDate ? 'pointer' : 'not-allowed', opacity: selectedDate ? 1 : 0.55 }}
                  disabled={!selectedDate}
                  onClick={() => setReserveOpen(true)}
                >
                  {selectedDate ? `Reserve ${fmtSelected(selectedDate)}` : 'Pick a date above'}
                </button>
              </div>
 
              <div
                style={{
                  background: 'var(--surface-glass)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--r-xl)',
                  padding: '1.75rem',
                  boxShadow: 'var(--shadow-glass)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                  <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {MONTH_NAMES[calMonth]} {calYear}
                  </p>
                  <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
                </div>
 
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: '0.5rem' }}>
                  {DAY_ABBR.map((d) => (
                    <div
                      key={d}
                      style={{
                        textAlign: 'center',
                        fontFamily: 'var(--font-body)', fontSize: '0.6rem',
                        letterSpacing: '0.12em', textTransform: 'uppercase',
                        color: 'var(--text-dim)', padding: '0.4rem 0',
                      }}
                    >
                      {d}
                    </div>
                  ))}
                </div>
 
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                  {Array.from({ length: firstWeekday }).map((_, i) => (
                    <div key={`e-${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const iso = toISO(calYear, calMonth, day);
                    const isToday = iso === todayISO;
                    const isBooked = bookedDates.has(iso);
                    const isPast = iso < todayISO && !isToday;
                    // Only a real, still-bookable date can be picked.
                    const selectable = !isBooked && !isPast;
                    const isSelected = selectedDate === iso;
                    return (
                      <div
                        key={day}
                        role={selectable ? 'button' : undefined}
                        tabIndex={selectable ? 0 : undefined}
                        aria-pressed={selectable ? isSelected : undefined}
                        className={[
                          'cal-day',
                          isToday ? 'cal-today' : '',
                          isBooked ? 'cal-booked' : '',
                          isPast ? 'cal-past' : '',
                          isSelected ? 'cal-selected' : '',
                        ].join(' ')}
                        onMouseEnter={() => { setHovered(day); setHoveredISO(iso); }}
                        onMouseLeave={() => { setHovered(null); setHoveredISO(null); }}
                        onClick={() => selectable && setSelectedDate(isSelected ? null : iso)}
                        onKeyDown={(e) => {
                          if (!selectable) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedDate(isSelected ? null : iso);
                          }
                        }}
                        title={isBooked ? 'Already booked' : isPast ? 'Past date' : `Select ${iso}`}
                      >
                        <span>{day}</span>
                      </div>
                    );
                  })}
                </div>
 
                {hovered && (() => {
                  const iso = toISO(calYear, calMonth, hovered);
                  const slots = slotsByDate[iso];
                  const loaded = slots && slots !== 'error' ? slots : null;

                  /* What the line says, in priority order:
                       past / reserved   → unchanged, no point listing times
                       real slot data    → the actual open windows
                       still loading or
                       endpoint failed   → the original wording, so a dead endpoint
                                           degrades to what the calendar always said */
                  let detail: string;
                  if (iso < todayISO) {
                    detail = '— Past date';
                  } else if (bookedDates.has(iso)) {
                    detail = '— Already reserved';
                  } else if (loaded?.dayLocked) {
                    detail = '— Closed for bookings';
                  } else if (loaded && loaded.free.length === 0) {
                    detail = '— No open time slots';
                  } else if (loaded && loaded.busy.length === 0) {
                    // Nothing booked at all: quote the whole operating day rather than
                    // making it sound like a leftover gap.
                    detail = `— Open all day (${fmtWindow(loaded.opensAt, loaded.closesAt)})`;
                  } else if (loaded) {
                    detail = `— Open ${loaded.free.map((w) => fmtWindow(w.start, w.end)).join(', ')}`;
                  } else {
                    detail = '— Available to book';
                  }

                  return (
                    <p style={{ textAlign: 'center', marginTop: '1rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {MONTH_NAMES[calMonth]} {hovered}, {calYear} {detail}
                      {loaded && loaded.busy.length > 0 && loaded.free.length > 0 && (
                        <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                          Allows for a {loaded.bufferHours}-hour setup gap around the {loaded.busy.length === 1 ? 'booked event' : 'booked events'}.
                        </span>
                      )}
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>
        </section>
 
        {/* ═══════════════════════ TESTIMONIALS ═══════════════════════ */}
        <section style={{ ...sectionPad, background: 'var(--bg-subtle)', overflow: 'hidden' }}>
          <RainingCanvas />
 
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 2.5rem', position: 'relative', zIndex: 1 }}>
            <SectionHeader eyebrow="Client Stories" title="What Our" accent="Clients Say" italic align="right" />
            <div className="testi-grid" ref={testiGridRef}>
              {/* Approved reviews from the backend; the built-in samples stand in only
                  until the business has approved some of its own. */}
              {(reviews.length > 0
                ? reviews.map((r) => ({
                    key: r.id,
                    quote: r.body,
                    name: r.authorName,
                    rating: r.rating,
                    caption: new Date(r.submittedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' }),
                    initials: r.authorName.split(' ').map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase(),
                  }))
                : TESTIMONIALS.map((t) => ({
                    key: String(t.id),
                    quote: t.quote,
                    name: t.name,
                    rating: 5,
                    caption: t.event,
                    initials: t.initials,
                  }))
              ).map((t) => (
                <div key={t.key} className="testi-card">
                  <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} style={{ color: i < t.rating ? 'var(--accent)' : 'var(--border-strong)', fontSize: '0.9rem' }}>★</span>
                    ))}
                  </div>
                  <p
                    style={{
                      fontFamily: 'var(--font-display)', fontSize: '1.05rem',
                      fontStyle: 'italic', color: 'var(--text-secondary)',
                      lineHeight: 1.65, marginBottom: '1.5rem', fontWeight: 400,
                    }}
                  >
                    "{t.quote}"
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
                    <div
                      style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: 'var(--primary-muted)',
                        border: '1px solid var(--border-accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-display)', fontSize: '0.9rem',
                        color: 'var(--primary)', fontWeight: 600, flexShrink: 0,
                      }}
                    >
                      {t.initials}
                    </div>
                    <div>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {t.name}
                      </p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                        {t.caption}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
 
        {/* ═══════════════════════ FINAL CTA ═══════════════════════ */}
        <section style={{ ...sectionPad, background: 'var(--primary)', overflow: 'hidden' }}>
          <div className="blob blob-primary-soft" style={{ width: 500, height: 500, top: '-150px', right: '-100px' }} />
          <div className="blob blob-accent-soft" style={{ width: 350, height: 350, bottom: '-80px', left: '-60px', animationDelay: '8s' }} />
 
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 2.5rem', textAlign: 'center', position: 'relative' }}>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                background: 'rgba(255,255,255,0.15)',
                padding: '0.35rem 1rem', marginBottom: '1.5rem',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
              <span
                style={{
                  fontFamily: 'var(--font-body)', fontSize: '0.58rem',
                  letterSpacing: '0.3em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.8)', fontWeight: 500,
                }}
              >
                Ready to Book?
              </span>
            </div>
 
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem, 5vw, 3.5rem)', fontWeight: 400, color: '#fff', lineHeight: 1.1, marginBottom: '1.25rem' }}>
              Let's Make Your Event{' '}
              <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Unforgettable</em>
            </h2>
 
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, fontWeight: 300, marginBottom: '2.5rem' }}>
              Join over 500 families and businesses who trusted King Jegi
              to feed their most important moments. Reserve your date now.
            </p>
 
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                to="/book"
                style={{
                  background: '#fff', color: 'var(--primary)',
                  padding: '1rem 2.5rem',
                  fontFamily: 'var(--font-body)', fontSize: '0.72rem',
                  fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase',
                  textDecoration: 'none', borderRadius: 'var(--r-full)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                }}
              >
                Reserve Your Event
              </Link>
              <Link
                to="/packages"
                style={{
                  background: 'transparent', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.4)',
                  padding: '1rem 2.5rem',
                  fontFamily: 'var(--font-body)', fontSize: '0.72rem',
                  fontWeight: 400, letterSpacing: '0.22em', textTransform: 'uppercase',
                  textDecoration: 'none', borderRadius: 'var(--r-full)',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
              >
                View Packages
              </Link>
            </div>
 
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', marginTop: '1.5rem', letterSpacing: '0.1em' }}>
              5% reservation fee · Confirmation within 24 hours
            </p>
          </div>
        </section>
 
        {/* ═══════════════════════ FOOTER ═══════════════════════ */}
        <footer
          style={{
            background: 'var(--bg-subtle)',
            borderTop: '1px solid var(--border)',
            padding: '3rem 2.5rem',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-body)', fontSize: '0.65rem',
              letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'var(--text-dim)',
            }}
          >
            © {new Date().getFullYear()} King Jegi Party Need and Catering Services · Calamba, Laguna
          </p>
        </footer>
      </main>
 
      {/* ═══════════════════════ RESERVE-THIS-DATE MODAL ═══════════════════════ */}
      {reserveOpen && selectedDate && (
        <div className="lp-overlay" role="dialog" aria-modal="true" aria-label="Choose how to book" onClick={() => setReserveOpen(false)}>
          <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lp-modal-close" onClick={() => setReserveOpen(false)} aria-label="Close">✕</button>

            <p className="lp-modal-eyebrow">Reserving</p>
            <h3 className="lp-modal-title">{fmtSelected(selectedDate)}</h3>
            <p className="lp-modal-sub">How would you like to plan this event?</p>

            <div className="lp-modal-options">
              <button type="button" className="lp-option" onClick={() => startBooking('event')}>
                <span className="lp-option-icon" aria-hidden="true">🍽️</span>
                <span>
                  <strong>Full Event Catering</strong>
                  <small>Food, staff, and setup for your celebration.</small>
                </span>
              </button>

              <button type="button" className="lp-option" onClick={() => startBooking('rentals')}>
                <span className="lp-option-icon" aria-hidden="true">🎪</span>
                <span>
                  <strong>Rental Items Only</strong>
                  <small>Tables, chairs, lights, and equipment.</small>
                </span>
              </button>

              <button type="button" className="lp-option" onClick={() => startBooking('plan')}>
                <span className="lp-option-icon" aria-hidden="true">✨</span>
                <span>
                  <strong>Plan by Budget</strong>
                  <small>Tell us your budget — we’ll suggest kitchen-priced options.</small>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <AmbientAudio />
      <ChatWidget />
    </>
  );
}
 


