using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Reads and writes a booking's operational resource plan — furniture, service-ware
    /// and staff counts.
    ///
    /// This service deliberately never calls Bookingservice.EnsureEditableAsync. That
    /// guard exists to stop PRICED lines changing after a booking leaves Draft, and it
    /// is right to do so; but a resource plan is exactly the thing an admin needs to
    /// edit on a CONFIRMED booking, and it carries no price and never touches
    /// TotalAmount or the invoice. Routing it through the rentals/services tables would
    /// have made the whole feature throw on every booking that mattered.
    ///
    /// It DOES now consume stock, through Lines. That is a deliberate change from the
    /// original design: a bundled package declares its rentals only as display text, so
    /// a Confirmed package booking used to reserve nothing at all. Lines hold real
    /// inventory while staying unpriced, because the package price already covers them.
    /// Stock is validated under the same row lock the priced path uses.
    ///
    /// The only lifecycle guard is against Cancelled — planning resources for an event
    /// that isn't happening is meaningless. Completed is still allowed, so the record of
    /// what was actually sent stays correctable after the fact; a Completed plan's lines
    /// stop holding stock (see Rentalservice.CommittedAllocation), so editing one is
    /// bookkeeping, not a reservation.
    /// </summary>
    public class Bookingresourceservice
    {
        private readonly IApplicationDbContext _db;
        private readonly Rentalservice _rentals;

        public Bookingresourceservice(IApplicationDbContext db, Rentalservice rentals)
        {
            _db = db;
            _rentals = rentals;
        }

        /// <summary>Reads the plan (null if never saved) plus a computed suggestion.</summary>
        public async Task<BookingResourcesDto> GetAsync(Guid bookingId)
        {
            var booking = await _db.Bookings
                .AsNoTracking()
                .Include(b => b.ResourceAllocation)
                    .ThenInclude(a => a!.Lines).ThenInclude(l => l.RentalItem)
                .Include(b => b.ResourceAllocation)
                    .ThenInclude(a => a!.Lines).ThenInclude(l => l.ServiceItem)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            return await BuildAsync(booking, booking.ResourceAllocation);
        }

        /// <summary>
        /// Assembles the response shared by GetAsync and SaveAsync, so a save returns
        /// exactly what a reload would and the client never has to merge two shapes.
        /// </summary>
        private async Task<BookingResourcesDto> BuildAsync(
            Booking booking, BookingResourceAllocation? allocation)
        {
            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();

            // Availability is quoted against THIS booking's own dates and with its own
            // holds excluded, so the number an admin sees is what they could grow the
            // line to — not what remains after their own reservation.
            var (windowStart, windowEnd) = StockWindow(booking, settings);
            var outgoing = await _rentals.OutgoingByItemAsync(booking.Id, windowStart, windowEnd);

            var rentalItems = await _db.RentalItems.AsNoTracking()
                .OrderBy(i => i.ItemName).ToListAsync();
            var serviceItems = await _db.ServiceItems.AsNoTracking()
                .OrderBy(s => s.ServiceName).ToListAsync();

            int AvailableFor(Rentalitem i) => i.TotalQuantity - outgoing.GetValueOrDefault(i.Id);

            var lines = (allocation?.Lines ?? new List<BookingResourceAllocationLine>())
                .Select(l => l.RentalItemId is not null
                    ? new AllocationLineDto(
                        l.Id, "Rental", l.RentalItemId.Value,
                        l.RentalItem?.ItemName ?? "(removed item)", l.Quantity,
                        l.RentalItem is null ? null : AvailableFor(l.RentalItem))
                    : new AllocationLineDto(
                        l.Id, "Service", l.ServiceItemId!.Value,
                        l.ServiceItem?.ServiceName ?? "(removed service)", l.Quantity, null))
                .OrderBy(l => l.Kind).ThenBy(l => l.Name)
                .ToList();

            // Only active items are offered. An inactive item already on the plan still
            // comes back as a line above, so history stays readable without inviting new
            // assignments of something withdrawn from the catalog.
            var rentalCatalog = rentalItems
                .Where(i => i.IsActive)
                .Select(i => new AllocationCatalogItemDto(
                    i.Id, i.ItemName, i.Category.ToString(), AvailableFor(i),
                    SuggestForRental(i, booking.GuestCount, settings)))
                .ToList();

            var serviceCatalog = serviceItems
                .Where(s => s.IsActive)
                .Select(s => new AllocationCatalogItemDto(
                    s.Id, s.ServiceName, null, null,
                    SuggestForService(s, booking.GuestCount, settings)))
                .ToList();

            return new BookingResourcesDto(
                booking.Id,
                booking.EventType?.ToString(),
                booking.GuestCount,
                allocation?.IsApproved ?? false,
                allocation?.ApprovedAt,
                allocation?.UpdatedAt,
                lines,
                rentalCatalog,
                serviceCatalog);
        }

        /// <summary>
        /// The booking's rental window, widened by the turnaround buffer — the same
        /// window Bookingservice uses at confirm, so the modal can't advertise stock the
        /// confirm check would refuse.
        /// </summary>
        private static (DateOnly?, DateOnly?) StockWindow(Booking booking, Systemsettings? settings)
        {
            var turnaround = Math.Max(0, settings?.RentalTurnaroundDays ?? 1);
            return (booking.EventDate.AddDays(-turnaround),
                    (booking.EndDate ?? booking.EventDate).AddDays(turnaround));
        }

        /// <summary>
        /// Creates or updates the plan. Returns the same shape as <see cref="GetAsync"/>
        /// so the caller can refresh from one response.
        /// </summary>
        public async Task<BookingResourcesDto> SaveAsync(
            Guid bookingId, SaveResourceAllocationDto dto, Guid? actingUserId)
        {
            // Retries: the execution strategy re-runs this whole block after a transient
            // failure, and EF accepts changes into the change tracker on SaveChanges even
            // when the surrounding transaction later rolls back. Clearing at the top of
            // each attempt makes the retry start from database truth instead of the last
            // attempt's leftovers — without it the lazily created allocation, and the
            // lines ReplaceLinesAsync adds, are inserted a second time.
            //
            // The booking is loaded INSIDE the block for the same reason: Clear() detaches
            // whatever the previous attempt held, and its ResourceAllocation graph is the
            // state this method mutates.
            var strategy = _db.Database.CreateExecutionStrategy();
            var (booking, allocation) = await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();

                var b = await _db.Bookings
                    .Include(x => x.ResourceAllocation).ThenInclude(a => a!.Lines)
                    .FirstOrDefaultAsync(x => x.Id == bookingId)
                    ?? throw new BookingRuleException("Booking not found.");

                if (b.Status == BookingStatus.Cancelled)
                    throw new BookingRuleException("A cancelled booking has no resources to allocate.");

                // The stock check below takes row locks, which only hold inside a
                // transaction; without one they release the instant each query returns and
                // two concurrent allocations could both pass.
                await using var tx = await _db.Database.BeginTransactionAsync();

                var alloc = b.ResourceAllocation;
                if (alloc is null)
                {
                    // Created lazily: most bookings never get a plan, and an empty row would
                    // be indistinguishable from a real "allocate nothing" decision.
                    alloc = new BookingResourceAllocation { BookingId = b.Id };
                    _db.BookingResourceAllocations.Add(alloc);
                }

                alloc.UpdatedAt = DateTime.UtcNow;

                // Stamp the approver only on the transition into approved, so re-saving an
                // already-approved plan doesn't rewrite who signed it off or when.
                if (dto.IsApproved && !alloc.IsApproved)
                {
                    alloc.ApprovedAt = DateTime.UtcNow;
                    alloc.ApprovedByUserId = actingUserId;
                }
                else if (!dto.IsApproved)
                {
                    alloc.ApprovedAt = null;
                    alloc.ApprovedByUserId = null;
                }
                alloc.IsApproved = dto.IsApproved;

                // Null means "this client isn't managing lines" — leave them alone rather
                // than silently releasing stock somebody else reserved. An empty list is an
                // explicit "assign nothing".
                if (dto.Lines is not null)
                    await ReplaceLinesAsync(b, alloc, dto.Lines);

                await _db.SaveChangesAsync();
                await tx.CommitAsync();
                return (b, alloc);
            });

            // Re-read through the same path GetAsync uses so names and availability on
            // the returned lines reflect what was just written.
            await _db.Entry(allocation).Collection(a => a.Lines).LoadAsync();
            foreach (var line in allocation.Lines)
            {
                await _db.Entry(line).Reference(l => l.RentalItem).LoadAsync();
                await _db.Entry(line).Reference(l => l.ServiceItem).LoadAsync();
            }

            return await BuildAsync(booking, allocation);
        }

        /// <summary>
        /// Replaces the plan's catalog lines with exactly the requested set, refusing
        /// any rental assignment that would oversubscribe stock.
        ///
        /// The availability check takes UPDLOCK/HOLDLOCK on each RentalItem row, exactly
        /// as Rentalservice.AddRentalAsync does. Without it two admins allocating the
        /// last forty chairs to different events would both pass the check and both
        /// save — which is precisely the double-booking this feature exists to prevent,
        /// reintroduced by the feature meant to stop it. MUST run inside the caller's
        /// transaction or the lock releases immediately.
        /// </summary>
        private async Task ReplaceLinesAsync(
            Booking booking, BookingResourceAllocation allocation, List<SaveAllocationLineDto> requested)
        {
            foreach (var l in requested)
            {
                if ((l.RentalItemId is null) == (l.ServiceItemId is null))
                    throw new BookingRuleException(
                        "Each allocation line must name exactly one rental item or one service.");
                if (l.Quantity <= 0)
                    throw new BookingRuleException("An allocation line's quantity must be at least 1.");
            }

            // Collapse duplicates rather than rejecting them: two picks of the same item
            // is an obvious "I meant 40 plus 10", and the unique index would fail with a
            // constraint error nobody can act on.
            var rentals = requested.Where(l => l.RentalItemId is not null)
                .GroupBy(l => l.RentalItemId!.Value)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.Quantity));
            var services = requested.Where(l => l.ServiceItemId is not null)
                .GroupBy(l => l.ServiceItemId!.Value)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.Quantity));

            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var (windowStart, windowEnd) = StockWindow(booking, settings);

            foreach (var (itemId, quantity) in rentals)
            {
                var item = (await _db.RentalItems
                    .FromSqlInterpolated($"SELECT * FROM [RentalItems] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {itemId}")
                    .ToListAsync())
                    .FirstOrDefault()
                    ?? throw new BookingRuleException("That rental item no longer exists.");

                if (!item.IsActive && !allocation.Lines.Any(x => x.RentalItemId == itemId))
                    throw new BookingRuleException($"'{item.ItemName}' is no longer offered and can't be added.");

                var outgoing = await _db.Rentals
                    .Where(Rentalservice.CommittedStock(itemId, booking.Id, windowStart, windowEnd))
                    .SumAsync(r => (int?)r.Quantity) ?? 0;

                outgoing += await _db.BookingResourceAllocationLines
                    .Where(Rentalservice.CommittedAllocation(itemId, booking.Id, windowStart, windowEnd))
                    .SumAsync(x => (int?)x.Quantity) ?? 0;

                if (outgoing + quantity > item.TotalQuantity)
                    throw new BookingRuleException(
                        $"Not enough stock for '{item.ItemName}' on {booking.EventDate:yyyy-MM-dd}: " +
                        $"{Math.Max(0, item.TotalQuantity - outgoing)} available, {quantity} needed.");
            }

            foreach (var (serviceId, _) in services)
            {
                var service = await _db.ServiceItems.FindAsync(serviceId)
                    ?? throw new BookingRuleException("That service no longer exists.");

                if (!service.IsActive && !allocation.Lines.Any(x => x.ServiceItemId == serviceId))
                    throw new BookingRuleException($"'{service.ServiceName}' is no longer offered and can't be added.");
            }

            // Replace wholesale. Quantities are small and bounded by the catalog size, so
            // diffing would buy nothing but a chance to get the edge cases wrong.
            _db.BookingResourceAllocationLines.RemoveRange(allocation.Lines);
            allocation.Lines.Clear();

            foreach (var (itemId, quantity) in rentals)
                allocation.Lines.Add(new BookingResourceAllocationLine
                {
                    AllocationId = allocation.Id,
                    RentalItemId = itemId,
                    Quantity = quantity,
                });

            foreach (var (serviceId, quantity) in services)
                allocation.Lines.Add(new BookingResourceAllocationLine
                {
                    AllocationId = allocation.Id,
                    ServiceItemId = serviceId,
                    Quantity = quantity,
                });
        }

        // Guarded against zero even though a DB check constraint forbids it: this would
        // be a divide-by-zero, and a settings row written before that constraint existed
        // would still be accepted by the database.
        private static int PerGroup(int pax, int per) =>
            per <= 0 ? 0 : (int)Math.Ceiling(pax / (double)per);

        private static int PerHead(int pax, decimal factor) =>
            factor <= 0 ? 0 : (int)Math.Ceiling(pax * (double)factor);

        /// <summary>
        /// How many of THIS rental item the guest-count ratios imply.
        ///
        /// This is what became of the old per-section SUGGEST buttons. Those filled nine
        /// fixed boxes, so each ratio had exactly one destination. Catalog items have no
        /// such 1:1 mapping — there may be three chair products or none — so the ratio is
        /// selected by the item's CATEGORY and the admin still chooses which product to
        /// apply it to. That keeps the arithmetic server-side (one home for the ceil()
        /// rules) without the server guessing which chair the customer is getting.
        ///
        /// Tables are the one category needing more than its category name: the settings
        /// distinguish long from round, but RentalCategory.Tables does not, so the item
        /// NAME breaks the tie. A table item named neither returns null rather than
        /// guessing, because the two ratios differ fourfold (20 vs 5 guests) and a wrong
        /// guess here is a wrong furniture order.
        ///
        /// Null means "no ratio applies" — Linens, Lights, Others, an ambiguous table, or
        /// a booking with no guest count (a delivery). The button is then simply absent,
        /// which is honest; suggesting 0 would read as a recommendation to bring none.
        /// </summary>
        private static int? SuggestForRental(Rentalitem item, int? guestCount, Systemsettings? s)
        {
            if (guestCount is null or <= 0 || s is null) return null;
            var pax = guestCount.Value;

            switch (item.Category)
            {
                case RentalCategory.Chairs:
                    return PerHead(pax, s.ChairsPerGuest);

                case RentalCategory.Utensils:
                    // One ratio covers plates, spoons and forks alike — the old UI used
                    // the same UtensilsPerGuest value for all three boxes.
                    return PerHead(pax, s.UtensilsPerGuest);

                case RentalCategory.Tables:
                    var name = item.ItemName;
                    if (name.Contains("long", StringComparison.OrdinalIgnoreCase))
                        return PerGroup(pax, s.GuestsPerLongTable);
                    if (name.Contains("round", StringComparison.OrdinalIgnoreCase))
                        return PerGroup(pax, s.GuestsPerRoundTable);
                    return null;

                default:
                    return null;
            }
        }

        /// <summary>
        /// How many of THIS service the staffing ratios imply.
        ///
        /// Serviceitem.ServiceName is free text with no role field, so the name is the
        /// only signal available. Anything that isn't recognisably a waiter or a server
        /// returns null — the old "Others" box was always 0 for the same reason: there is
        /// no ratio that could predict staff the named roles don't cover.
        /// </summary>
        private static int? SuggestForService(Serviceitem service, int? guestCount, Systemsettings? s)
        {
            if (guestCount is null or <= 0 || s is null) return null;
            var pax = guestCount.Value;

            if (service.ServiceName.Contains("waiter", StringComparison.OrdinalIgnoreCase))
                return PerGroup(pax, s.GuestsPerWaiter);
            if (service.ServiceName.Contains("server", StringComparison.OrdinalIgnoreCase))
                return PerGroup(pax, s.GuestsPerServer);

            return null;
        }
    }
}





