using Microsoft.AspNetCore.Http;
using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace System_ApiTest.Application.DTOs
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

    /// <summary>
    /// An unsent assistant draft, for the ADMIN thread view only. Never populated by
    /// SupportController.MyThread: unapproved model output must not be reachable by the
    /// customer, and the JsonIgnore below means the customer's response does not even
    /// carry the key. Topic and Urgency are the enum names, as strings, matching how
    /// Status is already surfaced.
    /// </summary>
    public record SupportDraftDto(
        Guid Id,
        string Text,
        string Topic,
        string Urgency,
        IReadOnlyList<string> ToolsUsed);

    /// <summary>A support thread with its messages — the customer's view and the admin's open-thread view.</summary>
    public record SupportThreadDto(
        Guid Id,
        Guid CustomerId,
        string CustomerName,
        string Status,
        DateTime LastMessageAt,
        IReadOnlyList<SupportMessageDto> Messages,
        // Omitted from the payload entirely when null, so the customer endpoint's JSON
        // is byte-identical to what it was before drafting existed.
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        SupportDraftDto? Draft = null);

    /// <summary>A thread in the admin list: last activity, a preview, and how many customer messages are unread.</summary>
    public record SupportThreadSummaryDto(
        Guid Id,
        Guid CustomerId,
        string CustomerName,
        string CustomerEmail,
        string Status,
        DateTime LastMessageAt,
        string? LastMessagePreview,
        int UnreadFromCustomer,
        // Null until a draft exists for the thread — which is also the state the whole
        // inbox sits in while SupportTriage:Enabled is false. Admin-only endpoint, so
        // unlike SupportThreadDto.Draft these may serialise as null harmlessly.
        string? Topic = null,
        string? Urgency = null,
        bool HasDraft = false);

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

        /// <summary>
        /// Set by the admin composer when the reply started life as an assistant draft,
        /// so the server can record whether it went out as written or was edited first.
        /// Ignored on the customer endpoint, which never has a draft to reference.
        /// </summary>
        public Guid? DraftId { get; set; }
    }
}



