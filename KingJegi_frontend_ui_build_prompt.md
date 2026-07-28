# Build prompt — KingJegi frontend: budget suggestions, notifications, assistant chat UI

Paste this into Claude Code (or a fresh Claude session with the repo attached), after — or alongside — the backend work in `KingJegi_build_prompt.md`.

## Context

You are extending the KingJegi frontend: React 19 + TypeScript + Vite, Tailwind v4 (installed, lightly used — see below), `framer-motion` (landing page only), `lucide-react` for all icons, `react-router-dom` v7, `@microsoft/signalr` for one existing live-update hub. Project root `FontEnd/` (yes, that's the actual folder name — a typo for "Frontend" that predates this task; don't rename it). Source under `FontEnd/src`.

This UI talks to the backend built from `KingJegi_build_prompt.md` (Slices A–D: budget suggestions, notification worker, Gemini-backed assistant, proactive nudges). **Treat the endpoint contracts referenced below as provisional** — that backend prompt itself tells its implementer to propose exact DTO shapes and get sign-off before building. Once Slice A/C's controllers and DTOs actually exist, read them and match field names exactly, the same discipline the backend prompt used against its own services. Don't guess a shape and ship it if the real one is one property-name away.

## Design system — read this before writing any JSX

- **CSS custom properties in `src/index.css` are the only source of truth for visual tokens**: `--bg`, `--bg-subtle`, `--surface`, `--text-primary`/`--text-secondary`/`--text-muted`/`--text-dim`, `--primary`/`--primary-hover`/`--primary-muted`, `--accent`/`--accent-muted`, `--border`/`--border-strong`/`--border-accent`, `--danger`/`--danger-muted`, `--r-sm`/`--r-lg`/`--r-xl`/`--r-full` (radii), `--shadow-md`/`--shadow-lg`/`--shadow-green`/`--shadow-gold`, `--font-display` (Cormorant Garamond, for headings/numerals), `--font-body` (Jost, for everything else). Light values live in `:root`; dark overrides live under `.dark`, toggled by `useTheme()` (`src/hooks/useTheme.ts`) via a class on `<html>` — never hardcode a hex color.
- **Tailwind is installed but not the primary styling mechanism.** `index.css` does `@import "tailwindcss"` and defines `@custom-variant dark`, but the actual pages style almost everything via inline `style={{...}}` objects referencing the CSS vars above, or via page-scoped `<style>{`...`}</style>` blocks (next point). Don't write Tailwind-utility-class-heavy JSX for new UI — it'll look and behave inconsistently with every existing page. Match the inline-style/scoped-class convention that's already there.
- **Every major page owns a `<style>` block with its own short class prefix**, written near the bottom of the component's JSX: `cds-` (`CustomerDashboardPage.tsx`), `adm-` (`AdminDashboardPage.tsx`), `bk-` (`BookingPage.tsx`), `rnt-`/`mnu-`/`pkg-` (Rentals/Menu/Package pages). Within a prefix you'll find a consistent little vocabulary — `-card`, `-btn` (with `primary`/`outline`/`soft`/`dangerghost` modifier classes), `-input`, `-overlay`/`-modal`/`-modal-head`/`-modal-body`/`-modal-close`, `-table`, `-tag`, `-glyph`/`-avatar`, `-bar` (progress), `-row`, plus a `fadeUp`/`scaleIn` keyframe pair and `.fade-up` entrance class that's (yes) redefined per file rather than shared — that's an existing duplication, not a bug for you to consolidate unless asked. For new UI: if you're extending an existing page, reuse its prefix's classes; if it's a genuinely new page/component, pick a new short prefix and follow the same shape (card/btn/input/modal primitives) rather than inventing a different structure.
- **Icons**: `lucide-react` only — check the import block at the top of `CustomerDashboardPage.tsx` for names already pulled in (it already imports `MessageSquare`, `CreditCard`, `LayoutDashboard`, etc.) before adding a new one.
- **Animation**: `framer-motion` is used almost nowhere outside `LandingPage.tsx`'s center-focus slider; dashboard-style pages rely on plain CSS `@keyframes`/transitions instead. Match whichever page you're touching, don't introduce framer-motion into the dashboards.
- **Currency**: reuse the existing formatter — `const fmt = (n: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n)` (defined near the top of `CustomerDashboardPage.tsx`). Don't re-implement PHP formatting.

