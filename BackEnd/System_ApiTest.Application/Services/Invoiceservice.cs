using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.DTOs;

namespace System_ApiTest.Application.Services
{
    public class Invoiceservice
    {
        private readonly IApplicationDbContext _db;
        private readonly Systemsettingsservice _settings;

        public Invoiceservice(IApplicationDbContext db, Systemsettingsservice settings)
        {
            _db = db;
            _settings = settings;
        }
        /// <summary>
        /// Generates the single Invoice for a Booking. Computes food/rental/service
        /// totals from the booking's linked items, applies tax_rate from System
        /// Settings, and stores the captured totals. Refuses a second invoice for the
        /// same booking, and flags (rather than silently overwriting) any mismatch with
        /// the booking's frozen total_amount.
        /// </summary>
        public async Task<Invoice> GenerateAsync(Guid bookingId, DateOnly issueDate, DateOnly dueDate)
        {
            if (dueDate < issueDate)
                throw new BookingRuleException("Due date must be on or after the issue date.");

            if (await _db.Invoices.AnyAsync(i => i.BookingId == bookingId))
                throw new BookingRuleException("This booking already has an invoice.");

            var booking = await _db.Bookings
                .Include(b => b.MenuPackage)
                .Include(b => b.MenuItems)
                .Include(b => b.MenuTrays)
                .Include(b => b.Rentals).ThenInclude(r => r.RentalItem)
                .Include(b => b.Services).ThenInclude(s => s.ServiceItem)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            // Option A: the invoice is issued at submit time (Pending), so the customer
            // can pay the reservation fee that auto-confirms the booking. Only a Draft
            // (not yet submitted) booking is too early to invoice.
            if (booking.Status == BookingStatus.Draft)
                throw new BookingRuleException(
                    "An invoice can only be generated once the booking is submitted.");

            var (food, rental, service) = ComputeSubtotals(booking);
            var subtotal = food + rental + service;

            // Reconcile against the booking's frozen total (frozen at submit; excludes tax).
            if (booking.Status != BookingStatus.Draft && booking.TotalAmount != subtotal)
            {
                throw new BookingRuleException(
                    $"Invoice subtotal ({subtotal:0.00}) does not match the booking's frozen total " +
                    $"({booking.TotalAmount:0.00}). Investigate before issuing — totals are not overwritten silently.");
            }

            var settings = await _settings.GetAsync();
            // Zero under the current settings — VAT was removed by setting the rate to 0
            // rather than by deleting this line, so that the budget planner (which does
            // the same multiplication) can never disagree with the invoice. See
            // Systemsettings.TaxRate.
            var tax = subtotal * settings.TaxRate;

            var invoice = new Invoice
            {
                BookingId = bookingId,
                IssueDate = issueDate,
                DueDate = dueDate,
                FoodTotal = food,
                RentalTotal = rental,
                ServiceTotal = service,
                TaxAmount = tax,
                GrandTotal = subtotal + tax,
                Status = InvoiceStatus.Draft
            };

            _db.Invoices.Add(invoice);
            await _db.SaveChangesAsync();
            return invoice;
        }

        private static (decimal food, decimal rental, decimal service) ComputeSubtotals(Booking b)
        {
            decimal food = (b.MenuPackage?.ComputeCost(b.GuestCount ?? 0) ?? 0m)
                           + b.MenuItems.Sum(i => i.LineTotal)
                           + b.MenuTrays.Sum(t => t.LineTotal);
            decimal rental = b.Rentals.Sum(r => r.Subtotal);
            decimal service = b.Services.Sum(s => s.TotalCost);
            return (food, rental, service);
        }

        /// <summary>Sum of SUCCESS payments only (Refunded/Pending/Failed excluded).</summary>
        /// <summary>
        /// Verified money currently held: successful payments NET of refunds.
        /// (A fully refunded payment contributes 0; a partial refund contributes the
        /// remainder.) Every status ladder and milestone derives from this number.
        /// </summary>
        public async Task<decimal> GetPaidTotalAsync(Guid invoiceId)
            => await _db.Payments
                .Where(p => p.InvoiceId == invoiceId &&
                            (p.Status == PaymentStatus.Success ||
                             p.Status == PaymentStatus.PartiallyRefunded ||
                             p.Status == PaymentStatus.Refunded))
                .SumAsync(p => (decimal?)(p.AmountPaid - p.RefundedAmount)) ?? 0m;

        /// <summary>
        /// Re-derives the invoice status from the current successful-payment total and
        /// the payment-plan milestones. Fully recomputed each call, so it also
        /// downgrades correctly after a refund. Never touches a Cancelled invoice.
        /// Ladder (mirrors the booking's deposit status):
        ///   - Paid          when successful payments >= grand total
        ///   - Overdue       when ANY milestone deadline has passed unpaid
        ///   - PartiallyPaid when paid beyond the reservation fee but not in full
        ///   - Reserved      when exactly the reservation fee is covered (full service)
        ///   - Draft/Sent    when below the fee (Sent preserved)
        /// </summary>
        public async Task RefreshStatusAsync(Guid invoiceId, DateOnly today)
        {
            var invoice = await _db.Invoices.FindAsync(invoiceId)
                ?? throw new BookingRuleException("Invoice not found.");

            if (invoice.Status == InvoiceStatus.Cancelled)
                return;

            var booking = await _db.Bookings.FindAsync(invoice.BookingId)
                ?? throw new BookingRuleException("Booking not found.");

            var settings = await _settings.GetAsync();
            var paid = await GetPaidTotalAsync(invoiceId);
            var milestones = await BuildMilestonePlanAsync(invoice, booking);
            var anyLate = milestones.Any(m => m.IsDeadline && today > m.Due && paid < m.Cumulative);

            var isDelivery = booking.BookingType == BookingType.FoodDelivery;
            var fee = BookingMath.ReservationFeeFor(booking.BookingType, invoice.GrandTotal, settings.ReservationFee);

            invoice.Status =
                paid >= invoice.GrandTotal ? InvoiceStatus.Paid
                : anyLate ? InvoiceStatus.Overdue
                : !isDelivery && paid > fee ? InvoiceStatus.PartiallyPaid
                : !isDelivery && paid >= fee && fee > 0m ? InvoiceStatus.Reserved
                : isDelivery && paid > 0m ? InvoiceStatus.PartiallyPaid
                : invoice.Status == InvoiceStatus.Sent ? InvoiceStatus.Sent
                : InvoiceStatus.Draft;

            await _db.SaveChangesAsync();
        }

