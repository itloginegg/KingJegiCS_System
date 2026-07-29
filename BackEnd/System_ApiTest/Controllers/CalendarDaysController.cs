using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// The calendar's real per-day state — the same numbers Calendarday.RecalculateLock()
    /// derives (IsLocked = IsManuallyLocked || ConfirmedCount >= MaxCapacity), so every
    /// calendar in the UI can show true availability instead of guessing at it.
    ///
    /// The range read is anonymous on purpose: the landing page and the public booking
    /// form both need it, and the payload carries only dates and counts — never a booking,
    /// a customer, or an amount.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class CalendarDaysController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Auditlogservice _audit;

        /// <summary>Widest window a single read may span, so a stray query can't scan years.</summary>
        private const int MaxRangeDays = 400;

        public CalendarDaysController(AppDbContext db, Auditlogservice audit)
        {
            _db = db;
            _audit = audit;
        }

        /// <summary>
        /// Every calendar day with a row between <paramref name="from"/> and
        /// <paramref name="to"/> (inclusive). Dates with no row have never been booked:
        /// they're implicitly open at the default capacity, so they're simply absent and
        /// the caller treats a miss as unlocked.
        /// </summary>
        [AllowAnonymous]
        [HttpGet]
        public async Task<IActionResult> GetRange([FromQuery] DateOnly from, [FromQuery] DateOnly to)
        {
            if (to < from)
                return BadRequest(new { message = "'to' must be on or after 'from'." });

            if (to.DayNumber - from.DayNumber > MaxRangeDays)
                return BadRequest(new { message = $"The range may span at most {MaxRangeDays} days." });

            var rows = await _db.CalendarDays.AsNoTracking()
                .Where(d => d.Date >= from && d.Date <= to)
                .OrderBy(d => d.Date)
                .Select(d => new CalendarDayResponseDto(
                    d.Date, d.MaxCapacity, d.ConfirmedCount, d.IsManuallyLocked, d.IsLocked))
                .ToListAsync();

            return Ok(rows);
        }

        /// <summary>
        /// Manually locks or unlocks a day. Creates the day row on first touch (at the
        /// configured default capacity) so an admin can block a date nobody has booked
        /// yet. Unlocking only clears the MANUAL flag — a day at capacity stays locked,
        /// because RecalculateLock() re-derives IsLocked from the confirmed count.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("lock")]
        public async Task<IActionResult> SetLock([FromBody] SetDayLockDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var day = await _db.CalendarDays.FirstOrDefaultAsync(d => d.Date == dto.Date);
            CalendarDayResponseDto? before = null;

            if (day is null)
            {
                var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
                day = new Calendarday
                {
                    Date = dto.Date,
                    MaxCapacity = settings?.DefaultMaxCapacity ?? 3
                };
                _db.CalendarDays.Add(day);
            }
            else
            {
                before = ToDto(day);
            }

            day.IsManuallyLocked = dto.IsManuallyLocked;
            day.RecalculateLock();

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Another request created this day concurrently — reuse its row and apply
                // the flag there, mirroring Bookingservice.CreateAsync's get-or-create.
                _db.Entry(day).State = EntityState.Detached;
                day = await _db.CalendarDays.FirstOrDefaultAsync(d => d.Date == dto.Date);
                if (day is null) throw;

                before = ToDto(day);
                day.IsManuallyLocked = dto.IsManuallyLocked;
                day.RecalculateLock();
                await _db.SaveChangesAsync();
            }

            var after = ToDto(day);
            await _audit.LogAsync(User, AuditAction.UPDATE, "CALENDAR_DAY",
                dto.Date.ToString("yyyy-MM-dd"), before, after);

            return Ok(after);
        }

        private static CalendarDayResponseDto ToDto(Calendarday d) =>
            new(d.Date, d.MaxCapacity, d.ConfirmedCount, d.IsManuallyLocked, d.IsLocked);
    }
}
