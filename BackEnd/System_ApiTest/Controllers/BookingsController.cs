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
        private readonly Auditlogservice _audit;

        public BookingsController(AppDbContext db, Bookingservice bookings, Rentalservice rentals,
                                  Packageservice packages, Invoiceservice invoices, Auditlogservice audit)
        {
            _db = db;
            _bookings = bookings;
            _rentals = rentals;
            _packages = packages;
            _invoices = invoices;
            _audit = audit;
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
            return Ok(list.Select(b => ToDto(b)));
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
                    r.RentalItem.UnitPrice, r.Subtotal, r.DeliveryStatus.ToString(),
                    r.DamageNote)).ToList(),
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
                // Same check that lets an admin book on someone else's behalf decides the
                // source: if staff created it, it's a walk-in.
                var source = IsAdmin() ? BookingSource.WalkIn : BookingSource.Customer;

                var booking = await _bookings.CreateAsync(
                    customerId, dto.BookingType, dto.EventDate, dto.StartTime, dto.EndDate, dto.EndTime,
                    dto.EventType, dto.VenueAddress, dto.GuestCount, dto.MenuPackageId, dto.ContactNumber,
                    source);

                // No-ops for a customer booking for themselves; records the walk-in case.
                await _audit.LogAsync(User, AuditAction.CREATE, "BOOKING", booking.Id.ToString(),
                    null, ToDto(booking));

                return CreatedAtAction(nameof(GetById), new { id = booking.Id }, ToDto(booking));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] BookingUpdateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;

            try
            {
                var currentUserId = CurrentUserId() ?? Guid.Empty;
                var changedById = (User.IsInRole("Owner") || User.IsInRole("Assistant")) ? (Guid?)currentUserId : null;

                // Snapshot before the write, so the audit row carries a real diff.
                var before = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);

                var booking = await _bookings.UpdateAsync(
                    id, changedById, dto.BookingName, dto.EventDate, dto.StartTime, dto.EndDate,
                    dto.EndTime, dto.EventType, dto.VenueAddress, dto.GuestCount, dto.MenuPackageId, dto.ContactNumber);

                await _audit.LogAsync(User, AuditAction.UPDATE, "BOOKING", id.ToString(),
                    before is null ? null : ToDto(before), ToDto(booking));

                return Ok(ToDto(booking));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        // ---------------- Lifecycle ----------------

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/confirm")]
        public async Task<IActionResult> Confirm(Guid id)
        {
            try
            {
                var before = await StatusSnapshotAsync(id);
                await _bookings.ConfirmBookingAsync(id, CurrentUserId());
                await _audit.LogAsync(User, AuditAction.UPDATE, "BOOKING_STATUS", id.ToString(),
                    before, await StatusSnapshotAsync(id));
                return await Refreshed(id);
            }
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
                var before = await StatusSnapshotAsync(id);
                await _bookings.CancelBookingAsync(id, byCustomer ? null : CurrentUserId(), byCustomer);
                await _audit.LogAsync(User, AuditAction.UPDATE, "BOOKING_STATUS", id.ToString(),
                    before, await StatusSnapshotAsync(id));
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
        /// <summary>
        /// Deletes an abandoned Draft booking. Used when a customer leaves the booking
        /// wizard without submitting, and by the background sweep for stale Drafts.
        ///
        /// Draft-only and ownership-checked: a customer may erase their own unsubmitted
        /// draft, staff may erase any. Anything Pending or later has history, an invoice
        /// and possibly payments — those must be cancelled, never deleted, so this
        /// refuses them.
        /// </summary>
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> DeleteDraft(Guid id)
        {
            var booking = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);
            if (booking is null) return NotFound();

            if (!IsAdmin() && booking.CustomerId != CurrentUserId())
                return Forbid();

            try
            {
                // Captured before deletion — afterwards there's nothing left to describe.
                var snapshot = ToDto(booking);
                await _bookings.DeleteDraftAsync(id);
                await _audit.LogAsync(User, AuditAction.DELETE, "BOOKING", id.ToString(), snapshot, null);
                return NoContent();
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>
        /// Sets the internal staff note on a booking. Owner/Assistant only — the note is
        /// never returned to a customer (see ToDto). Send a blank body to clear it.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}/admin-note")]
        public async Task<IActionResult> SetAdminNote(Guid id, [FromBody] SetAdminNoteDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            try
            {
                var booking = await _bookings.SetAdminNoteAsync(id, dto.Note);
                await _audit.LogAsync(User, AuditAction.UPDATE, "BOOKING_NOTE", id.ToString(),
                    null, new { booking.AdminNote });
                return Ok(ToDto(booking));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/complete")]
        public async Task<IActionResult> Complete(Guid id)
        {
            try
            {
                var before = await StatusSnapshotAsync(id);
                await _bookings.CompleteBookingAsync(id, CurrentUserId());
                await _audit.LogAsync(User, AuditAction.UPDATE, "BOOKING_STATUS", id.ToString(),
                    before, await StatusSnapshotAsync(id));
                return await Refreshed(id);
            }
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

        [HttpPost("{id:guid}/package")]
        public async Task<IActionResult> SetPackage(Guid id, [FromBody] SetPackageDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var (ok, error) = await AuthorizeWrite(id);
            if (!ok) return error!;

            try
            {
                var booking = await _db.Bookings.FindAsync(id);
                if (booking is null) return NotFound();

                if (dto.MenuPackageId is not null)
                {
                    var pkg = await _db.MenuPackages.FindAsync(dto.MenuPackageId.Value);
                    if (pkg is null)
                        throw new BookingRuleException($"Menu package with ID '{dto.MenuPackageId.Value}' was not found.");
                }

                booking.MenuPackageId = dto.MenuPackageId;
                await _db.SaveChangesAsync();
                await _bookings.RecomputeTotalAsync(id);
                return await Refreshed(id);
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
        /// <summary>
        /// Every rental line still awaiting an admin action, across all bookings — the
        /// returns/check-in desk. Grouped by event date on the client so a day's returns
        /// get processed together after the event.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet("rentals/outstanding")]
        public async Task<IActionResult> GetOutstandingRentals()
            => Ok(await _rentals.GetOutstandingAsync());

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}/rentals/{rentalId:guid}/delivery-status")]
        public async Task<IActionResult> UpdateRentalDeliveryStatus(
            Guid id, Guid rentalId, [FromBody] UpdateDeliveryStatusDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            try
            {
                var rental = await _rentals.UpdateDeliveryStatusAsync(
                    id, rentalId, dto.DeliveryStatus, dto.DamageNote);
                return Ok(new
                {
                    rental.Id,
                    rental.RentalItemId,
                    itemName = rental.RentalItem.ItemName,
                    rental.Quantity,
                    deliveryStatus = rental.DeliveryStatus.ToString(),
                    rental.DamageNote
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

        /// <summary>
        /// Maps a booking for the current caller. AdminNote is an INTERNAL staff note, so
        /// it is only ever populated for an Owner/Assistant — a customer reading their own
        /// booking through this same endpoint gets null, never the note's contents.
        /// </summary>
        /// <summary>
        /// The fields a lifecycle transition actually moves. Kept small on purpose: a
        /// confirm/cancel/complete audit row should show the status change, not a wall
        /// of unchanged event details.
        /// </summary>
        private async Task<object?> StatusSnapshotAsync(Guid id) =>
            await _db.Bookings.AsNoTracking()
                .Where(b => b.Id == id)
                .Select(b => new { Status = b.Status.ToString(), DepositStatus = b.DepositStatus.ToString(), b.TotalAmount })
                .FirstOrDefaultAsync();

        private BookingResponseDto ToDto(Booking b) => new(
            b.Id, b.BookingName, b.CustomerId, b.BookingType.ToString(),
            b.EventDate, b.StartTime, b.EndDate, b.EndTime,
            b.EventType?.ToString(), b.VenueAddress, b.ContactNumber, b.GuestCount, b.Status.ToString(),
            b.DepositStatus.ToString(), b.Source.ToString(), b.TotalAmount, b.MenuPackageId,
            b.CancellationRequested, b.CancellationRequestReason, b.CreatedAt,
            IsAdmin() ? b.AdminNote : null);
    }
}