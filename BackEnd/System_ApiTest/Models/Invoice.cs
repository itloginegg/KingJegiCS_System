using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public enum InvoiceStatus
    {
        Draft,
        Sent,
        Reserved,
        PartiallyPaid,
        Overdue,
        Paid,
        Cancelled
    }

    /// <summary>
    /// One Invoice per Booking. The totals are derived from the Booking's linked
    /// items at generation time and captured here (so they're stable); they should
    /// reconcile with the Booking's frozen total_amount — flag any mismatch rather
    /// than overwriting. Charges lock once the invoice leaves Draft.
    /// </summary>
    public class Invoice
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public DateOnly IssueDate { get; set; }

        /// <summary>Must be on or after IssueDate (DB check constraint).</summary>
        [Required]
        public DateOnly DueDate { get; set; }

        /// <summary>The booking this invoices. Unique — a booking has at most one invoice.</summary>
        [Required]
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        // Captured totals (computed at generation by InvoiceService).
        public decimal FoodTotal { get; set; }
        public decimal RentalTotal { get; set; }
        public decimal ServiceTotal { get; set; }

        /// <summary>(food + rental + service) × tax_rate, from System Settings.</summary>
        public decimal TaxAmount { get; set; }

        /// <summary>food + rental + service + tax.</summary>
        public decimal GrandTotal { get; set; }

        public InvoiceStatus Status { get; set; } = InvoiceStatus.Draft;

        public ICollection<Payment> Payments { get; set; } = new List<Payment>();
    }
}
 