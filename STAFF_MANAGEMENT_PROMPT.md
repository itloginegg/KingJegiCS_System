# Staff Management — Implementation Prompt (phased, approval-gated)

> Paste this whole file into Claude Code at the repo root (`KingJegiCS_System/`).

---

## Your role

You are implementing **Staff Management** for the King Jegi catering system: the
Owner-only admin screen that creates, lists, deactivates and reactivates Assistant
accounts.

The backend already exposes two of these and the frontend calls **neither**. Verified
before this prompt was written:

- `POST /api/Admins/assistants` and `GET /api/Admins` exist in
  `BackEnd/System_ApiTest/Controllers/AdminsController.cs`, both `[Authorize(Roles = "Owner")]`.
- The **only** `/api/Admins` references anywhere in `FontEnd/src` are in `api/authApi.ts`:
  `login`, `login/verify-otp`, `logout`. There is no admins API module and no staff tab.

So both Owner-only endpoints are orphaned. Deactivate/reactivate do not exist yet at all.

---

## Working agreement — read this before touching anything

1. **Work one phase at a time.** After each phase, **stop**, summarise exactly what you
   changed (file + what + why), and wait for my explicit approval before starting the next.
   Do not chain phases. Do not "get ahead" on a later phase because it seemed convenient.
2. **Confirm before every decision fork.** Where this prompt marks a **FORK**, present the
   options with your recommendation and wait. Do not pick silently.
3. **No migration is generated or applied without telling me first**, and any migration gets
   an explicit callout of what it does to existing rows.
4. **Match the codebase, don't import your own style.** This repo has strong existing
   conventions — read the named reference file before writing each new file, and mirror it.
5. **Wholesale file replace over line-by-line patching** when a file gets out of sync.
   `AdminDashboardPage.tsx` is 6,932 lines: make surgical, anchored edits there, and if an
   edit fails to apply cleanly, re-read the region rather than guessing.
6. If something in this prompt contradicts what you find in the code, **stop and tell me**.
   The code wins; the prompt may be stale.

---

## Scope

**In scope:** create Assistant, list admins, soft-deactivate an Assistant, reactivate an
Assistant, and lock a deactivated admin out of login.

**Explicitly out of scope** (do not build, do not scaffold "for later"):
- Hard delete of an admin. `Auditlog.AdminId` is a **required** FK to `Admins` and
  `Admin.CreatedById` self-references it — deleting an admin row would orphan the audit
  trail. `CustomersController` already established this rule in code comments: soft
  deactivate is the only supported removal. Follow it.
- Editing an existing admin's name/email/phone.
- Password reset for an assistant.
- Any change to the Owner singleton rule. The DB enforces it with a filtered unique index
  (`IX_Admins_Role ... WHERE [Role] = 'Owner'`, see `BackEnd/azure-schema.sql:97`).

---

# PHASE 1 — Backend: `IsActive` on Admin

**Goal:** give `Admin` the same soft-delete flag every other deactivatable entity has.

`IsActive` is the established convention in this domain — `Customer.cs:44`,
`Menuitem.cs:76`, `Menutray.cs:26`, `Rentalitem.cs:56`, `Serviceitem.cs:20` all use
`public bool IsActive { get; set; } = true;`. `Venue.cs` uses a private setter with
`Deactivate()`/`Reactivate()` methods. **Admin has no such flag today.**

**FORK 1.1 — which convention?**
- (a) Plain `public bool IsActive { get; set; } = true;`, mirroring `Customer` — the closest
  analogue, since `AdminsController` mutates entities directly like `CustomersController` does. **Recommended.**
- (b) Venue-style encapsulation with `Deactivate()`/`Reactivate()` domain methods.

Ask, then:

1. `BackEnd/System_ApiTest.Domain/Entities/Admin.cs` — add the property with an XML doc
   comment in the file's existing voice (it explains *why*, not *what* — match that).
2. `BackEnd/System_ApiTest.Application/DTOs/Admindtos.cs` — add `bool IsActive` to the
   `AdminResponseDto` record. **Note:** this file is CRLF, non-ISO extended-ASCII (it has a
   mangled em-dash). Preserve its encoding and line endings; do not reformat it.
3. `AdminsController.Shape(...)` — include `a.IsActive`. This is the single projection every
   admin endpoint returns, so one edit covers create/list/me.
4. Generate the migration:
   `dotnet ef migrations add AddAdminIsActive --project System_ApiTest.Infrastructure --startup-project System_ApiTest`

**Migration callout you must give me before I approve:** existing `Admins` rows need
`IsActive = 1`, not `0`. Confirm the generated `AddColumn<bool>` carries
`defaultValue: true` — if EF emits `defaultValue: false`, hand-edit the migration and say so.
A silent `false` backfill would lock the Owner out of their own system on first deploy.

