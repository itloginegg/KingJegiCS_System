using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    /// <summary>
    /// Reads and writes a booking's operational resource plan — furniture, service-ware
    /// and staff counts.
    ///
    /// This service deliberately never calls Bookingservice.EnsureEditableAsync. That
    /// guard exists to stop priced lines changing after a booking leaves Draft, and it
    /// is right to do so; but a resource plan is exactly the thing an admin needs to
    /// edit on a CONFIRMED booking, and it carries no price, consumes no stock and never
    /// touches TotalAmount or the invoice. Routing it through the rentals/services
    /// tables would have made the whole feature throw on every booking that mattered.
    ///
    /// The only lifecycle guard is against Cancelled — planning resources for an event
    /// that isn't happening is meaningless. Completed is still allowed, so the record of
    /// what was actually sent stays correctable after the fact.
    /// </summary>
    public class Bookingresourceservice
    {
        private readonly AppDbContext _db;

        public Bookingresourceservice(AppDbContext db) => _db = db;

        /// <summary>Reads the plan (null if never saved) plus a computed suggestion.</summary>
        public async Task<BookingResourcesDto> GetAsync(Guid bookingId)
        {
            var booking = await _db.Bookings
                .AsNoTracking()
                .Include(b => b.ResourceAllocation)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var allocation = booking.ResourceAllocation;

            return new BookingResourcesDto(
                booking.Id,
                booking.EventType?.ToString(),
                booking.GuestCount,
                allocation is null ? null : ToCounts(allocation),
                allocation?.IsApproved ?? false,
                allocation?.ApprovedAt,
                allocation?.UpdatedAt,
                Suggest(booking.GuestCount, settings));
        }

        /// <summary>
        /// Creates or updates the plan. Returns the same shape as <see cref="GetAsync"/>
        /// so the caller can refresh from one response.
        /// </summary>
        public async Task<BookingResourcesDto> SaveAsync(
            Guid bookingId, SaveResourceAllocationDto dto, Guid? actingUserId)
        {
            var booking = await _db.Bookings
                .Include(b => b.ResourceAllocation)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status == BookingStatus.Cancelled)
                throw new BookingRuleException("A cancelled booking has no resources to allocate.");

            var allocation = booking.ResourceAllocation;
            if (allocation is null)
            {
                // Created lazily: most bookings never get a plan, and a row of zeros
                // would be indistinguishable from a real "allocate nothing" decision.
                allocation = new BookingResourceAllocation { BookingId = booking.Id };
                _db.BookingResourceAllocations.Add(allocation);
            }

            allocation.LongTables = dto.LongTables;
            allocation.RoundTables = dto.RoundTables;
            allocation.Chairs = dto.Chairs;
            allocation.Plates = dto.Plates;
            allocation.Spoons = dto.Spoons;
            allocation.Forks = dto.Forks;
            allocation.Waiters = dto.Waiters;
            allocation.Servers = dto.Servers;
            allocation.Others = dto.Others;
            allocation.UpdatedAt = DateTime.UtcNow;

            // Stamp the approver only on the transition into approved, so re-saving an
            // already-approved plan doesn't rewrite who signed it off or when.
            if (dto.IsApproved && !allocation.IsApproved)
            {
                allocation.ApprovedAt = DateTime.UtcNow;
                allocation.ApprovedByUserId = actingUserId;
            }
            else if (!dto.IsApproved)
            {
                allocation.ApprovedAt = null;
                allocation.ApprovedByUserId = null;
            }
            allocation.IsApproved = dto.IsApproved;

            await _db.SaveChangesAsync();

            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            return new BookingResourcesDto(
                booking.Id,
                booking.EventType?.ToString(),
                booking.GuestCount,
                ToCounts(allocation),
                allocation.IsApproved,
                allocation.ApprovedAt,
                allocation.UpdatedAt,
                Suggest(booking.GuestCount, settings));
        }

        private static ResourceCountsDto ToCounts(BookingResourceAllocation a) => new(
            a.LongTables, a.RoundTables, a.Chairs,
            a.Plates, a.Spoons, a.Forks,
            a.Waiters, a.Servers, a.Others);

        /// <summary>
        /// Scales the SystemSettings ratios to a guest count.
        ///
        /// Null when there is no guest count to scale from — a food delivery has none,
        /// and suggesting zero of everything would look like a real recommendation.
        ///
        /// "Others" is always 0: it is the catch-all for staff the named roles don't
        /// cover, so there is no ratio that could predict it.
        /// </summary>
        private static ResourceCountsDto? Suggest(int? guestCount, Systemsettings? s)
        {
            if (guestCount is null or <= 0 || s is null) return null;

            var pax = guestCount.Value;

            // Guarded against zero even though a DB check constraint forbids it: this
            // would be a divide-by-zero, and a settings row written before that
            // constraint existed would still be accepted by the database.
            static int PerGroup(int pax, int per) =>
                per <= 0 ? 0 : (int)Math.Ceiling(pax / (double)per);

            static int PerHead(int pax, decimal factor) =>
                factor <= 0 ? 0 : (int)Math.Ceiling(pax * (double)factor);

            var utensils = PerHead(pax, s.UtensilsPerGuest);

            return new ResourceCountsDto(
                LongTables: PerGroup(pax, s.GuestsPerLongTable),
                RoundTables: PerGroup(pax, s.GuestsPerRoundTable),
                Chairs: PerHead(pax, s.ChairsPerGuest),
                Plates: utensils,
                Spoons: utensils,
                Forks: utensils,
                Waiters: PerGroup(pax, s.GuestsPerWaiter),
                Servers: PerGroup(pax, s.GuestsPerServer),
                Others: 0);
        }
    }
}
