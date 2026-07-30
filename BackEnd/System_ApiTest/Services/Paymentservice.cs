using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using System_ApiTest.Data;
using System_ApiTest.Models;
using System_ApiTest.Hubs;

namespace System_ApiTest.Services
{
    public class Paymentservice
    {
        private readonly AppDbContext _db;
        private readonly Invoiceservice _invoices;
        private readonly Systemsettingsservice _settings;
        private readonly Bookingservice _bookings;
        private readonly PayMongoservice _payMongo;
        private readonly IHubContext<PaymentHub> _hubContext;
        private readonly Notificationwriteservice _notifications;

        public Paymentservice(AppDbContext db, Invoiceservice invoices,
                              Systemsettingsservice settings, Bookingservice bookings,
                              PayMongoservice payMongo, IHubContext<PaymentHub> hubContext,
                              Notificationwriteservice notifications)
        {
            _notifications = notifications;
            _db = db;
            _invoices = invoices;
            _settings = settings;
            _bookings = bookings;
            _payMongo = payMongo;
            _hubContext = hubContext;
        }

        /// <summary>
        /// Resolves the booking and customer a payment belongs to, so a notification can
        /// be routed to both audiences. Returns nulls if the chain is broken, in which
        /// case the caller simply skips the notification.
        /// </summary>
        private async Task<(Guid? BookingId, Guid? CustomerId)> ResolveRecipientsAsync(Guid invoiceId)
        {
            var row = await _db.Invoices
                .Where(i => i.Id == invoiceId)
                .Select(i => new { i.BookingId, i.Booking.CustomerId })
                .FirstOrDefaultAsync();
            return row is null ? (null, null) : (row.BookingId, row.CustomerId);
        }

        /// <summary>
        /// Records a payment (starts as Pending). Validates amount, a non-cancelled
        /// invoice, and a unique transaction reference. Does not yet count toward the
        /// paid total — only Success payments do (see MarkSuccessAsync).
        /// </summary>
        /// <summary>
        /// The guards every new payment must pass, shared by manual recording and
        /// online checkout: positive amount, live (non-cancelled) invoice, the
        /// booking's date still winnable, and the amount within the remaining
        /// balance (verified money only). Returns the invoice for further use.
        /// </summary>
        private async Task<Invoice> ValidatePayableAsync(Guid invoiceId, decimal amount)
        {
            if (amount <= 0m)
                throw new BookingRuleException("Amount paid must be greater than zero.");

            var invoice = await _db.Invoices.FindAsync(invoiceId)
                ?? throw new BookingRuleException("Invoice not found.");
            if (invoice.Status == InvoiceStatus.Cancelled)
                throw new BookingRuleException("Cannot record a payment against a cancelled invoice.");

            // Fail fast if the booking's date/time has been taken since submit — the
            // customer shouldn't send money toward a slot they can no longer win.
            // (The authoritative, locked check still runs at confirm.)
            await _bookings.EnsureDateStillAvailableAsync(invoice.BookingId);

            // Don't allow a payment that could never be confirmed: the amount must
            // fit within the remaining balance (verified money only — other Pending
            // payments don't reserve room).
            var confirmedPaid = await _invoices.GetPaidTotalAsync(invoiceId);
            var remaining = invoice.GrandTotal - confirmedPaid;
            if (amount > remaining)
                throw new BookingRuleException(
                    $"Amount ({amount:0.00}) exceeds the remaining balance ({remaining:0.00}). " +
                    "Record at most the remaining balance.");

            return invoice;
        }

        public async Task<Payment> RecordAsync(
            Guid invoiceId, decimal amount, PaymentMethod method,
            DateTime? paidAt, string? transactionReference)
        {
            await ValidatePayableAsync(invoiceId, amount);

            if (transactionReference is not null &&
                await _db.Payments.AnyAsync(p => p.TransactionReference == transactionReference))
                throw new BookingRuleException("A payment with this transaction reference already exists.");

            var payment = new Payment
            {
                InvoiceId = invoiceId,
                AmountPaid = amount,
                Method = method,
                // Server time is authoritative; a caller-supplied time is only for back-recording.
                PaymentDateTime = paidAt ?? DateTime.Now,
                TransactionReference = transactionReference,
                Status = PaymentStatus.Pending
            };

            _db.Payments.Add(payment);
            await _db.SaveChangesAsync();

            // Staff-facing: a payment has been recorded and is waiting to be verified.
            // Keyed on the payment id, so each payment notifies exactly once.
            var (bookingId, _) = await ResolveRecipientsAsync(invoiceId);
            await _notifications.WriteAsync(
                NotificationKind.PaymentRecorded, bookingId, period: payment.Id.ToString("N"));

            return payment;
        }

