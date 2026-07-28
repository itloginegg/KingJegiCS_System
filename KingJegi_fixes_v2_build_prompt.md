# Fix prompt v2 — KingJegi: guest browsing, Plan-by-Budget relocation, chat/assistant expansion, admin walk-ins, food delivery cart, rental bug

Paste this into Claude Code (or a fresh Claude session with the repo attached). This supersedes items 1–4 of `KingJegi_fixes_build_prompt.md` where they overlap (Plan-by-Budget parity, the assistant widget, the food-delivery move, the rental bug) — same underlying bugs, revised and expanded scope, verified against the current repo. It builds on `KingJegi_build_prompt.md` (backend Slices A–D, implemented) and `KingJegi_frontend_ui_build_prompt.md` (implemented).

## One cross-cutting decision, up front

Three of the six items below (1, 2, 5) converge on the same shape: **browse and get suggestions without an account; log in only the moment something would actually be created.** Recommend adopting this as a single rule rather than deciding it three separate times:
- Catalog reads (packages, menu items, menu trays, rental items) and budget suggestions (`POST /api/suggestions/budget`) become anonymous-accessible.
- Anything that writes — `createBooking`, `materializeProposal`, `submitBooking`, checkout, payments, cancellations — stays behind login exactly as it is today, because a `Booking` always needs a real `Customer.Id`.

Confirm this framing before touching any `[Authorize]` attribute — it's a real change to the app's security surface (public unauthenticated access to the full catalog and its prices), even though none of that data is sensitive.

## 1. Guest browsing

