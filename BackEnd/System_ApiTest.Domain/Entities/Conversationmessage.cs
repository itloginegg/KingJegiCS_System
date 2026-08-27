using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// The author of a normalized conversation turn. Deliberately provider-agnostic:
    /// Model is the assistant (Gemini calls it "model"), Tool is a server-side tool
    /// result. Stored as a string (see AppDbContext).
    /// </summary>
    public enum ConversationRole
    {
        User,
        Model,
        Tool
    }

    /// <summary>
    /// One turn in a Conversation, stored in a provider-neutral shape (not raw Gemini
    /// <c>contents</c>), so a future LLM swap needs no migration. A turn is exactly one
    /// of:
    ///   User  → Text is the customer's message.
    ///   Model → Text is the assistant's reply, OR ToolPayloadJson is a JSON array of
    ///           requested tool calls [{ name, args }] (Text null then).
    ///   Tool  → ToolPayloadJson is a JSON array of tool results [{ name, response }].
    /// Ordinal orders the turns within a conversation (unique per conversation).
    /// </summary>
    public class Conversationmessage
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid ConversationId { get; set; }
        public Conversation Conversation { get; set; } = null!;

        /// <summary>Position within the thread, 0-based, unique per conversation.</summary>
        public int Ordinal { get; set; }

        [Required]
        public ConversationRole Role { get; set; }

        /// <summary>Visible message text for User turns and plain Model replies. Null for tool turns.</summary>
        public string? Text { get; set; }

        /// <summary>Single tool name when applicable; null for grouped tool turns.</summary>
        [MaxLength(100)]
        public string? ToolName { get; set; }

        /// <summary>JSON for tool-call requests / tool results (see class summary). Null for plain text.</summary>
        public string? ToolPayloadJson { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}

