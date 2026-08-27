import { useEffect, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme';

/**
 * Ambient backdrop, drawn on a 2D canvas behind a section's content.
 *
 * Two looks, because one effect cannot serve both themes: rain reads as weather
 * on a dark ground and as dirt on a light one. `variant="auto"` therefore picks
 * rain under the dark theme and a slow warm glow under the light theme.
 * `variant="rain"` pins the rain for surfaces that are dark in BOTH themes —
 * the testimonials band carries `.dark-band`, so it never follows the page.
 *
 * Shared rules, whichever look is drawn: nothing runs under reduced motion, the
 * loop is started and stopped by an IntersectionObserver so scrolling past does
 * not leave a requestAnimationFrame burning, the canvas is inert to pointers and
 * hidden from assistive tech, and everything is torn down on unmount.
 */

/** Rain drops per 100 000 px², so density holds across viewport sizes. */
const RAIN_DENSITY = 5.5;
const MAX_DROPS = 220;
/** Glow orbs are large and few — a handful of soft radials, not a particle field. */
const GLOW_ORBS = 7;

type Drop = { x: number; y: number; len: number; vy: number; alpha: number };
type Orb = { x: number; y: number; r: number; vx: number; vy: number; alpha: number; hue: 0 | 1 };

export function AmbientCanvas({ variant = 'auto' }: { variant?: 'auto' | 'rain' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const mode: 'rain' | 'glow' =
    variant === 'rain' || resolvedTheme === 'dark' ? 'rain' : 'glow';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Not a degraded mode — under reduced motion the effect does not exist, so
    // nothing is sized, observed or scheduled.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    let drops: Drop[] = [];
    let orbs: Orb[] = [];
    let raf = 0;
    let running = false;
    let width = 0;
    let height = 0;

    const cssVar = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    const toRgb = (color: string): [number, number, number] => {
      if (color.startsWith('rgb')) {
        const p = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        return [p[0] ?? 128, p[1] ?? 128, p[2] ?? 128];
      }
      const h = color.replace('#', '');
      const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      return [
        parseInt(n.slice(0, 2), 16) || 128,
        parseInt(n.slice(2, 4), 16) || 128,
        parseInt(n.slice(4, 6), 16) || 128,
      ];
    };

    /* Rain is drawn on a dark ground, so it takes the band ink. The glow sits on
       the light page ground and takes the brand accent and gold — a theme token
       either way, never a literal. */
    let ink: [number, number, number] = [247, 239, 244];
    let warm: [[number, number, number], [number, number, number]] = [
      [166, 42, 87],
      [232, 180, 95],
    ];

    const readPalette = () => {
      ink = toRgb(cssVar('--band-text') || '#f7eff4');
      warm = [
        toRgb(cssVar('--accent') || '#a62a57'),
        toRgb(cssVar('--gold-on-band') || '#e8b45f'),
      ];
    };

    const seed = () => {
      if (mode === 'rain') {
        const n = Math.max(24, Math.min(MAX_DROPS, Math.round(((width * height) / 100000) * RAIN_DENSITY)));
        drops = Array.from({ length: n }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          len: 8 + Math.random() * 16,
          vy: 90 + Math.random() * 140,
          // Low on purpose: copy sits over this and has to stay the thing you read.
          alpha: 0.05 + Math.random() * 0.09,
        }));
        orbs = [];
        return;
      }
      drops = [];
      orbs = Array.from({ length: GLOW_ORBS }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.min(width, height) * (0.18 + Math.random() * 0.22),
        // Barely moving: this is ambience, not motion anyone should notice.
        vx: (Math.random() - 0.5) * 9,
        vy: (Math.random() - 0.5) * 6,
        alpha: 0.05 + Math.random() * 0.05,
        hue: (i % 2) as 0 | 1,
      }));
    };

    const setSize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width || window.innerWidth;
      height = rect.height || 400;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readPalette();
      seed();
    };

    let last = 0;
    const frame = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      ctx.clearRect(0, 0, width, height);

      if (mode === 'rain') {
        ctx.lineWidth = 1;
        for (const d of drops) {
          d.y += d.vy * dt;
          if (d.y - d.len > height) {
            d.y = -d.len;
            d.x = Math.random() * width;
          }
          ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${d.alpha})`;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          // A slight lean reads as falling rather than as a static hatch.
          ctx.lineTo(d.x + 1.5, d.y + d.len);
          ctx.stroke();
        }
      } else {
        for (const o of orbs) {
          o.x += o.vx * dt;
          o.y += o.vy * dt;
          // Wrap with a full radius of slack so an orb never pops at the edge.
          if (o.x < -o.r) o.x = width + o.r;
          if (o.x > width + o.r) o.x = -o.r;
          if (o.y < -o.r) o.y = height + o.r;
          if (o.y > height + o.r) o.y = -o.r;
          const [r, g, b] = warm[o.hue];
          const grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
          grad.addColorStop(0, `rgba(${r},${g},${b},${o.alpha})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    setSize();
    window.addEventListener('resize', setSize);

    /* The host grows AFTER mount — a catalog finishes loading, a filter changes
       the row count, an accordion opens — and none of that fires a window
       resize. Without this the canvas keeps the height the container had on its
       first frame and the effect covers only the top of a long page. */
    const ro = new ResizeObserver(setSize);
    ro.observe(parent);

    // The point of the observer: off screen, nothing is scheduled at all.
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(parent);

    const onVisibility = () => (document.hidden ? stop() : undefined);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', setSize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `mode` is a dependency: switching theme reseeds with the other particle set
    // rather than leaving the previous look running.
  }, [mode]);

  return <canvas ref={canvasRef} className="lp-ambient" aria-hidden="true" />;
}

export default AmbientCanvas;