        /// <summary>
        /// Starts an ONLINE payment: runs the same guards as manual recording, opens
        /// a PayMongo checkout session, and saves a Pending payment carrying the
        /// session id (the webhook confirms it in Slice 4; until then the owner can
        /// still verify manually). The payment's own id is the gateway reference, so
        /// the two systems point at each other. Nothing is saved if the gateway
        /// call fails — no orphan rows.
        /// </summary>
        public async Task<(Payment Payment, string CheckoutUrl)> StartCheckoutAsync(
            Guid invoiceId, decimal amount)
        {
            var invoice = await ValidatePayableAsync(invoiceId, amount);

            var bookingName = await _db.Bookings
                .Where(b => b.Id == invoice.BookingId)
                .Select(b => b.BookingName)
                .FirstAsync();

            var payment = new Payment
            {
                InvoiceId = invoiceId,
                AmountPaid = amount,
                Method = PaymentMethod.Online,
                PaymentDateTime = DateTime.Now,   // initiated-at; the webhook re-stamps on success
                Status = PaymentStatus.Pending,
                GatewayProvider = "PayMongo"
            };

            // Gateway first, save second: if PayMongo rejects, nothing persists.
            var session = await _payMongo.CreateCheckoutSessionAsync(
                amount, $"KingJegi — {bookingName}", payment.Id.ToString());

            payment.GatewaySessionId = session.SessionId;
            _db.Payments.Add(payment);
            await _db.SaveChangesAsync();

            return (payment, session.CheckoutUrl);
        }

        /// <summary>
        /// Confirms a payment as Success. Guards against overpayment (successful total
        /// must not exceed the grand total), then re-syncs the invoice status and the
        /// booking's deposit_status.
        /// </summary>
        public async Task MarkSuccessAsync(Guid paymentId, DateOnly today)
        {
            var payment = await _db.Payments
                .Include(p => p.Invoice)
                .FirstOrDefaultAsync(p => p.Id == paymentId)
                ?? throw new BookingRuleException("Payment not found.");

            if (payment.Status == PaymentStatus.Success)
                return;

            await using var tx = await _db.Database.BeginTransactionAsync();

            var alreadyPaid = await _invoices.GetPaidTotalAsync(payment.InvoiceId);
            if (alreadyPaid + payment.AmountPaid > payment.Invoice.GrandTotal)
                throw new BookingRuleException(
                    $"Overpayment: successful payments would total {alreadyPaid + payment.AmountPaid:0.00}, " +
                    $"exceeding the grand total of {payment.Invoice.GrandTotal:0.00}. " +
                    $"Remaining balance is {payment.Invoice.GrandTotal - alreadyPaid:0.00} — reject this payment " +
                    "and have the correct amount recorded.");

            payment.Status = PaymentStatus.Success;
            await _db.SaveChangesAsync();

            // Reservation auto-confirm: once verified payments reach the reservation fee,
            // a Pending full-service booking is confirmed (first-come wins the slot). If
            // the slot is already taken, TryAutoConfirm throws and this whole payment
            // confirmation rolls back — the deposit isn't accepted for an unavailable slot.
            var settings = await _settings.GetAsync();
            var paidNow = alreadyPaid + payment.AmountPaid;
            if (paidNow >= settings.ReservationFee)
                await _bookings.TryAutoConfirmOnReservationAsync(payment.Invoice.BookingId);

            await SyncInvoiceAndDepositAsync(payment.InvoiceId, today);
            await tx.CommitAsync();

            // Customer-facing, after the commit: their money is verified. This is the
            // moment the polling worker could never observe.
            var (bookingId, customerId) = await ResolveRecipientsAsync(payment.InvoiceId);
            await _notifications.WriteAsync(
                NotificationKind.PaymentConfirmed, bookingId, customerId, payment.Id.ToString("N"));
        }

