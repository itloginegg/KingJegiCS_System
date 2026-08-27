using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
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

        // ---- Instantaneous events (v4). Unlike everything above, these are NOT
        // discovered by the polling NotificationWorker: a discrete action that happens
        // once at a specific instant can only be recorded by the service method that
        // performs it. Written synchronously from the call site via
        // Notificationwriteservice. Kind is a string column, so no migration. ----

        // Staff-facing
        /// <summary>A customer (or an admin on their behalf) created a booking.</summary>
        BookingCreated,
        /// <summary>A booking was marked completed.</summary>
        BookingCompleted,
        /// <summary>A booking was cancelled — the STAFF copy (BookingCancelled is the customer's).</summary>
        BookingCancelledStaff,
        /// <summary>A customer asked to cancel a confirmed booking; staff must decide.</summary>
        BookingCancellationRequested,
        /// <summary>A payment was recorded against an invoice and awaits verification.</summary>
        PaymentRecorded,
        /// <summary>A customer filed a refund request.</summary>
        RefundRequested,
        /// <summary>A rental, dish, or tray line was added to an existing booking.</summary>
        BookingItemAdded,
        /// <summary>A customer posted a support-chat message.</summary>
        SupportMessageFromCustomer,

        // Customer-facing
        /// <summary>A payment was verified as successful.</summary>
        PaymentConfirmed,
        /// <summary>A refund was issued.</summary>
        RefundApproved,
        /// <summary>A refund request was denied.</summary>
        RefundDenied,
        /// <summary>Staff replied in the support chat.</summary>
        SupportMessageFromStaff,
        /// <summary>An admin posted an announcement. Period is "{announcementId:N}:{customerId:N}".</summary>
        AnnouncementPosted,

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

        /// <summary>
        /// The customer this is addressed to, when that can't be derived from a booking.
        ///
        /// Customer-directed rows were originally always booking-scoped, so the feed
        /// routed them via Booking.CustomerId. Support-chat notifications broke that
        /// assumption — a chat message belongs to a customer but to no booking — so this
        /// carries the recipient directly. Null on staff-directed rows and on the
        /// booking-scoped rows the worker writes, which still route through the booking.
        /// </summary>
        public Guid? CustomerId { get; set; }
        public Customer? Customer { get; set; }

        [Required]
        public NotificationKind Kind { get; set; }

        /// <summary>Per-Kind dedup discriminator (see the class summary). Never null; "" when not applicable.</summary>
        [Required]
        [MaxLength(100)]
        public string Period { get; set; } = string.Empty;

        public DateTime SentAt { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// When this notification was marked read in the in-app feed; null while unread.
        ///
        /// Read state is per-ROW, not per-viewer. That's exact for customer-directed rows
        /// (a booking has one customer), and deliberate for owner-directed rows (the
        /// digest and low-stock alerts): the Owner and an Assistant share one inbox, so
        /// either dismissing an alert clears it for both.
        /// </summary>
        public DateTime? ReadAt { get; set; }
    }
}

