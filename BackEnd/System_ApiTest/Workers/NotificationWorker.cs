using System_ApiTest.Application.Common.Interfaces;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Hubs;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Workers
{
    /// <summary>
    /// Notification settings, bound from configuration section "Notifications". Same
    /// options pattern as OtpOptions. Set Enabled=false to turn the worker off entirely.
    /// </summary>
    public class NotificationOptions
    {
        public const string SectionName = "Notifications";

        /// <summary>Master switch. When false the worker starts and immediately exits.</summary>
        public bool Enabled { get; set; } = true;

        /// <summary>How often the worker runs. Default 6 hours.</summary>
        public int IntervalHours { get; set; } = 6;

        /// <summary>A payment milestone this many days out (or fewer) triggers a "due soon" reminder.</summary>
        public int DueSoonDays { get; set; } = 3;

        /// <summary>Available rental stock at or below this count alerts the owner.</summary>
        public int LowStockThreshold { get; set; } = 5;

        /// <summary>
        /// When true, customer notifications also seed a virtual-assistant conversation
        /// (a short Gemini-written nudge) the customer can reply to in-app. Opt-in;
        /// default false. Falls back to a templated nudge if the assistant is unavailable.
        /// </summary>
        public bool ProactiveAssistant { get; set; } = false;
    }

    /// <summary>
    /// Proactive email notifications for state the system already computes: upcoming and
    /// overdue payment milestones, booking confirmations/cancellations, and low rental
    /// stock. Structure mirrors DenylistCleanupWorker exactly — a PeriodicTimer, a fresh
    /// DI scope per run, and a try/catch around each run so a failure never crashes the
    /// app (only shutdown cancellation propagates).
    ///
    /// Idempotent: every send is gated on and recorded in the Sentnotification ledger, so
    /// the same reminder never goes out twice. Runs harmlessly with email unconfigured —
    /// EmailService throws EmailSendException, which is caught and logged, and nothing is
    /// recorded so it retries once email is set up.
    /// </summary>
    public class NotificationWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<NotificationWorker> _logger;
        private readonly NotificationOptions _options;
        private readonly IHubContext<PaymentHub> _hub;

        public NotificationWorker(
            IServiceScopeFactory scopeFactory,
            ILogger<NotificationWorker> logger,
            IOptions<NotificationOptions> options,
            IHubContext<PaymentHub> hub)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _options = options.Value;
            _hub = hub;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.Enabled)
            {
                _logger.LogInformation("NotificationWorker is disabled via configuration; not running.");
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
                        throw;   // shutdown mid-run — let the outer handler finish quietly
                    }
                    catch (Exception ex)
                    {
                        // Never let a notification run crash the app; try again next cycle.
                        _logger.LogError(ex, "Notification run failed; will retry next cycle.");
                    }
                }
                while (await timer.WaitForNextTickAsync(stoppingToken));
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown: the host cancelled the wait. Nothing to do.
            }
        }

        /// <summary>One pass over all triggers, using a single scoped set of services.</summary>
        private async Task RunOnceAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var invoices = scope.ServiceProvider.GetRequiredService<Invoiceservice>();
            var rentals = scope.ServiceProvider.GetRequiredService<Rentalservice>();
            var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
            var assistant = scope.ServiceProvider.GetRequiredService<Assistantservice>();

            var today = DateOnly.FromDateTime(DateTime.Now);
            var ownerEmail = await db.Admins
                .Where(a => a.Role == AdminRole.Owner)
                .Select(a => a.Email)
                .FirstOrDefaultAsync(ct);

            await ProcessBookingsAsync(db, invoices, email, assistant, today, ownerEmail, ct);
            await ProcessLowStockAsync(db, rentals, email, today, ownerEmail, ct);
        }

        /// <summary>
        /// Confirmation/cancellation notices and payment-milestone reminders for upcoming
        /// bookings, plus a single owner digest of everything overdue this run.
        /// </summary>
        private async Task ProcessBookingsAsync(
            AppDbContext db, Invoiceservice invoices, IEmailService email, Assistantservice assistant,
            DateOnly today, string? ownerEmail, CancellationToken ct)
        {
            // Upcoming, non-draft bookings only (Draft has no invoice; past events are
            // out of scope so the first run doesn't email about historical bookings).
            var bookings = await db.Bookings
                .Include(b => b.Customer)
                .Where(b => b.EventDate >= today && b.Status != BookingStatus.Draft)
                .ToListAsync(ct);

            var overdueDigestLines = new List<string>();

            // When proactive assistant is on, tell the customer a chat is waiting in-app.
            var invite = _options.ProactiveAssistant
                ? "\n\nI've also started a chat for you in the app — reply there anytime and I can help (for example, pull up your payment schedule)."
                : string.Empty;

            foreach (var booking in bookings)
            {
                var customerId = booking.CustomerId;
                var customerEmail = booking.Customer.Email;
                var eventDate = booking.EventDate;

                // --- Confirmed / Cancelled (once per booking) ---
                if (booking.Status == BookingStatus.Confirmed)
                {
                    await TrySendAsync(db, email, booking.Id, NotificationKind.BookingConfirmed, "",
                        customerEmail,
                        $"Your KingJegi booking is confirmed — {booking.BookingName}",
                        $"Good news! Your booking \"{booking.BookingName}\" for {eventDate:MMMM d, yyyy} " +
                        "is confirmed. We look forward to serving you." + invite, ct);

                    await TrySeedNudgeAsync(db, assistant, customerId, booking.Id,
                        NotificationKind.BookingConfirmedNudge, "",
                        $"Booking confirmed — {booking.BookingName}",
                        $"Booking '{booking.BookingName}' for {eventDate:MMMM d, yyyy} has just been confirmed.",
                        $"Great news — your booking \"{booking.BookingName}\" for {eventDate:MMMM d, yyyy} is confirmed! " +
                        "Reply here if there's anything you'd like to review or adjust.", ct);
                }
                else if (booking.Status == BookingStatus.Cancelled)
                {
                    await TrySendAsync(db, email, booking.Id, NotificationKind.BookingCancelled, "",
                        customerEmail,
                        $"Your KingJegi booking was cancelled — {booking.BookingName}",
                        $"Your booking \"{booking.BookingName}\" for {eventDate:MMMM d, yyyy} " +
                        "has been cancelled. If this is unexpected, please contact us." + invite, ct);

                    await TrySeedNudgeAsync(db, assistant, customerId, booking.Id,
                        NotificationKind.BookingCancelledNudge, "",
                        $"Booking cancelled — {booking.BookingName}",
                        $"Booking '{booking.BookingName}' for {eventDate:MMMM d, yyyy} has been cancelled.",
                        $"Your booking \"{booking.BookingName}\" for {eventDate:MMMM d, yyyy} was cancelled. " +
                        "Reply here if this was unexpected or you'd like help rebooking.", ct);
                    continue;   // a cancelled booking has no payment schedule
                }

                // --- Payment milestones (only for payable bookings with an invoice) ---
                if (booking.Status is not (BookingStatus.Pending or BookingStatus.Confirmed))
                    continue;
                if (!await db.Invoices.AnyAsync(i => i.BookingId == booking.Id, ct))
                    continue;

                PaymentScheduleDto schedule;
                try
                {
                    schedule = await invoices.GetPaymentScheduleAsync(booking.Id, today);
                }
                catch (BookingRuleException)
                {
                    continue;   // no schedule (e.g. no invoice yet) — nothing to remind about
                }

                foreach (var m in schedule.Milestones)
                {
                    var period = m.DueDate.ToString("yyyy-MM-dd");

                    if (m.Status == "Overdue")
                    {
                        await TrySendAsync(db, email, booking.Id, NotificationKind.PaymentOverdue, period,
                            customerEmail,
                            $"Payment overdue — {booking.BookingName}",
                            $"The milestone \"{m.Label}\" (₱{m.CumulativeDue:N2} due by {m.DueDate:MMMM d, yyyy}) " +
                            $"is overdue. Verified payments so far: ₱{m.PaidToDate:N2}. Please settle at your earliest convenience." + invite, ct);

                        overdueDigestLines.Add(
                            $"• {booking.BookingName} — {m.Label}: ₱{m.CumulativeDue:N2} due {m.DueDate:yyyy-MM-dd}, paid ₱{m.PaidToDate:N2}");

                        await TrySeedNudgeAsync(db, assistant, customerId, booking.Id,
                            NotificationKind.PaymentOverdueNudge, period,
                            $"Overdue payment — {booking.BookingName}",
                            $"For booking '{booking.BookingName}', the payment milestone '{m.Label}' of ₱{m.CumulativeDue:N2} " +
                            $"was due on {m.DueDate:MMMM d, yyyy} and is now overdue. Paid so far: ₱{m.PaidToDate:N2}.",
                            $"Your payment \"{m.Label}\" (₱{m.CumulativeDue:N2}) for \"{booking.BookingName}\" was due on " +
                            $"{m.DueDate:MMMM d, yyyy} and is now overdue. Reply here and I can pull up your full payment schedule or options.", ct);
                    }
                    else if (m.Status == "Upcoming"
                             && m.DueDate >= today
                             && m.DueDate <= today.AddDays(_options.DueSoonDays))
                    {
                        await TrySendAsync(db, email, booking.Id, NotificationKind.PaymentDueSoon, period,
                            customerEmail,
                            $"Payment due soon — {booking.BookingName}",
                            $"A reminder that \"{m.Label}\" (₱{m.CumulativeDue:N2}) is due by {m.DueDate:MMMM d, yyyy} " +
                            $"for your booking \"{booking.BookingName}\"." + invite, ct);

                        var daysAway = m.DueDate.DayNumber - today.DayNumber;
                        await TrySeedNudgeAsync(db, assistant, customerId, booking.Id,
                            NotificationKind.PaymentDueSoonNudge, period,
                            $"Upcoming payment — {booking.BookingName}",
                            $"For booking '{booking.BookingName}', the payment milestone '{m.Label}' of ₱{m.CumulativeDue:N2} " +
                            $"is due on {m.DueDate:MMMM d, yyyy} ({daysAway} day(s) away). Paid so far: ₱{m.PaidToDate:N2}.",
                            $"Just a heads-up: your payment \"{m.Label}\" (₱{m.CumulativeDue:N2}) for \"{booking.BookingName}\" is due on " +
                            $"{m.DueDate:MMMM d, yyyy}, {daysAway} day(s) away. Reply here and I can pull up your payment schedule.", ct);
                    }
                }
            }

            // --- One owner digest of everything overdue this run (at most once per day) ---
            if (overdueDigestLines.Count > 0)
            {
                await TrySendAsync(db, email, null, NotificationKind.PaymentOverdueDigest,
                    today.ToString("yyyy-MM-dd"), ownerEmail,
                    $"KingJegi — {overdueDigestLines.Count} overdue payment(s)",
                    $"Overdue payments as of {today:MMMM d, yyyy}:\n\n" + string.Join("\n", overdueDigestLines), ct);
            }
        }

        /// <summary>Alerts the owner about each active rental item at/below the low-stock threshold.</summary>
        private async Task ProcessLowStockAsync(
            AppDbContext db, Rentalservice rentals, IEmailService email,
            DateOnly today, string? ownerEmail, CancellationToken ct)
        {
            var items = await db.RentalItems.Where(r => r.IsActive).ToListAsync(ct);

            foreach (var item in items)
            {
                var avail = await rentals.GetAvailabilityAsync(item.Id);
                if (avail.Available > _options.LowStockThreshold)
                    continue;

                await TrySendAsync(db, email, null, NotificationKind.RentalLowStock,
                    $"{item.Id:N}:{today:yyyy-MM-dd}", ownerEmail,
                    $"Low rental stock — {item.ItemName}",
                    $"\"{item.ItemName}\" is low: {avail.Available} available of {avail.Total} owned " +
                    $"({avail.Outgoing} currently out). Consider restocking or blocking new bookings.", ct);
            }
        }

        /// <summary>
        /// Sends one notification if it hasn't already been sent (per the ledger). Returns
        /// false without sending when there's no recipient, it's a duplicate, or email is
        /// unavailable — in the email-failure case nothing is recorded, so it retries next
        /// run. Records the send only after the mail actually goes out.
        /// </summary>
        private async Task<bool> TrySendAsync(
            AppDbContext db, IEmailService email,
            Guid? bookingId, NotificationKind kind, string period,
            string? to, string subject, string body, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(to))
                return false;

            var already = await db.SentNotifications
                .AnyAsync(n => n.BookingId == bookingId && n.Kind == kind && n.Period == period, ct);
            if (already)
                return false;

            try
            {
                await email.SendAsync(to, subject, body);
            }
            catch (EmailSendException ex)
            {
                _logger.LogWarning(ex,
                    "Notification {Kind} to {To} not sent (email unavailable); will retry next cycle.", kind, to);
                return false;
            }

            var entry = db.SentNotifications.Add(new Sentnotification
            {
                BookingId = bookingId,
                Kind = kind,
                Period = period
            });

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // A concurrent run recorded the same notification first — the unique index
                // rejected our duplicate. The mail went out once; treat as done. Detach the
                // rejected row so it doesn't re-fail every later save this run.
                entry.State = EntityState.Detached;
                _logger.LogInformation("Notification {Kind} was recorded concurrently; skipping duplicate ledger row.", kind);
            }

            return true;
        }

        /// <summary>
        /// Seeds a proactive assistant conversation for the customer (opt-in via
        /// Notifications:ProactiveAssistant), deduped through the same ledger as the flat
        /// emails but under a distinct nudge Kind. The nudge text is written live by
        /// Gemini from the factual <paramref name="context"/>; on any assistant failure it
        /// falls back to the templated <paramref name="fallback"/>, so a provider outage
        /// never blocks the run. The seeded turn is a Model message the customer can reply
        /// to via /api/assistant/chat.
        /// </summary>
        private async Task TrySeedNudgeAsync(
            AppDbContext db, Assistantservice assistant,
            Guid customerId, Guid bookingId, NotificationKind kind, string period,
            string title, string context, string fallback, CancellationToken ct)
        {
            if (!_options.ProactiveAssistant)
                return;

            var already = await db.SentNotifications
                .AnyAsync(n => n.BookingId == bookingId && n.Kind == kind && n.Period == period, ct);
            if (already)
                return;

            string nudge;
            try
            {
                nudge = await assistant.GenerateProactiveNudgeAsync(context, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Proactive nudge generation failed for {Kind}; using templated fallback.", kind);
                nudge = fallback;
            }

            var conversation = new Conversation { CustomerId = customerId, Title = Truncate(title, 200) };
            var conversationEntry = db.Conversations.Add(conversation);
            var messageEntry = db.ConversationMessages.Add(new Conversationmessage
            {
                ConversationId = conversation.Id,
                Ordinal = 0,
                Role = ConversationRole.Model,
                Text = nudge
            });
            var ledgerEntry = db.SentNotifications.Add(new Sentnotification
            {
                BookingId = bookingId,
                Kind = kind,
                Period = period
            });

            var seeded = false;
            try
            {
                await db.SaveChangesAsync(ct);
                seeded = true;
            }
            catch (DbUpdateException)
            {
                // Concurrently seeded — the ledger's unique index rejected our duplicate.
                // Detach all three so the shared context stays clean for later saves.
                conversationEntry.State = EntityState.Detached;
                messageEntry.State = EntityState.Detached;
                ledgerEntry.State = EntityState.Detached;
                _logger.LogInformation("Proactive nudge {Kind} was seeded concurrently; skipping duplicate.", kind);
            }

            if (!seeded)
                return;

            // Live nudge: reuse the existing PaymentHub broadcast pattern. Payload carries
            // only opaque ids (no booking names on the wire) — the customer's own client
            // filters by customerId and jumps to Messages. A hub hiccup must not fail the run.
            try
            {
                await _hub.Clients.All.SendAsync(
                    "AssistantNudge",
                    new { customerId, conversationId = conversation.Id },
                    ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Failed to push AssistantNudge signal for {Kind}.", kind);
            }
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
    }
}




