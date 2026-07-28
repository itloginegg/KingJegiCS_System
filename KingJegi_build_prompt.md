# Build prompt — KingJegi: budget customization, notifications, virtual assistant (Gemini)

Paste this into Claude Code (or a fresh Claude session with the repo attached).

## Context

You are working on **KingJegi**, an existing ASP.NET Core Web API (**.NET 10**, EF Core 10 code-first, SQL Server) backing a catering booking and management system for a business in Laguna, Philippines. Root namespace `System_ApiTest.*` — folders/namespaces are `.Models`, `.Data`, `.Services`, `.Controllers`, `.DTOs` (note: `DTOs`, not `Dtos`). Currency is PHP. Backend project path: `BackEnd/System_ApiTest`.

The backend is mature and working. **Do not redesign it.** Read the existing code before writing anything, and reuse it rather than duplicating logic. Note that service class names in this codebase are **inconsistent on purpose** — don't "fix" them, just match them exactly: `Bookingservice`, `Packageservice`, `Invoiceservice`, `Paymentservice`, `Rentalservice`, `Menutrayservice`, `Systemsettingsservice`, `Auditlogservice`, `Tokendenylistservice` are lowercase-suffix; `EmailService`, `OtpService`, `JwtTokenService`, `PayMongoservice` are the odd ones out. All are registered as scoped services in `Program.cs`.

## Relevant existing pieces you must build on

