using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.Hubs;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    /// <summary>
    /// Records instantaneous notifications — the ones the polling NotificationWorker
    /// structurally cannot see.
    ///
    /// The worker's kinds describe ONGOING STATE ("this milestone is still unpaid N days
    /// later", "stock is still low"), which an interval sweep can rediscover at any time.
    /// Everything written here is a DISCRETE ACT that happened once at a known instant —
    /// a payment succeeded, a refund was requested, a line was added. There is no later
    /// moment at which a poller could infer it happened, so the service method that
    /// performs the act records it inline.
    ///
    /// Two rules hold everywhere in this class:
    ///
    ///   1. A notification must NEVER break the operation that triggered it. Every write
    ///      is wrapped; a failure is logged and swallowed, and the caller proceeds.
    ///   2. The SignalR broadcast carries no data — only a nudge to refetch. Writes often
    ///      happen inside an ambient transaction, so a broadcast can outrun (or outlive) a
    ///      rollback; a client that refetches simply sees nothing new, which is correct.
    /// </summary>
    public class Notificationwriteservice
    {
        private readonly AppDbContext _db;
        private readonly IHubContext<PaymentHub> _hub;
        private readonly ILogger<Notificationwriteservice> _logger;

        public Notificationwriteservice(
            AppDbContext db, IHubContext<PaymentHub> hub, ILogger<Notificationwriteservice> logger)
        {
            _db = db;
            _hub = hub;
            _logger = logger;
        }

        /// <summary>
        /// Writes one notification row and nudges connected clients.
        ///
        /// <paramref name="period"/> is the per-kind dedup discriminator carried by the
        /// existing unique index on (BookingId, Kind, Period). For once-per-booking events
        /// pass ""; for repeatable ones pass something that distinguishes occurrences (a
        /// payment id, a message id) — see <see cref="Occurrence"/>.
        /// </summary>
        public async Task WriteAsync(
            NotificationKind kind,
            Guid? bookingId = null,
            Guid? customerId = null,
            string period = "",
            CancellationToken ct = default)
        {
            var row = new Sentnotification
            {
                Kind = kind,
                BookingId = bookingId,
                CustomerId = customerId,
                Period = period
            };

            _db.SentNotifications.Add(row);

            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex)
            {
                // Either a genuine duplicate (the unique index doing its job for a
                // once-only kind) or a transient write failure. Detach so the rejected
                // row can't re-fail every later SaveChanges in the caller's transaction.
                _db.Entry(row).State = EntityState.Detached;
                _logger.LogInformation(ex,
                    "Notification {Kind} for booking {BookingId} was not recorded (duplicate or write failure).",
                    kind, bookingId);
                return;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _db.Entry(row).State = EntityState.Detached;
                _logger.LogWarning(ex, "Unexpected failure recording notification {Kind}.", kind);
                return;
            }

            await BroadcastAsync(ct);
        }

        /// <summary>
        /// A Period value for events that can legitimately recur for the same booking —
        /// repeated refund requests on one payment, every chat message, each added line.
        /// The id anchors it to the thing that happened; the timestamp keeps a second
        /// occurrence from colliding with the first under the unique index.
        /// </summary>
        public static string Occurrence(Guid id) =>
            $"{id:N}:{DateTime.UtcNow:yyyyMMddHHmmssfff}";

        /// <summary>
        /// Tells every connected client that the feed changed. Deliberately payload-free:
        /// the recipient refetches /api/Notifications, which applies its own role and
        /// ownership scoping — so this broadcast can't leak a notification to someone
        /// whose feed wouldn't otherwise contain it.
        /// </summary>
        private async Task BroadcastAsync(CancellationToken ct)
        {
            try
            {
                await _hub.Clients.All.SendAsync("NotificationCreated", ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Live delivery is best-effort — the row is already persisted and will
                // appear the next time the bell is opened.
                _logger.LogDebug(ex, "Failed to broadcast NotificationCreated.");
            }
        }
    }
}
