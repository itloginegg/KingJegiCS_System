using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    public record RentalAvailability(int Total, int Outgoing, int Available);

    public class Rentalservice
    {
        private readonly IApplicationDbContext _db;
        private readonly Bookingservice _bookingService;
        private readonly Notificationwriteservice _notifications;

        public Rentalservice(IApplicationDbContext db, Bookingservice bookingService,
                             Notificationwriteservice notifications)
        {
            _db = db;
            _bookingService = bookingService;
            _notifications = notifications;
        }

        /// <summary>
        /// THE definition of "this stock isn't available to me" � the single expression
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
        ///   (a) its rental window overlaps the window being asked about � reserved for
        ///       an overlapping period, even if nothing has physically moved yet; or
        ///   (b) the goods are physically gone � Delivered, or Damaged and never coming
        ///       back � which holds whatever the dates say.
        ///
        /// Pass no window and only (b) applies: the honest answer to "how many are off
        /// the shelf right now", with future reservations excluded.
        ///
        /// Returned lines never count � those are back. Damaged deliberately still does,
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
        /// The allocation half of "this stock isn't available to me" — the companion to
        /// <see cref="CommittedStock"/>, for catalog lines on a booking's resource plan.
        ///
        /// It is a SEPARATE expression, not a change to CommittedStock, because that one
        /// is typed to the Rental table. Every availability question must sum both or it
        /// will under-report what is committed.
        ///
        /// Deliberately stricter than CommittedStock in two ways:
        ///
        ///   1. Confirmed only, never Completed. A rental line tracks DeliveryStatus and
        ///      so knows when goods came back; an allocation line has no such flag, so
        ///      counting Completed would hold stock forever. Completing the event
        ///      releases it, as does cancelling (a Cancelled booking is not Confirmed).
        ///   2. With no window, every Confirmed allocation still counts. CommittedStock
        ///      can fall back to "physically gone" (Delivered/Damaged) when it has no
        ///      dates; an allocation has no equivalent, and silently dropping future
        ///      commitments is exactly the double-booking this feature exists to stop.
        /// </summary>
        /// <param name="excludeBookingId">The booking being planned, so it can't conflict with itself.</param>
        public static System.Linq.Expressions.Expression<Func<BookingResourceAllocationLine, bool>> CommittedAllocation(
            Guid rentalItemId,
            Guid? excludeBookingId = null,
            DateOnly? windowStart = null,
            DateOnly? windowEnd = null)
        {
            var hasWindow = windowStart.HasValue && windowEnd.HasValue;
            var start = windowStart ?? default;
            var end = windowEnd ?? default;

            return l => l.RentalItemId == rentalItemId
                        && (excludeBookingId == null || l.Allocation.BookingId != excludeBookingId)
                        && l.Allocation.Booking.Status == BookingStatus.Confirmed
                        && (
                             !hasWindow
                             || (l.Allocation.Booking.EventDate <= end
                                 && (l.Allocation.Booking.EndDate ?? l.Allocation.Booking.EventDate) >= start)
                           );
        }

        /// <summary>
        /// Outgoing quantity for EVERY rental item in one pass, for screens that price
        /// a whole catalog at once (the resource-plan pickers) and would otherwise fire
        /// two queries per item.
        ///
        /// This is the set-based twin of the two expressions above and MUST be changed
        /// with them — it is deliberately placed here, immediately below them, because
        /// the last time this rule lived in more than one file the copies drifted and
        /// the catalog disagreed with confirm about the same item.
        /// </summary>
        public async Task<Dictionary<Guid, int>> OutgoingByItemAsync(
            Guid? excludeBookingId = null,
            DateOnly? windowStart = null,
            DateOnly? windowEnd = null)
        {
            var hasWindow = windowStart.HasValue && windowEnd.HasValue;
            var start = windowStart ?? default;
            var end = windowEnd ?? default;

            // Mirrors CommittedStock: live booking, not returned, and either overlapping
            // the window or physically gone.
            var rentals = await _db.Rentals
                .Where(r => (excludeBookingId == null || r.BookingId != excludeBookingId)
                            && (r.Booking.Status == BookingStatus.Confirmed ||
                                r.Booking.Status == BookingStatus.Completed)
                            && r.DeliveryStatus != DeliveryStatus.Returned
                            && (
                                 (hasWindow
                                  && r.Booking.EventDate <= end
                                  && (r.Booking.EndDate ?? r.Booking.EventDate) >= start)
                                 || r.DeliveryStatus == DeliveryStatus.Delivered
                                 || r.DeliveryStatus == DeliveryStatus.Damaged
                               ))
                .GroupBy(r => r.RentalItemId)
                .Select(g => new { g.Key, Qty = g.Sum(r => r.Quantity) })
                .ToDictionaryAsync(x => x.Key, x => x.Qty);

            // Mirrors CommittedAllocation: Confirmed only, and no physically-gone escape
            // hatch, so a windowless call still counts every outstanding commitment.
            var allocations = await _db.BookingResourceAllocationLines
                .Where(l => l.RentalItemId != null
                            && (excludeBookingId == null || l.Allocation.BookingId != excludeBookingId)
                            && l.Allocation.Booking.Status == BookingStatus.Confirmed
                            && (
                                 !hasWindow
                                 || (l.Allocation.Booking.EventDate <= end
                                     && (l.Allocation.Booking.EndDate ?? l.Allocation.Booking.EventDate) >= start)
                               ))
                .GroupBy(l => l.RentalItemId!.Value)
                .Select(g => new { g.Key, Qty = g.Sum(l => l.Quantity) })
                .ToDictionaryAsync(x => x.Key, x => x.Qty);

            foreach (var (itemId, qty) in allocations)
                rentals[itemId] = rentals.GetValueOrDefault(itemId) + qty;

            return rentals;
        }

        /// <summary>
        /// Computes availability on demand (never stored).
        ///
        /// With a date window, answers "how many could a booking over these dates take?"
        /// � the same question, and the same rule, the confirm-time check applies, so the
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

            // Both halves: priced rental lines AND unpriced resource-plan allocations.
            // Summing only the first is what let a Confirmed package booking hold zero
            // chairs while its allocation said forty.
            var outgoing = await _db.Rentals
                .Where(CommittedStock(rentalItemId, null, start, end))
                .SumAsync(r => (int?)r.Quantity) ?? 0;

            outgoing += await _db.BookingResourceAllocationLines
                .Where(CommittedAllocation(rentalItemId, null, start, end))
                .SumAsync(l => (int?)l.Quantity) ?? 0;

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

            // Retries: the execution strategy re-runs this whole block after a transient
            // failure, and EF accepts changes into the change tracker on SaveChanges even
            // when the surrounding transaction later rolls back. Clearing at the top of
            // each attempt makes the retry start from database truth instead of the last
            // attempt's leftovers — without it the Rental added below is still tracked as
            // Added and gets inserted a second time, double-deducting stock.
            var strategy = _db.Database.CreateExecutionStrategy();
            var rental = await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();

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

                var line = new Rental
                {
                    BookingId = bookingId,
                    RentalItemId = rentalItemId,
                    Quantity = quantity
                };
                _db.Rentals.Add(line);

                await _db.SaveChangesAsync();
                await tx.CommitAsync();
                return line;
            });

            // The booking's total changed � recompute (no-op if already frozen).
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
        public async Task<Rental> UpdateDeliveryStatusAsync(
            Guid bookingId, Guid rentalId, DeliveryStatus newStatus, string? damageNote = null)
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
                    "Valid moves: Pending?Delivered, Delivered?Returned/Damaged, Damaged?Returned.");

            rental.DeliveryStatus = newStatus;

            // Recorded only on the move to Damaged. A later repair (Damaged -> Returned)
            // deliberately leaves the note in place so the item's history survives.
            if (newStatus == DeliveryStatus.Damaged)
                rental.DamageNote = damageNote?.Trim();

            await _db.SaveChangesAsync();
            return rental;
        }

        /// <summary>
        /// Every rental line still needing an admin action, for the returns/check-in list:
        /// Pending (not yet handed over), Delivered (out), Damaged (out, awaiting repair or
        /// write-off). Returned is excluded � that line is done.
        ///
        /// Pending is included deliberately. A list of only Delivered lines would start
        /// empty and stay empty, because nothing else in the system moves a line off
        /// Pending � that transition has to be reachable from here too.
        ///
        /// Only Confirmed/Completed bookings count, matching CommittedStock: a cancelled
        /// booking holds no stock, so its lines are not the returns desk's problem.
        ///
        /// Drives the admin returns list, which would otherwise need one request per
        /// booking to assemble the same thing client-side.
        /// </summary>
        public async Task<List<OutstandingRentalLineDto>> GetOutstandingAsync()
        {
            return await _db.Rentals
                .AsNoTracking()
                .Include(r => r.RentalItem)
                .Include(r => r.Booking).ThenInclude(b => b.Customer)
                .Where(r => r.DeliveryStatus != DeliveryStatus.Returned
                         && (r.Booking.Status == BookingStatus.Confirmed
                          || r.Booking.Status == BookingStatus.Completed))
                .OrderBy(r => r.Booking.EventDate)
                .ThenBy(r => r.RentalItem.ItemName)
                .Select(r => new OutstandingRentalLineDto(
                    r.Id,
                    r.BookingId,
                    r.Booking.Customer.FullName,
                    r.Booking.EventDate,
                    r.Booking.EndDate,
                    r.RentalItemId,
                    r.RentalItem.ItemName,
                    r.Quantity,
                    r.DeliveryStatus.ToString(),
                    r.DamageNote))
                .ToListAsync();
        }
    }
}