Also flag whether `BackEnd/azure-schema.sql` is a generated artifact or a maintained file —
if maintained, it needs the column too, and `AZURE_DEPLOYMENT.md` may need a note that this
migration must run against Azure SQL.

**Do not apply the migration to any database in this phase.** Generate only. Stop.

---

# PHASE 2 — Backend: deactivate / reactivate endpoints

**Reference:** `BackEnd/System_ApiTest/Controllers/CustomersController.cs` lines ~310–345.
Mirror that shape exactly: `[HttpPost("{id:guid}/deactivate")]`, load, mutate, save,
`NoContent()`. Do not invent a PATCH or a body-carrying variant.

In `AdminsController`:

```
[Authorize(Roles = "Owner")]
[HttpPost("assistants/{id:guid}/deactivate")]

[Authorize(Roles = "Owner")]
[HttpPost("assistants/{id:guid}/reactivate")]
```

Guards, in this order, each with a distinct message:

1. Target not found → `NotFound()`.
2. `target.Role == AdminRole.Owner` → `Conflict` / `BadRequest` with
   *"The Owner account cannot be deactivated."* The route says `assistants/`; enforce it in
   code too rather than trusting the URL to mean something.
3. `target.Id == caller.Id` → refuse. Belt-and-braces: guard 2 already covers it while the
   Owner is a singleton, but this endpoint should not depend on that invariant holding.
4. Already in the requested state → return `NoContent()` idempotently (do not error).

Use the existing `GetCurrentAdminAsync()` helper for the caller.

**FORK 2.1 — audit logging.** `Auditlogservice` is registered in
`System_ApiTest.Application/DependencyInjection.cs:41` and injected by `BookingsController`,
`GalleryController`, `MenuitemsController`, `AnnouncementsController`, `CalendarDaysController`
— but **not** by `AdminsController`. Creating and disabling staff accounts is arguably the
most audit-worthy action in the system.
- (a) Inject `Auditlogservice` and log `CREATE` on assistant creation and `UPDATE` on
  deactivate/reactivate, `TargetTable = "ADMIN"`. Pass **DTOs, not entities** — the service's
  own doc comment warns about cycles, and `Admin` has two navigation properties plus a
  password hash that must never reach a JSON snapshot. **Recommended.**
- (b) Skip audit for now.

If (a): the `Shape()` projection is your safe snapshot object. Never serialize the entity.

Stop.

---

# PHASE 3 — Backend: lock deactivated admins out

Right now a deactivated assistant could still log in, and an already-issued token keeps
working. Both need closing.

**3a — login (required).** In `AdminsController.Login` and `VerifyLoginOtp`, refuse an
admin with `IsActive == false`.

Placement matters: put the check **after** password verification in `Login`, and return the
*same* generic `"Invalid email or password."` message the controller already uses. Returning
a distinct "account disabled" message before the password check would turn the endpoint into
a user-enumeration oracle — the existing code comment on `Login` says the generic message is
deliberate. In `VerifyLoginOtp`, refuse after the code verifies, with `"Invalid email or code."`.

Also consider: should `OtpService.IssueAsync` even be called for a deactivated admin? Emailing
a login code to a disabled account is noise at best. Recommend checking before issuing but
still returning the same generic response shape.

**3b — live tokens. FORK 3.1.** `Program.cs:183` `OnTokenValidated` currently checks only the
JTI denylist (`Tokendenylistservice`). There is no "revoke every token for user X" primitive,
so a deactivated assistant keeps working access until their JWT expires.
- (a) **Accept the lag.** Document it in an XML comment on the deactivate endpoint. Zero
  added cost, worst case is one token lifetime of residual access by someone who already had
  the credentials. **Recommended for now** — it matches the threat model (offboarding a staff
  member, not containing a breach).
- (b) **Check `IsActive` in `OnTokenValidated`** for Owner/Assistant tokens. Correct
  immediately, but adds a DB read to every authenticated admin request, including every
  SignalR hub handshake. If you pick this, it needs `IMemoryCache` with a short TTL, and that
  is a real performance change to a hot path — say so.
- (c) Deactivate also revokes the target's *current* JTI. Not possible: the denylist is keyed
  by JTI and we do not store the active JTI per admin. Mention only if you see a way I missed.

Tell me which and why. Stop.

---

# PHASE 4 — Frontend: preserve the Owner/Assistant distinction

**This is the blocker nothing else can proceed without, and it is easy to miss.**