## Auth, data-fetching, and shared UI conventions

- `useAuth()` (`src/hooks/useAuth.ts` / `src/context/AuthContext.tsx`) — current user + `logout()`.
- `readSession()` (`src/lib/tokenStorage.ts`) returns `{ token, user } | null` straight from Web Storage; every page's data-fetch effect starts by calling this and bailing to a "you're signed out" state if it's null — copy `CustomerDashboardPage.fetchDashboard`'s shape.
- API clients live one-per-controller-area under `src/api/*.ts` (`bookingApi.ts`, `menuAdminApi.ts`, `rentalAdminApi.ts`, …). Each exports: an internal `request<T>(path, method, token, body?)` helper that attaches `Authorization: Bearer {token}`, throws a typed `{Area}ApiError` (with `status` and an `isAuthError` getter for 401/403) on failure, and parses backend errors via a `readErrorMessage` helper that checks both `{ message }` (the shape every `BookingRuleException` catch block returns) and ASP.NET's `{ errors: { field: [msg] } }` ModelState shape — copy this exact helper rather than writing a new error-parsing path. Then one exported function per endpoint, with request/response TypeScript interfaces whose field names mirror the backend DTOs exactly (see `BookingResponse` vs `BookingResponseDto` in `bookingApi.ts` for the level of fidelity expected).
- `useToasts()` + `<ToastViewport />` (`src/components/ui/Toasts.tsx`) is the one notification surface in the app — call `notify('success' | 'error' | 'info', message)`; don't add a second toast/alert mechanism.
- Routing: centralized in `src/routes/AppRoutes.tsx`; role-gating via `<ProtectedRoute allow={['customer']} />` or `['admin']` (`src/routes/ProtectedRoute.tsx`); dashboard landing paths in `src/routes/paths.ts`.

## THE GOLDEN RULE, for the frontend

The backend prompt's rule was "the AI proposes, the backend validates and prices." The frontend corollary: **the UI never computes or re-derives an authoritative number.** Every price, subtotal, tax, total, or "X in stock" figure shown on screen must be exactly what the relevant JSON response contained — format it, lay it out, but don't sum line items client-side "for a nicer running total" or infer availability from a quantity you already have cached. This matters most for two places: Slice A's proposal cards (render `subtotal`/`tax`/`total`/`remainingBudget` as returned, not recomputed) and Slice C's assistant replies (if the model's structured proposal payload came from the same validated Slice A engine, render it with the same component and the same rule — never let the chat surface show a number the backend didn't send).

## What to build

Build in the same order as the backend slices. Each piece should be independently testable against a running backend that has that slice implemented.

### Slice A UI — "Plan by Budget"