        /// <summary>Marks a Draft invoice as Sent (issued/shown to the customer). One-way.</summary>
        public async Task MarkSentAsync(Guid invoiceId)
        {
            var invoice = await _db.Invoices.FindAsync(invoiceId)
                ?? throw new BookingRuleException("Invoice not found.");
            if (invoice.Status != InvoiceStatus.Draft)
                throw new BookingRuleException($"Only a Draft invoice can be marked Sent; this one is {invoice.Status}.");
            invoice.Status = InvoiceStatus.Sent;
            await _db.SaveChangesAsync();
        }

        /// <summary>Charges lock once the invoice leaves Draft. Call before editing any line/total.</summary>
        public async Task EnsureChargesEditableAsync(Guid invoiceId)
        {
            var invoice = await _db.Invoices.FindAsync(invoiceId)
                ?? throw new BookingRuleException("Invoice not found.");
            if (invoice.Status != InvoiceStatus.Draft)
                throw new BookingRuleException($"A {invoice.Status} invoice's charges are locked and cannot be edited.");
        }

        /// <summary>
        /// One milestone of the payment plan: a cumulative target by a date.
        /// IsDeadline = false for the reservation fee — it's first-come-first-served
        /// (the pressure is losing the date), so it never drives Overdue.
        /// </summary>
        private readonly record struct MilestonePlanItem(
            string Label, DateOnly Due, decimal PrevCumulative, decimal Cumulative, bool IsDeadline);

        /// <summary>
        /// The single source of truth for the payment plan. Full service: reservation
        /// fee at issue ? deposit_percentage of the total one week before the event ?
        /// balance on the event day. Delivery: everything by the delivery date.
        /// Used by BOTH the schedule endpoint and the invoice status refresh, so
        /// "late" means the same thing everywhere.
        /// </summary>
        private async Task<List<MilestonePlanItem>> BuildMilestonePlanAsync(Invoice invoice, Booking booking)
        {
            var settings = await _settings.GetAsync();
            var grand = invoice.GrandTotal;

            // Deliveries settle in one payment on the day. Rentals follow the full-service
            // milestone plan (deposit ? mid-payment ? balance), just with the percentage
            // reservation fee below.
            if (booking.BookingType == BookingType.FoodDelivery)
                return new List<MilestonePlanItem>
            {
                new("Balance due (delivery)", booking.EventDate, 0m, grand, IsDeadline: true)
            };

            var down = BookingMath.ReservationFeeFor(booking.BookingType, grand, settings.ReservationFee);
            var mid = Math.Max(down, Math.Round(grand * settings.DepositPercentage, 2));

            return new List<MilestonePlanItem>
        {
            // Not a deadline: unpaid means the date simply isn't secured yet.
            new("Down payment (reservation)", invoice.IssueDate, 0m, down, IsDeadline: false),
            new($"Second payment ({settings.DepositPercentage:P0}, 1 week prior)", booking.EventDate.AddDays(-7), down, mid, IsDeadline: true),
            new("Final balance (event day)", booking.EventDate, mid, grand, IsDeadline: true)
        };
        }

        /// <summary>
        /// Derives the payment plan for a booking against its invoice grand total.
        /// Milestones are cumulative targets; each is Paid / Overdue / Upcoming based on
        /// verified payments and today. This is monitoring — it does not block payments.
        /// </summary>
        public async Task<PaymentScheduleDto> GetPaymentScheduleAsync(Guid bookingId, DateOnly today)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");
            if (booking.Status == BookingStatus.Cancelled)
                throw new BookingRuleException("This booking is cancelled; it has no payment schedule.");
            var invoice = await _db.Invoices.FirstOrDefaultAsync(i => i.BookingId == bookingId)
                ?? throw new BookingRuleException("This booking has no invoice yet; submit it first.");

            var paid = await GetPaidTotalAsync(invoice.Id);
            var plan = await BuildMilestonePlanAsync(invoice, booking);

            var milestones = plan.Select(m =>
            {
                var status = paid >= m.Cumulative ? "Paid"
                           : m.IsDeadline && today > m.Due ? "Overdue"
                           : "Upcoming";
                return new PaymentMilestoneDto(m.Label, m.Due, m.Cumulative - m.PrevCumulative, m.Cumulative, paid, status);
            }).ToList();

            return new PaymentScheduleDto(bookingId, invoice.GrandTotal, paid, invoice.GrandTotal - paid, milestones);
        }
    }
}




