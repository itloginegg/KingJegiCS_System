using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Workers
{
    /// <summary>
    /// Background worker that purges expired revoked-token rows once a day, so the
    /// JWT denylist doesn't grow forever. Register in Program.cs:
    ///   builder.Services.AddHostedService&lt;DenylistCleanupWorker&gt;();
    /// (The scoped TokenDenylistService is resolved per run via a scope, because a
    /// hosted service is a singleton and can't inject scoped services directly.)
    /// </summary>
    public class DenylistCleanupWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<DenylistCleanupWorker> _logger;

        public DenylistCleanupWorker(IServiceScopeFactory scopeFactory, ILogger<DenylistCleanupWorker> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
            try
            {
                do
                {
                    try
                    {
                        using var scope = _scopeFactory.CreateScope();
                        var denylist = scope.ServiceProvider.GetRequiredService<Tokendenylistservice>();
                        var purged = await denylist.PurgeExpiredAsync(DateTime.UtcNow);
                        if (purged > 0)
                            _logger.LogInformation("Denylist cleanup purged {Count} expired token(s).", purged);

                        var otp = scope.ServiceProvider.GetRequiredService<OtpService>();
                        var otpPurged = await otp.PurgeStaleAsync();
                        if (otpPurged > 0)
                            _logger.LogInformation("OTP cleanup purged {Count} stale code(s).", otpPurged);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;   // shutdown mid-purge — let the outer handler finish quietly
                    }
                    catch (Exception ex)
                    {
                        // Never let cleanup failures crash the app; try again next cycle.
                        _logger.LogError(ex, "Denylist cleanup failed; will retry next cycle.");
                    }
                }
                while (await timer.WaitForNextTickAsync(stoppingToken));
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown: the host cancelled the wait. Nothing to do.
            }
        }
    }
}


