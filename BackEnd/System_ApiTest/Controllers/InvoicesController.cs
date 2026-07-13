using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class InvoicesController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Invoiceservice _invoices;

        public InvoicesController(AppDbContext db, Invoiceservice invoices)
        {
            _db = db;
            _invoices = invoices;
        }

        /// <summary>Owner generates the invoice for a Confirmed booking (totals captured server-side).</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost]
        public async Task<IActionResult> Generate([FromBody] GenerateInvoiceDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            try
            {
                var inv = await _invoices.GenerateAsync(dto.BookingId, dto.IssueDate, dto.DueDate);
                return CreatedAtAction(nameof(GetById), new { id = inv.Id }, await ToDto(inv));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var inv = await _db.Invoices.FindAsync(id);
            if (inv is null) return NotFound();
            if (!await CanAccess(inv)) return Forbid();
            return Ok(await ToDto(inv));
        }

        [HttpGet("booking/{bookingId:guid}")]
        public async Task<IActionResult> GetByBooking(Guid bookingId)
        {
            var inv = await _db.Invoices.FirstOrDefaultAsync(i => i.BookingId == bookingId);
            if (inv is null) return NotFound();
            if (!await CanAccess(inv)) return Forbid();
            return Ok(await ToDto(inv));
        }

        /// <summary>Marks a Draft invoice as Sent (issued to the customer). Owner-only.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/send")]
        public async Task<IActionResult> Send(Guid id)
        {
            try
            {
                await _invoices.MarkSentAsync(id);
                var fresh = await _db.Invoices.FindAsync(id);
                return Ok(await ToDto(fresh!));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>Recomputes status (Overdue if past due, Paid if fully paid). Owner-only.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/refresh")]
        public async Task<IActionResult> Refresh(Guid id, [FromQuery] DateOnly? today)
        {
            if (!await _db.Invoices.AnyAsync(i => i.Id == id)) return NotFound();
            try
            {
                await _invoices.RefreshStatusAsync(id, today ?? DateOnly.FromDateTime(DateTime.Now));
                var fresh = await _db.Invoices.FindAsync(id);
                return Ok(await ToDto(fresh!));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        // ---- helpers ----

        private async Task<bool> CanAccess(Invoice inv)
        {
            if (IsAdmin()) return true;
            var customerId = await _db.Bookings.Where(b => b.Id == inv.BookingId)
                .Select(b => (Guid?)b.CustomerId).FirstOrDefaultAsync();
            return customerId == CurrentUserId();
        }

        private async Task<InvoiceResponseDto> ToDto(Invoice i)
        {
            var paid = await _invoices.GetPaidTotalAsync(i.Id);
            return new InvoiceResponseDto(
                i.Id, i.BookingId, i.IssueDate, i.DueDate,
                i.FoodTotal, i.RentalTotal, i.ServiceTotal, i.TaxAmount, i.GrandTotal,
                i.Status.ToString(), paid);
        }

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private Guid? CurrentUserId()
        {
            var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                      ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            return Guid.TryParse(sub, out var id) ? id : null;
        }
    }
}