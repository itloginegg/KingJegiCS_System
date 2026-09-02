# Deploying KingJegi to Azure

Written against the actual repo state: `BackEnd/System_ApiTest.slnx` (net10.0, Clean Architecture — Domain / Application / Infrastructure / Api), EF Core code-first with ~42 migrations in `System_ApiTest.Infrastructure/Migrations`, and the Vite + React 19 SPA in `FontEnd/`.

**Target architecture**

| Piece | Azure service | Cost |
|---|---|---|
| ASP.NET Core API (`System_ApiTest`) | App Service (Linux), B1 plan | ~$13/mo from student credit |
| React SPA (`FontEnd`) | Static Web Apps, Free tier | $0 |
| `KingJegiDB` | Azure SQL Database, free serverless offer | $0 |
| Speech (`kingjegi-speech`, East Asia) | already exists | F0 free |

**Names used throughout** — substitute your own where marked:

```
Resource group      kingjegi-rg
Region              East Asia               (your subscription's region policy blocks Southeast Asia;
                                            East Asia is where kingjegi-sql and kingjegi-speech already live)
SQL server          kingjegi-sql            → kingjegi-sql.database.windows.net
Database            KingJegiDB
App Service plan    plan-kingjegi           (B1 Basic)
API app             kingjegi-api            → https://kingjegi-api.azurewebsites.net
Static Web App      kingjegi-web            → https://<generated>.azurestaticapps.net
```

App Service names are **globally unique**. If `kingjegi-api` is taken, use `kingjegi-api-jm` or similar and use that everywhere below.

---

## Part 0 — Prerequisites

- Azure for Students subscription (portal.azure.com, $100 credit, no card required)
- Visual Studio with the **Azure development** workload installed
- .NET 10 SDK, and EF tools current: `dotnet tool update --global dotnet-ef`
- SQL Server Management Studio (only if you want to copy existing LocalDB data)
- Your GitHub repo pushed and up to date (Static Web Apps deploys from it)

Do **Part 1 first**. Four things in the current code will break in production, and it is much less painful to fix them before the first deploy than to debug them from a log stream.

---

## Part 1 — Code changes required before deploying

### 1.1 CORS is hard-coded to localhost — the SPA will be blocked

`Program.cs` currently allows any origin whose host is `localhost` or `127.0.0.1`. Deployed, your Static Web App origin fails that test and **every API call from the browser fails**. Because the policy uses `AllowCredentials()`, you cannot fall back to `AllowAnyOrigin()` — the browser rejects that combination outright. The origin list has to be explicit.

Replace the `AddCors` block in `Program.cs`:

```csharp
const string FrontendCors = "Frontend";
builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCors, policy =>
    {
        if (builder.Environment.IsDevelopment())
        {
            // unchanged: any localhost port, so the Vite dev port doesn't matter
            policy.SetIsOriginAllowed(origin =>
                      Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
                      uri.Host is "localhost" or "127.0.0.1")
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();
        }
        else
        {
            var origins = builder.Configuration
                .GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
            policy.WithOrigins(origins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();   // required — SignalR sends credentials
        }
    });
});
```

You will set `Cors__AllowedOrigins__0` as an App Service setting in Part 5.

### 1.2 Add forwarded headers — App Service terminates TLS before your app sees the request

Azure's front end handles HTTPS and forwards **plain HTTP** to your container. Your app therefore thinks every request is insecure, which makes `UseHttpsRedirection()` (already in the non-Development branch) issue redirects on requests that were already HTTPS, and makes any absolute URL you generate come out as `http://`.

Add the using and make this the **first** middleware after `var app = builder.Build();`:

```csharp
using Microsoft.AspNetCore.HttpOverrides;   // top of file

var app = builder.Build();

app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});
```

Then also switch on **HTTPS Only** in the portal (Part 3.2) so the redirect happens at the edge rather than in your app.

### 1.3 Uploaded images and support attachments will be deleted on every publish

`ImageUploadHelper` and `FileUploadHelper` write to `env.WebRootPath` — i.e. `wwwroot/images/{gallery,menu,packages,rentals}` and `wwwroot/uploads/support`, inside the deployment folder. App Service **replaces that folder wholesale on each publish**. Every gallery photo, package image, and support attachment uploaded through the live admin panel disappears the next time you deploy.