`FontEnd/src/types/auth.ts:5` defines `export type UserRole = 'customer' | 'admin'`, and
`api/authApi.ts` `toUserRole()` deliberately **flattens** the server's `"Owner"` and
`"Assistant"` into a single `'admin'`. So the persisted `User` object **cannot currently tell
an Owner from an Assistant** — meaning the dashboard has no way to gate an Owner-only nav item.

**FORK 4.1 — how to recover the distinction?**
- (a) Add an optional `adminRole?: 'Owner' | 'Assistant'` field to the `User` interface in
  `types/auth.ts`, populate it in `authApi.ts` on both the direct-login and OTP-verify paths,
  and leave `UserRole` untouched. `tokenStorage.persistSession` does
  `JSON.stringify(user)`, so it persists and rehydrates with no change to that module.
  **Recommended** — additive, no routing logic touched, one round trip saved.
- (b) Call `GET /api/Admins/me` on dashboard mount and read `role` from the response. No auth
  type changes, but adds a request and a loading state before the sidebar can render correctly.
- (c) Widen `UserRole` to four values. **Do not** — `toUserRole`'s job is routing to the right
  dashboard, and every `role === 'admin'` comparison in the app would need auditing.

If (a): note that `toUserRole()` throws `AuthError` on an unrecognised role — keep that
behaviour; `adminRole` is derived from the same already-validated string, so add it in the
same switch rather than parsing the raw string twice.

Also confirm: a session persisted *before* this change rehydrates with `adminRole === undefined`.
Decide what an undefined `adminRole` means for an admin user — recommend treating it as
"not Owner" (hide the tab) rather than "assume Owner", and say so.

Stop.

---

# PHASE 5 — Frontend: `adminsApi.ts`

Create `FontEnd/src/api/adminsApi.ts`. **Reference file: `FontEnd/src/api/galleryApi.ts`** —
copy its structure exactly:

- The header doc-comment with an endpoint inventory table.
- `const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258').replace(/\/+$/, '');`
- `export class AdminsApiError extends Error` with `readonly status: number | null` and the
  `get isAuthError()` returning `status === 401 || status === 403`.
- The private `readErrorMessage(res)` helper that reads `body.message` then falls back to the
  first `body.errors[key][0]` — this is what surfaces ASP.NET `ModelState` validation errors,
  and `CreateAssistantDto` has four annotated fields that will produce them.
- `handle<T>()` with the 401/403 branch, the `res.status === 204 → {} as T` branch, and the
  `UNREACHABLE` constant.

Exports:

```ts
export interface AdminSummary {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  role: 'Owner' | 'Assistant';
  createdById: string | null;
  createdAt: string;
  isActive: boolean;
}

export interface CreateAssistantPayload {
  fullName: string; email: string; phoneNumber: string; password: string;
}

fetchAdmins(token): Promise<AdminSummary[]>
createAssistant(token, payload): Promise<AdminSummary>
deactivateAssistant(token, id): Promise<void>
reactivateAssistant(token, id): Promise<void>
```

The 401/403 message should say **Owner**, not "Owner or Assistant" — every endpoint here is
Owner-only, and the copied string from `galleryApi.ts` would be wrong.

Verify `AdminSummary` against `Shape()` in `AdminsController` field by field before you
finish, including the casing the serializer emits. Stop.

---

# PHASE 6 — Frontend: the Staff panel

**FORK 6.1 — where does the panel live?**
- (a) New `FontEnd/src/components/admin/StaffPanel.tsx`. **Recommended** —
  `AdminDashboardPage.tsx` is already 6,932 lines, and `components/admin/` is the established
  home for extracted admin UI (`CashPaymentModal`, `EventResourcesModal`, `bookings/`,
  `payments/`, `shared/`).
- (b) A local component in `AdminDashboardPage.tsx`, following `AdminSupportPanel` at line 886.

Either way it takes `notify: (t: 'success' | 'error' | 'info', m: string) => void` — the same
prop `AdminSupportPanel` takes, wired to the page's `useToasts()`.

**Data access:** `const session = readSession(); if (!session?.token) { ... }` — the pattern
used ~10 times in the page. Do not thread the token down through props.

**The list.** A table matching the inline style of the existing admin tables (see line 4233:
`width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300`).
Columns: Name, Email, Phone, Role, Status, Added. Use existing CSS classes — `.adm-card`,
`.adm-title`, `.adm-btn`, `.adm-pill`, `.adm-input`, `.adm-datarow`. Colour the status pill
with the existing CSS variables (`var(--status-paid)` / `var(--text-dim)`), never hardcoded hex.

The Owner row renders with no actions at all. Assistants get Deactivate or Reactivate.

