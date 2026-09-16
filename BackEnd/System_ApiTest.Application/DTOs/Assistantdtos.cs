using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.DTOs
{
    /// <summary>A turn in the virtual-assistant chat. Omit ConversationId to start a new thread.</summary>
    public class AssistantChatRequest
    {
        public Guid? ConversationId { get; set; }

        [Required]
        [MaxLength(4000, ErrorMessage = "Message is too long.")]
        public string Message { get; set; } = string.Empty;
    }

    /// <summary>
    /// The assistant's reply. Proposals is populated when the model used the
    /// budget-suggestion tool during the turn — each is a Slice A proposal already
    /// re-priced and re-validated, ready to hand to /api/suggestions/materialize.
    /// </summary>
    public record AssistantChatResponse(
        Guid ConversationId,
        string Reply,
        IReadOnlyList<ProposalDto>? Proposals,
        PlanContextDto? PlanContext);

    /// <summary>
    /// What the budget tool was asked for, echoed back beside the proposals it produced.
    ///
    /// A proposal is only a list of priced lines; turning one into a plan needs the event
    /// it was priced for — the date, the guests, the type — and in chat those live in the
    /// model's tool arguments, where the browser can't see them. Without this, a chat
    /// proposal can be read but not used.
    /// </summary>
    public record PlanContextDto(
        string BookingType,
        string EventDate,
        string? EventType,
        int GuestCount,
        decimal Budget);

    /// <summary>
    /// One replayed turn of a guest conversation. Guest threads are not stored server
    /// side, so the client sends back what it has — which makes this untrusted input:
    /// Role is honoured only as "model" or "user", and both the count and the length are
    /// capped by the service.
    /// </summary>
    public class PublicChatTurnDto
    {
        /// <summary>"user" or "model". Anything else is read as "user".</summary>
        [MaxLength(10)]
        public string Role { get; set; } = "user";

        /// <summary>
        /// Generous on purpose: the real cap is the service's, which TRUNCATES a replayed
        /// turn rather than refusing the request. A model reply can run past a thousand
        /// characters, and a visitor whose own transcript contains one must not have their
        /// next message rejected for quoting it back. This length only stops nonsense.
        /// </summary>
        [MaxLength(4000)]
        public string Text { get; set; } = string.Empty;
    }

    /// <summary>
    /// A signed-out visitor's message, with as much of the thread as their browser still
    /// has. No ConversationId: there is no server-side thread to continue.
    /// </summary>
    public class PublicChatRequest
    {
        [Required]
        [MaxLength(1000, ErrorMessage = "Message is too long.")]
        public string Message { get; set; } = string.Empty;

        [MaxLength(20)]
        public List<PublicChatTurnDto>? History { get; set; }
    }

    /// <summary>
    /// The guest reply. Proposals come from the budget tool and can be added to the cart,
    /// which is where a visitor signs in — at checkout, not before.
    /// </summary>
    public record PublicChatResponse(
        string Reply,
        IReadOnlyList<ProposalDto>? Proposals,
        PlanContextDto? PlanContext);

    /// <summary>A conversation in a list view (no messages). MessageCount counts visible turns.</summary>
    public record ConversationSummaryDto(
        Guid Id,
        string? Title,
        DateTime CreatedAt,
        DateTime UpdatedAt,
        int MessageCount);

    /// <summary>One visible turn: User or Model text (tool turns are hidden).</summary>
    public record ConversationMessageDto(
        int Ordinal,
        string Role,
        string Text);

    /// <summary>
    /// An assistant-written support reply, before any human has seen it. Returned by
    /// Assistantservice and written to a Supportdraft row by the caller — nothing here is
    /// persisted by the assistant itself, and nothing here has been sent to anyone.
    /// ToolsUsed names the read-only tools the draft is grounded in, for the citation
    /// chips above the admin composer.
    /// </summary>
    public record SupportDraftResult(
        string Text,
        SupportTopic Topic,
        SupportUrgency Urgency,
        IReadOnlyList<string> ToolsUsed);

    /// <summary>A conversation with its visible dialogue, for the read endpoint.</summary>
    public record ConversationDetailDto(
        Guid Id,
        string? Title,
        DateTime CreatedAt,
        DateTime UpdatedAt,
        IReadOnlyList<ConversationMessageDto> Messages);
}