**Deploy-now fix** (persistent, survives publishes): write to `/home/site/data`, which lives on App Service's persistent share rather than in the deployment folder.

Both helpers are **static classes** (`ImageUploadHelper.SaveImageAsync`, `FileUploadHelper.SaveAttachmentAsync`), so there is no constructor to inject into — add a static override property to each instead, set once at startup. No call site changes.

Add to both `ImageUploadHelper` and `FileUploadHelper`:

```csharp
/// <summary>
/// Overrides the wwwroot base for uploads. Set once at startup from Uploads:RootPath so
/// production writes to persistent storage instead of the deployment folder.
/// </summary>
public static string? RootPathOverride { get; set; }
```

Then change **every** line in those two classes that computes `webRoot` — there are three in `ImageUploadHelper` (`SaveImageAsync` and both `DeleteImage` paths) and one in `FileUploadHelper` — from:

```csharp
var webRoot = env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
```

to:

```csharp
var webRoot = RootPathOverride
              ?? env.WebRootPath
              ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
```

Missing a `DeleteImage` path means replaced images leak files on disk rather than failing loudly, so do all four.

Then wire it up and serve the folder, right after the existing `app.UseStaticFiles();` in `Program.cs`:

```csharp
using Microsoft.Extensions.FileProviders;   // top of file

app.UseStaticFiles();

var uploadRoot = builder.Configuration["Uploads:RootPath"];
if (!string.IsNullOrWhiteSpace(uploadRoot))
{
    ImageUploadHelper.RootPathOverride = uploadRoot;
    FileUploadHelper.RootPathOverride  = uploadRoot;

    Directory.CreateDirectory(Path.Combine(uploadRoot, "images"));
    Directory.CreateDirectory(Path.Combine(uploadRoot, "uploads"));

    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(uploadRoot),
        RequestPath  = ""      // so stored "/images/packages/x.webp" URLs still resolve
    });
}
```

Set `Uploads__RootPath` = `/home/site/data` in Part 5. Locally the setting is absent, so nothing changes.

**Proper fix, later:** move uploads to Azure Blob Storage and store the full blob URL instead of a `wwwroot`-relative path. That is the right answer once you scale past one instance, but it touches the DTOs and the frontend, so it is not a pre-deployment task.

### 1.4 Your four background workers need Always On (and therefore B1, not F1)

`DenylistCleanupWorker`, `DraftCleanupWorker`, `NotificationWorker` and `SupportTriageWorker` are `IHostedService`s. App Service unloads an app after ~20 minutes with no HTTP traffic, and unloading stops the workers — notifications stop going out and support drafts stop being generated until someone hits the site. **Always On** prevents this, and Always On is not available on the Free (F1) tier.

The Free tier also caps you at 5 concurrent WebSocket connections, which your two SignalR hubs (`/hubs/payment`, `/hubs/voice`) will hit quickly. B1 is the realistic floor.

### 1.5 `JwtSettings:Key` is still the placeholder

`appsettings.json` ships `"REPLACE-with-a-long-random-secret-at-least-32-bytes"`. In `Program.cs`, `GetSection("JwtSettings").Get<JwtSettings>()!` runs at startup, so a missing section is a **startup crash**, not a runtime error — this is the most common cause of a 500.30 on first deploy. Generate a real key now:

