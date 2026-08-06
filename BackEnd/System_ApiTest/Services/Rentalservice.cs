using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    public record RentalAvailability(int Total, int Outgoing, int Available);

    public class Rentalservice
    {
        private readonly AppDbContext _db;
        private readonly Bookingservice _bookingService;
        private readonly Notificationwriteservice _notifications;

        public Rentalservice(AppDbContext db, Bookingservice bookingService,
                             Notificationwriteservice notifications)
        {
            _db = db;
            _bookingService = bookingService;
            _notifications = notifications;
        }

        /// <summary>
        /// THE definition of "this stock isn't available to me" — the single expression
        /// every availability question in the system is answered with.
        ///
        /// It lives here as a shared predicate rather than being written out at each
        /// call site because it previously WAS written out three times, and the copies
        /// drifted: the confirm path grew a date filter while the catalog and the
        /// low-stock worker stayed date-blind, so the two disagreed about the same item.
        ///
        /// A line counts when the booking is live (Confirmed/Completed, not returned)
        /// AND either:
        ///
        ///   (a) its rental window overlaps the window being asked about — reserved for
        ///       an overlapping period, even if nothing has physically moved yet; or
        ///   (b) the goods are physically gone — Delivered, or Damaged and never coming
        ///       back — which holds whatever the dates say.
        ///
        /// Pass no window and only (b) applies: the honest answer to "how many are off
        /// the shelf right now", with future reservations excluded.
        ///
        /// Returned lines never count — those are back. Damaged deliberately still does,
        /// so a broken chair can't quietly become bookable again.
        /// </summary>
        /// <param name="excludeBookingId">The booking being placed, so it can't conflict with itself.</param>
        public static System.Linq.Expressions.Expression<Func<Rental, bool>> CommittedStock(
            Guid rentalItemId,
            Guid? excludeBookingId = null,
            DateOnly? windowStart = null,
            DateOnly? windowEnd = null)
        {
            // Captured as plain values so the expression stays translatable to SQL.
            var hasWindow = windowStart.HasValue && windowEnd.HasValue;
            var start = windowStart ?? default;
            var end = windowEnd ?? default;

            return r => r.RentalItemId == rentalItemId
                        && (excludeBookingId == null || r.BookingId != excludeBookingId)
                        && (r.Booking.Status == BookingStatus.Confirmed ||
                            r.Booking.Status == BookingStatus.Completed)
                        && r.DeliveryStatus != DeliveryStatus.Returned
                        && (
                             (hasWindow
                              && r.Booking.EventDate <= end
                              && (r.Booking.EndDate ?? r.Booking.EventDate) >= start)
                             || r.DeliveryStatus == DeliveryStatus.Delivered
                             || r.DeliveryStatus == DeliveryStatus.Damaged
                           );
        }

        /// <summary>
        /// Computes availability on demand (never stored).
        ///
        /// With a date window, answers "how many could a booking over these dates take?"
        /// — the same question, and the same rule, the confirm-time check applies, so the
        /// catalog can't advertise a shortage the confirm would allow (or vice versa).
        ///
        /// Without one, answers "how many are physically off the shelf right now?".
        /// Callers that know their dates should pass them.
        /// </summary>
        public async Task<RentalAvailability> GetAvailabilityAsync(
            Guid rentalItemId, DateOnly? from = null, DateOnly? to = null)
        {
            var item = await _db.RentalItems.FindAsync(rentalItemId)
                ?? throw new BookingRuleException("Rental item not found.");

            // A single date is a one-day window, not a half-open range.
            var (start, end) = (from, to ?? from);
            if (start.HasValue && end.HasValue)
            {
                var turnaround = Math.Max(0,
                    (await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync())?.RentalTurnaroundDays ?? 1);
                start = start.Value.AddDays(-turnaround);
                end = end.Value.AddDays(turnaround);
            }

            var outgoing = await _db.Rentals
                .Where(CommittedStock(rentalItemId, null, start, end))
                .SumAsync(r => (int?)r.Quantity) ?? 0;

            return new RentalAvailability(item.TotalQuantity, outgoing, item.TotalQuantity - outgoing);
        }

        /// <summary>
        /// Adds a rental line to a booking. The availability check runs inside a
        /// transaction that LOCKS the RentalItem row, so two concurrent bookings can't
        /// both pass the check and over-allocate the same stock.
        ///
        /// The lock hint is provider-specific. Shown: SQL Server (UPDLOCK, HOLDLOCK).
        /// PostgreSQL: replace the FROM clause with
        ///   SELECT * FROM "RentalItems" WHERE "Id" = {0} FOR UPDATE
        /// </summary>
        public async Task<Rental> AddRentalAsync(Guid bookingId, Guid rentalItemId, int quantity)
        {
            if (quantity <= 0)
                throw new BookingRuleException("Quantity must be greater than zero.");

            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            // Only editable (Pending) bookings can take new rental lines.
            await _bookingService.EnsureEditableAsync(bookingId);
            await _bookingService.EnsureNotDeliveryAsync(bookingId);

            await using var tx = await _db.Database.BeginTransactionAsync();

            // Lock the catalog row for the duration of the transaction.
            var item = (await _db.RentalItems
                .FromSqlInterpolated($"SELECT * FROM [RentalItems] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {rentalItemId}")
                .ToListAsync())
                .FirstOrDefault()
                ?? throw new BookingRuleException("Rental item not found.");

            if (!item.IsActive)
                throw new BookingRuleException("This rental item is inactive and cannot be added.");

            // Recompute outgoing inside the locked transaction.
            var outgoing = await _db.Rentals
                .Where(r => r.RentalItemId == rentalItemId
                            && (r.Booking.Status == BookingStatus.Confirmed ||
                                r.Booking.Status == BookingStatus.Completed)
                            && r.DeliveryStatus != DeliveryStatus.Returned)
                .SumAsync(r => (int?)r.Quantity) ?? 0;

            if (outgoing + quantity > item.TotalQuantity)
                throw new BookingRuleException(
                    $"Not enough stock for '{item.ItemName}': {item.TotalQuantity - outgoing} available, {quantity} requested.");

            var rental = new Rental
            {
                BookingId = bookingId,
                RentalItemId = rentalItemId,
                Quantity = quantity
            };
            _db.Rentals.Add(rental);

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            // The booking's total changed — recompute (no-op if already frozen).
            await _bookingService.RecomputeTotalAsync(bookingId);

            // Staff-facing: a rental line was added, which changes what has to be
            // pulled from stock and delivered.
            await _notifications.WriteAsync(
                NotificationKind.BookingItemAdded, bookingId,
                period: Notificationwriteservice.Occurrence(rental.Id));

            return rental;
        }

        /// <summary>
        /// Owner walks a rental through its real lifecycle:
        ///   Pending -> Delivered -> Returned (frees the stock) or Damaged (keeps
        ///   holding stock until resolved) -> Returned once repaired/written off.
        /// Returned is terminal. Backward moves and skipping delivery are rejected.
        /// </summary>
        public async Task<Rental> UpdateDeliveryStatusAsync(Guid bookingId, Guid rentalId, DeliveryStatus newStatus)
        {
            var rental = await _db.Rentals
                .Include(r => r.RentalItem)
                .FirstOrDefaultAsync(r => r.Id == rentalId && r.BookingId == bookingId)
                ?? throw new BookingRuleException("Rental line not found on this booking.");

            var ok = (rental.DeliveryStatus, newStatus) switch
            {
                (DeliveryStatus.Pending, DeliveryStatus.Delivered) => true,
                (DeliveryStatus.Delivered, DeliveryStatus.Returned) => true,
                (DeliveryStatus.Delivered, DeliveryStatus.Damaged) => true,
                (DeliveryStatus.Damaged, DeliveryStatus.Returned) => true,   // repaired / written off
                _ => false
            };
            if (!ok)
                throw new BookingRuleException(
                    $"Can't move a rental from {rental.DeliveryStatus} to {newStatus}. " +
                    "Valid moves: Pending→Delivered, Delivered→Returned/Damaged, Damaged→Returned.");

            rental.DeliveryStatus = newStatus;
            await _db.SaveChangesAsync();
            return rental;
        }
    }
}