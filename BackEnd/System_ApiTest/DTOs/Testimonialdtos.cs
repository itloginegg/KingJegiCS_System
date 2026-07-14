using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Testimonialdtos
    {
    }

    /// <summary>Anonymous public submission — becomes a Pending testimonial.</summary>
    public class TestimonialCreateDto
    {
        [Required, MaxLength(120)]
        public string CustomerName { get; set; } = string.Empty;

        [MaxLength(120)]
        public string? EventLabel { get; set; }

        [Required, MaxLength(1000)]
        public string Body { get; set; } = string.Empty;

        [Range(1, 5)]
        public int Rating { get; set; } = 5;
    }

    /// <summary>Full shape for the admin moderation view.</summary>
    public record TestimonialResponseDto(
        Guid Id,
        string CustomerName,
        string? EventLabel,
        string Body,
        int Rating,
        string Status,
        DateTime CreatedAt,
        DateTime? ModeratedAt);

    /// <summary>What the anonymous landing page sees — Approved entries only,
    /// with no moderation metadata.</summary>
    public record PublicTestimonialDto(
        Guid Id,
        string Name,
        string? Event,
        string Quote,
        int Rating);
}
