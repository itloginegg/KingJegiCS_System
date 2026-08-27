using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    /// <summary>
    /// One message in a support thread (Sender is "Customer" or "Admin"). The attachment
    /// fields are all null on a text-only message; Text is empty on an attachment-only one.
    /// </summary>
    public record SupportMessageDto(
        Guid Id,
        string Sender,
        string Text,
        DateTime CreatedAt,
        string? AttachmentUrl,
        string? AttachmentFileName,
        string? AttachmentContentType,
        bool AttachmentIsImage);

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

    /// <summary>
    /// Body for posting a support message. Bound with [FromForm] so an attachment can
    /// ride along as multipart — the same shape MenuItemCreateDto/RentalItemCreateDto
    /// already use for their optional IFormFile.
    ///
    /// Text is no longer [Required]: an attachment-only message is valid. The controller
    /// rejects the case where BOTH are empty.
    /// </summary>
    public class SupportSendDto
    {
        [MaxLength(4000, ErrorMessage = "Message is too long.")]
        public string Text { get; set; } = string.Empty;

        /// <summary>Optional image (jpg/jpeg/png/webp) or PDF, max 10 MB.</summary>
        public IFormFile? Attachment { get; set; }
    }
}
