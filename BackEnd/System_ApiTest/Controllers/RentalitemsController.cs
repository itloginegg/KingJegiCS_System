using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]   // any logged-in user can read; writes are owner-side (below)
    public class RentalitemsController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }

        private readonly AppDbContext _db;
        private readonly Rentalservice _rentals;
        private readonly Auditlogservice _audit;
        private readonly IWebHostEnvironment _env;

        public RentalitemsController(AppDbContext db, Rentalservice rentals, Auditlogservice audit, IWebHostEnvironment env)
        {
            _db = db;
            _rentals = rentals;
            _audit = audit;
            _env = env;
        }

        /// <summary>Catalog list. Admins see everything; customers see only active items.</summary>
        [AllowAnonymous]   // guests may browse rentals (item 1)
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var query = _db.RentalItems.AsQueryable();
            if (!IsAdmin()) query = query.Where(i => i.IsActive);

            var items = await query.OrderBy(i => i.ItemName).ToListAsync();

            // One grouped query for all items' outgoing quantities (no N+1).
            var outgoing = await _db.Rentals
                .Where(r => (r.Booking.Status == BookingStatus.Confirmed ||
                             r.Booking.Status == BookingStatus.Completed)
                            && r.DeliveryStatus != DeliveryStatus.Returned)
                .GroupBy(r => r.RentalItemId)
                .Select(g => new { g.Key, Qty = g.Sum(r => r.Quantity) })
                .ToDictionaryAsync(x => x.Key, x => x.Qty);

            return Ok(items.Select(i => ToDto(i, outgoing.GetValueOrDefault(i.Id))));
        }

        [AllowAnonymous]
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var item = await _db.RentalItems.FindAsync(id);
            if (item is null) return NotFound();
            if (!IsAdmin() && !item.IsActive) return NotFound(); // hide inactive from customers
            return Ok(ToDto(item, await OutgoingAsync(id)));
        }

        /// <summary>
        /// Live availability for an item (total / outgoing / available).
        ///
        /// Pass <paramref name="from"/> (and optionally <paramref name="to"/>) to ask
        /// the question a customer actually has — "can I rent this for my dates?" — which
        /// applies the same overlap-plus-turnaround rule the confirm check uses. Omit
        /// them for "how many are off the shelf right now".
        /// </summary>
        [AllowAnonymous]
        [HttpGet("{id:guid}/availability")]
        public async Task<IActionResult> Availability(
            Guid id, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
        {
            if (from is null && to is not null)
                return BadRequest(new { message = "Provide 'from' as well as 'to'." });
            if (from is not null && to is not null && to < from)
                return BadRequest(new { message = "'to' must be on or after 'from'." });

            try
            {
                var a = await _rentals.GetAvailabilityAsync(id, from, to);
                var item = await _db.RentalItems.FindAsync(id);
                return Ok(new RentalItemAvailabilityDto(id, item!.ItemName, a.Total, a.Outgoing, a.Available));
            }
            catch (BookingRuleException ex) { return NotFound(new { message = ex.Message }); }
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost]
        public async Task<IActionResult> Create([FromForm] RentalItemCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var (isValid, imageError) = ImageUploadHelper.ValidateImage(dto.ImageFile);
            if (!isValid) return BadRequest(new { message = imageError });

            string? imageUrl = null;
            if (dto.ImageFile is not null)
            {
                imageUrl = await ImageUploadHelper.SaveImageAsync(dto.ImageFile, _env, "rentals");
            }

            var item = new Rentalitem
            {
                ItemName = dto.ItemName.Trim(),
                Category = dto.Category,
                TotalQuantity = dto.TotalQuantity,
                UnitPrice = dto.UnitPrice,
                ImageUrl = imageUrl
            };
            _db.RentalItems.Add(item);
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.CREATE, "RENTAL_ITEM", item.Id.ToString(), null, ToDto(item, 0));
            return CreatedAtAction(nameof(GetById), new { id = item.Id }, ToDto(item, 0));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromForm] RentalItemUpdateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var (isValid, imageError) = ImageUploadHelper.ValidateImage(dto.ImageFile);
            if (!isValid) return BadRequest(new { message = imageError });

            var item = await _db.RentalItems.FindAsync(id);
            if (item is null) return NotFound();
            var itemOut = await OutgoingAsync(id);
            var old = ToDto(item, itemOut);

            item.ItemName = dto.ItemName.Trim();
            item.Category = dto.Category;
            item.TotalQuantity = dto.TotalQuantity;
            item.UnitPrice = dto.UnitPrice;
            item.IsActive = dto.IsActive;

            if (dto.ImageFile is not null)
            {
                ImageUploadHelper.DeleteImage(_env, item.ImageUrl);
                item.ImageUrl = await ImageUploadHelper.SaveImageAsync(dto.ImageFile, _env, "rentals");
            }

            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.UPDATE, "RENTAL_ITEM", item.Id.ToString(), old, ToDto(item, itemOut));
            return Ok(ToDto(item, itemOut));
        }

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        /// <summary>Confirmed outgoing for one item (Confirmed/Completed bookings, not yet Returned).</summary>
        /// <summary>
        /// How many units are physically off the shelf right now.
        ///
        /// Was a second, hand-written copy of the availability rule; it now delegates to
        /// Rentalservice.CommittedStock so the catalog can't disagree with what confirm
        /// will actually allow. No date window, because a catalog row is a statement
        /// about the warehouse today, not about any particular booking's dates —
        /// future reservations are not "out".
        /// </summary>
        private async Task<int> OutgoingAsync(Guid rentalItemId) =>
            await _db.Rentals
                .Where(Rentalservice.CommittedStock(rentalItemId))
                .SumAsync(r => (int?)r.Quantity) ?? 0;

        private static RentalItemResponseDto ToDto(Rentalitem i, int quantityOut) =>
            new(i.Id, i.ItemName, i.Category.ToString(), i.TotalQuantity,
                quantityOut, i.TotalQuantity - quantityOut, i.UnitPrice, i.IsActive, i.ImageUrl);
    }
}
 


