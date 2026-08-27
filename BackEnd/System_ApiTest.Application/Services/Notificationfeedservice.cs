using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Turns the NotificationWorker's send ledger into a readable in-app feed.
    ///
    /// Nothing new is generated here — every row is something the worker already emailed.
    /// The feed simply makes those visible in the app, scoped to whoever is asking:
    ///
    ///   Customer  → the booking-scoped kinds for THEIR bookings.
    ///   Owner/Assistant → the owner-directed kinds (overdue digest, low stock), which are
    ///                     the ones the worker actually addresses to staff.
    ///
    /// The *Nudge kinds are excluded on purpose: those aren't messages, they're markers
    /// that an assistant conversation was seeded. The conversation itself already shows up
    /// under Messages, so listing them here would double-report the same event.
    /// </summary>
    public class Notificationfeedservice
    {
        private readonly IApplicationDbContext _db;

        public Notificationfeedservice(IApplicationDbContext db) => _db = db;

        /// <summary>Kinds addressed to the customer.</summary>
        private static readonly NotificationKind[] CustomerKinds =
        {
            // Written by the polling worker
            NotificationKind.PaymentDueSoon,
            NotificationKind.PaymentOverdue,
            NotificationKind.BookingConfirmed,
            NotificationKind.BookingCancelled,
            // Written inline at the moment they happen (Notificationwriteservice)
            NotificationKind.PaymentConfirmed,
            NotificationKind.RefundApproved,
            NotificationKind.RefundDenied,
            NotificationKind.SupportMessageFromStaff,
            NotificationKind.AnnouncementPosted
        };

        /// <summary>Kinds addressed to the Owner/Assistant shared inbox.</summary>
        private static readonly NotificationKind[] StaffKinds =
        {
            // Written by the polling worker
            NotificationKind.PaymentOverdueDigest,
            NotificationKind.RentalLowStock,
            // Written inline at the moment they happen (Notificationwriteservice)
            NotificationKind.BookingCreated,
            NotificationKind.BookingCompleted,
            NotificationKind.BookingCancelledStaff,
            NotificationKind.BookingCancellationRequested,
            NotificationKind.PaymentRecorded,
            NotificationKind.RefundRequested,
            NotificationKind.BookingItemAdded,
            NotificationKind.SupportMessageFromCustomer
        };

        /// <summary>The signed-in customer's feed, newest first.</summary>
        public async Task<NotificationFeedDto> GetForCustomerAsync(
            Guid customerId, int take, CancellationToken ct = default)
        {
            var query = _db.SentNotifications.AsNoTracking().Where(OwnedBy(customerId));

            return await BuildAsync(query, take, ct);
        }

        /// <summary>The staff feed (Owner and Assistant share one inbox), newest first.</summary>
        public async Task<NotificationFeedDto> GetForStaffAsync(int take, CancellationToken ct = default)
        {
            var query = _db.SentNotifications.AsNoTracking()
                .Where(n => StaffKinds.Contains(n.Kind));

            return await BuildAsync(query, take, ct);
        }

        /// <summary>
        /// Marks one row read, but only if it belongs to the caller's feed — the same
        /// scoping predicate as the read, so a customer can't clear a staff alert (or
        /// another customer's) by guessing an id. Returns false when it isn't theirs.
        /// </summary>
        public async Task<bool> MarkReadAsync(Guid id, Guid? customerId, CancellationToken ct = default)
        {
            var row = await Scoped(customerId).FirstOrDefaultAsync(n => n.Id == id, ct);
            if (row is null) return false;

            if (row.ReadAt is null)
            {
                row.ReadAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
            }
            return true;
        }

        /// <summary>Marks every unread row in the caller's feed read. Returns how many changed.</summary>
        public async Task<int> MarkAllReadAsync(Guid? customerId, CancellationToken ct = default)
        {
            var rows = await Scoped(customerId).Where(n => n.ReadAt == null).ToListAsync(ct);
            if (rows.Count == 0) return 0;

            var now = DateTime.UtcNow;
            foreach (var row in rows) row.ReadAt = now;
            await _db.SaveChangesAsync(ct);
            return rows.Count;
        }

        /// <summary>
        /// The tracked query for whichever feed the caller owns: a customer's own
        /// booking-scoped rows, or the staff rows when customerId is null.
        /// </summary>
        private IQueryable<Sentnotification> Scoped(Guid? customerId) =>
            customerId is Guid me
                ? _db.SentNotifications.Where(OwnedBy(me))
                : _db.SentNotifications.Where(n => StaffKinds.Contains(n.Kind));

        /// <summary>
        /// A customer owns a notification either through the booking it concerns (how
        /// every worker-written row is addressed) or through CustomerId directly (how
        /// rows with no booking — support-chat replies — are addressed). One predicate,
        /// shared by the read and the mark-read paths, so they can never disagree about
        /// what belongs to whom.
        /// </summary>
        private static System.Linq.Expressions.Expression<Func<Sentnotification, bool>> OwnedBy(Guid customerId) =>
            n => CustomerKinds.Contains(n.Kind)
                 && ((n.BookingId != null && n.Booking!.CustomerId == customerId)
                     || n.CustomerId == customerId);

        private async Task<NotificationFeedDto> BuildAsync(
            IQueryable<Sentnotification> query, int take, CancellationToken ct)
        {
            take = Math.Clamp(take, 1, 100);

            var unread = await query.CountAsync(n => n.ReadAt == null, ct);

            var rows = await query
                .OrderByDescending(n => n.SentAt)
                .Take(take)
                .Select(n => new
                {
                    n.Id,
                    n.Kind,
                    n.Period,
                    n.SentAt,
                    n.ReadAt,
                    n.BookingId,
                    BookingName = n.Booking == null ? null : n.Booking.BookingName,
                    EventDate = n.Booking == null ? (DateOnly?)null : n.Booking.EventDate
                })
                .ToListAsync(ct);

            // Low-stock rows key their Period as "{rentalItemId:N}:{yyyy-MM-dd}" — resolve
            // those ids to names in one round trip so the feed reads like the email did.
            var itemNames = await ResolveRentalNamesAsync(
                rows.Where(r => r.Kind == NotificationKind.RentalLowStock).Select(r => r.Period), ct);

            // Money rows key their Period on the payment id, so the amount can be shown
            // without the ledger having to store (and risk staling) a copy of it.
            var amounts = await ResolvePaymentAmountsAsync(
                rows.Where(r => PaymentKeyedKinds.Contains(r.Kind)).Select(r => r.Period), ct);

            // Announcements are the one kind whose text is authored rather than derived,
            // so it's read from the Announcement row the Period points at.
            var announcements = await ResolveAnnouncementsAsync(
                rows.Where(r => r.Kind == NotificationKind.AnnouncementPosted).Select(r => r.Period), ct);

            var items = rows.Select(r =>
            {
                var (title, body) = Describe(r.Kind, r.Period, r.BookingName, r.EventDate, itemNames, amounts, announcements);
                return new NotificationResponseDto(
                    r.Id, r.Kind.ToString(), title, body, r.BookingId, r.BookingName, r.SentAt, r.ReadAt,
                    ParseLeadingId(r.Period));
            }).ToList();

            return new NotificationFeedDto(unread, items);
        }

        /// <summary>Kinds whose Period begins with a payment id.</summary>
        private static readonly NotificationKind[] PaymentKeyedKinds =
        {
            NotificationKind.PaymentRecorded,
            NotificationKind.PaymentConfirmed,
            NotificationKind.RefundRequested,
            NotificationKind.RefundApproved,
            NotificationKind.RefundDenied
        };

        /// <summary>
        /// Amounts for payment-keyed rows, read live rather than copied into the ledger —
        /// a refund can change what a payment is worth after the notification was written,
        /// and the feed should show what's true now.
        /// </summary>
        private async Task<Dictionary<Guid, (decimal Amount, decimal Refunded)>> ResolvePaymentAmountsAsync(
            IEnumerable<string> periods, CancellationToken ct)
        {
            var ids = ParseLeadingIds(periods);
            if (ids.Count == 0) return new Dictionary<Guid, (decimal, decimal)>();

            return await _db.Payments.AsNoTracking()
                .Where(p => ids.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => (p.AmountPaid, p.RefundedAmount), ct);
        }

        /// <summary>
        /// The entity id a Period points at, or null when it doesn't carry one.
        ///
        /// Every instantaneous kind keys its Period as "{id:N}" or "{id:N}:{suffix}",
        /// so one rule covers all of them. Kinds whose Period is a date (the payment
        /// reminders, the overdue digest) or empty (the booking kinds) simply fail to
        /// parse and return null — which is correct: those route on BookingId.
        /// </summary>
        private static Guid? ParseLeadingId(string period)
        {
            var head = period.Split(':')[0];
            return Guid.TryParse(head, out var id) ? id : null;
        }

        /// <summary>Pulls the leading GUID out of each "{id:N}[:suffix]" Period value.</summary>
        private static List<Guid> ParseLeadingIds(IEnumerable<string> periods) =>
            periods
                .Select(p => p.Split(':')[0])
                .Select(s => Guid.TryParse(s, out var id) ? id : (Guid?)null)
                .Where(id => id is not null)
                .Select(id => id!.Value)
                .Distinct()
                .ToList();

        /// <summary>
        /// Titles and bodies for announcement rows, read live from the Announcement
        /// table rather than copied into each ledger row — one broadcast writes a row per
        /// customer, and duplicating 2 KB of text across all of them (and staling it if
        /// the wording is ever corrected) would be the wrong trade.
        /// </summary>
        private async Task<Dictionary<Guid, (string Title, string Body)>> ResolveAnnouncementsAsync(
            IEnumerable<string> periods, CancellationToken ct)
        {
            var ids = ParseLeadingIds(periods);
            if (ids.Count == 0) return new Dictionary<Guid, (string, string)>();

            return await _db.Announcements.AsNoTracking()
                .Where(a => ids.Contains(a.Id))
                .ToDictionaryAsync(a => a.Id, a => (a.Title, a.Body), ct);
        }

        private async Task<Dictionary<Guid, string>> ResolveRentalNamesAsync(
            IEnumerable<string> periods, CancellationToken ct)
        {
            var ids = ParseLeadingIds(periods);
            if (ids.Count == 0) return new Dictionary<Guid, string>();

            return await _db.RentalItems.AsNoTracking()
                .Where(r => ids.Contains(r.Id))
                .ToDictionaryAsync(r => r.Id, r => r.ItemName, ct);
        }

        /// <summary>
        /// Re-derives the display text for a ledger row. Mirrors the wording the
        /// NotificationWorker emailed, minus the amounts — those live on the invoice, and
        /// the ledger doesn't capture them, so the feed points at the booking instead of
        /// restating a figure it can't verify.
        /// </summary>
        private static (string Title, string Body) Describe(
            NotificationKind kind, string period, string? bookingName, DateOnly? eventDate,
            IReadOnlyDictionary<Guid, string> rentalNames,
            IReadOnlyDictionary<Guid, (decimal Amount, decimal Refunded)> amounts,
            IReadOnlyDictionary<Guid, (string Title, string Body)> announcements)
        {
            var name = string.IsNullOrWhiteSpace(bookingName) ? "your booking" : $"\"{bookingName}\"";
            var when = eventDate is DateOnly d ? d.ToString("MMMM d, yyyy") : "the scheduled date";
            var due = DateOnly.TryParse(period, out var dueDate) ? dueDate.ToString("MMMM d, yyyy") : null;

            // Staff-facing copy says "the booking"; customer-facing says "your booking".
            var theBooking = string.IsNullOrWhiteSpace(bookingName) ? "a booking" : $"\"{bookingName}\"";
            var money = PaymentAmount(period, amounts);
            var paid = money is decimal m ? $"₱{m:N2}" : "a payment";

            return kind switch
            {
                // ---- Instantaneous, staff-facing ----
                NotificationKind.BookingCreated => (
                    "New booking",
                    $"{theBooking} was created{(eventDate is null ? "" : $" for {when}")}. Review it in the Bookings tab."),

                NotificationKind.BookingCompleted => (
                    "Booking completed",
                    $"{theBooking} was marked completed."),

                NotificationKind.BookingCancelledStaff => (
                    "Booking cancelled",
                    $"{theBooking} for {when} was cancelled."),

                NotificationKind.BookingCancellationRequested => (
                    "Cancellation requested",
                    $"The customer asked to cancel {theBooking} for {when}. Review it in the Bookings tab."),

                NotificationKind.PaymentRecorded => (
                    "Payment recorded",
                    $"{paid} was recorded against {theBooking} and is awaiting verification."),

                NotificationKind.RefundRequested => (
                    "Refund requested",
                    $"A refund was requested on {paid} for {theBooking}. Review it in the Payments tab."),

                NotificationKind.BookingItemAdded => (
                    "Item added to a booking",
                    $"A new line was added to {theBooking}. Check the order before it's packed."),

                NotificationKind.SupportMessageFromCustomer => (
                    "New support message",
                    "A customer sent a message in support chat."),

                // ---- Instantaneous, customer-facing ----
                NotificationKind.PaymentConfirmed => (
                    "Payment confirmed",
                    $"We've verified {paid} for {name}. Thank you!"),

                NotificationKind.RefundApproved => (
                    "Refund issued",
                    RefundIssuedBody(period, amounts, name)),

                NotificationKind.RefundDenied => (
                    "Refund request denied",
                    $"Your refund request on {paid} for {name} was declined. See the Payments tab for the reason."),

                NotificationKind.SupportMessageFromStaff => (
                    "Reply from King Jegi",
                    "Our team replied in support chat. Open the chat bubble to read it."),

                // The only kind whose copy is authored by an admin rather than derived
                // from the event. Falls back if the announcement row has since gone.
                NotificationKind.AnnouncementPosted =>
                    Announcement(period, announcements),

                // ---- Polling worker's kinds ----
                NotificationKind.BookingConfirmed => (
                    "Booking confirmed",
                    $"{name} for {when} is confirmed."),

                NotificationKind.BookingCancelled => (
                    "Booking cancelled",
                    $"{name} for {when} was cancelled. Contact us if this was unexpected."),

                NotificationKind.PaymentDueSoon => (
                    "Payment due soon",
                    due is null
                        ? $"A payment milestone for {name} is coming up."
                        : $"A payment milestone for {name} is due by {due}."),

                NotificationKind.PaymentOverdue => (
                    "Payment overdue",
                    due is null
                        ? $"A payment milestone for {name} is overdue."
                        : $"The payment milestone for {name} due {due} is overdue."),

                NotificationKind.PaymentOverdueDigest => (
                    "Overdue payments digest",
                    due is null
                        ? "One or more payment milestones are overdue. Review the Payments tab."
                        : $"Overdue payment summary for {due}. Review the Payments tab."),

                NotificationKind.RentalLowStock => (
                    "Low rental stock",
                    DescribeLowStock(period, rentalNames)),

                _ => (kind.ToString(), "See the Bookings tab for details.")
            };
        }

        private static (string Title, string Body) Announcement(
            string period, IReadOnlyDictionary<Guid, (string Title, string Body)> announcements)
        {
            var head = period.Split(':')[0];
            if (Guid.TryParse(head, out var id) && announcements.TryGetValue(id, out var a))
                return (a.Title, a.Body);
            return ("Announcement", "King Jegi posted an announcement.");
        }

        /// <summary>The gross amount of the payment a Period points at, if it resolved.</summary>
        private static decimal? PaymentAmount(
            string period, IReadOnlyDictionary<Guid, (decimal Amount, decimal Refunded)> amounts)
        {
            var head = period.Split(':')[0];
            return Guid.TryParse(head, out var id) && amounts.TryGetValue(id, out var row)
                ? row.Amount
                : null;
        }

        /// <summary>
        /// Refund copy quotes the amount REFUNDED, not the payment's original value —
        /// those differ on a partial refund, and the refunded figure is the one the
        /// customer is waiting to see.
        /// </summary>
        private static string RefundIssuedBody(
            string period, IReadOnlyDictionary<Guid, (decimal Amount, decimal Refunded)> amounts, string name)
        {
            var head = period.Split(':')[0];
            if (Guid.TryParse(head, out var id) && amounts.TryGetValue(id, out var row) && row.Refunded > 0m)
                return $"A refund of ₱{row.Refunded:N2} was issued on your payment for {name}.";
            return $"A refund was issued on your payment for {name}.";
        }

        private static string DescribeLowStock(string period, IReadOnlyDictionary<Guid, string> rentalNames)
        {
            var head = period.Split(':')[0];
            if (Guid.TryParse(head, out var id) && rentalNames.TryGetValue(id, out var itemName))
                return $"\"{itemName}\" is at or below the low-stock threshold. Consider restocking.";
            return "A rental item is at or below the low-stock threshold. Check the Rentals tab.";
        }
    }
}