**Verified current state:** `MenuPage.tsx`, `PackagePage.tsx`, `RentalsPage.tsx`, and `LandingPage.tsx` have no auth checks today — they already render for guests (they're static/mock-data pages, which is a separate problem addressed in item 5). The actual blocker is `BookingPage.tsx`: its catalog-fetch step explicitly requires a session (`readSession()` check, ~line 138–139: `if (!session) { setCatalogError('Please sign in to continue.'); return; }`) before it will even show packages/menu items/rentals/services to browse. Underneath that, the backend controllers it calls — `MenuitemsController`, `MenutraysController`, `MenupackagesController`, `RentalitemsController` — are all `[Authorize]` at the controller level (any authenticated role, not admin-only, but still not anonymous), so relaxing only the frontend check would just trade one error message for 401s.

**Fix:**
- Backend: make the `GET` actions on those four controllers anonymous-accessible. Simplest path is `[AllowAnonymous]` on the specific `[HttpGet]` actions (the controller-level `[Authorize]` stays for the write actions, which are already further restricted to `Owner,Assistant`). Confirm this is the intended shape before changing it — an alternative is a parallel set of public endpoints if you'd rather not touch the existing ones at all.
- Frontend: remove `BookingPage.tsx`'s "please sign in to continue" gate on the catalog fetch; keep the existing `readSession()`/`!user` check exactly where it already is, at `handleCreateBooking` (~line 267–268), since that's the point a real booking gets created.

## 2. "Plan by Budget" relocation + parity

**Relocate:** remove the `'plan'` tab and its `NAV_ITEMS` entry from `CustomerDashboardPage.tsx`, and add "Plan by Budget" as a new card in `BookingPage.tsx`'s Step-0 service picker, alongside `'event'` and `'rentals'` (`'menu'` is being removed per item 5, so the picker ends up with three real cards). The component logic itself — budget form → `getBudgetSuggestions` → the `ProposalCard` grid → the finalize-details modal → `materializeProposal` — is already fully built as `PlanByBudgetTab` in `CustomerDashboardPage.tsx` (roughly lines 679–957 today); this is a move into `BookingPage.tsx`'s flow, not a rewrite.

**Guest access to this flow — depends on item 1's decision.** `SuggestionsController` is currently `[Authorize(Roles = "Customer")]` on both actions, and `Suggestionservice.GenerateAsync` starts with `_db.Customers.FindAsync(customerId) ?? throw new BookingRuleException("Customer not found.")` — a check that has no meaning for an anonymous visitor. Recommend: allow anonymous access to `POST /api/suggestions/budget` specifically, skipping the customer-lookup when there's no authenticated caller (the computation itself doesn't need a real customer — it's stateless pricing against the catalog). Keep `POST /api/suggestions/materialize` exactly as `[Authorize(Roles = "Customer")]` — it creates a real booking, so it always needs a real customer. Confirm this split before changing `SuggestionsController`.

**Booking parity — same root cause identified before, still unresolved in the current repo.** `Suggestionservice.MaterializeAsync` only ever creates a Draft (by design — this is correct behavior, not the bug), but nothing in the frontend calls `submitBooking` afterward, and `BookingDetailModal` has no Submit action for any Draft booking regardless of origin. Fix: add a "Submit Booking" action calling the existing `submitBooking()` client function — recommend putting it on `BookingDetailModal` whenever `booking.status === 'Draft'` (fixes every Draft-origin booking, not just this one) rather than auto-submitting silently right after materialize, which would remove a review step the customer currently gets in the standard wizard. Confirm placement before building.

## 3. Messaging: remove Messages tab, global assistant widget, peer-to-peer + admin chat

**Remove the Messages tab:** retire `MessagesTab` and the `'messages'` entry in `CustomerDashboardPage.tsx`'s `NAV_ITEMS`/`Tab` type, same as scoped previously.

**Persistent virtual-assistant widget:** move `MessagesTab`'s real wiring (`sendChat`/`listConversations`/`getConversation` from `api/assistantApi.ts`, plus `ProposalCard` rendering for any returned proposal) into `components/landing/ChatWidget.tsx`, which is already mounted globally (imported by `BookingPage`, `CustomerDashboardPage`, `LandingPage`, `MenuPage`, `PackagePage`, `RentalsPage`) but is still today's static teaser bubble with no backend call. Handle both states: logged out → a lighter teaser or "sign in to chat" prompt (the assistant's tools are `[Authorize(Roles = "Customer")]`-only, there's no anonymous chat path and nothing here proposes adding one); logged in as Customer → the real chat, unchanged `assistantApi.ts`. The animated-avatar and voice-interaction asks from before are unchanged and still need a decision before building: avatar asset approach (Lottie/JSON, CSS/SVG loop, or looping video — nothing in the current stack provides a character), and voice scope (recommend the browser's Web Speech API first — zero new dependencies, feeds straight into the existing `sendChat` call — with a text-only fallback where it's unsupported, notably Firefox and some mobile browsers).

**Peer-to-peer customer chat + admin "Chat Support" — this is new scope, not a UI change, and it doesn't fit anything built so far.** `Models/Conversation.cs` and `Models/Conversationmessage.cs` (Slice C's schema) model a single-customer-owned assistant thread only: `ConversationRole` is `User | Model | Tool`, there is no sender identity distinct from the thread's owning customer, no participants/membership concept, and no admin-authored-message concept at all. There's also no real-time transport to extend beyond `@microsoft/signalr`'s existing `PaymentHub`, which today only broadcasts one event (`"PaymentUpdated"`) to everyone connected — not scoped delivery to specific users. Building this means: a new schema (a thread/participants model distinct from `Conversation`), new endpoints (list threads, send/read scoped to participants), a new or extended SignalR hub for live delivery to specific recipients, and unresolved product/moderation questions that are outside a code-fix's scope to silently answer — can any customer message any other customer, or only ones they share a context with (e.g. co-attendees on the same booking)? Is it moderated? Does the admin "Chat Support" panel see every thread, or only ones flagged for escalation? **Propose a backend design here and get it signed off before writing any widget code for it** — the same discipline the very first prompt in this series used for Slice A. Treat this as its own slice; don't let it block items 2, 4, 5, or 6.

## 4. Admin walk-in bookings

**Good news — the backend already supports the core of this.** `BookingsController.Create` already lets an admin supply an arbitrary `dto.CustomerId` (`var customerId = IsAdmin() ? dto.CustomerId : callerId.Value;`), so creating a booking for any *existing* customer already works through `POST /api/Bookings` with no backend change needed for booking creation itself.

**The actual gaps, verified:**
- No way for an admin to find a customer today: there is no list/search-customers endpoint anywhere in `CustomersController` (it only has `register`, `login`, `login/verify-otp`, `logout`, `deactivate`, `reactivate`), and no frontend API call for one either.
- No lightweight way to register a walk-in who has no account: the only registration path, `POST /api/Customers/register`, requires a Gmail address (`if (!email.EndsWith("@gmail.com"))`) and blocks login until an emailed OTP is verified — both wrong for someone standing at the counter right now.
- `AdminDashboardPage.tsx`'s Bookings tab has no "New Booking" form. Its `'placeholder'` nav entry is a generic unbuilt-feature stub (`placeholderName` state), not reserved for this.

