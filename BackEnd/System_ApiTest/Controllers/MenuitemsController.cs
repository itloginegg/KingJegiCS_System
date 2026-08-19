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
    public class MenuitemsController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }

        private readonly AppDbContext _db;
        private readonly Auditlogservice _audit;
        private readonly IWebHostEnvironment _env;
        private readonly Bestsellerservice _bestSeller;

        public MenuitemsController(AppDbContext db, Auditlogservice audit, IWebHostEnvironment env,
                                   Bestsellerservice bestSeller)
        {
            _db = db;
            _audit = audit;
            _env = env;
            _bestSeller = bestSeller;
        }

        /// <summary>
        /// The best-selling dish of the fortnight, for the landing page feature section.
        /// Anonymous — the landing page has no token.
        /// </summary>
        [AllowAnonymous]
        [HttpGet("best-seller")]
        public async Task<IActionResult> GetBestSeller(CancellationToken ct)
        {
            // Server local date, so every visitor shares one bucket boundary rather than
            // rolling over at their own midnight.
            var result = await _bestSeller.GetAsync(DateOnly.FromDateTime(DateTime.Now), ct);
            return result is null ? NoContent() : Ok(result);
        }

        /// <summary>List dishes. Customers see only active ones; optional package filter.</summary>
        [AllowAnonymous]   // guests may browse the catalog (item 1); IsAdmin() is false → active-only
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] Guid? menuPackageId)
        {
            var query = _db.MenuItems.AsQueryable();
            if (!IsAdmin()) query = query.Where(m => m.IsActive);
            if (menuPackageId is not null) query = query.Where(m => m.MenuPackageId == menuPackageId);

            var items = await query.OrderBy(m => m.ItemName).ToListAsync();
            return Ok(items.Select(ToDto));
        }

        [AllowAnonymous]
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var m = await _db.MenuItems.FindAsync(id);
            if (m is null) return NotFound();
            if (!IsAdmin() && !m.IsActive) return NotFound();
            return Ok(ToDto(m));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost]
        public async Task<IActionResult> Create([FromForm] MenuItemCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var (isValid, imageError) = ImageUploadHelper.ValidateImage(dto.ImageFile);
            if (!isValid) return BadRequest(new { message = imageError });

            string? imageUrl = null;
            if (dto.ImageFile is not null)
            {
                imageUrl = await ImageUploadHelper.SaveImageAsync(dto.ImageFile, _env, "menu");
            }

            var m = new Menuitem
            {
                ItemName = dto.ItemName.Trim(),
                ItemCategory = dto.ItemCategory,
                CourseCategory = dto.CourseCategory,
                Description = dto.Description.Trim(),
                DietaryTags = dto.DietaryTags,
                PricePerTray = dto.PricePerTray,
                ServesPerTray = dto.ServesPerTray,
                MenuPackageId = dto.MenuPackageId,
                ImageUrl = imageUrl
            };
            _db.MenuItems.Add(m);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                if (imageUrl is not null) ImageUploadHelper.DeleteImage(_env, imageUrl);
                return Conflict(new { message = "A menu item with this name already exists." });
            }
            await _audit.LogAsync(User, AuditAction.CREATE, "MENU_ITEM", m.Id.ToString(), null, ToDto(m));
            return CreatedAtAction(nameof(GetById), new { id = m.Id }, ToDto(m));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromForm] MenuItemCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var (isValid, imageError) = ImageUploadHelper.ValidateImage(dto.ImageFile);
            if (!isValid) return BadRequest(new { message = imageError });

            var m = await _db.MenuItems.FindAsync(id);
            if (m is null) return NotFound();
            var old = ToDto(m);

            m.ItemName = dto.ItemName.Trim();
            m.ItemCategory = dto.ItemCategory;
            m.CourseCategory = dto.CourseCategory;
            m.Description = dto.Description.Trim();
            m.DietaryTags = dto.DietaryTags;
            m.PricePerTray = dto.PricePerTray;
            m.ServesPerTray = dto.ServesPerTray;
            m.MenuPackageId = dto.MenuPackageId;

            if (dto.ImageFile is not null)
            {
                ImageUploadHelper.DeleteImage(_env, m.ImageUrl);
                m.ImageUrl = await ImageUploadHelper.SaveImageAsync(dto.ImageFile, _env, "menu");
            }

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                return Conflict(new { message = "A menu item with this name already exists." });
            }
            await _audit.LogAsync(User, AuditAction.UPDATE, "MENU_ITEM", m.Id.ToString(), old, ToDto(m));
            return Ok(ToDto(m));
        }

        /// <summary>Soft-deactivate so it can no longer be chosen (keeps it on past bookings).</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/deactivate")]
        public async Task<IActionResult> Deactivate(Guid id)
        {
            var m = await _db.MenuItems.FindAsync(id);
            if (m is null) return NotFound();
            if (!m.IsActive) return NoContent();   // already inactive; nothing to record

            var old = ToDto(m);
            m.IsActive = false;
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.UPDATE, "MENU_ITEM", m.Id.ToString(), old, ToDto(m));
            return NoContent();
        }

        /// <summary>
        /// Puts a deactivated item back in the catalog. The mirror of /deactivate.
        ///
        /// This is a dedicated endpoint rather than a field on the PUT update, because
        /// MenuItemCreateDto carries no IsActive and the update is multipart/form-data —
        /// flipping one boolean would otherwise mean re-posting every field plus the image.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/reactivate")]
        public async Task<IActionResult> Reactivate(Guid id)
        {
            var m = await _db.MenuItems.FindAsync(id);
            if (m is null) return NotFound();
            if (m.IsActive) return NoContent();   // already active; nothing to record

            var old = ToDto(m);
            m.IsActive = true;
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.UPDATE, "MENU_ITEM", m.Id.ToString(), old, ToDto(m));
            return NoContent();
        }

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private static MenuItemResponseDto ToDto(Menuitem m) =>
            new(m.Id, m.ItemName, m.ItemCategory.ToString(), m.CourseCategory.ToString(), m.Description,
                m.DietaryTags, m.PricePerTray, m.ServesPerTray, m.MenuPackageId, m.IsActive, m.ImageUrl);
    }
}