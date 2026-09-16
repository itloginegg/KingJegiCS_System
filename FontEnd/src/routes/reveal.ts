/**
 * Shows a section in its final place straight away, skipping its scroll reveal
 * (see PageTransition).
 *
 * Call it before scrolling TO a section. One still waiting to reveal sits 28px below
 * where it will end up, so scrolling to it lines up the wrong position: the reveal then
 * lifts it, and its heading lands under the sticky navbar.
 *
 * Its own module rather than an export of PageTransition.tsx, so that file keeps
 * exporting only components and fast refresh keeps working on it.
 */
export function settleReveal(el: Element) {
  el.classList.remove('kj-reveal', 'kj-revealed');
  el.querySelectorAll('.kj-reveal').forEach((inner) => inner.classList.remove('kj-reveal', 'kj-revealed'));
  el.closest('.kj-reveal')?.classList.remove('kj-reveal', 'kj-revealed');
}
