using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;

namespace System_ApiTest.Workers
{
    /// <summary>
    /// Gateway-reconcile settings, bound from configuration section "GatewayReconcile".
    /// Same options pattern as DraftCleanupOptions.
    /// </summary>
    public class GatewayReconcileOptions
    {
        public const string SectionName = "GatewayReconcile";

        /// <summary>Master switch. When false the worker starts and immediately exits.</summary>
        public bool Enabled { get; set; } = true;

        /// <summary>How often the sweep runs. Default 5 minutes.</summary>
        public int IntervalMinutes { get; set; } = 5;

        /// <summary>
        /// A payment must be at least this old before the sweep asks about it — gives the
        /// webhook a head start so the normal case never costs a gateway call.
        /// </summary>
        public int MinAgeMinutes { get; set; } = 3;

        /// <summary>
        /// Payments older than this are left alone. PayMongo sessions expire within a day
        /// and an expired one is settled on the first sweep that sees it, so anything this
        /// old that is still Pending needs a human, not another retry.
        /// </summary>
        public int MaxAgeDays { get; set; } = 7;

        /// <summary>Upper bound on gateway calls per sweep.</summary>
        public int MaxPerRun { get; set; } = 25;
    }

    /// <summary>
    /// Settles Pending online payments whose webhook never arrived, by asking PayMongo.
    ///
    /// The webhook is the only thing that used to flip a gateway payment to Success, so a
    /// misregistered webhook URL, a rotated signing secret, or downtime at the wrong moment
    /// left captured money Pending forever. This sweep is the backstop; the return page's
    /// /verify call is the immediate path, and the webhook remains the fastest of all.
    /// Settling goes through the same idempotent ApplyGateway* pipeline as the webhook.
    ///
    /// Skips payments already seen as paid but blocked by a booking rule
    /// ("paid — NEEDS ATTENTION"): those are waiting on the owner, and re-running them
    /// every few minutes would only repeat the same rejection.
    ///
    /// Structure mirrors DraftCleanupWorker — a PeriodicTimer, a fresh DI scope per run,
    /// and a try/catch around each run so a failure never crashes the app.
    /// </summary>
    public class GatewayReconcileWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<GatewayReconcileWorker> _logger;
        private readonly GatewayReconcileOptions _options;

        public GatewayReconcileWorker(
            IServiceScopeFactory scopeFactory,
            ILogger<GatewayReconcileWorker> logger,
            IOptions<GatewayReconcileOptions> options)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _options = options.Value;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.Enabled)
            {
                _logger.LogInformation("GatewayReconcileWorker is disabled via configuration; not running.");
                return;
            }

            var minutes = _options.IntervalMinutes > 0 ? _options.IntervalMinutes : 5;
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(minutes));
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
                        _logger.LogError(ex, "Gateway reconcile run failed; will retry next cycle.");
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
            var payments = scope.ServiceProvider.GetRequiredService<Paymentservice>();

            // PaymentDateTime is stamped with DateTime.Now at checkout, so compare the same way.
            var now = DateTime.Now;
            var newest = now.AddMinutes(-Math.Max(0, _options.MinAgeMinutes));
            var oldest = now.AddDays(-Math.Max(1, _options.MaxAgeDays));

            var candidateIds = await db.Payments
                .Where(p => p.Status == PaymentStatus.Pending
                         && p.GatewayProvider != null
                         && p.GatewaySessionId != null
                         && p.PaymentDateTime <= newest
                         && p.PaymentDateTime >= oldest
                         && (p.GatewayStatusRaw == null || !p.GatewayStatusRaw.StartsWith("paid")))
                .OrderBy(p => p.PaymentDateTime)
                .Select(p => p.Id)
                .Take(Math.Max(1, _options.MaxPerRun))
                .ToListAsync(ct);

            if (candidateIds.Count == 0) return;

            var today = DateOnly.FromDateTime(now);
            foreach (var id in candidateIds)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var outcome = await payments.ReconcileGatewayPaymentAsync(id, today);
                    if (!outcome.StartsWith("still awaiting"))
                        _logger.LogInformation("Gateway reconcile settled payment {PaymentId}: {Outcome}", id, outcome);
                }
                catch (PayMongoException ex)
                {
                    // Gateway unreachable or misconfigured: every remaining call would fail
                    // the same way, so stop this sweep and try again next cycle.
                    _logger.LogWarning(ex, "Gateway reconcile stopped: PayMongo lookup failed ({Detail}).", ex.ResponseBody);
                    return;
                }
                catch (Exception ex)
                {
                    // One bad row must not abort the whole sweep.
                    _logger.LogWarning(ex, "Could not reconcile gateway payment {PaymentId}.", id);
                }
            }
        }
    }
}