```powershell
# PowerShell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Keep it out of the repo; it goes in App Settings in Part 5.

### 1.6 Connection resiliency — and why you cannot just switch it on

The free Azure SQL tier auto-pauses when idle. The first connection after a pause fails with **error 40613, "Database … is not currently available"**, and EF does not retry it by default. So you do need `EnableRetryOnFailure` eventually.

**But this codebase cannot take the one-line version.** There are 11 explicit `BeginTransactionAsync()` call sites:

```
System_ApiTest.Application/Services/Bookingservice.cs          × 7
System_ApiTest.Application/Services/Paymentservice.cs          × 2
System_ApiTest.Application/Services/Bookingresourceservice.cs  × 1
System_ApiTest.Application/Services/Rentalservice.cs           × 1
```

`SqlServerRetryingExecutionStrategy` refuses to run user-initiated transactions. The moment you enable retries, all eleven throw at runtime:

> The configured execution strategy 'SqlServerRetryingExecutionStrategy' does not support user-initiated transactions. Use the execution strategy returned by 'DbContext.Database.CreateExecutionStrategy()' to execute all the operations in the transaction as a retriable unit.

That is the entire reservation lifecycle, the payment confirm path, and rental stock deduction — i.e. everything that matters. It compiles fine and fails only when the code path runs, which is a bad thing to discover during a demo.

**Do this in two stages.**

*Stage 1 — deploy without retries.* Leave `AddDbContext` as it is. Instead:

- put `Connection Timeout=60` in the connection string (a resuming database needs more than the 30-second default), and
- when a command fails with 40613, just run it again — the database is waking up, and the second attempt normally succeeds.

This is fine for getting deployed. The cost is that a user who is first to hit the site after an idle period may see one failed request.

*Stage 2 — wrap the transactions, then enable retries.* Each of the eleven sites changes from:

```csharp
await using var tx = await _db.Database.BeginTransactionAsync();
// … work …
await tx.CommitAsync();
```

to:

```csharp
var strategy = _db.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    await using var tx = await _db.Database.BeginTransactionAsync();
    // … work …
    await tx.CommitAsync();
});
```

The rewrite is mechanical, but note the semantics: **the whole block can be re-executed**, so anything non-idempotent inside it — sending an email, calling PayMongo, writing an audit row outside the transaction — must move outside the lambda or it can happen twice. Your confirm path does exactly this kind of thing, so go through them one at a time rather than with find-and-replace.

Only after that, add:

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        sql => sql.EnableRetryOnFailure(
            maxRetryCount: 6,
            maxRetryDelay: TimeSpan.FromSeconds(15),
            errorNumbersToAdd: null)));
```

and re-test booking confirm, payment confirm, and rental deduction against LocalDB before deploying.

### 1.7 Things that are already correct — no change needed

- Scalar and OpenAPI are inside `if (app.Environment.IsDevelopment())`, so the API explorer will not be public.
- `VoiceDiagnosticsHub` and the `/__diag/*` endpoints are Development-only route registrations, so they will not exist in production.
- `DbSeeder` is idempotent and runs at startup — it will create the Owner and `SystemSettings` on first boot, provided `Seed:OwnerEmail` and `Seed:OwnerPassword` are set **before** that first boot.

### 1.8 The two new configuration keys

1.1 and 1.3 add two settings. Both ship in `appsettings.json` with empty/null values so the key
names are discoverable, and both are left that way in the repo — the real values are App Service
settings (Part 5), never committed.

| Key | `appsettings.json` | Production | What it does |
|---|---|---|---|
| `Cors:AllowedOrigins` | `[]` | `Cors__AllowedOrigins__0` = your SWA origin | Browser origins allowed to call the API outside Development. Ignored in Development, where any `localhost` origin is accepted. Empty in a non-Development environment logs a startup warning and blocks every browser call. |
| `Uploads:RootPath` | `null` | `Uploads__RootPath` = `/home/site/data` | Base folder for uploaded images and support attachments. Absent (as locally) means `wwwroot`. When set, the folder is also served as static files at the root path so stored URLs like `/images/packages/x.webp` still resolve. |

---

## Part 2 — Database: Azure SQL + EF Core migrations

### 2.1 Create the database on the free offer

1. Go to **https://aka.ms/azuresqlhub** → **Create a database** → **Start free**. (Starting here is what applies the free offer; creating from the generic *Create a resource* blade often does not.)
2. Confirm the **"Free offer applied!"** banner appears.
3. **Basics:**
   - Subscription: Azure for Students; Resource group: `kingjegi-rg`
   - Database name: `KingJegiDB`
   - Server: **Create new** → name `kingjegi-sql`, location **East Asia**, authentication **Use SQL authentication**, admin login `kingjegiadmin`, and a strong password. **Save this password now** — you cannot read it back later.
   - Confirm the cost summary reads **$0/month**.
4. **Behavior when free limit reached:** choose **Auto-pause** to stay at $0. The alternative ("continue with charges") cannot be undone.
5. **Networking:** set **Allow Azure services and resources to access this server** = **Yes** (this is what lets App Service connect), and **Add current client IP address** = **Yes** (this is what lets you run migrations from your laptop).
6. **Review + create**.

The free offer gives you 100,000 vCore-seconds of serverless compute, 32 GB data and 32 GB backup per month, across up to 10 databases per subscription.

