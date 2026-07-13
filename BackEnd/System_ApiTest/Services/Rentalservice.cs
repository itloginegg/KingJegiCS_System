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

        public Rentalservice(AppDbContext db, Bookingservice bookingService)
        {
            _db = db;
            _bookingService = bookingService;
        }

        /// <summary>
        /// Computes availability on demand (never stored):
        ///   outgoing  = sum of quantities on rental lines for this item whose Booking
        ///               is NOT Cancelled
        ///   available = total_quantity − outgoing
        /// </summary>
        public async Task<RentalAvailability> GetAvailabilityAsync(Guid rentalItemId)
        {
            var item = await _db.RentalItems.FindAsync(rentalItemId)
                ?? throw new BookingRuleException("Rental item not found.");

            var outgoing = await _db.Rentals
                .Where(r => r.RentalItemId == rentalItemId
                            && (r.Booking.Status == BookingStatus.Confirmed ||
                                r.Booking.Status == BookingStatus.Completed)
                            && r.DeliveryStatus != DeliveryStatus.Returned)
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