        /// <summary>
        /// Refunds a previously successful payment by flipping it to Refunded (the
        /// record is preserved for audit), then re-syncs invoice status and deposit.
        /// </summary>
        /// <summary>
        /// Refunds an amount from a payment (owner action). Amount omitted = the full
        /// remaining refundable balance. Partial refunds are supported: the payment
        /// becomes PartiallyRefunded until fully refunded. Fulfilling a refund clears
        /// any open request on the payment. Eligibility (e.g. the non-refundable
        /// reservation fee) is owner judgment — the system enforces only the math.
        /// </summary>
        public async Task RefundAsync(Guid paymentId, decimal? amount, DateOnly today)
        {
            var payment = await _db.Payments.FindAsync(paymentId)
                ?? throw new BookingRuleException("Payment not found.");

            if (payment.Status is not (PaymentStatus.Success or PaymentStatus.PartiallyRefunded))
                throw new BookingRuleException("Only a successful payment can be refunded.");

            var remaining = payment.AmountPaid - payment.RefundedAmount;
            var toRefund = amount ?? remaining;
            if (toRefund <= 0m)
                throw new BookingRuleException("Refund amount must be greater than zero.");
            if (toRefund > remaining)
                throw new BookingRuleException(
                    $"Refund amount ({toRefund:0.00}) exceeds the refundable balance ({remaining:0.00}).");

            await using var tx = await _db.Database.BeginTransactionAsync();

            payment.RefundedAmount += toRefund;
            payment.Status = payment.RefundedAmount >= payment.AmountPaid
                ? PaymentStatus.Refunded
                : PaymentStatus.PartiallyRefunded;

            // The refund answers any open request.
            payment.RefundRequested = false;
            payment.RefundRequestDecision = null;

            await _db.SaveChangesAsync();

            await SyncInvoiceAndDepositAsync(payment.InvoiceId, today);
            await tx.CommitAsync();

            // A payment can be refunded more than once (partial refunds), so each
            // refund is its own occurrence rather than a once-per-payment event.
            var (bookingId, customerId) = await ResolveRecipientsAsync(payment.InvoiceId);
            await _notifications.WriteAsync(
                NotificationKind.RefundApproved, bookingId, customerId,
                Notificationwriteservice.Occurrence(payment.Id));
        }

        /// <summary>
        /// Customer files a refund request on their payment. Amount omitted = the full
        /// remaining refundable balance at request time. Multiple payments may have
        /// open requests independently; one open request per payment.
        /// </summary>
        public async Task RequestRefundAsync(Guid paymentId, decimal? amount, string? reason)
        {
            var payment = await _db.Payments.FindAsync(paymentId)
                ?? throw new BookingRuleException("Payment not found.");

            if (payment.Status is not (PaymentStatus.Success or PaymentStatus.PartiallyRefunded))
                throw new BookingRuleException("Only a verified payment can request a refund.");
            if (payment.RefundRequested)
                throw new BookingRuleException("A refund request is already open on this payment.");

            var remaining = payment.AmountPaid - payment.RefundedAmount;
            if (remaining <= 0m)
                throw new BookingRuleException("This payment has already been fully refunded.");

            var requested = amount ?? remaining;
            if (requested <= 0m || requested > remaining)
                throw new BookingRuleException(
                    $"Requested amount must be between 0 and the refundable balance ({remaining:0.00}).");

            payment.RefundRequested = true;
            payment.RefundRequestedAmount = requested;
            payment.RefundRequestReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
            payment.RefundRequestedAt = DateTime.Now;
            payment.RefundRequestDecision = null;
            await _db.SaveChangesAsync();

            // Staff-facing: someone is waiting on a decision. A denied request can be
            // re-filed later, so this is an occurrence rather than a once-only event.
            var (bookingId, _) = await ResolveRecipientsAsync(payment.InvoiceId);
            await _notifications.WriteAsync(
                NotificationKind.RefundRequested, bookingId,
                period: Notificationwriteservice.Occurrence(payment.Id));
        }

