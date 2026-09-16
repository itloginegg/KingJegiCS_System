import { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import './pageTransition.css';
import { settleReveal } from './reveal';

/**
 * Layout route around every page: a fade on navigation, a reveal as sections scroll
 * into view, and a scroll reset so a new page opens at its top.
 *
 * WHY OPACITY ONLY on the page. A transform on an ancestor becomes the containing
 * block for every `position: fixed` descendant, and the navbars, the booking wizard's
 * sticky rail and inline modals all live inside pages. Sliding the page would drag
 * all of them with it. The section reveal does use a transform, but only on sections
 * still off screen, and it removes its classes once the transition ends.
 *
 * WHY THE KEY IS NOT THE RAW PATHNAME. The keyed wrapper remounts its page, which is
 * what replays the fade. /admin and /admin/booking-histories render the same
 * dashboard, and remounting it on that switch would throw away its state.
 *
 * Suspense sits outside the keyed wrapper, so a lazy page's wrapper is first committed
 * when its chunk arrives. The fade therefore plays on the page itself, not on the
 * blank fallback in front of it.
 *
 * Reduced motion turns both animations off (here and in the CSS); the scroll reset
 * stays, since it is not motion.
 */
export function PageTransition() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const pageKey = location.pathname.startsWith('/admin') ? '/admin' : location.pathname;

  /* New page, new scroll position: open at the top, or at the #target when there is
     one. Back/forward (POP) is left alone, so returning to a page doesn't jump. */
  useLayoutEffect(() => {
    if (navigationType === 'POP') return;
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) { settleReveal(target); target.scrollIntoView({ block: 'start' }); return; }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname, location.hash, navigationType]);

  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg)' }} aria-busy="true" />}>
      <RevealPage key={pageKey}>
        <Outlet />
      </RevealPage>
    </Suspense>
  );
}

const REVEAL_SELECTOR = 'section, [data-reveal]';

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Fades its page in on mount, and reveals each section the first time it scrolls into
 * view. Automatic, so no page has to opt in: every <section> takes part, plus anything
 * marked data-reveal; data-no-reveal opts an element (and what's inside it) out.
 *
 * Only sections that start OFF screen are hidden and revealed. One already in view when
 * it appears is left alone, so the top of a page never blinks out and back in, and it
 * never plays on top of the page fade.
 */
function RevealPage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    const seen = new WeakSet<Element>();

    const reveal = (el: HTMLElement) => {
      el.classList.add('kj-revealed');
      const done = (e: TransitionEvent) => {
        if (e.target !== el) return;
        el.classList.remove('kj-reveal', 'kj-revealed');
        el.removeEventListener('transitionend', done);
      };
      el.addEventListener('transitionend', done);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          reveal(entry.target as HTMLElement);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
    );

    const register = (el: Element) => {
      if (seen.has(el) || !(el instanceof HTMLElement)) return;
      seen.add(el);
      if (el.closest('[data-no-reveal]')) return;
      // Nested sections reveal with their parent rather than a second time inside it.
      if (el.parentElement?.closest('.kj-reveal')) return;
      const rect = el.getBoundingClientRect();
      const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
      if (onScreen) return;
      el.classList.add('kj-reveal');
      io.observe(el);
    };

    const scan = (node: ParentNode) => {
      if (node instanceof Element && node.matches(REVEAL_SELECTOR)) register(node);
      node.querySelectorAll(REVEAL_SELECTOR).forEach(register);
    };

    scan(root);

    /* Pages render sections after their data loads, or when a tab or step changes, so
       new ones are picked up as they appear. */
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => { if (n instanceof Element) scan(n); });
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
      // Never leave a section hidden behind for the next render to find.
      root.querySelectorAll('.kj-reveal').forEach((el) => el.classList.remove('kj-reveal', 'kj-revealed'));
    };
  }, []);

  return <div ref={ref} className="kj-page">{children}</div>;
}
