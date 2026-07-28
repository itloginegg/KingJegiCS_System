using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    /// <summary>One message in a support thread (Sender is "Customer" or "Admin").</summary>
    public record SupportMessageDto(Guid Id, string Sender, string Text, DateTime CreatedAt);

    /// <summary>A support thread with its messages — the customer's view and the admin's open-thread view.</summary>
    public record SupportThreadDto(
        Guid Id,
        Guid CustomerId,
        string CustomerName,
        string Status,
        DateTime LastMessageAt,
        IReadOnlyList<SupportMessageDto> Messages);

    /// <summary>A thread in the admin list: last activity, a preview, and how many customer messages are unread.</summary>
    public record SupportThreadSummaryDto(
        Guid Id,
        Guid CustomerId,
        string CustomerName,
        string CustomerEmail,
        string Status,
        DateTime LastMessageAt,
        string? LastMessagePreview,
        int UnreadFromCustomer);

    /// <summary>Body for posting a support message.</summary>
    public class SupportSendDto
    {
        [Required]
        [MaxLength(4000, ErrorMessage = "Message is too long.")]
        public string Text { get; set; } = string.Empty;
    }
}
