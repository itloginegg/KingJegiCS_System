using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    public class Packageservice
    {
        private readonly AppDbContext _db;
        public Packageservice(AppDbContext db) => _db = db;

        /// <summary>
        /// An item matches a slot if it satisfies ANY of the slot's allowed-category
        /// entries. Within an entry, every set value must match (AND): an entry of
        /// {Beef, Main} requires the item to be Beef AND a Main course; {Beef, null}
        /// requires only Beef; {null, Dessert} requires only a Dessert course.
        /// </summary>
        private static bool MatchesSlot(Menuitem m, Menupackageslot slot) =>
            slot.AllowedCategories.Any(c =>
                (c.ItemCategory is null || c.ItemCategory == m.ItemCategory) &&
                (c.CourseCategory is null || c.CourseCategory == m.CourseCategory));

        /// <summary>
        /// Active menu items eligible for a slot. Filtering is done in memory because
        /// the per-entry AND/OR logic doesn't translate to a simple SQL predicate; the
        /// active-item catalog is small enough that this is fine.
        /// </summary>
        private async Task<List<Menuitem>> EligibleItemsAsync(Menupackageslot slot)
        {
            var candidates = await _db.MenuItems.Where(m => m.IsActive).OrderBy(m => m.ItemName).ToListAsync();
            return candidates.Where(m => MatchesSlot(m, slot)).ToList();
        }

        /// <summary>Eligible items for a single slot (for a "what can I pick" screen).</summary>
        public async Task<List<Menuitem>> EligibleItemsForSlotAsync(Guid slotId)
        {
            var slot = await _db.MenuPackageSlots.Include(s => s.AllowedCategories)
                .FirstOrDefaultAsync(s => s.Id == slotId)
                ?? throw new BookingRuleException("Slot not found.");
            return await EligibleItemsAsync(slot);
        }

        /// <summary>
        /// Loads a package and computes the eligible items per slot — everything the
        /// customer "pick your dishes" screen needs. Fixed items and inclusions come
        /// straight off the package.
        /// </summary>
        public async Task<(Menupackage package, Dictionary<Guid, List<Menuitem>> eligibleBySlot)> BuildTemplateAsync(Guid packageId)
        {
            var package = await _db.MenuPackages
                .Include(p => p.Slots).ThenInclude(s => s.AllowedCategories)
                .Include(p => p.FixedItems).ThenInclude(f => f.MenuItem)
                .FirstOrDefaultAsync(p => p.Id == packageId)
                ?? throw new BookingRuleException("Package not found.");

            var candidates = await _db.MenuItems.Where(m => m.IsActive).OrderBy(m => m.ItemName).ToListAsync();
            var eligibleBySlot = new Dictionary<Guid, List<Menuitem>>();
            foreach (var slot in package.Slots)
                eligibleBySlot[slot.Id] = candidates.Where(m => MatchesSlot(m, slot)).ToList();

            return (package, eligibleBySlot);
        }

        /// <summary>
        /// Records the customer's choice(s) for one slot on a booking, replacing any
        /// prior choices for that slot. Validates the slot belongs to the booking's
        /// package, the count equals choose_count, and every item is active and
        /// category-eligible. Selections are free — no total recompute.
        /// </summary>
        public async Task SetSlotSelectionAsync(Guid bookingId, Guid slotId, IReadOnlyList<Guid> itemIds)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");
            if (booking.Status != BookingStatus.Draft)
                throw new BookingRuleException(
                    $"A {booking.Status} booking can no longer be edited; slot choices are set while Draft.");
            if (booking.MenuPackageId is null)
                throw new BookingRuleException("This booking has no package, so it has no slots to fill.");

            var slot = await _db.MenuPackageSlots.Include(s => s.AllowedCategories)
                .FirstOrDefaultAsync(s => s.Id == slotId)
                ?? throw new BookingRuleException("Slot not found.");
            if (slot.MenuPackageId != booking.MenuPackageId)
                throw new BookingRuleException("That slot does not belong to this booking's package.");

            if (itemIds.Count != slot.ChooseCount)
                throw new BookingRuleException($"Slot '{slot.Label}' requires exactly {slot.ChooseCount} selection(s).");
            if (itemIds.Distinct().Count() != itemIds.Count)
                throw new BookingRuleException("The selections for a slot must be distinct.");

            var eligible = (await EligibleItemsAsync(slot)).Select(m => m.Id).ToHashSet();
            foreach (var id in itemIds)
                if (!eligible.Contains(id))
                    throw new BookingRuleException("One or more chosen items are not eligible for this slot.");

            // Replace existing selections for this slot on this booking.
            var existing = _db.BookingPackageSelections
                .Where(x => x.BookingId == bookingId && x.MenuPackageSlotId == slotId);
            _db.BookingPackageSelections.RemoveRange(existing);
            foreach (var id in itemIds)
                _db.BookingPackageSelections.Add(new Bookingpackageselection
                {
                    BookingId = bookingId,
                    MenuPackageSlotId = slotId,
                    MenuItemId = id
                });

            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// Submit-time gate: every slot on the booking's package must have exactly
        /// choose_count selections. No-op if the booking has no package.
        /// </summary>
        public async Task EnsurePackageSelectionsCompleteAsync(Guid bookingId)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");
            if (booking.MenuPackageId is null)
                return;

            var slots = await _db.MenuPackageSlots
                .Where(s => s.MenuPackageId == booking.MenuPackageId).ToListAsync();
            var selections = await _db.BookingPackageSelections
                .Where(x => x.BookingId == bookingId).ToListAsync();

            foreach (var slot in slots)
            {
                var count = selections.Count(x => x.MenuPackageSlotId == slot.Id);
                if (count != slot.ChooseCount)
                    throw new BookingRuleException(
                        $"Slot '{slot.Label}' needs exactly {slot.ChooseCount} selection(s); it has {count}.");
            }
        }

        /// <summary>The customer's selections for a booking, with labels for display.</summary>
        public async Task<List<Bookingpackageselection>> GetSelectionsAsync(Guid bookingId)
            => await _db.BookingPackageSelections
                .Include(x => x.Slot)
                .Include(x => x.MenuItem)
                .Where(x => x.BookingId == bookingId)
                .ToListAsync();
    }
}