**Entities** (`Models/`):
- `Booking` — `BookingType` (FullService/FoodDelivery), `Status` (Draft/Pending/Confirmed/Cancelled/Completed), `DepositStatus` (Unpaid/Reserved/Partial/Paid — derived, never set by hand), `TotalAmount` (computed, frozen at Submit), `EventDate`/`StartTime`/`EndDate`/`EndTime`, `EventType`, `VenueAddress`, `ContactNumber`, `GuestCount` (null for delivery), `MenuPackageId`, `CustomerId`, `CalendarDay`, collections `Rentals`/`Services`/`MenuItems` (`BookingMenuItem`)/`MenuTrays` (`BookingMenuTray`)/`History` (`Bookinghistory`)/`PackageSelections` (`Bookingpackageselection`), plus `CancellationRequested`/`CancellationRequestedAt`/`CancellationRequestReason`, and `Invoice`.
- `Menupackage` — `BasePrice`, `MinPax`/`MaxPax`, `PricePerExtraPax`, `Inclusions` (`List<string>`, JSON-converted), `Items`, `Slots` (`Menupackageslot`, each with `ChooseCount`, `AllowedCategories` of `SlotCategory`), `FixedItems` (`Menupackagefixeditem`). Has `ComputeCost(guestCount)`: flat `BasePrice` within `[MinPax, MaxPax]`, `+ (guests - MaxPax) * PricePerExtraPax` above; throws below `MinPax`.
- `Menuitem` — `ItemCategory`, `CourseCategory`, `PricePerTray` (nullable — null means package-only, no standalone price), `ServesPerTray` (default 10), `MenuPackageId` (nullable), `IsActive`, `DietaryTags`.
- `Menutray` — `TrayName`, `PricePerTray` (flat), `ServesMin`/`ServesMax` (informational), `IsActive`, exactly 4 `Dishes` (`MenuTrayDish` join to `Menuitem`).
- `Rentalitem` — `Category`, `TotalQuantity` (owned units), `UnitPrice`, `IsActive`. Availability is **never stored** — always derived via `Rentalservice.GetAvailabilityAsync`.
- `Serviceitem` — `ServiceName` (free text, not the vestigial `Service.ServiceName` enum), `UnitCost`, `IsActive`.
- `Invoice` — one per Booking, `FoodTotal`/`RentalTotal`/`ServiceTotal`/`TaxAmount`/`GrandTotal`, `Status` (Draft/Sent/Reserved/PartiallyPaid/Overdue/Paid/Cancelled).
- `Payment` — `AmountPaid`, `Method`, `Status` (Pending/Success/Failed/PartiallyRefunded/Refunded), refund + gateway fields.
- `Systemsettings` (singleton, fetched via `Systemsettingsservice.GetAsync()` — **throws if the row doesn't exist**, no silent default): `TaxRate` (0.12), `DepositPercentage` (0.50), `ReservationFee` (₱5,000), `EventBufferHours` (3), `MinLeadDaysFullService` (3), `MinLeadDaysDelivery` (1), `DefaultMaxCapacity` (3).
- `Customer` — `FullName`, `Email`, `IsActive`, `IsEmailVerified`, `Bookings`. `Admin` — `Role` (Owner/Assistant).
- `Bookinghistory` — append-only revision snapshots, written automatically by `Bookingservice` on every mutating call.

**Services** (`Services/`):
- `Bookingservice` — `CreateAsync(...)`, `RecomputeTotalAsync`, `SubmitAsync` (Draft→Pending, freezes total, issues invoice), `ConfirmBookingAsync`, `TryAutoConfirmOnReservationAsync`, `CancelBookingAsync`, `RequestCancellationAsync`, `CompleteBookingAsync`, `UpdateAsync`, `AddServiceAsync`, `AddMenuItemAsync` (quantity optional on FullService → defaults to `ceil(guestCount / item.ServesPerTray)`), `AddMenuTrayAsync` (defaults to `ceil(guestCount / tray.ServesMin)`), `EnsureEditableAsync` (Draft only), `EnsureNotDeliveryAsync`, `EnsureDateStillAvailableAsync`, `WriteHistorySnapshotAsync`. **Note: `Bookingservice` has no `AddRentalAsync` — that lives on `Rentalservice`** (see below), which itself depends on `Bookingservice`.
- `Rentalservice` — `GetAvailabilityAsync(rentalItemId)` → `RentalAvailability(Total, Outgoing, Available)`; `AddRentalAsync(bookingId, rentalItemId, quantity)` (row-locks the catalog item, checks stock, adds the line, then calls back into `Bookingservice.RecomputeTotalAsync`).
- `Packageservice` — `BuildTemplateAsync(packageId)` (package + eligible items per slot), `SetSlotSelectionAsync`, `EnsurePackageSelectionsCompleteAsync` (submit-time gate).
- `Invoiceservice` — `GenerateAsync`, `GetPaymentScheduleAsync(bookingId, today)` → `PaymentScheduleDto` with milestone list, `RefreshStatusAsync`, `GetPaidTotalAsync`, `EnsureChargesEditableAsync`.
- `Paymentservice` — `RecordAsync`, `StartCheckoutAsync` (PayMongo), `MarkSuccessAsync` (auto-confirms via `Bookingservice.TryAutoConfirmOnReservationAsync` once the reservation fee is met), `RefundAsync`, `ApplyGatewayPaidAsync`/`ApplyGatewayFailedAsync` (webhook), broadcasts via `IHubContext<PaymentHub>`.
- `EmailService` — MailKit/Gmail SMTP, already working. `SendAsync(toEmail, subject, bodyText)`. Throws `EmailSendException` if unconfigured or the send fails — **callers must catch this**, don't let it bubble. Configured via `EmailOptions` (`IOptions<EmailOptions>`, section `"Email"`, `IsConfigured` flag) bound in `Program.cs` from user-secrets.
- `OtpService`, `Auditlogservice`, `Systemsettingsservice`, `Tokendenylistservice`, `Menutrayservice`, `PayMongoservice` — existing, reuse patterns from these, don't touch them.

**Options pattern to copy** (see `OtpOptions` in `Services/Otpservice.cs`): a small class with `public const string SectionName = "..."`, bound via `builder.Services.Configure<XOptions>(builder.Configuration.GetSection(XOptions.SectionName))`, injected as `IOptions<XOptions>`.

**Typed external HTTP client pattern to copy** (see `PayMongoservice`): register with `builder.Services.AddHttpClient<PayMongoservice>();` and inject `HttpClient` via constructor — do the same for the Gemini client in Slice C rather than `IHttpClientFactory.CreateClient("name")`, to match house style.

**Worker pattern to copy** (`Workers/DenylistCleanupWorker.cs`): a `BackgroundService` holding `IServiceScopeFactory` + `ILogger<T>`, a `PeriodicTimer`, scoped-service resolution per tick inside `using var scope = _scopeFactory.CreateScope()`, a try/catch around each tick body so failures never crash the app (only `OperationCanceledException` on shutdown propagates), registered via `builder.Services.AddHostedService<T>()`. Note this worker **already** purges both the token denylist and stale OTPs each run — it is not solely about denylists despite the name. Your new `NotificationWorker` is a **separate** hosted service, don't fold into this one.

**Auth pattern** (`Controllers/BookingsController.cs`): `[Authorize]` at the controller level, `[Authorize(Roles = "Owner,Assistant")]` per-action for admin-only endpoints. JWT roles issued are exactly `"Customer"`, `"Owner"`, `"Assistant"` (see `CustomersController`/`AdminsController`, `JwtTokenService.Generate`). Current user id comes from the `sub` claim:
```csharp
private Guid? CurrentUserId() =>
    Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                  ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");
```
For a `Customer`-scoped token, `CurrentUserId()` **is** the `Customer.Id` — no separate lookup needed.

**Error handling pattern**: `BookingRuleException` (defined in `Services/Bookingservice.cs`, namespace `System_ApiTest.Services`) is the one business-rule exception type. Controllers catch it and return `BadRequest(new { message = ex.Message })` — copy this exact shape, don't introduce a new error envelope.

**Business rules that must not be violated**: bookings are only editable while Draft (`EnsureEditableAsync`); totals freeze at Submit when the invoice is issued (`SubmitAsync` → `Invoiceservice.GenerateAsync`); confirmation takes a row lock on the calendar day (`WITH (UPDLOCK, HOLDLOCK)`) and validates time-slot conflicts (buffer-expanded) and rental stock; rental stock deducts at confirm and returns at cancel (never stored, always derived); the ₱5,000 `ReservationFee` auto-confirms a full-service booking once verified payments reach it; `MinLeadDaysFullService`/`MinLeadDaysDelivery` gate new booking dates; a `FoodDelivery` booking can only carry menu items/trays (no package, no rentals, no services — enforced by `EnsureNotDeliveryAsync`).

## THE GOLDEN RULE (non-negotiable)

**The AI proposes; the backend validates and prices.**

An LLM must never produce an authoritative price, total, or availability answer. Every AI-proposed line item is re-looked-up in the database by ID, re-priced from the database (`Menuitem.PricePerTray`, `Menutray.PricePerTray`, `Rentalitem.UnitPrice`, `Serviceitem.UnitCost`, `Menupackage.ComputeCost(guestCount)`), and re-validated (active? in stock via `Rentalservice.GetAvailabilityAsync`? within budget after honest repricing?) before it is shown to a user or written anywhere. Any proposed ID that doesn't exist, is inactive, or fails validation is dropped or repaired — and a proposal that exceeds the budget after repricing is discarded.

Nothing the AI returns is ever written directly to the database. AI output becomes a proposal; the customer accepts it; the acceptance flows through the existing `Bookingservice`/`Rentalservice` methods with all their existing guards.

## What to build — four slices

Build them in order. Each must compile, be independently testable, and leave the system in a working state. Stop after each slice and report what to test.

### Slice A — Budget-based customization engine (no AI)

Deterministic proposal generator. This is the foundation everything else calls.

- `POST /api/suggestions/budget` (new `SuggestionsController`, `[Authorize(Roles = "Customer")]`) — body: `{ budget, guestCount, eventDate, eventType, bookingType, preferences? }`. Returns 2–3 tiered proposals (e.g. Essential / Balanced / Premium) that each fit within budget.
- Each proposal is an itemized configuration: optional `Menupackage` (priced via `ComputeCost(guestCount)`), standalone `Menuitem`s, `Menutray`s, `Serviceitem`s, `Rentalitem`s — quantities derived from `guestCount` using `ServesPerTray` (menu items) and `ServesMin` (trays), i.e. `ceil(guestCount / serves)` — the exact formula `Bookingservice.AddMenuItemAsync`/`AddMenuTrayAsync` already use for their default-quantity path. Reuse that math (factor it out to a shared static helper if needed, don't hand-roll a second copy).
- Include per-proposal: line details (type, id, name, quantity, unit price, line total), `foodCoverageForGuests`, `subtotal`, `tax` (`SystemSettings.TaxRate`), `total`, `remainingBudget`, and a short plain-language `rationale` string (templated, not AI-written, at this stage).
- Allocation strategy: food coverage for the full guest count is the hard requirement; spend remaining budget on services/rentals by tier. Never propose `IsActive == false` catalog entries. Respect real rental availability (`Rentalservice.GetAvailabilityAsync`, not `Rentalitem.TotalQuantity` alone).
- `FoodDelivery` bookings never get packages/rentals/services in a proposal — same constraint as `EnsureNotDeliveryAsync`.
- `POST /api/suggestions/materialize` — body: a chosen proposal (or a proposal id if you cache the last-generated set server-side; state your recommendation before building). Creates a Draft booking for the authenticated customer by calling `Bookingservice.CreateAsync`, then `Bookingservice.AddMenuItemAsync`/`AddMenuTrayAsync`/`AddServiceAsync` and **`Rentalservice.AddRentalAsync`** (not `Bookingservice` — it doesn't have that method) for each line, and `Packageservice.SetSlotSelectionAsync` for any package slot choices. Do not insert rows directly. All existing guards (lead time, per-type field rules, stock, package `MinPax`) apply unchanged and may cause a re-validated line to be dropped or the whole materialize call to fail with the same `BookingRuleException` → 400 shape.
- Suggestions are stateless — nothing is persisted until materialize is called.
- No migration.

### Slice B — Notification worker (no AI)

Proactive email notifications for state the system already computes.

- New `Workers/NotificationWorker.cs : BackgroundService` (copy `DenylistCleanupWorker`'s structure exactly: `PeriodicTimer`, scoped resolution per run via `IServiceScopeFactory`, try/catch so failures never crash the app, graceful `OperationCanceledException` on shutdown).
- Runs on a configurable interval (default: every 6 hours).
- Sends via the existing `EmailService.SendAsync` — **wrap every call in try/catch for `EmailSendException`**, since it throws rather than returning a bool. Triggers:
  - Payment milestone due within N days (read from `Invoiceservice.GetPaymentScheduleAsync(bookingId, today)`, checking each `PaymentMilestoneDto`'s `Due`/`Status`) — reminder to `booking.Customer.Email`.
  - Payment milestone overdue (`Status == "Overdue"`) — reminder to customer, digest to owner.
  - Booking confirmed / cancelled (`Booking.Status`) — confirmation to customer.
  - Rental stock at or below a threshold (`Rentalservice.GetAvailabilityAsync` per active `Rentalitem`) — alert to owner.
- Idempotency is required: add a `SentNotification` entity (`Models/Sentnotification.cs`, matching the lowercase-suffix class-naming convention used elsewhere for non-DTO models where relevant — confirm naming with the user before generating the migration) with `BookingId`, `Kind`, `SentAt`, and a unique index on (booking, kind, period) so a reminder is never sent twice for the same milestone. This is the **only** migration in this slice — generate it with `dotnet ef migrations add AddSentNotification` from `BackEnd/System_ApiTest`.
- Config section `Notifications` (new `NotificationOptions`, same pattern as `OtpOptions`): `Enabled` (default true), `IntervalHours`, `DueSoonDays`, `LowStockThreshold`. Must run harmlessly with email unconfigured (log, don't throw — the worker's outer try/catch already gives you this if you don't rethrow).

### Slice C — Virtual assistant (Google Gemini API, conversational)

A multi-turn assistant that can use the system, not just describe it.

- New `Services/Assistantservice.cs` calling the Gemini API's `generateContent` endpoint (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, key passed as `x-goog-api-key` header rather than a query string so it never lands in logs) via a typed `HttpClient` (`builder.Services.AddHttpClient<Assistantservice>();`, matching the `PayMongoservice` pattern). Config section `Ai` (`AiOptions`, same `OtpOptions`-style pattern): `ApiKey` (user-secrets only, never `appsettings.json`), `Model` (default something on the free tier, e.g. `gemini-3-flash` or `gemini-2.5-flash-lite` — Pro-tier models were pulled from Gemini's free tier in April 2026, so pin to a Flash model), `MaxOutputTokens`, `Enabled`.
- Gemini's wire format differs from a typical `messages`-array API — build `Assistantservice` around it directly rather than adapting Anthropic-shaped code:
  - Conversation turns go in a top-level `contents` array of `{ role: "user" | "model", parts: [...] }` (no `"assistant"` role — it's `"model"`).
  - The system prompt is a separate top-level `systemInstruction: { parts: [{ text: "..." }] }`, not a chat turn.
  - Tools are declared as `tools: [{ functionDeclarations: [...] }]`, each with a JSON-schema `parameters` object — comparable to Anthropic's `input_schema` but under a different key.
  - A model-requested tool call arrives as a `functionCall` part (`{ name, args }`); you execute it server-side and reply with a new turn containing a `functionResponse` part (`{ name, response }`) — there's no separate `tool_use_id` to thread through like Anthropic's protocol, matching is positional/by name within the turn.
- `POST /api/assistant/chat` (new `AssistantController`, `[Authorize(Roles = "Customer")]`) — body: `{ conversationId?, message }`. Returns the assistant's reply plus any structured proposals it produced. Multi-turn: persist conversation history (new `Conversation` + `ConversationMessage` entities, scoped to `CurrentUserId()`) so follow-ups like "make it cheaper" work — store your own normalized turn history, not raw Gemini `contents`, so a future provider swap doesn't require a data migration.
- Tool-calling is the core requirement. Expose these backend capabilities as tools the model may call, and execute them server-side:
  - `check_date_availability(date, bookingType)` → uses `Bookingservice.EnsureDateStillAvailableAsync`-equivalent read logic plus the `MinLeadDaysFullService`/`MinLeadDaysDelivery` check from `CreateAsync`.
  - `suggest_within_budget(budget, guestCount, eventDate, eventType, bookingType, preferences)` → calls Slice A's engine directly (in-process call to the same service, not an HTTP round-trip) and returns validated proposals.
  - `get_catalog_summary(category?)` → active `Menupackage`/`Menuitem`/`Menutray`/`Serviceitem`/`Rentalitem` with real prices (`IsActive == true` only).
  - `get_my_bookings()` / `get_payment_schedule(bookingId)` → read-only, scoped to `CurrentUserId()` only — verify `booking.CustomerId == CurrentUserId()` before returning anything, same as `BookingsController.GetById`. Tools are read/propose only. **There is no tool that writes a booking or moves money** — materializing a Draft is an explicit customer action through Slice A's `/api/suggestions/materialize` endpoint.
- System prompt (`systemInstruction`) must state: use only catalog data returned by tools; never invent prices, items, or availability; amounts in PHP; be concise; when proposing, always end by telling the customer they can review and confirm the Draft.
- Graceful degradation: if `Ai:Enabled` is false, the API is unreachable, or Gemini returns a 429 (free-tier throttling — expect this under load, since the free tier caps out around 15–30 requests/minute and roughly 1,000–1,500/day depending on model), return a clear 503 telling the customer to use the budget form (Slice A) instead. The assistant is never a hard dependency. Add simple retry-with-backoff (one retry, short delay) before falling back to the 503, since a single 429 shouldn't fail a request outright.
- Rate-limit per user (e.g. 20 messages/hour) — an in-memory counter is fine for now given there's no existing rate-limiting infrastructure in this codebase; state your recommendation before building. Keep this well under Gemini's own free-tier per-project caps so one busy user can't 429 everyone else.
- Note for whoever owns the Google Cloud project: enabling billing on it removes the Gemini free tier entirely for that project, including calls that would've fit inside the free quota — keep billing off if the intent is to stay on the free tier.

### Slice D — Proactive assistant nudges

- Extend Slice B's `NotificationWorker` so notification events can open an assistant conversation ("Your 50% payment is due in 3 days — want me to pull up your payment schedule?") rather than only sending flat email.
- Keep it opt-in via config (`Notifications:ProactiveAssistant`) and reuse Slice C's conversation storage.

## Constraints and working style

- **Confirm before you build.** For any decision fork (schema shape, endpoint contract, tier definitions, proposal caching strategy, `SentNotification` naming), state your recommendation and ask before writing code. Do not silently pick.
- **Reuse, don't duplicate.** Pricing must come from existing computation paths (`Menupackage.ComputeCost`, `BookingMenuItem.LineTotal`, `Rental.Subtotal`, `Service.TotalCost`). Booking creation must go through `Bookingservice`/`Rentalservice`/`Packageservice`. Email must go through `EmailService`.
- **Migrations:** only where stated (Slice B's `SentNotification`, Slice C's conversation entities). Call out every migration explicitly with the exact `dotnet ef migrations add <Name>` command, and warn about any column that needs backfilling on existing rows (there shouldn't be any here since both are new tables, but say so explicitly).
- **Secrets go in user-secrets** (`dotnet user-secrets set "Ai:ApiKey" "..."` from `BackEnd/System_ApiTest`), never in `appsettings.json` or source — follow the existing `Email`/`JwtSettings`/PayMongo pattern.
- After each slice, list: files added/changed, `Program.cs` registrations needed, migrations to run, and a concrete test sequence (endpoints, sample bodies, expected results).
- Match the existing code style: XML doc comments on public service methods explaining *why*, `BookingRuleException` for business-rule failures mapped to 400s in controllers (`catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }`), DTOs as `record`s for responses and classes with data-annotation validation for requests (see `DTOs/Rentalitemdtos.cs`, `DTOs/Menuitemdtos.cs` for the exact shape), enums serialized as strings via `JsonStringEnumConverter` (already configured globally in `Program.cs`).

Start with Slice A. Read `Services/Bookingservice.cs`, `Services/Rentalservice.cs`, `Services/Packageservice.cs`, and `Services/Invoiceservice.cs` in full, then propose your Slice A design (endpoint contracts, tier allocation strategy, DTO shapes, whether `/materialize` takes the full proposal payload or a cached proposal id) and wait for approval before implementing.