> **Before your defense:** serverless auto-pause means the first request after an idle period takes 30–60 seconds while the database resumes. Raise the auto-pause delay to its maximum (or hit the site 10 minutes beforehand) so your demo isn't the thing that wakes it up.

### 2.2 Get the connection string

Portal → your database → **Settings → Connection strings → ADO.NET**. It looks like:

```
Server=tcp:kingjegi-sql.database.windows.net,1433;Initial Catalog=KingJegiDB;Persist Security Info=False;User ID=kingjegiadmin;Password={your_password};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;
```

Replace `{your_password}`, and bump `Connection Timeout` to `60` for the cold-start case. Do **not** paste this into `appsettings.json` — it stays out of source control. `appsettings.json` keeps its LocalDB string so local development is unaffected; the Azure App Setting overrides it at runtime.

### 2.3 Apply the schema with EF Core migrations

Sanity check first — confirm the model and the migrations are in sync:

```powershell
cd BackEnd
dotnet ef migrations has-pending-model-changes `
  --project System_ApiTest.Infrastructure `
  --startup-project System_ApiTest
```

If that reports pending changes, add a migration and test it against LocalDB before touching Azure.

**Option A — run `database update` straight at Azure (simplest, do this for the first deploy).** `--connection` overrides configuration for this command only, so nothing is persisted anywhere:

```powershell
cd BackEnd
dotnet ef database update `
  --project System_ApiTest.Infrastructure `
  --startup-project System_ApiTest `
  --connection "Server=tcp:kingjegi-sql.database.windows.net,1433;Initial Catalog=KingJegiDB;User ID=kingjegiadmin;Password=<PASSWORD>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;"
```

The Package Manager Console equivalent:

```powershell
Update-Database -Project System_ApiTest.Infrastructure -StartupProject System_ApiTest -Connection "Server=tcp:..."
```

Expect it to take a few minutes — it is replaying ~42 migrations, and the first statement also has to wake the database.

**Option B — generate an idempotent script (better for a repeatable, reviewable deploy).**

```powershell
dotnet ef migrations script --idempotent `
  --project System_ApiTest.Infrastructure `
  --startup-project System_ApiTest `
  --output azure-schema.sql
```

Run `azure-schema.sql` against the Azure database from SSMS or Azure Data Studio. Use SSMS rather than the portal's Query editor — a 42-migration script is well past what the browser editor handles comfortably. `--idempotent` means the script checks `__EFMigrationsHistory` per migration, so it is safe to re-run.

**Verify** either way: in SSMS, `SELECT * FROM __EFMigrationsHistory ORDER BY MigrationId` should end at `20260829142317_AddSupportDrafts`.

### 2.4 Data: what to bring over, and what not to

Your LocalDB holds development data. Most of it should not go to production.

**Do not migrate:** `Admins` and `Customers` (dev password hashes, test mailboxes — the Owner is recreated by `DbSeeder`), `Bookings`, `Payments`, `Invoices`, `BookingHistory`, `AuditLogs`, `SupportMessages`, `SupportDrafts`, and the token denylist. Starting these empty is the correct production state, and it keeps your audit trail honest.

**Worth migrating** — the catalog you spent real time entering: menu items, packages and package images, services, rental items, gallery images, venues, and any tuned `SystemSettings` values.

Recommended approach, which keeps `__EFMigrationsHistory` correct:

1. Run the migrations first (2.3), so the Azure schema is EF-owned.
2. SSMS → connect to `(localdb)\MSSQLLocalDB` → right-click `KingJegiDatabase` → **Tasks → Generate Scripts**
3. **Choose objects** → *Select specific database objects* → tick only the catalog tables listed above.
4. **Advanced** settings:
   - *Types of data to script* = **Data only**
   - *Script for the database engine type* = **SQL Server**, *Script for Server Version* = **Azure SQL Database**
   - *Script for Identity* (or *Script Check Constraints*/IDENTITY_INSERT option) = **True**, so identity keys are preserved and your foreign keys still line up
