using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using System_ApiTest.Application.Services;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Workers
{
    /// <summary>
    /// Support drafting settings, bound from configuration section "SupportTriage". Same
    /// options pattern as NotificationOptions. Enabled defaults to FALSE: drafting is
    /// opt-in, like NotificationOptions.ProactiveAssistant, so the inbox behaves exactly
    /// as it always has until someone deliberately turns this on.
    /// </summary>
    public class SupportTriageOptions
    {
        public const string SectionName = "SupportTriage";

        /// <summary>Master switch. When false the worker starts and immediately exits.</summary>
        public bool Enabled { get; set; } = false;

        /// <summary>How often the worker sweeps for undrafted messages. Default 2 minutes.</summary>
        public int IntervalMinutes { get; set; } = 2;

        /// <summary>Most drafts generated in one sweep. Bounds the burst against Gemini's free tier.</summary>
        public int MaxDraftsPerRun { get; set; } = 10;

        /// <summary>How many recent messages of the thread the model is shown. Default 8.</summary>
        public int TranscriptTurns { get; set; } = 8;

        /// <summary>
        /// Per-customer hourly ceiling on drafts, enforced through the "support-draft"
        /// keyed Airatelimiter. Low on purpose: a customer posting rapid-fire messages
        /// should not be able to drain the shared free-tier quota. A refused draft is not
        /// an error — the admin simply gets an empty composer, exactly as today.
        /// </summary>
        public int MaxDraftsPerCustomerPerHour { get; set; } = 3;
    }

    /// <summary>
    /// Sweeps the support inbox for customer messages that nobody has drafted a reply to
    /// yet, and writes one Supportdraft per message for staff to review. Structure mirrors
    /// NotificationWorker exactly — a PeriodicTimer, a fresh DI scope per run, and a
    /// try/catch around each run so a failure never crashes the host.
    ///
    /// <para>
    /// This worker SENDS NOTHING. It writes Supportdraft rows and nothing else: it does not
    /// touch thread.LastMessageAt, does not record a Sentnotification, and does not
    /// broadcast on the hub. Every draft it produces still has to pass a human in the admin
    /// panel before any customer sees a word of it.
    /// </para>
    ///
    /// <para>
    /// Swept rather than triggered inline from SupportController.SendAsCustomer: drafting
    /// costs two Gemini calls, and putting those on the customer's POST would add that
    /// latency and failure surface to a request whose output the customer never sees. One
    /// interval of delay costs nothing, because a human has to open the thread anyway.
    /// (A Channel&lt;Guid&gt; fed by the controller would be near-instant; it is more moving
    /// parts than this needs. Future work, deliberately not built.)
    /// </para>
    /// </summary>
    public class SupportTriageWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<SupportTriageWorker> _logger;
        private readonly SupportTriageOptions _options;
        private readonly Airatelimiter _limiter;

        public SupportTriageWorker(
            IServiceScopeFactory scopeFactory,
            ILogger<SupportTriageWorker> logger,
            IOptions<SupportTriageOptions> options,
            [FromKeyedServices(Airatelimiter.SupportDraftKey)] Airatelimiter limiter)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _options = options.Value;
            _limiter = limiter;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.Enabled)
            {
                _logger.LogInformation("SupportTriageWorker is disabled via configuration; not running.");
                return;
            }

            var minutes = _options.IntervalMinutes > 0 ? _options.IntervalMinutes : 2;
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
                        throw;   // shutdown mid-run — let the outer handler finish quietly
                    }
                    catch (Exception ex)
                    {
                        // Never let a triage run crash the app; try again next cycle.
                        _logger.LogError(ex, "Support triage run failed; will retry next cycle.");
                    }
                }
                while (await timer.WaitForNextTickAsync(stoppingToken));
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown: the host cancelled the wait. Nothing to do.
            }
        }

        /// <summary>One sweep: find undrafted customer messages and draft a reply to each.</summary>
        private async Task RunOnceAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var assistant = scope.ServiceProvider.GetRequiredService<Assistantservice>();

            var max = _options.MaxDraftsPerRun > 0 ? _options.MaxDraftsPerRun : 10;

            // A message is worth drafting when it is the customer's, it is the LAST word in
            // an open thread, and nothing has been drafted against it yet. Restricting to
            // the newest message is what stops the worker drafting replies to messages the
            // customer has already followed up on.
            var pending = await db.SupportMessages
                .Where(m => m.Sender == SupportSender.Customer
                         && m.Thread.Status == SupportThreadStatus.Open
                         && !db.SupportDrafts.Any(d => d.TriggerMessageId == m.Id)
                         && !db.SupportMessages.Any(later => later.ThreadId == m.ThreadId
                                                          && later.CreatedAt > m.CreatedAt))
                .OrderByDescending(m => m.CreatedAt)
                .Take(max)
                .Select(m => new { MessageId = m.Id, m.ThreadId, CustomerId = m.Thread.CustomerId })
                .ToListAsync(ct);

            if (pending.Count == 0)
                return;

            var turns = _options.TranscriptTurns > 0 ? _options.TranscriptTurns : 8;
            var drafted = 0;
            var failed = 0;

            foreach (var item in pending)
            {
                ct.ThrowIfCancellationRequested();

                // Quota is spent per customer, not per staff member. A refusal is a normal
                // outcome, not an error: no row, no log noise, retried next sweep.
                if (!_limiter.TryConsume(item.CustomerId, _options.MaxDraftsPerCustomerPerHour, out _))
                    continue;

                var recent = await db.SupportMessages
                    .Where(m => m.ThreadId == item.ThreadId)
                    .OrderByDescending(m => m.CreatedAt)
                    .Take(turns)
                    .ToListAsync(ct);
                recent.Reverse();   // oldest first, the order the model reads

                var transcript = recent
                    .Select(m => (FromCustomer: m.Sender == SupportSender.Customer, Text: m.Text))
                    .ToList();

                try
                {
                    var result = await assistant.DraftSupportReplyAsync(item.CustomerId, transcript, ct);

                    db.SupportDrafts.Add(new Supportdraft
                    {
                        ThreadId = item.ThreadId,
                        TriggerMessageId = item.MessageId,
                        Text = Truncate(result.Text, 4000),
                        Topic = result.Topic,
                        Urgency = result.Urgency,
                        ToolsUsed = Truncate(string.Join(",", result.ToolsUsed), 200),
                        Status = SupportDraftStatus.Pending
                    });
                    drafted++;
                }
                catch (AssistantUnavailableException ex)
                {
                    // The Failed row is the point: without it this message would be retried
                    // every sweep forever. The admin panel renders it as no draft at all.
                    _logger.LogWarning(ex,
                        "Support draft unavailable for message {MessageId}; recording a failed draft.",
                        item.MessageId);

                    db.SupportDrafts.Add(new Supportdraft
                    {
                        ThreadId = item.ThreadId,
                        TriggerMessageId = item.MessageId,
                        Text = string.Empty,
                        Topic = SupportTopic.Other,
                        Urgency = SupportUrgency.Routine,
                        ToolsUsed = string.Empty,
                        Status = SupportDraftStatus.Failed
                    });
                    failed++;
                }

                // Saved per message so a later failure in this sweep cannot lose the drafts
                // already produced. Only SupportDrafts rows are touched — the thread and its
                // messages, LastMessageAt included, are read-only to this worker.
                await db.SaveChangesAsync(ct);
            }

            if (drafted > 0 || failed > 0)
                _logger.LogInformation(
                    "Support triage: {Drafted} draft(s) written, {Failed} failed, {Candidates} candidate(s) considered.",
                    drafted, failed, pending.Count);
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
    }
}
