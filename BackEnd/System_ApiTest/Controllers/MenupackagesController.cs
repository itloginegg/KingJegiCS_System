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
        /// <summary>Gallery cap per package. Each file is separately capped at 5 MB by ImageUploadHelper.</summary>
        private const int MaxImagesPerPackage = 12;

        private readonly AppDbContext _db;
        private readonly Packageservice _packages;
        private readonly Auditlogservice _audit;
        private readonly IWebHostEnvironment _env;

        public MenuPackagesController(AppDbContext db, Packageservice packages, Auditlogservice audit,
                                      IWebHostEnvironment env)
        {
            _db = db;
            _packages = packages;
            _audit = audit;
            _env = env;
        }

        [AllowAnonymous]   // guests may browse packages (item 1)
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var packages = await LoadGraph().OrderBy(p => p.PackageName).ToListAsync();
            return Ok(packages.Select(ToDto));
        }

        [AllowAnonymous]
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var p = await LoadGraph().FirstOrDefaultAsync(p => p.Id == id);
            return p is null ? NotFound() : Ok(ToDto(p));
        }

        /// <summary>The customer-facing template: slots with their eligible items, plus fixed items and inclusions.</summary>
        [AllowAnonymous]
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

            var oldFixedItems = pkg.FixedItems.ToList();
            _db.MenuPackageFixedItems.RemoveRange(oldFixedItems);
            
            foreach (var fid in fixedItemIds)
            {
                _db.MenuPackageFixedItems.Add(new Menupackagefixeditem 
                { 
                    MenuPackageId = pkg.Id, 
                    MenuItemId = fid 
                });
            }

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

            var oldCats = slot.AllowedCategories.ToList();
            _db.SlotCategories.RemoveRange(oldCats);
            
            foreach (var cat in dto.AllowedCategories)
            {
                _db.SlotCategories.Add(new SlotCategory
                {
                    MenuPackageSlotId = slotId,
                    ItemCategory = cat.ItemCategory,
                    CourseCategory = cat.CourseCategory
                });
            }
            await _db.SaveChangesAsync();

            var updatedSlot = await _db.MenuPackageSlots
                .Include(s => s.AllowedCategories)
                .AsNoTracking()
                .FirstAsync(s => s.Id == slotId);

            return Ok(SlotToDto(updatedSlot));
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

        // ---------------- Gallery images ----------------

        /// <summary>
        /// Adds one photo to a package's gallery. Multipart, same shape as the menu-item
        /// and rental uploads; validation and the 5 MB cap come from ImageUploadHelper.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{packageId:guid}/images")]
        public async Task<IActionResult> AddImage(Guid packageId, [FromForm] MenuPackageImageInputDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var exists = await _db.MenuPackages.AnyAsync(p => p.Id == packageId);
            if (!exists) return NotFound();

            if (dto.ImageFile is null || dto.ImageFile.Length == 0)
                return BadRequest(new { message = "Choose an image to upload." });

            var (isValid, imageError) = ImageUploadHelper.ValidateImage(dto.ImageFile);
            if (!isValid) return BadRequest(new { message = imageError });

            var count = await _db.MenuPackageImages.CountAsync(i => i.MenuPackageId == packageId);
            if (count >= MaxImagesPerPackage)
                return BadRequest(new { message = $"A package can carry at most {MaxImagesPerPackage} images." });

            var url = await ImageUploadHelper.SaveImageAsync(dto.ImageFile, _env, "packages");

            var image = new Menupackageimage
            {
                MenuPackageId = packageId,
                ImageUrl = url,
                Caption = string.IsNullOrWhiteSpace(dto.Caption) ? null : dto.Caption.Trim(),
                // Appended to the end of the existing gallery.
                DisplayOrder = count
            };

            _db.MenuPackageImages.Add(image);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                ImageUploadHelper.DeleteImage(_env, url);
                throw;
            }

            var result = new MenuPackageImageDto(image.Id, image.ImageUrl, image.Caption, image.DisplayOrder);
            await _audit.LogAsync(User, AuditAction.CREATE, "MENU_PACKAGE_IMAGE", image.Id.ToString(), null, result);
            return Ok(result);
        }

        /// <summary>Removes one gallery photo and deletes the file behind it.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpDelete("{packageId:guid}/images/{imageId:guid}")]
        public async Task<IActionResult> RemoveImage(Guid packageId, Guid imageId)
        {
            var image = await _db.MenuPackageImages
                .FirstOrDefaultAsync(i => i.Id == imageId && i.MenuPackageId == packageId);
            if (image is null) return NotFound();

            var old = new MenuPackageImageDto(image.Id, image.ImageUrl, image.Caption, image.DisplayOrder);

            _db.MenuPackageImages.Remove(image);
            await _db.SaveChangesAsync();

            // Only after the row is gone — a file deleted ahead of a failed commit would
            // leave a gallery entry pointing at nothing.
            ImageUploadHelper.DeleteImage(_env, image.ImageUrl);

            await _audit.LogAsync(User, AuditAction.DELETE, "MENU_PACKAGE_IMAGE", imageId.ToString(), old, null);
            return NoContent();
        }

        // ---------------- Helpers ----------------

        private IQueryable<Menupackage> LoadGraph() =>
            _db.MenuPackages
                .Include(p => p.Slots).ThenInclude(s => s.AllowedCategories)
                .Include(p => p.FixedItems).ThenInclude(f => f.MenuItem)
                .Include(p => p.Images);

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
                p.FixedItems.Select(f => Brief(f.MenuItem)).ToList(),
                p.Images.OrderBy(i => i.DisplayOrder).ThenBy(i => i.Id)
                        .Select(i => new MenuPackageImageDto(i.Id, i.ImageUrl, i.Caption, i.DisplayOrder))
                        .ToList());
    }
}
 