5. Save to a file, open it against the Azure connection in SSMS, and run it **in dependency order** (parents before children — e.g. packages before package images). If you hit FK errors, reorder rather than disabling constraints.
6. Re-upload the physical image files: the rows carry `wwwroot`-relative paths like `/images/packages/packages_….png`, but the files themselves live only on your machine. Either re-upload them through the admin UI after deploying, or copy them into `/home/site/data/images/...` via the App Service **SSH** console (Portal → kingjegi-api → Development Tools → SSH).

If you would rather move the whole database in one shot, SSMS → **Tasks → Deploy Database to Microsoft Azure SQL Database** does schema + data together. It is faster, but it produces a schema that EF did not create — check `__EFMigrationsHistory` came across intact afterwards, or your next `Add-Migration` will try to recreate everything.

---

## Region constraint — read before creating anything new

Your Azure for Students subscription carries a policy assignment named **`sys.regionrestriction`**
("Allowed resource deployment regions") at subscription scope. Deploying outside the allowed set
fails with `RequestDisallowedByAzure` — the error text talks about "best available regions" and
does not name which ones are allowed.

**East Asia is allowed** — `kingjegi-sql`, `KingJegiDB` and `kingjegi-speech` are all deployed
there already. Southeast Asia is not. Create the App Service plan in **East Asia** too: it is the
allowed region you have proven, and co-locating the app with the database keeps every query on the
same regional network instead of paying a cross-region round trip.

If you ever need a different region, list the allowed set from the policy assignment rather than
guessing:

```powershell
az policy assignment show --name sys.regionrestriction `
  --scope /subscriptions/<your-subscription-id> --query parameters
```

---

## Part 3 — Deploy the API with Visual Studio Publish

### 3.1 Publish

1. In Solution Explorer, right-click the **`System_ApiTest`** project (the Web API, not the solution or a class library) → **Publish**.
2. **Azure** → **Azure App Service (Linux)** → sign in with your student account.
3. Click **+** to create a new App Service:
   - Name: `kingjegi-api`
   - Subscription: Azure for Students
   - Resource group: `kingjegi-rg`
   - Hosting plan: **New** → `plan-kingjegi`, **East Asia**, size **B1 Basic** (see 1.4 for why not F1)
   - Runtime stack: **.NET 10**
4. **Finish** to create the publish profile — but do not publish yet.
5. Click the **pencil** next to the profile → verify: Configuration **Release**, Target Framework **net10.0**, Deployment Mode **Framework-dependent**, Target Runtime **linux-x64**.
6. **Publish**.

> **If the runtime dropdown doesn't offer .NET 10:** check what your region actually has with `az webapp list-runtimes --os-type linux`. If .NET 10 isn't listed as GA there, set **Deployment Mode: Self-contained** with target runtime `linux-x64` in step 5. That bundles the runtime into the deployment so the platform stack no longer matters — the package is larger and the first publish is slower, but it works on any Linux App Service. A Windows App Service plan is the other fallback.

### 3.2 Turn on the platform settings the app depends on

Portal → **kingjegi-api** → **Settings → Configuration → General settings**:

| Setting | Value | Why |
|---|---|---|
| Always On | **On** | keeps the four hosted workers running (1.4) |
| Web sockets | **On** | SignalR falls back to long polling without it |
| Session affinity (ARR) | **On** | keeps hub connections on one instance |
| HTTPS Only | **On** | *(TLS/SSL settings blade)* — edge redirect, pairs with 1.2 |
| Stack / version | .NET 10 | should already match your publish |
| Minimum TLS version | 1.2 | |

Save. The app restarts.

### 3.3 Watch the first start

Portal → **kingjegi-api** → **Monitoring → Log stream**. On a healthy boot you should see, from `Program.cs`:

```
Assistant (Gemini) configured: True. Speech (Azure TTS) configured: True (region 'eastasia', voice 'en-PH-RosaNeural').
```

and from `DbSeeder`, either `Seeded SystemSettings singleton with defaults.` or nothing (already seeded). If you instead see `NO OWNER ACCOUNT EXISTS`, your `Seed__*` settings are missing — add them (Part 5) and restart.

At this point the app will still fail to start or fail on first request unless Part 5 is done. Do Part 5 now if you want to verify before wiring the frontend.

---

## Part 4 — Deploy the React frontend to Static Web Apps

### 4.1 Add SPA routing config

React Router routes like `/admin/bookings` don't exist as files, so a hard refresh returns 404 unless you tell the host to fall back to `index.html`. Create **`FontEnd/public/staticwebapp.config.json`** (in `public/`, so Vite copies it into `dist/`):

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/avatar/*", "/audio/*", "/gallery/*"]
  },
  "mimeTypes": {
    ".vrm": "application/octet-stream",
    ".vrma": "application/octet-stream",
    ".glb": "model/gltf-binary"
  },
  "globalHeaders": {
    "Cache-Control": "no-cache"
  }
}
```

