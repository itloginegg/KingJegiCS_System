
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    public class Menutrayservice
    {
        private readonly AppDbContext _db;
        public Menutrayservice(AppDbContext db) => _db = db;

        /// <summary>Creates a tray with exactly 4 distinct, active dishes.</summary>
        public async Task<Menutray> CreateAsync(
            string trayName, decimal pricePerTray, int servesMin, int servesMax, IReadOnlyList<Guid> dishItemIds)
        {
            ValidateDishCount(dishItemIds);
            await EnsureItemsExistAndActiveAsync(dishItemIds);

            var tray = new Menutray
            {
                TrayName = trayName.Trim(),
                PricePerTray = pricePerTray,
                ServesMin = servesMin,
                ServesMax = servesMax
            };
            foreach (var itemId in dishItemIds)
                tray.Dishes.Add(new MenuTrayDish { MenuItemId = itemId });

            _db.MenuTrays.Add(tray);
            await _db.SaveChangesAsync();
            return tray;
        }

        /// <summary>Replaces a tray's dishes, re-enforcing the exactly-4 rule.</summary>
        public async Task UpdateDishesAsync(Guid trayId, IReadOnlyList<Guid> dishItemIds)
        {
            ValidateDishCount(dishItemIds);
            await EnsureItemsExistAndActiveAsync(dishItemIds);

            var tray = await _db.MenuTrays.Include(t => t.Dishes).FirstOrDefaultAsync(t => t.Id == trayId)
                ?? throw new BookingRuleException("Menu tray not found.");

            _db.MenuTrayDishes.RemoveRange(tray.Dishes);
            tray.Dishes.Clear();
            foreach (var itemId in dishItemIds)
                tray.Dishes.Add(new MenuTrayDish { MenuTrayId = trayId, MenuItemId = itemId });

            await _db.SaveChangesAsync();
        }

        private static void ValidateDishCount(IReadOnlyList<Guid> ids)
        {
            if (ids.Count != 4)
                throw new BookingRuleException("A tray must have exactly 4 dishes.");
            if (ids.Distinct().Count() != 4)
                throw new BookingRuleException("The 4 dishes must be distinct.");
        }

        private async Task EnsureItemsExistAndActiveAsync(IReadOnlyList<Guid> ids)
        {
            var found = await _db.MenuItems
                .Where(m => ids.Contains(m.Id))
                .Select(m => new { m.Id, m.IsActive })
                .ToListAsync();

            if (found.Count != ids.Distinct().Count())
                throw new BookingRuleException("One or more dishes were not found.");
            if (found.Any(f => !f.IsActive))
                throw new BookingRuleException("All tray dishes must be active menu items.");
        }
    }
}

