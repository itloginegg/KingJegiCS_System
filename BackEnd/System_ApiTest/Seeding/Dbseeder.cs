using System_ApiTest.Application.Common.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Seeding
{
    /// <summary>
    /// Idempotent startup seeding: ensures the singleton Owner account and the
    /// SystemSettings row exist. Runs on every start; creates only what's missing,
    /// so it survives Drop-Database rebuilds with no manual re-seed scripts.
    ///
    /// Call from Program.cs AFTER building the app, BEFORE app.Run():
    ///   await DbSeeder.SeedAsync(app.Services);
    ///
    /// Owner credentials come from configuration (user-secrets, NEVER source control):
    ///   dotnet user-secrets set "Seed:OwnerEmail" "owner-real-mailbox@gmail.com"
    ///   dotnet user-secrets set "Seed:OwnerPassword" "a-strong-temporary-password"
    ///   dotnet user-secrets set "Seed:OwnerFullName" "Your Name"        (optional)
    ///   dotnet user-secrets set "Seed:OwnerPhone" "09xxxxxxxxx"         (optional)
    ///
    /// The email MUST be a mailbox you control — with login OTP enabled it is the
    /// Owner's second factor; a placeholder email means the Owner cannot log in.
    /// </summary>
    public static class DbSeeder
    {
        /// <summary>Waits between attempts, in order; the last delay repeats until seeding succeeds.</summary>
        private static readonly TimeSpan[] RetryDelays =
        {
            TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(60),
        };

        /// <summary>
        /// Runs <see cref="SeedAsync"/> until it succeeds or the app shuts down. Never throws:
        /// a failure is logged and retried, so an unreachable or waking database can't crash
        /// the process. Meant to be started after the app is listening (see Program.cs).
        /// </summary>
        public static async Task SeedWithRetryAsync(IServiceProvider services, CancellationToken stopping)
        {
            var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DbSeeder");

            for (var attempt = 1; !stopping.IsCancellationRequested; attempt++)
            {
                try
                {
                    await SeedAsync(services);
                    if (attempt > 1)
                        logger.LogInformation("Startup seeding succeeded on attempt {Attempt}.", attempt);
                    return;
                }
                catch (Exception ex) when (!stopping.IsCancellationRequested)
                {
                    var delay = RetryDelays[Math.Min(attempt - 1, RetryDelays.Length - 1)];
                    logger.LogWarning(ex,
                        "Startup seeding failed on attempt {Attempt} (database unreachable or still waking up). " +
                        "The API keeps running; retrying in {Delay}s.", attempt, (int)delay.TotalSeconds);
                    try { await Task.Delay(delay, stopping); }
                    catch (OperationCanceledException) { return; }
                }
            }
        }

        public static async Task SeedAsync(IServiceProvider services)
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            var logger = scope.ServiceProvider
                .GetRequiredService<ILoggerFactory>().CreateLogger("DbSeeder");

            // ---------- SystemSettings singleton ----------
            if (!await db.SystemSettings.AnyAsync())
            {
                // Entity property initializers supply the business defaults
                // (no tax — VAT removed, 50% deposit, capacity 3, ?5,000 fee, 3h buffer,
                // 7/1 lead days, and the resource-suggestion ratios).
                db.SystemSettings.Add(new Systemsettings());
                await db.SaveChangesAsync();
                logger.LogInformation("Seeded SystemSettings singleton with defaults.");
            }

            // ---------- Owner account (singleton) ----------
            if (!await db.Admins.AnyAsync(a => a.Role == AdminRole.Owner))
            {
                var email = config["Seed:OwnerEmail"];
                var password = config["Seed:OwnerPassword"];

                if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
                {
                    // Loud but non-fatal: the app runs, but nobody can administer it.
                    logger.LogError(
                        "NO OWNER ACCOUNT EXISTS and Seed:OwnerEmail / Seed:OwnerPassword are not set. " +
                        "Set them in user-secrets and restart to create the Owner.");
                    return;
                }

                var owner = new Admin
                {
                    FullName = config["Seed:OwnerFullName"] ?? "Owner",
                    Email = email.Trim().ToLowerInvariant(),
                    PhoneNumber = config["Seed:OwnerPhone"] ?? "",
                    Role = AdminRole.Owner
                };
                owner.PasswordHash = new PasswordHasher<Admin>().HashPassword(owner, password);

                db.Admins.Add(owner);
                await db.SaveChangesAsync();
                logger.LogInformation(
                    "Seeded Owner account for {Email}. With OTP enabled, login codes go to that mailbox.",
                    owner.Email);
            }
        }
    }

}



