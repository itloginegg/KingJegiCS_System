# Making a full-stack change — KingJegi runbook

Written against the repo as it actually is: 20 controller-style features plus one Clean
Architecture vertical slice (Venues), a React SPA whose DTO mirrors live in `src/api/*.ts`, and a
deployed environment in East Asia (`kingjegi-api` App Service + `kingjegi-web` Static Web App +
`KingJegiDB`).

Work top to bottom. Everything through Phase 5 happens on your machine against LocalDB; nothing
touches Azure until Phase 6.

---

## Phase 0 — Decide which backend pattern

Your backend has two, and they coexist deliberately.

| | Controller pattern | Clean Architecture slice |
|---|---|---|
| Used by | 20 features (Bookings, Payments, Testimonials, …) | Venues only |
| Lives in | `System_ApiTest/Controllers/XController.cs` + `Application/Services/Xservice.cs` | `Application/Features/X/{Commands,Queries}/` + `System_ApiTest/Endpoints/XEndpoints.cs` |
| Wiring | `[ApiController]`, auto-routed | `app.MapXEndpoints()` in Program.cs |
| Validation | in the service | FluentValidation validator per command |

**Rule:** modifying an existing feature → use whatever pattern that feature already uses. Don't
convert it as a side effect of a change. Building a genuinely new feature → use the Venues slice
as the template, since that's the direction the codebase is moving.

---

## Phase 1 — Domain and schema

Only if the change touches stored data. Skip to Phase 2 if not.

1. Edit the entity in `System_ApiTest.Domain/Entities/`.
2. If it needs column types, indexes or relationships spelled out, update the matching file in
   `System_ApiTest.Infrastructure/Persistence/Configurations/`.
3. Generate the migration:

   ```powershell
   cd BackEnd
   dotnet ef migrations add DescriptiveName `
     --project System_ApiTest.Infrastructure `
     --startup-project System_ApiTest
   ```

4. **Open the generated migration and read it before running it.** You are looking for
   `DropColumn`, `DropTable`, `RenameColumn`, `AlterColumn` narrowing a type, or a new
   `nullable: false` column with no `defaultValue` — each of those either destroys data or fails
   outright on a table that already has rows.

5. Apply locally and confirm it does what you meant:

   ```powershell
   dotnet ef database update --project System_ApiTest.Infrastructure --startup-project System_ApiTest
   ```

### The additive rule

Your API and your SPA deploy separately and land minutes apart, so every release has a window
where new backend runs against old frontend. Design the schema change so that window is boring:

- new column → `nullable: true`, or `nullable: false` **with a default**
- new required field → make it optional this release; enforce it next release
- renaming or removing anything → **two releases**. Release 1 adds the new field and keeps the old
  one working. Release 2 removes the old one, once nothing reads it.

One-shot renames are the single most common way a working deploy breaks.

---

## Phase 2 — Backend

**Controller pattern:**

1. DTO in `System_ApiTest.Application/DTOs/<Feature>dtos.cs`
2. Business logic in `System_ApiTest.Application/Services/<Feature>service.cs`
3. Endpoint in `System_ApiTest/Controllers/<Feature>Controller.cs`

**Vertical slice pattern:**

1. Command/Query record in `Features/<Feature>/{Commands,Queries}/<Name>/`
2. Handler beside it
3. Validator beside it (commands)
4. Route in `System_ApiTest/Endpoints/<Feature>Endpoints.cs`
5. New feature → add `app.Map<Feature>Endpoints();` in Program.cs

Either way, check: does the route need `[Authorize]`, and with which role? Anonymous endpoints are
publicly reachable the moment you publish.

If the work happens inside one of the 11 transaction blocks, it now runs inside a
`CreateExecutionStrategy().ExecuteAsync(...)` lambda that **can be re-executed**. Nothing
non-idempotent — email, PayMongo call, hub notification — goes inside it.

```powershell
dotnet build
```

---

## Phase 3 — Frontend

