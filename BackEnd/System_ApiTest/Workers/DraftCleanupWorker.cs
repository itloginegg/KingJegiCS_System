using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Workers
{
    /// <summary>
    /// Draft-cleanup settings, bound from configuration section "DraftCleanup".
    /// Same options pattern as NotificationOptions.
    /// </summary>
    public class DraftCleanupOptions
    {
        public const string SectionName = "DraftCleanup";

        /// <summary>Master switch. When false the worker starts and immediately exits.</summary>
        public bool Enabled { get; set; } = true;

        /// <summary>How often the sweep runs. Default 6 hours.</summary>
        public int IntervalHours { get; set; } = 6;

        /// <summary>
        /// A Draft older than this is considered abandoned. Generous by default: the
        /// browser-side delete is what handles the common case, and this is only the
        /// backstop for drafts whose delete never fired.
        /// </summary>
        public int AbandonedAfterHours { get; set; } = 24;
    }

    /// <summary>
    /// Deletes abandoned Draft bookings on a timer.
    ///
    /// The booking wizard tries to delete its own Draft when the customer leaves, but
    /// that call is best-effort by nature — a closing tab can cut it short, and a
    /// crashed or force-quit browser never sends it at all. This sweep is what makes
    /// cleanup actually reliable; the client-side delete just makes it immediate.
    ///
    /// Only ever touches Drafts, which by definition have no history, invoice or
    /// payments (those all begin at Submit). Anything further along is left alone.
    ///
    /// Structure mirrors DenylistCleanupWorker exactly — a PeriodicTimer, a fresh DI
    /// scope per run, and a try/catch around each run so a failure never crashes the
    /// app (only shutdown cancellation propagates).
    /// </summary>
    public class DraftCleanupWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<DraftCleanupWorker> _logger;
        private readonly DraftCleanupOptions _options;

        public DraftCleanupWorker(
            IServiceScopeFactory scopeFactory,
            ILogger<DraftCleanupWorker> logger,
            IOptions<DraftCleanupOptions> options)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _options = options.Value;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.Enabled)
            {
                _logger.LogInformation("DraftCleanupWorker is disabled via configuration; not running.");
                return;
            }

            var hours = _options.IntervalHours > 0 ? _options.IntervalHours : 6;
            using var timer = new PeriodicTimer(TimeSpan.FromHours(hours));
            try
            {
                do
                {
                    try
                    {
                        await RunOnceAsync(stoppingToken);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;   // shutdown mid-sweep — let the outer handler finish quietly
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Draft cleanup run failed; will retry next cycle.");
                    }
                }
                while (await timer.WaitForNextTickAsync(stoppingToken));
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown: the host cancelled the wait. Nothing to do.
            }
        }

        private async Task RunOnceAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var bookings = scope.ServiceProvider.GetRequiredService<Bookingservice>();

            // CreatedAt is stamped in local time (DateTime.Now) like every other date in
            // the booking flow, so the cutoff is computed the same way.
            var cutoff = DateTime.Now.AddHours(-Math.Max(1, _options.AbandonedAfterHours));

            var staleIds = await db.Bookings
                .Where(b => b.Status == BookingStatus.Draft && b.CreatedAt < cutoff)
                .Select(b => b.Id)
                .ToListAsync(ct);

            if (staleIds.Count == 0) return;

            var deleted = 0;
            foreach (var id in staleIds)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    // Re-checks Draft status inside the service, so a draft submitted
                    // between the query above and this call is safely skipped.
                    await bookings.DeleteDraftAsync(id);
                    deleted++;
                }
                catch (BookingRuleException)
                {
                    // No longer a Draft, or already gone. Both are fine.
                }
                catch (Exception ex)
                {
                    // One bad row must not abort the whole sweep.
                    _logger.LogWarning(ex, "Could not delete abandoned draft {BookingId}.", id);
                }
            }

            if (deleted > 0)
                _logger.LogInformation("Draft cleanup deleted {Count} abandoned draft booking(s).", deleted);
        }
    }
}