The `mimeTypes` block matters for your avatar: without it the `.vrm` and `.vrma` files can be served with a type the loader rejects.

Commit and push.

### 4.2 Create the Static Web App

1. Portal → **Create a resource → Static Web App**
2. Resource group `kingjegi-rg`, name `kingjegi-web`, plan type **Free**, region **East Asia**
3. Deployment source **GitHub** → authorize → organization / repository `KingJegiCS_System` / branch `main`
4. Build presets: **React**, then override:
   - **App location:** `/FontEnd`
   - **Api location:** *(leave blank — your API is App Service)*
   - **Output location:** `dist`
5. **Review + create**

Azure commits a workflow to `.github/workflows/azure-static-web-apps-*.yml` and runs the first build.

### 4.3 The gotcha that will cost you an hour: `VITE_API_BASE_URL` is baked in at build time

All 18 files under `FontEnd/src/api/` read `import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'`. Vite substitutes that **during `vite build`** — it is compiled into the bundle. Setting it in the Static Web App's *Environment variables* blade does nothing for a static SPA; without it, your deployed site will try to call `http://localhost:5258` and fail on every request.

Set it in the workflow instead. Pull the generated workflow file (`git pull`), and add an `env:` block to the deploy step:

```yaml
      - name: Build And Deploy
        id: builddeploy
        uses: Azure/static-web-apps-deploy@v1
        env:
          VITE_API_BASE_URL: https://kingjegi-api.azurewebsites.net
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_... }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/FontEnd"
          api_location: ""
          output_location: "dist"
```

Commit and push — that triggers a rebuild with the right base URL.

Verify after the build: open your site, DevTools → Network, and confirm the XHRs go to `kingjegi-api.azurewebsites.net`, not localhost.

### 4.4 Close the loop

Copy your Static Web App's URL (Portal → kingjegi-web → Overview) and use it for:

- `Cors__AllowedOrigins__0` on the API (Part 5) — without this every call is blocked
- `PayMongo__SuccessUrl` / `PayMongo__CancelUrl`
- optionally `JwtSettings__Audience`

---

## Part 5 — Production configuration in the Azure portal

### How the mapping works

ASP.NET Core reads environment variables into the same configuration tree as `appsettings.json`, with **`__` (double underscore)** standing in for the `:` separator. On Linux App Service `:` is not a legal variable name character, so always use `__`.

```
appsettings.json          →  App Service setting name
"JwtSettings": {"Key": …} →  JwtSettings__Key
"Cors": {"AllowedOrigins": ["https://…"]}  →  Cors__AllowedOrigins__0   ← arrays are indexed
```

App Settings **win over** `appsettings.json`, which is why the LocalDB string can stay in the file harmlessly.

### Setting them

Portal → **kingjegi-api** → **Settings → Environment variables**.

The **connection string** can go in either place — use the *Connection strings* tab with name **`DefaultConnection`** and type **`SQLAzure`** (the conventional choice; `GetConnectionString("DefaultConnection")` picks it up on Linux too), or as an app setting named `ConnectionStrings__DefaultConnection`. Pick one, not both.

Everything else goes in **App settings**. Add them all, then **Apply** once — each save restarts the app.