Your TypeScript DTO mirrors are **not** in `src/types/` (that holds auth types only). Each feature's
interfaces live at the top of its own client in `src/api/<feature>Api.ts`, with a header comment
listing the endpoint inventory and comments like `/** Matches PublicTestimonialDto */`.

1. Update the interface in `src/api/<feature>Api.ts` so it matches the C# DTO field for field
   (camelCase — the API pins `JsonNamingPolicy.CamelCase`).
2. Update the endpoint inventory comment at the top of the file. It is the only map of the API
   surface that exists; letting it drift makes the next change harder.
3. Update or add the fetch function.
4. Update the components that consume it.

```powershell
cd FontEnd
npm run build     # tsc -b && vite build — catches type drift
```

**This is where full-stack changes break.** Nothing checks that the TS interface and the C# DTO
agree. `tsc` will happily compile a frontend describing a response shape the API stopped sending.
Change both in the same commit, every time.

---

## Phase 4 — Verify locally, end to end

Run the API (`dotnet run` from `BackEnd/System_ApiTest`) and the SPA (`npm run dev`) together and
exercise the actual flow in the browser, not just the endpoint in Scalar.

If the change touched booking, payment, or rental logic, re-run these regardless of whether you
think you affected them — they share the transaction and locking paths:

- booking submit → invoice created
- ₱5,000 fee → auto-confirm with slot lock
- cancellation → partial refund
- rental confirm → stock deducted

---

## Phase 5 — Commit as one release

```powershell
git checkout -b feature/short-name
git add -A
git commit -m "Add X: entity, migration, API, and UI"
```

Backend and frontend in **one commit**. When something breaks in production, "what shipped
together" needs to be a single answer.

Merge to `main`, then tag it so the deployed state has a name:

```powershell
git tag -a deploy-2026-09-02 -m "Adds X"
git push origin main --tags
```

---

## Phase 6 — Deploy, in this order

Order is not a preference. Each step must leave the system in a working state on its own.

### 6.1 — Migration first

```powershell
dotnet ef migrations script --idempotent `
  --project System_ApiTest.Infrastructure `
  --startup-project System_ApiTest `
  --output azure-schema.sql
```

Run `azure-schema.sql` against `KingJegiDB` in SSMS. Generating the script needs no connection, so
there is no PowerShell quoting to get wrong, and `--idempotent` makes it safe if part already applied.

**If the migration touches a table with real data, take a backup first** — Portal → `KingJegiDB` →
Export, or rely on point-in-time restore (7 days on the free tier) and note the time.

### 6.2 — Backend second

Right-click `System_ApiTest` → Publish. Watch Log stream for a clean start.

Why second: a backend that understands a field the frontend isn't sending yet is harmless. The
reverse is a 400.

### 6.3 — Frontend last

```powershell
git push origin main
```

Static Web Apps rebuilds automatically. ~2–4 minutes with your 3D dependencies.

`VITE_API_BASE_URL` is already set in the workflow — you only touch that if the API URL changes.

---

## Phase 7 — Verify in production

1. Hard refresh (Ctrl+Shift+R). Your own browser is holding the previous bundle.
2. Run the changed flow.
3. DevTools → Network: confirm calls hit `kingjegi-api.azurewebsites.net` and the response shape
   matches what the TS interface expects.
4. Log stream: no new exceptions.
5. First request after an idle period may take ~60s — the database is resuming. Not a bug.

Remember other people's tabs still hold the old bundle until they reload. Additive backend changes
are what make that harmless.

---

## Rollback

| Broke | Fix |
|---|---|
| Frontend | `git revert <commit>` → push. SWA rebuilds in minutes. |
| Backend | Re-publish from the previous tag. (No staging slots on B1 — those start at Standard.) |
| Migration | `Update-Database <PreviousMigrationName>` if the `Down` is sound. If it dropped data, restore from backup instead — a `Down` cannot invent deleted rows. |

Which is the real argument for the additive rule: additive changes never need a rollback that
loses data.
