using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>
    /// The distinct notifications the background worker can emit. Stored as a string
    /// (see AppDbContext) so the column is human-readable, like every other enum here.
    /// </summary>
    public enum NotificationKind
    {
        /// <summary>A payment milestone deadline is approaching — reminder to the customer.</summary>
        PaymentDueSoon,
        /// <summary>A payment milestone deadline has passed unpaid — reminder to the customer.</summary>
        PaymentOverdue,
        /// <summary>One daily digest to the owner summarizing all overdue milestones.</summary>
        PaymentOverdueDigest,
        /// <summary>The booking was confirmed — confirmation to the customer.</summary>
        BookingConfirmed,
        /// <summary>The booking was cancelled — notice to the customer.</summary>
        BookingCancelled,
        /// <summary>A rental item's available stock hit the low threshold — alert to the owner.</summary>
        RentalLowStock,

        // ---- Proactive-assistant seeds (Slice D). Deduped independently of the flat
        // emails above so enabling ProactiveAssistant later still seeds once. Kind is a
        // string column, so adding these values needs no migration. ----

        /// <summary>Seeded an assistant conversation for an upcoming payment milestone.</summary>
        PaymentDueSoonNudge,
        /// <summary>Seeded an assistant conversation for an overdue payment milestone.</summary>
        PaymentOverdueNudge,
        /// <summary>Seeded an assistant conversation when the booking was confirmed.</summary>
        BookingConfirmedNudge,
        /// <summary>Seeded an assistant conversation when the booking was cancelled.</summary>
        BookingCancelledNudge
    }

    /// <summary>
    /// Idempotency ledger for the NotificationWorker: one row per notification actually
    /// sent, so a reminder is never sent twice for the same thing. The dedup key is the
    /// (BookingId, Kind, Period) tuple, made unique in the DB.
    ///
    /// Period is a per-Kind discriminator that scopes "the same thing":
    ///   PaymentDueSoon / PaymentOverdue → the milestone due date (yyyy-MM-dd)
    ///   BookingConfirmed / BookingCancelled → "" (a booking is confirmed/cancelled once)
    ///   PaymentOverdueDigest → today (yyyy-MM-dd), so the owner gets at most one a day
    ///   RentalLowStock → "{rentalItemId}:{yyyy-MM-dd}", one alert per item per day
    ///
    /// BookingId is null for notifications that aren't tied to a single booking (the
    /// owner digest and low-stock alerts).
    /// </summary>
    public class Sentnotification
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>The booking this concerns, or null for cross-booking owner notifications.</summary>
        public Guid? BookingId { get; set; }
        public Booking? Booking { get; set; }

        [Required]
        public NotificationKind Kind { get; set; }

        /// <summary>Per-Kind dedup discriminator (see the class summary). Never null; "" when not applicable.</summary>
        [Required]
        [MaxLength(100)]
        public string Period { get; set; } = string.Empty;

        public DateTime SentAt { get; set; } = DateTime.UtcNow;
    }
}