**The create form.** A modal using `.adm-modal-overlay` / `.adm-modal-panel`.
- Phone: use the existing `PhoneNumberInput` component plus `isCompletePhPhone` / `toE164`
  from `lib/phone` — the server regex is `^\+[1-9]\d{6,14}$` (E.164), so a raw `09xxxxxxxxx`
  will be rejected. This is exactly why `toE164` exists; use it.
- Password: mirror the server rule `^(?=.*[a-z])(?=.*[A-Z]).{8,}$` client-side, and show the
  requirement as helper text rather than only on failure.
- FullName ≤ 200, Email valid and ≤ 254.
- Client validation is a courtesy, not the gate — always render the server's message on 400.

**Deactivate** goes through a confirmation step naming the assistant. Explain in the confirm
copy what deactivation actually does — *"They will no longer be able to sign in. Their past
actions stay in the audit log."* — and, if we chose FORK 3.1 (a), that an active session may
persist until their token expires.

Stop.

---

# PHASE 7 — Frontend: wire it into the dashboard

In `FontEnd/src/pages/AdminDashboardPage.tsx`:

1. **Line 604** — add `'staff'` to the `Tab` union.
2. **Line 618** — add `'staff'` to `URL_TABS` so `?tab=staff` survives a refresh. It qualifies:
   it is a real panel with no in-memory dependency, unlike `'placeholder'` (see the comment at
   line 613 explaining why `placeholder` is excluded — read it, and confirm `staff` doesn't
   fall under the same objection).
3. **Sidebar** — a nav button next to Announcements (~line 4614), rendered **only** when
   `authUser?.adminRole === 'Owner'`. Icon: `Users` or `UserCog` from lucide-react, `size={18} strokeWidth={1.75}`,
   matching every sibling.
4. **Topbar title** — extend the ternary chain at line 4656 with `tab === 'staff' ? 'Staff Management'`.
5. **Panel render** — near the announcements block, `{tab === 'staff' && authUser?.adminRole === 'Owner' && <StaffPanel notify={notify} />}`.
   Gate the render as well as the nav: a hand-typed `?tab=staff` must not reach the panel.
6. **Data loading** — follow the `useEffect` at line 2982 that loads per tab; the panel can
   own its own fetch instead if you chose 6.1(a). Say which you did.

Note: this is **not** a security boundary — the server's `[Authorize(Roles = "Owner")]` is.
The gate is so an Assistant doesn't see a tab that would only 403 at them. State that in a
code comment so the next reader doesn't mistake it for the real check.

Stop.

---

# PHASE 8 — Verification

Do not declare done until all of this passes, and report each line's result explicitly.

**Builds**
- `dotnet build` on the solution — clean.
- `npm run build` in `FontEnd/` — clean, no new TS errors.
- Lint the touched frontend files.

**Migration**
- Apply `AddAdminIsActive` to the local dev DB. Confirm by query that the **existing Owner row
  has `IsActive = 1`**. This is the single most dangerous line in the change — verify it, do
  not reason about it.
- Restart the API and confirm `DbSeeder` still runs clean against the migrated schema
  (`Seeding/` — it checks `AnyAsync(a => a.Role == AdminRole.Owner)`; it should find the
  existing Owner and no-op).

**Manual matrix** — run against the local API and report actual observed results:

| # | As | Action | Expected |
|---|----|--------|----------|
| 1 | Owner | Open dashboard | Staff tab visible |
| 2 | Owner | Create assistant, valid input | 201, appears in list as Active |
| 3 | Owner | Create with duplicate email | 409, server message shown in the modal |
| 4 | Owner | Create with `09171234567` unconverted | Client blocks it, or server 400 renders cleanly |
| 5 | Owner | Create with `password` (no uppercase) | 400, the regex message is readable to a human |
| 6 | Owner | Deactivate that assistant | 204, row flips to Inactive |
| 7 | Assistant (deactivated) | Attempt login | Rejected, generic message, no OTP email sent |
| 8 | Owner | Reactivate | 204, login works again |
| 9 | Owner | Attempt to deactivate own/Owner account | Refused with the Owner-specific message |
| 10 | Assistant (active) | Open dashboard | **No** Staff tab |
| 11 | Assistant (active) | Hand-type `/admin?tab=staff` | Panel does not render |
| 12 | Assistant (active) | `POST /api/Admins/assistants` via Scalar | 403 |
| 13 | Owner | Refresh on `?tab=staff` | Lands back on Staff |
| 14 | Owner | Audit tab (if FORK 2.1(a)) | The create and deactivate entries are present |

**Regression check:** confirm you have not changed behaviour for Owner *or* Assistant on any
existing tab. Phase 4 touches the auth mapping — the single highest-blast-radius edit in this
change. Explicitly verify that a **customer** login still works end to end.

Then give me: files changed, the migration name, the forks I chose, and anything you would
flag for a follow-up.
