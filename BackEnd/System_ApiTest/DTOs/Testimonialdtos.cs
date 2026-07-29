using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Testimonialdtos
    {
    }

    /// <summary>A customer submitting a review of one of their completed bookings.</summary>
    public class TestimonialCreateDto
    {
        [Required]
        public Guid BookingId { get; set; }

        [Required]
        [Range(1, 5)]
        public int Rating { get; set; }

        [Required]
        [MaxLength(2000)]
        public string Body { get; set; } = string.Empty;

        /// <summary>Optional display name; falls back to the customer's own full name.</summary>
        [MaxLength(120)]
        public string? AuthorName { get; set; }
    }

    /// <summary>Approve or reject a pending testimonial.</summary>
    public class TestimonialModerateDto
    {
        /// <summary>"Approved" or "Rejected".</summary>
        [Required]
        public string Status { get; set; } = string.Empty;

        [MaxLength(500)]
        public string? Note { get; set; }
    }

    /// <summary>
    /// The public shape: only what the landing page renders. No ids that would let a
    /// reader tie a review back to a customer account or a booking.
    /// </summary>
    public record PublicTestimonialDto(
        Guid Id,
        string AuthorName,
        int Rating,
        string Body,
        DateTime SubmittedAt);

    /// <summary>The moderation shape — everything the admin queue needs.</summary>
    public record TestimonialResponseDto(
        Guid Id,
        Guid CustomerId,
        string AuthorName,
        string CustomerEmail,
        Guid BookingId,
        string BookingName,
        DateOnly EventDate,
        int Rating,
        string Body,
        string Status,
        DateTime SubmittedAt,
        DateTime? ModeratedAt,
        Guid? ModeratedById,
        string? ModerationNote);
}
