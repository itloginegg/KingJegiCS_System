using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;
using static System_ApiTest.Services.PayMongoservice;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PaymentsController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Paymentservice _payments;

        public PaymentsController(AppDbContext db, Paymentservice payments)
        {
            _db = db;
            _payments = payments;
        }
        /// <summary>
        /// PayMongo webhook receiver. AllowAnonymous (PayMongo isn't logged in) but
        /// gated by HMAC signature verification — an invalid or missing signature is
        /// a 401 and nothing is processed. Handles checkout paid + payment failed
        /// events; everything else is acknowledged and ignored. Always returns 200
        /// for verified events (even unprocessable ones) so PayMongo stops retrying —
        /// unresolvable cases are flagged on the payment for the owner instead.
        /// </summary>
        [AllowAnonymous]
        [HttpPost("webhook/paymongo")]
        public async Task<IActionResult> PayMongoWebhook(
            [FromServices] PayMongoservice gateway,
            [FromServices] ILogger<PaymentsController> logger)
        {
            string rawBody;
            using (var reader = new StreamReader(Request.Body))
                rawBody = await reader.ReadToEndAsync();

            var signature = Request.Headers["Paymongo-Signature"].FirstOrDefault();
            logger.LogInformation(
                "PayMongo webhook HIT. Body length: {Len}. Signature header present: {HasSig}. " +
                "Method: {Method}. ContentType: '{CT}'. UserAgent: '{UA}'. Headers: [{Headers}]",
                rawBody.Length, signature is not null,
                Request.Method, Request.ContentType ?? "(none)",
                Request.Headers.UserAgent.ToString(),
                string.Join(", ", Request.Headers.Keys));

            if (!gateway.VerifyWebhookSignature(signature, rawBody))
            {
                logger.LogWarning(
                    "PayMongo webhook REJECTED: signature verification failed. " +
                    "(Usual causes: wrong/missing PayMongo:WebhookSecret in user-secrets, " +
                    "or the secret belongs to a different/re-created webhook.)");
                return Unauthorized(new { message = "Invalid webhook signature." });
            }

            string eventType = "";
            string? resourceId = null;
            string? gatewayPaymentId = null;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(rawBody);
                var attributes = doc.RootElement.GetProperty("data").GetProperty("attributes");
                eventType = attributes.GetProperty("type").GetString() ?? "";
                var resource = attributes.GetProperty("data");
                resourceId = resource.GetProperty("id").GetString();

                // On checkout events, the session resource carries its payment(s).
                if (resource.TryGetProperty("attributes", out var resAttrs) &&
                    resAttrs.TryGetProperty("payments", out var pays) &&
                    pays.ValueKind == System.Text.Json.JsonValueKind.Array &&
                    pays.GetArrayLength() > 0 &&
                    pays[0].TryGetProperty("id", out var pid))
                {
                    gatewayPaymentId = pid.GetString();
                }
            }
            catch (System.Text.Json.JsonException)
            {
                return BadRequest(new { message = "Unreadable webhook payload." });
            }

            if (resourceId is null)
                return Ok(new { handled = false, reason = "no resource id" });

            logger.LogInformation(
                "PayMongo webhook VERIFIED. EventType: '{EventType}', ResourceId: '{ResourceId}', GatewayPaymentId: '{PayId}'",
                eventType, resourceId, gatewayPaymentId ?? "(none)");

            var today = DateOnly.FromDateTime(DateTime.Now);
            var outcome = eventType switch
            {
                "checkout_session.payment.paid" => await _payments.ApplyGatewayPaidAsync(resourceId, gatewayPaymentId, today),
                "payment.paid" => await _payments.ApplyGatewayPaidAsync(resourceId, gatewayPaymentId, today),
                "payment.failed" => await _payments.ApplyGatewayFailedAsync(resourceId, "failed"),
                _ => $"ignored event type: {eventType}"
            };

            logger.LogInformation("PayMongo webhook OUTCOME: {Outcome}", outcome);
            return Ok(new { handled = true, eventType, outcome });
        }

        /// <summary>
        /// Starts an online payment: opens a PayMongo checkout session and records a
        /// Pending payment tied to it. Redirect the customer to checkoutUrl; the
        /// payment is verified automatically by the webhook (or manually until then).
        /// </summary>
        [HttpPost("checkout")]
        public async Task<IActionResult> Checkout([FromBody] CheckoutDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (!await CanAccessInvoice(dto.InvoiceId)) return Forbid();
            try
            {
                var (payment, url) = await _payments.StartCheckoutAsync(dto.InvoiceId, dto.Amount);
                return Ok(new { payment = ToDto(payment), checkoutUrl = url });
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
            catch (PayMongoException ex)
            {
                return StatusCode(502, new
                {
                    message = "The payment gateway is unavailable or rejected the request. " +
                              "Please try again, or pay manually and have the caterer record it.",
                    detail = ex.Message
                });
            }
        }

        /// <summary>
        /// Records a payment against an invoice as Pending. A customer may record on
        /// their own booking's invoice; an owner/assistant may record on any. The
        /// payment time is server-stamped; only an owner/assistant may supply one
        /// (to back-record an offline payment) — a customer-sent time is ignored.
        /// </summary>
        [HttpPost]
        public async Task<IActionResult> Record([FromBody] RecordPaymentDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (!await CanAccessInvoice(dto.InvoiceId)) return Forbid();
            try
            {
                // Admin-only override: customers can't set the payment time.
                var paidAt = IsAdmin() ? dto.PaymentDateTime : null;

                var p = await _payments.RecordAsync(
                    dto.InvoiceId, dto.AmountPaid, dto.Method, paidAt, dto.TransactionReference);
                return CreatedAtAction(nameof(GetByInvoice), new { invoiceId = dto.InvoiceId }, ToDto(p));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>Owner confirms a payment actually arrived (Pending -> Success), updating invoice + deposit.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/confirm")]
        public async Task<IActionResult> Confirm(Guid id, [FromQuery] DateOnly? today)
        {
            if (!await _db.Payments.AnyAsync(p => p.Id == id)) return NotFound();
            try
            {
                await _payments.MarkSuccessAsync(id, today ?? DateOnly.FromDateTime(DateTime.Now));
                var p = await _db.Payments.FindAsync(id);
                return Ok(ToDto(p!));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>
        /// Owner refunds an amount from a payment (body optional; omitted = full
        /// remaining). Supports partial refunds — e.g. everything above the
        /// non-refundable reservation fee. Re-syncs invoice + deposit ladders.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/refund")]
        public async Task<IActionResult> Refund(Guid id, [FromBody] RefundDto? dto, [FromQuery] DateOnly? today)
        {
            if (!await _db.Payments.AnyAsync(p => p.Id == id)) return NotFound();
            try
            {
                await _payments.RefundAsync(id, dto?.Amount, today ?? DateOnly.FromDateTime(DateTime.Now));
                var p = await _db.Payments.FindAsync(id);
                return Ok(ToDto(p!));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>
        /// Customer requests a refund on their payment (amount omitted = full remaining).
        /// The owner reviews it — approving refunds the amount; denying records why.
        /// </summary>
        [HttpPost("{id:guid}/request-refund")]
        public async Task<IActionResult> RequestRefund(Guid id, [FromBody] RequestRefundDto? dto)
        {
            var payment = await _db.Payments.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id);
            if (payment is null) return NotFound();
            if (!await CanAccessInvoice(payment.InvoiceId)) return Forbid();

            try
            {
                await _payments.RequestRefundAsync(id, dto?.Amount, dto?.Reason);
                var fresh = await _db.Payments.FindAsync(id);
                return Ok(ToDto(fresh!));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>Owner rejects a Pending payment (wrong amount, never arrived, duplicate) -> Failed.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/reject")]
        public async Task<IActionResult> Reject(Guid id)
        {
            if (!await _db.Payments.AnyAsync(p => p.Id == id)) return NotFound();
            try
            {
                await _payments.RejectAsync(id);
                var fresh = await _db.Payments.FindAsync(id);
                return Ok(ToDto(fresh!));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>Owner denies an open refund request with a reason the customer can see.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/deny-refund")]
        public async Task<IActionResult> DenyRefund(Guid id, [FromBody] DenyRefundDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (!await _db.Payments.AnyAsync(p => p.Id == id)) return NotFound();
            try
            {
                await _payments.DenyRefundAsync(id, dto.Reason);
                var fresh = await _db.Payments.FindAsync(id);
                return Ok(ToDto(fresh!));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>
        /// Owner review queue: all open refund requests with their booking context
        /// (status, cancellation-request flag) so eligibility can be judged in place.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet("refund-requests")]
        public async Task<IActionResult> RefundRequests()
        {
            var rows = await _db.Payments
                .Where(p => p.RefundRequested)
                .OrderBy(p => p.RefundRequestedAt)
                .Join(_db.Invoices, p => p.InvoiceId, i => i.Id, (p, i) => new { p, i })
                .Join(_db.Bookings, x => x.i.BookingId, b => b.Id, (x, b) => new RefundRequestQueueItemDto(
                    x.p.Id, x.p.AmountPaid, x.p.AmountPaid - x.p.RefundedAmount,
                    x.p.RefundRequestedAmount ?? (x.p.AmountPaid - x.p.RefundedAmount),
                    x.p.RefundRequestReason, x.p.RefundRequestedAt,
                    b.Id, b.BookingName, b.Status.ToString(), b.CancellationRequested))
                .ToListAsync();
            return Ok(rows);
        }

        [HttpGet("invoice/{invoiceId:guid}")]
        public async Task<IActionResult> GetByInvoice(Guid invoiceId)
        {
            if (!await _db.Invoices.AnyAsync(i => i.Id == invoiceId)) return NotFound();
            if (!await CanAccessInvoice(invoiceId)) return Forbid();

            var payments = await _db.Payments.Where(p => p.InvoiceId == invoiceId)
                .OrderBy(p => p.PaymentDateTime).ToListAsync();
            return Ok(payments.Select(ToDto));
        }

        // ---- helpers ----

        /// <summary>Owner can access any invoice; a customer only their own booking's invoice.</summary>
        private async Task<bool> CanAccessInvoice(Guid invoiceId)
        {
            if (IsAdmin()) return true;
            var customerId = await _db.Invoices
                .Where(i => i.Id == invoiceId)
                .Join(_db.Bookings, i => i.BookingId, b => b.Id, (i, b) => (Guid?)b.CustomerId)
                .FirstOrDefaultAsync();
            return customerId is not null && customerId == CurrentUserId();
        }

        private static PaymentResponseDto ToDto(Payment p) =>
            new(p.Id, p.InvoiceId, p.AmountPaid, p.RefundedAmount, p.AmountPaid - p.RefundedAmount,
                p.PaymentDateTime, p.Method.ToString(), p.Status.ToString(), p.TransactionReference,
                p.RefundRequested, p.RefundRequestedAmount, p.RefundRequestReason, p.RefundRequestDecision);

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private Guid? CurrentUserId()
        {
            var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                      ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            return Guid.TryParse(sub, out var id) ? id : null;
        }
    }
}