- **Entry point — confirm before building.** Two integration points already exist and either (or both) could host this:
  1. `CustomerDashboardPage.tsx`'s Overview tab already lays out `cds-card` CTAs (e.g. the "Go to Payments →" card) — a "Plan a budget-friendly event" card could sit alongside them, plus a new item in `NAV_ITEMS` (the sidebar currently has Overview / My Bookings / Payments / Messages).
  2. `BookingPage.tsx` is already a multi-step wizard with a pipeline indicator (`.bk-pipeline`, mirroring `CustomerDashboardPage`'s `.cds-pipeline`) that ends by calling `createBooking` and the `Add*Async`-backed endpoints directly — a budget-first path could be a new entry mode into that same wizard, pre-filled from a chosen proposal via `/api/suggestions/materialize`, rather than a wholly separate page.
  State a recommendation between "new dashboard page/modal" vs. "alternate wizard entry" and wait for sign-off — this is exactly the kind of fork the backend prompt asks its implementer to confirm before building, hold the frontend to the same bar.
- New `src/api/suggestionsApi.ts` following the `bookingApi.ts` conventions exactly: `SuggestionsApiError`, the shared `request<T>` pattern, and typed interfaces for the tiered-proposal response once Slice A's backend DTOs are real.
- A reusable proposal/tier card component (Essential/Balanced/Premium): rationale text, itemized lines (type, name, quantity, unit price, line total), `foodCoverageForGuests`, `subtotal`/`tax`/`total`/`remainingBudget` — all formatted with `fmt()`, all values taken as-is from the response. Style it as a `-card` variant consistent with whichever prefix owns the page it lives on.
- A "Use this plan" action per tier calling `/api/suggestions/materialize`, then routing to the resulting Draft booking using the existing booking-detail view (`BookingDetailModal` in `CustomerDashboardPage.tsx`, or wherever the wizard lands post-create).

### Slice B UI — notifications: likely nothing to build, confirm scope first

The backend's Slice B is email-only — there is no read endpoint for a customer or admin to see notification history inside the app. If you want in-app visibility (an admin "Notifications" tab surfacing overdue-payment/low-stock alerts, or a customer-side badge), that requires a new backend read endpoint that doesn't exist in the current backend prompt. **Flag this explicitly and confirm scope before building any UI for it.** If it's out of scope for now, skip this slice entirely — don't invent a page for data that has no endpoint.

### Slice C UI — assistant chat

- `CustomerDashboardPage.tsx`'s **Messages tab is already built and only disabled** — search for `tab === 'messages'` (around line 1739). It has a header with a `cds-glyph` "KJ" mark, a bubble list (`.cds-bubble.me` / `.cds-bubble.admin`, currently mapped from a hardcoded empty array), and a `disabled` `cds-input` + `disabled` "Send" `cds-btn primary`. This is a "wire it up," not a "design it" task: replace the empty array with real conversation state driven by `POST /api/assistant/chat`, remove the `disabled` attributes, and reuse the existing bubble markup and copy style as-is.
- New `src/api/assistantApi.ts`, same conventions as above (`AssistantApiError`, `request<T>`, typed `ChatRequest`/`ChatResponse` once Slice C's DTOs exist, including whatever shape a structured proposal payload takes inside a reply).
- When a reply carries a structured proposal, render it with the **same** tier/proposal card built for Slice A — don't build a second, chat-specific renderer for the same data.
- Backend 503 (`Ai:Enabled=false`, unreachable, or exhausted Gemini free-tier quota after retry) should render inline in the Messages panel pointing the customer at the Slice A budget flow, plus `notify('info', ...)`.
- `components/landing/ChatWidget.tsx` is a **separate**, fully static marketing teaser for logged-out visitors on the public landing page (`/#availability` link, no backend calls at all). Leave it alone — wiring it to the real assistant would mean handling anonymous, non-Customer-JWT users, and Slice C's backend tools are `[Authorize(Roles = "Customer")]` only. Out of scope unless the user asks for anonymous-assistant support specifically (which would also mean revisiting the backend auth model).

### Slice D UI — proactive nudges

Depends entirely on how the backend's Slice D "opens a conversation." If it just seeds a `Conversation` row the customer sees the next time they open Messages, no new UI is needed beyond Slice C's. If it's meant to interrupt live — a toast or badge while the customer is elsewhere in the dashboard — that needs either polling or a SignalR push. Note `CustomerDashboardPage.tsx` already runs one `@microsoft/signalr` connection (`HubConnectionBuilder` → `/hubs/payment`, listening for `"PaymentUpdated"`) to live-refresh payment state; a notification push should follow that exact pattern (new hub method or a new event on `PaymentHub`) rather than introducing a different real-time mechanism like polling. Confirm which behavior is wanted before building.

## Constraints and working style

- **Confirm before you build** — same discipline as the backend prompt. The Slice A entry-point fork and the Slice B/D scope questions above are not yours to silently resolve.
- **Match conventions exactly**: `src/api/{area}Api.ts` for clients, PascalCase files under `src/pages` or `src/components/{area}`, camelCase under `src/hooks`.
- Don't "fix" `ChatWidget.tsx`'s static behavior, the `FontEnd` folder name, or the per-page duplicated `fadeUp`/`.cds-btn`-style class blocks — all look like they could be cleaned up, none of them are in scope here.
- Read `src/pages/CustomerDashboardPage.tsx` in full first (it's the anchor for both Slice A and Slice C UI), then `src/api/bookingApi.ts` for the API-client pattern, and `src/index.css` for the full token set, before writing anything.
- This assumes the corresponding backend slice (from `KingJegi_build_prompt.md`) is implemented, or being implemented alongside — there's nothing to wire up against a slice whose endpoints don't exist yet.

Start with Slice A. Propose the entry-point decision (dashboard card + nav item vs. wizard alternate entry) and the exact `suggestionsApi.ts` interface shapes against whatever the real `/api/suggestions/budget` response looks like, then wait for approval before writing components.
