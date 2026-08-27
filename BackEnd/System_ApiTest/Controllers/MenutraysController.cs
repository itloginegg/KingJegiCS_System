using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class MenutraysController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Menutrayservice _trays;
        private readonly Auditlogservice _audit;

        public MenutraysController(AppDbContext db, Menutrayservice trays, Auditlogservice audit)
        {
            _db = db;
            _trays = trays;
            _audit = audit;
        }

        [AllowAnonymous]   // guests may browse the catalog (item 1)
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var query = _db.MenuTrays.Include(t => t.Dishes).ThenInclude(d => d.MenuItem).AsQueryable();
            if (!IsAdmin()) query = query.Where(t => t.IsActive);

            var trays = await query.OrderBy(t => t.TrayName).ToListAsync();
            return Ok(trays.Select(ToDto));
        }

        [AllowAnonymous]
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var t = await _db.MenuTrays.Include(x => x.Dishes).ThenInclude(d => d.MenuItem)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (t is null) return NotFound();
            if (!IsAdmin() && !t.IsActive) return NotFound();
            return Ok(ToDto(t));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] MenuTrayCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            try
            {
                var tray = await _trays.CreateAsync(
                    dto.TrayName, dto.PricePerTray, dto.ServesMin, dto.ServesMax, dto.DishItemIds);
                var withDishes = await _db.MenuTrays.Include(t => t.Dishes).ThenInclude(d => d.MenuItem)
                    .FirstAsync(t => t.Id == tray.Id);
                await _audit.LogAsync(User, AuditAction.CREATE, "MENU_TRAY", tray.Id.ToString(), null, ToDto(withDishes));
                return CreatedAtAction(nameof(GetById), new { id = tray.Id }, ToDto(withDishes));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] MenuTrayCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var tray = await _db.MenuTrays.Include(t => t.Dishes).ThenInclude(d => d.MenuItem)
                .FirstOrDefaultAsync(t => t.Id == id);
            if (tray is null) return NotFound();
            var old = ToDto(tray);

            tray.TrayName = dto.TrayName.Trim();
            tray.PricePerTray = dto.PricePerTray;
            tray.ServesMin = dto.ServesMin;
            tray.ServesMax = dto.ServesMax;
            await _db.SaveChangesAsync();

            try
            {
                await _trays.UpdateDishesAsync(id, dto.DishItemIds);  // re-enforces exactly-4
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }

            var refreshed = await _db.MenuTrays.Include(t => t.Dishes).ThenInclude(d => d.MenuItem)
                .FirstAsync(t => t.Id == id);
            await _audit.LogAsync(User, AuditAction.UPDATE, "MENU_TRAY", id.ToString(), old, ToDto(refreshed));
            return Ok(ToDto(refreshed));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/deactivate")]
        public async Task<IActionResult> Deactivate(Guid id) => await SetActiveAsync(id, false);

        /// <summary>Puts a deactivated tray back in the catalog. The mirror of /deactivate.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/reactivate")]
        public async Task<IActionResult> Reactivate(Guid id) => await SetActiveAsync(id, true);

        /// <summary>
        /// Shared body for the two endpoints above. Dishes are Included so the audit
        /// snapshot is the full tray, not a tray with an empty dish list.
        /// </summary>
        private async Task<IActionResult> SetActiveAsync(Guid id, bool isActive)
        {
            var t = await _db.MenuTrays.Include(x => x.Dishes).ThenInclude(d => d.MenuItem)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (t is null) return NotFound();
            if (t.IsActive == isActive) return NoContent();   // no change; nothing to record

            var old = ToDto(t);
            t.IsActive = isActive;
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.UPDATE, "MENU_TRAY", t.Id.ToString(), old, ToDto(t));
            return NoContent();
        }

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private static MenuTrayResponseDto ToDto(Menutray t) =>
            new(t.Id, t.TrayName, t.PricePerTray, t.ServesMin, t.ServesMax, t.IsActive,
                t.Dishes.Select(d => new TrayDishDto(
                    d.MenuItem.Id,
                    d.MenuItem.ItemName,
                    d.MenuItem.ItemCategory.ToString(),
                    d.MenuItem.CourseCategory.ToString())).ToList());
    }
}