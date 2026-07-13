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
        public MenuitemsController(AppDbContext db, Auditlogservice audit)
        {
            _db = db;
            _audit = audit;
        }

        /// <summary>List dishes. Customers see only active ones; optional package filter.</summary>
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] Guid? menuPackageId)
        {
            var query = _db.MenuItems.AsQueryable();
            if (!IsAdmin()) query = query.Where(m => m.IsActive);
            if (menuPackageId is not null) query = query.Where(m => m.MenuPackageId == menuPackageId);

            var items = await query.OrderBy(m => m.ItemName).ToListAsync();
            return Ok(items.Select(ToDto));
        }

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
        public async Task<IActionResult> Create([FromBody] MenuItemCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var m = new Menuitem
            {
                ItemName = dto.ItemName.Trim(),
                ItemCategory = dto.ItemCategory,
                CourseCategory = dto.CourseCategory,
                Description = dto.Description.Trim(),
                DietaryTags = dto.DietaryTags,
                PricePerTray = dto.PricePerTray,
                ServesPerTray = dto.ServesPerTray,
                MenuPackageId = dto.MenuPackageId
            };
            _db.MenuItems.Add(m);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                return Conflict(new { message = "A menu item with this name already exists." });
            }
            await _audit.LogAsync(User, AuditAction.CREATE, "MENU_ITEM", m.Id.ToString(), null, ToDto(m));
            return CreatedAtAction(nameof(GetById), new { id = m.Id }, ToDto(m));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] MenuItemCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

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
            m.IsActive = false;
            await _db.SaveChangesAsync();
            return NoContent();
        }

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private static MenuItemResponseDto ToDto(Menuitem m) =>
            new(m.Id, m.ItemName, m.ItemCategory.ToString(), m.CourseCategory.ToString(), m.Description,
                m.DietaryTags, m.PricePerTray, m.ServesPerTray, m.MenuPackageId, m.IsActive);
    }
}