| Name | Value | Notes |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` | gates Scalar, the diag endpoints, and HTTPS redirect |
| `ConnectionStrings__DefaultConnection` | `Server=tcp:kingjegi-sql…Connection Timeout=60;` | or the Connection strings tab |
| `Cors__AllowedOrigins__0` | `https://<your>.azurestaticapps.net` | **no trailing slash** |
| `Uploads__RootPath` | `/home/site/data` | from 1.3 |
| `JwtSettings__Key` | your 64-char random string | app crashes at startup if absent |
| `JwtSettings__Issuer` | `https://kingjegi-api.azurewebsites.net` | changing it invalidates existing tokens |
| `JwtSettings__Audience` | `https://<your>.azurestaticapps.net` | must match what the API validates |
| `JwtSettings__ExpiryMinutes` | `120` | |
| `Seed__OwnerEmail` | a real mailbox you control | it is the Owner's OTP second factor |
| `Seed__OwnerPassword` | strong temp password | change it after first login |
| `Seed__OwnerFullName` | your name | optional |
| `Seed__OwnerPhone` | `09xxxxxxxxx` | optional |
| `Email__Host` | `smtp.gmail.com` | |
| `Email__Port` | `587` | |
| `Email__User` | your Gmail address | |
| `Email__Password` | Gmail **App Password** | a normal password will not authenticate |
| `Email__FromName` | `KingJegi Catering` | |
| `Otp__Enabled` | `true` | |
| `PayMongo__SecretKey` | `sk_live_…` | live key when you go live |
| `PayMongo__PublicKey` | `pk_live_…` | |
| `PayMongo__WebhookSecret` | `whsk_…` | **regenerate — see 5.1** |
| `PayMongo__BaseUrl` | `https://api.paymongo.com/v1/` | |
| `PayMongo__SuccessUrl` | `https://<your>.azurestaticapps.net/payment/success` | |
| `PayMongo__CancelUrl` | `https://<your>.azurestaticapps.net/payment/cancel` | |
| `Speech__ApiKey` | key from `kingjegi-speech` | |
| `Speech__Region` | `eastasia` | must match the resource's region or TTS silently produces no audio |
| `Speech__Voice` | `en-PH-RosaNeural` | |
| `Ai__ApiKey` | your Gemini key | absent → chat and voice return 503 |
| `Ai__Model` | `gemini-flash-latest` | |
| `Ai__Enabled` | `true` | |
| `SupportTriage__Enabled` | `true` / `false` | **decide explicitly** — see below |
| `WEBSITE_TIME_ZONE` | `Asia/Manila` | **see 5.2** |

**On `SupportTriage`:** that section only exists in `appsettings.Development.json`, so in production the `SupportTriageOptions` defaults apply, whatever those are. Since the worker calls Gemini on a timer and consumes quota, set `SupportTriage__Enabled` deliberately rather than inheriting a default. Same reasoning for `Notifications__*` and `DraftCleanup__*` if you tuned them locally.

### 5.1 Re-register the PayMongo webhook

Your webhook currently points at an ngrok tunnel. In the PayMongo dashboard, create a new webhook at:

```
https://kingjegi-api.azurewebsites.net/api/Payments/webhook/paymongo
```

PayMongo issues a **new signing secret** for the new webhook — the old `whsk_` will fail signature verification (`PaymentsController` logs exactly this: *"the secret belongs to a different/re-created webhook"*). Put the new one in `PayMongo__WebhookSecret` and delete the ngrok webhook.

### 5.2 Timezone

Linux containers default to UTC. Your booking system does date-sensitive work (lead days, slot locks, milestone schedules), and any `DateTime.Now` / `DateTime.Today` in that logic will be **8 hours off** in production while being correct on your machine. Setting `WEBSITE_TIME_ZONE=Asia/Manila` fixes the container clock — verify it after the restart by checking a timestamped log line against Manila time. The durable fix is storing and comparing UTC explicitly, which is worth a pass through the booking date logic when you have time.

### 5.3 Hardening (after it works)

- **App Settings are readable by anyone with portal access to the resource.** Move `PayMongo__SecretKey`, `Email__Password`, `Ai__ApiKey`, `Speech__ApiKey` and `JwtSettings__Key` into Azure Key Vault and reference them as `@Microsoft.KeyVault(SecretUri=https://…)` using the App Service's managed identity.
- **Drop the SQL password entirely:** enable the App Service system-assigned managed identity, create a contained user for it in the database, and switch the connection string to `Authentication=Active Directory Default` with no `User ID`/`Password`.
- Restrict the SQL server firewall from "all Azure services" to your App Service's outbound IPs, or use a private endpoint.

---

## Part 6 — Verify the deployment

Work down this list; each item catches a different failure from Part 1.

