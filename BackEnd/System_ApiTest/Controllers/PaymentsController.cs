using System_ApiTest.Application.Common.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PaymentsController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Paymentservice _payments;
        private readonly Auditlogservice _audit;

        public PaymentsController(AppDbContext db, Paymentservice payments, Auditlogservice audit)
        {
            _audit = audit;
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
            [FromServices] IPayMongoService gateway,
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
                // Customer-initiated in the normal case, so this usually no-ops; it
                // records the times staff start a checkout on someone's behalf.
                await _audit.LogAsync(User, AuditAction.CREATE, "PAYMENT", payment.Id.ToString(),
                    null, ToDto(payment));
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
                await _audit.LogAsync(User, AuditAction.CREATE, "PAYMENT", p.Id.ToString(), null, ToDto(p));
                return CreatedAtAction(nameof(GetByInvoice), new { invoiceId = dto.InvoiceId }, ToDto(p));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>
        /// Logs cash and verifies it in one step (Owner/Assistant only).
        ///
        /// Staff-only by nature: a customer can't hand cash to a web form. Unlike
        /// POST /api/Payments, which leaves the payment Pending for someone to verify
        /// later, this one runs the deposit sync immediately — so the booking's
        /// DepositStatus moves off Unpaid and the Confirm button becomes usable without
        /// a second "confirm the payment" click.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("cash")]
        public async Task<IActionResult> RecordCash(
            [FromBody] RecordCashPaymentDto dto,
            [FromQuery] DateOnly? today,
            // Resolved per-call rather than added to the constructor, matching how this
            // controller already pulls IPayMongoService into the webhook action.
            [FromServices] Invoiceservice invoices)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            try
            {
                var payment = await _payments.RecordCashAsync(
                    dto.InvoiceId, dto.AmountPaid, dto.PaymentDateTime, dto.TransactionReference,
                    today ?? DateOnly.FromDateTime(DateTime.Now));

                // Read back what the sync changed, so the caller doesn't have to.
                var summary = await _db.Invoices
                    .Where(i => i.Id == dto.InvoiceId)
                    .Select(i => new
                    {
                        i.BookingId,
                        BookingStatus = i.Booking.Status,
                        i.Booking.DepositStatus,
                        i.GrandTotal,
                    })
                    .FirstAsync();

                var paidTotal = await invoices.GetPaidTotalAsync(dto.InvoiceId);

                // Cash has no gateway record behind it — the audit row is the only
                // independent trace that this money was taken and by whom.
                await _audit.LogAsync(User, AuditAction.CREATE, "PAYMENT_CASH", payment.Id.ToString(),
                    null, new
                    {
                        payment.InvoiceId,
                        payment.AmountPaid,
                        payment.TransactionReference,
                        Status = payment.Status.ToString(),
                        summary.BookingId,
                        DepositStatusAfter = summary.DepositStatus.ToString(),
                    });

                return Ok(new CashPaymentResultDto(
                    ToDto(payment),
                    summary.BookingId,
                    summary.BookingStatus.ToString(),
                    summary.DepositStatus.ToString(),
                    summary.GrandTotal,
                    paidTotal));
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
                var before = await PaymentSnapshotAsync(id);
                await _payments.MarkSuccessAsync(id, today ?? DateOnly.FromDateTime(DateTime.Now));
                var p = await _db.Payments.FindAsync(id);
                await _audit.LogAsync(User, AuditAction.UPDATE, "PAYMENT", id.ToString(),
                    before, await PaymentSnapshotAsync(id));
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
                var before = await PaymentSnapshotAsync(id);
                await _payments.RefundAsync(id, dto?.Amount, today ?? DateOnly.FromDateTime(DateTime.Now));
                var p = await _db.Payments.FindAsync(id);
                // Money leaving the business — the single most audit-worthy action here.
                await _audit.LogAsync(User, AuditAction.UPDATE, "PAYMENT_REFUND", id.ToString(),
                    before, await PaymentSnapshotAsync(id));
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
                var before = await PaymentSnapshotAsync(id);
                await _payments.RejectAsync(id);
                var fresh = await _db.Payments.FindAsync(id);
                await _audit.LogAsync(User, AuditAction.UPDATE, "PAYMENT", id.ToString(),
                    before, await PaymentSnapshotAsync(id));
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
                var before = await PaymentSnapshotAsync(id);
                await _payments.DenyRefundAsync(id, dto.Reason);
                var fresh = await _db.Payments.FindAsync(id);
                await _audit.LogAsync(User, AuditAction.UPDATE, "PAYMENT_REFUND", id.ToString(),
                    before, await PaymentSnapshotAsync(id));
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

        /// <summary>
        /// Owner view: the most recent customer payments across all bookings, newest
        /// first, with their booking + customer context for the admin dashboard.
        /// </summary>
        /// <param name="date">
        /// Optional single-day filter on PaymentDateTime. Applied BEFORE Take, so asking
        /// for a day returns that day's payments rather than whichever of them happen to
        /// fall inside the newest `take` rows — filtering the page client-side would
        /// report an empty day for any date older than the most recent 50 payments.
        /// </param>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet("recent")]
        public async Task<IActionResult> Recent([FromQuery] int take = 50, [FromQuery] DateOnly? date = null)
        {
            take = Math.Clamp(take, 1, 200);
            var payments = _db.Payments.AsQueryable();
            if (date is not null)
            {
                var from = date.Value.ToDateTime(TimeOnly.MinValue);
                var to = from.AddDays(1);
                // Half-open range rather than .Date == so the comparison stays sargable
                // and the query can still use an index on PaymentDateTime.
                payments = payments.Where(p => p.PaymentDateTime >= from && p.PaymentDateTime < to);
            }

            var rows = await payments
                .Join(_db.Invoices, p => p.InvoiceId, i => i.Id, (p, i) => new { p, i })
                .Join(_db.Bookings, x => x.i.BookingId, b => b.Id, (x, b) => new { x.p, b })
                .Join(_db.Customers, x => x.b.CustomerId, c => c.Id, (x, c) => new { x.p, x.b, c })
                .OrderByDescending(x => x.p.PaymentDateTime)
                .Take(take)
                .Select(x => new AdminPaymentListItemDto(
                    x.p.Id, x.p.InvoiceId, x.p.AmountPaid, x.p.RefundedAmount,
                    x.p.PaymentDateTime, x.p.Method.ToString(), x.p.Status.ToString(),
                    x.p.TransactionReference, x.p.GatewayProvider, x.p.RefundRequested,
                    x.b.Id, x.b.BookingName,
                    x.b.BookingType.ToString(),
                    x.b.EventType == null ? null : x.b.EventType.ToString(),
                    x.b.EventDate,
                    x.c.Id, x.c.FullName, x.c.Email))
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

        /// <summary>
        /// The fields a payment action actually moves, for audit before/after. Narrow on
        /// purpose — a status flip shouldn't produce a diff full of unchanged columns.
        /// </summary>
        private async Task<object?> PaymentSnapshotAsync(Guid id) =>
            await _db.Payments.AsNoTracking()
                .Where(p => p.Id == id)
                .Select(p => new
                {
                    Status = p.Status.ToString(),
                    p.AmountPaid,
                    p.RefundedAmount,
                    p.RefundRequested,
                    p.RefundRequestDecision,
                })
                .FirstOrDefaultAsync();

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



