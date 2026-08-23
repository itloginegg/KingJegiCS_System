# BookingPage Hero Refactor — corrected prompt

## What I changed and why

I read `FontEnd/src/pages/BookingPage.tsx`, `FontEnd/src/index.css`, and the backend `Booking.cs` before rewriting. Nine things in the original prompt would have produced wrong output:

1. **The reference image was never attached.** `image_ab0aa2.jpg` isn't in this conversation. Attach it, or the "match the reference layout" instruction is unenforceable.
2. **The page doesn't use Tailwind.** `BookingPage.tsx` is built entirely from inline `style={{}}` objects plus a ~200-line inline `<style>` block of `bk-*` classes reading raw `var(--token)`. Asking for Tailwind isn't wrong, but it's a *convention change* that has to be stated explicitly, or the model will silently mix two systems in one file.
3. **Dark mode has not been removed.** `src/context/ThemeContext.tsx`, `src/hooks/useTheme.ts`, `src/components/ui/ThemeToggle.tsx` and `@custom-variant dark` in `index.css` are all live. Your "no `dark:` variants" rule is still correct — but for a different reason: the semantic tokens forward to properties that `.dark` rebinds, so `dark:` is unnecessary, not unavailable. There is exactly **1** `dark:` in the whole `.tsx` codebase. Given the wrong rationale, a model may "helpfully" strip theme logic.
4. **"Match the backend schemas" is a false premise here.** The three cards are not entities. They're client-side navigation over `type ServiceFlow = 'event' | 'rentals'` plus a `planMode` boolean. Asking for mock data "formatted strictly according to my backend architecture" invites invented DTOs.
5. **The three cards do not behave the same way.** Cards 1 and 2 call `pickService(flow)` (sets `serviceFlow`, advances `step` to 1). Card 3 calls `setPlanMode(true)`, which *replaces the whole hero* with `<PlanByBudget />`. A uniform `onClick` breaks the third flow.
6. **"Scan my workspace for colors" wastes a turn and invites guessing.** The token names are known — name them.
7. **Font conflict.** "Massive bold uppercase sans-serif" contradicts the site's display face (Cormorant Garamond serif, `--font-display`). Tailwind's `font-sans` here is Inter; the body face is Jost. This needs to be a stated decision.
8. **The footer's right side is undefined.** You specified left and center; the reference presumably has something at right. Unspecified means invented.
9. **No acceptance criteria.** Nothing told the model when it was done or what it must not touch.

Two judgment calls I'd reconsider before sending: `rounded-3xl` (24px) is off-system — the design tokens top out at `--r-xl: 20px`; and the all-caps sans heading discards the serif/italic accent treatment (`Book Your *Experience*`) that ties this page to the landing page.

---

## The corrected prompt

