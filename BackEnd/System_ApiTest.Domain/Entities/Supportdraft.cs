using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>What the customer's message is about, as classified by the assistant.
    /// Stored as a string (see AppDbContext).</summary>
    public enum SupportTopic
    {
        Booking,
        Payment,
        Menu,
        Rental,
        Complaint,
        Other
    }

    /// <summary>How quickly the thread appears to need a human. Drives the inbox sort
    /// order only — nothing escalates automatically. Stored as a string.</summary>
    public enum SupportUrgency
    {
        Routine,
        Attention,
        Urgent
    }

    /// <summary>
    /// Lifecycle of a draft. Pending is the only state the admin UI offers; the rest are
    /// terminal records of what a human decided. Failed exists so the worker doesn't retry
    /// a message forever when Gemini is unreachable. Stored as a string.
    /// </summary>
    public enum SupportDraftStatus
    {
        Pending,
        Sent,
        Edited,
        Discarded,
        Failed
    }

    /// <summary>
    /// An unsent, unapproved assistant-written reply to one customer support message.
    ///
    /// Deliberately NOT a Supportmessage with a third sender value: SupportController's
    /// MyThread and ThreadById both select every message in a thread with no sender
    /// filter, so a draft stored there would be readable by the customer. A draft is not
    /// a message — it is never delivered, it is replaced when a newer customer message
    /// arrives, and it is discarded rather than archived.
    ///
    /// Nothing sends one of these. Staff open the thread, see the draft in the composer,
    /// and send (or edit, or discard) it themselves.
    /// </summary>
    public class Supportdraft
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid ThreadId { get; set; }
        public Supportthread Thread { get; set; } = null!;

        /// <summary>
        /// The customer message this drafts a reply to. Unique: one live draft per
        /// message, so a re-run of the worker can't stack duplicates on the same trigger.
        /// </summary>
        [Required]
        public Guid TriggerMessageId { get; set; }
        public Supportmessage TriggerMessage { get; set; } = null!;

        /// <summary>The proposed reply. Empty on a Failed draft. Matches Supportmessage.Text's limit.</summary>
        [MaxLength(4000)]
        public string Text { get; set; } = string.Empty;

        public SupportTopic Topic { get; set; } = SupportTopic.Other;

        public SupportUrgency Urgency { get; set; } = SupportUrgency.Routine;

        /// <summary>
        /// Comma-joined names of the read-only tools the model actually called, e.g.
        /// "get_payment_schedule,get_my_bookings". Surfaced as citation chips above the
        /// composer so staff can see what the draft is grounded in before sending it.
        /// </summary>
        [MaxLength(200)]
        public string ToolsUsed { get; set; } = string.Empty;

        public SupportDraftStatus Status { get; set; } = SupportDraftStatus.Pending;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
