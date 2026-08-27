using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>Who authored a support message. Stored as a string (see AppDbContext).</summary>
    public enum SupportSender
    {
        Customer,
        Admin
    }

    /// <summary>
    /// One message in a support thread. Read markers let each side show unread counts:
    /// a customer message is unread by staff until ReadByAdminAt is set, and vice versa.
    /// </summary>
    public class Supportmessage
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid ThreadId { get; set; }
        public Supportthread Thread { get; set; } = null!;

        [Required]
        public SupportSender Sender { get; set; }

        /// <summary>The customer or admin id that authored this message.</summary>
        public Guid SenderId { get; set; }

        /// <summary>
        /// The message body. Not [Required] at the model level any more: a message may
        /// legitimately be attachment-only (someone sends a screenshot with no words).
        /// The controller enforces that at least one of Text or Attachment is present.
        /// </summary>
        [MaxLength(4000)]
        public string Text { get; set; } = string.Empty;

        // ---- Attachment (optional; a message may be text-only, file-only, or both) ----

        /// <summary>Relative URL under wwwroot, e.g. "/uploads/support/support_a1b2….pdf".</summary>
        [MaxLength(400)]
        public string? AttachmentUrl { get; set; }

        /// <summary>The uploader's own filename, for display and the download link.</summary>
        [MaxLength(260)]
        public string? AttachmentFileName { get; set; }

        /// <summary>MIME type as uploaded — lets the client decide preview vs download.</summary>
        [MaxLength(100)]
        public string? AttachmentContentType { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime? ReadByCustomerAt { get; set; }
        public DateTime? ReadByAdminAt { get; set; }
    }
}