1. **API is alive** — hit a public endpoint (whatever the landing page calls for packages) at `https://kingjegi-api.azurewebsites.net/...` and get a 200 with JSON. First hit may take ~60s while the serverless DB resumes.
2. **Startup log is clean** — Log stream shows the `Assistant … Speech …` line with both `True`, and no `NO OWNER ACCOUNT EXISTS`.
3. **Owner login works end to end** — log in with the seeded credentials, receive the OTP email, complete the second factor. This exercises the DB, JWT config, and SMTP in one go.
4. **SPA deep link** — navigate to an admin route, then **hard refresh**. A 404 means `staticwebapp.config.json` didn't reach `dist/`.
5. **CORS** — any red CORS error in the console means `Cors__AllowedOrigins__0` doesn't exactly match the origin (check for a trailing slash).
6. **SignalR** — with a page open that uses `/hubs/payment`, DevTools → Network → WS should show a `101 Switching Protocols`. If you only see repeated `/negotiate` + long-polling requests, Web sockets is off.
7. **Payments** — run one ₱5,000 test booking end to end and confirm the webhook fires (the log line *"PayMongo webhook HIT"*) and the booking auto-confirms.
8. **Upload persistence** — upload a package image, then **restart the app**, then **publish again**, and confirm the image still renders. This is the 1.3 fix proving itself.
9. **Workers** — leave the site untouched for 30 minutes, then check the log stream for worker activity. Silence means Always On is off.

---

## Part 7 — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 500.30 / "container didn't start" | `JwtSettings` missing → `Get<JwtSettings>()!` throws at startup | set `JwtSettings__Key/Issuer/Audience`; read Log stream for the real exception |
| Error **40613**, "Database is not currently available" | serverless DB resuming from auto-pause, or still provisioning | transient — `Connection Timeout=60` and re-run. Do **not** reach for `EnableRetryOnFailure` without reading 1.6 first |
| First request times out, later ones fine | same — serverless resume | same; the durable fix is stage 2 of 1.6 |
| `Cannot open server 'kingjegi-sql' requested by the login` | firewall | kingjegi-sql → Networking → **Allow Azure services** = Yes |
| Browser: "blocked by CORS policy" | origin not in the allowlist | `Cors__AllowedOrigins__0`, exact match, no trailing slash |
| Frontend calls `localhost:5258` in production | `VITE_API_BASE_URL` not set at build time | add the `env:` block to the workflow (4.3), not the portal |
| 404 on refresh of `/admin/...` | no SPA fallback | `staticwebapp.config.json` in `FontEnd/public/` |
| SignalR falls back to polling | Web sockets off, or ARR affinity off | Configuration → General settings |
| Voice replies are silent | `Speech__Region` doesn't match the key's region | set `eastasia`; `Speechservice` swallows the error by design |
| Chat/voice return 503 | `Ai__ApiKey` missing, or the Gemini model id was retired | check the startup warning; update `Ai__Model` |
| Uploaded images 404 after publish | `wwwroot` replaced on deploy | `Uploads__RootPath=/home/site/data` (1.3) |
| Workers stop after ~20 min | app unloaded | Always On = On (requires B1+) |
| Redirect loop on every request | `UseHttpsRedirection` sees forwarded HTTP | `UseForwardedHeaders` first (1.2) |
| Dates off by 8 hours | container is UTC | `WEBSITE_TIME_ZONE=Asia/Manila` (5.2) |

---

## Cost summary

| | Tier | Monthly |
|---|---|---|
| App Service plan | B1 Basic | ~$13 |
| Azure SQL Database | free serverless offer | $0 |
| Static Web Apps | Free | $0 |
| Speech | F0 | $0 |
| **Total** | | **~$13/mo** |

Against the $100 Azure for Students credit that is roughly seven months. Watch the free SQL vCore-second budget on the database's Overview blade — with auto-pause selected you can't be billed for it, but you can be paused.

---

## Sources

- [Deploy Azure SQL Database for free](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql)
- [Azure SQL Database free offer FAQ](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer-faq?view=azuresql)
- [Quickstart: Deploy an ASP.NET web app to App Service](https://learn.microsoft.com/en-us/azure/app-service/quickstart-dotnetcore)
- [.NET runtime support on App Service Linux](https://github.com/Azure/app-service-linux-docs/blob/master/Runtime_Support/dot_net_core.md)
- [.NET 10 on Azure App Service](https://azure.github.io/AppService/2025/08/26/dotnet-10-preview-on-App-Service.html)
