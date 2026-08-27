using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// Moderation state. Mirrors the admin dashboard's existing approve/reject flow, and
    /// only Approved rows are ever served publicly.
    /// </summary>
    public enum TestimonialStatus
    {
        Pending,
        Approved,
        Rejected
    }

    /// <summary>
    /// A customer's review of a completed booking.
    ///
    /// Submission is tied to a real Customer AND one of their Completed bookings — that
    /// pairing is the anti-spam control, so the public list can only ever contain people
    /// who were actually served. A customer may review each completed booking once; the
    /// unique index on BookingId enforces that.
    ///
    /// AuthorName is captured at submit time rather than joined on read: the landing page
    /// shows the name the reviewer signed with, and it must not silently change if the
    /// customer later edits their profile.
    /// </summary>
    public class Testimonial
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid CustomerId { get; set; }
        public Customer Customer { get; set; } = null!;

        /// <summary>The completed booking being reviewed. One testimonial per booking.</summary>
        [Required]
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        /// <summary>Display name, captured at submit (defaults to the customer's full name).</summary>
        [Required]
        [MaxLength(120)]
        public string AuthorName { get; set; } = string.Empty;

        /// <summary>1–5 stars (DB check constraint).</summary>
        [Required]
        public int Rating { get; set; }

        [Required]
        [MaxLength(2000)]
        public string Body { get; set; } = string.Empty;

        public TestimonialStatus Status { get; set; } = TestimonialStatus.Pending;

        public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;

        // ---- Moderation ----

        /// <summary>When an admin approved or rejected it; null while Pending.</summary>
        public DateTime? ModeratedAt { get; set; }

        /// <summary>The admin who decided. Null while Pending.</summary>
        public Guid? ModeratedById { get; set; }
        public Admin? ModeratedBy { get; set; }

        /// <summary>Internal note on the decision (never shown publicly).</summary>
        [MaxLength(500)]
        public string? ModerationNote { get; set; }
    }
}

