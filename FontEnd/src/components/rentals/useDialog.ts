import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour shared by the filter sheet and the checkout dialog: focus in,
 * Tab cycling, Escape to close, background scroll lock, focus back to the opener.
 *
 * Extracted the moment there were two of these. A focus trap is not hard, but it
 * is easy to get subtly wrong in ways nobody notices with a mouse — and two
 * copies drift, so the bug gets fixed in one dialog and not the other.
 *
 * Deliberately not a <Modal> component: the two dialogs share behaviour but
 * nothing about their markup (a bottom sheet and a centred panel), and wrapping
 * them in a common shell would mean a pile of props to undo the shell again.
 */
export function useDialog(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement as HTMLElement | null;
    /* Deferred a frame: on the render that opens the dialog the panel's children
       may not be laid out yet, and focusing a zero-size element is a no-op in
       some browsers. */
    const focusTimer = window.setTimeout(() => {
      const target =
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        null;
      target?.focus();
    }, 0);

    /* Without this the page keeps scrolling under the scrim, which on iOS leaves
       the dialog floating over a moving background. */
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      /* Wrap both ways. The !contains branch catches focus that escaped to the
         browser chrome and pulls it back in. */
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, onClose, panelRef, initialFocusRef]);
}
