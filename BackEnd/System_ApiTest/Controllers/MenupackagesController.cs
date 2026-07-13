using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class MenuPackagesController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Packageservice _packages;
        private readonly Auditlogservice _audit;

        public MenuPackagesController(AppDbContext db, Packageservice packages, Auditlogservice audit)
        {
            _db = db;
            _packages = packages;
            _audit = audit;
        }

        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var packages = await LoadGraph().OrderBy(p => p.PackageName).ToListAsync();
            return Ok(packages.Select(ToDto));
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var p = await LoadGraph().FirstOrDefaultAsync(p => p.Id == id);
            return p is null ? NotFound() : Ok(ToDto(p));
        }

        /// <summary>The customer-facing template: slots with their eligible items, plus fixed items and inclusions.</summary>
        [HttpGet("{id:guid}/template")]
        public async Task<IActionResult> Template(Guid id)
        {
            try
            {
                var (pkg, eligibleBySlot) = await _packages.BuildTemplateAsync(id);
                var dto = new PackageTemplateDto(
                    pkg.Id, pkg.PackageName, pkg.Description, pkg.BasePrice, pkg.MinPax, pkg.MaxPax,
                    pkg.Inclusions,
                    pkg.FixedItems.Select(f => Brief(f.MenuItem)).ToList(),
                    pkg.Slots.OrderBy(s => s.DisplayOrder).Select(s => new TemplateSlotDto(
                        s.Id, s.Label, s.ChooseCount,
                        eligibleBySlot[s.Id].Select(Brief).ToList())).ToList());
                return Ok(dto);
            }
            catch (BookingRuleException ex) { return NotFound(new { message = ex.Message }); }
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] MenuPackageCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var fixedItemIds = dto.FixedItemIds.Distinct().ToList();
            var error = await ValidateFixedItemsAsync(fixedItemIds);
            if (error is not null) return BadRequest(new { message = error });

            var pkg = new Menupackage
            {
                PackageName = dto.PackageName.Trim(),
                Description = dto.Description.Trim(),
                BasePrice = dto.BasePrice,
                MinPax = dto.MinPax,
                MaxPax = dto.MaxPax,
                PricePerExtraPax = dto.PricePerExtraPax,
                Inclusions = dto.Inclusions
            };

            foreach (var slot in dto.Slots)
            {
                var slotEntity = new Menupackageslot
                {
                    Label = slot.Label.Trim(),
                    ChooseCount = slot.ChooseCount,
                    DisplayOrder = slot.DisplayOrder
                };
                foreach (var cat in slot.AllowedCategories)
                    slotEntity.AllowedCategories.Add(new SlotCategory
                    {
                        ItemCategory = cat.ItemCategory,
                        CourseCategory = cat.CourseCategory
                    });
                pkg.Slots.Add(slotEntity);
            }

            foreach (var fid in fixedItemIds)
                pkg.FixedItems.Add(new Menupackagefixeditem { MenuItemId = fid });

            _db.MenuPackages.Add(pkg);
            await _db.SaveChangesAsync();

            var saved = await LoadGraph().FirstAsync(p => p.Id == pkg.Id);
            await _audit.LogAsync(User, AuditAction.CREATE, "MENU_PACKAGE", pkg.Id.ToString(), null, ToDto(saved));
            return CreatedAtAction(nameof(GetById), new { id = pkg.Id }, ToDto(saved));
        }

        /// <summary>
        /// Updates scalar fields, inclusions, and fixed items. Slots are NOT replaced
        /// here — they're set at creation. Changing a package's slots after bookings
        /// reference them needs a dedicated flow (selections would be orphaned).
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] MenuPackageCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var pkg = await _db.MenuPackages.Include(p => p.FixedItems).FirstOrDefaultAsync(p => p.Id == id);
            if (pkg is null) return NotFound();
            var oldGraph = await LoadGraph().AsNoTracking().FirstAsync(p => p.Id == id);
            var old = ToDto(oldGraph);

            var fixedItemIds = dto.FixedItemIds.Distinct().ToList();
            var error = await ValidateFixedItemsAsync(fixedItemIds);
            if (error is not null) return BadRequest(new { message = error });

            pkg.PackageName = dto.PackageName.Trim();
            pkg.Description = dto.Description.Trim();
            pkg.BasePrice = dto.BasePrice;
            pkg.MinPax = dto.MinPax;
            pkg.MaxPax = dto.MaxPax;
            pkg.PricePerExtraPax = dto.PricePerExtraPax;
            pkg.Inclusions = dto.Inclusions;

            // Replace fixed items.
            _db.MenuPackageFixedItems.RemoveRange(pkg.FixedItems);
            pkg.FixedItems.Clear();
            foreach (var fid in fixedItemIds)
                pkg.FixedItems.Add(new Menupackagefixeditem { MenuPackageId = pkg.Id, MenuItemId = fid });

            await _db.SaveChangesAsync();

            var saved = await LoadGraph().FirstAsync(p => p.Id == id);
            await _audit.LogAsync(User, AuditAction.UPDATE, "MENU_PACKAGE", id.ToString(), old, ToDto(saved));
            return Ok(ToDto(saved));
        }

        // ---------------- Slots (granular add / edit / remove) ----------------

        /// <summary>Adds a slot to a package. Always allowed (new slots don't affect existing bookings).</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{packageId:guid}/slots")]
        public async Task<IActionResult> AddSlot(Guid packageId, [FromBody] PackageSlotInputDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (!await _db.MenuPackages.AnyAsync(p => p.Id == packageId)) return NotFound();

            var slot = new Menupackageslot
            {
                MenuPackageId = packageId,
                Label = dto.Label.Trim(),
                ChooseCount = dto.ChooseCount,
                DisplayOrder = dto.DisplayOrder
            };
            foreach (var cat in dto.AllowedCategories)
                slot.AllowedCategories.Add(new SlotCategory { ItemCategory = cat.ItemCategory, CourseCategory = cat.CourseCategory });

            _db.MenuPackageSlots.Add(slot);
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.CREATE, "MENU_PACKAGE_SLOT", slot.Id.ToString(), null, SlotToDto(slot));
            return Ok(SlotToDto(slot));
        }

        /// <summary>
        /// Edits a slot (label, choose-count, order, and its allowed categories).
        /// Blocked if any booking already has selections for this slot, to avoid
        /// invalidating choices customers already made.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{packageId:guid}/slots/{slotId:guid}")]
        public async Task<IActionResult> UpdateSlot(Guid packageId, Guid slotId, [FromBody] PackageSlotInputDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var slot = await _db.MenuPackageSlots.Include(s => s.AllowedCategories)
                .FirstOrDefaultAsync(s => s.Id == slotId && s.MenuPackageId == packageId);
            if (slot is null) return NotFound();

            if (await _db.BookingPackageSelections.AnyAsync(x =>
                    x.MenuPackageSlotId == slotId && x.Booking.Status != BookingStatus.Cancelled))
                return Conflict(new { message = "This slot is already used by bookings and can't be edited." });

            slot.Label = dto.Label.Trim();
            slot.ChooseCount = dto.ChooseCount;
            slot.DisplayOrder = dto.DisplayOrder;

            _db.SlotCategories.RemoveRange(slot.AllowedCategories);
            slot.AllowedCategories.Clear();
            foreach (var cat in dto.AllowedCategories)
                slot.AllowedCategories.Add(new SlotCategory
                {
                    MenuPackageSlotId = slotId,
                    ItemCategory = cat.ItemCategory,
                    CourseCategory = cat.CourseCategory
                });

            await _db.SaveChangesAsync();
            return Ok(SlotToDto(slot));
        }

        /// <summary>Removes a slot. Blocked if any booking already has selections for it.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpDelete("{packageId:guid}/slots/{slotId:guid}")]
        public async Task<IActionResult> RemoveSlot(Guid packageId, Guid slotId)
        {
            var slot = await _db.MenuPackageSlots
                .FirstOrDefaultAsync(s => s.Id == slotId && s.MenuPackageId == packageId);
            if (slot is null) return NotFound();
            var oldSlot = SlotToDto(await _db.MenuPackageSlots
                .Include(x => x.AllowedCategories).AsNoTracking().FirstAsync(x => x.Id == slotId));

            if (await _db.BookingPackageSelections.AnyAsync(x =>
                    x.MenuPackageSlotId == slotId && x.Booking.Status != BookingStatus.Cancelled))
                return Conflict(new { message = "This slot is already used by bookings and can't be removed." });

            var oldSlotDto = SlotToDto(await _db.MenuPackageSlots.Include(x => x.AllowedCategories).AsNoTracking().FirstAsync(x => x.Id == slotId));
            _db.MenuPackageSlots.Remove(slot);   // cascades to its SlotCategory rows
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.DELETE, "MENU_PACKAGE_SLOT", slotId.ToString(), oldSlotDto, null);
            return NoContent();
        }

        // ---------------- Helpers ----------------

        private IQueryable<Menupackage> LoadGraph() =>
            _db.MenuPackages
                .Include(p => p.Slots).ThenInclude(s => s.AllowedCategories)
                .Include(p => p.FixedItems).ThenInclude(f => f.MenuItem);

        private async Task<string?> ValidateFixedItemsAsync(List<Guid> ids)
        {
            if (ids.Count == 0) return null;
            var items = await _db.MenuItems.Where(m => ids.Contains(m.Id))
                .Select(m => new { m.Id, m.IsActive }).ToListAsync();
            if (items.Count != ids.Count) return "One or more fixed items were not found.";
            if (items.Any(i => !i.IsActive)) return "Fixed items must be active menu items.";
            return null;
        }

        private static MenuItemBriefDto Brief(Menuitem m) =>
            new(m.Id, m.ItemName, m.ItemCategory.ToString(), m.CourseCategory.ToString());

        private static PackageSlotDto SlotToDto(Menupackageslot s) =>
            new(s.Id, s.Label, s.ChooseCount, s.DisplayOrder,
                s.AllowedCategories.Select(c => new SlotCategoryDto(
                    c.ItemCategory?.ToString(), c.CourseCategory?.ToString())).ToList());

        private static MenuPackageResponseDto ToDto(Menupackage p) =>
            new(p.Id, p.PackageName, p.Description, p.BasePrice, p.MinPax, p.MaxPax, p.PricePerExtraPax,
                p.Inclusions,
                p.Slots.OrderBy(s => s.DisplayOrder).Select(SlotToDto).ToList(),
                p.FixedItems.Select(f => Brief(f.MenuItem)).ToList());
    }
}
 