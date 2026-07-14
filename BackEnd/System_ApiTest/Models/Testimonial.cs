using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>Moderation state. New submissions start as Pending and only
    /// Approved ones are ever shown on the public landing page.</summary>
    public enum TestimonialStatus
    {
        Pending,
        Approved,
        Rejected
    }

    /// <summary>
    /// A customer testimonial shown on the landing page. Submitted anonymously
    /// (no account required), then moderated by the Owner/Assistant before it
    /// becomes publicly visible.
    /// </summary>
    public class Testimonial
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>Display name of the person quoted (e.g. "Maria Santos").</summary>
        [Required]
        [MaxLength(120)]
        public string CustomerName { get; set; } = string.Empty;

        /// <summary>Optional context line shown under the name, e.g. "Wedding — Dec 2025".</summary>
        [MaxLength(120)]
        public string? EventLabel { get; set; }

        /// <summary>The quote itself.</summary>
        [Required]
        [MaxLength(1000)]
        public string Body { get; set; } = string.Empty;

        /// <summary>Star rating 1–5. Enforced by a DB check constraint too.</summary>
        [Range(1, 5)]
        public int Rating { get; set; } = 5;

        public TestimonialStatus Status { get; set; } = TestimonialStatus.Pending;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>When an admin approved or rejected it. Null while Pending.</summary>
        public DateTime? ModeratedAt { get; set; }
    }
}
