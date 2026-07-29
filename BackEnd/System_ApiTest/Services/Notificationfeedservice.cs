using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;

namespace System_ApiTest.Services
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
        private readonly AppDbContext _db;

        public Notificationfeedservice(AppDbContext db) => _db = db;

        /// <summary>Kinds the worker sends to the customer.</summary>
        private static readonly NotificationKind[] CustomerKinds =
        {
            NotificationKind.PaymentDueSoon,
            NotificationKind.PaymentOverdue,
            NotificationKind.BookingConfirmed,
            NotificationKind.BookingCancelled
        };

        /// <summary>Kinds the worker sends to the owner.</summary>
        private static readonly NotificationKind[] StaffKinds =
        {
            NotificationKind.PaymentOverdueDigest,
            NotificationKind.RentalLowStock
        };

        /// <summary>The signed-in customer's feed, newest first.</summary>
        public async Task<NotificationFeedDto> GetForCustomerAsync(
            Guid customerId, int take, CancellationToken ct = default)
        {
            var query = _db.SentNotifications.AsNoTracking()
                .Where(n => CustomerKinds.Contains(n.Kind)
                            && n.BookingId != null
                            && n.Booking!.CustomerId == customerId);

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
                ? _db.SentNotifications.Where(n => CustomerKinds.Contains(n.Kind)
                                                   && n.BookingId != null
                                                   && n.Booking!.CustomerId == me)
                : _db.SentNotifications.Where(n => StaffKinds.Contains(n.Kind));

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

            var items = rows.Select(r =>
            {
                var (title, body) = Describe(r.Kind, r.Period, r.BookingName, r.EventDate, itemNames);
                return new NotificationResponseDto(
                    r.Id, r.Kind.ToString(), title, body, r.BookingId, r.BookingName, r.SentAt, r.ReadAt);
            }).ToList();

            return new NotificationFeedDto(unread, items);
        }

        private async Task<Dictionary<Guid, string>> ResolveRentalNamesAsync(
            IEnumerable<string> periods, CancellationToken ct)
        {
            var ids = periods
                .Select(p => p.Split(':')[0])
                .Select(s => Guid.TryParse(s, out var id) ? id : (Guid?)null)
                .Where(id => id is not null)
                .Select(id => id!.Value)
                .Distinct()
                .ToList();

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
            IReadOnlyDictionary<Guid, string> rentalNames)
        {
            var name = string.IsNullOrWhiteSpace(bookingName) ? "your booking" : $"\"{bookingName}\"";
            var when = eventDate is DateOnly d ? d.ToString("MMMM d, yyyy") : "the scheduled date";
            var due = DateOnly.TryParse(period, out var dueDate) ? dueDate.ToString("MMMM d, yyyy") : null;

            return kind switch
            {
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

        private static string DescribeLowStock(string period, IReadOnlyDictionary<Guid, string> rentalNames)
        {
            var head = period.Split(':')[0];
            if (Guid.TryParse(head, out var id) && rentalNames.TryGetValue(id, out var itemName))
                return $"\"{itemName}\" is at or below the low-stock threshold. Consider restocking.";
            return "A rental item is at or below the low-stock threshold. Check the Rentals tab.";
        }
    }
}
