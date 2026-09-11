# Site chrome

Components that appear across the site rather than on one page: the navbar, the
footer, the ambient backdrop canvas, the background-audio toggle, and the
assistant widget.

These lived in `components/landing/` until it became clear that four different
features were importing from a directory named after a single page — `/menus`,
`/rentals`, `/packages`, `/book`, `/cart` and the customer dashboard all pulled
`Navbar` and `SiteFooter` out of "landing". The name was the only thing wrong;
splitting it costs nothing and stops the next person wondering why the booking
wizard depends on the landing page.

## What belongs here

Something used by more than one page, or mounted once in `AppRoutes` for the
whole app. If a new component is only ever rendered by `/`, it belongs in
`components/landing/` with the other landing sections.

## What does NOT belong here

Generic, domain-free UI — buttons, toasts, theme toggle — which lives in
`components/ui/`. The difference is that these five know about *this site*: the
navbar knows the route list and reads the cart, the chat widget knows the
assistant. A `<Button>` knows nothing.