> Act as a Senior Frontend Developer and UI Designer. Refactor **only the hero section (step 0)** of `FontEnd/src/pages/BookingPage.tsx` in my KingJegi catering system. The attached reference image defines the visual layout; my instructions below define the content and behaviour. Where they disagree, my instructions win.
>
> **Read these files before writing any code:**
> - `FontEnd/src/pages/BookingPage.tsx` — the hero is the `{step === 0 && !submitted && (...)}` block, roughly lines 872–950.
> - `FontEnd/src/index.css` — the `@theme` block and the `:root` / `.dark` token definitions.
> - `FontEnd/src/components/suggestions/PlanByBudget.tsx` — rendered in place of the card grid when `planMode` is true.
>
> ### Scope and non-goals
>
> Replace the markup inside the step-0 `<section>` only. Do not touch steps 1–4, the success state, the `bk-*` `<style>` block, the API layer, or any handler outside the hero. Everything below step 0 must render exactly as it does now.
>
> ### Behaviour that must survive the refactor
>
> These already exist in the file. Wire the new UI to them; do not reimplement or rename them:
>
> - `pickService('event')` — card 1's click handler.
> - `pickService('rentals')` — card 2's click handler.
> - `setPlanMode(true)` — card 3's click handler. **Note this is different from the other two:** when `planMode` is true the card grid is replaced by `<PlanByBudget onBack={() => setPlanMode(false)} onRequireLogin={...} onMaterialized={...} />`, with the props exactly as they're currently passed. Preserve that conditional.
> - The `presetFlow` deep-link from `useLocation().state` (`'event' | 'rentals' | 'plan'`), which can skip the hero entirely by initialising `step` to 1.
> - `<Navbar activePage="quotation" />` above the hero.
> - The "Book Another" reset path, which returns the user to `step === 0`.
>
> ### Data model — client-side only
>
> The three cards are navigation, not entities. Do not invent DTOs or fetch anything. Define the mock array against the union types already in the file:
>
> ```ts
> type HeroCardAction =
>   | { kind: 'flow'; flow: ServiceFlow }   // ServiceFlow = 'event' | 'rentals'
>   | { kind: 'plan' };                     // sets planMode
>
> interface HeroCard {
>   id: string;
>   label: string;        // e.g. "Full Event Catering"
>   description: string;
>   icon: LucideIcon;
>   action: HeroCardAction;
> }
> ```
>
> For context only — these map to the backend `BookingType` enum downstream, at submit time, not here: `'event'` → `FullService`, `'rentals'` → `RentalService`, Plan-by-Budget materialises a draft through the suggestion engine. `FoodDelivery` is a fourth `BookingType` that is deliberately **not** offered in this picker. Don't add a fourth card.
>
> ### Theme — use these exact tokens
>
> Tailwind v4 is configured with `@theme` in `index.css`, which exposes every semantic token as a utility. Use the utilities; never hardcode a hex value from the reference image, and never write a `dark:` variant — the tokens are rebound by `.dark` at the CSS-custom-property level, so a single class set already themes correctly in both modes. Light and dark both remain live; leave `ThemeContext` alone.
>
> | Purpose | Utility |
> |---|---|
> | Page background | `bg-bg` |
> | Recessed background | `bg-bg-subtle` |
> | Card surfaces | `bg-bg-card`, `bg-surface` |
> | Headings / body / captions | `text-text-primary`, `text-text-secondary`, `text-text-muted`, `text-text-dim` |
> | Primary action | `bg-primary`, `hover:bg-primary-hover`, `text-primary-text`, `bg-primary-muted` |
> | Accent (attention, decorative) | `text-accent`, `bg-accent-muted`, `border-border-accent`, `text-accent-fg` on an accent fill |
> | Borders | `border-border`, `border-border-strong` |
> | Translucent surface | `bg-glass`, `border-glass-border` |
> | Card elevation | `shadow-card` |
>
> Differentiate the three left-hand cards using `bg-bg-card`, `bg-primary-muted`, and `bg-accent-muted` — not three invented colours.
>
> **Typography — confirm before building:** the site's display face is Cormorant Garamond (`font-serif`) and the current H1 is `Book Your <em>Experience</em>` with an italic accent-coloured second word. You've asked for a massive bold uppercase **sans** heading, which would be Inter (`font-sans`). If that's the intended departure, say so in a comment; if not, keep the serif treatment.
>
> ### Layout
>
> **Global:** full-height `grid grid-cols-12 gap-8` on desktop, `bg-bg`. Left column `col-span-4`, right column `col-span-8`. Single column stacked on mobile — but treat the asymmetric desktop split as the primary target, not an afterthought.
>
> **Left column** — vertical flex of three cards, `rounded-3xl`, `p-8`, each an image/graphic placeholder on the left and text on the right:
>
> | Card | Description (top right) | Label (bottom right) | Icon |
> |---|---|---|---|
> | 1 | "Complete event packages with staff, styling, and curated menus for any occasion." | Full Event Catering | — |
> | 2 | "Tables, chairs, linens, and decor — delivered to your venue." | Rental Items Only | small triangle |
> | 3 | "Tell us your budget — we'll suggest complete, kitchen-priced options you can book." | Plan by Budget | circular |
>
> Copy is verbatim — it matches the current production strings. Icons from `lucide-react` (already a dependency, v1.26). Each card is a real `<button>`, keyboard-focusable, with a visible focus ring.
>
> **Right column** — centred flex column for the top half, footer pinned at the bottom:
>
> - **Eyebrow badge:** outline pill, `rounded-full`, thin `border-border`, containing a teardrop/flame icon in `text-accent` and the uppercase text "START HERE".
> - **Heading:** "BOOK YOUR EXPERIENCE!" — massive, bold, uppercase, centred, `leading-none`, `text-text-primary`.
> - **CTA container:** wide `rounded-full` pill on a `bg-glass` surface. Left: "Choose the service that fits your occasion. We'll guide you through every detail." — must wrap cleanly, no overflow at any breakpoint. Far right: solid circular `bg-primary` button containing `ArrowUpRight`. State what this button does — if it has no destination yet, wire it to card 1's `pickService('event')` rather than leaving a dead `onClick`.
> - **Footer:** faint full-width `border-border` divider, then `flex justify-between items-end`. Left: small bold uppercase "PREPARED BY EXPERTS" stacked above three pagination dots (one filled `bg-primary`, two outlined `border-border`). Centre: **intentionally empty — do not add the portrait from the reference image.** Right: leave empty unless I tell you otherwise; do not invent content to balance it.
>
> ### Output
>
> Modular components — `HeroLayout`, `StackedCard`, `HeroContent` — as separate files under `FontEnd/src/components/booking/`, imported into `BookingPage.tsx`. Typed props, no `any`. Show me the diff to `BookingPage.tsx` separately from the new files.
>
> ### Done when
>
> - `npx tsc -b` passes with no new errors.
> - All three cards route to their existing handlers, and card 3 still swaps in `PlanByBudget`.
> - Zero `dark:` variants and zero hex literals in the new files.
> - The `?presetFlow=` deep link still bypasses the hero.
> - Steps 1–4 render unchanged.