        /// <summary>
        /// Applies a gateway "paid" event. Finds the Pending payment by checkout
        /// session id, stamps the gateway payment id + actual paid time, and runs the
        /// normal MarkSuccess pipeline (overpayment guard, auto-confirm with the
        /// time-slot lock, ladders). IDEMPOTENT: webhook retries and already-Success
        /// payments no-op. If confirmation is impossible (e.g. the slot was taken in
        /// the race window), the payment stays Pending with the gateway status noting
        /// money was captured — the owner resolves it (move the date or refund).
        /// Returns a short outcome string for logging.
        /// </summary>
        public async Task<string> ApplyGatewayPaidAsync(string sessionId, string? gatewayPaymentId, DateOnly today)
        {
            var payment = await _db.Payments
                .FirstOrDefaultAsync(p => p.GatewaySessionId == sessionId);
            if (payment is null)
                return "ignored: no payment with that session id";
            if (payment.Status == PaymentStatus.Success)
                return "already applied (retry no-op)";
            if (payment.Status != PaymentStatus.Pending)
                return $"ignored: payment is {payment.Status}";

            payment.GatewayPaymentId = gatewayPaymentId ?? payment.GatewayPaymentId;
            payment.GatewayStatusRaw = "paid";
            payment.PaymentDateTime = DateTime.Now;   // when the money actually moved
            await _db.SaveChangesAsync();

            try
            {
                await MarkSuccessAsync(payment.Id, today);
                await _hubContext.Clients.All.SendAsync("PaymentUpdated", payment.InvoiceId);
                return "confirmed";
            }
            catch (BookingRuleException ex)
            {
                // Money was captured by the gateway but our rules block confirmation
                // (slot lost in the race window, etc.). Keep it Pending and flag it
                // loudly for the owner instead of silently dropping paid money.
                payment.GatewayStatusRaw = $"paid — NEEDS ATTENTION: {ex.Message}";
                await _db.SaveChangesAsync();
                await _hubContext.Clients.All.SendAsync("PaymentUpdated", payment.InvoiceId);
                return $"paid but not confirmable: {ex.Message}";
            }
        }

        /// <summary>Applies a gateway "failed" event: a Pending gateway payment becomes Failed.</summary>
        public async Task<string> ApplyGatewayFailedAsync(string resourceId, string? rawStatus)
        {
            var payment = await _db.Payments.FirstOrDefaultAsync(p =>
                p.GatewaySessionId == resourceId || p.GatewayPaymentId == resourceId);
            if (payment is null)
                return "ignored: no matching payment";
            if (payment.Status != PaymentStatus.Pending)
                return $"ignored: payment is {payment.Status}";

            payment.Status = PaymentStatus.Failed;
            payment.GatewayStatusRaw = rawStatus ?? "failed";
            await _db.SaveChangesAsync();
            await _hubContext.Clients.All.SendAsync("PaymentUpdated", payment.InvoiceId);
            return "marked failed";
        }

        /// <summary>
        /// Owner rejects a Pending payment (never arrived, wrong amount, duplicate).
        /// Pending -> Failed; a Failed payment never counts toward any total. This is
        /// the exit for payments that could otherwise sit Pending forever.
        /// </summary>
        public async Task RejectAsync(Guid paymentId)
        {
            var payment = await _db.Payments.FindAsync(paymentId)
                ?? throw new BookingRuleException("Payment not found.");
            if (payment.Status != PaymentStatus.Pending)
                throw new BookingRuleException($"Only a Pending payment can be rejected; this one is {payment.Status}.");

            payment.Status = PaymentStatus.Failed;
            await _db.SaveChangesAsync();
        }

        /// <summary>Owner denies an open refund request, recording the reason for the customer.</summary>
        public async Task DenyRefundAsync(Guid paymentId, string decisionReason)
        {
            var payment = await _db.Payments.FindAsync(paymentId)
                ?? throw new BookingRuleException("Payment not found.");
            if (!payment.RefundRequested)
                throw new BookingRuleException("There is no open refund request on this payment.");
            if (string.IsNullOrWhiteSpace(decisionReason))
                throw new BookingRuleException("A denial reason is required so the customer knows why.");

            payment.RefundRequested = false;
            payment.RefundRequestDecision = decisionReason.Trim();
            await _db.SaveChangesAsync();

            var (bookingId, customerId) = await ResolveRecipientsAsync(payment.InvoiceId);
            await _notifications.WriteAsync(
                NotificationKind.RefundDenied, bookingId, customerId,
                Notificationwriteservice.Occurrence(payment.Id));
        }

        /// <summary>
        /// After any change to successful payments: refresh the invoice status and
        /// re-derive the booking's deposit_status against the RESERVATION FEE (the
        /// ₱ amount that locks the date) — so Confirmed ⇔ deposit Paid reads
        /// consistently. The 50% milestone is tracked by the payment schedule.
        /// </summary>
        private async Task SyncInvoiceAndDepositAsync(Guid invoiceId, DateOnly today)
        {
            await _invoices.RefreshStatusAsync(invoiceId, today);

            var invoice = await _db.Invoices.FindAsync(invoiceId)
                ?? throw new BookingRuleException("Invoice not found.");
            var settings = await _settings.GetAsync();
            var paid = await _invoices.GetPaidTotalAsync(invoiceId);
            var fee = Math.Min(settings.ReservationFee, invoice.GrandTotal);

            await _bookings.RecomputeDepositStatusAsync(invoice.BookingId, paid, fee, invoice.GrandTotal);
        }
    }
}