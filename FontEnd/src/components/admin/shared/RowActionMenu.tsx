import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import type { ActionItem } from './types';

export interface RowActionMenuProps {
  items: ActionItem[];
  /** Completed bookings disable the trigger outright. */
  disabled?: boolean;
  /** Announced on the trigger, so every row's button isn't just "more options". */
  label: string;
}

/**
 * The per-row "…" dropdown.
 *
 * Roving focus with the arrow keys, Home/End, Esc to dismiss, and focus returned to
 * the trigger on close. Disabled items stay in the DOM (so the menu doesn't reshuffle
 * between rows) but are skipped when arrowing.
 *
 * The menu is portalled to <body> and positioned against the trigger, not rendered
 * inside the row. Every table that uses this sits in an `overflow-x: auto` scroller
 * inside an `overflow: hidden` card, and a horizontal scroller clips vertically too,
 * so an in-row menu on the last rows was cut off at the table's bottom edge, or turned
 * the table into a tiny scroll box, and its lower items couldn't be clicked. It opens
 * below the trigger, or above when there isn't room, and closes if anything scrolls,
 * since it would otherwise float away from its row.
 */
export function RowActionMenu({ items, disabled = false, label }: RowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /* Viewport position of the open menu; null until measured, so it never flashes at 0,0. */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const enabledIndexes = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  /* Dismissal. Pointerdown rather than click so the menu closes on press, and capture
     so a row underneath can't swallow the event first. */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The menu lives in a portal now, so "inside" means the trigger OR the menu.
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    /* Scrolling the page or the table moves the row out from under a fixed menu. Scroll
       inside the menu itself is ignored. */
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  /* Place the menu once it has rendered and has a size: right edge aligned with the
     trigger's, below it, or above it when the bottom of the window is too close. Kept
     inside the window horizontally too. */
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const t = trigger.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const fitsBelow = t.bottom + gap + m.height <= window.innerHeight - margin;
    const fitsAbove = t.top - gap - m.height >= margin;
    const top = fitsBelow || !fitsAbove ? t.bottom + gap : t.top - gap - m.height;
    const left = Math.min(Math.max(margin, t.right - m.width), window.innerWidth - m.width - margin);
    setPos({ top: Math.max(margin, top), left });
  }, [open, items.length]);

  /* Focus follows activeIndex while the menu is open. */
  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const openAt = (where: 'first' | 'last') => {
    /* Opens even when every item is disabled: the disabled labels and their hints are
       the explanation for why nothing can be done here, and a trigger that silently
       does nothing is worse than one that opens and says why. Only focus placement
       depends on there being something enabled. */
    if (enabledIndexes.length > 0) {
      setActiveIndex(where === 'first' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]);
    }
    // Only a fresh open is re-measured; Home/End inside an open menu keep their place.
    if (!open) setPos(null);
    setOpen(true);
  };

  const step = (delta: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const at = enabledIndexes.indexOf(activeIndex);
    const next = at === -1
      ? enabledIndexes[0]
      : enabledIndexes[(at + delta + enabledIndexes.length) % enabledIndexes.length];
    setActiveIndex(next);
  };

  return (
    <div ref={wrapRef} className="relative flex justify-center">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : openAt('first'))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); openAt('first'); }
          if (e.key === 'ArrowUp') { e.preventDefault(); openAt('last'); }
        }}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
            else if (e.key === 'Home') { e.preventDefault(); openAt('first'); }
            else if (e.key === 'End') { e.preventDefault(); openAt('last'); }
            else if (e.key === 'Tab') close();
          }}
          /* Fixed and above the dashboard's chrome, but below its modals (z 120+), which
             an action opens after this closes. Hidden until placed. */
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden', zIndex: 110 }}
          className="min-w-[190px] max-h-[calc(100vh-16px)] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-lg)]"
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.hint}
              tabIndex={i === activeIndex ? 0 : -1}
              onFocus={() => setActiveIndex(i)}
              onClick={() => { close(); item.onSelect(); }}
              className={`block w-full px-3.5 py-2 text-left text-[0.78rem] transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${
                item.danger
                  ? 'mt-1 border-t border-[var(--border)] pt-2 text-[var(--danger)] hover:bg-[var(--danger-muted)] focus:bg-[var(--danger-muted)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] focus:bg-[var(--bg-subtle)]'
              } disabled:hover:bg-transparent`}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default RowActionMenu;
