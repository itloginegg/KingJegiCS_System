using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;
using System.IdentityModel.Tokens.Jwt;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]   // every endpoint needs a logged-in user; role rules are per-action below
    public class BookingsController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Bookingservice _bookings;
        private readonly Rentalservice _rentals;
        private readonly Packageservice _packages;
        private readonly Invoiceservice _invoices;

        public BookingsController(AppDbContext db, Bookingservice bookings, Rentalservice rentals,
                                  Packageservice packages, Invoiceservice invoices)
        {
            _db = db;
            _bookings = bookings;
            _rentals = rentals;
            _packages = packages;
            _invoices = invoices;
        }

        // ---------------- Reads ----------------

        /// <summary>List bookings. Admins see all (with optional filters); customers see only their own.</summary>
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] BookingStatus? status, [FromQuery] Guid? customerId)
        {
            var query = _db.Bookings.AsQueryable();

            if (!IsAdmin())
            {
                // Customers are restricted to their own bookings, ignoring any customerId filter.
                var me = CurrentUserId();
                if (me is null) return Unauthorized();
                query = query.Where(b => b.CustomerId == me);
            }
            else if (customerId is not null)
            {
                query = query.Where(b => b.CustomerId == customerId);
            }

            if (status is not null) query = query.Where(b => b.Status == status);

            var list = await query.OrderByDescending(b => b.CreatedAt).ToListAsync();
            return Ok(list.Select(ToDto));
        }

        /// <summary>Booking detail: scalars plus every line item (rental lines carry
        /// the LineId used by the delivery-status endpoint).</summary>
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var booking = await _db.Bookings.AsNoTracking()
                .Include(b => b.MenuPackage)
                .Include(b => b.Rentals).ThenInclude(r => r.RentalItem)
                .Include(b => b.Services).ThenInclude(sv => sv.ServiceItem)
                .Include(b => b.MenuItems).ThenInclude(mi => mi.Item)
                .Include(b => b.MenuTrays).ThenInclude(mt => mt.Tray)
                .FirstOrDefaultAsync(b => b.Id == id);
            if (booking is null) return NotFound();

            // A customer may only view their own booking.
            if (!IsAdmin() && booking.CustomerId != CurrentUserId())
                return Forbid();

            var detail = new BookingDetailDto(
                ToDto(booking),
                booking.MenuPackage is null ? null : new BookingPackageSummaryDto(
                    booking.MenuPackage.Id, booking.MenuPackage.PackageName,
                    booking.MenuPackage.BasePrice, booking.MenuPackage.Inclusions),
                booking.Rentals.Select(r => new BookingRentalLineDto(
                    r.Id, r.RentalItemId, r.RentalItem.ItemName, r.Quantity,
                    r.RentalItem.UnitPrice, r.Subtotal, r.DeliveryStatus.ToString())).ToList(),
                booking.Services.Select(sv => new BookingServiceLineDto(
                    sv.Id, sv.ServiceItemId, sv.ServiceItem.ServiceName, sv.Quantity,
                    sv.ServiceItem.UnitCost, sv.TotalCost)).ToList(),
                booking.MenuItems.Select(mi => new BookingMenuItemLineDto(
                    mi.ItemId, mi.Item.ItemName, mi.Quantity, mi.CapturedPrice, mi.LineTotal)).ToList(),
                booking.MenuTrays.Select(mt => new BookingMenuTrayLineDto(
                    mt.TrayId, mt.Tray.TrayName, mt.Quantity, mt.CapturedPrice, mt.LineTotal)).ToList());
            return Ok(detail);
        }

        /// <summary>The append-only revision history for a booking. Admin-only.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet("{id:guid}/history")]
        public async Task<IActionResult> GetHistory(Guid id)
        {
            var rows = await _db.BookingHistories
                .Where(h => h.BookingId == id)
                .OrderBy(h => h.RevisionNumber)
                .Select(h => new BookingHistoryResponseDto(
                    h.Id, h.BookingId, h.ChangedById, h.ChangeReason, h.RevisionNumber, h.SnapshotJson, h.SnapshotAt))
                .ToListAsync();
            return Ok(rows);
        }

        // ---------------- Create / update ----------------

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] BookingCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var callerId = CurrentUserId();
            if (callerId is null) return Unauthorized();

            // A customer can only ever book for themselves — their token id wins,
            // regardless of what CustomerId they sent. An admin books for any customer.
            var customerId = IsAdmin() ? dto.CustomerId : callerId.Value;

            try
            {
                var booking = await _bookings.CreateAsync(
                    customerId, dto.BookingType, dto.EventDate, dto.StartTime, dto.EndDate, dto.EndTime,
                    dto.EventType, dto.VenueAddress, dto.GuestCount, dto.MenuPackageId);
                return CreatedAtAction(nameof(GetById), new { id = booking.Id }, ToDto(booking));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] BookingUpdateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var adminId = CurrentUserId();
            if (adminId is null) return Unauthorized();

            try
            {
                var booking = await _bookings.UpdateAsync(
                    id, adminId.Value, dto.BookingName, dto.EventDate, dto.StartTime, dto.EndDate,
                    dto.EndTime, dto.EventType, dto.VenueAddress, dto.GuestCount, dto.MenuPackageId);
                return Ok(ToDto(booking));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        // ---------------- Lifecycle ----------------

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/confirm")]
        public async Task<IActionResult> Confirm(Guid id)
        {
            try { await _bookings.ConfirmBookingAsync(id, CurrentUserId()); return await Refreshed(id); }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>
        /// Cancels a booking. Admin: any non-terminal. Customer: their own Draft or
        /// Pending only — a Confirmed booking needs a cancellation request instead.
        /// </summary>
        [HttpPost("{id:guid}/cancel")]
        public async Task<IActionResult> Cancel(Guid id)
        {
            var booking = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);
            if (booking is null) return NotFound();

            var byCustomer = !IsAdmin();
            if (byCustomer && booking.CustomerId != CurrentUserId()) return Forbid();

            try
            {
                await _bookings.CancelBookingAsync(id, byCustomer ? null : CurrentUserId(), byCustomer);
                return await Refreshed(id);
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>
        /// Customer files a request to cancel their CONFIRMED booking. The owner
        /// reviews and executes it. The reservation fee is non-refundable; partial
        /// payments beyond it are settled with the caterer.
        /// </summary>
        [HttpPost("{id:guid}/request-cancellation")]
        public async Task<IActionResult> RequestCancellation(Guid id, [FromBody] RequestCancellationDto? dto)
        {
            var booking = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);
            if (booking is null) return NotFound();
            if (!IsAdmin() && booking.CustomerId != CurrentUserId()) return Forbid();

            try
            {
                await _bookings.RequestCancellationAsync(id, dto?.Reason);
                return Ok(new
                {
                    message = "Cancellation request filed. The reservation fee is non-refundable; " +
                              "for payments beyond it, you can file a refund request on each payment " +
                              "once the caterer processes the cancellation.",
                    booking = await _db.Bookings.AsNoTracking()
                        .Where(b => b.Id == id).Select(b => b.Id).FirstAsync()
                });
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>Marks a Confirmed booking Completed (for a delivery order, this is "delivered").</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/complete")]
        public async Task<IActionResult> Complete(Guid id)
        {
            try { await _bookings.CompleteBookingAsync(id, CurrentUserId()); return await Refreshed(id); }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        // ---------------- Line items (admin-only for now) ----------------

        // ---------------- Line items (owner anytime while editable; customer only on their own Draft) ----------------

        [HttpPost("{id:guid}/rentals")]
        public async Task<IActionResult> AddRental(Guid id, [FromBody] AddRentalDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;
            try { await _rentals.AddRentalAsync(id, dto.RentalItemId, dto.Quantity); return await Refreshed(id); }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [HttpPost("{id:guid}/services")]
        public async Task<IActionResult> AddService(Guid id, [FromBody] AddServiceDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;
            try { await _bookings.AddServiceAsync(id, dto.ServiceItemId, dto.Quantity); return await Refreshed(id); }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [HttpPost("{id:guid}/menu-items")]
        public async Task<IActionResult> AddMenuItem(Guid id, [FromBody] AddMenuItemDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;
            try { await _bookings.AddMenuItemAsync(id, dto.ItemId, dto.Quantity); return await Refreshed(id); }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [HttpPost("{id:guid}/menu-trays")]
        public async Task<IActionResult> AddMenuTray(Guid id, [FromBody] AddMenuTrayDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;
            try { await _bookings.AddMenuTrayAsync(id, dto.TrayId, dto.Quantity); return await Refreshed(id); }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>Customer submits their Draft booking for owner review (Draft -> Pending).</summary>
        [HttpPost("{id:guid}/submit")]
        public async Task<IActionResult> Submit(Guid id)
        {
            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;
            try { await _bookings.SubmitAsync(id); return await Refreshed(id); }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>Choose the dish(es) for one package slot on this booking (replaces prior choices for that slot).</summary>
        [HttpPost("{id:guid}/package-selections")]
        public async Task<IActionResult> ChooseSlotItems(Guid id, [FromBody] ChooseSlotItemsDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;
            try
            {
                await _packages.SetSlotSelectionAsync(id, dto.SlotId, dto.ItemIds);
                return await GetPackageSelections(id);
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>The customer's current package slot selections for this booking.</summary>
        [HttpGet("{id:guid}/package-selections")]
        public async Task<IActionResult> GetPackageSelections(Guid id)
        {
            var booking = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);
            if (booking is null) return NotFound();
            if (!IsAdmin() && booking.CustomerId != CurrentUserId()) return Forbid();

            var selections = await _packages.GetSelectionsAsync(id);
            return Ok(selections.Select(s => new BookingPackageSelectionDto(
                s.MenuPackageSlotId, s.Slot.Label, s.MenuItemId, s.MenuItem.ItemName)));
        }

        /// <summary>
        /// Owner updates a rental line's delivery lifecycle. Marking it Returned is
        /// what frees the stock for other bookings; Damaged keeps holding stock until
        /// resolved (repair -> Returned, or write off and adjust the item's quantity).
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}/rentals/{rentalId:guid}/delivery-status")]
        public async Task<IActionResult> UpdateRentalDeliveryStatus(
            Guid id, Guid rentalId, [FromBody] UpdateDeliveryStatusDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            try
            {
                var rental = await _rentals.UpdateDeliveryStatusAsync(id, rentalId, dto.DeliveryStatus);
                return Ok(new
                {
                    rental.Id,
                    rental.RentalItemId,
                    itemName = rental.RentalItem.ItemName,
                    rental.Quantity,
                    deliveryStatus = rental.DeliveryStatus.ToString()
                });
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>The derived payment plan (down payment, 50% one week prior, balance on event day).</summary>
        [HttpGet("{id:guid}/payment-schedule")]
        public async Task<IActionResult> PaymentSchedule(Guid id)
        {
            var booking = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);
            if (booking is null) return NotFound();
            if (!IsAdmin() && booking.CustomerId != CurrentUserId()) return Forbid();

            try
            {
                var schedule = await _invoices.GetPaymentScheduleAsync(id, DateOnly.FromDateTime(DateTime.Now));
                return Ok(schedule);
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        // ---------------- Helpers ----------------

        /// <summary>
        /// Write authorization for a specific booking. Admins may write to any booking
        /// (the service's own status guard still applies). A customer may write only to
        /// their OWN booking and only while it is still a Draft — once submitted, it's
        /// the owner's to manage.
        /// </summary>
        private async Task<(bool ok, IActionResult? error)> AuthorizeWrite(Guid bookingId)
        {
            var booking = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == bookingId);
            if (booking is null) return (false, NotFound());

            if (IsAdmin()) return (true, null);

            if (booking.CustomerId != CurrentUserId()) return (false, Forbid());
            if (booking.Status != BookingStatus.Draft)
                return (false, BadRequest(new { message = "You can only change a booking before submitting it." }));

            return (true, null);
        }

        private async Task<IActionResult> Refreshed(Guid id)
        {
            var booking = await _db.Bookings.FindAsync(id);
            return booking is null ? NotFound() : Ok(ToDto(booking));
        }

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private Guid? CurrentUserId()
        {
            var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                      ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            return Guid.TryParse(sub, out var id) ? id : null;
        }

        private static BookingResponseDto ToDto(Booking b) => new(
            b.Id, b.BookingName, b.CustomerId, b.BookingType.ToString(),
            b.EventDate, b.StartTime, b.EndDate, b.EndTime,
            b.EventType?.ToString(), b.VenueAddress, b.GuestCount, b.Status.ToString(),
            b.DepositStatus.ToString(), b.TotalAmount, b.MenuPackageId,
            b.CancellationRequested, b.CancellationRequestReason, b.CreatedAt);
    }
}