using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    public class Bookinghistory
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        /// <summary>
        /// The Admin who made the change, or NULL for customer/system actions
        /// (submit, reservation auto-confirm). The ChangeReason says which.
        /// </summary>
        public Guid? ChangedById { get; set; }
        public Admin? ChangedBy { get; set; }

        /// <summary>
        /// Short human-readable label for what happened, e.g. "Edited", "Submitted",
        /// "Confirmed", "Auto-confirmed on reservation payment", "Cancelled", "Completed".
        /// </summary>
        [MaxLength(200)]
        public string? ChangeReason { get; set; }

        /// <summary>
        /// Starts at 1 for the first history row on a Booking and increments by 1 for
        /// each subsequent one. Assigned by the backend (see BookingService), unique
        /// per Booking.
        /// </summary>
        [Required]
        public int RevisionNumber { get; set; }

        /// <summary>
        /// Full JSON snapshot of the Booking's fields as they were BEFORE this edit.
        /// </summary>
        [Required]
        public string SnapshotJson { get; set; } = string.Empty;

        /// <summary>Recorded automatically when the backend writes the row. Never set manually.</summary>
        public DateTime SnapshotAt { get; set; } = DateTime.UtcNow;
    }
}