**Fix, in order — confirm (i) and (ii) before building either:**
1. A new admin-only "search/list customers" endpoint (by name/email), so an admin can find an existing walk-in.
2. Whether a walk-in with no account gets a simplified admin-created customer record that deliberately skips the Gmail-only and OTP-verification rules (a real carve-out from existing registration policy — confirm this explicitly, don't assume it), or must always go through normal self-registration first before an admin can book for them.
3. A "New Booking" form/modal in `AdminDashboardPage.tsx`'s Bookings tab collecting the same fields `BookingCreateDto` needs, resolving/creating the customer per (1)/(2), then calling the existing `createBooking` (or a thin admin-specific wrapper around it) — no new booking-creation logic needed beyond this.

## 5. Food delivery → MenuPage cart + checkout

Unchanged in scope from the earlier fixes prompt, still current: `MenuPage.tsx` is explicitly "static content — design reference only, no backend calls" today, with hardcoded numeric-id dishes; it already has a `plan: Record<number, number>` cart-shaped state and a summary bar to build from.

**Fix:** wire in the real catalog (`GET /api/MenuItems`, `GET /api/MenuTrays` — anonymous per item 1's decision, so guests can browse and build a cart); evolve `plan` into a cart keyed by each line's real GUID and type (`MenuItem` vs `MenuTray`); add a checkout step collecting `eventDate` (delivery date), `startTime` (delivery time), `venueAddress` (delivery address), and optional `contactNumber` — matching `BookingCreatePayload` for `bookingType: 'FoodDelivery'` (no package, no end date/time, no event type, no guest count). Checkout itself — `createBooking`, the per-line add calls, then `submitBooking` — requires login, closing the same parity gap as item 2, for this flow too.

Then remove the `'menu'` service-flow entirely from `BookingPage.tsx`: the `pickService('menu')` card, its "Delivery Details"/"Menu & Add-ons" step labels and gated fields, and the `bookingType === 'FoodDelivery'` branch of `handleCreateBooking` that flow drove.

## 6. Rental items UI

Unchanged, still the same verified, reproducible bug: `BookingPage.tsx`'s `'rentals'` service flow sets `bookingType: 'FoodDelivery'` in `handleCreateBooking` (`serviceFlow === 'event' ? 'FullService' : 'FoodDelivery'` — only `'event'` gets `FullService`), but `Rentalservice.AddRentalAsync` → `Bookingservice.EnsureNotDeliveryAsync` rejects any rental line on a `FoodDelivery` booking with `"Food delivery orders can only contain menu items and trays."` — so Step 3 of this flow 400s every time it tries to add a rental.

**Fix:** make `'rentals'` create a `FullService` booking, which means its Step 2 must collect what `CreateAsync` requires for `FullService` — end date, end time, event type, guest count — instead of today's delivery-style date/time/address-only form. Keep the existing `bk-` layout, the flow-picker cards, the pipeline stepper, and the Step-3 rental-selection UI exactly as they look today; this is a data/logic fix, not a redesign.

Do this after (or together with) item 5 — once Food Delivery is out of the wizard, Step 0 is down to a clean set of real flows (`'event'`, `'rentals'`, plus the relocated `'plan'` card from item 2), instead of `'rentals'` having to coexist with a `'menu'` card that maps to the same (wrong, for rentals) booking type.

## Constraints and working style

- **Confirm before you build**, on every fork flagged above: the guest-browsing auth-surface change (item 1), the `SuggestionsController` anonymous/authenticated split (item 2), the peer-to-peer/admin-chat schema and transport design (item 3 — this one especially, given its size), the admin customer-lookup/creation carve-out (item 4), and the avatar/voice scope (item 3).
- **Reuse existing conventions**: the `{Area}ApiError`/`request<T>`/`readErrorMessage` shape across `bookingApi.ts`/`suggestionsApi.ts`/`assistantApi.ts` and any new API client; the CSS-custom-property + scoped-`<style>`-prefix design system (`cds-`, `bk-`, `mnu-`, `adm-`, etc.); `BookingRuleException` → `BadRequest(new { message })` on the backend.
- Report file-by-file changes and a manual test sequence per item, same bar as the earlier prompts.

**Suggested build order, given the dependencies above:** do item 1 first — it unblocks item 2's "survey without an account" requirement and item 5's guest-browsing/cart-building. Item 3's widget-and-avatar half can proceed independently at any point; scope and get sign-off on its peer-to-peer/admin-chat half separately, and don't let its size block items 2, 4, 5, or 6. Do item 5 before item 6. Item 4 is independent of everything else and can be built once its customer-lookup/creation design is confirmed.
